import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-glow", className)}>
      <svg
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
    </span>
  );
}

export function BrandName({ className }: { className?: string }) {
  return (
    <span className={cn("ui-title truncate text-[17px]", className)}>
      Jobhunter<span className="font-display text-[19px] italic text-mint"> Agent</span>
    </span>
  );
}
