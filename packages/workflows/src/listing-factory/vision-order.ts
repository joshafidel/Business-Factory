import { loadEnv } from "@bf/config";
import { prisma } from "@bf/database";
import { getStorage } from "@bf/storage";
import { createLogger } from "@bf/shared";
import { recommendOrder } from "./sequence";
import { ROOM_LABELS, PHOTO_CATEGORIES, type PhotoCategory } from "./types";

const log = createLogger("lvf-vision-order");

/**
 * AI room inference: classify each photo's room type with a vision model,
 * store the labels, and reorder the tour with recommendOrder. Runs before a
 * one-click render so uploads need no manual labeling. Manual labels always
 * win — only unlabeled photos are classified. Fail-open: if vision is not
 * configured or errors, photos keep their upload order.
 */

const VISION_MODEL = "gpt-4o-mini";
const OPENAI_BASE = "https://api.openai.com/v1";

async function proxyDispatcher(): Promise<unknown> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return undefined;
  const { ProxyAgent } = await import("undici");
  return new ProxyAgent(proxy);
}

interface Classification {
  index: number;
  roomLabel: string;
  category: PhotoCategory;
}

/** Parse the model's JSON array defensively; unknown labels are dropped. */
export function parseClassifications(text: string, count: number): Classification[] {
  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    const arr = JSON.parse(text.slice(start, end + 1)) as unknown[];
    const known = new Set<string>(ROOM_LABELS);
    const cats = new Set<string>(PHOTO_CATEGORIES);
    const out: Classification[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const index = typeof o.index === "number" ? o.index : -1;
      const roomLabel = typeof o.roomLabel === "string" ? o.roomLabel : "";
      const category = typeof o.category === "string" ? o.category : "";
      if (index < 0 || index >= count) continue;
      if (!known.has(roomLabel) || !cats.has(category)) continue;
      out.push({ index, roomLabel, category: category as PhotoCategory });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Classify + reorder a project's photos. Returns the number of photos that
 * received an AI label. Photos the user already labeled are left untouched.
 */
export async function inferRoomOrder(params: {
  organizationId: string;
  projectId: string;
}): Promise<{ classified: number; reordered: boolean }> {
  const env = loadEnv();
  const photos = await prisma.listingPhoto.findMany({
    where: { projectId: params.projectId, isExcluded: false },
    orderBy: { order: "asc" },
    include: { asset: { select: { storageKey: true, storageDriver: true } } },
  });
  if (photos.length === 0) return { classified: 0, reordered: false };

  const unlabeled = photos.filter((p) => !p.roomLabel);
  let classified = 0;
  if (unlabeled.length > 0 && env.OPENAI_API_KEY) {
    try {
      const storage = getStorage();
      // Downscaled thumbnails keep the request small; composition is enough.
      const images = await Promise.all(
        unlabeled.map(async (p) => {
          const data = await storage.get(p.asset.storageKey);
          return data.toString("base64");
        }),
      );
      const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: VISION_MODEL,
          max_tokens: 800,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                `You label real-estate listing photos. For EACH numbered image pick the best ` +
                `roomLabel from exactly this list: ${ROOM_LABELS.join(", ")}. ` +
                `And the best category from: ${PHOTO_CATEGORIES.join(", ")}. ` +
                `Respond ONLY with a JSON array like ` +
                `[{"index":0,"roomLabel":"Kitchen","category":"interior"}] with one entry per image.`,
            },
            {
              role: "user",
              content: unlabeled.flatMap((p, i) => [
                { type: "text", text: `Image ${i}:` },
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${images[i]}`, detail: "low" },
                },
              ]),
            },
          ],
        }),
        ...(process.env.HTTPS_PROXY ? { dispatcher: await proxyDispatcher() } : {}),
      } as RequestInit);
      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const verdicts = parseClassifications(
          data.choices?.[0]?.message?.content ?? "",
          unlabeled.length,
        );
        for (const v of verdicts) {
          const photo = unlabeled[v.index];
          if (!photo) continue;
          await prisma.listingPhoto.update({
            where: { id: photo.id },
            data: { roomLabel: v.roomLabel, category: v.category },
          });
          classified += 1;
        }
      } else {
        log.warn({ status: res.status }, "vision classify failed; keeping upload order");
      }
    } catch (err) {
      log.warn({ err }, "vision classify errored; keeping upload order");
    }
  }

  // Reorder with fresh labels through the existing tour-flow heuristic.
  const fresh = await prisma.listingPhoto.findMany({
    where: { projectId: params.projectId },
    orderBy: { order: "asc" },
  });
  const ordered = recommendOrder(
    fresh.map((p) => ({
      id: p.id,
      order: p.order,
      category: p.category,
      roomLabel: p.roomLabel,
      note: p.note,
      isExcluded: p.isExcluded,
      isStaged: p.isStaged,
      isAiEnhanced: p.isAiEnhanced,
    })),
  );
  let reordered = false;
  for (let i = 0; i < ordered.length; i++) {
    const photo = fresh.find((p) => p.id === ordered[i]);
    if (photo && photo.order !== i) {
      await prisma.listingPhoto.update({ where: { id: photo.id }, data: { order: i } });
      reordered = true;
    }
  }
  return { classified, reordered };
}
