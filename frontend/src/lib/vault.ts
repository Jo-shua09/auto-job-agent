import { useSyncExternalStore } from "react";

export interface Experience {
  id: string;
  company: string;
  role: string;
  dates: string;
  tags: string[];
  bullets: string[];
}
export interface Project {
  id: string;
  name: string;
  stack: string[];
  award: string;
  impact: string;
  url: string;
}
interface Vault {
  personal: Record<string, string>;
  work: Experience[];
  projects: Project[];
  skills: Record<string, string[]>;
  fileName: string;
}
let vault: Vault = {
  personal: {
    "Full name": "Joshua Onyeka Ituma",
    Email: "joshua@example.com",
    Phone: "",
    Location: "Lagos, Nigeria",
    Portfolio: "",
    GitHub: "github.com/joshua",
    LinkedIn: "",
    "Notice period": "2 weeks",
  },
  work: ["BoukarTech Solutions Ltd", "Cavista Technologies", "Igbogbo Bayeku LCDA", "SideHustle"].map((company, i) => ({
    id: `w${i}`,
    company,
    role: i === 2 ? "Software Developer" : "Frontend Engineer",
    dates: "Add verified dates",
    tags: ["Frontend", "React", "Next.js"],
    bullets: ["Add a verified responsibility or achievement."],
  })),
  projects: ["AreaHustle", "ResolveAI", "SwapDesk", "VITAL-TAG", "Vitalink", "DevAssist"].map((name, i) => ({
    id: `p${i}`,
    name,
    stack: name === "Vitalink" ? ["Flutter", "Dart"] : ["React", "TypeScript"],
    award: i === 0 ? "Hackathon project" : "",
    impact: "Add a verified project description and impact.",
    url: "",
  })),
  skills: {
    Frontend: ["React", "Next.js", "TypeScript", "Tailwind CSS"],
    AI: ["AI SDK", "Streaming UI"],
    Mobile: ["Flutter", "Dart"],
    Education: ["Add your institution and qualification"],
  },
  fileName: "",
};
const listeners = new Set<() => void>();
let loaded = false;
export function loadVault() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem("jh-demo-vault");
    if (raw) {
      const saved = JSON.parse(raw) as Vault;
      if (saved.personal && saved.work && saved.projects && saved.skills) vault = saved;
    }
  } catch {
    /* Keep sample data. */
  }
  listeners.forEach((l) => l());
}
function update(fn: (v: Vault) => Vault) {
  vault = fn(vault);
  try {
    localStorage.setItem("jh-demo-vault", JSON.stringify(vault));
  } catch {
    /* Memory state remains available. */
  }
  listeners.forEach((l) => l());
}
export function useVault() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => vault,
    () => vault,
  );
}
export const vaultActions = {
  personal: (key: string, value: string) => update((v) => ({ ...v, personal: { ...v.personal, [key]: value } })),
  work: (id: string, field: "company" | "role" | "dates", value: string) =>
    update((v) => ({ ...v, work: v.work.map((w) => (w.id === id ? { ...w, [field]: value } : w)) })),
  bullets: (id: string, value: string) =>
    update((v) => ({ ...v, work: v.work.map((w) => (w.id === id ? { ...w, bullets: value.split("\n") } : w)) })),
  addWork: () =>
    update((v) => ({
      ...v,
      work: [...v.work, { id: crypto.randomUUID(), company: "New company", role: "Your role", dates: "Start - End", tags: [], bullets: [] }],
    })),
  removeWork: (id: string) => update((v) => ({ ...v, work: v.work.filter((w) => w.id !== id) })),
  project: (id: string, field: "name" | "impact" | "url", value: string) =>
    update((v) => ({ ...v, projects: v.projects.map((p) => (p.id === id ? { ...p, [field]: value } : p)) })),
  skills: (category: string, value: string) =>
    update((v) => ({
      ...v,
      skills: {
        ...v.skills,
        [category]: value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    })),
  file: (fileName: string) => update((v) => ({ ...v, fileName })),
};
