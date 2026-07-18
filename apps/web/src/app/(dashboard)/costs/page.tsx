import { costByModule, costByProvider, spendTotals } from "@bf/analytics";
import { prisma } from "@bf/database";
import { can, formatMicroUsd } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Stat,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { toggleCostLimitAction } from "./actions";
import { CostLimitForm } from "./limit-form";

export const metadata = { title: "Costs" };

export default async function CostsPage() {
  const ctx = await requireOrgContext();
  const orgId = ctx.organizationId;
  const [totals, byModule, byProvider, limits, records] = await Promise.all([
    spendTotals(orgId),
    costByModule(orgId),
    costByProvider(orgId),
    prisma.costLimit.findMany({ where: { organizationId: orgId }, orderBy: { scope: "asc" } }),
    prisma.costRecord.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);
  const canManage = can(ctx.role, "costs:manage");

  return (
    <>
      <PageHeader
        title="Costs"
        description="Estimated spend from provider usage, with configurable warning thresholds and hard stops."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Today" value={formatMicroUsd(totals.todayMicroUsd)} />
        <Stat label="This month" value={formatMicroUsd(totals.monthMicroUsd)} />
        <Stat
          label="Top module (30d)"
          value={byModule[0] ? byModule[0].moduleKey : "—"}
          sub={byModule[0] ? formatMicroUsd(byModule[0].costMicroUsd) : undefined}
        />
        <Stat
          label="Top provider (30d)"
          value={byProvider[0] ? byProvider[0].providerKey : "—"}
          sub={byProvider[0] ? formatMicroUsd(byProvider[0].costMicroUsd) : undefined}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Cost limits</CardTitle>
            </CardHeader>
            <CardContent>
              {limits.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No limits configured — execution is unbounded. Add limits to enforce hard stops.
                </p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {limits.map((limit) => (
                    <li key={limit.id} className="flex items-center justify-between py-2">
                      <div>
                        <span className="font-medium">
                          {limit.scope}
                          {limit.scopeKey ? `:${limit.scopeKey}` : ""}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          warn at {Math.round(limit.warnAtFraction * 100)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{formatMicroUsd(limit.limitMicroUsd)}</span>
                        <Badge variant={limit.isHardStop ? "destructive" : "warning"}>
                          {limit.isHardStop ? "hard stop" : "warn only"}
                        </Badge>
                        <Badge variant={limit.isEnabled ? "success" : "default"}>
                          {limit.isEnabled ? "enabled" : "disabled"}
                        </Badge>
                        {canManage ? (
                          <form
                            action={async () => {
                              "use server";
                              await toggleCostLimitAction(limit.id);
                            }}
                          >
                            <Button variant="ghost" size="sm">
                              {limit.isEnabled ? "Disable" : "Enable"}
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <h2 className="mb-3 mt-6 text-sm font-semibold">Recent cost records</h2>
          <Table>
            <THead>
              <TR>
                <TH>Category</TH>
                <TH>Description</TH>
                <TH>Module</TH>
                <TH>Provider</TH>
                <TH>Cost</TH>
                <TH>When</TH>
              </TR>
            </THead>
            <TBody>
              {records.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Badge variant="outline">{r.category.replaceAll("_", " ")}</Badge>
                    {r.isDemo ? <Badge className="ml-1">demo</Badge> : null}
                  </TD>
                  <TD className="max-w-56 truncate text-xs">{r.description ?? "—"}</TD>
                  <TD className="text-xs">{r.moduleKey ?? "platform"}</TD>
                  <TD className="text-xs">{r.providerKey ?? "—"}</TD>
                  <TD className="font-medium">{formatMicroUsd(r.costMicroUsd)}</TD>
                  <TD className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>

        {canManage ? (
          <Card className="self-start">
            <CardHeader>
              <CardTitle>Set a limit</CardTitle>
            </CardHeader>
            <CardContent>
              <CostLimitForm />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
