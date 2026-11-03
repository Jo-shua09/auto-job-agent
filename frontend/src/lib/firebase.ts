import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "job-agent-core",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Sends the real Firebase JWT (idToken) to our FastAPI backend (/api/auth/session)
 * to verify with Firebase Admin SDK and sync the user's Firestore Vault.
 */
async function syncSessionWithBackend(user: User, fullNameOverride?: string) {
  const idToken = await user.getIdToken(true);
  localStorage.setItem("vanguard_token", idToken);

  const res = await fetch(`${API_BASE}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_token: idToken,
      full_name: fullNameOverride || user.displayName,
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Backend session verification failed");
  }

  const data = await res.json();
  localStorage.setItem("vanguard_user", JSON.stringify(data.user));
  return data.user;
}

// 1. Real Email & Password Sign Up
export async function registerWithFirebaseEmail(fullName: string, email: string, pass: string) {
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  if (fullName) {
    await updateProfile(cred.user, { displayName: fullName });
  }
  return await syncSessionWithBackend(cred.user, fullName);
}

// 2. Real Email & Password Sign In
export async function loginWithFirebaseEmail(email: string, pass: string) {
  const cred = await signInWithEmailAndPassword(auth, email, pass);
  return await syncSessionWithBackend(cred.user);
}

// 3. Real "Continue with Google" Popup Sign In
export async function loginWithFirebaseGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  return await syncSessionWithBackend(cred.user);
}

// 4. Sign Out
export async function logoutFirebaseUser() {
  await signOut(auth);
  localStorage.removeItem("vanguard_token");
  localStorage.removeItem("vanguard_user");
}

// 5. Helper to get a fresh Bearer header for any FastAPI call
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const currentUser = auth.currentUser;
  if (currentUser) {
    const freshToken = await currentUser.getIdToken();
    localStorage.setItem("vanguard_token", freshToken);
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${freshToken}`,
    };
  }
  const cached = localStorage.getItem("vanguard_token");
  return cached ? { "Content-Type": "application/json", Authorization: `Bearer ${cached}` } : { "Content-Type": "application/json" };
}

export { onAuthStateChanged };
