import Link from "next/link";
import { prisma } from "@bf/database";
import { formatMicroUsd } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import { formatDate, formatDuration } from "@/lib/utils";
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

export const metadata = { title: "Workflow Runs" };

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireOrgContext();
  const { status } = await searchParams;
  const runs = await prisma.workflowRun.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(status ? { status: status as never } : {}),
    },
    include: { workflow: { select: { name: true, key: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const FILTERS = ["ALL", "RUNNING", "AWAITING_APPROVAL", "COMPLETED", "FAILED", "CANCELLED"];

  return (
    <>
      <PageHeader
        title="Workflow Runs"
        description="Full execution history with per-step detail."
      />
      <div className="mb-4 flex gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "ALL" ? "/runs" : `/runs?status=${f}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              (f === "ALL" && !status) || status === f
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {f.replaceAll("_", " ")}
          </Link>
        ))}
      </div>
      {runs.length === 0 ? (
        <EmptyState title="No runs found" hint="Start a workflow from its detail page." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Run</TH>
              <TH>Workflow</TH>
              <TH>Current step</TH>
              <TH>Cost</TH>
              <TH>Duration</TH>
              <TH>Status</TH>
              <TH>Started</TH>
            </TR>
          </THead>
          <TBody>
            {runs.map((run) => (
              <TR key={run.id}>
                <TD>
                  <Link href={`/runs/${run.id}`} className="font-mono text-xs hover:underline">
                    {run.id.slice(-12)}
                  </Link>
                </TD>
                <TD>{run.workflow.name}</TD>
                <TD className="text-xs">{run.currentStepKey ?? "—"}</TD>
                <TD>{formatMicroUsd(run.costMicroUsd)}</TD>
                <TD className="text-xs">
                  {run.startedAt && run.finishedAt
                    ? formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())
                    : "—"}
                </TD>
                <TD>
                  <StatusBadge status={run.status} />
                </TD>
                <TD className="text-xs text-muted-foreground">{formatDate(run.createdAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
