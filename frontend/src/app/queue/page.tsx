import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Download, FileText, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Chip, CompanyAvatar, MatchBadge, TrackChip } from "@/components/job-bits";
import { CvPreview } from "@/components/cv-preview";
import { PageHeader } from "@/components/app-shell";
import { agent, useAgent } from "@/lib/agent-store";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { ArtifactDrawer, type Artifact } from "@/components/queue/artifact-drawer";

export const Route = createFileRoute("/_authenticated/queue")({
  validateSearch: (s: Record<string, unknown>): { id?: string | undefined } => ({ id: typeof s["id"] === "string" ? s["id"] : undefined }),
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Review queue — Jobhunter Agent" },
      { name: "description", content: "Approve tailored applications before your agent sends them." },
      { property: "og:title", content: "Review queue — Jobhunter Agent" },
      { property: "og:description", content: "Approve tailored applications before they're sent." },
    ],
  }),
  component: QueuePage,
});

function QueuePage() {
  const { id } = Route.useSearch();
  const navigate = useNavigate({ from: "/queue" });
  const queue = useAgent((s) => s.queue);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const selected = queue.find((q) => q.id === id) ?? (typeof window !== "undefined" && window.innerWidth >= 1024 ? queue[0] : undefined);

  async function approve(jid: string) {
    if (!agent.canApply()) {
      toast.error("Daily limit reached. Raise it in Settings or try tomorrow.");
      return;
    }
    const job = queue.find((q) => q.id === jid);
    navigate({ search: { id: undefined } });
    toast.success(`Applying to ${job?.company}`, { description: "Follow along on the Agent page." });
    agent.approve(jid);
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
      <div className={cn(selected && "hidden lg:block")}>
        <PageHeader
          eyebrow={`${queue.length} awaiting approval`}
          title="Review queue"
          subtitle="Everything here is tailored and ready. Approve to send, or skip to pass."
          action={
            queue.length > 1 ? (
              <Button variant="soft" onClick={() => queue.forEach((q) => approve(q.id))}>
                <Check /> Approve all ({queue.length})
              </Button>
            ) : null
          }
        />
      </div>

      {queue.length === 0 ? (
        <div className="mt-10 rounded-3xl border border-dashed border-border p-10 text-center">
          <p className="ui-title">All caught up</p>
          <p className="mt-1 text-sm text-muted-foreground">Launch a scout from the Agent page to find more roles.</p>
          <Button asChild variant="hero" className="mt-5">
            <Link to="/agent">Go to Agent</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <ul className={cn("min-w-0 space-y-2.5", selected && "hidden lg:block")}>
            {queue.map((j) => (
              <li key={j.id}>
                <button
                  onClick={() => navigate({ search: { id: j.id } })}
                  className={cn(
                    "flex w-full min-w-0 flex-col gap-3 rounded-2xl border p-4 text-left transition-all",
                    selected?.id === j.id ? "border-mint/60 bg-card shadow-glow" : "border-border bg-card hover:bg-accent/30",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <CompanyAvatar name={j.company} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{j.role}</p>
                      <p className="truncate text-sm text-muted-foreground">{j.company}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <MatchBadge value={j.match} />
                    <Chip>{j.platform}</Chip>
                    <TrackChip track={j.track} />
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {selected && (
            <div className="min-w-0">
              <button
                onClick={() => navigate({ search: { id: undefined } })}
                className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground lg:hidden"
              >
                <ArrowLeft className="size-4" /> All roles
              </button>
              <div className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
                <div className="flex min-w-0 items-start gap-4">
                  <CompanyAvatar name={selected.company} className="size-14 text-base" />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-3xl leading-tight">{selected.role}</h2>
                    <p className="mt-1 text-muted-foreground">
                      {selected.company} · {selected.location} · <span className="font-mono text-sm">{selected.salary}</span>
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <MatchBadge value={selected.match} />
                      <Chip>{selected.platform}</Chip>
                      <TrackChip track={selected.track} />
                      <Chip tone="info">
                        <ShieldCheck className="size-3" /> {selected.critic}/100 verified
                      </Chip>
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
                  <div className="min-w-0 space-y-6">
                    <section>
                      <h3 className="ui-title mb-2 text-sm">Why it matches you</h3>
                      <ul className="space-y-2">
                        {selected.why.map((w) => (
                          <li key={w} className="flex gap-2.5 text-[15px]">
                            <Check className="mt-1 size-4 shrink-0 text-mint" /> {w}
                          </li>
                        ))}
                      </ul>
                    </section>
                    <section>
                      <h3 className="ui-title mb-2 text-sm">Cover letter</h3>
                      <Textarea
                        value={selected.coverLetter}
                        onChange={(e) => agent.updateCover(selected.id, e.target.value)}
                        rows={9}
                        className="rounded-2xl bg-background text-[14px] leading-relaxed"
                      />
                    </section>
                    <section>
                      <h3 className="ui-title mb-2 text-sm">Screening answers</h3>
                      <div className="space-y-3">
                        {selected.answers.map((a, i) => (
                          <div key={a.q} className="rounded-2xl border border-border bg-background p-3">
                            <p className="mb-1.5 text-sm font-medium">{a.q}</p>
                            <Textarea
                              value={a.a}
                              onChange={(e) => agent.updateAnswer(selected.id, i, e.target.value)}
                              rows={3}
                              className="rounded-xl border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                            />
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                  <section className="min-w-0">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="ui-title flex items-center gap-1.5 text-sm">
                        <FileText className="size-4" /> Tailored CV
                      </h3>
                      <Button size="sm" variant="ghost" onClick={() => setArtifact(selected)}>
                        <Download /> Open full CV
                      </Button>
                    </div>
                    <CvPreview role={selected.role} company={selected.company} />
                  </section>
                </div>
              </div>

              <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 mt-4 flex gap-3 rounded-full border border-border bg-card/90 p-2 shadow-soft backdrop-blur-xl md:bottom-4">
                <Button
                  variant="ghost"
                  className="flex-1 rounded-full"
                  onClick={() => {
                    agent.skip(selected.id);
                    navigate({ search: { id: undefined } });
                  }}
                >
                  <X /> Skip
                </Button>
                <Button variant="hero" className="flex-[2] rounded-full" onClick={() => approve(selected.id)}>
                  <Check /> Approve & apply
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <ArtifactDrawer artifact={artifact} onClose={() => setArtifact(null)} />
    </div>
  );
}
