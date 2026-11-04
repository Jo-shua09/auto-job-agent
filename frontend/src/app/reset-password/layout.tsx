import type { ReactNode } from "react";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  path: "/reset-password",
  title: "Set a new password",
  description: "Update the password associated with your Verdant account to securely access your job search workspace.",
  keywords: ["Verdant password reset", "account password", "account recovery"],
});

export default function ResetPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
