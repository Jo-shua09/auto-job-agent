import base64
import hashlib
import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import Header, HTTPException
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from pymongo.errors import DuplicateKeyError

from app.core.database import db, ensure_indexes, get_user_ref

PASSWORD_SCRYPT_N = 1 << 14
PASSWORD_SCRYPT_R = 8
PASSWORD_SCRYPT_P = 1
TOKEN_LIFETIME = timedelta(days=7)


def _jwt_secret() -> str:
    secret = os.getenv("AUTH_JWT_SECRET", "")
    if len(secret) < 32:
        raise HTTPException(
            status_code=503,
            detail="Authentication is not configured. Set AUTH_JWT_SECRET to a random value of at least 32 characters.",
        )
    return secret


def _normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    if normalized.count("@") != 1 or "." not in normalized.rsplit("@", 1)[-1]:
        raise ValueError("Enter a valid email address.")
    return normalized


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=PASSWORD_SCRYPT_N,
        r=PASSWORD_SCRYPT_R,
        p=PASSWORD_SCRYPT_P,
        dklen=64,
    )
    salt_value = base64.urlsafe_b64encode(salt).decode("ascii")
    digest_value = base64.urlsafe_b64encode(derived).decode("ascii")
    return f"scrypt${salt_value}${digest_value}"


def _verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        algorithm, salt_value, digest_value = password_hash.split("$", 2)
        if algorithm != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(salt_value.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_value.encode("ascii"))
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=PASSWORD_SCRYPT_N,
            r=PASSWORD_SCRYPT_R,
            p=PASSWORD_SCRYPT_P,
            dklen=len(expected),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "full_name": user.get("full_name", ""),
        "photo_url": user.get("photo_url"),
        "role": user.get("role", "member"),
        "agent_mode": user.get("agent_mode", "95_PERCENT_AUTO"),
    }


def _issue_session(user: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "sub": user["user_id"],
            "iat": now,
            "exp": now + TOKEN_LIFETIME,
            "iss": "verdant-api",
        },
        _jwt_secret(),
        algorithm="HS256",
    )
    return {"authenticated": True, "token": token, "user": _public_user(user)}


def register_email_user(email: str, password: str, full_name: str | None = None) -> dict:
    _jwt_secret()
    normalized_email = _normalize_email(email)
    ensure_indexes()
    if db.users.find_one({"email": normalized_email}, {"_id": 1}):
        raise ValueError("An account with this email already exists. Try signing in instead.")

    user_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    user = {
        "user_id": user_id,
        "email": normalized_email,
        "full_name": (full_name or "").strip() or normalized_email.split("@")[0].title(),
        "password_hash": _hash_password(password),
        "auth_provider": "password",
        "role": "member",
        "agent_mode": "95_PERCENT_AUTO",
        "created_at": now,
        "last_login_at": now,
    }
    try:
        get_user_ref(user_id).set(user)
    except DuplicateKeyError as error:
        raise ValueError("An account with this email already exists. Try signing in instead.") from error
    return _issue_session(user)


def login_email_user(email: str, password: str) -> dict:
    _jwt_secret()
    normalized_email = _normalize_email(email)
    ensure_indexes()
    user = db.users.find_one({"email": normalized_email})
    if not user or not _verify_password(password, user.get("password_hash")):
        raise ValueError("That email and password combination doesn't match.")

    now = datetime.now(timezone.utc).isoformat()
    get_user_ref(user["user_id"]).update({"last_login_at": now})
    user["last_login_at"] = now
    return _issue_session(user)


def login_google_user(credential: str) -> dict:
    _jwt_secret()
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        raise HTTPException(
            status_code=503,
            detail="Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the backend.",
        )
    try:
        claims = id_token.verify_oauth2_token(credential, Request(), audience=client_id)
    except (ValueError, jwt.InvalidTokenError) as error:
        raise ValueError("Google sign-in could not be verified. Please try again.") from error

    email = claims.get("email")
    if not email or claims.get("email_verified") is not True:
        raise ValueError("Google must provide a verified email address to create an account.")

    normalized_email = _normalize_email(email)
    ensure_indexes()
    now = datetime.now(timezone.utc).isoformat()
    user = db.users.find_one({"email": normalized_email})
    if user:
        updates: dict[str, Any] = {
            "last_login_at": now,
            "google_sub": claims.get("sub"),
        }
        if not user.get("full_name") and claims.get("name"):
            updates["full_name"] = claims["name"]
        if claims.get("picture") and not user.get("photo_url"):
            updates["photo_url"] = claims["picture"]
        get_user_ref(user["user_id"]).update(updates)
        user.update(updates)
    else:
        user_id = uuid.uuid4().hex
        user = {
            "user_id": user_id,
            "email": normalized_email,
            "full_name": claims.get("name") or normalized_email.split("@")[0].title(),
            "photo_url": claims.get("picture"),
            "google_sub": claims.get("sub"),
            "auth_provider": "google",
            "role": "member",
            "agent_mode": "95_PERCENT_AUTO",
            "created_at": now,
            "last_login_at": now,
        }
        try:
            get_user_ref(user_id).set(user)
        except DuplicateKeyError as error:
            raise ValueError("An account with this email already exists. Sign in with that account.") from error
    return _issue_session(user)


async def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="A Verdant bearer token is required.")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        claims = jwt.decode(
            token,
            _jwt_secret(),
            algorithms=["HS256"],
            issuer="verdant-api",
            options={"require": ["exp", "iat", "sub", "iss"]},
        )
    except jwt.ExpiredSignatureError as error:
        raise HTTPException(status_code=401, detail="Your session has expired. Sign in again.") from error
    except jwt.InvalidTokenError as error:
        raise HTTPException(status_code=401, detail="Your session is invalid. Sign in again.") from error

    user = db.users.find_one({"_id": claims["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="This account is no longer available.")
    return _public_user(user)