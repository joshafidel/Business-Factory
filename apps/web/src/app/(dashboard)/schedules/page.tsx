import { prisma } from "@bf/database";
import { can } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { runScheduleNowAction, toggleScheduleAction } from "./actions";
import { CreateScheduleForm } from "./create-form";

export const metadata = { title: "Schedules" };

export default async function SchedulesPage() {
  const ctx = await requireOrgContext();
  const [schedules, workflows] = await Promise.all([
    prisma.schedule.findMany({
      where: { organizationId: ctx.organizationId },
      include: { workflow: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.workflow.findMany({
      where: { organizationId: ctx.organizationId, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const canManage = can(ctx.role, "schedules:manage");

  return (
    <>
      <PageHeader
        title="Schedules"
        description="Cron and one-time triggers. The database is the source of truth; workers reconcile Redis to it."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {schedules.length === 0 ? (
            <EmptyState
              title="No schedules"
              hint="Create one to run a workflow on a cron cadence."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Workflow</TH>
                  <TH>Cron</TH>
                  <TH>TZ</TH>
                  <TH>Last run</TH>
                  <TH>Next run</TH>
                  <TH>Status</TH>
                  {canManage ? <TH /> : null}
                </TR>
              </THead>
              <TBody>
                {schedules.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium">{s.name}</TD>
                    <TD>{s.workflow.name}</TD>
                    <TD className="font-mono text-xs">{s.cron ?? "one-shot"}</TD>
                    <TD className="text-xs">{s.timezone}</TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(s.lastRunAt)}</TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(s.nextRunAt)}</TD>
                    <TD>
                      <StatusBadge status={s.status} />
                    </TD>
                    {canManage ? (
                      <TD>
                        <div className="flex gap-1">
                          <form
                            action={async () => {
                              "use server";
                              await toggleScheduleAction(s.id);
                            }}
                          >
                            <Button variant="outline" size="sm">
                              {s.status === "ACTIVE" ? "Pause" : "Resume"}
                            </Button>
                          </form>
                          <form
                            action={async () => {
                              "use server";
                              await runScheduleNowAction(s.id);
                            }}
                          >
                            <Button variant="ghost" size="sm">
                              Run now
                            </Button>
                          </form>
                        </div>
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>New schedule</CardTitle>
            </CardHeader>
            <CardContent>
              <CreateScheduleForm workflows={workflows} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
