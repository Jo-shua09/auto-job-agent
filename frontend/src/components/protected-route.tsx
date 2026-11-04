"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { auth, onAuthStateChanged } from "@/lib/firebase";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      if (user) setAuthenticated(true);
      else router.replace("/auth");
    });
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
