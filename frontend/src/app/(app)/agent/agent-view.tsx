"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Radar, Plus, MapPin } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { AgentRunCard } from "@/components/agent-run";
import { CompanyAvatar, MatchBadge } from "@/components/job-bits";
import { agent, useAgent } from "@/lib/agent-store";
import { appliedToday } from "@/lib/jobs";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function AgentPage() {
  const runs = useAgent((s) => s.runs);
  const queue = useAgent((s) => s.queue);
  const history = useAgent((s) => s.history);
  const limit = useAgent((s) => s.limit);
  const [roles, setRoles] = useState([
    { name: "AI Frontend Engineer", active: true },
    { name: "React / Next.js Engineer", active: true },
    { name: "Flutter Mobile Developer", active: true },
    { name: "Full-Stack TypeScript Engineer", active: false },
  ]);
  const [customRole, setCustomRole] = useState("");
  const [locations, setLocations] = useState(["Remote", "Lagos, Nigeria", "EMEA"]);
  const [mode, setMode] = useState<"scout" | "paste">("scout");
  const [text, setText] = useState("");
  const [autoQueue, setAutoQueue] = useState(true);
  const busy = runs.some((r) => !r.finished && r.kind !== "apply");
  const today = appliedToday(history);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 md:py-12 lg:px-8">
      <div className="text-center">
        <p className="font-mono text-[11px] tracking-[0.18em] text-mint uppercase">
          {today} of {limit} applications sent today
        </p>
        <h1 className="font-display mt-3 text-4xl leading-tight sm:text-6xl">
          {greeting()}. <em className="text-muted-foreground">Where shall we hunt?</em>
        </h1>
      </div>

      <section className="mt-8 rounded-3xl border border-border bg-card/60 p-4 shadow-soft sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="ui-title text-sm">Target roles</p>
          <span className="font-mono text-[10px] tracking-wide text-muted-foreground">95% AUTO · YOU APPROVE</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {roles.map((r, i) => (
            <Button
              key={r.name}
              size="sm"
              variant={r.active ? "soft" : "outline"}
              aria-pressed={r.active}
              onClick={() => setRoles((rs) => rs.map((x, j) => (i === j ? { ...x, active: !x.active } : x)))}
            >
              {r.active && <span className="size-1.5 rounded-full bg-mint" />}
              {r.name}
            </Button>
          ))}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!customRole.trim()) return;
            setRoles((rs) => [...rs, { name: customRole.trim(), active: true }]);
            setCustomRole("");
          }}
        >
          <input
            aria-label="Custom role"
            value={customRole}
            onChange={(e) => setCustomRole(e.target.value)}
            placeholder="Add a custom role"
            className="min-w-0 flex-1 bg-transparent text-sm border-b border-border py-2 outline-none"
          />
          <Button type="submit" size="icon" variant="ghost" aria-label="Add custom role">
            <Plus />
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <MapPin className="size-3.5 text-muted-foreground" />
          {["Remote", "Lagos, Nigeria", "EMEA"].map((l) => (
            <Button
              key={l}
              variant={locations.includes(l) ? "soft" : "ghost"}
              size="sm"
              aria-pressed={locations.includes(l)}
              onClick={() => setLocations((ls) => (ls.includes(l) ? ls.filter((x) => x !== l) : [...ls, l]))}
            >
              {l}
            </Button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label htmlFor="daily-limit">Daily limit</label>
          <input
            id="daily-limit"
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => agent.setLimit(Number(e.target.value))}
            className="w-16 rounded-lg border border-border bg-card px-2 py-1.5 font-mono text-foreground"
          />
          <span>
            jobs/day · {today} applied · {Math.max(0, limit - today)} remaining
          </span>
        </div>
      </section>
      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "scout") {
            agent.runScout();
            return;
          }
          if (!text.trim()) return;
          agent.pasteJob(text.trim(), autoQueue);
          setText("");
        }}
        className="mt-6 rounded-3xl border border-border bg-card p-4 shadow-soft transition-shadow focus-within:shadow-glow sm:mt-8 sm:p-5"
      >
        <div className="mb-3 flex gap-2 border-b border-border pb-3">
          <Button type="button" variant={mode === "scout" ? "soft" : "ghost"} size="sm" onClick={() => setMode("scout")}>
            <Radar />
            Scout
          </Button>
          <Button type="button" variant={mode === "paste" ? "soft" : "ghost"} size="sm" onClick={() => setMode("paste")}>
            Paste a job
          </Button>
        </div>
        {mode === "paste" ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={3}
            placeholder="Paste any job link or job post text from X, WhatsApp, LinkedIn…"
            className="w-full resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-muted-foreground"
          />
        ) : (
          <div className="px-2 py-4">
            <p className="font-display text-2xl">Let’s find your next good fit.</p>
            <p className="text-sm mt-2 text-muted-foreground">
              {roles
                .filter((r) => r.active)
                .map((r) => r.name)
                .join(" · ") || "Select a target role above"}
            </p>
            <p className="font-mono text-[10px] mt-3 text-mint">15+ BOARDS · VERIFIED FACTS · YOUR FINAL SAY</p>
          </div>
        )}
        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Switch checked={autoQueue} onCheckedChange={setAutoQueue} />
            Auto-queue for application
          </label>
          <div className="flex min-w-0 gap-2 sm:ml-auto">
            <Button type="submit" variant="hero" className="w-full sm:w-auto" disabled={busy || (mode === "paste" ? !text.trim() : !roles.some((r) => r.active))}>
              <Radar />
              {mode === "scout" ? "Launch autonomous scout" : "Tailor & queue"}
            </Button>
          </div>
        </div>
      </form>

      {/* Activity */}
      <div className="mt-10 space-y-4">
        {runs.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border p-8 text-center">
            <Radar className="mx-auto size-6 text-mint" />
            <p className="ui-title mt-3">Your agent is standing by</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Launch a scout or paste a job. You&apos;ll see every step here in plain English as it happens.
            </p>
          </div>
        ) : (
          runs.map((r) => <AgentRunCard key={r.id} run={r} />)
        )}
      </div>

      {queue.length > 0 && (
        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="ui-title">Waiting for your review</h2>
            <Link href="/queue" className="flex items-center gap-1 text-sm text-mint hover:underline">
              Open queue <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {queue.slice(0, 4).map((j) => (
              <Link
                key={j.id}
                href={`/queue?id=${encodeURIComponent(j.id)}`}
                className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:bg-accent/40"
              >
                <CompanyAvatar name={j.company} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{j.role}</p>
                  <p className="truncate text-xs text-muted-foreground">{j.company}</p>
                </div>
                <MatchBadge value={j.match} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
