import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Opening your Verdant workspace",
  robots: { index: false, follow: false },
};

export default function Home() {
  redirect("/agent");
}
