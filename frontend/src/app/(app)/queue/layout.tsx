import type { Metadata } from "next";
import type { ReactNode } from "react";

export const instant = false;

export const metadata: Metadata = {
  title: "Review queue",
  description: "Approve tailored applications before your agent sends them.",
};

export default function QueueLayout({ children }: { children: ReactNode }) {
  return children;
}
