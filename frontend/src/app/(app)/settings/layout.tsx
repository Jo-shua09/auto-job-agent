import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Settings",
  description: "Choose target roles, daily limits and appearance.",
};

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return children;
}
