"use client";

import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app-shell";
import { useTheme } from "@/lib/theme";

export default function SettingsPage() {
  const { theme, toggle } = useTheme();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
      <PageHeader eyebrow="Workspace preferences" title="Settings" subtitle="Your job-search configuration is managed from the Command Center and saved to your account." />
      <section className="mt-8 space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
        <div><h2 className="ui-title">Scout preferences</h2><p className="mt-1 text-sm text-muted-foreground">Manage target roles, locations, work modes, blockers, match score and daily limit.</p><Button asChild variant="outline" className="mt-3"><Link href="/agent">Open Command Center</Link></Button></div>
        <div className="flex items-center justify-between border-t border-border pt-4"><div><h2 className="font-medium">Appearance</h2><p className="text-sm text-muted-foreground">Choose light or dark mode.</p></div><Button variant="outline" onClick={toggle}>{theme === "dark" ? <Moon /> : <Sun />}{theme === "dark" ? "Dark" : "Light"}</Button></div>
      </section>
    </div>
  );
}
