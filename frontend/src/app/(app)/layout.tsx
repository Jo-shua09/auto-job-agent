"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getDemoUser } from "@/lib/api";

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getDemoUser()) {
      router.replace("/auth");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return <AppShell>{children}</AppShell>;
}
