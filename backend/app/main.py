from typing import List, Optional, Dict
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from app.core.firebase import get_user_ref
from app.models.schemas import MasterProfile, TailoredPackage, JobStatus
from app.services.profile_service import (
    seed_master_profile,
    get_master_profile,
    get_scout_preferences,
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
)
from app.services.tailor_service import (
    tailor_and_stage_job,
    batch_tailor_discovered_jobs,
    get_tailored_package,
)
from app.services.state_machine import transition_job_state
from app.services.applicator_service import (
    execute_job_application,
    run_queued_applications_batch,
    get_execution_log,
)

app = FastAPI(title="VANGUARD - Autonomous Job Agent API", version="1.0.0")

# Allow localhost:3000 AND Lovable preview domains to connect seamlessly
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/pdfs", StaticFiles(directory=str(GENERATED_PDF_DIR)), name="pdfs")

class UpdateRolesRequest(BaseModel):
    target_role_titles: List[str]
    preferred_locations: List[str] | None = None

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

class SubmitOTPRequest(BaseModel):
    otp_code: str = Field(min_length=3, max_length=12, description="The OTP code sent to your email")

@app.get("/health")
def health_check():
    user_ref = get_user_ref()
    user_ref.set({"status": "active", "agent_mode": "95_PERCENT_AUTO"}, merge=True)
    return {"status": "ok", "firestore_connected": True, "tenant": user_ref.id}

# --- PHASE 2: VAULT, ROLES & DAILY LIMIT ENDPOINTS ---

@app.post("/api/vault/seed")
def seed_vault():
    log_agent_step(
        "Master Vault Initialized",
        "Loaded your verified experiences, projects, and target role preferences.",
        phase="VAULT",
    )
    return seed_master_profile()

@app.get("/api/vault")
def read_vault():
    return get_master_profile()

@app.get("/api/scout/preferences")
def read_scout_preferences():
    return get_scout_preferences()

@app.post("/api/scout/preferences/roles")
def set_custom_target_roles(req: UpdateRolesRequest):
    log_agent_step(
        "Updated Target Roles",
        f"Now hunting for: {', '.join(req.target_role_titles)}",
        phase="SCOUT",
    )
    return update_target_roles(req.target_role_titles, req.preferred_locations)

@app.patch("/api/scout/preferences/limit")
def set_daily_apply_limit(req: UpdateDailyLimitRequest):
    log_agent_step(
        "Updated Daily Application Limit",
        f"Daily auto-apply cap set to {req.daily_apply_limit} jobs per day.",
        phase="SCOUT",
    )
    return update_daily_apply_limit(req.daily_apply_limit)

@app.get("/api/scout/quota")
def read_daily_quota():
    return get_daily_quota_status()

@app.post("/api/vault/upload-cv")
async def upload_base_cv(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    log_agent_step(
        "Extracting Uploaded Base CV",
        f"Reading {file.filename} into your Master Vault with zero hallucinations.",
        phase="VAULT",
    )
    pdf_bytes = await file.read()
    parsed = parse_uploaded_cv_into_vault(pdf_bytes)
    return {"status": "parsed_and_saved", "profile": parsed}

@app.post("/api/vault/test-pdf")
async def test_compile_pdf(
    custom_role_title: str = Query(default="AI Frontend Engineer (Next.js / TypeScript)")
):
    raw_profile = get_master_profile()
    profile = MasterProfile.model_validate(raw_profile)
    custom_role_title = clean_no_em_dash(custom_role_title)

    role_words = {w.lower() for w in custom_role_title.replace("/", " ").replace("-", " ").split() if len(w) > 1}
    scored_projs = sorted(
        profile.projects,
        key=lambda p: sum(1 for tag in p.role_tags if any(w in tag.lower() for w in role_words)),
        reverse=True,
    )
    selected_projs = scored_projs[:4]

    sample_package = TailoredPackage(
        job_id="custom_role_preview",
        user_id=profile.user_id,
        target_role_headline=custom_role_title,
        tailored_summary=clean_no_em_dash(
            f"Software Engineer specializing in {custom_role_title} with hands-on experience shipping "
            "production web applications, AI-driven workflows, and cross-platform mobile software."
        ),
        selected_experiences=profile.experiences,
        selected_projects=selected_projs,
        critic_score=96,
    )

    pdf_url = await compile_tailored_cv_pdf(
        profile=profile,
        package=sample_package,
        target_role_title=custom_role_title,
        filename_prefix=f"Joshua_Ituma_{custom_role_title[:25]}",
    )

    return {
        "status": "compiled",
        "target_role": custom_role_title,
        "selected_projects": [p.name for p in selected_projs],
        "preview_url": f"http://localhost:8000{pdf_url}",
    }

# --- PHASE 3: THE SCOUT & PASTE-ANY-JOB ENDPOINTS ---

@app.post("/api/scout/run")
async def trigger_scout_run(req: RunScoutRequest):
    log_agent_step(
        "Scanning Job Platforms & ATS Boards",
        "Searching across 15+ ATS domains and global remote feeds for your active roles...",
        phase="SCOUT",
        status="active",
    )
    res = await run_scout_discovery(
        custom_roles_override=req.custom_roles_override,
        max_jobs_to_score=req.max_jobs_to_score,
    )
    log_agent_step(
        f"Found {res['high_match_discovered_count']} High-Match Roles",
        f"Filtered out {res['skipped_duplicates_count']} duplicates and {res['archived_low_or_blocked_count']} low-fit/geo-blocked listings.",
        phase="SCOUT",
        status="completed",
    )
    return res

@app.post("/api/scout/paste-job")
async def paste_any_job_to_apply(req: PasteAnyJobRequest):
    try:
        log_agent_step(
            "Analyzing Pasted Job Opportunity",
            "Extracting company details, role requirements, and scoring tech stack alignment...",
            phase="SCOUT",
            status="active",
        )
        ingested = await paste_and_ingest_job(
            external_url=req.external_url,
            raw_jd_text=req.raw_jd_text,
            company_name=req.company_name,
            role_title=req.role_title,
            auto_queue_for_apply=req.auto_queue_for_apply,
        )
        job = ingested["job"]
        job_id = job["id"]
        log_agent_step(
            f"Tailoring CV & Cover Letter for {job['company_name']}",
            f"Matching verified projects from your Vault for {job['role_title']}...",
            phase="TAILOR",
            job_id=job_id,
            status="active",
        )
        tailored = await tailor_and_stage_job(job_id)
        log_agent_step(
            f"Ready for Review: {job['role_title']} at {job['company_name']}",
            f"Critic verified resume ({tailored['critic_score']}/100) and compiled ATS PDF.",
            phase="TAILOR",
            job_id=job_id,
            status="completed",
        )
        return {
            "ingested_job": job,
            "tailored_result": tailored,
            "daily_quota": ingested["daily_quota"],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/jobs")
def get_jobs(status: Optional[JobStatus] = Query(default=None)):
    return list_discovered_jobs(status_filter=status)

@app.get("/api/jobs/history-by-day")
def read_jobs_grouped_by_day():
    """Returns applied jobs grouped chronologically by day for the '/history' timeline view."""
    return get_applied_jobs_grouped_by_day()

@app.get("/api/agent/activity-stream")
def read_agent_activity_stream(limit: int = Query(default=25, ge=1, le=100)):
    """Returns plain-English, Lovable-style progress steps so the user sees what the agent is doing."""
    return get_recent_activity_stream(limit=limit)

# --- PHASE 4: WRITER-CRITIC TAILORING & 95% AUTO APPROVAL GATE ---

@app.post("/api/tailor/batch-run")
async def trigger_batch_tailor(limit: int = Query(default=5, ge=1, le=20)):
    log_agent_step(
        f"Batch Tailoring Top {limit} Discovered Jobs",
        "Running Writer-Critic loop and compiling custom PDFs...",
        phase="TAILOR",
        status="active",
    )
    res = await batch_tailor_discovered_jobs(limit=limit)
    log_agent_step(
        f"Staged {res['tailored_count']} Tailored Applications in Review Queue",
        "All PDFs compiled and verified with zero hallucinations.",
        phase="TAILOR",
        status="completed",
    )
    return res

@app.post("/api/tailor/{job_id}")
async def trigger_single_job_tailor(job_id: str):
    try:
        return await tailor_and_stage_job(job_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.get("/api/tailor/{job_id}")
def read_tailored_package(job_id: str):
    try:
        return get_tailored_package(job_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.patch("/api/tailor/{job_id}")
def update_tailored_package_fields(job_id: str, req: UpdateScreeningAnswersRequest):
    user_ref = get_user_ref()
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
def approve_job_for_application(job_id: str):
    quota = get_daily_quota_status()
    if not quota["can_apply_more_today"]:
        raise HTTPException(
            status_code=429,
            detail=f"Daily application limit reached ({quota['daily_apply_limit']}/{quota['daily_apply_limit']}). Edit your limit or wait until tomorrow.",
        )
    try:
        transition = transition_job_state(job_id, JobStatus.APPLYING_QUEUED)
        log_agent_step(
            f"Approved Job {job_id} for Auto-Application",
            f"Queued for Playwright submission ({quota['applied_today'] + 1}/{quota['daily_apply_limit']} daily quota).",
            phase="APPLY",
            job_id=job_id,
            status="completed",
        )
        return {"status": "approved_and_queued", "transition": transition, "daily_quota": quota}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/jobs/{job_id}/skip")
def skip_job(job_id: str):
    try:
        return transition_job_state(job_id, JobStatus.SKIPPED)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/jobs/{job_id}/submit-otp")
def submit_manual_otp_code(job_id: str, req: SubmitOTPRequest):
    """Receives the manual email OTP code typed by the user in the UI and relays it to the paused Playwright worker."""
    user_ref = get_user_ref()
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
    )
    return {"status": "otp_relayed", "job_id": job_id}

    # --- PHASE 6: PLAYWRIGHT APPLICATOR & LIVE MANUAL OTP RELAY ---

@app.post("/api/apply/{job_id}/execute")
async def trigger_playwright_application(
    job_id: str,
    headless: bool = Query(
        default=True,
        description="Set to false to watch the Chromium browser open and fill the form live on your screen!",
    ),
    simulate_otp: bool = Query(
        default=False,
        description="Set to true to test the WAITING_FOR_OTP pause-and-resume handshake!",
    ),
):
    """Launches the Playwright Applicator Worker for a specific job."""
    try:
        return await execute_job_application(
            job_id=job_id,
            headless=headless,
            simulate_otp_for_testing=simulate_otp,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/apply/run-queue")
async def trigger_queued_applications_batch(
    headless: bool = Query(default=True, description="Set to false to watch Playwright apply visibly")
):
    """Executes all jobs in APPLYING_QUEUED up to your remaining Daily Application Limit (default 10)."""
    return await run_queued_applications_batch(headless=headless)

@app.get("/api/apply/{job_id}/log")
def read_job_execution_log(job_id: str):
    """Returns the real-time Playwright execution log, OTP prompt state, and confirmation screenshot."""
    return get_execution_log(job_id)

@app.get("/api/jobs/waiting-otp")
def list_jobs_waiting_for_otp():
    """Returns any jobs currently paused in WAITING_FOR_OTP so the UI can pop up the OTP input modal."""
    return list_discovered_jobs(status_filter=JobStatus.WAITING_FOR_OTP)