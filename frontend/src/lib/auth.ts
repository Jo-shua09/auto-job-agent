const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
const TOKEN_KEY = "vanguard_token";
const USER_KEY = "vanguard_user";
const SESSION_EVENT = "verdant-auth-change";

type AuthResponse = {
  authenticated: boolean;
  token: string;
  user: { user_id: string; email: string; full_name: string; photo_url?: string | null };
};

function notifySessionChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EVENT));
}

function storeSession(response: AuthResponse) {
  localStorage.setItem(TOKEN_KEY, response.token);
  localStorage.setItem(USER_KEY, JSON.stringify(response.user));
  notifySessionChange();
  return response.user;
}

async function authenticate(path: string, payload: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("We couldn't connect to your workspace. Check your internet connection and try again.");
    }
    throw error;
  }
  if (!response.ok) {
    let message = "We couldn't complete sign-in. Please check your details and try again.";
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") {
        message = body.detail;
      }
    } catch {
      // Keep the generic message when the server does not return JSON.
    }
    throw new Error(message);
  }
  return storeSession((await response.json()) as AuthResponse);
}

export function registerWithEmail(fullName: string, email: string, password: string) {
  return authenticate("/api/auth/register", { full_name: fullName, email, password });
}

export function loginWithEmail(email: string, password: string) {
  return authenticate("/api/auth/login", { email, password });
}

export function loginWithGoogle(credential: string) {
  return authenticate("/api/auth/google", { credential });
}

export function logoutUser() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  notifySessionChange();
}

export function getAuthToken() {
  return typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function onSessionChange(callback: () => void) {
  window.addEventListener(SESSION_EVENT, callback);
  return () => window.removeEventListener(SESSION_EVENT, callback);
}
