import Link from "next/link";
import { prisma } from "@bf/database";
import { ensureListingFactoryInstalled } from "@bf/workflows";
import { requireOrgContext } from "@/lib/session";
import { Badge, Card, CardContent, PageHeader, StatusBadge } from "@/components/ui";

export const metadata = { title: "My Apps" };

const APP_EMOJI: Record<string, string> = {
  "kids-shorts": "🦁",
  "dating-parody": "💘",
  "amazon-reviews": "📦",
  "smb-websites": "🌐",
  "listing-video-factory": "🎬",
};

/**
 * Home: one card per business. Installed apps show live numbers and are
 * clickable; future apps sit quietly at the bottom until they're built.
 */
export default async function MyAppsPage() {
  const ctx = await requireOrgContext();
  const orgId = ctx.organizationId;
  // Installed modules must never show as dead "coming soon" cards on a
  // fresh deployment — the installer fast-paths to one query when current.
  await ensureListingFactoryInstalled(orgId);
  const [modules, pendingApprovals] = await Promise.all([
    prisma.businessModule.findMany({
      where: { organizationId: orgId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    prisma.approvalRequest.count({ where: { organizationId: orgId, status: "PENDING" } }),
  ]);

  const installed = modules.filter((m) => m.status === "INSTALLED");
  const upcoming = modules.filter((m) => m.status !== "INSTALLED");

  // Live stats per installed app.
  const stats = new Map<string, { videos: number; awaiting: number; published: number }>();
  for (const mod of installed) {
    const [videos, awaiting, published] = await Promise.all([
      prisma.asset.count({ where: { organizationId: orgId, moduleKey: mod.key, type: "VIDEO" } }),
      prisma.workflowRun.count({
        where: {
          organizationId: orgId,
          status: "AWAITING_APPROVAL",
          workflow: { module: { key: mod.key } },
        },
      }),
      prisma.asset.count({
        where: {
          organizationId: orgId,
          moduleKey: mod.key,
          type: "VIDEO",
          // any string value present = uploaded
          metadata: { path: ["youtubeVideoId"], string_starts_with: "" },
        },
      }),
    ]);
    stats.set(mod.key, { videos, awaiting, published });
  }

  return (
    <>
      <PageHeader title="My Apps" description="Your businesses, at a glance." />

      {pendingApprovals > 0 ? (
        <Link
          href="/approvals"
          className="mb-6 flex items-center justify-between rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm hover:bg-warning/20"
        >
          <span className="font-medium">
            {pendingApprovals} item{pendingApprovals === 1 ? "" : "s"} waiting for your review
          </span>
          <span className="text-muted-foreground">Open approvals →</span>
        </Link>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {installed.map((mod) => {
          const s = stats.get(mod.key) ?? { videos: 0, awaiting: 0, published: 0 };
          return (
            <Link key={mod.id} href={`/apps/${mod.key}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <span className="text-3xl">{APP_EMOJI[mod.key] ?? "📁"}</span>
                    <StatusBadge status="ACTIVE" />
                  </div>
                  <h2 className="mt-3 text-lg font-semibold">{mod.name}</h2>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {mod.description}
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
                    <div>
                      <p className="text-lg font-semibold tabular-nums">{s.videos}</p>
                      <p className="text-xs text-muted-foreground">videos</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold tabular-nums">{s.awaiting}</p>
                      <p className="text-xs text-muted-foreground">to review</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold tabular-nums">{s.published}</p>
                      <p className="text-xs text-muted-foreground">published</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <h2 className="mb-3 mt-10 text-sm font-medium text-muted-foreground">Coming next</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {upcoming.map((mod) => (
          <Card key={mod.id} className="opacity-70">
            <CardContent className="flex items-center gap-3 p-4">
              <span className="text-2xl grayscale">{APP_EMOJI[mod.key] ?? "📁"}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{mod.name}</p>
                <Badge className="mt-0.5">coming soon</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
