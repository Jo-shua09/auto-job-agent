import type { ReactNode } from "react";
import { createPageMetadata } from "@/lib/seo";

export const instant = false;

export const metadata = createPageMetadata({
  path: "/queue",
  title: "Review queue",
  description: "Review matched jobs, inspect tailored resumes and cover letters, edit screening answers, and approve each application before Verdant submits it.",
  keywords: ["job application review", "tailored resume review", "application approval", "ATS applications", "cover letter review"],
});

export default function QueueLayout({ children }: { children: ReactNode }) {
  return children;
}
