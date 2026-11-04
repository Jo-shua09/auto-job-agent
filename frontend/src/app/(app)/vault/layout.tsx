import type { ReactNode } from "react";
import { createPageMetadata } from "@/lib/seo";

export const instant = false;

export const metadata = createPageMetadata({
  path: "/vault",
  title: "Profile vault",
  description: "Manage the verified work experience, skills, projects, and career details Verdant can use to personalize job applications accurately.",
  keywords: ["career profile", "verified work experience", "resume profile", "skills and projects", "job application profile"],
});

export default function VaultLayout({ children }: { children: ReactNode }) {
  return children;
}
