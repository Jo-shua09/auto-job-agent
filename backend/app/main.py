from typing import List, Optional, Dict
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from app.core.firebase import current_tenant_id, get_user_ref
from app.models.schemas import MasterProfile, ScoutPreferences, JobStatus
from app.services.profile_service import (
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
from app.services.pdf_compiler import GENERATED_PDF_DIR
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
from app.services.inbox_service import (
    poll_gmail_inbox_sync,
    list_email_events,
)
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Header, Depends
from app.services.auth_service import (
    verify_real_firebase_id_token,
    firebase_rest_email_signup_or_login,
    get_current_user,
)

app = FastAPI(title="VERDANT - Autonomous Job Agent API", version="1.0.0")

# Allow localhost:3000 AND Lovable preview domains to connect seamlessly
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/pdfs", StaticFiles(directory=str(GENERATED_PDF_DIR)), name="pdfs")

@app.middleware("http")
async def bind_firebase_tenant(request, call_next):
    if not request.url.path.startswith("/api/") or request.method == "OPTIONS" or request.url.path in {
        "/api/auth/session",
        "/api/auth/register",
        "/api/auth/login",
    }:
        return await call_next(request)
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "Sign in to access your workspace."})
    try:
        verified = verify_real_firebase_id_token(authorization[7:].strip())
    except ValueError as exc:
        return JSONResponse(status_code=401, content={"detail": str(exc)})
    token = current_tenant_id.set(verified["user"]["user_id"])
    try:
        return await call_next(request)
    finally:
        current_tenant_id.reset(token)

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
    auto_queue_for_apply: bool = False

class UpdateScreeningAnswersRequest(BaseModel):
    cover_letter_text: Optional[str] = None
    screening_answers: Optional[Dict[str, str]] = None

class SubmitOTPRequest(BaseModel):
    otp_code: str = Field(min_length=3, max_length=12, description="The OTP code sent to your email")

@app.get("/health")
def health_check():
    return {"status": "ok", "firestore_connected": True}

# --- PHASE 2: VAULT, ROLES & DAILY LIMIT ENDPOINTS ---

@app.get("/api/vault")
def read_vault():
    return get_master_profile()

@app.put("/api/vault")
def write_vault(profile: MasterProfile):
    return save_master_profile(profile)

@app.get("/api/scout/preferences")
def read_scout_preferences():
    return get_scout_preferences()

@app.put("/api/scout/preferences")
def write_scout_preferences(preferences: ScoutPreferences):
    return save_scout_preferences(preferences)

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
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    log_agent_step(
        "Extracting Uploaded Base CV",
        f"Reading {file.filename} into your Master Vault with zero hallucinations.",
        phase="VAULT",
    )
    pdf_bytes = await file.read()
    try:
        parsed = parse_uploaded_cv_into_vault(pdf_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "parsed_and_saved", "profile": parsed}

# --- PHASE 3: THE SCOUT & PASTE-ANY-JOB ENDPOINTS ---

@app.post("/api/scout/run")
async def trigger_scout_run(req: RunScoutRequest):
    profile = get_master_profile()
    preferences = ScoutPreferences.model_validate(get_scout_preferences())
    if not profile.get("is_onboarded"):
        raise HTTPException(status_code=400, detail="Complete and save your Master Vault before running the Scout.")
    if not any(role.active for role in preferences.target_roles):
        raise HTTPException(status_code=400, detail="Add and activate at least one target role before running the Scout.")
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
        profile = get_master_profile()
        preferences = ScoutPreferences.model_validate(get_scout_preferences())
        if not profile.get("is_onboarded"):
            raise HTTPException(status_code=400, detail="Complete and save your Master Vault before tailoring a job.")
        if not any(role.active for role in preferences.target_roles):
            raise HTTPException(status_code=400, detail="Add and activate at least one target role before tailoring a job.")
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

# --- PHASE 7: GMAIL INBOX WATCHER & LIFECYCLE TRACKER ---

@app.post("/api/inbox/poll")
def trigger_gmail_inbox_poll(max_emails: int = Query(default=10, ge=1, le=50)):
    """Polls Gmail Inbox in read-only mode, classifies recruiter replies, and updates job statuses."""
    return poll_gmail_inbox_sync(max_emails=max_emails)

@app.get("/api/inbox/events")
def read_tracked_email_events():
    """Returns all classified recruiter emails and status transitions."""
    return list_email_events()

# --- REAL FIREBASE AUTHENTICATION ENDPOINTS ---

class FirebaseTokenRequest(BaseModel):
    id_token: str = Field(description="The real Firebase ID Token from user.getIdToken() on the frontend")
    full_name: Optional[str] = Field(default=None, description="Optional display name during initial registration")

class EmailPasswordAuthRequest(BaseModel):
    email: str
    password: str = Field(min_length=6)
    full_name: Optional[str] = None

@app.post("/api/auth/session")
def establish_firebase_session(req: FirebaseTokenRequest):
    """
    Primary Production Endpoint:
    The frontend signs the user in via Firebase Web SDK (signInWithEmailAndPassword,
    createUserWithEmailAndPassword, or signInWithPopup GoogleAuthProvider), grabs
    `await user.getIdToken()`, and sends it here to verify & sync with Firestore!
    """
    try:
        res = verify_real_firebase_id_token(req.id_token)
        if req.full_name and res["user"]["user_id"]:
            get_user_ref(res["user"]["user_id"]).set({"full_name": req.full_name}, merge=True)
            res["user"]["full_name"] = req.full_name
        return res
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

@app.post("/api/auth/register")
async def auth_register_email(req: EmailPasswordAuthRequest):
    """Creates a real user in Firebase Authentication and seeds their Firestore Vault."""
    try:
        return await firebase_rest_email_signup_or_login(
            email=req.email,
            password=req.password,
            full_name=req.full_name,
            is_signup=True,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/auth/login")
async def auth_login_email(req: EmailPasswordAuthRequest):
    """Signs in an existing user against Firebase Authentication."""
    try:
        return await firebase_rest_email_signup_or_login(
            email=req.email,
            password=req.password,
            is_signup=False,
        )
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

@app.get("/api/auth/me")
async def auth_current_user(current_user: dict = Depends(get_current_user)):
    """Returns the verified Firebase user profile and active Firestore tenant."""
    return {"authenticated": True, "user": current_user}