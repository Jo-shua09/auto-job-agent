import { useState } from "react";
import { KeyRound } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { agent, useAgent } from "@/lib/agent-store";

export function OtpBanner() {
  const otp = useAgent((s) => s.otp);
  const [code, setCode] = useState("");
  if (!otp) return null;
  return (
    <div className="sticky top-[61px] z-30 px-4 pt-4 md:top-0 md:px-8">
      <div className="animate-rise mx-auto max-w-5xl rounded-3xl border border-warning/50 bg-card p-4 shadow-warning sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-warning/15 text-warning">
              <KeyRound className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="ui-title">Security code needed for {otp.company}</p>
              <p className="text-sm text-muted-foreground">Enter the six-digit verification code to continue.</p>
            </div>
          </div>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-center"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length >= 6) {
                agent.submitOtp(code);
                setCode("");
              }
            }}
          >
            <InputOTP maxLength={6} value={code} onChange={setCode}>
              <InputOTPGroup className="font-mono">
                {Array.from({ length: 6 }).map((_, i) => (
                  <InputOTPSlot key={i} index={i} className="size-10 bg-background" />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <Button type="submit" variant="warning" disabled={code.length < 6}>
              Send code & finish
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
