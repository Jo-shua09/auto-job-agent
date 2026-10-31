from typing import List, Optional
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
)

app = FastAPI(title="Autonomous Job Agent API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/pdfs", StaticFiles(directory=str(GENERATED_PDF_DIR)), name="pdfs")

class UpdateRolesRequest(BaseModel):
    target_role_titles: List[str]
    preferred_locations: List[str] | None = None

class UpdateDailyLimitRequest(BaseModel):
    daily_apply_limit: int = Field(default=10, ge=1, le=200, description="Max jobs to apply for daily (Default: 10)")

class RunScoutRequest(BaseModel):
    custom_roles_override: Optional[List[str]] = None
    max_jobs_to_score: int = 8

class PasteAnyJobRequest(BaseModel):
    external_url: Optional[str] = Field(default=None, description="Paste any job URL (Greenhouse, LinkedIn, Lever, company site, etc.)")
    raw_jd_text: Optional[str] = Field(default=None, description="Or paste the raw job text from X/Twitter, WhatsApp, or LinkedIn")
    company_name: Optional[str] = Field(default=None, description="Optional: Leave blank and Gemini will auto-detect it")
    role_title: Optional[str] = Field(default=None, description="Optional: Leave blank and Gemini will auto-detect it")
    auto_queue_for_apply: bool = Field(default=True, description="Automatically queue this job for tailoring & auto-application")

@app.get("/health")
def health_check():
    user_ref = get_user_ref()
    user_ref.set({"status": "active", "agent_mode": "95_PERCENT_AUTO"}, merge=True)
    return {"status": "ok", "firestore_connected": True, "tenant": user_ref.id}

# --- PHASE 2: VAULT, ROLES & DAILY LIMIT ENDPOINTS ---

@app.post("/api/vault/seed")
def seed_vault():
    return seed_master_profile()

@app.get("/api/vault")
def read_vault():
    return get_master_profile()

@app.get("/api/scout/preferences")
def read_scout_preferences():
    return get_scout_preferences()

@app.post("/api/scout/preferences/roles")
def set_custom_target_roles(req: UpdateRolesRequest):
    return update_target_roles(req.target_role_titles, req.preferred_locations)

@app.patch("/api/scout/preferences/limit")
def set_daily_apply_limit(req: UpdateDailyLimitRequest):
    """Edit the daily application limit (Default is 10 jobs/day)."""
    return update_daily_apply_limit(req.daily_apply_limit)

@app.get("/api/scout/quota")
def read_daily_quota():
    """Returns today's application count vs. your daily_apply_limit (Default: 10)."""
    return get_daily_quota_status()

@app.post("/api/vault/upload-cv")
async def upload_base_cv(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    pdf_bytes = await file.read()
    parsed = parse_uploaded_cv_into_vault(pdf_bytes)
    return {"status": "parsed_and_saved", "profile": parsed}

@app.post("/api/vault/test-pdf")
async def test_compile_pdf(
    custom_role_title: str = Query(
        default="AI Frontend Engineer (Next.js / TypeScript)",
        description="Type ANY role title here to dynamically tailor and compile a matching PDF CV"
    )
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
    return await run_scout_discovery(
        custom_roles_override=req.custom_roles_override,
        max_jobs_to_score=req.max_jobs_to_score,
    )

@app.post("/api/scout/paste-job")
async def paste_any_job_to_apply(req: PasteAnyJobRequest):
    """Paste any job URL or raw JD text from anywhere online to auto-extract, score, and queue for application."""
    try:
        return await paste_and_ingest_job(
            external_url=req.external_url,
            raw_jd_text=req.raw_jd_text,
            company_name=req.company_name,
            role_title=req.role_title,
            auto_queue_for_apply=req.auto_queue_for_apply,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/jobs")
def get_jobs(status: Optional[JobStatus] = Query(default=None)):
    return list_discovered_jobs(status_filter=status)