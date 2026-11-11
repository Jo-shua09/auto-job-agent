import os
import re
import uuid
import imaplib
import email
from email.header import decode_header
from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel, Field
from google.genai import types

from app.core.gemini_client import create_gemini_client
from app.core.database import get_user_ref
from app.models.schemas import JobStatus
from app.services.profile_service import clean_no_em_dash
from app.services.scout_service import log_agent_step
from app.services.state_machine import transition_job_state

# --- 1. EMAIL CLASSIFICATION SCHEMA (p7_2) ---

class EmailClassificationCategory(str):
    CONFIRMATION = "CONFIRMATION"
    ASSESSMENT = "ASSESSMENT"
    INTERVIEW_INVITE = "INTERVIEW_INVITE"
    OFFER = "OFFER"
    REJECTION = "REJECTION"
    UNRELATED = "UNRELATED"

class EmailEvaluationResult(BaseModel):
    category: str = Field(
        description="One of: CONFIRMATION, ASSESSMENT, INTERVIEW_INVITE, OFFER, REJECTION, UNRELATED"
    )
    matched_company_name: Optional[str] = Field(
        default=None,
        description="The company name this email is from or about.",
    )
    summary_note: str = Field(
        description="1 concise plain-English sentence summarizing the email for the user's dashboard. No em-dashes."
    )
    action_required: Optional[str] = Field(
        default=None,
        description="If INTERVIEW_INVITE or ASSESSMENT, state what action the user needs to take (e.g. 'Book Calendly link')."
    )

def classify_recruiter_email_with_gemini(
    sender: str,
    subject: str,
    body_snippet: str,
    applied_companies: List[str],
) -> EmailEvaluationResult:
    """Classifies an incoming email using Gemini 2.5 Flash (with deterministic keyword fallback)."""
    combined_low = f"{sender} {subject} {body_snippet}".lower()

    # Detect which applied company matches the sender or subject
    detected_co = None
    for co in applied_companies:
        co_clean = re.sub(r"[^a-z0-9]", "", co.lower())
        if co.lower() in combined_low or (len(co_clean) > 3 and co_clean in combined_low):
            detected_co = co
            break

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "your_gemini_api_key_here":
        if any(w in combined_low for w in ["unfortunately", "not moving forward", "other candidates", "regret to inform"]):
            cat = "REJECTION"
            note = f"Update from {detected_co or sender}: Application was not selected for the next stage."
            act = None
        elif any(w in combined_low for w in ["interview", "schedule a call", "calendly", "chat with our team", "next steps"]):
            cat = "INTERVIEW_INVITE"
            note = f"Interview invitation received from {detected_co or sender}!"
            act = "Reply or book a time on their scheduling link."
        elif any(w in combined_low for w in ["hackerrank", "codesignal", "assessment", "take-home", "coding challenge"]):
            cat = "ASSESSMENT"
            note = f"Technical assessment link received from {detected_co or sender}."
            act = "Complete the technical assessment."
        elif any(w in combined_low for w in ["received your application", "thank you for applying", "application confirmation"]):
            cat = "CONFIRMATION"
            note = f"Application confirmation logged from {detected_co or sender}."
            act = None
        else:
            cat = "UNRELATED"
            note = "Unrelated inbox message."
            act = None

        return EmailEvaluationResult(
            category=cat,
            matched_company_name=detected_co,
            summary_note=clean_no_em_dash(note),
            action_required=clean_no_em_dash(act) if act else None,
        )

    client = create_gemini_client(api_key)
    prompt = f"""
    Classify this incoming email for a candidate tracking job applications.

    CANDIDATE'S APPLIED COMPANIES: {applied_companies}
    EMAIL SENDER: {sender}
    EMAIL SUBJECT: {subject}
    EMAIL SNIPPET:
    {body_snippet[:2500]}

    RULES:
    1. Set category to one of: CONFIRMATION, ASSESSMENT, INTERVIEW_INVITE, OFFER, REJECTION, UNRELATED.
    2. Match matched_company_name to one of the CANDIDATE'S APPLIED COMPANIES if applicable, or extract the company name from the email.
    3. Never use long em-dashes (—) or en-dashes (–). Use standard hyphens (-) only.
    """
    try:
        resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=EmailEvaluationResult,
                temperature=0.0,
            ),
        )
        res = EmailEvaluationResult.model_validate_json(resp.text)
        res.summary_note = clean_no_em_dash(res.summary_note)
        if res.action_required:
            res.action_required = clean_no_em_dash(res.action_required)
        return res
    except Exception:
        return EmailEvaluationResult(
            category="CONFIRMATION",
            matched_company_name=detected_co,
            summary_note=f"Logged email from {detected_co or sender}: {subject[:60]}",
        )

# --- 2. PROCESS & LINK EMAIL EVENT TO FIRESTORE JOB STATE ---

def process_and_record_email_event(
    message_id: str,
    sender: str,
    subject: str,
    snippet: str,
    user_id: Optional[str] = None,
) -> dict:
    """
    Classifies an email, matches it to an active/applied job in Firestore,
    auto-transitions the job state (e.g. APPLIED -> INTERVIEW_INVITE or REPLIED_REJECTED),
    and logs a plain-English step in the Lovable Activity Stream.
    """
    user_ref = get_user_ref(user_id)
    events_col = user_ref.collection("email_events")

    # Deduplicate by message_id
    existing_snap = events_col.document(message_id).get()
    if existing_snap.exists:
        return {"status": "already_processed", "event": existing_snap.to_dict()}

    # Load all jobs to match company names
    all_jobs = [d.to_dict() for d in user_ref.collection("jobs").stream()]
    applied_jobs = [
        j for j in all_jobs
        if j.get("status") in {
            JobStatus.APPLIED.value,
            JobStatus.INTERVIEW_INVITE.value,
            JobStatus.APPLYING_QUEUED.value,
        }
    ]
    company_names = list({j["company_name"] for j in applied_jobs if j.get("company_name")})

    evaluation = classify_recruiter_email_with_gemini(
        sender=sender,
        subject=subject,
        body_snippet=snippet,
        applied_companies=company_names,
    )

    # Find matching job_id
    matched_job = None
    if evaluation.matched_company_name:
        target_co_low = evaluation.matched_company_name.lower()
        for j in applied_jobs:
            if j.get("company_name", "").lower() in target_co_low or target_co_low in j.get("company_name", "").lower():
                matched_job = j
                break

    job_id = matched_job["id"] if matched_job else None
    new_job_status = None

    # Auto-transition job state based on email classification
    if matched_job and job_id:
        if evaluation.category in {"INTERVIEW_INVITE", "ASSESSMENT"}:
            try:
                transition_job_state(job_id, JobStatus.INTERVIEW_INVITE, user_id)
                new_job_status = JobStatus.INTERVIEW_INVITE.value
            except ValueError:
                pass
        elif evaluation.category == "OFFER":
            try:
                transition_job_state(job_id, JobStatus.OFFER_STAGE, user_id)
                new_job_status = JobStatus.OFFER_STAGE.value
            except ValueError:
                pass
        elif evaluation.category == "REJECTION":
            try:
                transition_job_state(job_id, JobStatus.REPLIED_REJECTED, user_id)
                new_job_status = JobStatus.REPLIED_REJECTED.value
            except ValueError:
                pass

        # Attach latest email badge directly onto the job document for easy UI rendering
        user_ref.collection("jobs").document(job_id).set(
            {
                "last_email_category": evaluation.category,
                "last_email_note": evaluation.summary_note,
                "last_email_received_at": datetime.now(timezone.utc).isoformat(),
            },
            merge=True,
        )

    event_payload = clean_no_em_dash({
        "id": message_id,
        "job_id": job_id,
        "company_name": matched_job["company_name"] if matched_job else evaluation.matched_company_name,
        "role_title": matched_job["role_title"] if matched_job else None,
        "sender": sender,
        "subject": subject,
        "snippet": snippet[:500],
        "classification": evaluation.category,
        "summary_note": evaluation.summary_note,
        "action_required": evaluation.action_required,
        "updated_job_status": new_job_status,
        "received_at": datetime.now(timezone.utc).isoformat(),
    })

    events_col.document(message_id).set(event_payload)

    if evaluation.category != "UNRELATED":
        log_agent_step(
            f"Inbox Update ({evaluation.category}): {event_payload.get('company_name') or sender}",
            evaluation.summary_note,
            phase="INBOX",
            job_id=job_id,
            status="completed",
            user_id=user_id,
        )

    return {"status": "processed", "event": event_payload}

# --- 3. GMAIL READ-ONLY IMAP WATCHER (p7_1) ---

def _decode_mime_Text(raw_val: str) -> str:
    if not raw_val:
        return ""
    decoded_parts = decode_header(raw_val)
    out = []
    for content, enc in decoded_parts:
        if isinstance(content, bytes):
            out.append(content.decode(enc or "utf-8", errors="ignore"))
        else:
            out.append(str(content))
    return "".join(out)

def poll_gmail_inbox_sync(max_emails: int = 10, user_id: Optional[str] = None) -> dict:
    """
    Connects to Gmail via IMAP (Read-Only) if GMAIL_ADDRESS and GMAIL_APP_PASSWORD
    are set in backend/.env, scanning the latest unseen/recent emails from applied companies.
    """
    gmail_user = os.getenv("GMAIL_ADDRESS")
    gmail_app_password = os.getenv("GMAIL_APP_PASSWORD")

    if not gmail_user or not gmail_app_password:
        return {
            "status": "gmail_credentials_not_configured",
            "hint": (
                "To enable live Gmail polling, add GMAIL_ADDRESS and a 16-char GMAIL_APP_PASSWORD "
                "to backend/.env (or use POST /api/inbox/simulate-email to test email classification)."
            ),
            "processed_events": [],
        }

    processed = []
    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com")
        mail.login(gmail_user, gmail_app_password)
        mail.select("inbox", readonly=True)

        status, data = mail.search(None, "ALL")
        if status != "OK" or not data or not data[0]:
            mail.logout()
            return {"status": "ok", "processed_events": []}

        mail_ids = data[0].split()[-max_emails:]
        for m_id in reversed(mail_ids):
            res, msg_data = mail.fetch(m_id, "(RFC822)")
            if res != "OK":
                continue
            for response_part in msg_data:
                if isinstance(response_part, tuple):
                    msg = email.message_from_bytes(response_part[1])
                    subject = _decode_mime_Text(msg.get("Subject", ""))
                    sender = _decode_mime_Text(msg.get("From", ""))
                    msg_uid = msg.get("Message-ID") or f"imap_{m_id.decode()}"
                    clean_id = re.sub(r"[^a-zA-Z0-9_-]", "", msg_uid)[:40]

                    body_text = ""
                    if msg.is_multipart():
                        for part in msg.walk():
                            if part.get_content_type() == "text/plain":
                                payload = part.get_payload(decode=True)
                                if payload:
                                    body_text = payload.decode(errors="ignore")
                                    break
                    else:
                        payload = msg.get_payload(decode=True)
                        if payload:
                            body_text = payload.decode(errors="ignore")

                    ev = process_and_record_email_event(
                        message_id=clean_id,
                        sender=sender,
                        subject=subject,
                        snippet=body_text[:1000],
                        user_id=user_id,
                    )
                    if ev["event"]["classification"] != "UNRELATED":
                        processed.append(ev["event"])

        mail.logout()
        return {"status": "polled", "matched_events_count": len(processed), "processed_events": processed}
    except Exception as e:
        return {"status": "error", "error": str(e), "processed_events": processed}

def list_email_events(user_id: Optional[str] = None) -> List[dict]:
    """Returns all classified recruiter email events from Firestore, newest first."""
    user_ref = get_user_ref(user_id)
    docs = [d.to_dict() for d in user_ref.collection("email_events").stream()]
    return sorted(docs, key=lambda x: x.get("received_at", ""), reverse=True)