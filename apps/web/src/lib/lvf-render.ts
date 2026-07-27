import { prisma, type Prisma } from "@bf/database";
import { PlatformError } from "@bf/shared";
import {
  LIMITS,
  RENDER_WORKFLOW_KEY,
  estimateRenderCostMicroUsd,
  getTemplate,
  listingOptionsSchema,
  listingPropertySchema,
  listingScriptSchema,
  renderSettingsSchema,
  startWorkflowRun,
  syncActiveRenders,
  trackEvent,
  type RenderOverlay,
} from "@bf/workflows";
import { dispatchAdvance } from "@/lib/execution";

/**
 * Start a listing render: validates readiness, snapshots the project into
 * immutable render settings, and kicks off the workflow. Shared by the
 * editor's server action (with browser-rasterized overlays) and the REST
 * API (no overlays). Throws PlatformError on user-facing failures.
 */
export async function startListingRender(params: {
  organizationId: string;
  userId: string;
  projectId: string;
  kind: "preview" | "final";
  overlays: RenderOverlay[];
}): Promise<{ renderId: string }> {
  const { organizationId, userId, projectId, kind, overlays } = params;
  const project = await prisma.listingProject.findFirst({
    where: { id: projectId, organizationId },
  });
  if (!project) throw new PlatformError("NOT_FOUND", "Project not found");
  if (!project.rightsConfirmedAt) {
    throw new PlatformError(
      "VALIDATION",
      "Confirm photo & listing usage rights first (Property details section).",
    );
  }
  if (!project.script) throw new PlatformError("VALIDATION", "Generate the script first.");

  const photos = await prisma.listingPhoto.findMany({
    where: { projectId: project.id, isExcluded: false },
    orderBy: { order: "asc" },
    take: LIMITS.maxRenderScenes,
  });
  if (photos.length === 0) {
    throw new PlatformError("VALIDATION", "Upload at least one photo first.");
  }

  // Only overlay assets belonging to this org can be composited.
  const overlayIds = overlays.map((o) => o.assetId);
  if (overlayIds.length > 0) {
    const owned = await prisma.asset.count({
      where: { id: { in: overlayIds }, organizationId },
    });
    if (owned !== overlayIds.length) {
      throw new PlatformError("VALIDATION", "Overlay upload incomplete — retry.");
    }
  }

  // One active render of each kind per project.
  await syncActiveRenders(project.id);
  const kindEnum = kind.toUpperCase() as "PREVIEW" | "FINAL";
  const active = await prisma.listingRender.findFirst({
    where: { projectId: project.id, kind: kindEnum, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (active) {
    throw new PlatformError("CONFLICT", `A ${kind} render is already running for this project.`);
  }

  const settings = renderSettingsSchema.parse({
    kind,
    format: project.format,
    style: project.style,
    options: listingOptionsSchema.parse(project.options ?? {}),
    property: listingPropertySchema.parse(project.property),
    script: listingScriptSchema.parse(project.script),
    photoIds: photos.map((p) => p.id),
    overlays,
  });
  const template = getTemplate(settings.style);
  const estimate = estimateRenderCostMicroUsd(
    settings.script,
    settings.options.voiceover && template.voiceover,
  );
  if (estimate > LIMITS.maxRenderCostMicroUsd) {
    throw new PlatformError(
      "COST_LIMIT",
      "Estimated cost exceeds the per-render limit — shorten the script.",
    );
  }

  const render = await prisma.listingRender.create({
    data: {
      organizationId,
      projectId: project.id,
      kind: kindEnum,
      settings: settings as unknown as Prisma.InputJsonValue,
    },
  });
  try {
    const run = await startWorkflowRun({
      organizationId,
      workflowKey: RENDER_WORKFLOW_KEY,
      input: { renderId: render.id, projectId: project.id },
      triggeredBy: { kind: "user", id: userId },
      enqueueAdvance: dispatchAdvance,
    });
    await prisma.listingRender.update({
      where: { id: render.id },
      data: { workflowRunId: run.id },
    });
  } catch (err) {
    await prisma.listingRender.update({
      where: { id: render.id },
      data: { status: "FAILED", error: (err as Error).message?.slice(0, 500) },
    });
    throw err;
  }
  await prisma.listingProject.update({
    where: { id: project.id },
    data: { status: "RENDERING" },
  });
  await trackEvent(
    organizationId,
    kind === "final" ? "lvf_final_renders_started" : "lvf_preview_renders_started",
  );
  return { renderId: render.id };
}
