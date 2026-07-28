import Link from "next/link";
import { prisma } from "@bf/database";
import { ensureListingFactoryInstalled } from "@bf/workflows";
import { requireOrgContext } from "@/lib/session";
import { ensureLoveVillaModule } from "@/lib/love-villa";
import { Badge, Card, CardContent, PageHeader, StatusBadge } from "@/components/ui";

export const metadata = { title: "My Apps" };

/** Emoji + gradient accent per app so each business is recognizable at a glance. */
const APP_LOOK: Record<string, { emoji: string; gradient: string }> = {
  "kids-shorts": { emoji: "🦁", gradient: "from-amber-400 to-orange-500" },
  "love-villa": { emoji: "🌹", gradient: "from-rose-400 to-pink-600" },
  "dating-parody": { emoji: "💘", gradient: "from-fuchsia-400 to-pink-500" },
  "amazon-reviews": { emoji: "📦", gradient: "from-yellow-400 to-amber-600" },
  "smb-websites": { emoji: "🌐", gradient: "from-teal-400 to-emerald-600" },
  "listing-video-factory": { emoji: "🎬", gradient: "from-sky-400 to-indigo-600" },
};
const DEFAULT_LOOK = { emoji: "📁", gradient: "from-indigo-400 to-purple-500" };

/**
 * Home: one card per business. Installed apps show live numbers and are
 * clickable; future apps sit quietly at the bottom until they're built.
 */
export default async function MyAppsPage() {
  const ctx = await requireOrgContext();
  const orgId = ctx.organizationId;
  // Register both session-owned apps on deployments whose seed predates
  // them; installers fast-path to one query when current.
  await ensureLoveVillaModule(orgId);
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
          className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm hover:bg-warning/20"
        >
          <span className="font-medium">
            {pendingApprovals} item{pendingApprovals === 1 ? "" : "s"} waiting for your review
          </span>
          <span className="shrink-0 text-muted-foreground">Open →</span>
        </Link>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {installed.map((mod) => {
          const s = stats.get(mod.key) ?? { videos: 0, awaiting: 0, published: 0 };
          const look = APP_LOOK[mod.key] ?? DEFAULT_LOOK;
          return (
            <Link key={mod.id} href={`/apps/${mod.key}`} className="group">
              <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-lg group-active:translate-y-0">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-2xl shadow-sm ${look.gradient}`}
                    >
                      {look.emoji}
                    </span>
                    {s.awaiting > 0 ? (
                      <Badge variant="warning">{s.awaiting} to review</Badge>
                    ) : (
                      <StatusBadge status="ACTIVE" />
                    )}
                  </div>
                  <h2 className="mt-3 text-base font-semibold sm:text-lg">{mod.name}</h2>
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

      {upcoming.length > 0 ? (
        <>
          <h2 className="mb-3 mt-10 text-sm font-medium text-muted-foreground">Coming next</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {upcoming.map((mod) => {
              const look = APP_LOOK[mod.key] ?? DEFAULT_LOOK;
              return (
                <Card key={mod.id} className="opacity-70">
                  <CardContent className="flex items-center gap-2.5 p-3">
                    <span className="shrink-0 text-xl grayscale">{look.emoji}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{mod.name}</p>
                      <Badge className="mt-0.5">coming soon</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      ) : null}
    </>
  );
}
