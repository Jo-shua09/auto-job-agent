import { useSyncExternalStore } from "react";
import { buildHistory, queueSeed, DAILY_LIMIT, appliedToday, normalizeLimit, type AppliedJob, type QueueJob } from "./jobs";
import { USE_LOCAL_PYTHON_API, localApi } from "./api";

export type StepState = "done" | "active" | "pending" | "paused";
export interface AgentStep {
  id: string;
  title: string;
  detail?: string | undefined;
  state: StepState;
}
export interface AgentRun {
  id: string;
  kind: "scout" | "paste" | "apply";
  title: string;
  startedAt: string;
  steps: AgentStep[];
  finished: boolean;
  summary?: string;
}
export interface OtpRequest {
  runId: string;
  jobId: string;
  company: string;
}

interface State {
  queue: QueueJob[];
  history: AppliedJob[];
  runs: AgentRun[];
  otp: OtpRequest | null;
  limit: number;
  reserved: number;
}

let state: State = {
  queue: queueSeed,
  history: buildHistory(),
  runs: [],
  otp: null,
  limit: DAILY_LIMIT,
  reserved: 0,
};
const listeners = new Set<() => void>();
const set = (fn: (s: State) => State) => {
  state = fn(state);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("jh-demo-agent", JSON.stringify({ queue: state.queue, history: state.history, limit: state.limit }));
    } catch {
      /* Demo remains usable in memory. */
    }
  }
  listeners.forEach((l) => l());
};
let hydrated = false;
export function loadAgent() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem("jh-demo-agent");
    if (raw) {
      const saved = JSON.parse(raw) as Pick<State, "queue" | "history" | "limit">;
      if (Array.isArray(saved.queue) && Array.isArray(saved.history))
        state = { ...state, queue: saved.queue, history: saved.history, limit: normalizeLimit(saved.limit) };
    }
  } catch {
    /* Keep demo defaults. */
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useAgent<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => sel(state),
    () => sel(state),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let otpResolver: ((code: string) => void) | null = null;

function patchRun(runId: string, fn: (r: AgentRun) => AgentRun) {
  set((s) => ({ ...s, runs: s.runs.map((r) => (r.id === runId ? fn(r) : r)) }));
}

async function playSteps(run: AgentRun, scripts: { title: string; detail?: string; ms: number; otp?: OtpRequest }[]) {
  set((s) => ({ ...s, runs: [run, ...s.runs] }));
  for (let i = 0; i < scripts.length; i++) {
    const sc = scripts[i];
    if (!sc) continue;
    patchRun(run.id, (r) => ({
      ...r,
      steps: [...r.steps, { id: `${run.id}-${i}`, title: sc.title, detail: sc.detail, state: sc.otp ? "paused" : "active" }],
    }));
    if (sc.otp) {
      const otp = sc.otp;
      set((s) => ({ ...s, otp }));
      await new Promise<string>((res) => (otpResolver = res));
      set((s) => ({ ...s, otp: null }));
    } else {
      await sleep(sc.ms);
    }
    patchRun(run.id, (r) => ({ ...r, steps: r.steps.map((st) => (st.id === `${run.id}-${i}` ? { ...st, state: "done" } : st)) }));
  }
}

const newId = () => Math.random().toString(36).slice(2, 9);

export const agent = {
  async runScout() {
    if (USE_LOCAL_PYTHON_API) {
      await localApi.scout([]);
      return;
    }
    const template = queueSeed[0];
    if (!template) return;
    const run: AgentRun = { id: newId(), kind: "scout", title: "Autonomous scout", startedAt: new Date().toISOString(), steps: [], finished: false };
    await playSteps(run, [
      {
        title: "Scanning 15+ job boards & ATS platforms for your active roles",
        detail: "Greenhouse, Lever, Ashby, Workable, Remotive, Wellfound",
        ms: 1800,
      },
      { title: "Found 6 matching roles. Filtering out location restrictions & duplicates", detail: "2 roles skipped: US citizens only", ms: 1500 },
      { title: "Reading requirements for Senior Product Engineer at Granola", detail: "94% match · AI Frontend", ms: 1600 },
      { title: "Selecting your best projects from your Vault", detail: "AreaHustle, ResolveAI, SwapDesk", ms: 1400 },
      { title: "Tailoring resume bullets & drafting a custom cover letter", ms: 2000 },
      { title: "Checking every line against your verified facts", detail: "Accuracy score 95/100 · nothing invented", ms: 1500 },
      { title: "Building your ATS-ready CV and adding it to your Review Queue", ms: 1200 },
    ]);
    const job: QueueJob = {
      ...template,
      id: newId(),
      company: "Granola",
      role: "Senior Product Engineer",
      match: 94,
      critic: 95,
      platform: "Ashby",
      why: ["They're building an AI notepad with live streaming UI - your specialty.", "Remote-friendly, no blockers."],
    };
    set((s) => ({ ...s, queue: [job, ...s.queue] }));
    patchRun(run.id, (r) => ({ ...r, finished: true, summary: "1 new role is ready for your review." }));
  },

  async pasteJob(text: string, autoQueue: boolean) {
    if (USE_LOCAL_PYTHON_API) {
      await localApi.paste(text, autoQueue);
      return;
    }
    const template = queueSeed[1];
    if (!template) return;
    const host = text.match(/https?:\/\/([^/\s]+)/)?.[1] ?? "pasted post";
    const run: AgentRun = {
      id: newId(),
      kind: "paste",
      title: `Reading job from ${host}`,
      startedAt: new Date().toISOString(),
      steps: [],
      finished: false,
    };
    await playSteps(run, [
      { title: "Opening the job post and pulling out the details", detail: host, ms: 1400 },
      { title: "Comparing the role with your Vault", detail: "89% match · Frontend Web", ms: 1500 },
      { title: "Writing a tailored CV and cover letter", ms: 1800 },
      { title: "Checking every line against your verified facts", detail: "Accuracy score 92/100", ms: 1200 },
      { title: autoQueue ? "Added to your Review Queue" : "Saved as a draft in your Review Queue", ms: 600 },
    ]);
    const job: QueueJob = {
      ...template,
      id: newId(),
      company:
        host
          .replace(/^www\.|^jobs\.|^boards\./, "")
          .split(".")[0]
          ?.replace(/^\w/, (c) => c.toUpperCase()) ?? "Pasted role",
      match: 89,
      critic: 92,
      url: host === "pasted post" ? template.url : (text.match(/https?:\/\/\S+/)?.[0] ?? template.url),
    };
    set((s) => ({ ...s, queue: [job, ...s.queue] }));
    patchRun(run.id, (r) => ({ ...r, finished: true, summary: "Ready in your Review Queue." }));
  },

  skip(id: string) {
    set((s) => ({ ...s, queue: s.queue.filter((q) => q.id !== id) }));
  },

  updateCover(id: string, coverLetter: string) {
    set((s) => ({ ...s, queue: s.queue.map((q) => (q.id === id ? { ...q, coverLetter } : q)) }));
  },
  updateAnswer(id: string, idx: number, a: string) {
    set((s) => ({ ...s, queue: s.queue.map((q) => (q.id === id ? { ...q, answers: q.answers.map((x, i) => (i === idx ? { ...x, a } : x)) } : q)) }));
  },

  canApply() {
    return appliedToday(state.history) + state.reserved < state.limit;
  },

  async approve(id: string) {
    const job = state.queue.find((q) => q.id === id);
    if (!job || !agent.canApply()) return false;
    if (USE_LOCAL_PYTHON_API) {
      await localApi.approve(id);
      return true;
    }
    set((s) => ({ ...s, queue: s.queue.filter((q) => q.id !== id), reserved: s.reserved + 1 }));
    const run: AgentRun = {
      id: newId(),
      kind: "apply",
      title: `Applying to ${job.company}`,
      startedAt: new Date().toISOString(),
      steps: [],
      finished: false,
    };
    const needsOtp = job.platform === "Ashby" || job.platform === "Greenhouse";
    await playSteps(run, [
      { title: `Opening the ${job.platform} application form`, ms: 1300 },
      { title: "Filling in your details, links and work history", ms: 1600 },
      { title: "Uploading your tailored CV and cover letter", ms: 1300 },
      ...(needsOtp
        ? [
            {
              title: `${job.company} sent a security code to your email - waiting for you`,
              ms: 0,
              otp: { runId: run.id, jobId: job.id, company: job.company },
            },
          ]
        : []),
      { title: "Submitting the application", ms: 1200 },
      { title: "Done! Watching your inbox for their reply", ms: 600 },
    ]);
    const applied: AppliedJob = {
      id: job.id,
      company: job.company,
      role: job.role,
      platform: job.platform,
      track: job.track,
      match: job.match,
      appliedAt: new Date().toISOString(),
      status: "APPLIED",
      url: job.url,
      coverLetter: job.coverLetter,
      answers: job.answers.map((a) => ({ ...a })),
    };
    set((s) => ({ ...s, history: [applied, ...s.history], reserved: Math.max(0, s.reserved - 1) }));
    patchRun(run.id, (r) => ({ ...r, finished: true, summary: `Applied to ${job.company}. You'll see it in History.` }));
    return true;
  },

  submitOtp(code: string) {
    otpResolver?.(code);
    otpResolver = null;
  },

  setLimit(n: number) {
    set((s) => ({ ...s, limit: normalizeLimit(n) }));
  },
};
