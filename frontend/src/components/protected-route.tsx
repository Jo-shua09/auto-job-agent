"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { getAuthToken, logoutUser } from "@/lib/auth";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;
    if (!getAuthToken()) {
      router.replace("/auth");
      return () => {
        active = false;
      };
    }

    void apiRequest<{ authenticated: boolean }>("/api/auth/me")
      .then(() => {
        if (active) setAuthenticated(true);
      })
      .catch(() => {
        logoutUser();
        router.replace("/auth");
      });

    return () => {
      active = false;
    };
  }, [router]);

  if (!authenticated) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-4" role="status" aria-busy="true">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin text-mint" />
          Checking your session...
        </div>
      </main>
    );
  }

  return children;
}
