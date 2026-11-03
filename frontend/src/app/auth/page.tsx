import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Loader2, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { demoSignIn, getDemoUser } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark, BrandName } from "@/components/brand";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Sign in — Jobhunter Agent" },
      { name: "description", content: "Sign in to let your agent scout, tailor and apply to roles for you." },
      { property: "og:title", content: "Sign in — Jobhunter Agent" },
      { property: "og:description", content: "Your autonomous job-hunting copilot." },
    ],
  }),
  component: AuthPage,
});

const DEMO_STEPS = [
  "Scanning 15+ job boards for your roles",
  "Found 6 matches · removed 2 duplicates",
  "Tailoring your CV for VercelLabs (96% match)",
  "Checking every line against your real experience",
  "Ready for your review",
];

function StepShowcase() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x >= DEMO_STEPS.length ? 1 : x + 1)), 1600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="w-full max-w-md rounded-3xl border border-border/70 bg-card/70 p-5 shadow-soft backdrop-blur-xl">
      <p className="mb-4 font-mono text-[11px] tracking-[0.18em] text-mint uppercase">Live · agent at work</p>
      <ol className="space-y-3">
        {DEMO_STEPS.map((s, i) => {
          const state = i < n - 1 ? "done" : i === n - 1 ? "active" : "pending";
          return (
            <li key={s} className={cn("flex items-center gap-3 transition-opacity duration-500", state === "pending" && "opacity-35")}>
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border",
                  state === "done" ? "border-transparent bg-accent text-accent-foreground" : "border-mint",
                )}
              >
                {state === "done" ? (
                  <Check className="size-3.5" />
                ) : state === "active" ? (
                  <span className="animate-pulse-dot size-2 rounded-full bg-mint" />
                ) : null}
              </span>
              <span className={cn("text-[15px]", state === "active" && "shimmer-text")}>{s}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (getDemoUser()) navigate({ to: "/agent", replace: true });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        demoSignIn(email);
        navigate({ to: "/agent", replace: true });
      } else if (mode === "signup") {
        demoSignIn(email, name);
        navigate({ to: "/agent", replace: true });
      } else {
        setSent("Email recovery is not connected. Return to sign in to continue.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function oauth() {
    demoSignIn();
    navigate({ to: "/agent", replace: true });
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="bg-mesh grain relative hidden flex-col justify-between overflow-hidden p-10 lg:flex xl:p-14">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <BrandName />
        </div>
        <div className="space-y-8">
          <h2 className="font-display max-w-lg text-6xl leading-[1.02] xl:text-7xl">
            Stop filling forms. <em className="text-mint">Start interviewing.</em>
          </h2>
          <StepShowcase />
        </div>
        <p className="max-w-md text-sm text-muted-foreground">
          Finds roles, tailors your CV from verified facts only, and applies — pausing just to ask you for email codes.
        </p>
      </section>

      <section className="relative flex flex-col items-center justify-center px-5 py-10 sm:px-10">
        <button
          onClick={toggle}
          aria-label="Toggle theme"
          className="absolute top-5 right-5 grid size-10 place-items-center rounded-full border border-border bg-card"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <BrandMark />
            <BrandName />
          </div>
          <h1 className="font-display text-4xl">{mode === "forgot" ? "Reset password" : "Your autonomous career vanguard."}</h1>
          <p className="mt-2 text-muted-foreground">{mode === "forgot" ? "Password reset preview." : "Your next chapter starts here."}</p>

          {mode !== "forgot" && (
            <div className="mt-6 grid grid-cols-2 rounded-2xl border border-border bg-muted p-1">
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    setSent(null);
                  }}
                  className={cn("rounded-xl py-2 text-sm transition-all", mode === m ? "bg-card font-medium shadow-soft" : "text-muted-foreground")}
                >
                  {m === "signin" ? "Sign in" : "Sign up"}
                </button>
              ))}
            </div>
          )}

          {sent ? (
            <div className="mt-6 rounded-2xl border border-border bg-accent p-4 text-sm text-accent-foreground">{sent}</div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full name</Label>
                  <Input
                    id="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-11 rounded-xl"
                    placeholder="Joshua Onyeka"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-xl"
                  placeholder="you@example.com"
                />
              </div>
              {mode !== "forgot" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pw">Password</Label>
                    {mode === "signin" && (
                      <button type="button" onClick={() => setMode("forgot")} className="text-xs text-muted-foreground hover:text-foreground">
                        Forgot?
                      </button>
                    )}
                  </div>
                  <Input
                    id="pw"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 rounded-xl"
                  />
                </div>
              )}
              <Button type="submit" variant="hero" size="lg" className="w-full" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {mode === "signin" ? "Sign in to workspace" : mode === "signup" ? "Create account" : "Continue"}
              </Button>
              {mode === "forgot" && (
                <button type="button" onClick={() => setMode("signin")} className="w-full text-sm text-muted-foreground hover:text-foreground">
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
              <div className="space-y-2.5">
                <Button variant="outline" size="lg" className="w-full bg-card" onClick={oauth}>
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
