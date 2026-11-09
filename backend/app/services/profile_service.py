import json
import os
import io
import re
import uuid
from datetime import datetime, timezone
from typing import Any, List
from pypdf import PdfReader
from google import genai
from google.genai import types
from app.core.database import get_user_ref
from app.models.schemas import (
    MasterProfile,
    ScoutPreferences,
    TargetRoleConfig,
)

def clean_no_em_dash(value: Any) -> Any:
    """Recursively strips AI-tell long dashes (— and –) from strings, lists, and dicts."""
    if isinstance(value, str):
        # Replace spaced em/en dashes with a clean hyphen or colon, and unspaced ones with a hyphen
        text = value.replace(" — ", " - ").replace(" – ", " - ")
        text = text.replace("—", "-").replace("–", "-")
        return " ".join(text.split())
    if isinstance(value, list):
        return [clean_no_em_dash(item) for item in value]
    if isinstance(value, dict):
        return {k: clean_no_em_dash(v) for k, v in value.items()}
    return value

def _normalize_cv_profile_payload(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload

    experiences = payload.get("experiences")
    for experience in experiences if isinstance(experiences, list) else []:
        if not isinstance(experience, dict):
            continue
        technologies = experience.get("tech_used")
        if isinstance(technologies, str):
            experience["tech_used"] = [item.strip() for item in re.split(r"[,\n]", technologies) if item.strip()]

    projects = payload.get("projects")
    for project in projects if isinstance(projects, list) else []:
        if not isinstance(project, dict):
            continue
        technologies = project.get("tech_stack")
        if isinstance(technologies, str):
            project["tech_stack"] = [item.strip() for item in re.split(r"[,\n]", technologies) if item.strip()]

        awards_or_metrics = project.get("awards_or_metrics")
        if isinstance(awards_or_metrics, list) and all(isinstance(item, str) for item in awards_or_metrics):
            project["awards_or_metrics"] = "\n".join(item for item in awards_or_metrics if item.strip()) or None

    return payload

def has_verified_profile_content(profile: MasterProfile) -> bool:
    has_experience = any(
        item.company.strip()
        and item.role_title.strip()
        and any(bullet.strip() for bullet in item.verified_bullets)
        for item in profile.experiences
    )
    has_project = any(
        item.name.strip()
        and any(bullet.strip() for bullet in item.verified_bullets)
        for item in profile.projects
    )
    has_skills = any(any(skill.strip() for skill in skills) for skills in profile.skills_by_category.values())
    return bool(profile.full_name.strip() and profile.email.strip() and (has_experience or has_project or has_skills))

# --- TARGET ROLES & SCOUT PREFERENCES ---

def get_default_scout_preferences(user_id: str) -> ScoutPreferences:
    return ScoutPreferences(
        user_id=user_id,
    )

def get_scout_preferences(user_id: str | None = None) -> dict:
    user_ref = get_user_ref(user_id)
    doc_ref = user_ref.collection("vault").document("scout_preferences")
    snap = doc_ref.get()
    if not snap.exists:
        return get_default_scout_preferences(user_ref.id).model_dump(mode="json")
    return snap.to_dict()

def update_target_roles(role_titles: List[str], preferred_locations: List[str] | None = None, user_id: str | None = None) -> dict:
    user_ref = get_user_ref(user_id)
    current = ScoutPreferences.model_validate(get_scout_preferences(user_id))

    new_roles = [
        TargetRoleConfig(
            id=f"role_{uuid.uuid4().hex[:6]}",
            title=clean_no_em_dash(title.strip()),
            active=True,
            priority_keywords=[],
        )
        for title in role_titles if title.strip()
    ]
    current.target_roles = new_roles
    if preferred_locations is not None:
        current.preferred_locations = preferred_locations
    current.updated_at = datetime.now(timezone.utc)

    payload = current.model_dump(mode="json")
    user_ref.collection("vault").document("scout_preferences").set(payload)
    return payload

def update_daily_apply_limit(new_limit: int, user_id: str | None = None) -> dict:
    """Updates the maximum number of jobs the agent can apply to per day (default: 10)."""
    if new_limit < 1 or new_limit > 200:
        raise ValueError("daily_apply_limit must be between 1 and 200.")
    user_ref = get_user_ref(user_id)
    current = ScoutPreferences.model_validate(get_scout_preferences(user_id))
    current.daily_apply_limit = new_limit
    current.updated_at = datetime.now(timezone.utc)

    payload = current.model_dump(mode="json")
    user_ref.collection("vault").document("scout_preferences").set(payload)
    return payload

def get_daily_quota_status(user_id: str | None = None) -> dict:
    """Checks how many jobs have been applied to today (UTC) vs. the user's daily_apply_limit."""
    user_ref = get_user_ref(user_id)
    prefs = ScoutPreferences.model_validate(get_scout_preferences(user_id))
    daily_limit = prefs.daily_apply_limit

    now_utc = datetime.now(timezone.utc)
    start_of_day = datetime(now_utc.year, now_utc.month, now_utc.day, tzinfo=timezone.utc)
    start_iso = start_of_day.isoformat()

    # Count jobs marked APPLIED today
    applied_docs = (
        user_ref.collection("jobs")
        .where("status", "==", "APPLIED")
        .stream()
    )
    applied_today = 0
    for doc in applied_docs:
        d = doc.to_dict()
        applied_at_str = str(d.get("applied_at") or "")
        if applied_at_str >= start_iso[:10]:  # Matches YYYY-MM-DD
            applied_today += 1

    remaining = max(0, daily_limit - applied_today)
    return {
        "date": start_iso[:10],
        "daily_apply_limit": daily_limit,
        "applied_today": applied_today,
        "remaining_today": remaining,
        "can_apply_more_today": remaining > 0,
    }

# --- MASTER PROFILE VAULT ---

def get_master_profile(user_id: str | None = None) -> dict:
    user_ref = get_user_ref(user_id)
    doc_ref = user_ref.collection("vault").document("master_profile")
    snap = doc_ref.get()
    if not snap.exists:
        return MasterProfile(user_id=user_ref.id).model_dump(mode="json")
    return clean_no_em_dash(snap.to_dict())

def save_master_profile(profile: MasterProfile, user_id: str | None = None) -> dict:
    user_ref = get_user_ref(user_id)
    profile.user_id = user_ref.id
    profile.is_onboarded = has_verified_profile_content(profile)
    payload = clean_no_em_dash(profile.model_dump(mode="json"))
    user_ref.collection("vault").document("master_profile").set(payload)
    return payload

def save_scout_preferences(preferences: ScoutPreferences, user_id: str | None = None) -> dict:
    user_ref = get_user_ref(user_id)
    preferences.user_id = user_ref.id
    preferences.updated_at = datetime.now(timezone.utc)
    payload = clean_no_em_dash(preferences.model_dump(mode="json"))
    user_ref.collection("vault").document("scout_preferences").set(payload)
    return payload

def parse_uploaded_cv_into_vault(pdf_bytes: bytes, user_id: str | None = None) -> dict:
    """
    Extracts an uploaded PDF CV into the MasterProfile schema with ZERO hallucination,
    ZERO ambiguity, and ZERO long dashes (— or –).
    """
    reader = PdfReader(io.BytesIO(pdf_bytes))
    raw_text = "\n".join(page.extract_text() or "" for page in reader.pages)

    if not raw_text.strip():
        raise ValueError("Could not extract readable text from the uploaded PDF.")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "your_gemini_api_key_here":
        raise ValueError("Please set a valid GEMINI_API_KEY in backend/.env to parse uploaded PDFs.")

    client = genai.Client(api_key=api_key)
    prompt = f"""
    You are a strict, zero-hallucination CV parser. Your job is to convert the user's uploaded CV text
    into the structured MasterProfile JSON schema so it can be used as a clean template.

    STRICT RULES:
    1. ZERO HALLUCINATION: Extract ONLY companies, role titles, dates, projects, metrics, education, and skills explicitly written in the CV text. Never invent or assume anything.
    2. ZERO AMBIGUITY: Keep every bullet point concrete, specific, and direct. Preserve exact numbers, tools, and outcomes from the original CV. Do not use vague buzzwords.
    3. NO LONG DASHES: Never use the em-dash (—) or en-dash (–) anywhere. Use standard hyphens (-) or colons (:) only.
    4. ROLE TAGS: Tag each experience and project with accurate role_tags (e.g., ["Frontend", "React", "Next.js", "AI", "Flutter", "Mobile"]) based strictly on the technologies used in that item.
    5. OUTPUT: Return only a valid JSON object matching MasterProfile. Include these fields: user_id, full_name, email, phone, location, portfolio_url, github_url, linkedin_url, summary_template, experiences, projects, education, skills_by_category, application_defaults, and is_onboarded. Keep user_id empty and is_onboarded false; omit updated_at so the application can supply its default timestamp.
       Each experience must include id, company, role_title, location, start_date, end_date, role_tags, verified_bullets, and tech_used.
       Each project must include id, name, role, live_url, github_url, role_tags, tech_stack, verified_bullets, and awards_or_metrics.
       Each education item must include institution, degree, location, and dates.
       role_tags, verified_bullets, tech_used, and tech_stack must always be JSON arrays of strings, never comma-separated strings. awards_or_metrics must be a single string or null, never an array.
       Use empty strings, empty lists, or empty objects for information not present in the CV. Use null for unknown optional URLs or metrics.

    UPLOADED CV TEXT:
    {raw_text}
    """

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0,  # Locked to 0.0 for deterministic, factual extraction
        ),
    )

    if not response.text:
        raise ValueError("The CV parser returned an empty response. Please try uploading the PDF again.")

    try:
        response_payload = json.loads(response.text)
    except json.JSONDecodeError as error:
        raise ValueError("The CV parser returned invalid JSON. Please try uploading the PDF again.") from error

    parsed_profile = MasterProfile.model_validate(_normalize_cv_profile_payload(response_payload))
    user_ref = get_user_ref(user_id)
    parsed_profile.user_id = user_ref.id
    parsed_profile.is_onboarded = has_verified_profile_content(parsed_profile)

    # Run deterministic sanitizer to guarantee zero em-dashes or en-dashes
    clean_payload = clean_no_em_dash(parsed_profile.model_dump(mode="json"))
    user_ref.collection("vault").document("master_profile").set(clean_payload)
    return clean_payload


def initialize_blank_user_vault(user_id: str) -> dict:
    user_ref = get_user_ref(user_id)
    profile_ref = user_ref.collection("vault").document("master_profile")
    preferences_ref = user_ref.collection("vault").document("scout_preferences")

    if not profile_ref.get().exists:
        profile_ref.set(MasterProfile(user_id=user_id).model_dump(mode="json"))
    if not preferences_ref.get().exists:
        preferences_ref.set(get_default_scout_preferences(user_id).model_dump(mode="json"))

    return {
        "profile": get_master_profile(user_id),
        "scout_preferences": get_scout_preferences(user_id),
    }


def reset_user_workspace_to_blank(user_id: str) -> dict:
    user_ref = get_user_ref(user_id)
    for collection_name in (
        "vault",
        "jobs",
        "tailored_packages",
        "execution_logs",
        "email_events",
        "activity_stream",
    ):
        user_ref.collection(collection_name).delete()
    return initialize_blank_user_vault(user_id)