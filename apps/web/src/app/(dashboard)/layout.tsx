import Link from "next/link";
import { prisma } from "@bf/database";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  CheckSquare,
  ClipboardList,
  Clock,
  Cog,
  DollarSign,
  FileText,
  FolderOpen,
  Gauge,
  LayoutGrid,
  ListChecks,
  Plug,
  Bot,
  Workflow,
} from "lucide-react";
import { requireOrgContext } from "@/lib/session";
import { signOut } from "@/auth";
import { Badge } from "@/components/ui";

/**
 * Navigation: the everyday surface is deliberately tiny — your apps and the
 * approval inbox. Everything operational lives in a collapsed "Under the
 * hood" section so it never crowds the main experience.
 */
const OPS_NAV = [
  { href: "/ops", label: "System overview", icon: Gauge },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/jobs", label: "Jobs & queues", icon: ListChecks },
  { href: "/schedules", label: "Schedules", icon: Clock },
  { href: "/prompts", label: "Prompts", icon: FileText },
  { href: "/assets", label: "Assets", icon: FolderOpen },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/costs", label: "Costs", icon: DollarSign },
  { href: "/errors", label: "Errors", icon: AlertTriangle },
  { href: "/audit", label: "Audit log", icon: ClipboardList },
  { href: "/modules", label: "Module registry", icon: Boxes },
  { href: "/settings", label: "Settings", icon: Cog },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrgContext();
  const [pendingApprovals, unreadNotifications] = await Promise.all([
    prisma.approvalRequest.count({
      where: { organizationId: ctx.organizationId, status: "PENDING" },
    }),
    prisma.notification.count({
      where: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        isRead: false,
        channel: "IN_APP",
      },
    }),
  ]);

  async function doSignOut(): Promise<void> {
    "use server";
    await signOut({ redirectTo: "/sign-in" });
  }

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 flex w-60 flex-col border-r border-border bg-card">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            BF
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">Business Factory</p>
            <p className="truncate text-xs text-muted-foreground leading-tight">
              {ctx.organizationName}
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium hover:bg-muted"
          >
            <LayoutGrid className="h-4 w-4 shrink-0 text-primary" />
            My Apps
          </Link>
          <Link
            href="/approvals"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium hover:bg-muted"
          >
            <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1">Approvals</span>
            {pendingApprovals > 0 ? <Badge variant="warning">{pendingApprovals}</Badge> : null}
          </Link>

          <details className="mt-4 group">
            <summary className="cursor-pointer select-none rounded-md px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-muted">
              Under the hood
            </summary>
            <div className="mt-1 space-y-0.5">
              {OPS_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              ))}
            </div>
          </details>
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{ctx.userName}</p>
              <p className="truncate text-xs text-muted-foreground">{ctx.role.toLowerCase()}</p>
            </div>
            <Link href="/notifications" className="relative rounded-md p-1.5 hover:bg-muted">
              <Bell className="h-4 w-4 text-muted-foreground" />
              {unreadNotifications > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {unreadNotifications}
                </span>
              ) : null}
            </Link>
          </div>
          <form action={doSignOut} className="mt-2">
            <button className="w-full rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="ml-60 flex-1 p-6">{children}</main>
    </div>
  );
}
