import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password for your Verdant account.",
};

export default function ResetPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
