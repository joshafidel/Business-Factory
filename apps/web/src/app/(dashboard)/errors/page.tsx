import Link from "next/link";
import { prisma } from "@bf/database";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import { Badge, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";

export const metadata = { title: "Error Logs" };

export default async function ErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const ctx = await requireOrgContext();
  const { source } = await searchParams;
  const [errors, sources] = await Promise.all([
    prisma.errorEvent.findMany({
      where: { organizationId: ctx.organizationId, ...(source ? { source } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.errorEvent.groupBy({
      by: ["source"],
      where: { organizationId: ctx.organizationId },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Error Logs"
        description="Grouped by fingerprint; retries and escalations recorded."
      />
      <div className="mb-4 flex gap-1">
        <Link
          href="/errors"
          className={`rounded-full px-3 py-1 text-xs font-medium ${!source ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
        >
          ALL
        </Link>
        {sources.map((s) => (
          <Link
            key={s.source}
            href={`/errors?source=${s.source}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${source === s.source ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {s.source}
          </Link>
        ))}
      </div>
      {errors.length === 0 ? (
        <EmptyState
          title="No errors"
          hint="Failures from agents, workflows, and jobs will appear here."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Message</TH>
              <TH>Source</TH>
              <TH>Run</TH>
              <TH>When</TH>
            </TR>
          </THead>
          <TBody>
            {errors.map((e) => (
              <TR key={e.id}>
                <TD>
                  <Badge variant="destructive">{e.code}</Badge>
                </TD>
                <TD className="max-w-md truncate text-xs">{e.message}</TD>
                <TD className="text-xs">{e.source}</TD>
                <TD>
                  {e.workflowRunId ? (
                    <Link
                      href={`/runs/${e.workflowRunId}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {e.workflowRunId.slice(-8)}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TD>
                <TD className="text-xs text-muted-foreground">{formatDate(e.createdAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
