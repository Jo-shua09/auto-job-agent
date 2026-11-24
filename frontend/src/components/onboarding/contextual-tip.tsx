"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOnboardingTour } from "./onboarding-context";

export function ContextualTip({
  tipKey,
  title,
  body,
  className,
}: {
  tipKey: string;
  title: string;
  body: string;
  className?: string;
}) {
  const { isTipDismissed, dismissTip } = useOnboardingTour();
  if (isTipDismissed(tipKey)) return null;

  return (
    <div className={cn("rounded-2xl border border-mint/30 bg-accent/30 p-4 text-sm sm:p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-mint">Tip</p>
          <h2 className="mt-1 font-heading text-base font-semibold tracking-tight">{title}</h2>
          <p className="mt-1.5 leading-6 text-muted-foreground">{body}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss tip" onClick={() => dismissTip(tipKey)} className="shrink-0 text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
