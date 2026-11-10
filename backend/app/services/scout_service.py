import os
import re
import sys
import uuid
import asyncio
import hashlib
from collections import defaultdict
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
from datetime import datetime, timezone
from typing import List, Optional
import httpx
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

from app.core.database import get_user_ref
from app.models.schemas import (
    JobRecord,
    JobStatus,
    ATSPlatform,
    ScoutPreferences,
    MasterProfile,
)
from app.services.profile_service import (
    get_master_profile,
    get_scout_preferences,
    get_daily_quota_status,
    clean_no_em_dash,
)

# --- 1. URL NORMALIZATION & EXPANDED PLATFORM DETECTION ---

TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "gh_src", "gh_jid", "ref", "source", "fbclid", "gclid", "mc_cid",
}

def normalize_job_url(url: str) -> str:
    parsed = urlparse(url.strip())
    clean_query = urlencode(
        [(k, v) for k, v in parse_qsl(parsed.query) if k.lower() not in TRACKING_PARAMS]
    )
    clean_path = parsed.path.rstrip("/")
    return urlunparse((parsed.scheme, parsed.netloc.lower(), clean_path, "", clean_query, ""))

def compute_dedup_hash(company: str, role_title: str) -> str:
    norm_co = re.sub(r"[^a-z0-9]", "", company.lower())
    norm_role = re.sub(r"[^a-z0-9]", "", role_title.lower())
    raw = f"{norm_co}::{norm_role}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]

def detect_ats_platform(url: str) -> ATSPlatform:
    if not url:
        return ATSPlatform.CUSTOM
    if url.startswith("mailto:"):
        return ATSPlatform.EMAIL_APPLY
    host = urlparse(url).netloc.lower()
    mapping = {
        "greenhouse.io": ATSPlatform.GREENHOUSE,
        "lever.co": ATSPlatform.LEVER,
        "ashbyhq.com": ATSPlatform.ASHBY,
        "workable.com": ATSPlatform.WORKABLE,
        "breezy.hr": ATSPlatform.BREEZY,
        "smartrecruiters.com": ATSPlatform.SMARTRECRUITERS,
        "recruitee.com": ATSPlatform.RECRUITEE,
        "bamboohr.com": ATSPlatform.BAMBOOHR,
        "rippling.com": ATSPlatform.RIPPLING,
        "dover.com": ATSPlatform.DOVER,
        "wellfound.com": ATSPlatform.WELLFOUND,
        "linkedin.com": ATSPlatform.LINKEDIN,
        "indeed.com": ATSPlatform.INDEED,
    }
    for domain_key, enum_val in mapping.items():
        if domain_key in host:
            return enum_val
    return ATSPlatform.CUSTOM

def clean_html_to_text(html_or_text: str) -> str:
    if "<" in html_or_text and ">" in html_or_text:
        soup = BeautifulSoup(html_or_text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
            tag.decompose()
        text = soup.get_text(separator="\n")
    else:
        text = html_or_text
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines)[:12000]

def _scrape_url_with_playwright_sync(url: str) -> str:
    """Fallback scraper using Playwright for JS-rendered job pages (Ashby, Dover, Workable, etc.)."""
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(1500)
        content = page.content()
        browser.close()
        return clean_html_to_text(content)

async def fetch_job_page_text(url: str) -> str:
    """Fetches a job URL via fast HTTP first, falling back to headless Playwright if JS-rendered."""
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            text = clean_html_to_text(resp.text)
            if len(text) > 250:
                return text
    except Exception:
        pass
    # Fallback to Playwright for SPA job boards
    try:
        return await asyncio.to_thread(_scrape_url_with_playwright_sync, url)
    except Exception as e:
        return f"Job URL: {url} (Scrape note: {str(e)[:80]})"

# --- 2. GEMINI 2.5 FLASH MATCH SCORER & METADATA EXTRACTOR ---

class JDMatchEvaluation(BaseModel):
    extracted_company_name: str = Field(description="Company name extracted from the job post.")
    extracted_role_title: str = Field(description="Job title extracted from the job post.")
    match_score: int = Field(ge=0, le=100)
    matched_target_role: str
    location_type: str = Field(description="REMOTE, HYBRID, or ONSITE")
    has_hard_blocker: bool = Field(
        description="True ONLY if the JD explicitly requires US/EU/UK citizenship, security clearance, or strict onsite presence outside Nigeria."
    )
    blocker_reason: Optional[str] = None
    match_reasoning: str = Field(
        description="2 concise sentences explaining why this role matches the candidate's stack. No em-dashes."
    )

def score_job_with_gemini(
    company: str,
    role_title: str,
    jd_text: str,
    profile: MasterProfile,
    prefs: ScoutPreferences,
) -> JDMatchEvaluation:
    provided_company = "" if company == "AUTO_DETECT" else company
    provided_role = "" if role_title == "AUTO_DETECT" else role_title
    active_roles = [r.title for r in prefs.target_roles if r.active]
    if not active_roles:
        raise ValueError("Configure at least one active target role before scoring jobs.")
    all_skills = [skill for skills in profile.skills_by_category.values() for skill in skills]

    jd_lower = jd_text.lower()
    for exc in prefs.excluded_keywords:
        if exc.lower() in jd_lower:
            return JDMatchEvaluation(
                extracted_company_name=provided_company,
                extracted_role_title=provided_role,
                match_score=15,
                matched_target_role=active_roles[0],
                location_type="UNKNOWN",
                has_hard_blocker=True,
                blocker_reason=f"Triggered excluded keyword: {exc}",
                match_reasoning=f"Archived automatically because the job description contains excluded restriction: {exc}.",
            )

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "your_gemini_api_key_here":
        matched_skills = [s for s in all_skills if s.lower().split()[0] in jd_lower]
        score = min(95, 58 + len(matched_skills) * 6)
        best_role = active_roles[0]
        for r in active_roles:
            if any(w.lower() in (provided_role or jd_text[:200]).lower() for w in r.split() if len(w) > 2):
                best_role = r
                score = min(98, score + 10)
                break
        return JDMatchEvaluation(
            extracted_company_name=provided_company,
            extracted_role_title=provided_role,
            match_score=score,
            matched_target_role=best_role,
            location_type=(
                "REMOTE" if "remote" in jd_lower
                else "HYBRID" if "hybrid" in jd_lower
                else "ONSITE" if any(term in jd_lower for term in ("on-site", "onsite", "on site", "in person"))
                else "UNKNOWN"
            ),
            has_hard_blocker=False,
            match_reasoning=f"Matched {len(matched_skills)} core skills from your Master Vault ({', '.join(matched_skills[:5])}).",
        )

    client = genai.Client(api_key=api_key)
    prompt = f"""
    Analyze this Job Post against the candidate's Master Profile and Active Target Roles.
    If COMPANY or ROLE TITLE are marked 'AUTO_DETECT', extract the real company name and role title from the text.

    CANDIDATE LOCATION: {profile.location}
    ACTIVE TARGET ROLES: {active_roles}
    PREFERRED LOCATIONS: {prefs.preferred_locations}
    ACCEPTED WORK MODES: {prefs.work_modes}
    EXCLUDED KEYWORDS: {prefs.excluded_keywords}
    Match only roles compatible with the user's preferred locations and work modes.
    If no preferred locations or work modes are configured, do not apply a location restriction.
    CANDIDATE SKILLS: {all_skills}

    PROVIDED COMPANY: {company}
    PROVIDED ROLE TITLE: {role_title}
    JOB DESCRIPTION TEXT:
    {jd_text[:6500]}

    STRICT RULES:
    1. Set has_hard_blocker = True ONLY if the job strictly requires residing outside Nigeria without remote flexibility, or requires US/UK citizenship/security clearance.
    2. Score 80-100 if the tech stack overlaps with React, Next.js, TypeScript, AI SDK/LLMs, or Flutter/Dart.
    3. Respect the preferred locations and work modes when evaluating fit.
    4. Never use long em-dashes (—) or en-dashes (–). Use standard hyphens (-) only.
    """

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=JDMatchEvaluation,
                temperature=0.0,
            ),
        )
        result = JDMatchEvaluation.model_validate_json(response.text)
        result.match_reasoning = clean_no_em_dash(result.match_reasoning)
        result.extracted_company_name = clean_no_em_dash(result.extracted_company_name)
        result.extracted_role_title = clean_no_em_dash(result.extracted_role_title)
        return result
    except Exception as exc:
        raise ValueError(f"Could not evaluate this job with the configured matching service: {exc}") from exc

# --- 3. MULTI-PLATFORM DISCOVERY SOURCES ---

async def fetch_from_remotive(role_queries: List[str], limit: int = 6) -> List[dict]:
    """Source 1: Remotive Global Remote Tech Feed."""
    discovered = []
    search_terms = set()
    for rq in role_queries:
        for word in ["frontend", "react", "next", "flutter", "mobile", "ai", "fullstack", "typescript"]:
            if word in rq.lower():
                search_terms.add(word)
    if not search_terms:
        search_terms = {query.strip() for query in role_queries if query.strip()}

    async with httpx.AsyncClient(timeout=15.0) as client:
        for term in list(search_terms)[:3]:
            try:
                resp = await client.get(
                    "https://remotive.com/api/remote-jobs",
                    params={"category": "software-dev", "search": term, "limit": limit},
                )
                if resp.status_code == 200:
                    for j in resp.json().get("jobs", [])[:limit]:
                        company = j.get("company_name", "").strip()
                        title = j.get("title", "").strip()
                        if company and title:
                            discovered.append({
                                "company_name": company,
                                "role_title": title,
                                "external_url": j.get("url", ""),
                                "location_type": f"REMOTE ({j.get('candidate_required_location', '')})".strip(),
                                "raw_jd_text": clean_html_to_text(j.get("description", "")),
                            })
            except Exception:
                continue
    return discovered

async def fetch_from_arbeitnow(role_queries: List[str], limit: int = 6) -> List[dict]:
    """Source 2: Arbeitnow Global Remote & Visa-Sponsoring Tech Feed (Zero API Key)."""
    discovered = []
    keywords = {w.lower() for rq in role_queries for w in rq.replace("/", " ").split() if len(w) > 2}
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get("https://www.arbeitnow.com/api/job-board-api")
            if resp.status_code == 200:
                for j in resp.json().get("data", []):
                    title_low = j.get("title", "").lower()
                    tags_low = " ".join(j.get("tags", [])).lower()
                    if any(k in title_low or k in tags_low for k in keywords):
                        company = j.get("company_name", "").strip()
                        title = j.get("title", "").strip()
                        if not company or not title:
                            continue
                        discovered.append({
                            "company_name": company,
                            "role_title": title,
                            "external_url": j.get("url", ""),
                            "location_type": "REMOTE" if j.get("remote") else j.get("location", "UNKNOWN"),
                            "raw_jd_text": clean_html_to_text(j.get("description", "")),
                        })
                        if len(discovered) >= limit:
                            break
        except Exception:
            pass
    return discovered

async def fetch_from_serper_ats_dorks(
    role_queries: List[str],
    prefs: ScoutPreferences,
    limit_per_role: int = 6,
) -> List[dict]:
    """
    Source 3: Multi-ATS & Custom Domain Search Dorker across 13+ ATS platforms
    (Greenhouse, Lever, Ashby, Workable, Breezy, SmartRecruiters, Recruitee, BambooHR,
    Rippling, Dover, Wellfound, YC, plus any user custom_job_domains like Jobberman).
    """
    serper_key = os.getenv("SERPER_API_KEY")
    if not serper_key:
        return []

    all_domains = prefs.target_ats_domains + prefs.custom_job_domains
    # Split into batches of 6 domains per query so Google search operators stay sharp
    domain_batches = [all_domains[i:i + 6] for i in range(0, len(all_domains), 6)]

    discovered = []
    async with httpx.AsyncClient(timeout=15.0) as client:
        for role in role_queries[:3]:
            for batch in domain_batches[:2]:
                site_clause = " OR ".join(f"site:{d}" for d in batch)
                location_clause = ""
                if prefs.preferred_locations:
                    location_clause = " (" + " OR ".join(f'"{location}"' for location in prefs.preferred_locations) + ")"
                mode_clause = ""
                if prefs.work_modes:
                    mode_clause = " (" + " OR ".join(f'"{mode.lower()}"' for mode in prefs.work_modes) + ")"
                dork_query = f'({site_clause}) "{role}"{location_clause}{mode_clause}'
                try:
                    resp = await client.post(
                        "https://google.serper.dev/search",
                        headers={"X-API-KEY": serper_key, "Content-Type": "application/json"},
                        json={"q": dork_query, "num": limit_per_role, "tbs": "qdr:w"},
                    )
                    if resp.status_code == 200:
                        for item in resp.json().get("organic", []):
                            link = item.get("link", "")
                            title_raw = item.get("title", "")
                            snippet = item.get("snippet", "")
                            if " at " in title_raw:
                                parts = title_raw.split(" at ", 1)
                                r_title, co_name = parts[0].strip(), parts[1].split("-")[0].split("|")[0].strip()
                            elif " - " in title_raw:
                                parts = title_raw.split(" - ", 1)
                                r_title, co_name = parts[0].strip(), parts[1].strip()
                            else:
                                r_title, co_name = title_raw.strip(), ""

                            if not co_name or not r_title:
                                continue
                            discovered.append({
                                "company_name": co_name,
                                "role_title": r_title,
                                "external_url": link,
                                "location_type": "REMOTE",
                                "raw_jd_text": clean_html_to_text(f"{title_raw}\n{snippet}"),
                            })
                except Exception:
                    continue
    return discovered

async def fetch_from_jsearch(
    role_queries: List[str],
    prefs: ScoutPreferences,
    limit_per_role: int = 5,
) -> List[dict]:
    """Source 4: JSearch Aggregator (pulls LinkedIn, Indeed, Glassdoor, ZipRecruiter)."""
    jsearch_key = os.getenv("JSEARCH_API_KEY")
    if not jsearch_key:
        return []

    discovered = []
    async with httpx.AsyncClient(timeout=15.0) as client:
        for role in role_queries[:2]:
            try:
                search_context = " ".join([*prefs.preferred_locations, *prefs.work_modes])
                query = f"{role} {search_context}".strip()
                resp = await client.get(
                    "https://jsearch.p.rapidapi.com/search",
                    headers={
                        "X-RapidAPI-Key": jsearch_key,
                        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
                    },
                    params={"query": query, "page": "1", "num_pages": "1", "date_posted": "week"},
                )
                if resp.status_code == 200:
                    for item in resp.json().get("data", [])[:limit_per_role]:
                        company = item.get("employer_name", "").strip()
                        title = item.get("job_title", "").strip()
                        if not company or not title:
                            continue
                        discovered.append({
                            "company_name": company,
                            "role_title": title,
                            "external_url": item.get("job_apply_link") or item.get("job_google_link", ""),
                            "location_type": "REMOTE" if item.get("job_is_remote") else "UNKNOWN",
                            "raw_jd_text": clean_html_to_text(item.get("job_description", "")),
                        })
            except Exception:
                continue
    return discovered

# --- 4. MAIN SCOUT ORCHESTRATOR & SMART "PASTE ANY JOB" INGESTOR ---

async def run_scout_discovery(
    custom_roles_override: Optional[List[str]] = None,
    max_jobs_to_score: int = 10,
    user_id: Optional[str] = None,
) -> dict:
    user_ref = get_user_ref(user_id)
    profile = MasterProfile.model_validate(get_master_profile(user_id))
    prefs = ScoutPreferences.model_validate(get_scout_preferences(user_id))
    quota = get_daily_quota_status(user_id)

    active_role_titles = (
        [clean_no_em_dash(r) for r in custom_roles_override if r.strip()]
        if custom_roles_override
        else [r.title for r in prefs.target_roles if r.active]
    )
    if not active_role_titles:
        raise ValueError("Configure at least one active target role before running the Scout.")

    jobs_col = user_ref.collection("jobs")
    existing_hashes = set()
    existing_urls = set()
    for doc in jobs_col.stream():
        d = doc.to_dict()
        if d.get("dedup_hash"):
            existing_hashes.add(d["dedup_hash"])
        if d.get("external_url"):
            existing_urls.add(d["external_url"])

    raw_candidates = []
    raw_candidates.extend(await fetch_from_serper_ats_dorks(active_role_titles, prefs))
    raw_candidates.extend(await fetch_from_jsearch(active_role_titles, prefs))
    raw_candidates.extend(await fetch_from_remotive(active_role_titles, limit=max_jobs_to_score))
    raw_candidates.extend(await fetch_from_arbeitnow(active_role_titles, limit=max_jobs_to_score))

    saved_jobs = []
    archived_low_or_blocked = []
    skipped_duplicates = 0

    for cand in raw_candidates:
        if len(saved_jobs) + len(archived_low_or_blocked) >= max_jobs_to_score:
            break

        raw_url = cand.get("external_url", "")
        if not raw_url:
            continue

        norm_url = normalize_job_url(raw_url)
        co_name = clean_no_em_dash(cand["company_name"])
        r_title = clean_no_em_dash(cand["role_title"])
        d_hash = compute_dedup_hash(co_name, r_title)

        if d_hash in existing_hashes or norm_url in existing_urls:
            skipped_duplicates += 1
            continue

        existing_hashes.add(d_hash)
        existing_urls.add(norm_url)

        evaluation = score_job_with_gemini(
            company=co_name,
            role_title=r_title,
            jd_text=cand["raw_jd_text"],
            profile=profile,
            prefs=prefs,
        )

        initial_status = (
            JobStatus.ARCHIVED_LOW_MATCH
            if (
                evaluation.has_hard_blocker
                or evaluation.match_score < prefs.min_match_score
                or (
                    prefs.work_modes
                    and evaluation.location_type.upper() not in prefs.work_modes
                )
            )
            else JobStatus.DISCOVERED
        )

        job_id = f"job_{uuid.uuid4().hex[:10]}"
        record = JobRecord(
            id=job_id,
            user_id=user_ref.id,
            external_url=norm_url,
            dedup_hash=d_hash,
            company_name=co_name,
            role_title=r_title,
            matched_target_role=clean_no_em_dash(evaluation.matched_target_role),
            ats_platform=detect_ats_platform(norm_url),
            location_type=clean_no_em_dash(evaluation.location_type),
            raw_jd_text=cand["raw_jd_text"],
            match_score=evaluation.match_score,
            match_reasoning=clean_no_em_dash(
                f"{evaluation.match_reasoning}"
                + (f" [Blocker: {evaluation.blocker_reason}]" if evaluation.blocker_reason else "")
            ),
            status=initial_status,
        )

        payload = clean_no_em_dash(record.model_dump(mode="json"))
        jobs_col.document(job_id).set(payload)

        if initial_status == JobStatus.DISCOVERED:
            saved_jobs.append(payload)
        else:
            archived_low_or_blocked.append(payload)

    return {
        "searched_target_roles": active_role_titles,
        "daily_quota": quota,
        "high_match_discovered_count": len(saved_jobs),
        "archived_low_or_blocked_count": len(archived_low_or_blocked),
        "skipped_duplicates_count": skipped_duplicates,
        "discovered_jobs": saved_jobs,
        "archived_jobs": archived_low_or_blocked,
    }

async def paste_and_ingest_job(
    external_url: Optional[str] = None,
    raw_jd_text: Optional[str] = None,
    company_name: Optional[str] = None,
    role_title: Optional[str] = None,
    auto_queue_for_apply: bool = False,
    user_id: Optional[str] = None,
) -> dict:
    """
    One-Click 'Paste Any Job' Ingestor:
    Paste just a URL (from any job board, LinkedIn, Greenhouse, company site) OR raw text from a tweet/post.
    It scrapes the page, auto-detects Company & Role Title if omitted, scores the match,
    checks your Daily Application Limit (default 10), and queues it for tailoring & auto-application.
    """
    if not external_url and not raw_jd_text:
        raise ValueError("Provide either external_url or raw_jd_text (or both).")

    user_ref = get_user_ref(user_id)
    profile = MasterProfile.model_validate(get_master_profile(user_id))
    prefs = ScoutPreferences.model_validate(get_scout_preferences(user_id))
    quota = get_daily_quota_status(user_id)

    norm_url = normalize_job_url(external_url) if external_url else ""
    jd_content = raw_jd_text.strip() if (raw_jd_text and raw_jd_text.strip()) else await fetch_job_page_text(norm_url)

    evaluation = score_job_with_gemini(
        company=company_name or "AUTO_DETECT",
        role_title=role_title or "AUTO_DETECT",
        jd_text=jd_content,
        profile=profile,
        prefs=prefs,
    )

    final_company_value = company_name or evaluation.extracted_company_name
    final_role_value = role_title or evaluation.extracted_role_title
    if not final_company_value or not final_role_value:
        raise ValueError("The company and role could not be identified. Add them explicitly or configure the job analysis service.")
    final_company = clean_no_em_dash(final_company_value)
    final_role = clean_no_em_dash(final_role_value)
    d_hash = compute_dedup_hash(final_company, final_role)

    # Determine status based on auto_queue_for_apply and daily limit
    target_status = JobStatus.APPLYING_QUEUED if (auto_queue_for_apply and quota["can_apply_more_today"]) else JobStatus.DISCOVERED

    job_id = f"job_{uuid.uuid4().hex[:10]}"
    record = JobRecord(
        id=job_id,
        user_id=user_ref.id,
        external_url=norm_url,
        dedup_hash=d_hash,
        company_name=final_company,
        role_title=final_role,
        matched_target_role=clean_no_em_dash(evaluation.matched_target_role),
        ats_platform=detect_ats_platform(norm_url),
        location_type=clean_no_em_dash(evaluation.location_type),
        raw_jd_text=clean_html_to_text(jd_content),
        match_score=evaluation.match_score,
        match_reasoning=clean_no_em_dash(evaluation.match_reasoning),
        status=target_status,
    )

    payload = clean_no_em_dash(record.model_dump(mode="json"))
    user_ref.collection("jobs").document(job_id).set(payload)

    return {
        "status": "ingested",
        "queued_for_auto_apply": target_status == JobStatus.APPLYING_QUEUED,
        "daily_quota": quota,
        "job": payload,
    }

def list_discovered_jobs(status_filter: Optional[JobStatus] = None, user_id: Optional[str] = None) -> List[dict]:
    user_ref = get_user_ref(user_id)
    query = user_ref.collection("jobs")
    if status_filter:
        query = query.where("status", "==", status_filter.value)
    docs = [doc.to_dict() for doc in query.stream()]
    return sorted(docs, key=lambda x: x.get("match_score", 0), reverse=True)

    from collections import defaultdict

def log_agent_step(
    user_friendly_title: str,
    user_friendly_detail: str,
    phase: str = "SCOUT",
    status: str = "completed",
    job_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> dict:
    """
    Records a Lovable-style, plain-English progress step in Firestore
    so the UI can display exactly what the agent is doing in human terms.
    """
    user_ref = get_user_ref(user_id)
    if status in {"completed", "waiting_input", "error", "stopped"}:
        activity_stream = user_ref.collection("activity_stream")
        for doc in activity_stream.stream():
            previous = doc.to_dict() or {}
            if (
                previous.get("status") == "active"
                and previous.get("phase") == phase
                and previous.get("job_id") == job_id
            ):
                activity_stream.document(doc.id).update(
                    {"status": "stopped" if status == "stopped" else "completed"}
                )

    step_id = f"step_{uuid.uuid4().hex[:10]}"
    payload = {
        "id": step_id,
        "job_id": job_id,
        "phase": phase,  # SCOUT, TAILOR, APPLY, OTP
        "title": clean_no_em_dash(user_friendly_title),
        "detail": clean_no_em_dash(user_friendly_detail),
        "status": status,  # active, completed, waiting_input, error
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    user_ref.collection("activity_stream").document(step_id).set(payload)
    return payload

def get_recent_activity_stream(limit: int = 25, user_id: Optional[str] = None) -> List[dict]:
    """Returns the latest plain-English agent steps for the Lovable-style progress stream."""
    user_ref = get_user_ref(user_id)
    activity_stream = user_ref.collection("activity_stream")
    docs = [d.to_dict() or {} for d in activity_stream.stream()]
    chronological_docs = sorted(docs, key=lambda x: x.get("timestamp", ""))
    open_steps: dict[tuple[str, Optional[str]], list[dict]] = defaultdict(list)

    for item in chronological_docs:
        key = (item.get("phase", ""), item.get("job_id"))
        if item.get("status") == "active":
            open_steps[key].append(item)
        elif item.get("status") in {"completed", "waiting_input", "error", "stopped"}:
            closed_status = "stopped" if item.get("status") == "stopped" else "completed"
            for open_step in open_steps.pop(key, []):
                open_step["status"] = closed_status
                step_id = open_step.get("id")
                if step_id:
                    activity_stream.document(step_id).update({"status": closed_status})

    sorted_docs = sorted(docs, key=lambda x: x.get("timestamp", ""), reverse=True)
    return sorted_docs[:limit]

def get_applied_jobs_grouped_by_day(user_id: Optional[str] = None) -> dict:
    """
    Returns all applied/post-application jobs grouped chronologically by Day
    (e.g. 'Saturday, Oct 31, 2026') along with their tailored CV PDF links.
    """
    user_ref = get_user_ref(user_id)
    applied_statuses = {
        JobStatus.APPLIED.value,
        JobStatus.INTERVIEW_INVITE.value,
        JobStatus.REPLIED_REJECTED.value,
        JobStatus.OFFER_STAGE.value,
        JobStatus.APPLYING_QUEUED.value,
        JobStatus.APPLYING_ACTIVE.value,
        JobStatus.WAITING_FOR_OTP.value,
    }

    all_jobs = [d.to_dict() for d in user_ref.collection("jobs").stream()]
    packages_map = {
        d.id: d.to_dict() for d in user_ref.collection("tailored_packages").stream()
    }

    history_jobs = [j for j in all_jobs if j.get("status") in applied_statuses]
    # Sort newest applied_at (or discovered_at) first
    history_jobs.sort(
        key=lambda x: str(x.get("applied_at") or x.get("discovered_at") or ""),
        reverse=True,
    )

    grouped: dict[str, list] = defaultdict(list)
    for j in history_jobs:
        raw_ts = str(j.get("applied_at") or j.get("discovered_at") or "")
        try:
            dt = datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
            day_key = dt.strftime("%Y-%m-%d")
            day_label = dt.strftime("%A, %b %d, %Y")
            time_label = dt.strftime("%I:%M %p")
        except Exception:
            day_key = "Recent"
            day_label = "Recent Applications"
            time_label = ""

        pkg = packages_map.get(j["id"], {})
        cv_path = pkg.get("cv_pdf_url")
        execution_snap = user_ref.collection("execution_logs").document(j["id"]).get()
        execution = execution_snap.to_dict() if execution_snap.exists else {}
        screenshot_path = execution.get("screenshot_url")
        j_enriched = {
            **j,
            "applied_day_key": day_key,
            "applied_day_label": day_label,
            "applied_time_label": time_label,
            "cv_preview_url": f"http://localhost:8000{cv_path}" if cv_path else None,
            "screenshot_url": (
                screenshot_path
                if not screenshot_path or screenshot_path.startswith("http")
                else f"http://localhost:8000{screenshot_path}"
            ),
            "last_email_category": j.get("last_email_category"),
            "cover_letter_text": pkg.get("cover_letter_text"),
            "critic_score": pkg.get("critic_score"),
        }
        grouped[day_label].append(j_enriched)

    days_list = [
        {
            "day_label": day_label,
            "count": len(items),
            "applications": items,
        }
        for day_label, items in grouped.items()
    ]

    return {
        "total_applications_tracked": len(history_jobs),
        "days": days_list,
    }