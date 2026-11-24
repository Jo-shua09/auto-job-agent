"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOnboardingTour } from "./onboarding-context";

type Rect = { top: number; left: number; width: number; height: number };

function getRect(selector: string): Rect | null {
  const els = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  const el = els.find((node) => {
    const style = window.getComputedStyle(node);
    const r = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && r.width > 0 && r.height > 0;
  });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const pad = 6;
  return {
    top: Math.max(8, r.top - pad),
    left: Math.max(8, r.left - pad),
    width: Math.min(window.innerWidth - 16, r.width + pad * 2),
    height: Math.min(window.innerHeight - 16, r.height + pad * 2),
  };
}

export function TourOverlay() {
  const { tourActive, stepIndex, steps, nextStep, prevStep, skipTour, completeTour } = useOnboardingTour();
  const pathname = usePathname();
  const step = steps[stepIndex];
  const [rect, setRect] = useState<Rect | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!tourActive || !mounted) return;
    if (pathname !== step.route) {
      setRect(null);
      return;
    }
    let tries = 0;
    const update = () => {
      const next = getRect(step.selector);
      if (next) {
        setRect(next);
        const els = Array.from(document.querySelectorAll(step.selector)) as HTMLElement[];
        const el = els.find((node) => node.getBoundingClientRect().width > 0);
        el?.scrollIntoView({ block: "center", inline: "nearest", behavior: tries === 0 ? "smooth" : "auto" });
        return true;
      }
      return false;
    };
    update();
    const timer = window.setInterval(() => {
      tries += 1;
      if (update() || tries > 30) window.clearInterval(timer);
    }, 100);
    const onResize = () => update();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [tourActive, mounted, pathname, step]);

  useEffect(() => {
    if (!tourActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skipTour();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tourActive, skipTour]);

  if (!mounted || !tourActive) return null;
  if (pathname !== step.route) return null;

  const isLast = stepIndex === steps.length - 1;
  const popoverWidth = 340;
  const popoverLeft = rect ? Math.min(Math.max(12, rect.left), window.innerWidth - popoverWidth - 12) : 12;
  const below = rect ? rect.top + rect.height + 14 : 80;
  const above = rect ? rect.top - 14 : 80;
  const placeBelow = rect ? below + 220 < window.innerHeight : true;
  const popoverTop = placeBelow ? below : Math.max(12, above - 210);

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-[#0B0F0E]/70" onClick={skipTour} aria-hidden="true" />
      {rect && (
        <div
          className="pointer-events-none absolute rounded-2xl border-2 border-mint shadow-[0_0_0_9999px_rgba(11,15,14,0.72),0_0_0_4px_rgba(116,198,157,0.18)] transition-all duration-200"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Onboarding tour"
        className={cn(
          "absolute w-[min(340px,calc(100vw-24px))] rounded-2xl border border-[#1E2923] bg-[#111815] p-4 text-foreground shadow-2xl",
        )}
        style={{ top: popoverTop, left: popoverLeft }}
      >
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-mint">Step {stepIndex + 1} of {steps.length}</p>
        <h2 className="mt-1 font-heading text-lg font-semibold tracking-tight text-foreground">{step.title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={skipTour} className="text-muted-foreground hover:text-foreground">Skip Tour</Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={prevStep} disabled={stepIndex === 0}>Back</Button>
            <Button size="sm" onClick={isLast ? completeTour : nextStep} className="bg-mint text-[#0B0F0E] hover:bg-mint/90">
              {isLast ? "Finish" : "Next"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Press Esc to dismiss.</p>
      </div>
    </div>
  );
}
