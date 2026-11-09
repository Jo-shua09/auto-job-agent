"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api";
import { getAuthToken, onSessionChange } from "@/lib/auth";

type WaitingJob = { id: string; company_name: string; role_title: string };

export function OtpBanner() {
  const [job, setJob] = useState<WaitingJob | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const refresh = () =>
      apiRequest<WaitingJob[]>("/api/jobs/waiting-otp")
        .then((jobs) => {
          if (active) setJob(jobs[0] ?? null);
        })
        .catch(() => undefined);

    const updatePolling = () => {
      if (timer !== undefined) window.clearInterval(timer);
      if (!getAuthToken()) {
        setJob(null);
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!job || code.length < 3) return;
    try {
      await apiRequest(`/api/jobs/${encodeURIComponent(job.id)}/submit-otp`, "POST", { otp_code: code });
      setCode("");
      toast.success("Verification code sent.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit the code.");
    }
  }

  if (!job) return null;
  return (
    <div className="sticky top-15.25 z-30 px-4 pt-4 md:top-0 md:px-8">
      <div className="animate-rise mx-auto max-w-5xl rounded-3xl border border-warning/50 bg-card p-4 shadow-warning sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-warning/15 text-warning">
              <KeyRound className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="ui-title">Security code needed for {job.company_name}</p>
              <p className="text-sm text-muted-foreground">{job.role_title}. Enter the code to continue.</p>
            </div>
          </div>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-center" onSubmit={(event) => void submit(event)}>
            <InputOTP aria-label={`Security code for ${job.company_name}`} maxLength={6} value={code} onChange={setCode}>
              <InputOTPGroup className="font-mono">
                {Array.from({ length: 6 }).map((_, index) => (
                  <InputOTPSlot key={index} index={index} className="size-10 bg-background" />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <Button type="submit" variant="warning" disabled={code.length < 3}>
              Send code & finish
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
