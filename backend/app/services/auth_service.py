import os
import httpx
from datetime import datetime, timezone
from typing import Optional
from fastapi import Header, HTTPException
from firebase_admin import auth as firebase_auth

from app.core.firebase import db, get_user_ref
from app.services.profile_service import clean_no_em_dash

def resolve_tenant_uid(firebase_uid: str, email: str = "") -> str:
    """Keep every account's Firestore data isolated by its Firebase UID."""
    return firebase_uid

def sync_firebase_user_to_firestore(
    firebase_uid: str,
    email: str,
    full_name: Optional[str] = None,
    photo_url: Optional[str] = None,
) -> dict:
    """
    Creates or updates the user's Firestore tenant document (`users/{uid}`).
    """
    tenant_uid = resolve_tenant_uid(firebase_uid, email)
    user_ref = get_user_ref(tenant_uid)
    snap = user_ref.get()
    existing = snap.to_dict() if snap.exists else {}

    display_name = clean_no_em_dash(
        full_name or existing.get("full_name") or email.split("@")[0].title()
    )

    user_payload = {
        "user_id": tenant_uid,
        "firebase_uid": firebase_uid,
        "email": email.lower(),
        "full_name": display_name,
        "photo_url": photo_url or existing.get("photo_url"),
        "role": existing.get("role", "member"),
        "agent_mode": existing.get("agent_mode", "95_PERCENT_AUTO"),
        "last_login_at": datetime.now(timezone.utc).isoformat(),
    }
    if not existing.get("created_at"):
        user_payload["created_at"] = datetime.now(timezone.utc).isoformat()

    user_ref.set(user_payload, merge=True)

    return user_payload

def verify_real_firebase_id_token(id_token: str) -> dict:
    """
    Verifies a real Firebase ID Token (JWT) from the frontend Firebase SDK
    using firebase_admin.auth.verify_id_token().
    """
    try:
        decoded = firebase_auth.verify_id_token(id_token, check_revoked=False)
    except Exception as e:
        raise ValueError(f"Invalid or expired Firebase ID token: {str(e)}")

    firebase_uid = decoded["uid"]
    email = decoded.get("email") or f"{firebase_uid}@firebase.user"
    name = decoded.get("name")
    picture = decoded.get("picture")

    user_record = sync_firebase_user_to_firestore(
        firebase_uid=firebase_uid,
        email=email,
        full_name=name,
        photo_url=picture,
    )
    return {
        "authenticated": True,
        "user": user_record,
    }

async def get_current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    """FastAPI dependency that requires a real Firebase ID token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="A Firebase bearer token is required.")
    token = authorization.replace("Bearer ", "", 1).strip()
    try:
        verified = verify_real_firebase_id_token(token)
        return verified["user"]
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

# --- OPTIONAL: REST API SIGN-IN/SIGN-UP FOR TESTING DIRECTLY IN SWAGGER /DOCS ---

async def firebase_rest_email_signup_or_login(
    email: str,
    password: str,
    full_name: Optional[str] = None,
    is_signup: bool = False,
) -> dict:
    """
    Uses Firebase Auth REST API (if FIREBASE_WEB_API_KEY is in .env) or Admin SDK
    so you can test real Firebase Email/Password creation right inside http://localhost:8000/docs!
    """
    web_api_key = os.getenv("FIREBASE_WEB_API_KEY")

    if is_signup and not web_api_key:
        # Create user directly in Firebase Auth via Admin SDK if Web API Key isn't in .env yet
        try:
            fb_user = firebase_auth.create_user(
                email=email.strip(),
                password=password,
                display_name=full_name or email.split("@")[0].title(),
            )
        except firebase_auth.EmailAlreadyExistsError:
            fb_user = firebase_auth.get_user_by_email(email.strip())

        user_doc = sync_firebase_user_to_firestore(
            firebase_uid=fb_user.uid,
            email=fb_user.email,
            full_name=fb_user.display_name,
        )
        custom_token = firebase_auth.create_custom_token(fb_user.uid).decode("utf-8")
        return {"authenticated": True, "custom_token": custom_token, "user": user_doc}

    if not web_api_key:
        raise ValueError(
            "Add FIREBASE_WEB_API_KEY=AIzaSy... to backend/.env to use password sign-in via REST, "
            "or sign in directly from the Frontend using the Firebase Web SDK."
        )

    endpoint = "signUp" if is_signup else "signInWithPassword"
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:{endpoint}?key={web_api_key}"

    async with httpx.AsyncClient(timeout=12.0) as client:
        resp = await client.post(
            url,
            json={"email": email.strip(), "password": password, "returnSecureToken": True},
        )
        data = resp.json()
        if resp.status_code != 200:
            err_msg = data.get("error", {}).get("message", "Firebase Authentication failed")
            raise ValueError(f"Firebase Auth Error: {err_msg}")

        id_token = data["idToken"]
        firebase_uid = data["localId"]

        if is_signup and full_name:
            try:
                firebase_auth.update_user(firebase_uid, display_name=full_name)
            except Exception:
                pass

        user_doc = sync_firebase_user_to_firestore(
            firebase_uid=firebase_uid,
            email=email.strip(),
            full_name=full_name,
        )
        return {
            "authenticated": True,
            "id_token": id_token,
            "refresh_token": data.get("refreshToken"),
            "user": user_doc,
        }