import { prisma, type Prisma } from "@bf/database";
import { MockAudioProvider, MockImageProvider, MockVideoProvider } from "@bf/providers";
import { getStorage } from "@bf/storage";
import { registerCodeFunction, readPath } from "../definitions";

/**
 * Zoo Shorts renderer (CODE_FUNCTION "render_zoo_short").
 *
 * Produces the video production package for a short: one image per scene,
 * a voice-over track, and the video file, all saved as assets on the run.
 * Media generation goes through the provider interfaces — today those are
 * the local mocks (placeholder bytes, $0), and they will be swapped for real
 * image/TTS/video APIs without touching this pipeline.
 */
registerCodeFunction("render_zoo_short", async (args, context) => {
  const organizationId = String(args.organizationId ?? "");
  const workflowRunId = String(args.workflowRunId ?? "");
  const script = readPath(context, "$.steps.script") as {
    scenes?: { narration?: string; visual?: string }[];
  };
  const metadata = readPath(context, "$.steps.metadata") as { title?: string };
  const scenes = script?.scenes ?? [];
  const title = metadata?.title ?? "Zoo short";

  const storage = getStorage();
  const image = new MockImageProvider();
  const audio = new MockAudioProvider();
  const video = new MockVideoProvider();

  const assetIds: string[] = [];
  const save = async (
    name: string,
    type: "IMAGE" | "AUDIO" | "VIDEO",
    mimeType: string,
    data: Buffer,
    meta: Record<string, unknown>,
  ): Promise<string> => {
    const key = `${organizationId}/${workflowRunId}/${type.toLowerCase()}-${assetIds.length}-${Date.now()}`;
    const stored = await storage.put(key, data, { contentType: mimeType });
    const asset = await prisma.asset.create({
      data: {
        organizationId,
        name,
        type,
        mimeType,
        storageDriver: storage.driver,
        storageKey: stored.key,
        sizeBytes: stored.sizeBytes,
        moduleKey: "kids-shorts",
        workflowRunId,
        source: "workflow:zoo-shorts-pipeline:render",
        approvalStatus: "PENDING_REVIEW",
        metadata: meta as Prisma.InputJsonValue,
      },
    });
    assetIds.push(asset.id);
    return asset.id;
  };

  // Scene images.
  for (let i = 0; i < Math.min(scenes.length, 8); i++) {
    const scene = scenes[i];
    const result = await image.generateImage({ prompt: scene?.visual ?? "zoo animal scene" });
    await save(`Scene ${i + 1}: ${(scene?.visual ?? "").slice(0, 60)}`, "IMAGE", result.mimeType, result.data, {
      sceneIndex: i,
      visual: scene?.visual,
      provider: image.key,
    });
  }

  // Voice-over from the full narration.
  const narration = scenes.map((s) => s?.narration ?? "").join(" ");
  const voice = await audio.generateSpeech({ text: narration });
  await save(`Voice-over: ${title.slice(0, 60)}`, "AUDIO", voice.mimeType, voice.data, {
    chars: narration.length,
    provider: audio.key,
  });

  // Assembled video.
  const rendered = await video.generateVideo({ prompt: title });
  const videoAssetId = await save(`Video: ${title.slice(0, 80)}`, "VIDEO", rendered.mimeType, rendered.data, {
    provider: video.key,
    placeholder: video.key.startsWith("mock"),
    sceneCount: scenes.length,
  });

  return {
    videoAssetId,
    assetIds,
    sceneCount: scenes.length,
    renderProvider: video.key,
    isPlaceholder: video.key.startsWith("mock"),
  };
});
