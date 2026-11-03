import os
from contextvars import ContextVar
import firebase_admin
from firebase_admin import credentials, firestore, storage
from dotenv import load_dotenv

load_dotenv()

cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "./credentials/serviceAccountKey.json")
project_id = os.getenv("FIREBASE_PROJECT_ID")
bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET")

if not firebase_admin._apps:
    if os.path.exists(cred_path):
        # Uses JSON file if present
        cred = credentials.Certificate(cred_path)
    else:
        # Keyless fallback using `gcloud auth application-default login`
        cred = credentials.ApplicationDefault()

    firebase_admin.initialize_app(cred, {
        "projectId": project_id,
        "storageBucket": bucket_name,
    })

db = firestore.client()
bucket = storage.bucket()
current_tenant_id: ContextVar[str | None] = ContextVar("current_tenant_id", default=None)

def get_user_ref(user_id: str | None = None):
    """Returns the root Firestore document reference for a tenant (SaaS-ready)."""
    uid = user_id or current_tenant_id.get()
    if not uid:
        raise RuntimeError("A signed-in Firebase tenant is required.")
    return db.collection("users").document(uid)