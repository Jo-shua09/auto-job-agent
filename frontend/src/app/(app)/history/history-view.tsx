"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText, Image } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app-shell";
import { API_URL, apiRequest } from "@/lib/api";

type Application = {
  id: string;
  company_name: string;
  role_title: string;
  status: string;
  applied_time_label?: string;
  applied_at?: string;
  cv_preview_url?: string | null;
  screenshot_url?: string | null;
  last_email_category?: string | null;
  external_url?: string;
};
type Day = { day_label: string; count: number; applications: Application[] };
type HistoryData = { total_applications_tracked: number; days: Day[] };

function absoluteUrl(path?: string | null) {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${API_URL}${path}`;
}

export default function HistoryView() {
  const [history, setHistory] = useState<HistoryData>({ total_applications_tracked: 0, days: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<HistoryData>("/api/jobs/history-by-day")
      .then(setHistory)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not load application history."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
      <PageHeader eyebrow="Your track record" title="Application history" subtitle="Applications grouped by the day they were submitted." />
      {loading ? <p className="py-12 text-center text-sm text-muted-foreground">Loading your application history...</p> : history.days.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-border p-10 text-center">
          <p className="ui-title">No applications yet</p>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">You haven&apos;t applied to any jobs yet. Approved applications will appear here grouped by the exact day and time applied.</p>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {history.days.map((day) => (
            <section key={day.day_label}>
              <div className="mb-3 flex items-baseline justify-between"><h2 className="ui-title">{day.day_label}</h2><span className="font-mono text-xs text-muted-foreground">{day.count} {day.count === 1 ? "application" : "applications"}</span></div>
              <ul className="overflow-hidden rounded-3xl border border-border bg-card">
                {day.applications.map((application) => {
                  const cv = absoluteUrl(application.cv_preview_url);
                  const screenshot = absoluteUrl(application.screenshot_url);
                  return <li key={application.id} className="flex flex-col gap-3 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-center">
                    <time className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{application.applied_time_label || (application.applied_at ? new Date(application.applied_at).toLocaleTimeString() : "")}</time>
                    <div className="min-w-0 flex-1"><p className="truncate font-medium">{application.role_title}</p><p className="truncate text-sm text-muted-foreground">{application.company_name} · {application.status}</p><p className="mt-1 text-xs text-muted-foreground">Inbox: {application.last_email_category || "No update received"}</p></div>
                    <div className="flex flex-wrap gap-2">
                      {cv ? <Button asChild size="sm" variant="outline"><a href={cv} target="_blank" rel="noreferrer"><FileText /> CV used</a></Button> : <Button size="sm" variant="outline" disabled><FileText /> CV unavailable</Button>}
                      {screenshot ? <Button asChild size="sm" variant="outline"><a href={screenshot} target="_blank" rel="noreferrer"><Image /> Confirmation screenshot</a></Button> : <Button size="sm" variant="outline" disabled><Image /> Screenshot unavailable</Button>}
                      {application.external_url && <Button asChild size="icon" variant="ghost" aria-label="Open job post"><a href={application.external_url} target="_blank" rel="noreferrer"><ExternalLink /></a></Button>}
                    </div>
                  </li>;
                })}
              </ul>
            </section>
          ))}
          <p className="text-right text-xs text-muted-foreground">{history.total_applications_tracked} applications tracked</p>
        </div>
      )}
    </div>
  );
}
