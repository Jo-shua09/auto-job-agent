import os
import sys
import ssl
import smtplib
import asyncio
import threading
from pathlib import Path
from email.message import EmailMessage
from email.utils import formataddr
from datetime import datetime, timezone
from typing import Dict, List, Optional
from pydantic import BaseModel, Field
from playwright.sync_api import sync_playwright, Page
from google.genai import types

from app.core.gemini_client import create_gemini_client, get_gemini_model
from app.core.database import get_user_ref
from app.models.schemas import (
    JobRecord,
    JobStatus,
    MasterProfile,
    TailoredPackage,
)
from app.services.profile_service import (
    get_master_profile,
    get_daily_quota_status,
    clean_no_em_dash,
)
from app.services.tailor_service import get_tailored_package, tailor_and_stage_job
from app.services.pdf_compiler import GENERATED_PDF_DIR
from app.services.scout_service import log_agent_step
from app.services.state_machine import transition_job_state

SCREENSHOT_DIR = Path(__file__).resolve().parent.parent.parent / "generated_pdfs" / "screenshots"
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)


class ApplicationStopRequested(Exception):
    pass


class ActiveApplicationRun:
    def __init__(self) -> None:
        self.stop_event = threading.Event()
        self.job_id: Optional[str] = None


_active_runs: Dict[str, ActiveApplicationRun] = {}
_active_runs_lock = threading.Lock()


def _start_application_run(user_id: Optional[str]) -> ActiveApplicationRun:
    if not user_id:
        raise ValueError("Please sign in to continue.")
    with _active_runs_lock:
        if user_id in _active_runs:
            raise ValueError("An application is already in progress. Please wait for it to finish or stop it.")
        run = ActiveApplicationRun()
        _active_runs[user_id] = run
        return run


def _finish_application_run(user_id: Optional[str], run: ActiveApplicationRun) -> None:
    if not user_id:
        return
    with _active_runs_lock:
        if _active_runs.get(user_id) is run:
            del _active_runs[user_id]


def get_application_run_status(user_id: Optional[str]) -> dict:
    if not user_id:
        raise ValueError("Please sign in to continue.")
    with _active_runs_lock:
        run = _active_runs.get(user_id)
        if run is None:
            return {"active": False, "stop_requested": False, "job_id": None}
        return {
            "active": True,
            "stop_requested": run.stop_event.is_set(),
            "job_id": run.job_id,
        }


def request_application_stop(user_id: Optional[str]) -> dict:
    if not user_id:
        raise ValueError("Please sign in to continue.")
    with _active_runs_lock:
        run = _active_runs.get(user_id)
        if run is None:
            return {"status": "not_running", "active": False, "job_id": None}
        run.stop_event.set()
        return {"status": "stop_requested", "active": True, "job_id": run.job_id}


def _raise_if_stop_requested(stop_event: threading.Event) -> None:
    if stop_event.is_set():
        raise ApplicationStopRequested("Application stopped at the user's request.")


# --- 1. TELEMETRY & EXECUTION LOG UPDATER ---

def update_execution_log(
    job_id: str,
    state: str,
    step_message: str,
    otp_required: bool = False,
    screenshot_url: Optional[str] = None,
    error_message: Optional[str] = None,
    user_id: Optional[str] = None,
) -> dict:
    user_ref = get_user_ref(user_id)
    payload = {
        "job_id": job_id,
        "state": state,
        "step_message": clean_no_em_dash(step_message),
        "otp_required": otp_required,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if screenshot_url is not None:
        payload["screenshot_url"] = screenshot_url
    if error_message is not None:
        payload["error_message"] = clean_no_em_dash(error_message)

    user_ref.collection("execution_logs").document(job_id).set(payload, merge=True)
    return payload

def get_execution_log(job_id: str, user_id: Optional[str] = None) -> dict:
    user_ref = get_user_ref(user_id)
    snap = user_ref.collection("execution_logs").document(job_id).get()
    return snap.to_dict() if snap.exists else {"job_id": job_id, "state": "IDLE"}

# --- 2. AI + HEURISTIC DOM FIELD MAPPER (p6_1) ---

class DOMFieldMappingItem(BaseModel):
    selector_id: str = Field(description="The exact field_index from the extracted DOM inputs list.")
    value_to_fill: str = Field(description="The exact text value to type or select into this field.")

class DOMFieldMappingPlan(BaseModel):
    mappings: List[DOMFieldMappingItem]

def map_custom_dom_fields_with_gemini(
    dom_fields: List[dict],
    profile: MasterProfile,
    package: TailoredPackage,
    job: JobRecord,
) -> Dict[str, str]:
    """Uses Gemini 2.5 Flash to map non-standard or custom ATS screening fields to verified answers."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not dom_fields or not api_key or api_key == "your_gemini_api_key_here":
        return {}

    client = create_gemini_client(api_key)
    prompt = f"""
    You are an autonomous browser form-filling mapper. Map the unmapped form inputs below
    to the candidate's MasterProfile, Cover Letter, and Tailored Screening Answers.

    JOB: {job.role_title} at {job.company_name}
    CANDIDATE PROFILE:
    - Full Name: {profile.full_name}
    - Email: {profile.email}
    - Phone: {profile.phone}
    - Location: {profile.location}
    - GitHub: {profile.github_url}
    - LinkedIn: {profile.linkedin_url}
    - Portfolio: {profile.portfolio_url}
    - Defaults: {profile.application_defaults}

    COVER LETTER:
    {package.cover_letter_text}

    PRE-GENERATED SCREENING ANSWERS:
    {package.screening_answers}

    UNMAPPED DOM INPUTS ON PAGE:
    {dom_fields}

    RULES:
    1. Only return mappings for fields you can confidently answer using the candidate's real data.
    2. Never use long em-dashes (—) or en-dashes (–).
    """
    try:
        resp = client.models.generate_content(
            model=get_gemini_model(),
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=DOMFieldMappingPlan,
                temperature=0.0,
            ),
        )
        plan = DOMFieldMappingPlan.model_validate_json(resp.text)
        return {m.selector_id: clean_no_em_dash(m.value_to_fill) for m in plan.mappings}
    except Exception:
        return {}

def fill_standard_and_custom_fields_sync(
    page: Page,
    profile: MasterProfile,
    package: TailoredPackage,
    job: JobRecord,
    pdf_file_path: Path,
    stop_event: threading.Event,
) -> int:
    """
    Inspects the live page DOM, clicks 'Apply' if needed to reveal the form,
    uploads the tailored PDF CV, and fills standard + custom fields.
    """
    # Step A: If the page has an "Apply for this job" or "Apply" button before the form is visible, click it
    for btn_text in ["Apply for this job", "Apply Now", "Apply", "Submit Application"]:
        _raise_if_stop_requested(stop_event)
        try:
            btn = page.get_by_role("button", name=btn_text, exact=False).first
            if btn.is_visible(timeout=800) and "submit" not in (btn.get_attribute("type") or "").lower():
                _raise_if_stop_requested(stop_event)
                btn.click()
                page.wait_for_timeout(1200)
                break
        except Exception:
            pass

    filled_count = 0
    name_parts = profile.full_name.strip().split()
    first_name = name_parts[0] if name_parts else ""
    last_name = name_parts[-1] if len(name_parts) > 1 else ""

    # Step B: Upload the tailored PDF CV to the first resume file input
    _raise_if_stop_requested(stop_event)
    if pdf_file_path.exists():
        try:
            file_inputs = page.locator('input[type="file"]').all()
            if file_inputs:
                _raise_if_stop_requested(stop_event)
                file_inputs[0].set_input_files(str(pdf_file_path))
                filled_count += 1
                page.wait_for_timeout(1000)
        except Exception:
            pass
    _raise_if_stop_requested(stop_event)

    # Step C: Extract all visible text inputs and textareas and fill standard fields heuristically
    inputs = page.locator(
        'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input:not([type]), textarea'
    ).all()

    unmapped_fields = []
    unmapped_locators = {}

    for idx, loc in enumerate(inputs):
        _raise_if_stop_requested(stop_event)
        try:
            if not loc.is_visible():
                continue
            field_id = f"field_{idx}"
            name_attr = (loc.get_attribute("name") or "").lower()
            id_attr = (loc.get_attribute("id") or "").lower()
            placeholder = (loc.get_attribute("placeholder") or "").lower()
            aria_label = (loc.get_attribute("aria-label") or "").lower()

            # Check associated <label> text if id exists
            label_text = ""
            if id_attr:
                lbl = page.locator(f'label[for="{loc.get_attribute("id")}"]').first
                if lbl.count() > 0:
                    label_text = (lbl.inner_text() or "").lower()

            combined = f"{name_attr} {id_attr} {placeholder} {aria_label} {label_text}"

            if "first_name" in combined or "firstname" in combined or "first name" in combined:
                loc.fill(first_name)
                filled_count += 1
            elif "last_name" in combined or "lastname" in combined or "last name" in combined:
                loc.fill(last_name)
                filled_count += 1
            elif ("full_name" in combined or "fullname" in combined or combined.strip() == "name") and "company" not in combined:
                loc.fill(profile.full_name)
                filled_count += 1
            elif "email" in combined:
                loc.fill(profile.email)
                filled_count += 1
            elif "phone" in combined or "mobile" in combined or "tel" in combined:
                loc.fill(profile.phone)
                filled_count += 1
            elif "linkedin" in combined:
                loc.fill(profile.linkedin_url)
                filled_count += 1
            elif "github" in combined:
                loc.fill(profile.github_url)
                filled_count += 1
            elif "portfolio" in combined or "website" in combined or "personal url" in combined:
                loc.fill(profile.portfolio_url or profile.github_url)
                filled_count += 1
            elif "location" in combined or "city" in combined:
                loc.fill(profile.location)
                filled_count += 1
            elif "cover_letter" in combined or "cover letter" in combined or "additional information" in combined:
                if package.cover_letter_text:
                    loc.fill(package.cover_letter_text)
                    filled_count += 1
            else:
                unmapped_fields.append({
                    "selector_id": field_id,
                    "label_or_hint": combined.strip()[:120],
                })
                unmapped_locators[field_id] = loc
        except Exception:
            continue

    # Step D: Use Gemini 2.5 Flash to map remaining custom screening questions
    if unmapped_fields:
        _raise_if_stop_requested(stop_event)
        ai_mappings = map_custom_dom_fields_with_gemini(unmapped_fields, profile, package, job)
        _raise_if_stop_requested(stop_event)
        for sel_id, val in ai_mappings.items():
            _raise_if_stop_requested(stop_event)
            if sel_id in unmapped_locators and val:
                try:
                    unmapped_locators[sel_id].fill(val)
                    filled_count += 1
                except Exception:
                    continue

    return filled_count

# --- 3. OTP CHALLENGE DETECTOR & LIVE MANUAL RELAY (p6_2 & p6_3) ---

OTP_KEYWORDS = [
    "security code",
    "verification code",
    "enter the code",
    "code sent to your email",
    "confirm your email",
    "one-time passcode",
    "8-character code",
    "6-digit code",
]

def detect_otp_prompt_on_page(page: Page) -> bool:
    """Checks if the current page DOM is asking for an Email OTP / Security Verification Code."""
    try:
        body_text = (page.locator("body").inner_text(timeout=2000) or "").lower()
        if any(k in body_text for k in OTP_KEYWORDS):
            return True
        otp_inputs = page.locator(
            'input[name*="security" i], input[name*="otp" i], input[name*="verification" i], input[id*="security_code" i]'
        ).count()
        return otp_inputs > 0
    except Exception:
        return False

def enter_otp_code_on_page(page: Page, otp_code: str) -> bool:
    """Fills the user's relayed OTP code into single-input or multi-box (8-character Greenhouse) inputs."""
    code = otp_code.strip()
    try:
        # Case 1: Greenhouse 8 separate 1-char boxes
        char_boxes = page.locator('input[maxlength="1"]:visible').all()
        if len(char_boxes) >= 6 and len(code) >= len(char_boxes):
            for idx, box in enumerate(char_boxes):
                box.fill(code[idx])
            return True

        # Case 2: Standard single OTP input field
        otp_input = page.locator(
            'input[name*="security" i]:visible, input[name*="otp" i]:visible, '
            'input[name*="code" i]:visible, input[type="text"]:visible'
        ).first
        if otp_input.count() > 0:
            otp_input.fill(code)
            return True
    except Exception:
        pass
    return False

def click_submit_button_on_page(page: Page, stop_event: threading.Event) -> bool:
    """Clicks the primary Submit Application button on the form."""
    submit_selectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Submit Application")',
        'button:has-text("Submit")',
        'button:has-text("Send Application")',
    ]
    for sel in submit_selectors:
        _raise_if_stop_requested(stop_event)
        try:
            loc = page.locator(sel).first
        except Exception:
            continue
        try:
            visible = loc.is_visible(timeout=800)
        except Exception:
            continue
        if visible:
            _raise_if_stop_requested(stop_event)
            loc.click()
            page.wait_for_timeout(2500)
            return True
    return False

SUBMISSION_CONFIRMATION_KEYWORDS = (
    "application submitted",
    "application received",
    "successfully submitted",
    "submission successful",
    "thank you for applying",
    "thank you for your application",
    "we have received your application",
    "your application has been submitted",
    "application complete",
)

def detect_submission_confirmation(page: Page) -> bool:
    try:
        body_text = (page.locator("body").inner_text(timeout=3000) or "").lower()
        if any(keyword in body_text for keyword in SUBMISSION_CONFIRMATION_KEYWORDS):
            return True
        url = (page.url or "").lower()
        return any(part in url for part in ("confirmation", "thank-you", "thankyou", "success", "submitted"))
    except Exception:
        return False

def _fail_application(job_id: str, user_id: Optional[str], friendly_message: str, technical_message: str) -> dict:
    try:
        transition_job_state(job_id, JobStatus.FAILED_NEEDS_MANUAL, user_id)
    except ValueError:
        pass
    update_execution_log(
        job_id,
        state="ERROR",
        step_message=friendly_message,
        error_message=friendly_message,
        user_id=user_id,
    )
    log_agent_step(
        "This application needs a quick look",
        friendly_message,
        phase="APPLY",
        job_id=job_id,
        status="error",
        user_id=user_id,
    )
    return {
        "status": "FAILED_NEEDS_MANUAL",
        "job_id": job_id,
        "message": friendly_message,
    }

def _send_email_application_sync(
    job: JobRecord,
    profile: MasterProfile,
    package: TailoredPackage,
    pdf_file_path: Path,
    user_id: Optional[str],
    stop_event: threading.Event,
) -> dict:
    _raise_if_stop_requested(stop_event)
    job_id = job.id
    recipient = (job.application_email or "").strip()

    if not recipient:
        return _fail_application(
            job_id,
            user_id,
            "We couldn't find an application email for this job, so nothing was sent.",
            "Missing application_email on job record",
        )

    gmail_user = os.getenv("GMAIL_ADDRESS", "").strip()
    app_password = os.getenv("GMAIL_APP_PASSWORD", "").strip()
    if user_id:
        try:
            from app.services.profile_service import get_gmail_integration_config

            integration = get_gmail_integration_config(user_id)
            gmail_user = (integration.get("gmail_address") or profile.email or gmail_user or "").strip()
            app_password = (integration.get("gmail_app_password") or app_password or "").strip()
        except Exception:
            gmail_user = (profile.email or gmail_user or "").strip()
    else:
        gmail_user = (profile.email or gmail_user or "").strip()
    if not gmail_user or not app_password:
        return _fail_application(
            job_id,
            user_id,
            "Email sending isn't set up yet, so nothing was sent. Save your Gmail address and 16-character App Password in Settings.",
            "Missing Gmail credentials",
        )

    if not pdf_file_path.exists():
        return _fail_application(
            job_id,
            user_id,
            "Your tailored CV is missing, so we didn't send an incomplete application.",
            f"Tailored CV PDF not found: {pdf_file_path}",
        )

    cover_letter = (package.cover_letter_text or "").strip()
    if not cover_letter:
        cover_letter = (
            f"Dear {job.company_name} team,\n\n"
            f"I am applying for the {job.role_title} role. Please find my tailored CV attached.\n\n"
            f"Best regards,\n{profile.full_name}"
        )

    contact = [value for value in (profile.email, profile.phone) if value]
    links = [
        value for value in (profile.portfolio_url, profile.github_url, profile.linkedin_url)
        if value
    ]
    body = f"{cover_letter}\n\n---\nContact: {', '.join(contact)}"
    if links:
        body += f"\nLinks: {', '.join(links)}"

    message = EmailMessage()
    message["Subject"] = f"Application for {job.role_title} - {profile.full_name}"
    message["From"] = formataddr((profile.full_name, gmail_user))
    message["To"] = recipient
    message.set_content(clean_no_em_dash(body))
    with pdf_file_path.open("rb") as pdf_file:
        message.add_attachment(
            pdf_file.read(),
            maintype="application",
            subtype="pdf",
            filename=pdf_file_path.name,
        )

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=20) as smtp:
            smtp.login(gmail_user, app_password)
            smtp.send_message(message)
    except Exception:
        return _fail_application(
            job_id,
            user_id,
            "We couldn't email your application. Nothing was sent. Please try again.",
            "Email send failed",
        )

    transition_job_state(job_id, JobStatus.APPLIED, user_id)
    update_execution_log(
        job_id,
        state="SUBMITTED",
        step_message=f"We emailed your CV and cover letter to {recipient}.",
        user_id=user_id,
    )
    log_agent_step(
        f"Application sent: {job.role_title} at {job.company_name}",
        f"We emailed your CV and cover letter to {recipient}.",
        phase="APPLY",
        job_id=job_id,
        status="completed",
        user_id=user_id,
    )
    return {"status": "applied_via_email", "job_id": job_id, "recipient": recipient}

# --- 4. MAIN SYNCHRONOUS PLAYWRIGHT WORKER (WINDOWS-SAFE) ---

def _execute_playwright_application_sync(
    job: JobRecord,
    profile: MasterProfile,
    package: TailoredPackage,
    pdf_file_path: Path,
    headless: bool = True,
    simulate_otp_for_testing: bool = False,
    user_id: Optional[str] = None,
    stop_event: Optional[threading.Event] = None,
) -> dict:
    if stop_event is None:
        raise ValueError("We couldn't start this application right now. Please try again.")
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

    user_ref = get_user_ref(user_id)
    job_id = job.id

    if job.application_email:
        return _send_email_application_sync(job, profile, package, pdf_file_path, user_id, stop_event)

    if not job.external_url.startswith("http"):
        return _fail_application(
            job_id,
            user_id,
            "We couldn't find a real application link or email for this job, so nothing was sent.",
            "Missing application_url and application_email",
        )

    transition_job_state(job_id, JobStatus.APPLYING_ACTIVE, user_id)
    update_execution_log(
        job_id,
        state="NAVIGATING",
        step_message=f"Opening the application for {job.role_title} at {job.company_name}...",
        user_id=user_id,
    )
    log_agent_step(
        f"Opening the application for {job.company_name}",
        f"Heading to the application form for {job.role_title}...",
        phase="APPLY",
        job_id=job_id,
        status="active",
        user_id=user_id,
    )

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        page = context.new_page()

        try:
            _raise_if_stop_requested(stop_event)
            page.goto(job.external_url, wait_until="domcontentloaded", timeout=25000)
            page.wait_for_timeout(1500)

            update_execution_log(
                job_id,
                state="FILLING_FORM",
                step_message="Adding your tailored CV and answering the form questions...",
                user_id=user_id,
            )
            log_agent_step(
                f"Filling in the application for {job.company_name}",
                "Adding your tailored CV and answering questions from your profile...",
                phase="APPLY",
                job_id=job_id,
                status="active",
                user_id=user_id,
            )

            filled_count = fill_standard_and_custom_fields_sync(
                page=page,
                profile=profile,
                package=package,
                job=job,
                pdf_file_path=pdf_file_path,
                stop_event=stop_event,
            )

            submitted = False
            if not simulate_otp_for_testing:
                _raise_if_stop_requested(stop_event)
                submitted = click_submit_button_on_page(page, stop_event)

            # Check if an Email OTP / Verification Code prompt appeared!
            needs_otp = simulate_otp_for_testing or detect_otp_prompt_on_page(page)

            if needs_otp:
                # Take a snapshot of the OTP screen
                otp_shot_name = f"otp_prompt_{job_id}.png"
                page.screenshot(path=str(SCREENSHOT_DIR / otp_shot_name))

                # Clear any stale OTP input and transition to WAITING_FOR_OTP
                user_ref.collection("execution_logs").document(job_id).set(
                    {"otp_code_input": None}, merge=True
                )
                transition_job_state(job_id, JobStatus.WAITING_FOR_OTP, user_id)
                update_execution_log(
                    job_id,
                    state="WAITING_FOR_OTP",
                    step_message=f"{job.company_name} sent a verification code to {profile.email}. Enter it in the dialog that opens to finish submitting.",
                    otp_required=True,
                    screenshot_url=f"/pdfs/screenshots/{otp_shot_name}",
                    user_id=user_id,
                )
                log_agent_step(
                    "Waiting for your security code",
                    f"{job.company_name} sent a code. We've paused right here so you don't lose your place. Enter it when you're ready.",
                    phase="OTP",
                    job_id=job_id,
                    status="waiting_input",
                    user_id=user_id,
                )

                # Poll Firestore every 2 seconds for up to 5 minutes (300s) waiting for user OTP input
                otp_received = None
                for _ in range(150):
                    if stop_event.wait(2):
                        raise ApplicationStopRequested("Application stopped at the user's request.")
                    snap = user_ref.collection("execution_logs").document(job_id).get()
                    if snap.exists:
                        code_val = snap.to_dict().get("otp_code_input")
                        if code_val and str(code_val).strip():
                            otp_received = str(code_val).strip()
                            break

                if not otp_received:
                    transition_job_state(job_id, JobStatus.FAILED_NEEDS_MANUAL, user_id)
                    update_execution_log(
                        job_id,
                        state="ERROR",
                        step_message="We didn't get the security code in time. You can try this application again whenever you're ready.",
                        otp_required=False,
                        error_message="We didn't get the security code in time. You can try this application again whenever you're ready.",
                        user_id=user_id,
                    )
                    browser.close()
                    return {"status": "failed_otp_timeout", "job_id": job_id, "message": "We didn't get the security code in time. You can try this application again whenever you're ready."}

                # Resume execution with the user's OTP!
                _raise_if_stop_requested(stop_event)
                transition_job_state(job_id, JobStatus.APPLYING_ACTIVE, user_id)
                enter_otp_code_on_page(page, otp_received)
                _raise_if_stop_requested(stop_event)
                submitted = click_submit_button_on_page(page, stop_event)

            page.wait_for_timeout(1500)
            if not submitted or not detect_submission_confirmation(page):
                browser.close()
                return _fail_application(
                    job_id,
                    user_id,
                    "We reached the application page but couldn't confirm it was sent, so we didn't mark it as applied.",
                    "No submit confirmation detected",
                )

            # Capture final confirmation screenshot
            final_shot_name = f"submitted_{job_id}.png"
            page.screenshot(path=str(SCREENSHOT_DIR / final_shot_name), full_page=False)
            screenshot_url = f"/pdfs/screenshots/{final_shot_name}"

            transition_job_state(job_id, JobStatus.APPLIED, user_id)
            update_execution_log(
                job_id,
                state="SUBMITTED",
                step_message=f"Successfully applied to {job.role_title} at {job.company_name} ({filled_count} fields filled).",
                otp_required=False,
                screenshot_url=screenshot_url,
                user_id=user_id,
            )
            log_agent_step(
                f"Application sent: {job.role_title} at {job.company_name}",
                f"We filled {filled_count} fields, added your tailored CV and saved a confirmation.",
                phase="APPLY",
                job_id=job_id,
                status="completed",
                user_id=user_id,
            )

            browser.close()
            return {
                "status": "APPLIED",
                "job_id": job_id,
                "company_name": job.company_name,
                "role_title": job.role_title,
                "fields_filled": filled_count,
                "screenshot_url": screenshot_url,
            }

        except ApplicationStopRequested:
            transition_job_state(job_id, JobStatus.FAILED_NEEDS_MANUAL, user_id)
            update_execution_log(
                job_id,
                state="STOPPED",
                step_message="Stopped at your request. Check the employer's application page before retrying; a submission already sent cannot be recalled.",
                otp_required=False,
                error_message="Stopped at your request. Check the employer's application page before retrying.",
                user_id=user_id,
            )
            log_agent_step(
                f"We stopped the application for {job.company_name}",
                "You asked us to stop. Check the employer's site before trying again.",
                phase="APPLY",
                job_id=job_id,
                status="stopped",
                user_id=user_id,
            )
            browser.close()
            return {"status": "STOPPED_NEEDS_REVIEW", "job_id": job_id}

        except Exception:
            err_shot_name = f"error_{job_id}.png"
            try:
                page.screenshot(path=str(SCREENSHOT_DIR / err_shot_name))
            except Exception:
                pass
            friendly_message = f"We hit a problem on {job.company_name}'s application form. Your progress is saved; you can try again."
            transition_job_state(job_id, JobStatus.FAILED_NEEDS_MANUAL, user_id)
            update_execution_log(
                job_id,
                state="ERROR",
                step_message=friendly_message,
                otp_required=False,
                screenshot_url=f"/pdfs/screenshots/{err_shot_name}",
                error_message=friendly_message,
                user_id=user_id,
            )
            log_agent_step(
                f"This application needs a quick look: {job.company_name}",
                "We paused while filling in the form. Open your queue to see what's left.",
                phase="APPLY",
                job_id=job_id,
                status="error",
                user_id=user_id,
            )
            browser.close()
            return {"status": "FAILED_NEEDS_MANUAL", "job_id": job_id, "message": friendly_message}

# --- 5. ASYNC API ORCHESTRATORS ---

async def _execute_job_application_with_run(
    job_id: str,
    run: ActiveApplicationRun,
    headless: bool = True,
    simulate_otp_for_testing: bool = False,
    user_id: Optional[str] = None,
) -> dict:
    """
    Checks the Daily Limit (default 10), ensures a TailoredPackage PDF exists,
    and runs the Playwright Applicator Worker in a background-safe thread.
    """
    if run.stop_event.is_set():
        return {"status": "STOPPED_BEFORE_START", "job_id": job_id}
    run.job_id = job_id
    quota = get_daily_quota_status(user_id)
    if not quota["can_apply_more_today"]:
        raise ValueError(
            f"You've reached today's application limit of {quota['daily_apply_limit']}. You can increase it in Settings or try again tomorrow."
        )

    user_ref = get_user_ref(user_id)
    job_snap = user_ref.collection("jobs").document(job_id).get()
    if not job_snap.exists:
        raise ValueError("We couldn't find this job. Please refresh and try again.")

    job = JobRecord.model_validate(job_snap.to_dict())
    profile = MasterProfile.model_validate(get_master_profile(user_id))

    # Ensure tailored package & PDF exist before launching Playwright
    try:
        pkg_dict = get_tailored_package(job_id, user_id)
    except ValueError:
        tailor_res = await tailor_and_stage_job(job_id, user_id)
        pkg_dict = tailor_res["tailored_package"]

    package = TailoredPackage.model_validate(pkg_dict)
    pdf_filename = (package.cv_pdf_url or "").replace("/pdfs/", "")
    pdf_file_path = GENERATED_PDF_DIR / pdf_filename
    if run.stop_event.is_set():
        return {"status": "STOPPED_BEFORE_START", "job_id": job_id}

    # Reload status after any tailoring and queue only valid, unsubmitted jobs.
    current_job_snap = user_ref.collection("jobs").document(job_id).get()
    current_status = (
        JobStatus(current_job_snap.to_dict().get("status"))
        if current_job_snap.exists and current_job_snap.to_dict().get("status")
        else job.status
    )
    if current_status == JobStatus.APPLIED:
        return {"status": "ALREADY_APPLIED", "job_id": job_id}
    if current_status == JobStatus.AWAITING_APPROVAL:
        transition_job_state(job_id, JobStatus.APPLYING_QUEUED, user_id)
        current_status = JobStatus.APPLYING_QUEUED
    elif current_status == JobStatus.FAILED_NEEDS_MANUAL:
        transition_job_state(job_id, JobStatus.APPLYING_QUEUED, user_id)
        current_status = JobStatus.APPLYING_QUEUED
    elif current_status == JobStatus.DISCOVERED:
        transition_job_state(job_id, JobStatus.TAILORING_IN_PROGRESS, user_id)
        transition_job_state(job_id, JobStatus.AWAITING_APPROVAL, user_id)
        transition_job_state(job_id, JobStatus.APPLYING_QUEUED, user_id)
        current_status = JobStatus.APPLYING_QUEUED

    if current_status != JobStatus.APPLYING_QUEUED:
        raise ValueError("This application isn't ready to be sent right now. Please review it and try again.")

    if run.stop_event.is_set():
        return {"status": "STOPPED_BEFORE_START", "job_id": job_id}

    return await asyncio.to_thread(
        _execute_playwright_application_sync,
        job,
        profile,
        package,
        pdf_file_path,
        headless,
        simulate_otp_for_testing,
        user_id,
        run.stop_event,
    )

async def execute_job_application(
    job_id: str,
    headless: bool = True,
    simulate_otp_for_testing: bool = False,
    user_id: Optional[str] = None,
) -> dict:
    run = _start_application_run(user_id)
    try:
        return await _execute_job_application_with_run(
            job_id=job_id,
            run=run,
            headless=headless,
            simulate_otp_for_testing=simulate_otp_for_testing,
            user_id=user_id,
        )
    except ApplicationStopRequested:
        return {"status": "STOPPED_BEFORE_START", "job_id": job_id}
    finally:
        _finish_application_run(user_id, run)

async def run_queued_applications_batch(headless: bool = True, user_id: Optional[str] = None) -> dict:
    """Applies to all jobs in APPLYING_QUEUED up to the remaining Daily Application Limit."""
    run = _start_application_run(user_id)
    try:
        user_ref = get_user_ref(user_id)
        quota = get_daily_quota_status(user_id)
        remaining = quota["remaining_today"]

        if remaining <= 0:
            return {
                "status": "daily_limit_reached",
                "daily_quota": quota,
                "applied_results": [],
            }

        queued_docs = (
            user_ref.collection("jobs")
            .where("status", "==", JobStatus.APPLYING_QUEUED.value)
            .stream()
        )
        queued_jobs = [d.to_dict() for d in queued_docs][:remaining]

        results = []
        for job_data in queued_jobs:
            if run.stop_event.is_set():
                break
            result = await _execute_job_application_with_run(
                job_data["id"],
                run=run,
                headless=headless,
                user_id=user_id,
            )
            results.append(result)
            if run.stop_event.is_set():
                break

        return {
            "status": "stopped" if run.stop_event.is_set() else "completed",
            "processed_count": len(results),
            "daily_quota": get_daily_quota_status(user_id),
            "results": results,
        }
    finally:
        _finish_application_run(user_id, run)