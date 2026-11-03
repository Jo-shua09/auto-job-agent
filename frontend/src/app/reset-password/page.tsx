import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/brand";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Set a new password — Jobhunter Agent" },
      { name: "description", content: "Choose a new password for your Jobhunter Agent account." },
      { property: "og:title", content: "Set a new password — Jobhunter Agent" },
      { property: "og:description", content: "Choose a new password for your account." },
    ],
  }),
  component: Reset,
});

function Reset() {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="bg-mesh flex min-h-dvh items-center justify-center px-5">
      <form
        className="w-full max-w-sm space-y-5 rounded-3xl border border-border bg-card p-6 shadow-soft"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setBusy(false);
          toast("Password recovery is not connected yet.");
          navigate({ to: "/auth" });
        }}
      >
        <BrandMark />
        <h1 className="font-display text-3xl">Set a new password</h1>
        <div className="space-y-1.5">
          <Label htmlFor="pw">New password</Label>
          <Input id="pw" type="password" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} className="h-11 rounded-xl" />
        </div>
        <Button type="submit" variant="hero" size="lg" className="w-full" disabled={busy}>
          Update password
        </Button>
      </form>
    </div>
  );
}
