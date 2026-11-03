/** Flip this when running alongside your own Python service. All HTTP lives here. */
export const USE_LOCAL_PYTHON_API = false;
const API_URL = "http://localhost:8000";

export async function apiRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (!USE_LOCAL_PYTHON_API) throw new Error("Local API is disabled in demo mode.");
  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Your local service returned ${response.status}. Please try again.`);
  return response.json() as Promise<T>;
}

export const localApi = {
  scout: (roles: string[]) => apiRequest("/api/scout/run", "POST", { roles }),
  paste: (text: string, autoQueue: boolean) => apiRequest("/api/scout/paste-job", "POST", { text, auto_queue: autoQueue }),
  jobs: () => apiRequest("/api/jobs"),
  history: () => apiRequest("/api/jobs/history-by-day"),
  approve: (id: string) => apiRequest(`/api/jobs/${encodeURIComponent(id)}/approve`, "POST"),
  skip: (id: string) => apiRequest(`/api/jobs/${encodeURIComponent(id)}/skip`, "POST"),
  otp: (id: string, code: string) => apiRequest(`/api/jobs/${encodeURIComponent(id)}/submit-otp`, "POST", { code }),
};

export interface DemoUser {
  name: string;
  email: string;
}
export const DEMO_USER: DemoUser = { name: "Joshua Onyeka Ituma", email: "joshua@example.com" };
const SESSION_KEY = "jh-demo-session";

export function getDemoUser(): DemoUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const user: unknown = JSON.parse(raw);
    if (
      typeof user === "object" &&
      user !== null &&
      "name" in user &&
      "email" in user &&
      typeof user.name === "string" &&
      typeof user.email === "string"
    )
      return { name: user.name, email: user.email };
    return null;
  } catch {
    return null;
  }
}

/** Presentation-only sign-in. No credentials are stored or sent. Not a security boundary. */
export function demoSignIn(email = DEMO_USER.email, name = DEMO_USER.name) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ email, name }));
}
export function demoSignOut() {
  localStorage.removeItem(SESSION_KEY);
}
