import { useState } from "react";
import { Check, ChevronDown, Loader2, Pause } from "lucide-react";
import type { AgentRun } from "@/lib/agent-store";
import { cn } from "@/lib/utils";

export function AgentRunCard({ run }: { run: AgentRun }) {
  const [open, setOpen] = useState(true);
  const done = run.steps.filter((s) => s.state === "done").length;
  const active = run.steps.find((s) => s.state !== "done");
  return (
    <div className="animate-rise overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left sm:p-5">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full",
            run.finished ? "bg-accent text-accent-foreground" : "bg-primary/15 text-mint",
          )}
        >
          {run.finished ? <Check className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="ui-title truncate">{run.title}</p>
          <p className={cn("truncate text-sm", run.finished ? "text-muted-foreground" : "shimmer-text")}>
            {run.finished ? run.summary : (active?.title ?? "Getting started…")}
          </p>
        </div>
        <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:block">
          {done}/{run.finished ? run.steps.length : Math.max(run.steps.length, done + 1)} steps
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ol className="relative border-t border-border px-4 py-4 sm:px-5">
          {run.steps.map((s, i) => (
            <li key={s.id} className="animate-rise relative flex gap-3 pb-4 last:pb-0">
              {i < run.steps.length - 1 && <span className="absolute top-6 bottom-0 left-[11px] w-px bg-border" />}
              <span
                className={cn(
                  "relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border",
                  s.state === "done" && "border-transparent bg-accent text-accent-foreground",
                  s.state === "active" && "border-mint bg-card",
                  s.state === "paused" && "border-warning bg-warning/15 text-warning",
                )}
              >
                {s.state === "done" && <Check className="size-3.5" />}
                {s.state === "active" && <span className="animate-pulse-dot size-2 rounded-full bg-mint" />}
                {s.state === "paused" && <Pause className="size-3" />}
              </span>
              <div className="min-w-0">
                <p className={cn("text-[15px] leading-snug", s.state === "done" ? "text-foreground/85" : "text-foreground")}>{s.title}</p>
                {s.detail && (
                  <details className="mt-1 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">View details</summary>
                    <p className="mt-1 font-mono break-words">{s.detail}</p>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
