from enum import Enum
from typing import List, Dict, Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field

# --- ENUMS ---

class JobStatus(str, Enum):
    DISCOVERED = "DISCOVERED"
    ARCHIVED_LOW_MATCH = "ARCHIVED_LOW_MATCH"
    TAILORING_IN_PROGRESS = "TAILORING_IN_PROGRESS"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    SKIPPED = "SKIPPED"
    APPLYING_QUEUED = "APPLYING_QUEUED"
    APPLYING_ACTIVE = "APPLYING_ACTIVE"
    WAITING_FOR_OTP = "WAITING_FOR_OTP"
    FAILED_NEEDS_MANUAL = "FAILED_NEEDS_MANUAL"
    APPLIED = "APPLIED"
    REPLIED_REJECTED = "REPLIED_REJECTED"
    INTERVIEW_INVITE = "INTERVIEW_INVITE"
    OFFER_STAGE = "OFFER_STAGE"

class ATSPlatform(str, Enum):
    GREENHOUSE = "greenhouse"
    LEVER = "lever"
    ASHBY = "ashby"
    WORKABLE = "workable"
    BREEZY = "breezy"
    SMARTRECRUITERS = "smartrecruiters"
    RECRUITEE = "recruitee"
    BAMBOOHR = "bamboohr"
    RIPPLING = "rippling"
    DOVER = "dover"
    WELLFOUND = "wellfound"
    LINKEDIN = "linkedin"
    INDEED = "indeed"
    EMAIL_APPLY = "email_apply"    # For social media posts ("Send CV to founders@...")
    CUSTOM = "custom"

# --- 0. DYNAMIC TARGET ROLES, PLATFORMS & DAILY LIMIT PREFERENCES ---

class TargetRoleConfig(BaseModel):
    id: str
    title: str                     # e.g. "AI Frontend Engineer", "Flutter Developer", "Next.js Engineer"
    active: bool = True
    priority_keywords: List[str] = Field(default_factory=list)

class ScoutPreferences(BaseModel):
    user_id: str
    target_roles: List[TargetRoleConfig]
    preferred_locations: List[str] = Field(
        default_factory=lambda: ["Remote", "Anywhere", "Lagos, Nigeria", "EMEA"]
    )
    excluded_keywords: List[str] = Field(
        default_factory=lambda: ["US Citizens Only", "Security Clearance", "On-site Only US"]
    )
    min_match_score: int = Field(default=75, ge=0, le=100)
    daily_apply_limit: int = Field(
        default=10,
        ge=1,
        le=200,
        description="Maximum number of jobs the agent is allowed to apply for per day (Default: 10, editable).",
    )
    target_ats_domains: List[str] = Field(
        default_factory=lambda: [
            "boards.greenhouse.io",
            "job-boards.greenhouse.io",
            "jobs.lever.co",
            "jobs.ashbyhq.com",
            "apply.workable.com",
            "breezy.hr",
            "jobs.smartrecruiters.com",
            "recruitee.com",
            "bamboohr.com",
            "ats.rippling.com",
            "app.dover.com",
            "wellfound.com",
            "ycombinator.com/jobs",
        ]
    )
    custom_job_domains: List[str] = Field(
        default_factory=lambda: [
            "jobberman.com",
            "myjobmag.com",
        ],
        description="Add any local or niche job board domains you want the Scout to include.",
    )
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# --- 1. MASTER PROFILE VAULT SCHEMA ---

class ExperienceItem(BaseModel):
    id: str
    company: str
    role_title: str
    location: str
    start_date: str
    end_date: str  # Or "Present"
    role_tags: List[str]           # Flexible tags e.g. ["Frontend", "AI", "Mobile", "Full-Stack"]
    verified_bullets: List[str]
    tech_used: List[str]

class ProjectItem(BaseModel):
    id: str
    name: str
    role: str
    live_url: Optional[str] = None
    github_url: Optional[str] = None
    role_tags: List[str]           # Flexible tags e.g. ["AI", "Frontend", "Flutter", "Voice AI"]
    tech_stack: List[str]
    verified_bullets: List[str]
    awards_or_metrics: Optional[str] = None

class EducationItem(BaseModel):
    institution: str
    degree: str
    location: str
    dates: str

class MasterProfile(BaseModel):
    user_id: str
    full_name: str
    email: str
    phone: str
    location: str
    portfolio_url: Optional[str] = None
    github_url: str
    linkedin_url: str
    summary_template: str = ""     # Your base CV summary style
    experiences: List[ExperienceItem]
    projects: List[ProjectItem]
    education: List[EducationItem] = Field(
        default_factory=lambda: [
            EducationItem(
                institution="Lagos State University of Science and Technology (LASUSTECH)",
                degree="B.Sc. in Computer Science",
                location="Lagos, Nigeria",
                dates="In Progress",
            )
        ]
    )
    skills_by_category: Dict[str, List[str]]
    application_defaults: Dict[str, str] = Field(
        default_factory=lambda: {
            "notice_period": "Immediate / 2 Weeks",
            "work_authorization": "Authorized",
            "requires_sponsorship": "No",
        }
    )
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# --- 2. JOB RECORD SCHEMA ---

class JobRecord(BaseModel):
    id: str
    user_id: str
    external_url: str
    dedup_hash: str
    company_name: str
    role_title: str
    matched_target_role: str       # Stores which of your selected target roles matched this JD
    ats_platform: ATSPlatform
    location_type: str = "REMOTE"
    raw_jd_text: str
    match_score: int = Field(default=0, ge=0, le=100)
    match_reasoning: Optional[str] = None
    status: JobStatus = JobStatus.DISCOVERED
    discovered_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    applied_at: Optional[datetime] = None

# --- 3. TAILORED PACKAGE SCHEMA ---

class TailoredPackage(BaseModel):
    job_id: str
    user_id: str
    target_role_headline: str      # Dynamic headline printed at the top of the CV PDF
    tailored_summary: str
    selected_experiences: List[ExperienceItem]
    selected_projects: List[ProjectItem]
    critic_score: int = Field(default=0, ge=0, le=100)
    critic_feedback: Optional[str] = None
    cv_pdf_url: Optional[str] = None
    cover_letter_text: Optional[str] = None
    screening_answers: Dict[str, str] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# --- 4. EXECUTION & OTP RELAY SCHEMA ---

class ExecutionLog(BaseModel):
    job_id: str
    state: str  # NAVIGATING, FILLING_FORM, WAITING_FOR_OTP, SUBMITTED, ERROR
    step_message: str
    otp_required: bool = False
    otp_code_input: Optional[str] = None
    screenshot_url: Optional[str] = None
    error_message: Optional[str] = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))