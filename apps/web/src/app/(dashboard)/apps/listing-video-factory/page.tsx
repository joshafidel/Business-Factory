import Link from "next/link";
import { prisma } from "@bf/database";
import { can, formatMicroUsd } from "@bf/shared";
import { MODULE_KEY, VIDEO_FORMATS, ensureListingFactoryInstalled } from "@bf/workflows";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Stat,
  StatusBadge,
} from "@/components/ui";
import { NewProjectForm } from "./new-project-form";
import { ProjectRowActions } from "./project-row-actions";

export const metadata = { title: "Listing Video Factory" };
export const maxDuration = 60;

/**
 * Listing Video Factory home: create a project, see every project's state
 * at a glance. The heavy lifting happens in the per-project editor.
 */
export default async function ListingFactoryPage() {
  const ctx = await requireOrgContext();
  await ensureListingFactoryInstalled(ctx.organizationId);
  const orgId = ctx.organizationId;

  const [projects, videoCount, monthCost] = await Promise.all([
    prisma.listingProject.findMany({
      where: { organizationId: orgId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        photos: { where: { isExcluded: false }, select: { id: true, assetId: true }, orderBy: { order: "asc" }, take: 1 },
        renders: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { photos: true, renders: true } },
      },
    }),
    prisma.asset.count({ where: { organizationId: orgId, moduleKey: MODULE_KEY, type: "VIDEO" } }),
    prisma.costRecord.aggregate({
      where: {
        organizationId: orgId,
        moduleKey: MODULE_KEY,
        isDemo: false,
        createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
      _sum: { costMicroUsd: true },
    }),
  ]);
  const canExecute = can(ctx.role, "workflows:execute");

  return (
    <>
      <PageHeader
        title="🎬 Listing Video Factory"
        description="Turn listing photos into cinematic property-tour videos for TikTok, Reels, Shorts, and listing pages."
      >
        <StatusBadge status="ACTIVE" />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Projects" value={projects.length} />
        <Stat label="Rendering now" value={projects.filter((p) => p.status === "RENDERING").length} />
        <Stat label="Videos rendered" value={videoCount} />
        <Stat label="Cost this month" value={formatMicroUsd(monthCost._sum.costMicroUsd ?? 0n)} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Projects</h2>
          {projects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              hint="Create a project, upload the listing photos, and render your first tour video."
            />
          ) : (
            <div className="space-y-2">
              {projects.map((project) => {
                const property = project.property as { address?: string };
                const lastRender = project.renders[0];
                const coverAssetId = project.photos[0]?.assetId;
                const format = VIDEO_FORMATS[project.format as keyof typeof VIDEO_FORMATS];
                return (
                  <div
                    key={project.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                  >
                    <Link
                      href={`/apps/listing-video-factory/${project.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      {coverAssetId ? (
                        <img
                          src={`/api/assets/raw?id=${coverAssetId}`}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted text-lg">
                          🏠
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{project.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {property.address ?? "No address"} · {project._count.photos} photo
                          {project._count.photos === 1 ? "" : "s"} ·{" "}
                          {format?.label.split(" (")[0] ?? project.format} · updated{" "}
                          {formatDate(project.updatedAt)}
                        </p>
                      </div>
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                      {lastRender ? (
                        <Badge
                          variant={
                            lastRender.status === "COMPLETED"
                              ? "success"
                              : lastRender.status === "FAILED"
                                ? "destructive"
                                : "warning"
                          }
                        >
                          {lastRender.kind.toLowerCase()} {lastRender.status.toLowerCase()}
                        </Badge>
                      ) : (
                        <StatusBadge status={project.status} />
                      )}
                      {canExecute ? <ProjectRowActions projectId={project.id} /> : null}
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
              <CardContent className="p-5">
                <h2 className="mb-3 text-sm font-semibold">New project</h2>
                <NewProjectForm />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardContent className="space-y-1.5 p-5 text-sm text-muted-foreground">
              <h2 className="mb-2 text-sm font-semibold text-foreground">How it works</h2>
              <p>1. Upload the listing photos and drag them into tour order.</p>
              <p>2. Enter the property facts — the script uses only what you provide.</p>
              <p>3. Pick a style: Luxury Cinematic, Fast Social, Clean Professional, or Showcase.</p>
              <p>4. Generate the script and voice-over, render a preview, then the final MP4.</p>
              <p>5. Download the video, captions, and social posting package.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
