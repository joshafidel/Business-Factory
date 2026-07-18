import { prisma } from "@bf/database";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import { Badge, Button, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const ctx = await requireOrgContext();
  const notifications = await prisma.notification.findMany({
    where: { organizationId: ctx.organizationId, userId: ctx.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  async function markAllRead(): Promise<void> {
    "use server";
    const inner = await requireOrgContext();
    await prisma.notification.updateMany({
      where: { organizationId: inner.organizationId, userId: inner.userId, isRead: false },
      data: { isRead: true },
    });
    revalidatePath("/notifications");
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="In-app and mock-email notifications addressed to you."
      >
        <form action={markAllRead}>
          <Button variant="outline" size="sm">
            Mark all read
          </Button>
        </form>
      </PageHeader>
      {notifications.length === 0 ? (
        <EmptyState title="No notifications" />
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`rounded-lg border border-border bg-card p-3 ${n.isRead ? "opacity-60" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      n.kind.startsWith("COST")
                        ? "warning"
                        : n.kind === "WORKFLOW_FAILED" || n.kind === "JOB_FAILURE"
                          ? "destructive"
                          : "primary"
                    }
                  >
                    {n.kind.replaceAll("_", " ")}
                  </Badge>
                  <Badge variant="outline">{n.channel.replaceAll("_", " ")}</Badge>
                  <span className="text-sm font-medium">{n.title}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatDate(n.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
              {n.href ? (
                <Link
                  href={n.href}
                  className="mt-1 inline-block text-xs text-primary hover:underline"
                >
                  View →
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
