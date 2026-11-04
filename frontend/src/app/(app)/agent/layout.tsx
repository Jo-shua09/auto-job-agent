import type { ReactNode } from "react";
import { createPageMetadata } from "@/lib/seo";

export const instant = false;

export const metadata = createPageMetadata({
  path: "/agent",
  title: "Agent",
  description: "Configure Verdant's AI job scout, discover matching roles, prepare tailored application materials, and monitor progress from one workspace.",
  keywords: ["AI job scout", "job discovery", "automated job search", "tailored job applications", "job search agent"],
});

export default function AgentLayout({ children }: { children: ReactNode }) {
  return children;
}
