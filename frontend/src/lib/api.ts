import { getAuthHeaders } from "./firebase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function apiRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.detail || `The service returned ${response.status}. Please try again.`);
  }
  return response.json() as Promise<T>;
}

export async function uploadCv(file: File) {
  const headers = await getAuthHeaders();
  delete headers["Content-Type"];
  const data = new FormData();
  data.append("file", file);
  const response = await fetch(`${API_URL}/api/vault/upload-cv`, {
    method: "POST",
    headers,
    body: data,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.detail || `The service returned ${response.status}.`);
  }
  return response.json();
}

export { API_URL };
