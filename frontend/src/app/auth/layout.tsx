import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to let your agent scout, tailor and apply to roles for you.",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
