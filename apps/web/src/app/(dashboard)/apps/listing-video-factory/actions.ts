"use server";

import { prisma, type Prisma } from "@bf/database";
import { PlatformError, toErrorRecord } from "@bf/shared";
import { isSafePhotoUrl } from "@bf/shared";
import {
  LIMITS,
  extractListingData,
  generateListingScript,
  generateSocialPackage,
  listingOptionsSchema,
  listingPropertySchema,
  listingScriptSchema,
  recommendOrder,
  renderOverlaySchema,
  trackEvent,
  validateScript,
} from "@bf/workflows";
import { revalidatePath } from "next/cache";
import { z } from "zod";
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

/**
 * Create a project straight from a listing page URL: fetches the page once
 * (user-confirmed rights, https-only public hosts), extracts the property
 * facts, the listing agent, and the photos from schema.org JSON-LD /
 * Open Graph data, then imports everything.
 */
export async function importListingPageAction(
  _prev: ActionResult<{ projectId: string; photoCount: number; agentName: string }>,
  formData: FormData,
): Promise<ActionResult<{ projectId: string; photoCount: number; agentName: string }>> {
  try {
    const ctx = await assertPermission("workflows:execute");
    if (!(await checkRateLimit(`lvf-import:${ctx.userId}`, 10, 60))) {
      return { error: "Slow down a little — try again in a minute." };
    }
    const url = String(formData.get("url") ?? "").trim();
    if (formData.get("rightsConfirmed") !== "on") {
      return { error: "Confirm you have permission to use this page's photos and materials." };
    }
    if (!isSafePhotoUrl(url)) {
      return { error: "Enter a public https:// listing page URL." };
    }
    let html: string;
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
        headers: { accept: "text/html", "user-agent": "BusinessFactory-ListingImport/1.0" },
      });
      if (!res.ok) return { error: `The page returned ${res.status} — check the URL.` };
      html = (await res.text()).slice(0, 3_000_000);
    } catch {
      return { error: "Couldn't fetch that page — check the URL and try again." };
    }
    const extracted = extractListingData(html, url);
    if (!extracted.property.address && extracted.photoUrls.length === 0) {
      return {
        error:
          "No structured listing data found on that page. Create the project manually and upload the photos instead.",
      };
    }
    const property = listingPropertySchema.parse({
      address: extracted.property.address ?? "Address pending",
      price: extracted.property.price ?? "",
      beds: extracted.property.beds ?? "",
      baths: extracted.property.baths ?? "",
      sqft: extracted.property.sqft ?? "",
      description: extracted.property.description ?? "",
      agentName: extracted.property.agentName ?? "",
      brokerage: extracted.property.brokerage ?? "",
      agentPhone: extracted.property.agentPhone ?? "",
      agentEmail: extracted.property.agentEmail ?? "",
      listingUrl: url,
    });
    const project = await prisma.listingProject.create({
      data: {
        organizationId: ctx.organizationId,
        createdById: ctx.userId,
        name: (extracted.title ?? property.address).slice(0, 120),
        property: property as Prisma.InputJsonValue,
        options: listingOptionsSchema.parse({}) as Prisma.InputJsonValue,
        rightsConfirmedAt: new Date(),
      },
    });
    let photoCount = 0;
    if (extracted.photoUrls.length > 0) {
      const { attachListingPhotos, downloadListingPhotos } = await import("@/lib/lvf-photos");
      const incoming = await downloadListingPhotos(extracted.photoUrls);
      const { created } = await attachListingPhotos(ctx.organizationId, project, incoming);
      photoCount = created.length;
    }
    await trackEvent(ctx.organizationId, "lvf_projects_created");
    await trackEvent(ctx.organizationId, "lvf_page_imports");
    revalidatePath(BASE);
    return { projectId: project.id, photoCount, agentName: property.agentName };
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
    const { startListingRender } = await import("@/lib/lvf-render");
    const { renderId } = await startListingRender({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      projectId,
      kind,
      overlays,
    });
    revalidatePath(`${BASE}/${projectId}`);
    return { renderId };
  } catch (err) {
    return asError(err);
  }
}

