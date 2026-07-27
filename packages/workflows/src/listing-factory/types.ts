import { z } from "zod";

/**
 * Listing Video Factory domain types. Everything stored in the Json columns
 * of ListingProject / ListingRender is validated with these schemas on every
 * write (columns are untyped at rest).
 */

export const MODULE_KEY = "listing-video-factory";
export const RENDER_WORKFLOW_KEY = "listing-factory-render";
export const SCRIPT_AGENT_KEY = "lvf-script-agent";
export const SOCIAL_AGENT_KEY = "lvf-social-agent";

/** Hard product limits (cost control + serverless budgets). */
export const LIMITS = {
  maxPhotosPerProject: 50,
  maxRenderScenes: 20,
  maxPhotoBytes: 8 * 1024 * 1024,
  maxProjectSeconds: 180,
  maxRenderCostMicroUsd: 3_000_000n, // $3 hard stop per render run
} as const;

export const PHOTO_CATEGORIES = [
  "exterior",
  "interior",
  "amenity",
  "aerial",
  "floor_plan",
  "neighborhood",
  "branding",
] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

export const ROOM_LABELS = [
  "Exterior",
  "Entry",
  "Foyer",
  "Living room",
  "Dining room",
  "Kitchen",
  "Primary bedroom",
  "Bedroom",
  "Bathroom",
  "Office",
  "Basement",
  "Laundry",
  "Garage",
  "Patio",
  "Balcony",
  "Backyard",
  "Pool",
  "Gym",
  "Building amenities",
  "Neighborhood",
  "Floor plan",
] as const;

export const VIDEO_FORMATS = {
  vertical: { width: 1080, height: 1920, label: "Vertical 9:16 (TikTok / Reels / Shorts)" },
  landscape: { width: 1920, height: 1080, label: "Landscape 16:9 (YouTube / listing pages)" },
  square: { width: 1080, height: 1080, label: "Square 1:1 (feed posts)" },
} as const;
export type VideoFormatKey = keyof typeof VIDEO_FORMATS;

const trimmed = (max: number) => z.string().trim().max(max);

/** Property facts. Everything except the address is optional — the script
 *  generator only ever uses fields that are present. */
export const listingPropertySchema = z.object({
  address: trimmed(200).min(3, "Address is required"),
  city: trimmed(100).optional().default(""),
  state: trimmed(50).optional().default(""),
  neighborhood: trimmed(120).optional().default(""),
  propertyType: trimmed(60).optional().default(""),
  price: trimmed(40).optional().default(""),
  beds: trimmed(10).optional().default(""),
  baths: trimmed(10).optional().default(""),
  sqft: trimmed(20).optional().default(""),
  mlsNumber: trimmed(40).optional().default(""),
  listingUrl: trimmed(500).optional().default(""),
  description: trimmed(4000).optional().default(""),
  agentName: trimmed(120).optional().default(""),
  brokerage: trimmed(160).optional().default(""),
  agentPhone: trimmed(40).optional().default(""),
  agentEmail: trimmed(160).optional().default(""),
  callToAction: trimmed(200).optional().default(""),
});
export type ListingProperty = z.infer<typeof listingPropertySchema>;

export const listingOptionsSchema = z.object({
  voiceover: z.boolean().default(true),
  captions: z.boolean().default(true),
  music: z.boolean().default(true),
  showPrice: z.boolean().default(true),
  showAddress: z.boolean().default(true),
  agentOutro: z.boolean().default(true),
  targetSeconds: z.number().int().min(15).max(LIMITS.maxProjectSeconds).default(40),
  platform: z.enum(["tiktok", "instagram", "youtube", "listing-page"]).default("tiktok"),
});
export type ListingOptions = z.infer<typeof listingOptionsSchema>;

export const listingSceneSchema = z.object({
  /** ListingPhoto id this scene shows (falls back to index order). */
  photoId: z.string().default(""),
  narration: trimmed(500).default(""),
  caption: trimmed(120).default(""),
});
export type ListingScene = z.infer<typeof listingSceneSchema>;

export const listingScriptSchema = z.object({
  hook: trimmed(200).default(""),
  scenes: z.array(listingSceneSchema).min(1).max(LIMITS.maxRenderScenes),
  outro: trimmed(300).default(""),
  cta: trimmed(200).default(""),
});
export type ListingScript = z.infer<typeof listingScriptSchema>;

export const socialPackageSchema = z.object({
  tiktokCaption: trimmed(400).default(""),
  instagramCaption: trimmed(1200).default(""),
  youtubeTitle: trimmed(120).default(""),
  youtubeDescription: trimmed(3000).default(""),
  hashtags: z.array(trimmed(60)).max(15).default([]),
  coverText: trimmed(80).default(""),
});
export type SocialPackage = z.infer<typeof socialPackageSchema>;

/** Overlay PNGs rasterized by the browser at render time (this ffmpeg build
 *  has no drawtext, so all typography is client-rendered and composited). */
export const renderOverlaySchema = z.object({
  assetId: z.string(),
  role: z.enum(["caption", "facts", "outro", "watermark", "cover"]),
  /** Scene index the overlay belongs to (captions only). */
  sceneIndex: z.number().int().min(0).optional(),
});
export type RenderOverlay = z.infer<typeof renderOverlaySchema>;

/** Immutable snapshot stored on ListingRender.settings when a render starts. */
export const renderSettingsSchema = z.object({
  kind: z.enum(["preview", "final"]),
  format: z.enum(["vertical", "landscape", "square"]),
  style: z.string(),
  options: listingOptionsSchema,
  property: listingPropertySchema,
  script: listingScriptSchema,
  /** Ordered photo ids included in this render (excluded photos removed). */
  photoIds: z.array(z.string()).min(1),
  overlays: z.array(renderOverlaySchema).default([]),
});
export type RenderSettings = z.infer<typeof renderSettingsSchema>;

/** Photo fields the sequencing + script engines care about. */
export interface PhotoInfo {
  id: string;
  order: number;
  category: string;
  roomLabel: string | null;
  note: string | null;
  isExcluded: boolean;
  isStaged: boolean;
  isAiEnhanced: boolean;
}
