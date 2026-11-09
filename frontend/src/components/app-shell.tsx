"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertCircle,
  CalendarClock,
  ChevronDown,
  Inbox,
  LogOut,
  Moon,
  Settings2,
  ShieldCheck,
  Radar,
  RefreshCw,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandMark, BrandName } from "@/components/brand";
import { OtpBanner } from "@/components/otp-banner";
import { useTheme } from "@/lib/theme";
import { getAuthToken, logoutUser, onSessionChange } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/agent", label: "Agent", icon: Radar },
  { to: "/queue", label: "Queue", icon: Inbox },
  { to: "/history", label: "History", icon: CalendarClock },
  { to: "/vault", label: "Vault", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: Settings2 },
] as const;

function QuotaRing({ size = 44, used = 0, limit = 10 }: { size?: number; used?: number; limit?: number }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const pct = Math.min(used / limit, 1);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} className="fill-none stroke-border" strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="fill-none stroke-mint transition-all duration-700"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-mono text-[0.6875rem] font-semibold">{used}</span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [quota, setQuota] = useState({ applied_today: 0, daily_apply_limit: 10 });
  const [queueCount, setQueueCount] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  useEffect(() => {
    let active = true;
    const refreshWorkspace = async () => {
      setRefreshing(true);
      try {
        const [currentQuota, queue] = await Promise.all([
          apiRequest<{ applied_today: number; daily_apply_limit: number }>("/api/scout/quota"),
          apiRequest<unknown[]>("/api/jobs?status=AWAITING_APPROVAL"),
        ]);
        if (active) {
          setQuota(currentQuota);
          setQueueCount(queue.length);
          setApiError(null);
        }
      } catch {
        if (active) setApiError("We couldn't refresh your workspace right now. Please try again.");
      } finally {
        if (active) setRefreshing(false);
      }
    };

    const refreshSession = async () => {
      await Promise.resolve();
      if (!getAuthToken()) {
        if (!active) return;
        setUser(null);
        setQueueCount(0);
        setQuota({ applied_today: 0, daily_apply_limit: 10 });
        setApiError(null);
        return;
      }
      try {
        const session = await apiRequest<{
          user: { full_name: string; email: string };
        }>("/api/auth/me");
        if (!active) return;
        setUser({ name: session.user.full_name, email: session.user.email });
        await refreshWorkspace();
      } catch {
        if (!active) return;
        logoutUser();
        setUser(null);
        router.replace("/auth");
      }
    };

    const unsubscribe = onSessionChange(() => void refreshSession());
    void refreshSession();
    const timer = window.setInterval(() => {
      if (getAuthToken()) void refreshWorkspace();
    }, 15000);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [retryCount, router]);
  const display = user?.name || user?.email?.split("@")[0] || "You";

  async function signOut() {
    logoutUser();
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
          <QuotaRing size={collapsed ? 40 : 44} used={quota.applied_today} limit={quota.daily_apply_limit} />
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Applied today</p>
              <p className="font-mono text-sm font-semibold">
                {quota.applied_today} <span className="text-muted-foreground">/ {quota.daily_apply_limit}</span>
              </p>
            </div>
          )}
          {!collapsed && <div className="ml-auto flex flex-col"></div>}
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
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Icon className={cn("size-4.5 shrink-0", active && "text-mint")} />
                {!collapsed && <span className="min-w-0 flex-1">{label}</span>}
                {to === "/queue" && queueCount > 0 && (
                  <span
                    className={cn(
                      "rounded-full bg-accent font-mono text-[0.625rem] text-accent-foreground",
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
            {theme === "dark" ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
            {!collapsed && (theme === "dark" ? "Light mode" : "Dark mode")}
          </button>
          <div
            className={cn("flex items-center rounded-2xl border border-sidebar-border bg-card/60", collapsed ? "flex-col gap-1 p-2" : "gap-3 p-2.5")}
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
          <BrandName className="text-[0.9375rem]" />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <QuotaRing size={36} used={quota.applied_today} limit={quota.daily_apply_limit} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Open profile menu"
                className="flex h-10 items-center gap-1 rounded-full border border-border bg-card p-1 pr-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-7 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground uppercase">
                  {display[0]}
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-56 rounded-xl p-1.5">
              <DropdownMenuLabel className="px-2 py-2 font-normal">
                <span className="block truncate text-sm font-medium capitalize text-foreground">{display}</span>
                {user?.email && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{user.email}</span>}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="min-h-10 cursor-pointer gap-2 rounded-lg">
                <Link href="/settings">
                  <Settings2 className="size-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={toggle} className="min-h-10 cursor-pointer gap-2 rounded-lg">
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={signOut} className="min-h-10 cursor-pointer gap-2 rounded-lg text-destructive focus:text-destructive">
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main
        className={cn(
          "workspace-main min-h-dvh min-w-0 pb-dock transition-[padding] duration-200 ease-out md:pb-0",
          collapsed ? "md:pl-20" : "md:pl-64",
        )}
      >
        <OtpBanner />
        {apiError && (
          <div role="alert" className="mx-4 mt-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 md:mx-8">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Connection problem</p>
              <p className="mt-1 wrap-break-word text-sm text-muted-foreground">{apiError}</p>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={() => setRetryCount((count) => count + 1)}>
              <RefreshCw className={refreshing ? "animate-spin" : ""} /> Retry
            </Button>
          </div>
        )}
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
            <Link
              key={to}
              href={to}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1"
            >
              <span
                className={cn(
                  "grid h-8 w-12 place-items-center rounded-full transition-all duration-300",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="size-4.5" />
              </span>
              <span className={cn("truncate text-[0.625rem] leading-none", active ? "font-medium text-foreground" : "text-muted-foreground")}>
                {label}
              </span>
              {to === "/queue" && queueCount > 0 && !active && (
                <span className="absolute top-0.5 right-[calc(50%-1.25rem)] size-2 rounded-full bg-warning" />
              )}
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
        {eyebrow && <p className="mb-1.5 font-mono text-[0.6875rem] tracking-[0.18em] text-mint uppercase">{eyebrow}</p>}
        <h1 className="font-display text-4xl leading-[1.05] wrap-break-word sm:text-5xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-xl text-[0.9375rem] leading-6 text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
