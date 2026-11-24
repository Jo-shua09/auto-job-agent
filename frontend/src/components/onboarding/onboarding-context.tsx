"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getAuthToken, onSessionChange } from "@/lib/auth";
import { getMasterVault } from "@/lib/api";

type TourStep = {
  id: string;
  route: string;
  selector: string;
  title: string;
  body: string;
};

type OnboardingContextValue = {
  ready: boolean;
  tourActive: boolean;
  stepIndex: number;
  steps: TourStep[];
  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  completeTour: () => void;
  isTipDismissed: (key: string) => boolean;
  dismissTip: (key: string) => void;
};

const TOUR_STEPS: TourStep[] = [
  {
    id: "vault",
    route: "/vault",
    selector: '[data-tour="nav-vault"]',
    title: "1. Build Your Master Vault",
    body: "Start here by uploading your base CV or adding verified roles and projects. Verdant uses this as its single source of truth with zero hallucinations.",
  },
  {
    id: "targets",
    route: "/agent",
    selector: '[data-tour="scout-targets"]',
    title: "2. Set Your Scout Targets",
    body: "Define your target job titles, preferred locations, work modes, and daily application quota.",
  },
  {
    id: "launch",
    route: "/agent",
    selector: '[data-tour="scout-actions"]',
    title: "3. Discover or Paste Any Job",
    body: "Launch an autonomous multi-ATS search across 15+ boards, or paste a direct job URL to tailor an application immediately.",
  },
  {
    id: "queue",
    route: "/queue",
    selector: '[data-tour="nav-queue"]',
    title: "4. Review & One-Click Apply",
    body: "Inspect your AI-tailored ATS resume PDF and screening answers here before approving Playwright to submit.",
  },
];

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function uidFromToken(token: string | null) {
  if (!token) return "anon";
  try {
    const payload = token.split(".")[1];
    if (!payload) return "anon";
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return String(json.sub || json.user_id || json.uid || "anon");
  } catch {
    return "anon";
  }
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [uid, setUid] = useState("anon");
  const [tourActive, setTourActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [dismissedTips, setDismissedTips] = useState<Record<string, boolean>>({});

  const tourKey = useMemo(() => `verdant_tour_completed_${uid}`, [uid]);
  const tipsKey = useMemo(() => `verdant_tips_dismissed_${uid}`, [uid]);

  useEffect(() => {
    const sync = () => {
      const token = getAuthToken();
      const nextUid = uidFromToken(token);
      setUid(nextUid);
      if (typeof window !== "undefined") {
        try {
          const raw = localStorage.getItem(`verdant_tips_dismissed_${nextUid}`);
          setDismissedTips(raw ? JSON.parse(raw) : {});
        } catch {
          setDismissedTips({});
        }
      }
    };
    sync();
    return onSessionChange(sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function maybeAutoStart() {
      setReady(false);
      const token = getAuthToken();
      if (!token || typeof window === "undefined") {
        if (!cancelled) setReady(true);
        return;
      }
      const completed = localStorage.getItem(tourKey) === "1";
      if (completed) {
        if (!cancelled) setReady(true);
        return;
      }
      try {
        const profile = await getMasterVault();
        const emptyVault = !profile?.is_onboarded || (profile?.experiences?.length ?? 0) === 0;
        if (!cancelled && emptyVault) {
          setStepIndex(0);
          setTourActive(true);
          if (pathname !== "/agent") router.push("/agent");
        }
      } catch {
        // ignore auto-trigger failures
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void maybeAutoStart();
    return () => {
      cancelled = true;
    };
  }, [tourKey, pathname, router]);

  const persistTourDone = useCallback(() => {
    if (typeof window !== "undefined") localStorage.setItem(tourKey, "1");
  }, [tourKey]);

  const startTour = useCallback(() => {
    setStepIndex(0);
    setTourActive(true);
    if (pathname !== TOUR_STEPS[0].route) router.push(TOUR_STEPS[0].route);
  }, [pathname, router]);

  const closeTour = useCallback(() => {
    setTourActive(false);
    persistTourDone();
  }, [persistTourDone]);

  const nextStep = useCallback(() => {
    setStepIndex((i) => {
      const next = i + 1;
      if (next >= TOUR_STEPS.length) {
        closeTour();
        return i;
      }
      const target = TOUR_STEPS[next];
      if (pathname !== target.route) router.push(target.route);
      return next;
    });
  }, [closeTour, pathname, router]);

  const prevStep = useCallback(() => {
    setStepIndex((i) => {
      const prev = Math.max(0, i - 1);
      const target = TOUR_STEPS[prev];
      if (pathname !== target.route) router.push(target.route);
      return prev;
    });
  }, [pathname, router]);

  const isTipDismissed = useCallback((key: string) => !!dismissedTips[key], [dismissedTips]);
  const dismissTip = useCallback((key: string) => {
    setDismissedTips((prev) => {
      const next = { ...prev, [key]: true };
      if (typeof window !== "undefined") localStorage.setItem(tipsKey, JSON.stringify(next));
      return next;
    });
  }, [tipsKey]);

  const value = useMemo<OnboardingContextValue>(() => ({
    ready,
    tourActive,
    stepIndex,
    steps: TOUR_STEPS,
    startTour,
    nextStep,
    prevStep,
    skipTour: closeTour,
    completeTour: closeTour,
    isTipDismissed,
    dismissTip,
  }), [ready, tourActive, stepIndex, startTour, nextStep, prevStep, closeTour, isTipDismissed, dismissTip]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboardingTour() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboardingTour must be used within OnboardingProvider");
  return ctx;
}
