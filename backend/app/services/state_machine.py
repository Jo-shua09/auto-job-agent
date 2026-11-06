from datetime import datetime, timezone
from app.models.schemas import JobStatus
from app.core.database import get_user_ref

ALLOWED_TRANSITIONS: dict[JobStatus, set[JobStatus]] = {
    JobStatus.DISCOVERED: {
        JobStatus.ARCHIVED_LOW_MATCH,
        JobStatus.TAILORING_IN_PROGRESS,
    },
    JobStatus.TAILORING_IN_PROGRESS: {
        JobStatus.AWAITING_APPROVAL,
        JobStatus.FAILED_NEEDS_MANUAL,
    },
    JobStatus.AWAITING_APPROVAL: {
        JobStatus.APPLYING_QUEUED,
        JobStatus.SKIPPED,
        JobStatus.TAILORING_IN_PROGRESS,  # Re-generate if requested
    },
    JobStatus.APPLYING_QUEUED: {
        JobStatus.APPLYING_ACTIVE,
        JobStatus.SKIPPED,
    },
    JobStatus.APPLYING_ACTIVE: {
        JobStatus.WAITING_FOR_OTP,
        JobStatus.APPLIED,
        JobStatus.FAILED_NEEDS_MANUAL,
    },
    JobStatus.WAITING_FOR_OTP: {
        JobStatus.APPLYING_ACTIVE,
        JobStatus.APPLIED,
        JobStatus.FAILED_NEEDS_MANUAL,
    },
    JobStatus.FAILED_NEEDS_MANUAL: {
        JobStatus.APPLYING_QUEUED,  # Retry
        JobStatus.APPLIED,          # Marked applied manually
        JobStatus.SKIPPED,
    },
    JobStatus.APPLIED: {
        JobStatus.REPLIED_REJECTED,
        JobStatus.INTERVIEW_INVITE,
        JobStatus.OFFER_STAGE,
    },
    JobStatus.INTERVIEW_INVITE: {
        JobStatus.OFFER_STAGE,
        JobStatus.REPLIED_REJECTED,
    },
}

def transition_job_state(job_id: str, new_status: JobStatus, user_id: str | None = None) -> dict:
    """Validates and executes a state transition for a job document in Firestore."""
    job_ref = get_user_ref(user_id).collection("jobs").document(job_id)
    snap = job_ref.get()

    if not snap.exists:
        raise ValueError(f"Job {job_id} does not exist in Firestore.")

    data = snap.to_dict()
    current_status = JobStatus(data["status"])

    if new_status not in ALLOWED_TRANSITIONS.get(current_status, set()):
        raise ValueError(
            f"Illegal state transition for Job {job_id}: {current_status.value} -> {new_status.value}"
        )

    update_payload = {
        "status": new_status.value,
        "updated_at": datetime.now(timezone.utc),
    }

    if new_status == JobStatus.APPLIED:
        update_payload["applied_at"] = datetime.now(timezone.utc)

    job_ref.update(update_payload)
    return {"job_id": job_id, "previous": current_status.value, "current": new_status.value}