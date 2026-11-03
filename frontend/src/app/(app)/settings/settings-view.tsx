"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Chip } from "@/components/job-bits";
import { PageHeader } from "@/components/app-shell";
import { agent, useAgent } from "@/lib/agent-store";
import { TRACK_LABEL, type Track } from "@/lib/jobs";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-border p-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="ui-title">{title}</p>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      <div className="w-full min-w-0 sm:max-w-[55%]">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const limit = useAgent((s) => s.limit);
  const { theme, toggle } = useTheme();
  const [tracks, setTracks] = useState<Track[]>(["FRONTEND_WEB", "AI_FRONTEND", "MOBILE_FLUTTER"]);
  const [remote, setRemote] = useState(true);
  const [threshold, setThreshold] = useState(80);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
      <PageHeader eyebrow="Preferences" title="Settings" subtitle="Tell your agent what to hunt for and how hard to work." />
      <div className="mt-8 overflow-hidden rounded-3xl border border-border bg-card">
        <Row title="Target roles" desc="The agent only looks for these tracks.">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TRACK_LABEL) as Track[]).map((t) => {
              const on = tracks.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => setTracks(on ? tracks.filter((x) => x !== t) : [...tracks, t])}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition-colors",
                    on ? "border-transparent bg-primary text-primary-foreground" : "border-border text-muted-foreground",
                  )}
                >
                  {TRACK_LABEL[t]}
                </button>
              );
            })}
          </div>
        </Row>
        <Row title="Daily application limit" desc="Never send more than this many per day.">
          <div className="flex w-full items-center gap-3 sm:max-w-56">
            <Slider
              value={[limit]}
              min={1}
              max={200}
              step={1}
              onValueChange={([v]) => {
                if (v !== undefined) agent.setLimit(v);
              }}
            />
            <span className="w-8 text-right font-mono text-sm">{limit}</span>
          </div>
        </Row>
        <Row title="Minimum match score" desc="Roles below this are archived automatically.">
          <div className="flex w-full items-center gap-3 sm:max-w-56">
            <Slider
              value={[threshold]}
              min={50}
              max={95}
              step={5}
              onValueChange={([v]) => {
                if (v !== undefined) setThreshold(v);
              }}
            />
            <span className="w-10 text-right font-mono text-sm">{threshold}%</span>
          </div>
        </Row>
        <Row title="Remote only" desc="Skip on-site roles outside your city.">
          <Switch checked={remote} onCheckedChange={setRemote} />
        </Row>
        <Row title="Appearance" desc="Switch between light and dark.">
          <button onClick={toggle} className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm">
            {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
            {theme === "dark" ? "Dark" : "Light"}
          </button>
        </Row>
        <Row title="Inbox tracking" desc="Reads replies to update your application status.">
          <Chip tone="warning">Not connected</Chip>
        </Row>
      </div>
    </div>
  );
}
