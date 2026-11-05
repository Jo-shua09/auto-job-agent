"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { auth, getFirebaseErrorMessage, loginWithFirebaseEmail, loginWithFirebaseGoogle, onAuthStateChanged, registerWithFirebaseEmail } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark, BrandName } from "@/components/brand";
import { cn } from "@/lib/utils";
import brandLogo from "../../../assets/logo.png";

function StepShowcase() {
  return (
    <div className="w-full max-w-md rounded-3xl border border-border/70 bg-card/70 p-5 shadow-soft backdrop-blur-xl">
      <p className="mb-2 font-mono text-[11px] tracking-[0.18em] text-mint uppercase">Your workspace starts blank</p>
      <p className="text-sm leading-6 text-muted-foreground">Add your own verified experience and search preferences. Live progress and tailored jobs appear only after you start the agent.</p>
    </div>
  );
}

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [configurationError, setConfigurationError] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) {
      const timer = window.setTimeout(() => {
        setConfigurationError(true);
        setCheckingSession(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    return onAuthStateChanged(auth, (user) => {
      if (user) router.replace("/agent");
      else setCheckingSession(false);
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        await loginWithFirebaseEmail(email, password);
        router.replace("/agent");
      } else if (mode === "signup") {
        await registerWithFirebaseEmail(name, email, password);
        router.replace("/agent");
      } else {
        setSent("Email recovery is not connected. Return to sign in to continue.");
      }
    } catch (err) {
      toast.error(getFirebaseErrorMessage(err, "We couldn't sign you in. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function oauth() {
    setBusy(true);
    try {
      await loginWithFirebaseGoogle();
      router.replace("/agent");
    } catch (err) {
      toast.error(getFirebaseErrorMessage(err, "We couldn't sign you in with Google. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  if (checkingSession) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-6">
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 text-center">
          <BrandMark />
          <Loader2 className="size-5 animate-spin text-mint" />
          <p className="text-sm text-muted-foreground">Preparing your workspace...</p>
        </div>
      </main>
    );
  }

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(460px,0.95fr)]">
      <section className="bg-mesh grain relative hidden flex-col justify-between overflow-hidden px-10 py-9 lg:flex xl:px-16 xl:py-12">
        <div className="relative z-10 flex items-center gap-2.5">
          <Image src={brandLogo} alt="Verdant" priority className="size-20 object-contain" />
        </div>
        <div className="relative z-10 mx-auto w-full max-w-xl space-y-8">
          <div className="space-y-4">
            <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-mint uppercase">
              Your search, on autopilot
            </p>
            <h2 className="font-display max-w-xl text-5xl leading-[1.04] xl:text-6xl">
              Stop filling forms. <em className="text-mint">Start interviewing.</em>
            </h2>
          </div>
          <StepShowcase />
        </div>
        <p className="relative z-10 max-w-md text-sm leading-6 text-muted-foreground">
          Verdant finds relevant roles and prepares tailored applications from your verified experience. You stay in control of every submission.
        </p>
      </section>

      <section className="relative flex min-w-0 flex-col items-center justify-center px-5 py-12 sm:px-10 lg:px-12 xl:px-16">
        <div className="w-full max-w-md rounded-3xl border border-border/70 bg-card/70 p-6 shadow-soft backdrop-blur-xl sm:p-8">
          <div className="mb-9 flex items-center gap-2.5 lg:hidden">
            <BrandMark />
            <BrandName />
          </div>
          <div className="space-y-2">
            <p className="font-mono text-[11px] font-medium tracking-[0.18em] text-mint uppercase">
              {mode === "forgot" ? "Account recovery" : "Welcome to Verdant"}
            </p>
            <h1 className="font-display text-4xl leading-tight">
              {mode === "forgot" ? "Reset your password" : mode === "signup" ? "Create your account" : "Welcome back"}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {mode === "forgot"
                ? "Enter your email to continue with account recovery."
                : mode === "signup"
                  ? "Set up your account and put your job search in motion."
                  : "Sign in to pick up where your job search left off."}
            </p>
          </div>

          {configurationError && (
            <p role="alert" className="mt-5 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Sign-in is temporarily unavailable. Please try again later.
            </p>
          )}

          {mode !== "forgot" && (
            <div className="mt-7 grid grid-cols-2 rounded-xl border border-border/70 bg-muted/70 p-1">
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    setSent(null);
                  }}
                  className={cn(
                    "min-h-10 rounded-lg text-sm font-medium transition-all",
                    mode === m ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "signin" ? "Sign in" : "Sign up"}
                </button>
              ))}
            </div>
          )}

          {sent ? (
            <div className="mt-7 rounded-2xl border border-border bg-accent p-4 text-sm leading-6 text-accent-foreground">{sent}</div>
          ) : (
            <form onSubmit={submit} aria-busy={busy} className="mt-7 space-y-5">
              {mode === "signup" && (
                <div className="space-y-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input
                    id="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-12 rounded-xl px-4"
                    placeholder="Your full name"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 rounded-xl px-4"
                  placeholder="you@example.com"
                />
              </div>
              {mode !== "forgot" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pw">Password</Label>
                    {mode === "signin" && (
                      <button
                        type="button"
                        onClick={() => setMode("forgot")}
                        className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Forgot?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="pw"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-12 rounded-xl px-4 pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
              )}
              <Button type="submit" variant="hero" size="lg" className="mt-1 h-12 w-full rounded-xl" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {busy
                  ? mode === "signin"
                    ? "Signing you in..."
                    : mode === "signup"
                      ? "Creating your account..."
                      : "Continuing..."
                  : mode === "signin"
                    ? "Sign in to workspace"
                    : mode === "signup"
                      ? "Create account"
                      : "Continue"}
              </Button>
              {mode === "forgot" && (
                <button type="button" onClick={() => setMode("signin")} className="w-full py-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
                  Back to sign in
                </button>
              )}
            </form>
          )}

          {mode !== "forgot" && (
            <>
              <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
              </div>
              <div>
                <Button variant="outline" size="lg" className="w-full bg-card" onClick={oauth} disabled={busy}>
                  <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                    <path
                      fill="currentColor"
                      d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.82h5.4a4.6 4.6 0 0 1-2 3.03v2.5h3.24c1.9-1.75 2.96-4.32 2.96-7.33ZM12 22c2.7 0 4.97-.9 6.63-2.43l-3.24-2.5c-.9.6-2.04.96-3.39.96-2.6 0-4.81-1.76-5.6-4.12H3.07v2.58A10 10 0 0 0 12 22Zm-5.6-8.09a6 6 0 0 1 0-3.82V7.5H3.07a10 10 0 0 0 0 9l3.33-2.59ZM12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.5l3.33 2.59C7.19 7.72 9.4 5.96 12 5.96Z"
                    />
                  </svg>
                  Continue with Google
                </Button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
