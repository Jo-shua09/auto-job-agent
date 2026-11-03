import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Profile vault",
  description: "Your verified career facts: the only source your agent writes from.",
};

export default function VaultLayout({ children }: { children: ReactNode }) {
  return children;
}
