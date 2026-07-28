"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CheckSquare, LayoutGrid, Menu, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

/**
 * Responsive chrome around every dashboard page.
 *
 * - Desktop (lg+): the classic fixed left sidebar.
 * - Mobile: sidebar becomes a slide-in drawer behind a hamburger, plus a
 *   sticky top bar and a thumb-friendly bottom tab bar. Safe-area insets are
 *   respected so nothing hides behind the iPhone notch / home indicator.
 *
 * The sidebar content itself is server-rendered and passed in as a node so
 * this shell stays a thin client wrapper (no data fetching here).
 */
export function DashboardShell({
  sidebar,
  approvalCount,
  notificationCount,
  children,
}: {
  sidebar: React.ReactNode;
  approvalCount: number;
  notificationCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Close the drawer whenever navigation happens.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Also close eagerly when any link inside the drawer is tapped, so the UI
  // feels instant even while the next page loads.
  const onDrawerClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) setOpen(false);
  };

  const TABS = [
    { href: "/", label: "My Apps", icon: LayoutGrid, count: 0 },
    { href: "/approvals", label: "Approvals", icon: CheckSquare, count: approvalCount },
    { href: "/notifications", label: "Alerts", icon: Bell, count: notificationCount },
  ];

  return (
    <div className="min-h-screen">
      {/* Mobile top bar */}
      <header
        className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur lg:hidden"
        style={{ paddingLeft: "max(1rem, env(safe-area-inset-left))" }}
      >
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="-ml-1 rounded-md p-2 hover:bg-muted active:bg-muted"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" className="flex items-center gap-2">
          <Logo size={26} />
          <span className="text-sm font-semibold">Business Factory</span>
        </Link>
      </header>

      {/* Drawer backdrop */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Sidebar: drawer on mobile, fixed rail on desktop */}
      <aside
        onClick={onDrawerClick}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card transition-transform duration-200 ease-out lg:w-60 lg:translate-x-0 lg:transition-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="absolute right-2 top-3 z-10 rounded-md p-2 hover:bg-muted lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
        {sidebar}
      </aside>

      {/* Page content */}
      <main
        className="p-4 pb-24 sm:p-6 lg:ml-60 lg:pb-6"
        style={{ paddingRight: "max(1rem, env(safe-area-inset-right))" }}
      >
        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-border bg-card/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : (pathname?.startsWith(tab.href) ?? false);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span className="relative">
                <tab.icon className="h-5 w-5" />
                {tab.count > 0 ? (
                  <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {tab.count > 99 ? "99+" : tab.count}
                  </span>
                ) : null}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
