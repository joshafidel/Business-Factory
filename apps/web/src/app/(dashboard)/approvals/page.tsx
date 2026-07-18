import Link from "next/link";
import { prisma } from "@bf/database";
import { formatMicroUsd } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import {
  Badge,
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

export const metadata = { title: "Approval Inbox" };

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireOrgContext();
  const { status } = await searchParams;
  const filter = status ?? "PENDING";
  const approvals = await prisma.approvalRequest.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(filter === "ALL" ? {} : { status: filter as never }),
    },
    include: { workflowRun: { include: { workflow: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const FILTERS = ["PENDING", "APPROVED", "REJECTED", "REVISION_REQUESTED", "ALL"];

  return (
    <>
      <PageHeader
        title="Approval Inbox"
        description="Sensitive and irreversible actions wait here for a human decision."
      />
      <div className="mb-4 flex gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/approvals?status=${f}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {f.replaceAll("_", " ")}
          </Link>
        ))}
      </div>
      {approvals.length === 0 ? (
        <EmptyState
          title={filter === "PENDING" ? "Nothing waiting for review" : "No requests match"}
          hint="Approval requests appear when workflows reach approval or publish steps."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Request</TH>
              <TH>Workflow</TH>
              <TH>Action</TH>
              <TH>Risk</TH>
              <TH>Est. cost</TH>
              <TH>Status</TH>
              <TH>Created</TH>
            </TR>
          </THead>
          <TBody>
            {approvals.map((a) => (
              <TR key={a.id}>
                <TD>
                  <Link href={`/approvals/${a.id}`} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                </TD>
                <TD>{a.workflowRun?.workflow.name ?? "—"}</TD>
                <TD>
                  <Badge variant="outline">{a.actionType.replaceAll("_", " ")}</Badge>
                </TD>
                <TD>
                  <Badge
                    variant={
                      a.riskLevel === "HIGH" || a.riskLevel === "CRITICAL"
                        ? "destructive"
                        : "default"
                    }
                  >
                    {a.riskLevel}
                  </Badge>
                </TD>
                <TD>{formatMicroUsd(a.estimatedCostMicroUsd)}</TD>
                <TD>
                  <StatusBadge status={a.status} />
                </TD>
                <TD className="text-xs text-muted-foreground">{formatDate(a.createdAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
