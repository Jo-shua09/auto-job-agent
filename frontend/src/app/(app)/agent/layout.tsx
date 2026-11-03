import type { Metadata } from "next";
import type { ReactNode } from "react";

export const instant = false;

export const metadata: Metadata = {
  title: "Agent",
  description: "Watch your agent scout, tailor and apply in real time.",
};

export default function AgentLayout({ children }: { children: ReactNode }) {
  return children;
}
