"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowRight, MapPin, Plus, Radar } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/app-shell";
import { apiRequest } from "@/lib/api";

type Role = { id: string; title: string; active: boolean; priority_keywords: string[] };
type Preferences = {
  user_id: string;
  target_roles: Role[];
  preferred_locations: string[];
  work_modes: string[];
  excluded_keywords: string[];
  min_match_score: number;
  daily_apply_limit: number;
  target_ats_domains: string[];
  custom_job_domains: string[];
};
type ProfileStatus = { is_onboarded: boolean };
type Quota = { daily_apply_limit: number; applied_today: number; remaining_today: number };
type Activity = { id: string; title: string; detail?: string; status: string; timestamp: string };
type Job = { id: string; company_name: string; role_title: string; location_type: string; match_score: number; status: string; external_url: string };

const EMPTY_PREFS: Preferences = {
  user_id: "",
  target_roles: [],
  preferred_locations: [],
  work_modes: [],
  excluded_keywords: [],
  min_match_score: 75,
  daily_apply_limit: 10,
  target_ats_domains: [],
  custom_job_domains: [],
};
const MODES = ["REMOTE", "HYBRID", "ONSITE"];

function TagInput({ label, placeholder, values, onChange }: { label: string; placeholder: string; values: string[]; onChange: (value: string[]) => void }) {
  const [draft, setDraft] = useState("");
  function add(raw: string) {
    const value = raw.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setDraft("");
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(draft); }
    if (event.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
  }
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-input bg-background p-2">
        {values.map((value) => <button key={value} type="button" onClick={() => onChange(values.filter((item) => item !== value))} className="rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground" aria-label={`Remove ${value}`}>{value} ×</button>)}
        <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={keyDown} onBlur={() => draft.trim() && add(draft)} placeholder={placeholder} className="min-w-36 flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground" aria-label={label} />
      </div>
    </div>
  );
}

export default function AgentView() {
  const [preferences, setPreferences] = useState(EMPTY_PREFS);
  const [profileReady, setProfileReady] = useState(false);
  const [quota, setQuota] = useState<Quota>({ daily_apply_limit: 10, applied_today: 0, remaining_today: 10 });
  const [activities, setActivities] = useState<Activity[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferencesSaved, setPreferencesSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [roleDraft, setRoleDraft] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteMode, setPasteMode] = useState<"url" | "description">("url");

  const refresh = useCallback(async () => {
    const [feed, discovered] = await Promise.all([
      apiRequest<Activity[]>("/api/agent/activity-stream"),
      apiRequest<Job[]>("/api/jobs"),
    ]);
    setActivities(feed);
    setJobs(discovered);
  }, []);

  useEffect(() => {
    Promise.all([
      apiRequest<Preferences>("/api/scout/preferences"),
      apiRequest<ProfileStatus>("/api/vault"),
      apiRequest<Quota>("/api/scout/quota"),
    ])
      .then(([prefs, profile, currentQuota]) => {
        setPreferences({ ...EMPTY_PREFS, ...prefs });
        setPreferencesSaved(prefs.target_roles.length > 0);
        setProfileReady(profile.is_onboarded);
        setQuota(currentQuota);
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not load your workspace."))
      .finally(() => setLoading(false));
    void refresh().catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not load activity."));
  }, [refresh]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void refresh().catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not refresh activity."));
      void apiRequest<Quota>("/api/scout/quota")
        .then(setQuota)
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not refresh quota."));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [refresh, running]);

  function updatePreferences(patch: Partial<Preferences>) {
    setPreferencesSaved(false);
    setPreferences((current) => ({ ...current, ...patch }));
  }
  function addRole(event: FormEvent) {
    event.preventDefault();
    const title = roleDraft.trim();
    if (!title || preferences.target_roles.some((role) => role.title.toLowerCase() === title.toLowerCase())) return;
    updatePreferences({ target_roles: [...preferences.target_roles, { id: crypto.randomUUID(), title, active: true, priority_keywords: [] }] });
    setRoleDraft("");
  }
  async function savePreferences() {
    setSaving(true);
    try {
      const saved = await apiRequest<Preferences>("/api/scout/preferences", "PUT", preferences);
      setPreferences({ ...EMPTY_PREFS, ...saved });
      setPreferencesSaved(true);
      const latestQuota = await apiRequest<Quota>("/api/scout/quota");
      setQuota(latestQuota);
      toast.success("Scout configuration saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save your configuration.");
    } finally { setSaving(false); }
  }

  async function launchScout() {
    if (!profileReady || !preferences.target_roles.some((role) => role.active)) return;
    setRunning(true);
    try {
      await apiRequest("/api/scout/run", "POST", {});
      await refresh();
      toast.success("Scout run complete.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scout could not run.");
      await refresh().catch((refreshError: unknown) => toast.error(refreshError instanceof Error ? refreshError.message : "Could not refresh agent activity."));
    } finally { setRunning(false); }
  }
  async function pasteJob(event: FormEvent) {
    event.preventDefault();
    if (!profileReady || !pasteText.trim()) return;
    setRunning(true);
    try {
      await apiRequest("/api/scout/paste-job", "POST", pasteMode === "url" ? { external_url: pasteText.trim() } : { raw_jd_text: pasteText.trim() });
      setPasteText("");
      await refresh();
      toast.success("Tailored application package is ready for review.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not process this job.");
    } finally { setRunning(false); }
  }

  async function tailorJob(jobId: string) {
    setRunning(true);
    try {
      await apiRequest(`/api/tailor/${encodeURIComponent(jobId)}`, "POST");
      await refresh();
      toast.success("Tailored ATS package added to your review queue.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not tailor this job.");
    } finally { setRunning(false); }
  }

  const needsSetup = !profileReady || !preferences.target_roles.some((role) => role.active);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
      <PageHeader eyebrow="Command center" title="Your job search" subtitle="Set your search criteria, then let the agent find and tailor real opportunities." />
      {needsSetup && <section className="mt-7 rounded-3xl border border-mint/30 bg-accent/40 p-5 sm:p-6"><h2 className="ui-title">Get started with your agent</h2><ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-muted-foreground"><li>Fill in or upload your base CV in the <Link className="text-mint underline" href="/vault">Master Vault</Link>, then save it.</li><li>Enter your target roles, locations and work modes below, then save your configuration.</li><li>Launch the Scout or paste a job URL or description to begin.</li></ol></section>}

      <section className="mt-7 space-y-5 rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="ui-title">Scout and application configuration</h2><p className="text-xs text-muted-foreground">Applied today: {quota.applied_today} / {quota.daily_apply_limit} ({quota.remaining_today} remaining)</p></div>
        {loading ? <p className="text-sm text-muted-foreground">Loading your saved preferences...</p> : <>
          <div className="space-y-2"><label className="text-sm font-medium">Target job roles</label><div className="flex flex-wrap gap-2">{preferences.target_roles.map((role) => <div key={role.id} className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm ${role.active ? "border-mint/50 bg-accent" : "border-border opacity-60"}`}><button type="button" aria-pressed={role.active} onClick={() => updatePreferences({ target_roles: preferences.target_roles.map((item) => item.id === role.id ? { ...item, active: !item.active } : item) })}>{role.title}</button><button type="button" onClick={() => updatePreferences({ target_roles: preferences.target_roles.filter((item) => item.id !== role.id) })} aria-label={`Remove ${role.title}`}>×</button></div>)}</div><form onSubmit={addRole} className="flex gap-2"><Input value={roleDraft} onChange={(event) => setRoleDraft(event.target.value)} placeholder="Type a job role and press Enter" className="h-11 bg-background" /><Button type="submit" variant="outline" aria-label="Add role"><Plus /></Button></form></div>
          <TagInput label="Preferred locations" placeholder="Add locations, press Enter" values={preferences.preferred_locations} onChange={(value) => updatePreferences({ preferred_locations: value })} />
          <div className="space-y-2"><p className="text-sm font-medium">Work modes</p><div className="flex flex-wrap gap-2">{MODES.map((mode) => <Button key={mode} type="button" variant={preferences.work_modes.includes(mode) ? "soft" : "outline"} aria-pressed={preferences.work_modes.includes(mode)} onClick={() => updatePreferences({ work_modes: preferences.work_modes.includes(mode) ? preferences.work_modes.filter((item) => item !== mode) : [...preferences.work_modes, mode] })}>{mode}</Button>)}</div></div>
          <TagInput label="Excluded keywords and blockers" placeholder="Add a keyword, press Enter" values={preferences.excluded_keywords} onChange={(value) => updatePreferences({ excluded_keywords: value })} />
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label htmlFor="match-score" className="text-sm font-medium">Minimum match score: {preferences.min_match_score}</label><input id="match-score" type="range" min="0" max="100" value={preferences.min_match_score} onChange={(event) => updatePreferences({ min_match_score: Number(event.target.value) })} className="w-full accent-primary" /></div><div className="space-y-2"><label htmlFor="apply-limit" className="text-sm font-medium">Daily auto-apply limit</label><Input id="apply-limit" type="number" min={1} max={200} value={preferences.daily_apply_limit} onChange={(event) => updatePreferences({ daily_apply_limit: Number(event.target.value) })} className="h-11 bg-background" /></div></div>
          <div className="flex justify-end gap-3"><span className="self-center text-xs text-muted-foreground">{preferencesSaved ? "Saved to your account" : "Unsaved changes"}</span><Button variant="outline" onClick={() => void savePreferences()} disabled={saving}>{saving ? "Saving..." : "Save configuration"}</Button></div>
        </>}
      </section>

      <section className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="ui-title">Start a search</h2><p className="mt-1 text-sm text-muted-foreground">{preferencesSaved ? "Find matching jobs or tailor a specific posting." : "Save your search configuration before starting."}</p></div><Button variant="hero" onClick={() => void launchScout()} disabled={loading || running || needsSetup || !preferencesSaved}>{running ? "Working..." : <><Radar /> Launch Autonomous Scout</>}</Button></div>
        <div className="mt-5 border-t border-border pt-5"><div className="mb-3 flex gap-2"><Button type="button" size="sm" variant={pasteMode === "url" ? "soft" : "ghost"} onClick={() => setPasteMode("url")}>Job URL</Button><Button type="button" size="sm" variant={pasteMode === "description" ? "soft" : "ghost"} onClick={() => setPasteMode("description")}>Job description</Button></div><form onSubmit={(event) => void pasteJob(event)} className="space-y-3"><Textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={pasteMode === "url" ? "Paste a job URL" : "Paste the job description"} rows={4} className="rounded-xl bg-background" /><div className="flex justify-end"><Button type="submit" variant="outline" disabled={loading || running || needsSetup || !preferencesSaved || !pasteText.trim()}>{running ? "Processing..." : "Tailor this job"}</Button></div></form></div>
      </section>

      <section className="mt-8 space-y-3"><div className="flex items-center justify-between"><h2 className="ui-title">Live agent activity</h2>{running && <span className="text-xs text-mint">Updating every 2 seconds</span>}</div>{activities.length === 0 ? <div className="rounded-3xl border border-dashed border-border p-8 text-center"><Radar className="mx-auto size-6 text-mint" /><p className="mt-3 font-medium">No agent activity yet</p><p className="mt-1 text-sm text-muted-foreground">Your real progress updates will appear here after you start a search.</p></div> : <ol className="space-y-2">{activities.map((item) => <li key={item.id} className="rounded-2xl border border-border bg-card p-4"><div className="flex items-start gap-3"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${item.status === "active" ? "animate-pulse bg-mint" : item.status === "error" ? "bg-destructive" : "bg-muted-foreground/50"}`} /><div className="min-w-0 flex-1"><p className="font-medium">{item.title}</p>{item.detail && <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>}</div><time className="shrink-0 text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleTimeString()}</time></div></li>)}</ol>}</section>

      <section className="mt-8"><div className="mb-3 flex items-center justify-between"><h2 className="ui-title">Discovered jobs</h2><Link href="/queue" className="flex items-center gap-1 text-sm text-mint hover:underline">Review queue <ArrowRight className="size-3.5" /></Link></div>{jobs.length === 0 ? <p className="rounded-3xl border border-dashed border-border p-7 text-center text-sm text-muted-foreground">No jobs discovered yet. Save your setup and launch the Scout or paste a job.</p> : <ul className="space-y-2">{jobs.map((job) => <li key={job.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4"><MapPin className="size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate font-medium">{job.role_title}</p><p className="truncate text-sm text-muted-foreground">{job.company_name} · {job.location_type}</p></div><span className="text-sm font-medium">{job.match_score}% match</span><span className="rounded-full bg-accent px-2.5 py-1 text-xs">{job.status}</span>{job.external_url && <a href={job.external_url} target="_blank" rel="noreferrer" className="text-sm text-mint underline">View job</a>}{job.status === "DISCOVERED" && <Button size="sm" variant="outline" onClick={() => void tailorJob(job.id)} disabled={running || needsSetup}>Tailor for review</Button>}</li>)}</ul>}</section>
    </div>
  );
}
