"use server";

import { prisma, type Prisma } from "@bf/database";
import { PlatformError, toErrorRecord } from "@bf/shared";
import {
  LIMITS,
  RENDER_WORKFLOW_KEY,
  estimateRenderCostMicroUsd,
  generateListingScript,
  generateSocialPackage,
  getTemplate,
  listingOptionsSchema,
  listingPropertySchema,
  listingScriptSchema,
  recommendOrder,
  renderOverlaySchema,
  renderSettingsSchema,
  startWorkflowRun,
  syncActiveRenders,
  trackEvent,
  validateScript,
} from "@bf/workflows";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dispatchAdvance } from "@/lib/execution";
import { checkRateLimit } from "@/lib/rate-limit";
import { assertPermission, type OrgContext } from "@/lib/session";

/**
 * Server actions for Listing Video Factory. Every action re-asserts the
 * caller's permission and org scope — project ids from the client are never
 * trusted without an organizationId match.
 */

type ActionResult<T = object> = { error?: string } & Partial<T>;

const BASE = "/apps/listing-video-factory";

async function requireProject(ctx: OrgContext, projectId: string) {
  const project = await prisma.listingProject.findFirst({
    where: { id: projectId, organizationId: ctx.organizationId },
  });
  if (!project) throw new PlatformError("NOT_FOUND", "Project not found");
  return project;
}

function asError(err: unknown): { error: string } {
  if (err instanceof PlatformError) return { error: toErrorRecord(err).message };
  if (err instanceof z.ZodError) {
    return { error: err.issues.map((i) => i.message).join("; ").slice(0, 300) };
  }
  return { error: (err as Error)?.message?.slice(0, 300) || "Something went wrong" };
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function createProjectAction(
  _prev: ActionResult<{ projectId: string }>,
  formData: FormData,
): Promise<ActionResult<{ projectId: string }>> {
  try {
    const ctx = await assertPermission("workflows:execute");
    if (!(await checkRateLimit(`lvf-create:${ctx.userId}`, 20, 60))) {
      return { error: "Slow down a little — try again in a minute." };
    }
    const name = String(formData.get("name") ?? "").trim();
    const address = String(formData.get("address") ?? "").trim();
    if (!name) return { error: "Project name is required" };
    const property = listingPropertySchema.parse({ address });
    const project = await prisma.listingProject.create({
      data: {
        organizationId: ctx.organizationId,
        createdById: ctx.userId,
        name: name.slice(0, 120),
        property: property as Prisma.InputJsonValue,
        options: listingOptionsSchema.parse({}) as Prisma.InputJsonValue,
      },
    });
    await trackEvent(ctx.organizationId, "lvf_projects_created");
    revalidatePath(BASE);
    return { projectId: project.id };
  } catch (err) {
    return asError(err);
  }
}

export async function updatePropertyAction(
  projectId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission("workflows:execute");
    const project = await requireProject(ctx, projectId);
    const fields: Record<string, string> = {};
    for (const key of Object.keys(listingPropertySchema.shape)) {
      const v = formData.get(key);
      if (typeof v === "string") fields[key] = v;
    }
    const property = listingPropertySchema.parse(fields);
    const name = String(formData.get("projectName") ?? "").trim();
    const rights = formData.get("rightsConfirmed") === "on";
    await prisma.listingProject.update({
      where: { id: project.id },
      data: {
        property: property as Prisma.InputJsonValue,
        ...(name ? { name: name.slice(0, 120) } : {}),
        rightsConfirmedAt: rights ? (project.rightsConfirmedAt ?? new Date()) : null,
      },
    });
    // Facts changed — re-check any existing script against them.
    if (project.script) {
      const script = listingScriptSchema.parse(project.script);
      await prisma.listingProject.update({
        where: { id: project.id },
        data: {
          scriptWarnings: validateScript(script, property) as unknown as Prisma.InputJsonValue,
        },
      });
    }
    revalidatePath(`${BASE}/${projectId}`);
    return {};
  } catch (err) {
    return asError(err);
  }
}

export async function updateSettingsAction(
  projectId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission("workflows:execute");
    const project = await requireProject(ctx, projectId);
    const format = String(formData.get("format") ?? project.format);
    const style = String(formData.get("style") ?? project.style);
    const prev = listingOptionsSchema.parse(project.options ?? {});
    const bool = (key: string): boolean => formData.get(key) === "on";
    const options = listingOptionsSchema.parse({
      voiceover: bool("voiceover"),
      captions: bool("captions"),
      music: bool("music"),
      showPrice: bool("showPrice"),
      showAddress: bool("showAddress"),
      agentOutro: bool("agentOutro"),
      targetSeconds: Number(formData.get("targetSeconds") ?? prev.targetSeconds),
      platform: String(formData.get("platform") ?? prev.platform),
    });
    if (!["vertical", "landscape", "square"].includes(format)) {
      return { error: "Unknown video format" };
    }
    await prisma.listingProject.update({
      where: { id: project.id },
      data: { format, style, options: options as Prisma.InputJsonValue },
    });
    revalidatePath(`${BASE}/${projectId}`);
    return {};
  } catch (err) {
    return asError(err);
  }
}

export async function duplicateProjectAction(
  projectId: string,
): Promise<ActionResult<{ projectId: string }>> {
  try {
    const ctx = await assertPermission("workflows:execute");
    const project = await requireProject(ctx, projectId);
    const photos = await prisma.listingPhoto.findMany({
      where: { projectId: project.id },
      orderBy: { order: "asc" },
    });
    const copy = await prisma.listingProject.create({
      data: {
        organizationId: ctx.organizationId,
        createdById: ctx.userId,
        name: `${project.name} (copy)`.slice(0, 120),
        property: project.property as Prisma.InputJsonValue,
        format: project.format,
        style: project.style,
        options: (project.options ?? {}) as Prisma.InputJsonValue,
        script: (project.script ?? undefined) as Prisma.InputJsonValue | undefined,
        scriptWarnings: (project.scriptWarnings ?? undefined) as Prisma.InputJsonValue | undefined,
        rightsConfirmedAt: project.rightsConfirmedAt,
      },
    });
    for (const p of photos) {
      // Photos share the underlying Asset — bytes are not duplicated.
      const created = await prisma.listingPhoto.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: copy.id,
          assetId: p.assetId,
          order: p.order,
          category: p.category,
          roomLabel: p.roomLabel,
          note: p.note,
          isExcluded: p.isExcluded,
          isStaged: p.isStaged,
          isAiEnhanced: p.isAiEnhanced,
          width: p.width,
          height: p.height,
        },
      });
      if (p.id === project.coverPhotoId) {
        await prisma.listingProject.update({
          where: { id: copy.id },
          data: { coverPhotoId: created.id },
        });
      }
    }
    revalidatePath(BASE);
    return { projectId: copy.id };
  } catch (err) {
    return asError(err);
  }
}

export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission("workflows:execute");
    const project = await requireProject(ctx, projectId);
    await prisma.listingProject.delete({ where: { id: project.id } });
    revalidatePath(BASE);
    return {};
  } catch (err) {
    return asError(err);
  }
}

// ─── Photos ──────────────────────────────────────────────────────────────────

const photoPatchSchema = z.object({
  roomLabel: z.string().max(60).nullable().optional(),
  category: z.string().max(30).optional(),
  note: z.string().max(300).nullable().optional(),
  isExcluded: z.boolean().optional(),
  isStaged: z.boolean().optional(),
  isAiEnhanced: z.boolean().optional(),
});

export async function updatePhotoAction(
  photoId: string,
  patch: z.infer<typeof photoPatchSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission("workflows:execute");
    const photo = await prisma.listingPhoto.findFirst({
      where: { id: photoId, organizationId: ctx.organizationId },
    });
    if (!photo) return { error: "Photo not found" };
    await prisma.listingPhoto.update({
      where: { id: photo.id },
      data: photoPatchSchema.parse(patch),
    });
    revalidatePath(`${BASE}/${photo.projectId}`);
    return {};
  } catch (err) {
    return asError(err);
  }
}

export async function reorderPhotosAction(
  projectId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission("workflows:execute");
    const project = await requireProject(ctx, projectId);
    const photos = await prisma.listingPhoto.findMany({ where: { projectId: project.id } });
    const known = new Set(photos.map((p) => p.id));
    const ids = orderedIds.filter((id) => known.has(id));
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.listingPhoto.update({ where: { id }, data: { order: i } }),
      ),
    );
    await trackEvent(ctx.organizationId, "lvf_photos_reordered");
    revalidatePath(`${BASE}/${projectId}`);
    return {};
  } catch (err) {
    return asError(err);
  }
}

export async function applyRecommendedOrderAction(projectId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission("workflows:execute");
    const project = await requireProject(ctx, projectId);
    const photos = await prisma.listingPhoto.findMany({ where: { projectId: project.id } });
    const recommended = recommendOrder(photos);
    const excluded = photos.filter((p) => p.isExcluded).map((p) => p.id);
    const ids = [...recommended, ...excluded];
    await prisma.$transaction(
      ids.map((id, i) => prisma.listingPhoto.update({ where: { id }, data: { order: i } })),
    );
    revalidatePath(`${BASE}/${projectId}`);
    return {};
  } catch (err) {
    return asError(err);
  }
}

export async function setCoverPhotoAction(
  projectId: string,
  photoId: string,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission("workflows:execute");
    const project = await requireProject(ctx, projectId);
    const photo = await prisma.listingPhoto.findFirst({
      where: { id: photoId, projectId: project.id },
    });
    if (!photo) return { error: "Photo not found" };
    await prisma.listingProject.update({
      where: { id: project.id },
      data: { coverPhotoId: photo.id },
    });
    revalidatePath(`${BASE}/${projectId}`);
    return {};
  } catch (err) {
    return asError(err);
  }
}

export async function deletePhotoAction(photoId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission("workflows:execute");
    const photo = await prisma.listingPhoto.findFirst({
      where: { id: photoId, organizationId: ctx.organizationId },
    });
    if (!photo) return { error: "Photo not found" };
    await prisma.listingPhoto.delete({ where: { id: photo.id } });
    // Drop the underlying asset only when no other project still uses it
    // (duplicated projects share photo assets).
    const stillUsed = await prisma.listingPhoto.count({ where: { assetId: photo.assetId } });
    if (stillUsed === 0) {
      await prisma.asset.delete({ where: { id: photo.assetId } }).catch(() => undefined);
    }
    revalidatePath(`${BASE}/${photo.projectId}`);
    return {};
  } catch (err) {
    return asError(err);
  }
}

// ─── Script & social ─────────────────────────────────────────────────────────

export async function generateScriptAction(projectId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission("agents:execute");
    if (!(await checkRateLimit(`lvf-script:${ctx.userId}`, 10, 60))) {
      return { error: "Slow down a little — try again in a minute." };
    }
    await requireProject(ctx, projectId);
    await generateListingScript({ organizationId: ctx.organizationId, projectId });
    await trackEvent(ctx.organizationId, "lvf_scripts_generated");
    revalidatePath(`${BASE}/${projectId}`);
    return {};
  } catch (err) {
    return asError(err);
  }
}

export async function saveScriptAction(
  projectId: string,
  scriptJson: unknown,
): Promise<ActionResult<{ warningCount: number }>> {
  try {
    const ctx = await assertPermission("workflows:execute");
    const project = await requireProject(ctx, projectId);
    const script = listingScriptSchema.parse(scriptJson);
    const property = listingPropertySchema.parse(project.property);
    const warnings = validateScript(script, property);
    await prisma.listingProject.update({
      where: { id: project.id },
      data: {
        script: script as unknown as Prisma.InputJsonValue,
        scriptWarnings: warnings as unknown as Prisma.InputJsonValue,
      },
    });
    revalidatePath(`${BASE}/${projectId}`);
    return { warningCount: warnings.length };
  } catch (err) {
    return asError(err);
  }
}

export async function generateSocialAction(projectId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission("agents:execute");
    if (!(await checkRateLimit(`lvf-social:${ctx.userId}`, 10, 60))) {
      return { error: "Slow down a little — try again in a minute." };
    }
    await requireProject(ctx, projectId);
    await generateSocialPackage({ organizationId: ctx.organizationId, projectId });
    revalidatePath(`${BASE}/${projectId}`);
    return {};
  } catch (err) {
    return asError(err);
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

const startRenderSchema = z.object({
  kind: z.enum(["preview", "final"]),
  overlays: z.array(renderOverlaySchema).max(LIMITS.maxRenderScenes + 4).default([]),
});

export async function startRenderAction(
  projectId: string,
  payload: unknown,
): Promise<ActionResult<{ renderId: string }>> {
  try {
    const ctx = await assertPermission("workflows:execute");
    if (!(await checkRateLimit(`lvf-render:${ctx.userId}`, 6, 60))) {
      return { error: "Slow down a little — try again in a minute." };
    }
    const { kind, overlays } = startRenderSchema.parse(payload);
    const project = await requireProject(ctx, projectId);
    if (!project.rightsConfirmedAt) {
      return { error: "Confirm photo & listing usage rights first (Property details section)." };
    }
    if (!project.script) return { error: "Generate the script first." };

    const photos = await prisma.listingPhoto.findMany({
      where: { projectId: project.id, isExcluded: false },
      orderBy: { order: "asc" },
      take: LIMITS.maxRenderScenes,
    });
    if (photos.length === 0) return { error: "Upload at least one photo first." };

    // Only overlay assets belonging to this org can be composited.
    const overlayIds = overlays.map((o) => o.assetId);
    const ownedOverlays = await prisma.asset.count({
      where: { id: { in: overlayIds }, organizationId: ctx.organizationId },
    });
    if (ownedOverlays !== overlayIds.length) return { error: "Overlay upload incomplete — retry." };

    // One active render of each kind per project.
    await syncActiveRenders(project.id);
    const active = await prisma.listingRender.findFirst({
      where: { projectId: project.id, kind: kind.toUpperCase() as "PREVIEW" | "FINAL", status: { in: ["QUEUED", "RUNNING"] } },
    });
    if (active) return { error: `A ${kind} render is already running for this project.` };

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
      return { error: "Estimated cost exceeds the per-render limit — shorten the script." };
    }

    const render = await prisma.listingRender.create({
      data: {
        organizationId: ctx.organizationId,
        projectId: project.id,
        kind: kind.toUpperCase() as "PREVIEW" | "FINAL",
        settings: settings as unknown as Prisma.InputJsonValue,
      },
    });
    try {
      const run = await startWorkflowRun({
        organizationId: ctx.organizationId,
        workflowKey: RENDER_WORKFLOW_KEY,
        input: { renderId: render.id, projectId: project.id },
        triggeredBy: { kind: "user", id: ctx.userId },
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
      ctx.organizationId,
      kind === "final" ? "lvf_final_renders_started" : "lvf_preview_renders_started",
    );
    revalidatePath(`${BASE}/${projectId}`);
    return { renderId: render.id };
  } catch (err) {
    return asError(err);
  }
}

