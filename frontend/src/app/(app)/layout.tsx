"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth, onAuthStateChanged } from "@/lib/firebase";

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      if (!user) router.replace("/auth");
      else setReady(true);
    });
  }, [router]);

  if (!ready) return null;

  return <AppShell>{children}</AppShell>;
}
