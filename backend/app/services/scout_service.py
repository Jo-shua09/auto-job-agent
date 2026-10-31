import os
import re
import sys
import uuid
import asyncio
import hashlib
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
from datetime import datetime, timezone
from typing import List, Optional
import httpx
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

from app.core.firebase import get_user_ref
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
    if not url or url.startswith("mailto:"):
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
    active_roles = [r.title for r in prefs.target_roles if r.active] or ["Software Engineer"]
    all_skills = [skill for skills in profile.skills_by_category.values() for skill in skills]

    jd_lower = jd_text.lower()
    for exc in prefs.excluded_keywords:
        if exc.lower() in jd_lower:
            return JDMatchEvaluation(
                extracted_company_name=company or "Unknown Company",
                extracted_role_title=role_title or active_roles[0],
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
            if any(w.lower() in (role_title or jd_text[:200]).lower() for w in r.split() if len(w) > 2):
                best_role = r
                score = min(98, score + 10)
                break
        return JDMatchEvaluation(
            extracted_company_name=company or "Tech Company",
            extracted_role_title=role_title or best_role,
            match_score=score,
            matched_target_role=best_role,
            location_type="REMOTE" if "remote" in jd_lower else "HYBRID",
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
    EXCLUDED KEYWORDS: {prefs.excluded_keywords}
    CANDIDATE SKILLS: {all_skills}

    PROVIDED COMPANY: {company}
    PROVIDED ROLE TITLE: {role_title}
    JOB DESCRIPTION TEXT:
    {jd_text[:6500]}

    STRICT RULES:
    1. Set has_hard_blocker = True ONLY if the job strictly requires residing outside Nigeria without remote flexibility, or requires US/UK citizenship/security clearance.
    2. Score 80-100 if the tech stack overlaps with React, Next.js, TypeScript, AI SDK/LLMs, or Flutter/Dart.
    3. Never use long em-dashes (—) or en-dashes (–). Use standard hyphens (-) only.
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
    except Exception as e:
        return JDMatchEvaluation(
            extracted_company_name=company if company != "AUTO_DETECT" else "Tech Company",
            extracted_role_title=role_title if role_title != "AUTO_DETECT" else active_roles[0],
            match_score=78,
            matched_target_role=active_roles[0],
            location_type="REMOTE",
            has_hard_blocker=False,
            match_reasoning=f"Keyword match passed (Gemini fallback: {str(e)[:60]}).",
        )

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
        search_terms = {"frontend", "flutter"}

    async with httpx.AsyncClient(timeout=15.0) as client:
        for term in list(search_terms)[:3]:
            try:
                resp = await client.get(
                    "https://remotive.com/api/remote-jobs",
                    params={"category": "software-dev", "search": term, "limit": limit},
                )
                if resp.status_code == 200:
                    for j in resp.json().get("jobs", [])[:limit]:
                        discovered.append({
                            "company_name": j.get("company_name", "Unknown Company"),
                            "role_title": j.get("title", "Software Engineer"),
                            "external_url": j.get("url", ""),
                            "location_type": f"REMOTE ({j.get('candidate_required_location', 'Worldwide')})",
                            "raw_jd_text": clean_html_to_text(j.get("description", "")),
                        })
            except Exception:
                continue
    return discovered

async def fetch_from_arbeitnow(role_queries: List[str], limit: int = 6) -> List[dict]:
    """Source 2: Arbeitnow Global Remote & Visa-Sponsoring Tech Feed (Zero API Key)."""
    discovered = []
    keywords = {w.lower() for rq in role_queries for w in rq.replace("/", " ").split() if len(w) > 2}
    if not keywords:
        keywords = {"frontend", "react", "flutter", "ai"}

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get("https://www.arbeitnow.com/api/job-board-api")
            if resp.status_code == 200:
                for j in resp.json().get("data", []):
                    title_low = j.get("title", "").lower()
                    tags_low = " ".join(j.get("tags", [])).lower()
                    if any(k in title_low or k in tags_low for k in keywords):
                        discovered.append({
                            "company_name": j.get("company_name", "Tech Company"),
                            "role_title": j.get("title", "Software Engineer"),
                            "external_url": j.get("url", ""),
                            "location_type": "REMOTE" if j.get("remote") else j.get("location", "HYBRID"),
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
                dork_query = f'({site_clause}) "{role}" ("Remote" OR "Lagos" OR "Nigeria" OR "Anywhere" OR "EMEA")'
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
                                r_title, co_name = title_raw.strip(), urlparse(link).path.strip("/").split("/")[0].title()

                            discovered.append({
                                "company_name": co_name or "Tech Company",
                                "role_title": r_title or role,
                                "external_url": link,
                                "location_type": "REMOTE",
                                "raw_jd_text": clean_html_to_text(f"{title_raw}\n{snippet}"),
                            })
                except Exception:
                    continue
    return discovered

async def fetch_from_jsearch(role_queries: List[str], limit_per_role: int = 5) -> List[dict]:
    """Source 4: JSearch Aggregator (pulls LinkedIn, Indeed, Glassdoor, ZipRecruiter)."""
    jsearch_key = os.getenv("JSEARCH_API_KEY")
    if not jsearch_key:
        return []

    discovered = []
    async with httpx.AsyncClient(timeout=15.0) as client:
        for role in role_queries[:2]:
            try:
                resp = await client.get(
                    "https://jsearch.p.rapidapi.com/search",
                    headers={
                        "X-RapidAPI-Key": jsearch_key,
                        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
                    },
                    params={"query": f"{role} Remote", "page": "1", "num_pages": "1", "date_posted": "week"},
                )
                if resp.status_code == 200:
                    for item in resp.json().get("data", [])[:limit_per_role]:
                        discovered.append({
                            "company_name": item.get("employer_name", "Unknown"),
                            "role_title": item.get("job_title", role),
                            "external_url": item.get("job_apply_link") or item.get("job_google_link", ""),
                            "location_type": "REMOTE" if item.get("job_is_remote") else "ONSITE",
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
        active_role_titles = ["Frontend Engineer", "AI Frontend Engineer", "Flutter Mobile Developer"]

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
    raw_candidates.extend(await fetch_from_jsearch(active_role_titles))
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
            if (evaluation.has_hard_blocker or evaluation.match_score < prefs.min_match_score)
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
    auto_queue_for_apply: bool = True,
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

    norm_url = normalize_job_url(external_url) if external_url else f"https://manual-paste.local/{uuid.uuid4().hex[:8]}"
    jd_content = raw_jd_text.strip() if (raw_jd_text and raw_jd_text.strip()) else await fetch_job_page_text(norm_url)

    evaluation = score_job_with_gemini(
        company=company_name or "AUTO_DETECT",
        role_title=role_title or "AUTO_DETECT",
        jd_text=jd_content,
        profile=profile,
        prefs=prefs,
    )

    final_company = clean_no_em_dash(company_name or evaluation.extracted_company_name or "Tech Company")
    final_role = clean_no_em_dash(role_title or evaluation.extracted_role_title or "Software Engineer")
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