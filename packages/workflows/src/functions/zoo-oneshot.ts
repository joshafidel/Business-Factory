import { recordCost } from "@bf/agents";
import { prisma, type Prisma } from "@bf/database";
import {
  KLING_ONESHOT_COST_MICRO_USD_PER_SECOND,
  downloadOneShotVideo,
  klingOneShotConfigured,
  pollOneShotVideo,
  submitOneShotVideo,
} from "@bf/providers";
import { getStorage } from "@bf/storage";
import { createLogger, PlatformError } from "@bf/shared";
import { registerCodeFunction, readPath } from "../definitions";

const log = createLogger("zoo-oneshot");

/**
 * One-shot episode generation (owner's proven workflow, 2026-07-30):
 * reference-winner → single rich prompt → Kling 3.0 generates the COMPLETE
 * 15s vertical video with native audio in one call. Registered under the
 * step key "assemble" in the one-shot workflow so the Quality Director,
 * review gate and publisher work unchanged.
 *
 * Serverless pattern: submit on the first attempt (request id persisted to
 * storage), poll on retries, download + save when done.
 */
registerCodeFunction("zoo_oneshot_generate", async (args, context) => {
  const organizationId = String(args.organizationId ?? "");
  const workflowRunId = String(args.workflowRunId ?? "");
  const prompt = readPath(context, "$.steps.prompt") as {
    videoPrompt?: string;
    durationSeconds?: number;
  };
  const metadata = readPath(context, "$.steps.metadata") as { title?: string };
  const title = metadata?.title ?? "Zoo Friends short";
  const storage = getStorage();

  if (!klingOneShotConfigured()) {
    throw new PlatformError(
      "VALIDATION",
      "FAL_KEY is not configured — the one-shot pipeline needs a fal.ai key (Kling 3.0).",
      { retryable: false },
    );
  }
  const videoPrompt = prompt?.videoPrompt?.trim();
  if (!videoPrompt || videoPrompt.length < 80) {
    throw new PlatformError("VALIDATION", "prompt step produced no usable videoPrompt", {
      retryable: false,
    });
  }
  const durationSeconds = Math.min(15, Math.max(10, prompt?.durationSeconds ?? 15));

  const jobKey = `${organizationId}/${workflowRunId}/scene-render-oneshot-job.txt`;
  let requestId: string;
  try {
    requestId = (await storage.get(jobKey)).toString("utf8");
  } catch {
    requestId = await submitOneShotVideo({ prompt: videoPrompt, durationSeconds });
    await storage.put(jobKey, Buffer.from(requestId), { contentType: "text/plain" });
    log.info({ workflowRunId, requestId }, "one-shot generation submitted");
  }

  // Poll within this invocation's budget; Kling 3.0 usually lands in ~2-4 min.
  const deadline = Date.now() + 150_000;
  let status = await pollOneShotVideo(requestId);
  while (status.status === "pending" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));
    status = await pollOneShotVideo(requestId);
  }
  if (status.status === "pending") {
    const attempt = await prisma.stepRun.count({ where: { workflowRunId, stepKey: "assemble" } });
    if (attempt <= 8) {
      throw new PlatformError("PROVIDER_ERROR", "one-shot video still rendering", {
        retryable: true,
      });
    }
    throw new PlatformError("PROVIDER_ERROR", "one-shot generation timed out", {
      retryable: false,
    });
  }
  if (status.status === "failed" || !status.videoUrl) {
    // One fresh submission gets a second chance on the next attempt.
    await storage.delete(jobKey).catch(() => undefined);
    const attempt = await prisma.stepRun.count({ where: { workflowRunId, stepKey: "assemble" } });
    throw new PlatformError("PROVIDER_ERROR", "one-shot generation failed at the provider", {
      retryable: attempt <= 2,
    });
  }

  const video = await downloadOneShotVideo(status.videoUrl);
  const cost = KLING_ONESHOT_COST_MICRO_USD_PER_SECOND * BigInt(durationSeconds);
  const key = `${organizationId}/${workflowRunId}/video-final-${Date.now()}`;
  const stored = await storage.put(key, video, { contentType: "video/mp4" });
  const asset = await prisma.asset.create({
    data: {
      organizationId,
      name: `Video: ${title.slice(0, 80)}`,
      type: "VIDEO",
      mimeType: "video/mp4",
      storageDriver: storage.driver,
      storageKey: stored.key,
      sizeBytes: stored.sizeBytes,
      moduleKey: "kids-shorts",
      workflowRunId,
      source: "workflow:zoo-oneshot-pipeline:assemble",
      approvalStatus: "PENDING_REVIEW",
      metadata: {
        provider: "kling-v3-oneshot",
        durationSeconds,
        oneShot: true,
      } as Prisma.InputJsonValue,
    },
  });
  await storage.delete(jobKey).catch(() => undefined);
  await recordCost({
    organizationId,
    category: "VIDEO_GENERATION",
    costMicroUsd: cost,
    moduleKey: "kids-shorts",
    workflowRunId,
    providerKey: "fal-kling",
    description: `Kling 3.0 one-shot ${durationSeconds}s for "${title.slice(0, 60)}"`,
  });

  return {
    videoAssetId: asset.id,
    isPlaceholder: false,
    // Shape-compatible with the Quality Director: one-shot videos are
    // continuous motion, so no scene ever falls back to a still.
    sceneCount: 3,
    animatedScenes: 3,
    animationFallbacks: [],
    oneShot: true,
    _costMicroUsd: cost.toString(),
  };
});
