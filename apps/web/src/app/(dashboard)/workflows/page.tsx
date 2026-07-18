import Link from "next/link";
import { prisma } from "@bf/database";
import { formatMicroUsd } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
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

export const metadata = { title: "Workflows" };

export default async function WorkflowsPage() {
  const ctx = await requireOrgContext();
  const workflows = await prisma.workflow.findMany({
    where: { organizationId: ctx.organizationId },
    include: {
      module: { select: { name: true } },
      activeVersion: { include: { _count: { select: { steps: true } } } },
      _count: { select: { runs: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader
        title="Workflows"
        description="Versioned step pipelines with approval gates, retries, and per-run cost limits."
      />
      {workflows.length === 0 ? (
        <EmptyState
          title="No workflows yet"
          hint="Seed the database to create the sample content workflow."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Workflow</TH>
              <TH>Module</TH>
              <TH>Trigger</TH>
              <TH>Steps</TH>
              <TH>Runs</TH>
              <TH>Cost limit / run</TH>
              <TH>Status</TH>
              <TH>Updated</TH>
            </TR>
          </THead>
          <TBody>
            {workflows.map((wf) => (
              <TR key={wf.id}>
                <TD>
                  <Link href={`/workflows/${wf.id}`} className="font-medium hover:underline">
                    {wf.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{wf.key}</p>
                </TD>
                <TD>{wf.module?.name ?? "Platform"}</TD>
                <TD className="text-xs">{wf.triggerType}</TD>
                <TD>{wf.activeVersion?._count.steps ?? 0}</TD>
                <TD>{wf._count.runs}</TD>
                <TD>{formatMicroUsd(wf.costLimitMicroUsd)}</TD>
                <TD>
                  <StatusBadge status={wf.status} />
                </TD>
                <TD className="text-xs text-muted-foreground">{formatDate(wf.updatedAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
