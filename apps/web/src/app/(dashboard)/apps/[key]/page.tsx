import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@bf/database";
import { getProviderRegistry } from "@bf/providers";
import { can, formatMicroUsd } from "@bf/shared";
import { youtubeConfigured } from "@bf/workflows";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Stat,
  StatusBadge,
} from "@/components/ui";
import { MediaActions } from "@/components/media-actions";
import { CreateVideoForm } from "./create-video-form";
import { LoveVillaApp } from "./love-villa-app";

export const metadata = { title: "App" };
export const maxDuration = 300;

const WORKFLOW_BY_APP: Record<string, string> = { "kids-shorts": "zoo-shorts-pipeline" };

export default async function AppPage({ params }: { params: Promise<{ key: string }> }) {
  const ctx = await requireOrgContext();
  const { key } = await params;
  const mod = await prisma.businessModule.findFirst({
    where: { organizationId: ctx.organizationId, key },
  });
  if (!mod) notFound();

  if (mod.status !== "INSTALLED") {
    return (
      <>
        <PageHeader title={mod.name} description={mod.description}>
          <StatusBadge status={mod.status} />
        </PageHeader>
        <EmptyState
          title="This app isn't built yet"
          hint="It's on the roadmap — the platform underneath it is ready."
        />
      </>
    );
  }

  // Love Villa is produced by the standalone apps/love-villa pipeline —
  // its app page is a control-room view rather than a workflow dashboard.
  if (key === "love-villa") {
    return <LoveVillaApp description={mod.description} />;
  }

  const orgId = ctx.organizationId;
  const workflowKey = WORKFLOW_BY_APP[key] ?? "";
  const [runs, videos, awaitingApprovals, monthCost] = await Promise.all([
    prisma.workflowRun.findMany({
      where: { organizationId: orgId, workflow: { key: workflowKey } },
      include: {
        approvals: { where: { status: "PENDING" }, select: { id: true } },
        stepRuns: {
          where: { stepKey: { in: ["idea", "publish"] }, status: "COMPLETED" },
          select: { stepKey: true, output: true },
        },
        assets: {
          where: { type: "VIDEO" },
          select: { id: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    prisma.asset.count({ where: { organizationId: orgId, moduleKey: key, type: "VIDEO" } }),
    prisma.approvalRequest.count({
      where: {
        organizationId: orgId,
        status: "PENDING",
        workflowRun: { workflow: { key: workflowKey } },
      },
    }),
    prisma.costRecord.aggregate({
      where: {
        organizationId: orgId,
        moduleKey: key,
        isDemo: false,
        createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
      _sum: { costMicroUsd: true },
    }),
  ]);

  const published = runs.filter((r) =>
    r.stepRuns.some(
      (sr) => sr.stepKey === "publish" && (sr.output as { published?: boolean } | null)?.published,
    ),
  ).length;

  // Setup checklist state.
  const realAI = getProviderRegistry()
    .available()
    .some((p) => p.key !== "mock");
  const youtubeReady = youtubeConfigured();
  const setupDone = realAI && youtubeReady;
  const canExecute = can(ctx.role, "workflows:execute");

  return (
    <>
      <PageHeader
        title={`🦁 ${mod.name}`}
        description="Zoo-themed YouTube Shorts for kids, made by your agents."
      >
        <StatusBadge status="ACTIVE" />
      </PageHeader>

      {!setupDone ? (
        <Card className="mb-6 border-warning/40 bg-warning/5">
          <CardHeader>
            <CardTitle>Finish setting up (one-time)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ChecklistRow
              done={realAI}
              label="Connect real AI writing"
              hint="Videos currently use placeholder text. Add an Anthropic API key to Vercel to get real scripts."
            />
            <ChecklistRow
              done={youtubeReady}
              label="Connect your YouTube channel"
              hint="Videos stop at 'approved & ready' until YouTube is connected."
            />
            <p className="pt-1 text-xs text-muted-foreground">
              Both are covered step-by-step in the setup instructions you were given. Everything
              else is automatic.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Videos created" value={videos} />
        <Stat label="Waiting for your review" value={awaitingApprovals} />
        <Stat label="Published to YouTube" value={published} />
        <Stat label="Cost this month" value={formatMicroUsd(monthCost._sum.costMicroUsd ?? 0n)} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Recent videos</h2>
          {runs.length === 0 ? (
            <EmptyState
              title="No videos yet"
              hint="Click “Make a video” to create the first one."
            />
          ) : (
            <div className="space-y-2">
              {runs.map((run) => {
                const idea = run.stepRuns.find((sr) => sr.stepKey === "idea")?.output as {
                  title?: string;
                  animal?: string;
                } | null;
                const publish = run.stepRuns.find((sr) => sr.stepKey === "publish")?.output as {
                  published?: boolean;
                  url?: string;
                  note?: string;
                } | null;
                const pendingApproval = run.approvals[0];
                const videoAsset = run.assets[0];
                return (
                  <div
                    key={run.id}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {idea?.title ?? "Preparing…"}
                        {idea?.animal ? (
                          <span className="ml-2 text-xs text-muted-foreground">{idea.animal}</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDate(run.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 sm:justify-end">
                      {videoAsset ? (
                        <MediaActions
                          variant="links"
                          src={`/api/assets/raw?id=${videoAsset.id}`}
                          filename={`${slugify(idea?.title ?? "zoo-short")}.mp4`}
                        />
                      ) : null}
                      {publish?.published && publish.url ? (
                        <a
                          href={publish.url}
                          target="_blank"
                          className="text-xs text-primary hover:underline"
                        >
                          Watch on YouTube
                        </a>
                      ) : null}
                      {run.status === "COMPLETED" && publish && !publish.published ? (
                        <Badge variant="warning">ready — YouTube not connected</Badge>
                      ) : null}
                      {pendingApproval ? (
                        <Link
                          href={`/approvals/${pendingApproval.id}`}
                          className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                        >
                          Review now
                        </Link>
                      ) : (
                        <StatusBadge status={run.status} />
                      )}
                      <Link
                        href={`/runs/${run.id}`}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        details
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {canExecute ? (
            <Card>
              <CardHeader>
                <CardTitle>Make a video</CardTitle>
              </CardHeader>
              <CardContent>
                <CreateVideoForm workflowKey={workflowKey} />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>How it works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm text-muted-foreground">
              <p>
                1. Agents pick an animal, write the script and title, and run a kid-safety check.
              </p>
              <p>2. Images, voice-over, and video are generated.</p>
              <p>3. It waits for your one-click review in Approvals.</p>
              <p>4. Approved videos publish to YouTube automatically (once connected).</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "video"
  );
}

function ChecklistRow({ done, label, hint }: { done: boolean; label: string; hint: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className={done ? "text-success" : "text-warning"}>{done ? "✓" : "○"}</span>
      <div>
        <p className={`font-medium ${done ? "text-muted-foreground line-through" : ""}`}>{label}</p>
        {!done ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}
