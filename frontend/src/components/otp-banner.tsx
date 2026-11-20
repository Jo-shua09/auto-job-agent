"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/action-dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { apiRequest } from "@/lib/api";
import { getAuthToken, onSessionChange } from "@/lib/auth";

type WaitingJob = { id: string; company_name: string; role_title: string };

export function OtpDialog() {
  const [job, setJob] = useState<WaitingJob | null>(null);
  const [code, setCode] = useState("");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const seenJobId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const refresh = () =>
      apiRequest<WaitingJob[]>("/api/jobs/waiting-otp")
        .then((jobs) => {
          if (!active) return;
          const next = jobs[0] ?? null;
          setJob(next);
          if (next?.id !== seenJobId.current) {
            seenJobId.current = next?.id ?? null;
            setCode("");
            setOpen(Boolean(next));
          }
        })
        .catch(() => undefined);

    const updatePolling = () => {
      if (timer !== undefined) window.clearInterval(timer);
      if (!getAuthToken()) {
        setJob(null);
        setOpen(false);
        seenJobId.current = null;
        return;
      }
      void refresh();
      timer = window.setInterval(() => void refresh(), 15000);
    };

    const unsubscribe = onSessionChange(updatePolling);
    const startupTimer = window.setTimeout(updatePolling, 0);
    return () => {
      active = false;
      unsubscribe();
      window.clearTimeout(startupTimer);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, []);

  async function submit() {
    if (!job || code.length < 3 || submitting) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/jobs/${encodeURIComponent(job.id)}/submit-otp`, "POST", { otp_code: code });
      setCode("");
      setOpen(false);
      toast.success("Code sent. We'll take it from here.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That code didn't go through. Check it and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!job) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-20 z-40 inline-flex items-center gap-2 rounded-full border border-warning/50 bg-card px-4 py-2.5 text-sm font-medium shadow-warning transition-colors hover:bg-accent md:right-6 md:bottom-6"
        >
          <KeyRound className="size-4 text-warning-foreground" />
          Finish your application
        </button>
      )}
      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        tone="warning"
        eyebrow="One quick step from you"
        title="Add the security code to keep going"
        whatHappened={`${job.company_name} asked for a verification code for the ${job.role_title} role. We've paused right here so you don't lose your place.`}
        nextSteps={[
          "Check your email for a code from the employer.",
          "Type the code below exactly as it appears.",
          "We'll send it for you and carry on with the application.",
        ]}
        primaryLabel={submitting ? "Sending..." : "Send code and continue"}
        onPrimary={() => void submit()}
        primaryDisabled={code.length < 3 || submitting}
        secondaryLabel="I'll do this later"
        onSecondary={() => setOpen(false)}
      >
        <div className="space-y-2">
          <p className="text-sm font-medium">Verification code</p>
          <InputOTP aria-label={`Verification code for ${job.company_name}`} maxLength={6} value={code} onChange={setCode}>
            <InputOTPGroup className="font-mono">
              {Array.from({ length: 6 }).map((_, index) => (
                <InputOTPSlot key={index} index={index} className="size-10 bg-background" />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
      </ActionDialog>
    </>
  );
}
