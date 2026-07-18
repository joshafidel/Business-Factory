import Link from "next/link";
import { prisma } from "@bf/database";
import { requirePermission } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import { Badge, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";

export const metadata = { title: "Audit Logs" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; entity?: string }>;
}) {
  const ctx = await requirePermission("audit:read");
  const { actor, entity } = await searchParams;
  const [logs, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(actor ? { actorType: actor } : {}),
        ...(entity ? { entityType: entity } : {}),
      },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.auditLog.groupBy({
      by: ["entityType"],
      where: { organizationId: ctx.organizationId },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="Every meaningful action — user, agent, workflow, and system."
      />
      <div className="mb-4 flex flex-wrap gap-1">
        {["ALL", "user", "agent", "workflow", "system"].map((a) => (
          <Link
            key={a}
            href={a === "ALL" ? "/audit" : `/audit?actor=${a}${entity ? `&entity=${entity}` : ""}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              (a === "ALL" && !actor) || actor === a
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {a}
          </Link>
        ))}
        <span className="mx-2 text-muted-foreground">·</span>
        {entityTypes.map((e) => (
          <Link
            key={e.entityType}
            href={`/audit?entity=${e.entityType}${actor ? `&actor=${actor}` : ""}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              entity === e.entityType
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {e.entityType}
          </Link>
        ))}
      </div>
      {logs.length === 0 ? (
        <EmptyState title="No audit entries match" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Action</TH>
              <TH>Actor</TH>
              <TH>Entity</TH>
              <TH>Detail</TH>
              <TH>When</TH>
            </TR>
          </THead>
          <TBody>
            {logs.map((log) => (
              <TR key={log.id}>
                <TD className="font-mono text-xs">{log.action}</TD>
                <TD>
                  <Badge variant="outline">{log.actorType}</Badge>
                  {log.user ? <span className="ml-1 text-xs">{log.user.name}</span> : null}
                </TD>
                <TD className="text-xs">
                  {log.entityType}
                  {log.entityId ? (
                    <span className="ml-1 font-mono text-muted-foreground">
                      {log.entityId.slice(-8)}
                    </span>
                  ) : null}
                </TD>
                <TD className="max-w-sm truncate text-xs text-muted-foreground">
                  {log.detail ? JSON.stringify(log.detail) : "—"}
                </TD>
                <TD className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
