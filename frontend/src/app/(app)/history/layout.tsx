import type { ReactNode } from "react";
import { createPageMetadata } from "@/lib/seo";

export const instant = false;

export const metadata = createPageMetadata({
  path: "/history",
  title: "Application history",
  description: "Track the jobs Verdant has processed and the status of each application in a chronological job search activity history.",
  keywords: ["job application tracker", "application history", "job search tracking", "application status", "career search progress"],
});

export default function HistoryLayout({ children }: { children: ReactNode }) {
  return children;
}
