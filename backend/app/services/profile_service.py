import os
import io
import uuid
from datetime import datetime, timezone
from typing import List, Any
from pypdf import PdfReader
from google import genai
from google.genai import types
from app.core.firebase import get_user_ref
from app.models.schemas import (
    MasterProfile,
    ExperienceItem,
    ProjectItem,
    EducationItem,
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

# --- TARGET ROLES & SCOUT PREFERENCES ---

def get_default_scout_preferences(user_id: str = "joshua_master_tenant") -> ScoutPreferences:
    return ScoutPreferences(
        user_id=user_id,
        target_roles=[
            TargetRoleConfig(
                id="role_frontend_react",
                title="Frontend Engineer (React / Next.js)",
                active=True,
                priority_keywords=["React", "Next.js", "TypeScript", "Tailwind CSS"],
            ),
            TargetRoleConfig(
                id="role_ai_frontend",
                title="AI Frontend Engineer",
                active=True,
                priority_keywords=["Next.js", "AI SDK", "LLM", "TypeScript", "Agentic UI"],
            ),
            TargetRoleConfig(
                id="role_flutter_mobile",
                title="Flutter Mobile Developer",
                active=True,
                priority_keywords=["Flutter", "Dart", "Mobile", "iOS", "Android"],
            ),
        ],
    )

def get_scout_preferences(user_id: str | None = None) -> dict:
    user_ref = get_user_ref(user_id)
    doc_ref = user_ref.collection("vault").document("scout_preferences")
    snap = doc_ref.get()
    if not snap.exists:
        prefs = get_default_scout_preferences(user_ref.id).model_dump(mode="json")
        doc_ref.set(prefs)
        return prefs
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

def get_default_master_profile(user_id: str = "joshua_master_tenant") -> MasterProfile:
    """Returns the verified Master Profile Vault with zero long dashes and concrete facts."""
    return MasterProfile(
        user_id=user_id,
        full_name="Joshua Onyeka Ituma",
        email="joshua@boukartech.com",
        phone="+234 000 000 0000",
        location="Lagos, Nigeria (Open to Remote)",
        portfolio_url="https://boukartech.com",
        github_url="https://github.com/BoukarTech",
        linkedin_url="https://linkedin.com/in/joshua-ituma",
        summary_template=(
            "Software Engineer specializing in React, Next.js, TypeScript, and Flutter. "
            "Experienced in building production web platforms, cross-platform mobile apps, and AI-driven interfaces."
        ),
        experiences=[
            ExperienceItem(
                id="exp_boukartech",
                company="BoukarTech Solutions Ltd",
                role_title="Lead Web Developer & Team Lead",
                location="Lagos, Nigeria",
                start_date="Feb 2026",
                end_date="Present",
                role_tags=["Frontend", "React", "Next.js", "AI", "Flutter", "Mobile", "Full-Stack", "Team Lead"],
                verified_bullets=[
                    "Architected and shipped responsive web applications and mobile software using Next.js (App Router), React, TypeScript, Tailwind CSS, and Flutter.",
                    "Led engineering execution across client projects, establishing reusable Figma-to-code component libraries and state management patterns.",
                    "Integrated LLM workflows and structured AI responses into web applications using the Vercel AI SDK, Gemini API, and Supabase.",
                ],
                tech_used=["Next.js", "React", "TypeScript", "Tailwind CSS", "Flutter", "Dart", "Supabase", "Vercel AI SDK"],
            ),
            ExperienceItem(
                id="exp_cavista",
                company="Cavista Technologies",
                role_title="Software Engineering Intern",
                location="Ilupeju, Lagos",
                start_date="Jul 2026",
                end_date="Aug 2026",
                role_tags=["Frontend", "Software Engineer", "React", "Full-Stack"],
                verified_bullets=[
                    "Contributed to enterprise software modules within agile engineering teams, focusing on frontend state management and REST API integration.",
                    "Participated in code reviews, debugging sessions, and performance profiling to maintain production code quality.",
                ],
                tech_used=["React", "TypeScript", "REST APIs", "Git"],
            ),
            ExperienceItem(
                id="exp_siwes_lcda",
                company="Igbogbo Bayeku LCDA (ICT Unit)",
                role_title="Software & ICT Industrial Trainee (SIWES)",
                location="Ikorodu, Lagos",
                start_date="Aug 2025",
                end_date="Nov 2025",
                role_tags=["Frontend", "Web Developer", "ICT"],
                verified_bullets=[
                    "Completed a 12-week industrial training placement supporting local government ICT operations, system diagnostics, and internal web utilities.",
                ],
                tech_used=["Web Development", "IT Support", "System Diagnostics"],
            ),
            ExperienceItem(
                id="exp_sidehustle",
                company="SideHustle",
                role_title="Frontend Development Intern",
                location="Remote",
                start_date="Apr 2023",
                end_date="May 2023",
                role_tags=["Frontend", "React", "UI Engineer"],
                verified_bullets=[
                    "Translated Figma UI/UX wireframes into responsive, cross-browser web pages using React, JavaScript, HTML5, and CSS3.",
                ],
                tech_used=["React", "JavaScript", "HTML5", "CSS3", "Figma"],
            ),
        ],
        projects=[
            ProjectItem(
                id="proj_areahustle",
                name="AreaHustle: Voice-First AI Job Marketplace",
                role="Lead Full-Stack & AI Engineer",
                role_tags=["AI", "Frontend", "Next.js", "Voice AI", "Full-Stack"],
                tech_stack=["Next.js", "TypeScript", "Gemini API", "Tailwind CSS", "Supabase"],
                verified_bullets=[
                    "Built a voice-first job marketplace and financial identity platform connecting informal workers to verified jobs via natural speech.",
                    "Implemented multilingual audio transcription and automated skill-matching pipelines.",
                ],
                awards_or_metrics="1st Place Winner at YPIT Artificial Future Summit (Lagos, June 2026)",
            ),
            ProjectItem(
                id="proj_resolveai",
                name="ResolveAI: Autonomous Payment Dispute Agent",
                role="Lead AI Frontend Engineer",
                role_tags=["AI", "Frontend", "Next.js", "Agentic", "Fintech"],
                tech_stack=["Next.js", "TypeScript", "Vercel AI SDK", "Tailwind CSS"],
                verified_bullets=[
                    "Built an autonomous payment operations dashboard that parses transaction logs, evaluates dispute evidence, and executes resolution workflows.",
                ],
                awards_or_metrics="Airwallex Agentic Banking Hackathon Entry (Oct 2026)",
            ),
            ProjectItem(
                id="proj_swapdesk",
                name="SwapDesk: Autonomous E-Commerce Returns State Machine",
                role="Lead Engineer",
                role_tags=["AI", "Frontend", "Next.js", "State Machines", "Full-Stack"],
                tech_stack=["Next.js", "TypeScript", "State Machines", "Neatlogs", "EntireHQ", "AriTheCFO"],
                verified_bullets=[
                    "Engineered an automated e-commerce returns state machine integrated with @neatlogs for telemetry and @arithecfo for financial reconciliation.",
                ],
                awards_or_metrics="Built for #neatHack (Oct 2026)",
            ),
            ProjectItem(
                id="proj_vitaltag",
                name="VITAL-TAG: Edge-AI Livestock Health Monitoring Platform",
                role="Lead Web & AI Engineer",
                role_tags=["AI", "Frontend", "React", "Next.js", "IoT"],
                tech_stack=["React", "Next.js", "Edge AI", "IoT Telemetry", "Tailwind CSS"],
                verified_bullets=[
                    "Created a real-time web dashboard paired with Edge-AI livestock biometric tags to detect early health anomalies.",
                ],
                awards_or_metrics="1st Place Winner (Gbagada Phase) at Red Bull Basement Nigeria 2026",
            ),
            ProjectItem(
                id="proj_vitalink",
                name="Vitalink: Remote Patient Monitoring & Multilingual AI System",
                role="Co-Creator & Lead Frontend/Mobile Developer",
                role_tags=["Flutter", "Mobile", "Frontend", "AI", "Next.js"],
                tech_stack=["Flutter", "Dart", "Next.js", "TypeScript", "REST APIs"],
                verified_bullets=[
                    "Developed cross-platform Flutter mobile apps and Next.js web dashboards for real-time patient vital tracking and multilingual AI triage.",
                ],
                awards_or_metrics="1st Place at Cavista Hackathon 2025 & 1st Place at CODEFEST NIGHACK UNILAG (Nov 2025)",
            ),
            ProjectItem(
                id="proj_devassist",
                name="DevAssist: AI-Powered IDE & Low-Code Platform",
                role="Frontend & AI Integration Lead",
                role_tags=["AI", "Frontend", "React", "Next.js", "Developer Tools"],
                tech_stack=["React", "Next.js", "TypeScript", "LLM APIs", "Tailwind CSS"],
                verified_bullets=[
                    "Built an interactive web-based AI code editor and component generator to speed up frontend scaffolding and debugging.",
                ],
                awards_or_metrics="1st Place Winner at Aipreneur 2025 Hackathon by Remo Start",
            ),
        ],
        education=[
            EducationItem(
                institution="Lagos State University of Science and Technology (LASUSTECH)",
                degree="B.Sc. in Computer Science",
                location="Ikorodu, Lagos",
                dates="2023 - Present",
            )
        ],
        skills_by_category={
            "Frontend Web": [
                "React.js", "Next.js (App Router)", "TypeScript", "JavaScript (ES6+)",
                "Tailwind CSS", "HTML5 & CSS3", "Figma UI/UX", "State Management"
            ],
            "AI Engineering": [
                "Vercel AI SDK", "Google Gemini API", "Agentic Workflows",
                "Structured JSON Outputs", "Voice-First AI UIs", "Prompt Engineering"
            ],
            "Mobile Development": [
                "Flutter", "Dart", "Cross-Platform Mobile UI",
                "REST API Integration", "Offline-First Architecture"
            ],
            "Backend & Tooling": [
                "Supabase (PostgreSQL)", "Firebase (Firestore & Storage)", "Python (FastAPI)",
                "Playwright", "Git & GitHub", "pnpm"
            ]
        },
    )

def seed_master_profile(user_id: str | None = None) -> dict:
    user_ref = get_user_ref(user_id)
    profile = clean_no_em_dash(get_default_master_profile(user_ref.id).model_dump(mode="json"))
    prefs = clean_no_em_dash(get_default_scout_preferences(user_ref.id).model_dump(mode="json"))
    user_ref.collection("vault").document("master_profile").set(profile)
    user_ref.collection("vault").document("scout_preferences").set(prefs)
    return {"profile": profile, "scout_preferences": prefs}

def get_master_profile(user_id: str | None = None) -> dict:
    user_ref = get_user_ref(user_id)
    doc_ref = user_ref.collection("vault").document("master_profile")
    snap = doc_ref.get()
    if not snap.exists:
        return seed_master_profile(user_id)["profile"]
    return clean_no_em_dash(snap.to_dict())

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

    UPLOADED CV TEXT:
    {raw_text}
    """

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=MasterProfile,
            temperature=0.0,  # Locked to 0.0 for deterministic, factual extraction
        ),
    )

    parsed_profile = MasterProfile.model_validate_json(response.text)
    user_ref = get_user_ref(user_id)
    parsed_profile.user_id = user_ref.id

    # Run deterministic sanitizer to guarantee zero em-dashes or en-dashes
    clean_payload = clean_no_em_dash(parsed_profile.model_dump(mode="json"))
    user_ref.collection("vault").document("master_profile").set(clean_payload)
    return clean_payload