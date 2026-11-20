"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowRight, CircleAlert, Loader2, MapPin, Plus, Radar } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/app-shell";
import { ActionDialog } from "@/components/action-dialog";
import { apiRequest, ApiRequestError } from "@/lib/api";

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
function friendlyStep(step: Activity): { title: string; detail: string } {
  const raw = `${step.title} ${step.detail ?? ""}`.toLowerCase();
  if (/(quota|daily.*limit|ai limit)/.test(raw)) {
    return {
      title: "We've reached today's AI allowance",
      detail: "Nothing is lost and your saved work is safe. Come back tomorrow or upgrade your plan to keep going.",
    };
  }
  if (/(unavailable|high demand|temporar)/.test(raw)) {
    return {
      title: "Our AI helper is busy right now",
      detail: "Nothing is lost. Give it a moment and try that step again.",
    };
  }
  if (/(traceback|stack trace|unexpected error|backend)/.test(raw)) {
    return {
      title: "Something didn't go through",
      detail: "Your saved work is safe. Please try that step again.",
    };
  }
  if (/(verification code|otp|security code)/.test(raw)) {
    return {
      title: "A security code is needed",
      detail: "We've paused right here so you don't lose your place. Check your email for the code and enter it when you're ready.",
    };
  }
  return { title: step.title, detail: step.detail ?? "" };
}

function liveLine(step: Activity) {
  const { detail, title } = friendlyStep(step);
  const text = detail || title;
  return text.endsWith(".") || text.endsWith("...") ? text : `${text}...`;
}

function jobStatusLabel(status: string) {
  const labels: Record<string, string> = {
    DISCOVERED: "Ready to prepare",
    TAILORING_IN_PROGRESS: "Preparing your pack",
    AWAITING_APPROVAL: "Ready to review",
    APPLYING_QUEUED: "Ready to send",
    APPLYING: "Sending",
    SUBMITTED: "Sent",
    WAITING_FOR_OTP: "Needs your code",
    FAILED: "Needs attention",
  };
  return labels[status] ?? status.replaceAll("_", " ").toLowerCase();
}

function getFriendlyErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) return error.message;
  const raw = error instanceof Error ? error.message : "";
  if (!raw) return "Something didn't go through. Please try again.";
  const normalized = raw.toLowerCase();
  if (/(quota|daily.*limit|ai limit)/.test(normalized)) {
    return "We've reached today's AI allowance. Come back tomorrow or upgrade your plan to keep going.";
  }
  if (/(traceback|stack trace|unexpected error|backend|internal server)/.test(normalized)) {
    return "Something didn't go through on our side. Your work is safe. Please try again in a moment.";
  }
  return raw;
}

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
  const router = useRouter();
  const [preferences, setPreferences] = useState(EMPTY_PREFS);
  const [profileReady, setProfileReady] = useState(false);
  const [quota, setQuota] = useState<Quota>({ daily_apply_limit: 10, applied_today: 0, remaining_today: 10 });
  const [activities, setActivities] = useState<Activity[]>([]);
  const [actionStep, setActionStep] = useState<Activity | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferencesSaved, setPreferencesSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [roleDraft, setRoleDraft] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteMode, setPasteMode] = useState<"url" | "description">("url");
  const [pasteQuotaReached, setPasteQuotaReached] = useState(false);
  const handledActions = useRef<Set<string>>(new Set());
  const lastAction = useRef<(() => void) | null>(null);

  const refreshActivity = useCallback(async () => {
    const feed = await apiRequest<Activity[]>("/api/agent/activity-stream?limit=20");
    setActivities(feed);
  }, []);

  const loadActivity = useCallback(async () => Promise.all([
    apiRequest<Activity[]>("/api/agent/activity-stream?limit=20"),
    apiRequest<Job[]>("/api/jobs"),
  ]), []);

  const refresh = useCallback(async () => {
    const [feed, discovered] = await loadActivity();
    setActivities(feed);
    setJobs(discovered);
  }, [loadActivity]);

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
      .catch(() => toast.error("We couldn't load your workspace. Refresh the page to try again."))
      .finally(() => setLoading(false));
    void loadActivity()
      .then(([feed, discovered]) => {
        setActivities(feed);
        setJobs(discovered);
      })
      .catch(() => toast.error("We couldn't load your latest activity. Refresh the page to try again."));
  }, [loadActivity]);

  useEffect(() => {
    const poll = () => {
      if (!document.hidden) void refreshActivity().catch(() => undefined);
    };
    poll();
    const timer = window.setInterval(poll, 4000);
    return () => window.clearInterval(timer);
  }, [refreshActivity]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void apiRequest<Quota>("/api/scout/quota").then(setQuota).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const candidate = activities.find((step) =>
      (step.status === "error" || step.status === "waiting_input" || step.status === "stale") &&
      !handledActions.current.has(step.id) &&
      !/(verification code|otp|security code)/i.test(`${step.title} ${step.detail ?? ""}`),
    );
    if (!candidate) return;
    handledActions.current.add(candidate.id);
    setActionStep(candidate);
  }, [activities]);

  const liveSteps = activities.filter((step) => step.status === "active");
  const isLive = running || liveSteps.length > 0;
  const actionInfo = actionStep ? friendlyStep(actionStep) : null;
  const discoveredJobs = jobs.filter((job) => job.status === "DISCOVERED");

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
      toast.success("Saved. We'll use these choices for your next search.");
    } catch (error) {
      toast.error(getFriendlyErrorMessage(error));
    } finally { setSaving(false); }
  }

  async function launchScout() {
    if (!profileReady || !preferences.target_roles.some((role) => role.active)) return;
    lastAction.current = () => void launchScout();
    setRunning(true);
    try {
      await apiRequest("/api/scout/run", "POST", {});
      await refresh();
      toast.success("Your search is done. Take a look at the roles we found.");
    } catch (error) {
      toast.error(getFriendlyErrorMessage(error));
      await refresh().catch(() => undefined);
    } finally { setRunning(false); }
  }

  async function runPaste() {
    if (!profileReady || !pasteText.trim()) return;
    lastAction.current = () => void runPaste();
    setPasteQuotaReached(false);
    setRunning(true);
    try {
      await apiRequest("/api/scout/paste-job", "POST", pasteMode === "url" ? { external_url: pasteText.trim() } : { raw_jd_text: pasteText.trim() });
      setPasteText("");
      await refresh();
      toast.success("Added to your discovered jobs. Tailor it when you're ready.");
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 429 && /(limit|quota|allowance)/i.test(error.message)) {
        setPasteQuotaReached(true);
      } else {
        toast.error(getFriendlyErrorMessage(error));
      }
    } finally { setRunning(false); }
  }
  function pasteJob(event: FormEvent) {
    event.preventDefault();
    void runPaste();
  }

  async function tailorJob(jobId: string) {
    lastAction.current = () => void tailorJob(jobId);
    setRunning(true);
    try {
      await apiRequest(`/api/tailor/${encodeURIComponent(jobId)}`, "POST");
      await refresh();
      toast.success("Your application pack is ready to review.", { action: { label: "Open review queue", onClick: () => router.push("/queue") } });
    } catch (error) {
      toast.error(getFriendlyErrorMessage(error));
      await refresh().catch(() => undefined);
    } finally { setRunning(false); }
  }

  function handleActionPrimary() {
    setActionStep(null);
    if (actionStep?.status === "error" || actionStep?.status === "waiting_input") {
      if (lastAction.current) lastAction.current();
      else void refresh().catch(() => undefined);
      return;
    }
    void refresh().catch(() => undefined);
  }

  const needsSetup = !profileReady || !preferences.target_roles.some((role) => role.active);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
      <PageHeader eyebrow="Command center" title="Your job search" subtitle="Set your search criteria, then let the agent find and tailor real opportunities." />
      {needsSetup && <section className="mt-7 rounded-3xl border border-mint/30 bg-accent/40 p-5 sm:p-6"><h2 className="ui-title">Get started with your agent</h2><ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-muted-foreground"><li>Fill in or upload your base CV in the <Link className="text-mint underline" href="/vault">Master Vault</Link>, then save it.</li><li>Enter the roles, locations and work modes you want below, then save your choices.</li><li>Launch a search or paste a job you like to get started.</li></ol></section>}

      <section className="mt-7 space-y-5 rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="ui-title">Scout and application setup</h2><p className="text-xs text-muted-foreground">Applied today: {quota.applied_today} / {quota.daily_apply_limit} ({quota.remaining_today} remaining)</p></div>
        {loading ? <p className="text-sm text-muted-foreground">Loading your saved preferences...</p> : <>
          <div className="space-y-2"><p className="text-sm font-medium">Target job roles</p><div className="flex flex-wrap gap-2">{preferences.target_roles.map((role) => <div key={role.id} className={`flex flex-wrap items-center gap-1 rounded-full border px-3 py-1.5 text-sm ${role.active ? "border-mint/50 bg-accent" : "border-border opacity-60"}`}><button type="button" aria-pressed={role.active} onClick={() => updatePreferences({ target_roles: preferences.target_roles.map((item) => item.id === role.id ? { ...item, active: !item.active } : item) })}>{role.title}</button><button type="button" onClick={() => updatePreferences({ target_roles: preferences.target_roles.filter((item) => item.id !== role.id) })} aria-label={`Remove ${role.title}`}>×</button></div>)}</div><form onSubmit={addRole} className="flex gap-2"><Input aria-label="Add a job role" value={roleDraft} onChange={(event) => setRoleDraft(event.target.value)} placeholder="Type a job role and press Enter" className="h-11 bg-background" /><Button type="submit" variant="outline" aria-label="Add job role"><Plus /></Button></form></div>
          <TagInput label="Preferred locations" placeholder="Add a location" values={preferences.preferred_locations} onChange={(value) => updatePreferences({ preferred_locations: value })} />
          <TagInput label="Work modes" placeholder="Add a work mode" values={preferences.work_modes} onChange={(value) => updatePreferences({ work_modes: value })} />
          <TagInput label="Keywords to avoid" placeholder="Add a keyword" values={preferences.excluded_keywords} onChange={(value) => updatePreferences({ excluded_keywords: value })} />
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label htmlFor="match-score" className="text-sm font-medium">Minimum match score: {preferences.min_match_score}</label><input id="match-score" type="range" min="0" max="100" value={preferences.min_match_score} onChange={(event) => updatePreferences({ min_match_score: Number(event.target.value) })} className="w-full accent-primary" /></div><div className="space-y-2"><label htmlFor="apply-limit" className="text-sm font-medium">Applications per day</label><Input id="apply-limit" type="number" min={1} max={200} value={preferences.daily_apply_limit} onChange={(event) => updatePreferences({ daily_apply_limit: Number(event.target.value) })} className="h-11 bg-background" /></div></div>
          <div className="flex flex-wrap justify-end gap-3"><span className="self-center text-xs text-muted-foreground">{preferencesSaved ? "Saved to your account" : "Unsaved changes"}</span><Button variant="outline" onClick={() => void savePreferences()} disabled={saving}>{saving ? "Saving..." : "Save my choices"}</Button></div>
        </>}
      </section>

      <section className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="ui-title">Find your next role</h2><p className="mt-1 text-sm text-muted-foreground">{preferencesSaved ? "We'll look for roles that fit you, or you can paste one you already found." : "Save your choices above before we start looking."}</p></div><Button variant="hero" onClick={() => void launchScout()} disabled={loading || running || needsSetup || !preferencesSaved}>{running ? "Working..." : <><Radar /> Find matching jobs</>}</Button></div>
        <div className="mt-5 border-t border-border pt-5"><div className="mb-3 flex gap-2"><Button type="button" size="sm" variant={pasteMode === "url" ? "soft" : "ghost"} onClick={() => setPasteMode("url")}>Job link</Button><Button type="button" size="sm" variant={pasteMode === "description" ? "soft" : "ghost"} onClick={() => setPasteMode("description")}>Job description</Button></div><form onSubmit={(event) => void pasteJob(event)} className="space-y-3"><Textarea aria-label={pasteMode === "url" ? "Job link" : "Job description"} value={pasteText} onChange={(event) => { setPasteText(event.target.value); setPasteQuotaReached(false); }} placeholder={pasteMode === "url" ? "Paste a link to the job" : "Paste the job description"} rows={4} className="rounded-xl bg-background" /><div className="flex justify-end"><Button type="submit" variant="outline" disabled={loading || running || needsSetup || !preferencesSaved || !pasteText.trim()}>{running ? "Working..." : "Tailor this job for me"}</Button></div></form>
          {pasteQuotaReached && (
            <div role="alert" className="mt-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning-foreground" />
              <div className="min-w-0 text-sm leading-6">
                <p className="font-semibold">We’ve reached today’s AI allowance</p>
                <p className="mt-1 text-muted-foreground">That job wasn’t added to your queue and nothing was sent to the employer. Your saved work is safe. Come back tomorrow, or upgrade your AI plan if you’d like more room today.</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {isLive && (
        <section aria-live="polite" aria-labelledby="live-heading" className="mt-8 rounded-3xl border border-mint/30 bg-accent/40 p-5 shadow-soft sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-card text-mint"><Loader2 className="size-5 animate-spin" /></span>
            <div className="min-w-0">
              <h2 id="live-heading" className="ui-title">Your agent is working</h2>
              <p className="mt-1 text-sm text-muted-foreground">This is what it&apos;s doing right now. Nothing from earlier is shown here.</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {liveSteps.length ? liveSteps.slice(0, 3).map((step) => (
              <div key={step.id} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                <span className="mt-2 size-2 shrink-0 animate-pulse rounded-full bg-mint" />
                <p className="text-sm leading-6 text-foreground">{liveLine(step)}</p>
              </div>
            )) : (
              <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card/70 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Getting everything ready...
              </div>
            )}
          </div>
        </section>
      )}

      <section className="mt-8"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="ui-title">Discovered jobs <span className="font-normal text-muted-foreground">({discoveredJobs.length})</span></h2><Link href="/queue" className="flex items-center gap-1 text-sm text-mint hover:underline">Open review queue <ArrowRight className="size-3.5" /></Link></div>{discoveredJobs.length === 0 ? <p className="rounded-3xl border border-dashed border-border p-7 text-center text-sm text-muted-foreground">No discovered jobs right now. Launch a search or paste a job to find some.</p> : <ul className="space-y-2">{discoveredJobs.map((job) => <li key={job.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4"><MapPin className="size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate font-medium">{job.role_title}</p><p className="truncate text-sm text-muted-foreground">{job.company_name} · {job.location_type}</p></div><span className="text-sm font-medium">{job.match_score}% match</span><span className="rounded-full bg-accent px-2.5 py-1 text-xs">{jobStatusLabel(job.status)}</span>{job.external_url && <a href={job.external_url} target="_blank" rel="noreferrer" className="text-sm text-mint underline">View job</a>}<Button size="sm" variant="outline" onClick={() => void tailorJob(job.id)} disabled={running || needsSetup}>Tailor CV</Button></li>)}</ul>}</section>

      <ActionDialog
        open={Boolean(actionStep)}
        onOpenChange={(open) => { if (!open) setActionStep(null); }}
        tone={actionStep?.status === "error" ? "error" : "warning"}
        eyebrow={actionStep?.status === "error" ? "Something needs your attention" : "One quick step from you"}
        title={actionInfo?.title ?? ""}
        whatHappened={actionInfo?.detail ?? ""}
        nextSteps={actionStep?.status === "error"
          ? ["Your saved work is safe.", "Try that step again, or come back later if the service is busy."]
          : ["Read the message above.", "Do what's needed, then try that step again."]}
        primaryLabel={actionStep?.status === "error" || actionStep?.status === "waiting_input" ? "Try again" : "Check again"}
        onPrimary={handleActionPrimary}
        secondaryLabel="Not now"
        onSecondary={() => setActionStep(null)}
      />
    </div>
  );
}
