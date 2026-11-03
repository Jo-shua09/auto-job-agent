export type Track = "FRONTEND_WEB" | "AI_FRONTEND" | "MOBILE_FLUTTER";

export const TRACK_LABEL: Record<Track, string> = {
  FRONTEND_WEB: "Frontend Web",
  AI_FRONTEND: "AI Frontend",
  MOBILE_FLUTTER: "Mobile",
};

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}
