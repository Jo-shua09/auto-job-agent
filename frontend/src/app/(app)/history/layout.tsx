import type { Metadata } from "next";
import type { ReactNode } from "react";

export const instant = false;

export const metadata: Metadata = {
  title: "Application history",
  description: "Every job your agent applied to, grouped by day.",
};

export default function HistoryLayout({ children }: { children: ReactNode }) {
  return children;
}
