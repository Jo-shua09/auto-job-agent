"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CalendarClock, Inbox, LogOut, Moon, Settings2, ShieldCheck, Sparkles, Sun, PanelLeftClose, PanelLeftOpen, Minus, Plus } from "lucide-react";
import { getDemoUser, demoSignOut, type DemoUser } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { BrandMark, BrandName } from "@/components/brand";
import { OtpBanner } from "@/components/otp-banner";
import { useTheme } from "@/lib/theme";
import { useAgent, agent, loadAgent } from "@/lib/agent-store";
import { appliedToday } from "@/lib/jobs";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/agent", label: "Agent", icon: Sparkles },
  { to: "/queue", label: "Queue", icon: Inbox },
  { to: "/history", label: "History", icon: CalendarClock },
  { to: "/vault", label: "Vault", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: Settings2 },
] as const;

function QuotaRing({ size = 44 }: { size?: number }) {
  const history = useAgent((s) => s.history);
  const limit = useAgent((s) => s.limit);
  const used = appliedToday(history);
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const pct = Math.min(used / limit, 1);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} className="fill-none stroke-border" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} className="fill-none stroke-mint transition-all duration-700" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-mono text-[11px] font-semibold">{used}</span>
    </div>
  );
}

function useUser() {
  const [user, setUser] = useState<DemoUser | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(getDemoUser());
  }, []);
  return user;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const user = useUser();
  const limit = useAgent((s) => s.limit);
  const history = useAgent((s) => s.history);
  const queueCount = useAgent((s) => s.queue.length);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { loadAgent(); }, []);
  const display = user?.name || user?.email?.split("@")[0] || "You";

  function signOut() {
    demoSignOut();
    router.replace("/auth");
  }

  return (
    <div className="min-h-dvh w-full min-w-0 overflow-x-clip bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "desktop-sidebar fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out md:flex",
          collapsed && "w-20",
        )}
      >
        <div className={cn("flex items-center pt-5 pb-4", collapsed ? "flex-col gap-2 px-3" : "justify-between gap-2.5 px-4")}>
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark />
            {!collapsed && <BrandName />}
          </div>
          <button
            type="button"
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>

        <div
          className={cn(
            "mb-4 flex items-center rounded-2xl border border-sidebar-border bg-card/60",
            collapsed ? "mx-3 justify-center p-2" : "mx-4 gap-3 p-3",
          )}
        >
          <QuotaRing size={collapsed ? 40 : 44} />
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Applied today</p>
              <p className="font-mono text-sm font-semibold">
                {appliedToday(history)} <span className="text-muted-foreground">/ {limit}</span>
              </p>
            </div>
          )}
          {!collapsed && (
            <div className="ml-auto flex flex-col">
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                title="Increase daily limit"
                aria-label="Increase daily limit"
                onClick={() => agent.setLimit(limit + 1)}
              >
                <Plus />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                title="Decrease daily limit"
                aria-label="Decrease daily limit"
                onClick={() => agent.setLimit(limit - 1)}
              >
                <Minus />
              </Button>
            </div>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname.startsWith(to);
            return (
              <Link
                key={to}
                href={to}
                title={label}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center rounded-xl py-2.5 text-sm transition-colors",
                  collapsed ? "justify-center px-0" : "gap-3 px-3",
                  active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Icon className={cn("size-[18px] shrink-0", active && "text-mint")} />
                {!collapsed && <span className="min-w-0 flex-1">{label}</span>}
                {to === "/queue" && queueCount > 0 && (
                  <span
                    className={cn(
                      "rounded-full bg-accent font-mono text-[10px] text-accent-foreground",
                      collapsed ? "absolute top-1 right-1 grid size-4 place-items-center" : "px-2 py-0.5",
                    )}
                  >
                    {queueCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-2 p-3">
          <button
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            className={cn(
              "flex w-full items-center rounded-xl py-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground",
              collapsed ? "justify-center px-0" : "gap-3 px-3",
            )}
          >
            {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
            {!collapsed && (theme === "dark" ? "Light mode" : "Dark mode")}
          </button>
          <div
            className={cn(
              "flex items-center rounded-2xl border border-sidebar-border bg-card/60",
              collapsed ? "flex-col gap-1 p-2" : "gap-3 p-2.5",
            )}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary font-medium text-secondary-foreground uppercase">
              {display[0]}
            </span>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium capitalize">{display}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              </div>
            )}
            <button
              onClick={signOut}
              aria-label="Sign out"
              title="Sign out"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-xl md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <BrandMark className="size-8" />
          <BrandName className="text-[15px]" />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <QuotaRing size={36} />
          <button onClick={toggle} aria-label="Toggle theme" className="grid size-9 place-items-center rounded-full border border-border bg-card">
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </header>

      <main
        className={cn(
          "workspace-main min-h-dvh min-w-0 pb-dock transition-[padding] duration-200 ease-out md:pb-0",
          collapsed ? "md:pl-20" : "md:pl-64",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-2 text-[11px] text-muted-foreground md:px-8">
          <span className="flex min-w-0 items-center gap-2"><span className="size-1.5 shrink-0 rounded-full bg-mint" />Your workspace</span>
          <Button size="sm" variant="ghost" onClick={signOut} className="md:hidden" aria-label="Sign out"><LogOut /></Button>
        </div>
        <OtpBanner />
        {children}
      </main>

      {/* Mobile floating dock */}
      <nav
        className="fixed inset-x-3 z-50 flex h-16 items-center justify-around rounded-full border border-border bg-card/90 px-2 shadow-soft backdrop-blur-xl md:hidden"
        style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = pathname.startsWith(to);
          return (
            <Link key={to} href={to} aria-label={label} aria-current={active ? "page" : undefined} className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1">
              <span className={cn("grid h-8 w-12 place-items-center rounded-full transition-all duration-300", active ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                <Icon className="size-[18px]" />
              </span>
              <span className={cn("truncate text-[10px] leading-none", active ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
              {to === "/queue" && queueCount > 0 && !active && <span className="absolute top-0.5 right-[calc(50%-1.25rem)] size-2 rounded-full bg-warning" />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: ReactNode; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1.5 font-mono text-[11px] tracking-[0.18em] text-mint uppercase">{eyebrow}</p>}
        <h1 className="font-display text-4xl leading-[1.05] break-words sm:text-5xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-xl text-[15px] leading-6 text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
