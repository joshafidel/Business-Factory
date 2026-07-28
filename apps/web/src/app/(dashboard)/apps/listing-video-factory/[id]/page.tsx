import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@bf/database";
import { higgsfieldConfigured, picsartConfigured } from "@bf/providers";
import { can } from "@bf/shared";
import {
  LIMITS,
  estimateRenderCostMicroUsd,
  getTemplate,
  listingOptionsSchema,
  listingPropertySchema,
  listingScriptSchema,
  syncActiveRenders,
} from "@bf/workflows";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import { PageHeader, StatusBadge } from "@/components/ui";
import { PhotoManager } from "./photo-manager";
import { PropertyForm } from "./property-form";
import { RenderPanel } from "./render-panel";
import { ScriptPanel } from "./script-panel";
import { StylePanel } from "./style-panel";

export const metadata = { title: "Listing project" };
// Script generation + render kickoff run through this segment's actions.
export const maxDuration = 300;

export default async function ListingProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  const project = await prisma.listingProject.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      photos: { orderBy: { order: "asc" } },
      renders: { orderBy: { createdAt: "desc" }, take: 8 },
    },
  });
  if (!project) notFound();
  await syncActiveRenders(project.id);

  const property = listingPropertySchema.parse(project.property ?? { address: "" });
  const options = listingOptionsSchema.parse(project.options ?? {});
  const script = project.script ? listingScriptSchema.parse(project.script) : null;
  const template = getTemplate(project.style);
  const canExecute = can(ctx.role, "workflows:execute");

  // Package assets (SRT + report) for completed renders.
  const renderIds = project.renders.map((r) => r.id);
  const packageAssets = renderIds.length
    ? await prisma.asset.findMany({
        where: {
          organizationId: ctx.organizationId,
          metadata: { path: ["renderId"], not: "null" },
          source: "workflow:listing-factory-render:assemble",
          type: { in: ["TEXT", "JSON"] },
        },
        select: { id: true, type: true, metadata: true },
      })
    : [];
  const packagesByRender = new Map<string, { srtAssetId?: string; reportAssetId?: string }>();
  for (const asset of packageAssets) {
    const meta = asset.metadata as { renderId?: string; role?: string } | null;
    if (!meta?.renderId || !renderIds.includes(meta.renderId)) continue;
    const entry = packagesByRender.get(meta.renderId) ?? {};
    if (meta.role === "captions-srt") entry.srtAssetId = asset.id;
    if (meta.role === "report") entry.reportAssetId = asset.id;
    packagesByRender.set(meta.renderId, entry);
  }

  const includedPhotos = project.photos.filter((p) => !p.isExcluded);
  const aiMotionScenes =
    options.aiMotion && (higgsfieldConfigured() || picsartConfigured())
      ? Math.min(includedPhotos.length, LIMITS.maxAiMotionScenes)
      : 0;
  const estimate = script
    ? estimateRenderCostMicroUsd(script, options.voiceover && template.voiceover, aiMotionScenes)
    : 0n;

  return (
    <>
      <PageHeader title={project.name} description={property.address}>
        <div className="flex items-center gap-2">
          <StatusBadge status={project.status} />
          <Link
            href="/apps/listing-video-factory"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← all projects
          </Link>
        </div>
      </PageHeader>

      <div className="mb-4">
        <RenderPanel
          projectId={project.id}
          canExecute={canExecute}
          rightsConfirmed={Boolean(project.rightsConfirmedAt)}
          hasScript={Boolean(script)}
          format={project.format as "vertical" | "landscape" | "square"}
          options={options}
          property={property}
          script={script}
          photos={project.photos
            .filter((p) => !p.isExcluded)
            .map((p) => ({ id: p.id, assetId: p.assetId }))}
          estimateMicroUsd={estimate.toString()}
          socialPackage={project.socialPackage as never}
          renders={project.renders.map((r) => ({
            id: r.id,
            kind: r.kind,
            status: r.status,
            error: r.error,
            videoAssetId: r.videoAssetId,
            createdAtLabel: formatDate(r.createdAt),
            srtAssetId: packagesByRender.get(r.id)?.srtAssetId ?? null,
            reportAssetId: packagesByRender.get(r.id)?.reportAssetId ?? null,
          }))}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          <PhotoManager
            projectId={project.id}
            canExecute={canExecute}
            coverPhotoId={project.coverPhotoId}
            photos={project.photos.map((p) => ({
              id: p.id,
              assetId: p.assetId,
              category: p.category,
              roomLabel: p.roomLabel,
              note: p.note,
              isExcluded: p.isExcluded,
              isStaged: p.isStaged,
              isAiEnhanced: p.isAiEnhanced,
            }))}
          />
          <ScriptPanel
            projectId={project.id}
            canExecute={canExecute}
            script={script}
            warnings={(project.scriptWarnings as never[] | null) ?? []}
            photoCount={project.photos.filter((p) => !p.isExcluded).length}
            voiceover={options.voiceover && template.voiceover}
            photos={project.photos
              .filter((p) => !p.isExcluded)
              .map((p) => ({ id: p.id, assetId: p.assetId, roomLabel: p.roomLabel }))}
          />
        </div>
        <div className="space-y-4 xl:col-span-2">
          <StylePanel
            projectId={project.id}
            format={project.format}
            style={project.style}
            options={options}
            canExecute={canExecute}
          />
          <PropertyForm
            projectId={project.id}
            projectName={project.name}
            property={property}
            rightsConfirmed={Boolean(project.rightsConfirmedAt)}
            canExecute={canExecute}
          />
        </div>
      </div>
    </>
  );
}
