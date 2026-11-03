export type Track = "FRONTEND_WEB" | "AI_FRONTEND" | "MOBILE_FLUTTER";
export type Platform = "Greenhouse" | "Lever" | "Ashby" | "Workable" | "Remotive" | "Wellfound";
export type AppliedStatus = "APPLIED" | "CONFIRMED" | "INTERVIEW_INVITE" | "REPLIED_REJECTED" | "OFFER_STAGE";

export const TRACK_LABEL: Record<Track, string> = {
  FRONTEND_WEB: "Frontend Web",
  AI_FRONTEND: "AI Frontend",
  MOBILE_FLUTTER: "Mobile · Flutter",
};

export const STATUS_LABEL: Record<AppliedStatus, string> = {
  APPLIED: "Applied · Tracking inbox",
  CONFIRMED: "Confirmation received",
  INTERVIEW_INVITE: "Interview invite!",
  REPLIED_REJECTED: "Not moving forward",
  OFFER_STAGE: "Offer stage",
};

export interface QueueJob {
  id: string;
  company: string;
  role: string;
  platform: Platform;
  track: Track;
  match: number;
  critic: number;
  location: string;
  salary: string;
  why: string[];
  coverLetter: string;
  answers: { q: string; a: string }[];
  url: string;
}

export interface AppliedJob {
  id: string;
  company: string;
  role: string;
  platform: Platform;
  track: Track;
  match: number;
  appliedAt: string; // ISO
  status: AppliedStatus;
  url: string;
  coverLetter?: string;
  answers?: { q: string; a: string }[];
}

export const DAILY_LIMIT = 10;
export const MIN_DAILY_LIMIT = 1;
export const MAX_DAILY_LIMIT = 200;
export function normalizeLimit(n: number) {
  return Number.isFinite(n) ? Math.min(MAX_DAILY_LIMIT, Math.max(MIN_DAILY_LIMIT, Math.round(n))) : DAILY_LIMIT;
}

export const queueSeed: QueueJob[] = [
  {
    id: "q1",
    company: "VercelLabs",
    role: "Senior AI Frontend Engineer",
    platform: "Ashby",
    track: "AI_FRONTEND",
    match: 96,
    critic: 96,
    location: "Remote · Worldwide",
    salary: "$140k – $175k",
    why: [
      "They ship streaming generative UI - you built that in ResolveAI.",
      "Vercel AI SDK and Next.js App Router are both in your verified stack.",
      "Remote worldwide, no location blockers.",
    ],
    coverLetter:
      "Hi VercelLabs team,\n\nI build interfaces that think out loud. At ResolveAI I designed a streaming agent console that cut support resolution time by 38%, using the Vercel AI SDK and React Server Components.\n\nYour work on generative UI is exactly where I want to go deeper, and I would love to bring that experience to the team.\n\nWarmly,\nJoshua",
    answers: [
      { q: "Why do you want to work here?", a: "Your SDK is the backbone of most agent UIs I've shipped. I want to help shape it from the inside." },
      {
        q: "Describe a complex AI interface you built.",
        a: "ResolveAI: a multi-step support agent with live tool-call visualization, optimistic streaming and graceful fallback when the model stalls.",
      },
    ],
    url: "https://jobs.ashbyhq.com",
  },
  {
    id: "q2",
    company: "Linear Tools",
    role: "Frontend Engineer, Design Systems",
    platform: "Greenhouse",
    track: "FRONTEND_WEB",
    match: 91,
    critic: 93,
    location: "Remote · EMEA",
    salary: "$120k – $150k",
    why: ["Design systems and accessibility are core to your SwapDesk work.", "TypeScript + Tailwind match 1:1 with their stack."],
    coverLetter:
      "Hello Linear Tools,\n\nI care about the 4px details. At SwapDesk I led a token-based design system used by 3 product teams, with full WCAG AA coverage.\n\nI'd love to bring that craft to your component platform.\n\nBest,\nJoshua",
    answers: [{ q: "What's your proudest UI detail?", a: "A keyboard-first command palette in SwapDesk that reduced clicks per task by 40%." }],
    url: "https://boards.greenhouse.io",
  },
  {
    id: "q3",
    company: "Fieldnote",
    role: "Flutter Mobile Developer",
    platform: "Lever",
    track: "MOBILE_FLUTTER",
    match: 88,
    critic: 90,
    location: "Hybrid · Lagos",
    salary: "₦1.2M – ₦1.8M / mo",
    why: ["Offline-first is required - Vitalink is offline-first.", "Custom animations listed as a bonus; you have shipped them."],
    coverLetter:
      "Hi Fieldnote,\n\nVitalink, my Flutter health app, works fully offline and syncs when signal returns, which is exactly what your field teams need.\n\nLooking forward to talking.\n\nJoshua",
    answers: [{ q: "Years of Flutter experience?", a: "3 years, verified across Vitalink and two client apps." }],
    url: "https://jobs.lever.co",
  },
];

const companies: [string, string, Platform, Track][] = [
  ["Supabase", "Frontend Engineer, Studio", "Ashby", "FRONTEND_WEB"],
  ["Replicate", "AI Product Engineer", "Greenhouse", "AI_FRONTEND"],
  ["Paystack", "Senior Frontend Engineer", "Lever", "FRONTEND_WEB"],
  ["Raycast", "Frontend Engineer", "Ashby", "FRONTEND_WEB"],
  ["Cal.com", "Product Engineer", "Workable", "FRONTEND_WEB"],
  ["Moniepoint", "Flutter Engineer", "Lever", "MOBILE_FLUTTER"],
  ["Perplexity", "Frontend Engineer, Answers", "Greenhouse", "AI_FRONTEND"],
  ["Flutterwave", "Mobile Engineer (Flutter)", "Workable", "MOBILE_FLUTTER"],
  ["Mintlify", "AI Frontend Engineer", "Ashby", "AI_FRONTEND"],
  ["Remote.com", "Senior React Engineer", "Remotive", "FRONTEND_WEB"],
  ["Hugging Face", "Frontend Engineer, Spaces", "Wellfound", "AI_FRONTEND"],
  ["Kuda", "Flutter Developer", "Lever", "MOBILE_FLUTTER"],
  ["Clerk", "Frontend Engineer, SDKs", "Greenhouse", "FRONTEND_WEB"],
  ["Cursor", "Product Engineer, Editor UI", "Ashby", "AI_FRONTEND"],
];

const statuses: AppliedStatus[] = ["APPLIED", "CONFIRMED", "APPLIED", "INTERVIEW_INVITE", "REPLIED_REJECTED", "CONFIRMED", "OFFER_STAGE"];

/** Deterministic sample history spread across recent days (relative to `now`). */
export function buildHistory(now: Date = new Date()): AppliedJob[] {
  const dayOffsets = [0, 0, 0, 0, 1, 1, 1, 1, 1, 3, 3, 3, 5, 5, 6, 8, 8, 9];
  return dayOffsets.map((offset, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    d.setHours(9 + ((i * 3) % 9), (i * 17) % 60, 0, 0);
    if (offset === 0 && d > now) d.setTime(now.getTime() - (i + 1) * 23 * 60000);
    const [company, role, platform, track] = companies[i % companies.length] ?? ["Acme", "Frontend Engineer", "Lever", "FRONTEND_WEB"];
    return {
      id: `h${i}`,
      company,
      role,
      platform,
      track,
      match: 82 + ((i * 7) % 16),
      appliedAt: d.toISOString(),
      status: offset === 0 ? "APPLIED" : (statuses[i % statuses.length] ?? "APPLIED"),
      url: `https://www.google.com/search?q=${encodeURIComponent(company + " " + role + " jobs")}`,
      coverLetter: `Hi ${company} team,\n\nI would love to discuss your ${role} opening. My experience building thoughtful interfaces aligns with this role.\n\nBest,\nJoshua Onyeka Ituma`,
      answers: [{ q: "Notice period & location", a: "Two weeks. Lagos, Nigeria." }],
    };
  });
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DayGroup {
  key: string;
  label: string;
  date: Date;
  jobs: AppliedJob[];
}

/** Groups applied jobs by local calendar day, newest day first, newest job first. */
export function groupByDay(jobs: AppliedJob[], now: Date = new Date()): DayGroup[] {
  const map = new Map<string, AppliedJob[]>();
  for (const j of jobs) {
    const k = dayKey(new Date(j.appliedAt));
    map.set(k, [...(map.get(k) ?? []), j]);
  }
  const today = dayKey(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = dayKey(y);
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, list]) => {
      const date = new Date(list[0]?.appliedAt ?? now.toISOString());
      const prefix = key === today ? "Today" : key === yesterday ? "Yesterday" : null;
      const full = date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
      return {
        key,
        date,
        label: prefix ? `${prefix} - ${full}` : full,
        jobs: [...list].sort((a, b) => (a.appliedAt < b.appliedAt ? 1 : -1)),
      };
    });
}

export function appliedToday(jobs: AppliedJob[], now: Date = new Date()) {
  const k = dayKey(now);
  return jobs.filter((j) => dayKey(new Date(j.appliedAt)) === k).length;
}

export function initials(name: string) {
  return name
    .replace(/[^A-Za-z ]/g, " ")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}
