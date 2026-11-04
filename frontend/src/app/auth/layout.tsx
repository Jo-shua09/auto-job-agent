import type { ReactNode } from "react";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  path: "/auth",
  title: "Sign in",
  description: "Sign in or create a Verdant account to manage your career profile, configure your AI job search, and review applications before submission.",
  keywords: ["Verdant sign in", "Verdant account", "AI job search account"],
});

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
