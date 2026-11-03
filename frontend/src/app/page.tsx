import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/auth" });
  },
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Jobhunter Agent — find, tailor and apply on autopilot" },
      { name: "description", content: "Sign in to your autonomous job-hunting agent." },
      { property: "og:title", content: "Jobhunter Agent" },
      { property: "og:description", content: "Sign in to your autonomous job-hunting agent." },
    ],
  }),
});
