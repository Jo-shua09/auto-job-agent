import type { ReactNode } from "react";
import { createPageMetadata } from "@/lib/seo";

export const instant = false;

export const metadata = createPageMetadata({
  path: "/settings",
  title: "Settings",
  description: "Set your target job titles, preferred locations, work modes, matching preferences, application limits, and workspace appearance.",
  keywords: ["job search preferences", "target roles", "preferred work locations", "job matching settings", "application limits"],
});

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return children;
}
