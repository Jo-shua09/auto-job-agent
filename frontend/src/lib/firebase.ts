import { initializeApp, getApps, getApp } from "firebase/app";
import {
  type Auth,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const hasFirebaseConfig = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId,
);
const app = typeof window !== "undefined" && hasFirebaseConfig
  ? getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
  : null;
export const auth: Auth | null = app ? getAuth(app) : null;

function requireAuth(): Auth {
  if (!auth) {
    throw new Error(
      "Firebase authentication is not configured. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, and NEXT_PUBLIC_FIREBASE_APP_ID in the deployment environment, then rebuild.",
    );
  }
  return auth;
}

export function getFirebaseErrorMessage(error: unknown, fallback: string): string {
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "";

  switch (code) {
    case "auth/invalid-api-key":
    case "auth/operation-not-allowed":
      return "Sign-in is temporarily unavailable. Please try again later.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password combination doesn't match. Check your details and try again.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in instead.";
    case "auth/weak-password":
      return "Choose a stronger password with at least six characters.";
    case "auth/invalid-email":
      return "Enter a valid email address and try again.";
    case "auth/popup-closed-by-user":
      return "Sign-in was cancelled. Try again when you're ready.";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in window. Allow pop-ups and try again.";
    case "auth/network-request-failed":
      return "We couldn't connect. Check your internet connection and try again.";
    case "auth/too-many-requests":
      return "There have been too many attempts. Wait a little while, then try again.";
    default:
      return fallback;
  }
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

/**
 * Sends the real Firebase JWT (idToken) to our FastAPI backend (/api/auth/session)
 * to verify with Firebase Admin SDK and sync the user's Firestore Vault.
 */
async function syncSessionWithBackend(user: User, fullNameOverride?: string) {
  const idToken = await user.getIdToken(true);
  localStorage.setItem("vanguard_token", idToken);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id_token: idToken,
        full_name: fullNameOverride || user.displayName,
      }),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Your sign-in worked, but we couldn't finish setting up your workspace. Please try again shortly.");
    }
    throw error;
  }

  if (!res.ok) {
    throw new Error("We couldn't finish setting up your workspace. Please try signing in again.");
  }

  const data = await res.json();
  localStorage.setItem("vanguard_user", JSON.stringify(data.user));
  return data.user;
}

// 1. Real Email & Password Sign Up
export async function registerWithFirebaseEmail(fullName: string, email: string, pass: string) {
  const cred = await createUserWithEmailAndPassword(requireAuth(), email, pass);
  if (fullName) {
    await updateProfile(cred.user, { displayName: fullName });
  }
  return await syncSessionWithBackend(cred.user, fullName);
}

// 2. Real Email & Password Sign In
export async function loginWithFirebaseEmail(email: string, pass: string) {
  const cred = await signInWithEmailAndPassword(requireAuth(), email, pass);
  return await syncSessionWithBackend(cred.user);
}

// 3. Real "Continue with Google" Popup Sign In
export async function loginWithFirebaseGoogle() {
  const cred = await signInWithPopup(requireAuth(), new GoogleAuthProvider());
  return await syncSessionWithBackend(cred.user);
}

// 4. Sign Out
export async function logoutFirebaseUser() {
  await signOut(requireAuth());
  localStorage.removeItem("vanguard_token");
  localStorage.removeItem("vanguard_user");
}

// 5. Helper to get a fresh Bearer header for any FastAPI call
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const currentUser = auth?.currentUser;
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
