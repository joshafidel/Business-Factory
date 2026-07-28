import type { StorageAdapter } from "@bf/storage";
import { ZOO_CAST, createLogger } from "@bf/shared";
import type { ImageProvider, MediaResult } from "@bf/providers";

/**
 * Canonical character reference renders (Animation 2.0).
 *
 * Each cast member has ONE approved full-body reference render, generated
 * once and stored versioned. Every scene still is then an image EDIT
 * conditioned on the references of the characters present — the model
 * copies the actual pixels of the design instead of re-imagining it from a
 * text description. This is what keeps Ellie looking like Ellie across
 * shots, scenes, and episodes.
 *
 * Bump REF_VERSION only for a deliberate redesign.
 */
const REF_VERSION = 1;

const log = createLogger("zoo-cast-refs");

export function castRefKey(organizationId: string, name: string): string {
  return `${organizationId}/zoo-cast/ref-v${REF_VERSION}-${name.toLowerCase()}.png`;
}

export interface CastRefs {
  /** name (lowercase) → reference render bytes */
  images: Map<string, Buffer>;
  /** Micro-USD spent generating missing references this call. */
  costMicroUsd: bigint;
}

/**
 * Ensure every cast member has a canonical reference render; generate and
 * persist any that are missing. Idempotent — after the first episode this
 * only reads from storage.
 */
export async function ensureCastRefs(
  organizationId: string,
  storage: StorageAdapter,
  image: ImageProvider & {
    editImage?: (p: { prompt: string; references: Buffer[] }) => Promise<MediaResult>;
  },
): Promise<CastRefs> {
  const images = new Map<string, Buffer>();
  let cost = 0n;
  for (const member of ZOO_CAST) {
    const key = castRefKey(organizationId, member.name);
    if (await storage.exists(key)) {
      images.set(member.name.toLowerCase(), await storage.get(key));
      continue;
    }
    const prompt =
      `Character reference sheet render: ${member.look}. Full body, standing facing the camera, ` +
      "arms relaxed, gentle happy smile, glossy 3D toddler-animation style, soft studio lighting, " +
      "plain soft cream background, centered, whole character visible head to toe, no text, no props.";
    const r = await image.generateImage({ prompt });
    await storage.put(key, r.data, { contentType: "image/png" });
    images.set(member.name.toLowerCase(), r.data);
    cost += r.costMicroUsd;
    log.info({ character: member.name, key }, "generated canonical character reference");
  }
  return { images, costMicroUsd: cost };
}

/** Reference buffers for the named characters (order preserved, max 3). */
export function refsFor(refs: CastRefs, names: string[]): Buffer[] {
  const out: Buffer[] = [];
  for (const n of names.map((x) => x.toLowerCase().trim())) {
    const buf = refs.images.get(n);
    if (buf) out.push(buf);
    if (out.length >= 3) break;
  }
  return out;
}
