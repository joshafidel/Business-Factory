import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@bf/database";
import { can, formatMicroUsd } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, PageHeader, StatusBadge } from "@/components/ui";
import { AssetPreview } from "@/components/asset-preview";
import { DecisionForm } from "./decision-form";

export const metadata = { title: "Approval" };
// Inline execution mode runs workflow steps inside the request lifecycle.
export const maxDuration = 300;

export default async function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  const approval = await prisma.approvalRequest.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      workflowRun: { include: { workflow: true } },
      decisions: { include: { user: true }, orderBy: { createdAt: "asc" } },
      assets: true,
    },
  });
  if (!approval) notFound();
  const canDecide = can(ctx.role, "approvals:decide") && approval.status === "PENDING";

  return (
    <>
      <PageHeader title={approval.title} description={approval.description}>
        <StatusBadge status={approval.status} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Review payload</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(approval.payload, null, 2)}
              </pre>
            </CardContent>
          </Card>

          {approval.assets.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Related assets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {approval.assets.map((asset) => (
                  <AssetPreview key={asset.id} asset={asset} />
                ))}
              </CardContent>
            </Card>
          ) : null}

          {approval.decisions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Decision history</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {approval.decisions.map((d) => (
                    <li key={d.id} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{d.user.name}</span>
                        <StatusBadge status={d.decision} />
                      </div>
                      {d.comment ? (
                        <p className="mt-1 text-muted-foreground">“{d.comment}”</p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(d.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Workflow</span>
                {approval.workflowRun ? (
                  <Link href={`/runs/${approval.workflowRun.id}`} className="hover:underline">
                    {approval.workflowRun.workflow.name}
                  </Link>
                ) : (
                  <span>—</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Action type</span>
                <span>{approval.actionType.replaceAll("_", " ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Risk level</span>
                <span>{approval.riskLevel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Estimated cost</span>
                <span>{formatMicroUsd(approval.estimatedCostMicroUsd)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Requires role</span>
                <span>{approval.requiredRole}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Requested</span>
                <span>{formatDate(approval.createdAt)}</span>
              </div>
            </CardContent>
          </Card>

          {canDecide ? (
            <Card>
              <CardHeader>
                <CardTitle>Your decision</CardTitle>
              </CardHeader>
              <CardContent>
                <DecisionForm approvalRequestId={approval.id} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
