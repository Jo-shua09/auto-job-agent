"use client";

import { useEffect, useState, type DragEvent, type KeyboardEvent } from "react";
import { FileUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/app-shell";
import { apiRequest, uploadCv } from "@/lib/api";

type Experience = {
  id: string;
  company: string;
  role_title: string;
  location: string;
  start_date: string;
  end_date: string;
  role_tags: string[];
  tech_used: string[];
  verified_bullets: string[];
};
type Project = {
  id: string;
  name: string;
  role: string;
  live_url: string;
  github_url: string;
  role_tags: string[];
  tech_stack: string[];
  awards_or_metrics: string;
  verified_bullets: string[];
};
type Education = { institution: string; degree: string; location: string; dates: string };
type Profile = {
  user_id: string;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  portfolio_url: string;
  github_url: string;
  linkedin_url: string;
  summary_template: string;
  experiences: Experience[];
  projects: Project[];
  education: Education[];
  skills_by_category: Record<string, string[]>;
  application_defaults: Record<string, string>;
  is_onboarded: boolean;
};

const EMPTY_PROFILE: Profile = {
  user_id: "",
  full_name: "",
  email: "",
  phone: "",
  location: "",
  portfolio_url: "",
  github_url: "",
  linkedin_url: "",
  summary_template: "",
  experiences: [],
  projects: [],
  education: [],
  skills_by_category: {},
  application_defaults: {
    notice_period: "",
    expected_salary: "",
    work_authorization: "",
    requires_sponsorship: "",
    preferred_work_mode: "",
  },
  is_onboarded: false,
};

function newId() {
  return crypto.randomUUID();
}

function TagEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (items: string[]) => void }) {
  const [draft, setDraft] = useState("");
  function add(value: string) {
    const tag = value.trim();
    if (tag && !values.includes(tag)) onChange([...values, tag]);
    setDraft("");
  }
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  }
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-input bg-background p-2">
        {values.map((value) => (
          <button
            type="button"
            key={value}
            onClick={() => onChange(values.filter((item) => item !== value))}
            className="rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground"
            aria-label={`Remove ${value}`}
          >
            {value} ×
          </button>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => draft.trim() && add(draft)}
          placeholder="Type and press Enter"
          className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
          aria-label={label}
        />
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder = "" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-11 rounded-xl bg-background" />
    </div>
  );
}

export default function VaultView() {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState("");

  useEffect(() => {
    apiRequest<Profile>("/api/vault")
      .then((result) => setProfile({ ...EMPTY_PROFILE, ...result, application_defaults: { ...EMPTY_PROFILE.application_defaults, ...result.application_defaults } }))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not load your Vault."))
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }
  function patchDefaults(key: string, value: string) {
    setProfile((current) => ({ ...current, application_defaults: { ...current.application_defaults, [key]: value } }));
  }
  function patchExperience(id: string, key: keyof Experience, value: string | string[]) {
    setProfile((current) => ({ ...current, experiences: current.experiences.map((item) => item.id === id ? { ...item, [key]: value } : item) }));
  }
  function patchProject(id: string, key: keyof Project, value: string | string[]) {
    setProfile((current) => ({ ...current, projects: current.projects.map((item) => item.id === id ? { ...item, [key]: value } : item) }));
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await apiRequest<Profile>("/api/vault", "PUT", profile);
      setProfile({ ...EMPTY_PROFILE, ...saved, application_defaults: { ...EMPTY_PROFILE.application_defaults, ...saved.application_defaults } });
      if (saved.is_onboarded) toast.success("Vault saved to your account.");
      else toast.info("Vault saved. Add your name, email, and at least one verified career fact to finish setup.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save your Vault.");
    } finally {
      setSaving(false);
    }
  }

  async function upload(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Choose a PDF file.");
      return;
    }
    setUploading(true);
    try {
      const result = await uploadCv(file) as { profile: Profile };
      setProfile({ ...EMPTY_PROFILE, ...result.profile, application_defaults: { ...EMPTY_PROFILE.application_defaults, ...result.profile.application_defaults } });
      toast.success("CV details extracted. Review and save your Vault.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not parse this CV.");
    } finally {
      setUploading(false);
    }
  }

  function preventAndSetDrag(event: DragEvent<HTMLLabelElement>, value: boolean) {
    event.preventDefault();
    setDragging(value);
  }

  const inputClass = "h-11 rounded-xl bg-background";
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
      <PageHeader eyebrow="Your verified career details" title="Profile vault" subtitle="Start with a blank profile or upload a PDF CV. The agent will only use information you save here." />
      <label
        onDragOver={(event) => preventAndSetDrag(event, true)}
        onDragLeave={(event) => preventAndSetDrag(event, false)}
        onDrop={(event) => { preventAndSetDrag(event, false); void upload(event.dataTransfer.files[0]); }}
        className={`mt-8 flex cursor-pointer flex-col items-center gap-3 rounded-3xl border-2 border-dashed p-7 text-center ${dragging ? "border-mint bg-accent/40" : "border-border bg-card hover:bg-accent/20"}`}
      >
        <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        <span className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-foreground"><FileUp className="size-5" /></span>
        <span><span className="block font-medium">{uploading ? "Extracting your CV..." : "Drop your base CV PDF here or browse"}</span><span className="mt-1 block text-sm text-muted-foreground">Your extracted details will be editable below.</span></span>
      </label>

      {loading ? <p className="py-10 text-center text-sm text-muted-foreground">Loading your saved Vault...</p> : (
        <div className="mt-6 space-y-6">
          <section className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
            <h2 className="ui-title">Personal and contact details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" value={profile.full_name} onChange={(v) => update("full_name", v)} />
              <Field label="Email" value={profile.email} onChange={(v) => update("email", v)} />
              <Field label="Phone" value={profile.phone} onChange={(v) => update("phone", v)} />
              <Field label="Current location" value={profile.location} onChange={(v) => update("location", v)} />
              <Field label="Portfolio URL" value={profile.portfolio_url ?? ""} onChange={(v) => update("portfolio_url", v)} />
              <Field label="GitHub URL" value={profile.github_url} onChange={(v) => update("github_url", v)} />
              <Field label="LinkedIn URL" value={profile.linkedin_url} onChange={(v) => update("linkedin_url", v)} />
              <div className="space-y-1.5 sm:col-span-2"><Label>Professional summary template</Label><Textarea value={profile.summary_template} onChange={(event) => update("summary_template", event.target.value)} rows={4} className="rounded-xl bg-background" /></div>
            </div>
          </section>

          <section className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
            <h2 className="ui-title">Application defaults</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Notice period" value={profile.application_defaults.notice_period ?? ""} onChange={(v) => patchDefaults("notice_period", v)} placeholder="e.g. Immediate, 2 Weeks" />
              <Field label="Expected salary" value={profile.application_defaults.expected_salary ?? ""} onChange={(v) => patchDefaults("expected_salary", v)} />
              <Field label="Work authorization" value={profile.application_defaults.work_authorization ?? ""} onChange={(v) => patchDefaults("work_authorization", v)} />
              <div className="space-y-1.5"><Label>Requires sponsorship</Label><select value={profile.application_defaults.requires_sponsorship ?? ""} onChange={(event) => patchDefaults("requires_sponsorship", event.target.value)} className={`${inputClass} w-full border border-input px-3`}><option value="">Select</option><option value="No">No</option><option value="Yes">Yes</option></select></div>
              <div className="space-y-1.5"><Label>Preferred work mode</Label><select value={profile.application_defaults.preferred_work_mode ?? ""} onChange={(event) => patchDefaults("preferred_work_mode", event.target.value)} className={`${inputClass} w-full border border-input px-3`}><option value="">Select</option><option value="Remote">Remote</option><option value="Hybrid">Hybrid</option><option value="Onsite">Onsite</option></select></div>
            </div>
          </section>

          <section className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3"><h2 className="ui-title">Work experience</h2><Button variant="outline" size="sm" onClick={() => update("experiences", [...profile.experiences, { id: newId(), company: "", role_title: "", location: "", start_date: "", end_date: "", role_tags: [], tech_used: [], verified_bullets: [] }])}><Plus /> Add Work Experience</Button></div>
            {profile.experiences.length === 0 && <p className="text-sm text-muted-foreground">No experience added yet.</p>}
            {profile.experiences.map((item) => <div key={item.id} className="space-y-4 rounded-2xl border border-border p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Company" value={item.company} onChange={(v) => patchExperience(item.id, "company", v)} />
                <Field label="Role title" value={item.role_title} onChange={(v) => patchExperience(item.id, "role_title", v)} />
                <Field label="Location" value={item.location} onChange={(v) => patchExperience(item.id, "location", v)} />
                <div className="grid grid-cols-2 gap-3"><Field label="Start date" value={item.start_date} onChange={(v) => patchExperience(item.id, "start_date", v)} /><Field label="End date" value={item.end_date} onChange={(v) => patchExperience(item.id, "end_date", v)} /></div>
                <TagEditor label="Role tags" values={item.role_tags} onChange={(v) => patchExperience(item.id, "role_tags", v)} />
                <TagEditor label="Technologies used" values={item.tech_used} onChange={(v) => patchExperience(item.id, "tech_used", v)} />
                <div className="space-y-1.5 sm:col-span-2"><Label>Verified bullets (one per line)</Label><Textarea value={item.verified_bullets.join("\n")} onChange={(event) => patchExperience(item.id, "verified_bullets", event.target.value.split("\n"))} rows={4} className="rounded-xl bg-background" /></div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => update("experiences", profile.experiences.filter((entry) => entry.id !== item.id))}><Trash2 /> Remove experience</Button>
            </div>)}
          </section>

          <section className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3"><h2 className="ui-title">Projects</h2><Button variant="outline" size="sm" onClick={() => update("projects", [...profile.projects, { id: newId(), name: "", role: "", live_url: "", github_url: "", role_tags: [], tech_stack: [], awards_or_metrics: "", verified_bullets: [] }])}><Plus /> Add Project</Button></div>
            {profile.projects.length === 0 && <p className="text-sm text-muted-foreground">No projects added yet.</p>}
            {profile.projects.map((item) => <div key={item.id} className="space-y-4 rounded-2xl border border-border p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Project name" value={item.name} onChange={(v) => patchProject(item.id, "name", v)} />
                <Field label="Your role" value={item.role} onChange={(v) => patchProject(item.id, "role", v)} />
                <Field label="Live URL" value={item.live_url ?? ""} onChange={(v) => patchProject(item.id, "live_url", v)} />
                <Field label="GitHub URL" value={item.github_url ?? ""} onChange={(v) => patchProject(item.id, "github_url", v)} />
                <TagEditor label="Role tags" values={item.role_tags} onChange={(v) => patchProject(item.id, "role_tags", v)} />
                <TagEditor label="Tech stack" values={item.tech_stack} onChange={(v) => patchProject(item.id, "tech_stack", v)} />
                <Field label="Awards or metrics" value={item.awards_or_metrics ?? ""} onChange={(v) => patchProject(item.id, "awards_or_metrics", v)} />
                <div className="space-y-1.5 sm:col-span-2"><Label>Verified bullets (one per line)</Label><Textarea value={item.verified_bullets.join("\n")} onChange={(event) => patchProject(item.id, "verified_bullets", event.target.value.split("\n"))} rows={4} className="rounded-xl bg-background" /></div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => update("projects", profile.projects.filter((entry) => entry.id !== item.id))}><Trash2 /> Remove project</Button>
            </div>)}
          </section>

          <section className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3"><h2 className="ui-title">Education</h2><Button variant="outline" size="sm" onClick={() => update("education", [...profile.education, { institution: "", degree: "", location: "", dates: "" }])}><Plus /> Add Education</Button></div>
            {profile.education.length === 0 && <p className="text-sm text-muted-foreground">No education added yet.</p>}
            {profile.education.map((item, index) => <div key={`${index}-${item.institution}`} className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-2">
              {(["institution", "degree", "location", "dates"] as const).map((field) => <Field key={field} label={field[0]!.toUpperCase() + field.slice(1)} value={item[field]} onChange={(value) => update("education", profile.education.map((entry, i) => i === index ? { ...entry, [field]: value } : entry))} />)}
              <Button variant="ghost" size="sm" className="sm:col-span-2 sm:justify-self-start" onClick={() => update("education", profile.education.filter((_, i) => i !== index))}><Trash2 /> Remove education</Button>
            </div>)}
          </section>

          <section className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="ui-title">Skills by category</h2><form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const category = categoryDraft.trim(); if (category && !Object.hasOwn(profile.skills_by_category, category)) update("skills_by_category", { ...profile.skills_by_category, [category]: [] }); setCategoryDraft(""); }}><Input aria-label="New skill category" value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} placeholder="New category" className="h-10 w-40 bg-background" /><Button type="submit" variant="outline" size="sm"><Plus /> Add</Button></form></div>
            {Object.entries(profile.skills_by_category).length === 0 && <p className="text-sm text-muted-foreground">Add a skill category to get started.</p>}
            <div className="grid gap-4 sm:grid-cols-2">{Object.entries(profile.skills_by_category).map(([category, skills]) => <div key={category} className="space-y-2 rounded-2xl border border-border p-4"><div className="flex items-center justify-between"><h3 className="font-medium">{category}</h3><button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => { const next = { ...profile.skills_by_category }; delete next[category]; update("skills_by_category", next); }}>Remove category</button></div><TagEditor label={`${category} skills`} values={skills} onChange={(value) => update("skills_by_category", { ...profile.skills_by_category, [category]: value })} /></div>)}</div>
          </section>
          <div className="flex justify-end"><Button variant="hero" size="lg" onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save Vault to Database"}</Button></div>
        </div>
      )}
    </div>
  );
}
