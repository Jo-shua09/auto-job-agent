import { getAuthHeaders } from "./firebase";

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
export const API_URL = API_BASE;

async function getErrorMessage(response: Response): Promise<string> {
  let detail: unknown;
  try {
    const data: unknown = await response.json();
    if (data && typeof data === "object" && "detail" in data) detail = data.detail;
  } catch {
    // Use the status-based message below when the response is not JSON.
  }

  if (response.status >= 500) return "The job service is temporarily unavailable. Please try again shortly.";
  if (typeof detail === "string" && detail.trim() && !/(firebase|traceback|exception|api key|environment variable|stack trace|internal server|auth\/)/i.test(detail)) {
    return detail;
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item && typeof item === "object" && "msg" in item ? item.msg : null))
      .filter((message): message is string => typeof message === "string");
    return messages.length ? messages.join(". ") : "Some information is missing or invalid. Review the form and try again.";
  }

  if (response.status === 401) return "Your session has expired. Sign in again to continue.";
  if (response.status === 403) return "You don't have permission to do that.";
  if (response.status === 404) return "We couldn't find that item. Refresh the page and try again.";
  if (response.status === 429) return "There have been too many requests. Wait a moment, then try again.";
  return `We couldn't complete that request (error ${response.status}). Please try again.`;
}

export async function apiRequest<T>(path: string, optionsOrMethod: RequestInit | string = {}, body?: unknown): Promise<T> {
  const options: RequestInit =
    typeof optionsOrMethod === "string"
      ? { method: optionsOrMethod, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }
      : optionsOrMethod;
  const authHeaders = await getAuthHeaders();
  const headers = new Headers(authHeaders);
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));

  if (typeof FormData !== "undefined" && options.body instanceof FormData) headers.delete("Content-Type");

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: options.credentials ?? "omit",
      headers,
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("We couldn't connect to your workspace right now. Check your internet connection and try again.");
    }
    throw error;
  }

  if (!res.ok) throw new Error(await getErrorMessage(res));
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ==========================================
// 1. MASTER PROFILE VAULT & CV UPLOAD (/vault)
// ==========================================

export interface ExperienceItem {
  id: string;
  company: string;
  role_title: string;
  location: string;
  start_date: string;
  end_date: string;
  role_tags: string[];
  verified_bullets: string[];
  tech_used: string[];
}

export interface ProjectItem {
  id: string;
  name: string;
  role: string;
  live_url?: string;
  github_url?: string;
  role_tags: string[];
  tech_stack: string[];
  verified_bullets: string[];
  awards_or_metrics?: string;
}

export interface EducationItem {
  institution: string;
  degree: string;
  location: string;
  dates: string;
}

export interface MasterProfile {
  user_id?: string;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  portfolio_url?: string;
  github_url: string;
  linkedin_url: string;
  summary_template: string;
  experiences: ExperienceItem[];
  projects: ProjectItem[];
  education: EducationItem[];
  skills_by_category: Record<string, string[]>;
  application_defaults: {
    notice_period: string;
    expected_salary: string;
    work_authorization: string;
    requires_sponsorship: string;
    preferred_work_mode: string;
  };
  is_onboarded?: boolean;
}

export const getMasterVault = () => apiRequest<MasterProfile>("/api/vault");

export const saveMasterVault = (profile: MasterProfile) =>
  apiRequest<MasterProfile>("/api/vault", {
    method: "PUT",
    body: JSON.stringify(profile),
  });

export const resetWorkspaceToBlank = () =>
  apiRequest<{ profile: MasterProfile; scout_preferences: ScoutPreferences }>("/api/vault/reset", {
    method: "POST",
  });

export const uploadBaseCvPdf = async (file: File) => {
  const formData = new FormData();
  formData.append("file", file);
  return apiRequest<{ status: string; profile: MasterProfile }>("/api/vault/upload-cv", {
    method: "POST",
    body: formData,
  });
};

export const uploadCv = uploadBaseCvPdf;

export const testCompileRolePdf = (customRoleTitle: string) =>
  apiRequest<{
    status: string;
    target_role: string;
    selected_projects: string[];
    preview_url: string;
  }>(`/api/vault/test-pdf?custom_role_title=${encodeURIComponent(customRoleTitle)}`, {
    method: "POST",
  });

// ==========================================
// 2. SCOUT PREFERENCES & DAILY QUOTA (/)
// ==========================================

export interface TargetRoleConfig {
  id: string;
  title: string;
  active: boolean;
  priority_keywords: string[];
}

export interface ScoutPreferences {
  user_id?: string;
  target_roles: TargetRoleConfig[];
  preferred_locations: string[];
  work_modes: string[]; // ["REMOTE", "HYBRID", "ONSITE"]
  excluded_keywords: string[];
  min_match_score: number;
  daily_apply_limit: number;
  target_ats_domains?: string[];
  custom_job_domains?: string[];
}

export interface DailyQuotaStatus {
  date: string;
  daily_apply_limit: number;
  applied_today: number;
  remaining_today: number;
  can_apply_more_today: boolean;
}

export const getScoutPreferences = () => apiRequest<ScoutPreferences>("/api/scout/preferences");

export const saveScoutPreferences = (prefs: ScoutPreferences) =>
  apiRequest<ScoutPreferences>("/api/scout/preferences", {
    method: "PUT",
    body: JSON.stringify(prefs),
  });

export const updateTargetRolesAndModes = (target_role_titles: string[], preferred_locations?: string[], work_modes?: string[]) =>
  apiRequest<ScoutPreferences>("/api/scout/preferences/roles", {
    method: "POST",
    body: JSON.stringify({ target_role_titles, preferred_locations, work_modes }),
  });

export const updateDailyApplyLimit = (daily_apply_limit: number) =>
  apiRequest<ScoutPreferences>("/api/scout/preferences/limit", {
    method: "PATCH",
    body: JSON.stringify({ daily_apply_limit }),
  });

export const getDailyQuota = () => apiRequest<DailyQuotaStatus>("/api/scout/quota");

// ==========================================
// 3. SCOUT RUN, PASTE-ANY-JOB & LIVE STREAM
// ==========================================

export interface JobRecord {
  id: string;
  user_id: string;
  external_url: string;
  company_name: string;
  role_title: string;
  matched_target_role: string;
  ats_platform: string;
  location_type: string;
  raw_jd_text: string;
  match_score: number;
  match_reasoning: string;
  status: string;
  discovered_at: string;
  applied_at?: string;
  last_email_category?: string;
  last_email_note?: string;
}

export interface AgentActivityStep {
  id: string;
  job_id?: string;
  phase: "VAULT" | "SCOUT" | "TAILOR" | "APPLY" | "OTP" | "INBOX";
  title: string;
  detail: string;
  status: "active" | "completed" | "waiting_input" | "error";
  timestamp: string;
}

export const launchAutonomousScout = (custom_roles_override?: string[], max_jobs_to_score = 8) =>
  apiRequest<{
    searched_target_roles: string[];
    daily_quota: DailyQuotaStatus;
    high_match_discovered_count: number;
    archived_low_or_blocked_count: number;
    skipped_duplicates_count: number;
    discovered_jobs: JobRecord[];
  }>("/api/scout/run", {
    method: "POST",
    body: JSON.stringify({ custom_roles_override, max_jobs_to_score }),
  });

export const pasteAndTailorJob = (payload: {
  external_url?: string;
  raw_jd_text?: string;
  company_name?: string;
  role_title?: string;
  auto_queue_for_apply?: boolean;
}) =>
  apiRequest<{
    ingested_job: JobRecord;
    tailored_result: {
      status: string;
      job_id: string;
      critic_score: number;
      critic_feedback: string;
      cv_preview_url: string;
      tailored_package: TailoredPackage;
    };
    daily_quota: DailyQuotaStatus;
  }>("/api/scout/paste-job", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const getJobs = (status?: string) => apiRequest<JobRecord[]>(status ? `/api/jobs?status=${encodeURIComponent(status)}` : "/api/jobs");

export const getAgentActivityStream = (limit = 25) => apiRequest<AgentActivityStep[]>(`/api/agent/activity-stream?limit=${limit}`);

// ==========================================
// 4. REVIEW QUEUE & TAILORING (/queue)
// ==========================================

export interface TailoredPackage {
  job_id: string;
  user_id: string;
  target_role_headline: string;
  tailored_summary: string;
  selected_experiences: ExperienceItem[];
  selected_projects: ProjectItem[];
  critic_score: number;
  critic_feedback: string;
  cover_letter_text: string;
  screening_answers: Record<string, string>;
  cv_pdf_url?: string;
}

export const batchTailorDiscoveredJobs = (limit = 5) =>
  apiRequest<{ tailored_count: number; staged_in_review_queue: unknown[] }>(`/api/tailor/batch-run?limit=${limit}`, { method: "POST" });

export const tailorSingleJob = (jobId: string) =>
  apiRequest<{
    status: string;
    job_id: string;
    critic_score: number;
    cv_preview_url: string;
    tailored_package: TailoredPackage;
  }>(`/api/tailor/${jobId}`, { method: "POST" });

export const getTailoredPackage = (jobId: string) => apiRequest<TailoredPackage>(`/api/tailor/${jobId}`);

export const updateTailoredPackageFields = (jobId: string, payload: { cover_letter_text?: string; screening_answers?: Record<string, string> }) =>
  apiRequest<TailoredPackage>(`/api/tailor/${jobId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const approveJobForApplication = (jobId: string) =>
  apiRequest<{ status: string; daily_quota: DailyQuotaStatus }>(`/api/jobs/${jobId}/approve`, {
    method: "POST",
  });

export const skipJob = (jobId: string) =>
  apiRequest<{ job_id: string; new_status: string }>(`/api/jobs/${jobId}/skip`, {
    method: "POST",
  });

// ==========================================
// 5. PLAYWRIGHT APPLICATOR, OTP & HISTORY (/history)
// ==========================================

export interface DayApplicationGroup {
  day_label: string;
  count: number;
  applications: Array<
    JobRecord & {
      applied_day_key: string;
      applied_day_label: string;
      applied_time_label: string;
      cv_preview_url?: string;
      cover_letter_text?: string;
      critic_score?: number;
    }
  >;
}

export const executePlaywrightApplication = (jobId: string, headless = true, simulateOtp = false) =>
  apiRequest<{
    status: string;
    job_id: string;
    company_name: string;
    role_title: string;
    fields_filled: number;
    screenshot_url?: string;
  }>(`/api/apply/${jobId}/execute?headless=${headless}&simulate_otp=${simulateOtp}`, {
    method: "POST",
  });

export const runQueuedApplicationsBatch = (headless = true) =>
  apiRequest<{ processed_count: number; daily_quota: DailyQuotaStatus; results: unknown[] }>(`/api/apply/run-queue?headless=${headless}`, {
    method: "POST",
  });

export const getJobsWaitingForOtp = () => apiRequest<JobRecord[]>("/api/jobs/waiting-otp");

export const submitManualOtpCode = (jobId: string, otp_code: string) =>
  apiRequest<{ status: string; job_id: string }>(`/api/jobs/${jobId}/submit-otp`, {
    method: "POST",
    body: JSON.stringify({ otp_code }),
  });

export const getAppliedJobsHistoryByDay = () =>
  apiRequest<{ total_applications_tracked: number; days: DayApplicationGroup[] }>("/api/jobs/history-by-day");

// ==========================================
// 6. GMAIL INBOX WATCHER & EVENTS
// ==========================================

export const pollGmailInbox = (maxEmails = 10) =>
  apiRequest<{ status: string; matched_events_count?: number; processed_events: unknown[] }>(`/api/inbox/poll?max_emails=${maxEmails}`, {
    method: "POST",
  });

export const getTrackedEmailEvents = () => apiRequest<unknown[]>("/api/inbox/events");
