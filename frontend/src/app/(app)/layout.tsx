import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { OnboardingProvider } from "@/components/onboarding/onboarding-context";
import { TourOverlay } from "@/components/onboarding/tour-overlay";

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <OnboardingProvider>
        <AppShell>{children}</AppShell>
        <TourOverlay />
      </OnboardingProvider>
    </ProtectedRoute>
  );
}
