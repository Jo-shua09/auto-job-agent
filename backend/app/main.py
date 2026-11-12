import logging
import os
import uuid
from typing import List, Optional, Dict
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.core.database import db, get_user_ref
from app.models.schemas import MasterProfile, ScoutPreferences, TailoredPackage, JobStatus
from app.services.auth_service import (
    login_email_user,
    login_google_user,
    register_email_user,
    get_current_user,
)
from app.services.profile_service import (
    initialize_blank_user_vault,
    reset_user_workspace_to_blank,
    get_master_profile,
    save_master_profile,
    get_scout_preferences,
    save_scout_preferences,
    update_target_roles,
    update_daily_apply_limit,
    get_daily_quota_status,
    parse_uploaded_cv_into_vault,
    clean_no_em_dash,
)
from app.services.pdf_compiler import compile_tailored_cv_pdf, GENERATED_PDF_DIR
from app.services.scout_service import (
    run_scout_discovery,
    paste_and_ingest_job,
    list_discovered_jobs,
    log_agent_step,
    get_recent_activity_stream,
    get_applied_jobs_grouped_by_day,
    GeminiQuotaExceededError,
    GeminiServiceUnavailableError,
)
from app.services.tailor_service import (
    tailor_and_stage_job,
    batch_tailor_discovered_jobs,
    get_tailored_package,
)
from app.services.applicator_service import (
    execute_job_application,
    run_queued_applications_batch,
    get_execution_log,
    get_application_run_status,
    request_application_stop,
)
from app.services.inbox_service import (
    poll_gmail_inbox_sync,
    process_and_record_email_event,
    list_email_events,
)
from app.services.state_machine import transition_job_state

logger = logging.getLogger(__name__)

app = FastAPI(title="Verdant — Autonomous Job Agent API", version="1.0.0")

default_frontend_origins = (
    "https://verdant-agent.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
)
configured_frontend_origins = os.getenv("FRONTEND_ORIGINS", "").split(",")
frontend_origins = list(
    dict.fromkeys(
        origin.strip().rstrip("/")
        for origin in (*default_frontend_origins, *configured_frontend_origins)
        if origin.strip().rstrip("/")
    )
)

app.mount("/pdfs", StaticFiles(directory=str(GENERATED_PDF_DIR)), name="pdfs")


# --- REQUEST SCHEMAS ---

class EmailPasswordAuthRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    full_name: Optional[str] = Field(default="")

class GoogleAuthRequest(BaseModel):
    credential: str = Field(min_length=1)

class UpdateRolesRequest(BaseModel):
    target_role_titles: List[str]
    preferred_locations: Optional[List[str]] = None
    work_modes: Optional[List[str]] = None

class UpdateDailyLimitRequest(BaseModel):
    daily_apply_limit: int = Field(default=10, ge=1, le=200)

class RunScoutRequest(BaseModel):
    custom_roles_override: Optional[List[str]] = None
    max_jobs_to_score: int = 8

class PasteAnyJobRequest(BaseModel):
    external_url: Optional[str] = None
    raw_jd_text: Optional[str] = None
    company_name: Optional[str] = None
    role_title: Optional[str] = None
    auto_queue_for_apply: bool = True

class UpdateScreeningAnswersRequest(BaseModel):
    cover_letter_text: Optional[str] = None
    screening_answers: Optional[Dict[str, str]] = None

class CustomizeTailoredPackageRequest(BaseModel):
    selected_experience_ids: List[str] = Field(default_factory=list, max_length=50)
    selected_project_ids: List[str] = Field(default_factory=list, max_length=50)
    tailoring_instructions: str = Field(default="", max_length=2000)

class SubmitOTPRequest(BaseModel):
    otp_code: str = Field(min_length=3, max_length=12)

class SimulateEmailRequest(BaseModel):
    sender: str = Field(default="careers@linear.app")
    subject: str = Field(default="Invitation to Interview: Senior AI Frontend Engineer at Linear")
    snippet: str = Field(
        default="Hi, our engineering team reviewed your application and would love to schedule a 30-minute technical intro call this week."
    )


# --- HEALTH & AUTHENTICATION ENDPOINTS ---

@app.get("/health")
def health_check():
    db.command("ping")
    return {"status": "ok", "app": "Verdant", "mongodb_connected": True}

@app.post("/api/auth/register")
def auth_register_email(req: EmailPasswordAuthRequest):
    try:
        return register_email_user(req.email, req.password, req.full_name)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

@app.post("/api/auth/login")
def auth_login_email(req: EmailPasswordAuthRequest):
    try:
        return login_email_user(req.email, req.password)
    except ValueError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error

@app.post("/api/auth/google")
def auth_google(req: GoogleAuthRequest):
    try:
        return login_google_user(req.credential)
    except ValueError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error

@app.get("/api/auth/me")
async def auth_current_user(current_user: dict = Depends(get_current_user)):
    return {"authenticated": True, "user": current_user}


# --- PHASE 2: DYNAMIC BLANK-SLATE VAULT, ROLES & DAILY LIMIT ENDPOINTS ---

@app.post("/api/vault/reset")
def reset_vault_to_blank(current_user: dict = Depends(get_current_user)):
    """Wipes any existing test/dummy data and resets the user's Vault & Jobs to a 100% blank state."""
    return reset_user_workspace_to_blank(current_user["user_id"])

@app.get("/api/vault")
def read_vault(current_user: dict = Depends(get_current_user)):
    """Returns the user's Master Profile Vault (blank until filled or CV uploaded)."""
    return get_master_profile(current_user["user_id"])

@app.put("/api/vault")
def update_vault(profile_payload: MasterProfile, current_user: dict = Depends(get_current_user)):
    """Saves manually entered Master Profile fields (Personal info, Experiences, Projects, Education, Skills)."""
    uid = current_user["user_id"]
    try:
        saved = save_master_profile(profile_payload, uid)
        log_agent_step(
            "Saved Master Profile Vault",
            f"Updated verified profile for {saved.get('full_name') or 'User'}.",
            phase="VAULT",
            user_id=uid,
        )
        return saved
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/scout/preferences")
def read_scout_preferences(current_user: dict = Depends(get_current_user)):
    return get_scout_preferences(current_user["user_id"])

@app.put("/api/scout/preferences")
def update_full_scout_preferences(prefs_payload: ScoutPreferences, current_user: dict = Depends(get_current_user)):
    """Saves full Scout Preferences (target_roles, preferred_locations, work_modes, daily_apply_limit, etc.)."""
    uid = current_user["user_id"]
    try:
        saved = save_scout_preferences(prefs_payload, uid)
        log_agent_step(
            "Updated Job Search Preferences",
            f"Saved {len(saved.get('target_roles', []))} target roles and work mode filters.",
            phase="SCOUT",
            user_id=uid,
        )
        return saved
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/scout/preferences/roles")
def set_custom_target_roles(req: UpdateRolesRequest, current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    log_agent_step(
        "Updated Target Roles",
        f"Active target roles: {', '.join(req.target_role_titles)}",
        phase="SCOUT",
        user_id=uid,
    )
    return update_target_roles(
        req.target_role_titles,
        req.preferred_locations,
        req.work_modes,
        uid,
    )

@app.patch("/api/scout/preferences/limit")
def set_daily_apply_limit(req: UpdateDailyLimitRequest, current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    log_agent_step(
        "Updated Daily Application Limit",
        f"Daily auto-apply cap set to {req.daily_apply_limit} jobs per day.",
        phase="SCOUT",
        user_id=uid,
    )
    return update_daily_apply_limit(req.daily_apply_limit, uid)

@app.get("/api/scout/quota")
def read_daily_quota(current_user: dict = Depends(get_current_user)):
    return get_daily_quota_status(current_user["user_id"])

@app.post("/api/vault/upload-cv")
async def upload_base_cv(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    log_agent_step(
        "Extracting Uploaded Base CV",
        f"Parsing {file.filename} into your Master Vault with zero hallucinations.",
        phase="VAULT",
        user_id=uid,
    )
    pdf_bytes = await file.read()
    try:
        parsed = parse_uploaded_cv_into_vault(pdf_bytes, uid)
        return {"status": "parsed_and_saved", "profile": parsed}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/vault/test-pdf")
async def test_compile_pdf(
    custom_role_title: str = Query(default="Software Engineer"),
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    raw_profile = get_master_profile(uid)
    profile = MasterProfile.model_validate(raw_profile)
    custom_role_title = clean_no_em_dash(custom_role_title)

    role_words = {w.lower() for w in custom_role_title.replace("/", " ").replace("-", " ").split() if len(w) > 1}
    scored_projs = sorted(
        profile.projects,
        key=lambda p: sum(1 for tag in p.role_tags if any(w in tag.lower() for w in role_words)),
        reverse=True,
    )
    selected_projs = scored_projs[:4]

    summary_text = profile.summary_template or (
        f"Software Engineer specializing in {custom_role_title} with hands-on experience shipping production software."
    )

    sample_package = TailoredPackage(
        job_id="custom_role_preview",
        user_id=uid,
        target_role_headline=custom_role_title,
        tailored_summary=clean_no_em_dash(summary_text),
        selected_experiences=profile.experiences,
        selected_projects=selected_projs,
        critic_score=96,
    )

    pdf_url = await compile_tailored_cv_pdf(
        profile=profile,
        package=sample_package,
        target_role_title=custom_role_title,
        filename_job_title=custom_role_title,
    )

    return {
        "status": "compiled",
        "target_role": custom_role_title,
        "selected_projects": [p.name for p in selected_projs],
        "preview_url": pdf_url,
    }


# --- PHASE 3: THE SCOUT & PASTE-ANY-JOB ENDPOINTS ---

@app.post("/api/scout/run")
async def trigger_scout_run(
    req: RunScoutRequest,
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    try:
        log_agent_step(
            "Scanning Job Platforms & ATS Boards",
            "Searching across 15+ ATS domains and global feeds for your configured roles...",
            phase="SCOUT",
            status="active",
            user_id=uid,
        )
        res = await run_scout_discovery(
            custom_roles_override=req.custom_roles_override,
            max_jobs_to_score=req.max_jobs_to_score,
            user_id=uid,
        )
        log_agent_step(
            f"Found {res['high_match_discovered_count']} Matching Roles",
            f"Filtered out {res['skipped_duplicates_count']} duplicates and {res['archived_low_or_blocked_count']} low-fit listings.",
            phase="SCOUT",
            status="completed",
            user_id=uid,
        )
        return res
    except GeminiQuotaExceededError as e:
        log_agent_step(
            "Gemini quota reached",
            str(e),
            phase="SCOUT",
            status="error",
            user_id=uid,
        )
        raise HTTPException(status_code=429, detail=str(e)) from e
    except GeminiServiceUnavailableError as e:
        log_agent_step(
            "AI service unavailable",
            str(e),
            phase="SCOUT",
            status="error",
            user_id=uid,
        )
        raise HTTPException(status_code=503, detail=str(e)) from e

@app.post("/api/scout/paste-job")
async def paste_any_job_to_apply(
    req: PasteAnyJobRequest,
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    phase = "SCOUT"
    job_id: Optional[str] = None
    try:
        log_agent_step(
            "Analyzing Pasted Job Opportunity",
            "Extracting company details, role requirements, and scoring tech stack alignment...",
            phase="SCOUT",
            status="active",
            user_id=uid,
        )
        ingested = await paste_and_ingest_job(
            external_url=req.external_url,
            raw_jd_text=req.raw_jd_text,
            company_name=req.company_name,
            role_title=req.role_title,
            auto_queue_for_apply=req.auto_queue_for_apply,
            user_id=uid,
        )
        job = ingested["job"]
        job_id = job["id"]
        log_agent_step(
            f"Job Identified: {job['role_title']} at {job['company_name']}",
            "Job details extracted. Starting CV tailoring for your review.",
            phase="SCOUT",
            job_id=job_id,
            status="completed",
            user_id=uid,
        )
        phase = "TAILOR"
        log_agent_step(
            f"Tailoring CV & Cover Letter for {job['company_name']}",
            f"Matching verified projects from your Vault for {job['role_title']}...",
            phase="TAILOR",
            job_id=job_id,
            status="active",
            user_id=uid,
        )
        tailored = await tailor_and_stage_job(job_id, user_id=uid)
        log_agent_step(
            f"Ready for Review: {job['role_title']} at {job['company_name']}",
            f"Critic verified resume ({tailored['critic_score']}/100) and compiled ATS PDF.",
            phase="TAILOR",
            job_id=job_id,
            status="completed",
            user_id=uid,
        )
        return {
            "ingested_job": job,
            "tailored_result": tailored,
            "daily_quota": ingested["daily_quota"],
        }
    except GeminiQuotaExceededError as e:
        log_agent_step(
            "Gemini quota reached",
            str(e),
            phase=phase,
            job_id=job_id,
            status="error",
            user_id=uid,
        )
        raise HTTPException(status_code=429, detail=str(e)) from e
    except GeminiServiceUnavailableError as e:
        log_agent_step(
            "AI service unavailable",
            str(e),
            phase=phase,
            job_id=job_id,
            status="error",
            user_id=uid,
        )
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        log_agent_step(
            "Job processing failed",
            str(e),
            phase=phase,
            job_id=job_id,
            status="error",
            user_id=uid,
        )
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Unexpected error while processing pasted job %s", job_id)
        log_agent_step(
            "Job processing failed",
            "The backend encountered an unexpected error. Check the backend logs for details.",
            phase=phase,
            job_id=job_id,
            status="error",
            user_id=uid,
        )
        raise HTTPException(
            status_code=502,
            detail="The job service encountered an unexpected error. Please try again shortly.",
        )

@app.get("/api/jobs")
def get_jobs(
    status: Optional[JobStatus] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    return list_discovered_jobs(status_filter=status, user_id=current_user["user_id"])

@app.get("/api/jobs/history-by-day")
def read_jobs_grouped_by_day(current_user: dict = Depends(get_current_user)):
    return get_applied_jobs_grouped_by_day(user_id=current_user["user_id"])

@app.get("/api/agent/activity-stream")
def read_agent_activity_stream(
    limit: int = Query(default=25, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    return get_recent_activity_stream(limit=limit, user_id=current_user["user_id"])


# --- PHASE 4: WRITER-CRITIC TAILORING & 95% AUTO APPROVAL GATE ---

@app.post("/api/tailor/batch-run")
async def trigger_batch_tailor(
    limit: int = Query(default=5, ge=1, le=20),
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    try:
        log_agent_step(
            f"Batch Tailoring Top {limit} Discovered Jobs",
            "Running Writer-Critic loop and compiling custom PDFs...",
            phase="TAILOR",
            status="active",
            user_id=uid,
        )
        res = await batch_tailor_discovered_jobs(limit=limit, user_id=uid)
        log_agent_step(
            f"Staged {res['tailored_count']} Tailored Applications in Review Queue",
            "All PDFs compiled and verified with zero hallucinations.",
            phase="TAILOR",
            status="completed",
            user_id=uid,
        )
        return res
    except GeminiQuotaExceededError as e:
        log_agent_step(
            "Gemini quota reached",
            str(e),
            phase="TAILOR",
            status="error",
            user_id=uid,
        )
        raise HTTPException(status_code=429, detail=str(e)) from e
    except GeminiServiceUnavailableError as e:
        log_agent_step(
            "AI service unavailable",
            str(e),
            phase="TAILOR",
            status="error",
            user_id=uid,
        )
        raise HTTPException(status_code=503, detail=str(e)) from e

@app.post("/api/tailor/{job_id}")
async def trigger_single_job_tailor(
    job_id: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        return await tailor_and_stage_job(job_id, user_id=current_user["user_id"])
    except GeminiQuotaExceededError as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    except GeminiServiceUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.get("/api/tailor/{job_id}")
def read_tailored_package(
    job_id: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        return get_tailored_package(job_id, user_id=current_user["user_id"])
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.post("/api/tailor/{job_id}/customize")
async def customize_tailored_package(
    job_id: str,
    req: CustomizeTailoredPackageRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        return await tailor_and_stage_job(
            job_id,
            user_id=current_user["user_id"],
            selected_experience_ids=req.selected_experience_ids,
            selected_project_ids=req.selected_project_ids,
            tailoring_instructions=req.tailoring_instructions,
        )
    except GeminiQuotaExceededError as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    except GeminiServiceUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.patch("/api/tailor/{job_id}")
def update_tailored_package_fields(
    job_id: str,
    req: UpdateScreeningAnswersRequest,
    current_user: dict = Depends(get_current_user),
):
    user_ref = get_user_ref(current_user["user_id"])
    doc_ref = user_ref.collection("tailored_packages").document(job_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Tailored package not found.")
    updates = {}
    if req.cover_letter_text is not None:
        updates["cover_letter_text"] = clean_no_em_dash(req.cover_letter_text)
    if req.screening_answers is not None:
        updates["screening_answers"] = clean_no_em_dash(req.screening_answers)
    if updates:
        doc_ref.update(updates)
    return doc_ref.get().to_dict()

@app.post("/api/jobs/{job_id}/approve")
def approve_job_for_application(
    job_id: str,
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    quota = get_daily_quota_status(uid)
    if not quota["can_apply_more_today"]:
        raise HTTPException(
            status_code=429,
            detail=f"Daily application limit reached ({quota['daily_apply_limit']}/{quota['daily_apply_limit']}). Edit your limit or wait until tomorrow.",
        )
    try:
        transition = transition_job_state(job_id, JobStatus.APPLYING_QUEUED, uid)
        log_agent_step(
            f"Approved Job {job_id} for Auto-Application",
            f"Queued for Playwright submission ({quota['applied_today'] + 1}/{quota['daily_apply_limit']} daily quota).",
            phase="APPLY",
            job_id=job_id,
            status="completed",
            user_id=uid,
        )
        return {"status": "approved_and_queued", "transition": transition, "daily_quota": quota}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/jobs/{job_id}/skip")
def skip_job(
    job_id: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        return transition_job_state(job_id, JobStatus.SKIPPED, current_user["user_id"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/jobs/{job_id}/submit-otp")
def submit_manual_otp_code(
    job_id: str,
    req: SubmitOTPRequest,
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    user_ref = get_user_ref(uid)
    user_ref.collection("execution_logs").document(job_id).set(
        {
            "job_id": job_id,
            "state": "OTP_RECEIVED",
            "otp_required": False,
            "otp_code_input": req.otp_code.strip(),
            "step_message": "Verification code received from user. Resuming application submission...",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        merge=True,
    )
    log_agent_step(
        "Verification Code Received",
        "Entering your OTP code into the application form and completing submission...",
        phase="OTP",
        job_id=job_id,
        status="active",
        user_id=uid,
    )
    return {"status": "otp_relayed", "job_id": job_id}


# --- PHASE 6: PLAYWRIGHT APPLICATOR & LIVE MANUAL OTP RELAY ---

@app.post("/api/apply/{job_id}/execute")
async def trigger_playwright_application(
    job_id: str,
    headless: bool = Query(default=True),
    simulate_otp: bool = Query(default=False),
    current_user: dict = Depends(get_current_user),
):
    try:
        return await execute_job_application(
            job_id=job_id,
            headless=headless,
            simulate_otp_for_testing=simulate_otp,
            user_id=current_user["user_id"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/apply/run-queue")
async def trigger_queued_applications_batch(
    headless: bool = Query(default=True),
    current_user: dict = Depends(get_current_user),
):
    try:
        return await run_queued_applications_batch(headless=headless, user_id=current_user["user_id"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/apply/control")
def read_application_control(current_user: dict = Depends(get_current_user)):
    return get_application_run_status(current_user["user_id"])


@app.post("/api/apply/stop")
def stop_active_application(current_user: dict = Depends(get_current_user)):
    return request_application_stop(current_user["user_id"])

@app.get("/api/apply/{job_id}/log")
def read_job_execution_log(
    job_id: str,
    current_user: dict = Depends(get_current_user),
):
    return get_execution_log(job_id, user_id=current_user["user_id"])

@app.get("/api/jobs/waiting-otp")
def list_jobs_waiting_for_otp(current_user: dict = Depends(get_current_user)):
    return list_discovered_jobs(status_filter=JobStatus.WAITING_FOR_OTP, user_id=current_user["user_id"])


# --- PHASE 7: GMAIL INBOX WATCHER & LIFECYCLE TRACKER ---

@app.post("/api/inbox/poll")
def trigger_gmail_inbox_poll(
    max_emails: int = Query(default=10, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    return poll_gmail_inbox_sync(max_emails=max_emails, user_id=current_user["user_id"])

@app.post("/api/inbox/simulate-email")
def simulate_incoming_recruiter_email(
    req: SimulateEmailRequest,
    current_user: dict = Depends(get_current_user),
):
    msg_id = f"sim_email_{uuid.uuid4().hex[:8]}"
    return process_and_record_email_event(
        message_id=msg_id,
        sender=req.sender,
        subject=req.subject,
        snippet=req.snippet,
        user_id=current_user["user_id"],
    )

@app.get("/api/inbox/events")
def read_tracked_email_events(current_user: dict = Depends(get_current_user)):
    return list_email_events(user_id=current_user["user_id"])


app = CORSMiddleware(
    app=app,
    allow_origins=frontend_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)