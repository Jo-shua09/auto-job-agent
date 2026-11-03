"use client";

import { useEffect, useState } from "react";
import { Award, Briefcase, FileUp, Plus, Sparkles, User, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Chip } from "@/components/job-bits";
import { CvPreview } from "@/components/cv-preview";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { loadVault, useVault, vaultActions } from "@/lib/vault";
import { Textarea } from "@/components/ui/textarea";
import { ArtifactDrawer } from "@/components/queue/artifact-drawer";

const TABS = [
  { key: "personal", label: "Personal", icon: User },
  { key: "work", label: "Experience", icon: Briefcase },
  { key: "projects", label: "Projects", icon: Award },
  { key: "skills", label: "Skills", icon: Wrench },
  { key: "test", label: "Test CV", icon: Sparkles },
] as const;

export default function VaultPage() {
  const vault = useVault();
  useEffect(() => {
    loadVault();
  }, []);
  function acceptFile(file: File | undefined) {
    if (!file) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      toast.error("Choose a PDF or DOCX document.");
      return;
    }
    vaultActions.file(file.name);
    toast.success("CV selected", { description: "Your document stays on this device." });
  }
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("personal");
  const [testRole, setTestRole] = useState("Senior AI Frontend Engineer");
  const [drag, setDrag] = useState(false);
  const [cvOpen, setCvOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
      <PageHeader
        eyebrow="Single source of truth"
        title="Profile vault"
        subtitle="Your agent only uses facts stored here. It can rephrase and reorder, but never invent."
      />

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          acceptFile(e.dataTransfer.files[0]);
        }}
        className={cn(
          "mt-8 flex cursor-pointer flex-col items-center gap-3 rounded-3xl border-2 border-dashed p-8 text-center transition-colors",
          drag ? "border-mint bg-accent/40" : "border-border bg-card hover:bg-accent/20",
        )}
      >
        <input type="file" accept=".pdf,.docx" className="hidden" onChange={(e) => acceptFile(e.target.files?.[0])} />
        <span className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-foreground">
          <FileUp className="size-5" />
        </span>
        <div>
          <p className="ui-title break-all">{vault.fileName || "Drop your current CV here"}</p>
          <p className="text-sm text-muted-foreground">PDF or DOCX</p>
        </div>
      </label>

      <div className="-mx-4 mt-8 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors",
              tab === key
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "personal" && (
          <div className="grid gap-4 rounded-3xl border border-border bg-card p-5 sm:grid-cols-2 sm:p-6">
            {Object.entries(vault.personal).map(([l, v]) => (
              <div key={l} className="space-y-1.5">
                <Label htmlFor={`profile-${l}`}>{l}</Label>
                <Input
                  id={`profile-${l}`}
                  value={v}
                  onChange={(e) => vaultActions.personal(l, e.target.value)}
                  className="h-11 rounded-xl bg-background"
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <Button variant="hero" onClick={() => toast.success("Vault saved")}>
                Save changes
              </Button>
            </div>
          </div>
        )}

        {tab === "work" && (
          <div className="space-y-3">
            {vault.work.map((w) => (
              <div key={w.id} className="rounded-3xl border border-border bg-card p-5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input aria-label="Company" value={w.company} onChange={(e) => vaultActions.work(w.id, "company", e.target.value)} />
                    <Input aria-label="Role" value={w.role} onChange={(e) => vaultActions.work(w.id, "role", e.target.value)} />
                  </div>
                  <Input
                    aria-label="Employment dates"
                    value={w.dates}
                    onChange={(e) => vaultActions.work(w.id, "dates", e.target.value)}
                    className="sm:max-w-40 font-mono text-xs"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {w.tags.map((t) => (
                    <Chip key={t} tone="mint">
                      {t}
                    </Chip>
                  ))}
                </div>
                <Textarea
                  aria-label="Verified achievements"
                  value={w.bullets.join("\n")}
                  onChange={(e) => vaultActions.bullets(w.id, e.target.value)}
                  rows={3}
                  className="mt-3"
                />
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => vaultActions.removeWork(w.id)}>
                  Remove experience
                </Button>
              </div>
            ))}
            <Button variant="outline" className="w-full rounded-2xl border-dashed bg-transparent" onClick={vaultActions.addWork}>
              <Plus /> Add experience
            </Button>
          </div>
        )}

        {tab === "projects" && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {vault.projects.map((p) => (
              <div key={p.id} className="flex min-w-0 flex-col rounded-3xl border border-border bg-card p-5">
                <div className="flex flex-col gap-2">
                  <Input aria-label="Project name" value={p.name} onChange={(e) => vaultActions.project(p.id, "name", e.target.value)} />
                  {p.award && (
                    <Chip tone="warning">
                      <Award className="size-3" />
                      {p.award}
                    </Chip>
                  )}
                </div>
                <Textarea
                  aria-label="Project impact"
                  value={p.impact}
                  onChange={(e) => vaultActions.project(p.id, "impact", e.target.value)}
                  className="mt-3"
                />
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {p.stack.map((s) => (
                    <Chip key={s}>{s}</Chip>
                  ))}
                </div>
                <Input
                  aria-label="Project URL"
                  placeholder="https://your-project.com"
                  value={p.url}
                  onChange={(e) => vaultActions.project(p.id, "url", e.target.value)}
                  className="mt-3"
                />
              </div>
            ))}
          </div>
        )}

        {tab === "skills" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(vault.skills).map(([cat, list]) => (
              <div key={cat} className="rounded-3xl border border-border bg-card p-5">
                <p className="ui-title mb-3">{cat}</p>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((s) => (
                    <Chip key={s} tone="mint">
                      {s}
                    </Chip>
                  ))}
                </div>
                <Input
                  aria-label={`${cat} skills`}
                  value={list.join(", ")}
                  onChange={(e) => vaultActions.skills(cat, e.target.value)}
                  className="mt-3"
                />
              </div>
            ))}
          </div>
        )}

        {tab === "test" && (
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-4 rounded-3xl border border-border bg-card p-5">
              <p className="ui-title">Preview a CV for any role</p>
              <p className="text-sm text-muted-foreground">Type a role title to see how your vault would be tailored.</p>
              <Input value={testRole} onChange={(e) => setTestRole(e.target.value)} className="h-11 rounded-xl bg-background" />
              <Button variant="hero" onClick={() => setCvOpen(true)}>
                Open full-screen CV
              </Button>
            </div>
            <CvPreview role={testRole || "Your next role"} />
          </div>
        )}
      </div>
      <ArtifactDrawer artifact={cvOpen ? { company: "Your CV", role: testRole || "Your next role" } : null} onClose={() => setCvOpen(false)} />
    </div>
  );
}
