import { notFound } from "next/navigation";
import { prisma } from "@bf/database";
import { formatMicroUsd } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

export const metadata = { title: "Agent" };

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  const agent = await prisma.agent.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      activeVersion: { include: { prompt: true } },
      versions: { orderBy: { version: "desc" } },
      runs: { orderBy: { createdAt: "desc" }, take: 20 },
      module: true,
    },
  });
  if (!agent) notFound();
  const v = agent.activeVersion;

  return (
    <>
      <PageHeader title={agent.name} description={agent.description}>
        <StatusBadge status={agent.status} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Active version {v ? `(v${v.version})` : ""}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {v ? (
              <>
                <Row label="Role" value={agent.role} />
                <Row label="Module" value={agent.module?.name ?? "Platform"} />
                <Row label="Provider / model" value={`${v.provider} / ${v.model}`} />
                <Row label="Temperature" value={String(v.temperature)} />
                <Row label="Max tokens" value={String(v.maxTokens)} />
                <Row label="Cost budget / run" value={formatMicroUsd(v.maxCostMicroUsd)} />
                <Row label="Max retries" value={String(v.maxRetries)} />
                <Row label="Timeout" value={`${v.timeoutMs / 1000}s`} />
                <Row label="Max steps" value={String(v.maxSteps)} />
                <Row label="Requires approval" value={v.requiresApproval ? "yes" : "no"} />
                <Row label="Prompt" value={v.prompt?.name ?? "inline instructions only"} />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Allowed tools</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {v.allowedTools.length === 0 ? (
                      <span className="text-xs text-muted-foreground">none</span>
                    ) : (
                      v.allowedTools.map((t) => <Badge key={t}>{t}</Badge>)
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Instructions</p>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
                    {v.instructions}
                  </pre>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">No active version.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Version history</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {agent.versions.map((version) => (
                <li key={version.id} className="flex items-center justify-between py-2">
                  <div>
                    <span className="font-medium">v{version.version}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {version.changelog ?? ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {version.id === agent.activeVersionId ? (
                      <Badge variant="success">active</Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {formatDate(version.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold">Recent runs</h2>
      <Table>
        <THead>
          <TR>
            <TH>Goal</TH>
            <TH>Status</TH>
            <TH>Tokens (in/out)</TH>
            <TH>Cost</TH>
            <TH>Attempts</TH>
            <TH>Started</TH>
          </TR>
        </THead>
        <TBody>
          {agent.runs.map((run) => (
            <TR key={run.id}>
              <TD className="max-w-md truncate">{run.goal}</TD>
              <TD>
                <StatusBadge status={run.status} />
              </TD>
              <TD className="tabular-nums">
                {run.inputTokens}/{run.outputTokens}
              </TD>
              <TD>{formatMicroUsd(run.costMicroUsd)}</TD>
              <TD>{run.attempts}</TD>
              <TD className="text-xs text-muted-foreground">{formatDate(run.createdAt)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
