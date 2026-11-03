import { initials, TRACK_LABEL, type Track } from "@/lib/jobs";
import { cn } from "@/lib/utils";

export function CompanyAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-2xl border border-border bg-surface font-mono text-sm font-semibold text-foreground",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function Chip({
  children,
  tone = "muted",
  className,
}: {
  children: React.ReactNode;
  tone?: "muted" | "mint" | "warning" | "danger" | "info";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tone === "muted" && "border border-border bg-muted text-muted-foreground",
        tone === "mint" && "bg-accent text-accent-foreground",
        tone === "warning" && "bg-warning/15 text-warning",
        tone === "danger" && "bg-destructive/12 text-destructive",
        tone === "info" && "bg-info/15 text-info",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function MatchBadge({ value }: { value: number }) {
  return (
    <span className="shrink-0 rounded-full bg-primary px-2.5 py-0.5 font-mono text-[11px] font-semibold text-primary-foreground">{value}% match</span>
  );
}

export function TrackChip({ track }: { track: Track }) {
  return <Chip tone="mint">{TRACK_LABEL[track]}</Chip>;
}
