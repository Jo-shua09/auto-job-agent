import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ExternalLink, FileText, MessageSquareText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ArtifactDrawer } from "@/components/queue/artifact-drawer";
import { Chip, CompanyAvatar, TrackChip } from "@/components/job-bits";
import { PageHeader } from "@/components/app-shell";
import { useAgent } from "@/lib/agent-store";
import { appliedToday, groupByDay, STATUS_LABEL, type AppliedJob, type AppliedStatus } from "@/lib/jobs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Application history — Jobhunter Agent" },
      { name: "description", content: "Every job your agent applied to, grouped by day." },
      { property: "og:title", content: "Application history — Jobhunter Agent" },
      { property: "og:description", content: "Every application, grouped by day." },
    ],
  }),
  component: HistoryPage,
});

const STATUS_TONE: Record<AppliedStatus, "muted" | "mint" | "warning" | "danger" | "info"> = {
  APPLIED: "muted",
  CONFIRMED: "info",
  INTERVIEW_INVITE: "mint",
  REPLIED_REJECTED: "danger",
  OFFER_STAGE: "warning",
};

const FILTERS: { key: "all" | AppliedStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "INTERVIEW_INVITE", label: "Interviews" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "APPLIED", label: "Tracking" },
  { key: "REPLIED_REJECTED", label: "Rejected" },
  { key: "OFFER_STAGE", label: "Offers" },
];

function HistoryPage() {
  const history = useAgent((s) => s.history);
  const limit = useAgent((s) => s.limit);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<AppliedJob | null>(null);
  const [artifactTab, setArtifactTab] = useState<"cv" | "answers">("cv");

  const filtered = useMemo(
    () => history.filter((j) => (filter === "all" || j.status === filter) && `${j.company} ${j.role}`.toLowerCase().includes(q.toLowerCase())),
    [history, filter, q],
  );
  const groups = useMemo(() => groupByDay(filtered), [filtered]);
  const interviews = history.filter((j) => j.status === "INTERVIEW_INVITE" || j.status === "OFFER_STAGE").length;

  const stats = [
    { label: "Total applied", value: history.length },
    { label: "Applied today", value: `${appliedToday(history)}/${limit}` },
    { label: "Interviews", value: interviews },
    { label: "Avg match score", value: `${Math.round(history.reduce((n, j) => n + j.match, 0) / Math.max(history.length, 1))}%` },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
      <PageHeader
        eyebrow="Your track record"
        title="Application history"
        subtitle="Every role your agent applied to, day by day, with the exact CV it sent."
      />

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-1 font-mono text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company or role" className="h-11 rounded-full bg-card pl-10" />
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-2 text-sm transition-colors",
                filter === f.key
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 space-y-8">
        {groups.length === 0 && <p className="py-10 text-center text-muted-foreground">No applications match.</p>}
        {groups.map((g) => (
          <section key={g.key}>
            <div className="sticky top-[61px] z-10 -mx-4 flex items-baseline justify-between gap-3 bg-background/85 px-4 py-2 backdrop-blur-md md:top-0">
              <h2 className="ui-title min-w-0 text-sm sm:text-base">{g.label}</h2>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {g.jobs.length} {g.jobs.length === 1 ? "application" : "applications"}
              </span>
            </div>
            <ul className="mt-2 overflow-hidden rounded-3xl border border-border bg-card">
              {g.jobs.map((j) => (
                <li key={j.id} className="border-b border-border last:border-b-0">
                  <div className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                        {new Date(j.appliedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <CompanyAvatar name={j.company} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{j.role}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {j.company} · {j.platform}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pl-[4.25rem] sm:pl-0">
                      <TrackChip track={j.track} />
                      <Chip tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Chip>
                      <div className="flex gap-1">
                        <IconBtn
                          label="View CV sent"
                          onClick={() => {
                            setArtifactTab("cv");
                            setOpen(j);
                          }}
                        >
                          <FileText className="size-4" />
                        </IconBtn>
                        <IconBtn
                          label="Cover letter & answers"
                          onClick={() => {
                            setArtifactTab("answers");
                            setOpen(j);
                          }}
                        >
                          <MessageSquareText className="size-4" />
                        </IconBtn>
                        <a
                          href={j.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Open job post"
                          className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <ArtifactDrawer key={`${open?.id ?? "closed"}-${artifactTab}`} artifact={open} initialTab={artifactTab} onClose={() => setOpen(null)} />
    </div>
  );
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}
