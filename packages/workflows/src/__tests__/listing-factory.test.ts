import { describe, expect, it } from "vitest";
import { buildSrt, computeSceneTimings, wrapCaption } from "../listing-factory/captions";
import { normalizeScript } from "../listing-factory/script";
import { recommendOrder } from "../listing-factory/sequence";
import { getTemplate, VIDEO_TEMPLATES } from "../listing-factory/templates";
import {
  listingOptionsSchema,
  listingPropertySchema,
  listingScriptSchema,
  renderSettingsSchema,
  type PhotoInfo,
} from "../listing-factory/types";
import { validateScript } from "../listing-factory/validation";

const property = listingPropertySchema.parse({
  address: "12 Maple St, Pittsburgh, PA",
  price: "$459,000",
  beds: "3",
  baths: "2",
  description: "Renovated kitchen with quartz counters.",
});

const script = (overrides: Partial<{ hook: string; narration: string; caption: string; outro: string; cta: string }> = {}) =>
  listingScriptSchema.parse({
    hook: overrides.hook ?? "Here is what $459,000 gets you in Pittsburgh.",
    scenes: [
      {
        photoId: "p1",
        narration: overrides.narration ?? "The living room gets great afternoon light.",
        caption: overrides.caption ?? "Bright living room",
      },
    ],
    outro: overrides.outro ?? "This one will move quickly.",
    cta: overrides.cta ?? "Reach out for a private tour.",
  });

describe("fair-housing validation", () => {
  it("passes clean, property-focused copy", () => {
    expect(validateScript(script(), property)).toHaveLength(0);
  });

  it.each([
    "Perfect for young families starting out.",
    "A very family-friendly block.",
    "Safe neighborhood with great energy.",
    "An exclusive community of just eight homes.",
    "Christian community nearby.",
  ])("flags %j", (text) => {
    const warnings = validateScript(script({ narration: text }), property);
    expect(warnings.some((w) => w.kind === "fair-housing")).toBe(true);
    expect(warnings[0]!.sceneIndex).toBe(0);
  });

  it("flags hook/outro/cta with sceneIndex -1", () => {
    const warnings = validateScript(script({ hook: "Ideal for singles!" }), property);
    expect(warnings.some((w) => w.kind === "fair-housing" && w.sceneIndex === -1)).toBe(true);
  });
});

describe("unsupported-claim validation", () => {
  it.each([
    "Best school district in the county.",
    "A guaranteed investment for your future.",
    "An up-and-coming neighborhood.",
  ])("always flags %j", (text) => {
    const warnings = validateScript(script({ narration: text }), property);
    expect(warnings.some((w) => w.kind === "unsupported-claim")).toBe(true);
  });

  it("allows renovation claims the listing facts support", () => {
    const warnings = validateScript(
      script({ narration: "The recently renovated kitchen has quartz counters." }),
      property,
    );
    expect(warnings.filter((w) => w.kind === "unsupported-claim")).toHaveLength(0);
  });

  it("flags renovation claims without support", () => {
    const bare = listingPropertySchema.parse({ address: "1 Elm St" });
    const warnings = validateScript(script({ narration: "Recently renovated top to bottom." }), bare);
    expect(warnings.some((w) => w.kind === "unsupported-claim")).toBe(true);
  });

  it("flags square footage that was never provided", () => {
    const bare = listingPropertySchema.parse({ address: "1 Elm St" });
    const warnings = validateScript(script({ narration: "A sprawling 2400 sq ft layout." }), bare);
    expect(warnings.some((w) => w.matched.includes("2400"))).toBe(true);
  });

  it("allows walking distance when the listing says walkable", () => {
    const walkable = listingPropertySchema.parse({
      address: "1 Elm St",
      description: "Walking distance to the park.",
    });
    const warnings = validateScript(
      script({ narration: "Walking distance to the park." }),
      walkable,
    );
    expect(warnings.filter((w) => w.kind === "unsupported-claim")).toHaveLength(0);
  });
});

describe("sequencing engine", () => {
  const photo = (id: string, order: number, extra: Partial<PhotoInfo> = {}): PhotoInfo => ({
    id,
    order,
    category: "interior",
    roomLabel: null,
    note: null,
    isExcluded: false,
    isStaged: false,
    isAiEnhanced: false,
    ...extra,
  });

  it("orders the classic tour: exterior → living → kitchen → bedroom → outdoor", () => {
    const order = recommendOrder([
      photo("bed", 0, { roomLabel: "Primary bedroom" }),
      photo("yard", 1, { roomLabel: "Backyard" }),
      photo("ext", 2, { category: "exterior", roomLabel: "Exterior" }),
      photo("kitchen", 3, { roomLabel: "Kitchen" }),
      photo("living", 4, { roomLabel: "Living room" }),
    ]);
    expect(order).toEqual(["ext", "living", "kitchen", "bed", "yard"]);
  });

  it("keeps manual order between unlabeled photos and drops excluded ones", () => {
    const order = recommendOrder([
      photo("a", 0),
      photo("b", 1, { isExcluded: true }),
      photo("c", 2),
    ]);
    expect(order).toEqual(["a", "c"]);
  });

  it("moves a second exterior to the end as the closing hero shot", () => {
    const order = recommendOrder([
      photo("ext1", 0, { category: "exterior" }),
      photo("ext2", 1, { category: "exterior" }),
      photo("living", 2, { roomLabel: "Living room" }),
      photo("kitchen", 3, { roomLabel: "Kitchen" }),
    ]);
    expect(order[0]).toBe("ext1");
    expect(order[order.length - 1]).toBe("ext2");
  });
});

describe("captions & timings", () => {
  it("wraps to at most two lines and ellipsizes overflow", () => {
    const lines = wrapCaption(
      "An extremely long caption that cannot possibly fit into two small caption lines at all",
      20,
    );
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(21);
  });

  it("keeps short captions on one line", () => {
    expect(wrapCaption("Bright kitchen", 26)).toEqual(["Bright kitchen"]);
  });

  it("stretches scenes to fit narration and never cuts it", () => {
    const template = getTemplate("fast-social");
    const { timings } = computeSceneTimings({
      sceneCount: 2,
      template,
      targetSeconds: 30,
      narrationSeconds: [9, 1],
    });
    // 9s narration exceeds the 5s template max → scene grows to fit.
    expect(timings[0]!.duration).toBeGreaterThanOrEqual(9);
    expect(timings[1]!.duration).toBeGreaterThanOrEqual(template.minSceneSeconds);
  });

  it("appends the outro card scene and accounts for crossfade overlap", () => {
    const template = getTemplate("clean-professional");
    const { timings, totalSeconds } = computeSceneTimings({
      sceneCount: 3,
      template,
      targetSeconds: 30,
      outroSeconds: 3.6,
    });
    expect(timings).toHaveLength(4);
    const sum = timings.reduce((acc, t) => acc + t.duration, 0);
    expect(totalSeconds).toBeCloseTo(sum - 3 * template.transitionSeconds, 5);
  });

  it("builds valid SRT with millisecond stamps", () => {
    const srt = buildSrt([
      { text: "Welcome to Maple Street.", start: 0.15, end: 3.4 },
      { text: "", start: 4, end: 5 },
      { text: "Reach out for a tour.", start: 61.5, end: 64 },
    ]);
    expect(srt).toContain("00:00:00,150 --> 00:00:03,400");
    expect(srt).toContain("00:01:01,500");
    expect(srt.split("\n\n").filter(Boolean)).toHaveLength(2); // empty entry dropped
  });
});

describe("templates", () => {
  it("every template is renderable data", () => {
    for (const t of Object.values(VIDEO_TEMPLATES)) {
      expect(t.minSceneSeconds).toBeLessThan(t.maxSceneSeconds);
      expect(t.transitions.length).toBeGreaterThan(0);
      expect(t.motion.length).toBeGreaterThan(0);
      expect(t.musicVolume).toBeGreaterThan(0);
      expect(t.musicVolume).toBeLessThanOrEqual(0.5);
    }
  });

  it("falls back to fast-social for unknown keys", () => {
    expect(getTemplate("nope").key).toBe("fast-social");
  });
});

describe("script normalization", () => {
  it("repairs unknown photoIds positionally and pads missing scenes", () => {
    const normalized = normalizeScript(
      {
        hook: "h",
        scenes: [
          { photoId: "made-up", narration: "a", caption: "a" },
          { photoId: "real-2", narration: "b", caption: "b" },
        ],
        outro: "o",
        cta: "c",
      },
      ["real-1", "real-2", "real-3"],
    );
    expect(normalized.scenes.map((s) => s.photoId)).toEqual(["real-1", "real-2", "real-3"]);
    expect(normalized.scenes[2]!.narration).toBe("");
  });

  it("drops extra scenes beyond the photo count", () => {
    const normalized = normalizeScript(
      {
        hook: "h",
        scenes: [
          { photoId: "p1", narration: "a", caption: "a" },
          { photoId: "p1", narration: "b", caption: "b" },
        ],
        outro: "o",
        cta: "c",
      },
      ["p1"],
    );
    expect(normalized.scenes).toHaveLength(1);
  });
});

describe("render settings schema", () => {
  it("round-trips a full snapshot", () => {
    const settings = renderSettingsSchema.parse({
      kind: "final",
      format: "vertical",
      style: "luxury-cinematic",
      options: listingOptionsSchema.parse({}),
      property,
      script: script(),
      photoIds: ["p1"],
      overlays: [{ assetId: "a1", role: "caption", sceneIndex: 0 }],
    });
    expect(settings.options.targetSeconds).toBe(40);
    expect(settings.overlays[0]!.role).toBe("caption");
  });

  it("rejects an empty photo list", () => {
    expect(() =>
      renderSettingsSchema.parse({
        kind: "preview",
        format: "vertical",
        style: "fast-social",
        options: listingOptionsSchema.parse({}),
        property,
        script: script(),
        photoIds: [],
      }),
    ).toThrow();
  });
});
