"use client";

import type { ReactNode } from "react";
import { CircleAlert, KeyRound, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tone?: "info" | "warning" | "error";
  eyebrow: string;
  title: string;
  whatHappened: string;
  nextSteps: string[];
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  children?: ReactNode;
};

export function ActionDialog({
  open,
  onOpenChange,
  tone = "info",
  eyebrow,
  title,
  whatHappened,
  nextSteps,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  secondaryLabel,
  onSecondary,
  children,
}: ActionDialogProps) {
  const icon = tone === "error"
    ? <CircleAlert className="size-5" />
    : tone === "warning"
      ? <KeyRound className="size-5" />
      : <Sparkles className="size-5" />;
  const iconStyle = tone === "error"
    ? "bg-destructive/10 text-destructive"
    : tone === "warning"
      ? "bg-warning/15 text-warning-foreground"
      : "bg-accent text-mint";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3 text-left">
            <span className={`grid size-10 shrink-0 place-items-center rounded-2xl ${iconStyle}`}>{icon}</span>
            <div className="min-w-0">
              <p className="font-mono text-[0.6875rem] tracking-[0.16em] text-muted-foreground uppercase">{eyebrow}</p>
              <DialogTitle className="mt-1 font-display text-2xl leading-tight">{title}</DialogTitle>
            </div>
          </div>
          <DialogDescription className="pt-1 text-left text-sm leading-6">{whatHappened}</DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-border bg-muted/40 p-4">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">What to do next</p>
          <ol className="mt-3 space-y-2.5">
            {nextSteps.map((step, index) => (
              <li key={step} className="flex gap-3 text-sm leading-6">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-card text-xs font-semibold text-mint">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {children}

        <DialogFooter className="gap-2">
          {onSecondary && (
            <Button type="button" variant="ghost" onClick={onSecondary}>{secondaryLabel ?? "Not now"}</Button>
          )}
          <Button type="button" onClick={onPrimary} disabled={primaryDisabled}>{primaryLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
