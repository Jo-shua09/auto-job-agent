"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/app-shell";
import { getGmailIntegration, pollGmailInbox, saveGmailIntegration, type GmailIntegrationStatus } from "@/lib/api";
import { useTheme } from "@/lib/theme";

export default function SettingsPage() {
  const { theme, toggle } = useTheme();
  const [gmail, setGmail] = useState<GmailIntegrationStatus | null>(null);
  const [gmailAddress, setGmailAddress] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [savingGmail, setSavingGmail] = useState(false);
  const [testingGmail, setTestingGmail] = useState(false);
  const [loadingGmail, setLoadingGmail] = useState(true);
  const [showGmailHelp, setShowGmailHelp] = useState(false);
  const hasAppPassword = !!gmail?.has_app_password;
  const shouldShowGmailHelp = !loadingGmail && (!hasAppPassword || showGmailHelp);

  useEffect(() => {
    getGmailIntegration()
      .then((status) => {
        setGmail(status);
        setGmailAddress(status.gmail_address || "");
        setShowGmailHelp(!status.configured);
      })
      .catch((error: unknown) => {
        setShowGmailHelp(true);
        toast.error(error instanceof Error ? error.message : "Could not load Gmail settings.");
      })
      .finally(() => setLoadingGmail(false));
  }, []);

  async function onSaveGmail() {
    setSavingGmail(true);
    try {
      const payload: { gmail_address?: string; gmail_app_password?: string } = { gmail_address: gmailAddress.trim() };
      if (appPassword.trim()) payload.gmail_app_password = appPassword.trim();
      const saved = await saveGmailIntegration(payload);
      setGmail(saved);
      setGmailAddress(saved.gmail_address || "");
      setAppPassword("");
      if (saved.configured) setShowGmailHelp(false);
      toast.success(appPassword.trim() ? "Gmail settings saved." : "Gmail address saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save Gmail settings.");
    } finally {
      setSavingGmail(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
      <PageHeader eyebrow="Workspace preferences" title="Settings" subtitle="Your job-search configuration and connected accounts are saved to your account." />
      <section className="mt-8 space-y-6 rounded-3xl border border-border bg-card p-5 sm:p-6">
        <div>
          <h2 className="ui-title">Scout preferences</h2>
          <p className="mt-1 text-sm text-muted-foreground">Manage target roles, locations, work modes, blockers, match score and daily limit.</p>
          <Button asChild variant="outline" className="mt-3"><Link href="/agent">Open Command Center</Link></Button>
        </div>

        <div className="space-y-4 border-t border-border pt-5">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="ui-title">Gmail connection</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Used for inbox tracking and sending email applications. Connect with a Gmail <span className="font-medium text-foreground">App Password</span>, not your regular Gmail password.
                </p>
              </div>
              {hasAppPassword && !shouldShowGmailHelp ? (
                <Button variant="ghost" size="sm" onClick={() => setShowGmailHelp(true)} className="shrink-0">
                  Setup help
                </Button>
              ) : null}
            </div>

            {shouldShowGmailHelp ? (
              <div className="mt-3 rounded-2xl border border-border/80 bg-background/60 p-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-foreground">How to get your Gmail App Password</p>
                  {hasAppPassword ? (
                    <Button variant="ghost" size="sm" onClick={() => setShowGmailHelp(false)} className="-mr-2 -mt-1 h-8 px-2">
                      Hide
                    </Button>
                  ) : null}
                </div>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>Make sure <span className="font-medium text-foreground">2-Step Verification</span> is turned on for your Google account.</li>
                  <li>Open Google App Passwords and sign in.</li>
                  <li>Create an app password for <span className="font-medium text-foreground">Mail</span> (or a custom name like “Verdant”).</li>
                  <li>Copy the 16-character password and paste it below.</li>
                </ol>
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
                >
                  Open Google App Passwords
                  <ExternalLink className="size-3.5" />
                </a>
                <p className="mt-2 text-xs text-muted-foreground">
                  Google only shows App Passwords when 2-Step Verification is enabled. If you don&apos;t see the option, enable 2-Step Verification in your Google Account security settings first.
                </p>
              </div>
            ) : hasAppPassword ? (
              <p className="mt-3 text-xs text-muted-foreground">Gmail App Password is saved. You only need to change it if you revoke it in Google or want to use a different account.</p>
            ) : null}
          </div>
          {loadingGmail ? (
            <p className="text-sm text-muted-foreground">Loading Gmail settings...</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="gmail-address">Gmail address (optional)</Label>
                <Input id="gmail-address" type="email" value={gmailAddress} onChange={(e) => setGmailAddress(e.target.value)} placeholder="Leave blank to use your Profile Vault email" className="h-11 rounded-xl bg-background" />
                <p className="text-xs text-muted-foreground">
                  Effective sender/inbox: <span className="font-medium text-foreground">{gmail?.effective_gmail_address || "Not set yet"}</span>
                  {gmail?.uses_profile_email ? " (from your Profile Vault)" : ""}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gmail-app-password">Gmail App Password</Label>
                <Input
                  id="gmail-app-password"
                  type="password"
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                  placeholder={gmail?.has_app_password ? "Saved. Enter a new one to replace it" : "Paste your 16-character App Password"}
                  className="h-11 rounded-xl bg-background"
                  autoComplete="new-password"
                />
                <p className="text-xs text-muted-foreground">
                  Do not use your normal Gmail password. Leave blank to keep the currently saved App Password. Status: {gmail?.has_app_password ? "saved" : "not set"}.
                </p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">Connection: <span className={gmail?.configured ? "font-medium text-foreground" : ""}>{gmail?.configured ? "ready" : "not configured"}</span></p>
                <Button onClick={() => void onSaveGmail()} disabled={savingGmail}>{savingGmail ? "Saving..." : "Save Gmail settings"}</Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-4">
          <div><h2 className="font-medium">Appearance</h2><p className="text-sm text-muted-foreground">Choose light or dark mode.</p></div>
          <Button variant="outline" onClick={toggle}>{theme === "dark" ? <Moon /> : <Sun />}{theme === "dark" ? "Dark" : "Light"}</Button>
        </div>
      </section>
    </div>
  );
}
