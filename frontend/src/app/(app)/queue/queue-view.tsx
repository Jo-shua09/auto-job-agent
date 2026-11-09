"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ExternalLink, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/app-shell";
import { API_URL, apiRequest } from "@/lib/api";

type Job = {
  id: string;
  company_name: string;
  role_title: string;
  external_url: string;
  location_type: string;
  match_score: number;
  match_reasoning?: string;
  ats_platform: string;
};
type TailoredPackage = {
  job_id: string;
  target_role_headline: string;
  tailored_summary: string;
  critic_score: number;
  critic_feedback?: string;
  cv_pdf_url?: string | null;
  cover_letter_text?: string | null;
  screening_answers: Record<string, string>;
};
type PackageState =
  | { jobId: string; status: "loading" | "error" }
  | { jobId: string; status: "loaded"; data: TailoredPackage }
  | null;

export default function QueueView() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [packageState, setPackageState] = useState<PackageState>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  const refreshQueue = async () => {
    const data = await apiRequest<Job[]>("/api/jobs?status=AWAITING_APPROVAL");
    setJobs(data);
    if (selectedId && !data.some((job) => job.id === selectedId)) {
      setSelectedId("");
    }
  };

  useEffect(() => {
    apiRequest<Job[]>("/api/jobs?status=AWAITING_APPROVAL")
      .then(setJobs)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not load the review queue."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    apiRequest<TailoredPackage>(`/api/tailor/${encodeURIComponent(selectedId)}`)
      .then((result) => {
        if (!active) return;
        setPackageState({ jobId: selectedId, status: "loaded", data: result });
        setCoverLetter(result.cover_letter_text ?? "");
        setAnswers(result.screening_answers ?? {});
      })
      .catch((error: unknown) => {
        if (active) {
          setPackageState({ jobId: selectedId, status: "error" });
          toast.error(error instanceof Error ? error.message : "Could not load the tailored package.");
        }
      });
    return () => { active = false; };
  }, [selectedId]);

  async function saveEdits() {
    if (!selectedId) return false;
    setSaving(true);
    try {
      const saved = await apiRequest<TailoredPackage>(`/api/tailor/${encodeURIComponent(selectedId)}`, "PATCH", {
        cover_letter_text: coverLetter,
        screening_answers: answers,
      });
      setPackageState({ jobId: selectedId, status: "loaded", data: saved });
      toast.success("Tailored application updated.");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save your edits.");
      return false;
    } finally { setSaving(false); }
  }

  async function approveAndApply() {
    if (!selectedId) return;
    setApplying(true);
    try {
      if (!await saveEdits()) throw new Error("Save your tailored package before approving it.");
      await apiRequest(`/api/jobs/${encodeURIComponent(selectedId)}/approve`, "POST");
      await apiRequest(`/api/apply/${encodeURIComponent(selectedId)}/execute`, "POST");
      toast.success("Application submitted to the agent.");
      setSelectedId("");
      await refreshQueue();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start the application.");
      await refreshQueue().catch((refreshError: unknown) => toast.error(refreshError instanceof Error ? refreshError.message : "Could not refresh the review queue."));
    } finally { setApplying(false); }
  }

  const selected = jobs.find((job) => job.id === selectedId);
  const packageData = packageState?.jobId === selectedId && packageState.status === "loaded" ? packageState.data : null;
  const packageLoading = Boolean(selectedId) && (
    packageState?.jobId !== selectedId || packageState.status === "loading"
  );
  const pdfUrl = packageData?.cv_pdf_url ? (packageData.cv_pdf_url.startsWith("http") ? packageData.cv_pdf_url : `${API_URL}${packageData.cv_pdf_url}`) : null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
      <PageHeader eyebrow={`${jobs.length} awaiting approval`} title="Review queue" subtitle="Review the real tailored package before approving an application." />
      {loading ? <p className="py-12 text-center text-sm text-muted-foreground">Loading your review queue...</p> : jobs.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-border p-10 text-center"><p className="ui-title">Nothing waiting for review</p><p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">No tailored applications waiting for approval yet. Run the Scout or paste a job link to generate tailored ATS packages.</p><Button asChild variant="hero" className="mt-5"><Link href="/agent">Go to Command Center</Link></Button></div>
      ) : <div className="mt-8 grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ul className="space-y-2">{jobs.map((job) => <li key={job.id}><button type="button" onClick={() => { if (selectedId !== job.id) setPackageState({ jobId: job.id, status: "loading" }); setSelectedId(job.id); }} className={`w-full rounded-2xl border p-4 text-left ${selectedId === job.id ? "border-mint/60 bg-card shadow-glow" : "border-border bg-card hover:bg-accent/30"}`}><p className="font-medium">{job.role_title}</p><p className="mt-1 text-sm text-muted-foreground">{job.company_name}</p><p className="mt-3 text-xs text-muted-foreground">{job.match_score}% match · {job.location_type} · {job.ats_platform}</p></button></li>)}</ul>
        {!selectedId ? <div className="grid min-h-60 place-items-center rounded-3xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Select an application to review its tailored package.</div> : selected && <section className="min-w-0 space-y-5 rounded-3xl border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-3xl">{selected.role_title}</h2><p className="mt-1 text-muted-foreground">{selected.company_name} · {selected.location_type} · {selected.match_score}% match</p>{selected.match_reasoning && <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{selected.match_reasoning}</p>}</div><Button asChild size="sm" variant="outline"><a href={selected.external_url} target="_blank" rel="noreferrer"><ExternalLink /> Job post</a></Button></div>
          {packageLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading tailored application...</p> : !packageData ? <p className="py-6 text-sm text-muted-foreground">The tailored package is not available.</p> : <>
            <div className="grid gap-5 xl:grid-cols-2">
              <div className="space-y-4"><div><p className="text-sm font-medium">Tailored headline</p><p className="mt-1">{packageData.target_role_headline}</p></div><div><p className="text-sm font-medium">Tailored summary</p><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{packageData.tailored_summary}</p></div><p className="text-sm">Review score: <span className="font-semibold">{packageData.critic_score}/100</span>{packageData.critic_feedback && <span className="ml-2 text-muted-foreground">{packageData.critic_feedback}</span>}</p>
                <div className="space-y-2"><label htmlFor="cover-letter" className="text-sm font-medium">Cover letter</label><Textarea id="cover-letter" value={coverLetter} onChange={(event) => setCoverLetter(event.target.value)} rows={10} className="rounded-xl bg-background" /></div>
                <div className="space-y-3"><p className="text-sm font-medium">Screening answers</p>{Object.entries(answers).length === 0 ? <p className="text-sm text-muted-foreground">No screening answers were generated.</p> : Object.entries(answers).map(([question, answer], index) => <div key={question} className="space-y-1.5 rounded-xl border border-border p-3"><label htmlFor={`screening-answer-${index}`} className="text-sm font-medium">{question}</label><Textarea id={`screening-answer-${index}`} value={answer} onChange={(event) => setAnswers((current) => ({ ...current, [question]: event.target.value }))} rows={3} className="rounded-lg bg-background" /></div>)}</div>
              </div>
              <div className="min-w-0"><div className="mb-2 flex items-center gap-2"><FileText className="size-4" /><h3 className="font-medium">Compiled tailored CV</h3></div>{pdfUrl ? <iframe title={`Tailored CV for ${selected.role_title}`} src={pdfUrl} className="h-[720px] w-full rounded-xl border border-border bg-white" /> : <div className="grid h-60 place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">No compiled PDF is attached to this package.</div>}</div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4"><Button variant="outline" onClick={() => void saveEdits()} disabled={saving || applying}>{saving ? "Saving..." : "Save edits"}</Button><Button variant="hero" onClick={() => void approveAndApply()} disabled={applying || saving || packageLoading}><Check /> {applying ? "Starting application..." : "Approve & Auto-Apply"}</Button></div>
          </>}
        </section>}
      </div>}
    </div>
  );
}
