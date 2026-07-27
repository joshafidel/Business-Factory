import { runAgent } from "@bf/agents";
import { prisma, type Prisma } from "@bf/database";
import { getMediaProviders } from "@bf/providers";
import { getTemplate } from "./templates";
import { validateScript, type ContentWarning } from "./validation";
import {
  LIMITS,
  MODULE_KEY,
  SCRIPT_AGENT_KEY,
  SOCIAL_AGENT_KEY,
  listingOptionsSchema,
  listingPropertySchema,
  listingScriptSchema,
  socialPackageSchema,
  type ListingScript,
  type SocialPackage,
} from "./types";

/**
 * Script + social-package generation for a project. Runs through the
 * platform agent runner (validation, retries, cost ledger, mock fallback)
 * and the deterministic content validator. Called from server actions —
 * generation is interactive (the user edits before rendering), only renders
 * go through the workflow engine.
 */

export async function generateListingScript(params: {
  organizationId: string;
  projectId: string;
}): Promise<{ script: ListingScript; warnings: ContentWarning[] }> {
  const project = await prisma.listingProject.findFirst({
    where: { id: params.projectId, organizationId: params.organizationId },
    include: { photos: { where: { isExcluded: false }, orderBy: { order: "asc" } } },
  });
  if (!project) throw new Error("Project not found");
  if (project.photos.length === 0) throw new Error("Upload photos before generating a script");

  const property = listingPropertySchema.parse(project.property);
  const options = listingOptionsSchema.parse(project.options ?? {});
  const template = getTemplate(project.style);
  const photos = project.photos.slice(0, LIMITS.maxRenderScenes).map((p, i) => ({
    photoId: p.id,
    index: i,
    category: p.category,
    roomLabel: p.roomLabel ?? "",
    note: p.note ?? "",
    virtuallyStaged: p.isStaged,
  }));

  const { output } = await runAgent({
    organizationId: params.organizationId,
    agentKey: SCRIPT_AGENT_KEY,
    goal: "Write the property tour script",
    input: {
      property,
      style: { key: template.key, tone: template.scriptTone },
      photos,
    },
    moduleKey: MODULE_KEY,
    variables: {
      tone: template.scriptTone,
      targetSeconds: String(options.targetSeconds),
      sceneCount: String(photos.length),
    },
  });

  const script = normalizeScript(output, photos.map((p) => p.photoId));
  const warnings = validateScript(script, property);
  await prisma.listingProject.update({
    where: { id: project.id },
    data: {
      script: script as unknown as Prisma.InputJsonValue,
      scriptWarnings: warnings as unknown as Prisma.InputJsonValue,
    },
  });
  return { script, warnings };
}

/**
 * Coerce agent output into a valid script: parse, then repair photoId
 * references (the mock provider and occasionally a real model return ids
 * that don't match) by falling back to positional order.
 */
export function normalizeScript(output: unknown, photoIds: string[]): ListingScript {
  const parsed = listingScriptSchema.parse(output);
  const known = new Set(photoIds);
  const usable = parsed.scenes.slice(0, photoIds.length);
  const scenes = usable.map((scene, i) => ({
    ...scene,
    photoId: known.has(scene.photoId) ? scene.photoId : (photoIds[i] ?? ""),
  }));
  // One scene per remaining photo so every photo keeps a slot even when the
  // model returned fewer scenes than photos.
  for (let i = scenes.length; i < photoIds.length; i++) {
    scenes.push({ photoId: photoIds[i]!, narration: "", caption: "" });
  }
  return { ...parsed, scenes };
}

export async function generateSocialPackage(params: {
  organizationId: string;
  projectId: string;
}): Promise<SocialPackage> {
  const project = await prisma.listingProject.findFirst({
    where: { id: params.projectId, organizationId: params.organizationId },
  });
  if (!project) throw new Error("Project not found");
  if (!project.script) throw new Error("Generate the script first");
  const property = listingPropertySchema.parse(project.property);
  const options = listingOptionsSchema.parse(project.options ?? {});

  const { output } = await runAgent({
    organizationId: params.organizationId,
    agentKey: SOCIAL_AGENT_KEY,
    goal: "Write the social posting package",
    input: { property, script: project.script, platform: options.platform },
    moduleKey: MODULE_KEY,
  });
  const pkg = socialPackageSchema.parse(output);
  await prisma.listingProject.update({
    where: { id: project.id },
    data: { socialPackage: pkg as unknown as Prisma.InputJsonValue },
  });
  return pkg;
}

/** Micro-USD estimate shown before starting a render. */
export function estimateRenderCostMicroUsd(script: ListingScript, voiceover: boolean): bigint {
  if (!voiceover) return 0n;
  const providers = getMediaProviders();
  if (!providers.real) return 0n; // mock voice is free
  const chars = [script.hook, ...script.scenes.map((s) => s.narration), script.outro, script.cta]
    .join(" ")
    .length;
  // gpt-4o-mini-tts ≈ $12 per 1M input characters.
  return BigInt(Math.ceil(chars * 12));
}

/**
 * Reconcile QUEUED/RUNNING renders whose workflow run died outside the
 * renderer's own catch (cost-limit stops, crashed invocations, runs that
 * never started). Called lazily on read paths — no cron needed.
 */
export async function syncActiveRenders(projectId: string): Promise<void> {
  const active = await prisma.listingRender.findMany({
    where: { projectId, status: { in: ["QUEUED", "RUNNING"] } },
    include: { workflowRun: { select: { status: true, error: true } } },
  });
  for (const render of active) {
    const runStatus = render.workflowRun?.status;
    if (runStatus === "FAILED" || runStatus === "CANCELLED") {
      await prisma.listingRender.update({
        where: { id: render.id },
        data: {
          status: "FAILED",
          error:
            (render.workflowRun?.error as { message?: string } | null)?.message?.slice(0, 500) ??
            `Workflow ${runStatus.toLowerCase()}`,
        },
      });
      continue;
    }
    const ageMs = Date.now() - render.updatedAt.getTime();
    if (!render.workflowRun && ageMs > 15 * 60_000) {
      await prisma.listingRender.update({
        where: { id: render.id },
        data: { status: "FAILED", error: "Render never started" },
      });
    }
  }
}

/** Daily product-metric counter (existing Metric table, existing dashboards). */
export async function trackEvent(organizationId: string, key: string, value = 1): Promise<void> {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const where = {
    organizationId_key_moduleKey_bucketStart_bucketSize: {
      organizationId,
      key,
      moduleKey: MODULE_KEY,
      bucketStart: day,
      bucketSize: "day",
    },
  };
  const existing = await prisma.metric.findUnique({ where });
  if (existing) {
    await prisma.metric.update({
      where,
      data: { value: existing.value + value },
    });
  } else {
    await prisma.metric.create({
      data: {
        organizationId,
        key,
        moduleKey: MODULE_KEY,
        value,
        unit: "count",
        bucketStart: day,
        bucketSize: "day",
        isDemo: false,
      },
    });
  }
}
