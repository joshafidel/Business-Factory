import { type Character, type VillaLocation } from "../../ai/schemas";
import { mulberry32 } from "../../utils/wav";
import { type GeneratedAsset, type ImageProvider, type ImageRequest } from "../types";

/**
 * Mock art department: deterministic parametric SVG. Characters get stylized
 * transparent-background "cutout" busts keyed to their locked palette + seed;
 * locations get full vertical backgrounds. The same palettes anchor the real
 * image prompts, so swapping in a live provider keeps the show's look.
 */

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v + amount)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Transparent-background character bust, 800x1000 viewBox. */
export function characterCutoutSvg(c: Character): string {
  const rand = mulberry32(c.imageSeed);
  const { skin, hair, outfit, accent } = c.palette;
  const hairStyle = c.imageSeed % 4;
  const isWoman = c.gender === "woman";
  const browTilt = 4 + Math.floor(rand() * 6);
  const smile = 26 + Math.floor(rand() * 16);

  const hairPaths: string[] = [];
  if (hairStyle === 0) {
    // Short crop / cap-like
    hairPaths.push(
      `<path d="M 250 330 Q 250 150 400 150 Q 550 150 550 330 L 550 300 Q 545 210 400 205 Q 255 210 250 300 Z" fill="${hair}"/>`,
    );
  } else if (hairStyle === 1) {
    // Curls
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI;
      const x = 400 - Math.cos(a) * 150;
      const y = 240 - Math.sin(a) * 95;
      hairPaths.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="52" fill="${hair}"/>`);
    }
  } else if (hairStyle === 2) {
    // Bob
    hairPaths.push(
      `<path d="M 240 420 Q 230 140 400 140 Q 570 140 560 420 L 500 420 Q 520 240 400 230 Q 280 240 300 420 Z" fill="${hair}"/>`,
    );
  } else {
    // Ponytail / braid crown
    hairPaths.push(
      `<path d="M 255 320 Q 260 150 400 150 Q 540 150 545 320 L 545 290 Q 540 205 400 200 Q 260 205 255 290 Z" fill="${hair}"/>`,
      `<ellipse cx="560" cy="330" rx="42" ry="110" fill="${shade(hair, -20)}" transform="rotate(12 560 330)"/>`,
    );
  }

  const outfitShape = isWoman
    ? `<path d="M 220 1000 L 235 760 Q 250 640 400 630 Q 550 640 565 760 L 580 1000 Z" fill="${outfit}"/>` +
      `<path d="M 320 640 L 400 730 L 480 640 Q 440 620 400 620 Q 360 620 320 640 Z" fill="${shade(outfit, -30)}"/>`
    : `<path d="M 200 1000 L 220 750 Q 240 640 400 630 Q 560 640 580 750 L 600 1000 Z" fill="${outfit}"/>` +
      `<path d="M 340 635 L 400 760 L 460 635 L 430 625 L 400 700 L 370 625 Z" fill="${shade(outfit, 35)}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">
  <defs>
    <radialGradient id="glow-${c.imageSeed}" cx="0.35" cy="0.3">
      <stop offset="0%" stop-color="${shade(skin, 26)}"/>
      <stop offset="100%" stop-color="${skin}"/>
    </radialGradient>
  </defs>
  <!-- neck + shoulders -->
  <rect x="356" y="480" width="88" height="150" rx="34" fill="${shade(skin, -14)}"/>
  ${outfitShape}
  <!-- accent: necklace / chain -->
  <path d="M 340 660 Q 400 710 460 660" stroke="${accent}" stroke-width="10" fill="none" stroke-linecap="round"/>
  <!-- head -->
  <ellipse cx="400" cy="350" rx="150" ry="175" fill="url(#glow-${c.imageSeed})"/>
  <!-- ears -->
  <circle cx="252" cy="360" r="26" fill="${skin}"/>
  <circle cx="548" cy="360" r="26" fill="${skin}"/>
  ${hairPaths.join("\n  ")}
  <!-- brows -->
  <path d="M 315 315 q 30 -${browTilt + 8} 60 0" stroke="${shade(hair, -30)}" stroke-width="11" fill="none" stroke-linecap="round"/>
  <path d="M 425 315 q 30 -${browTilt + 8} 60 0" stroke="${shade(hair, -30)}" stroke-width="11" fill="none" stroke-linecap="round"/>
  <!-- eyes: big expressive -->
  <g>
    <ellipse cx="348" cy="368" rx="30" ry="36" fill="#ffffff"/>
    <ellipse cx="452" cy="368" rx="30" ry="36" fill="#ffffff"/>
    <circle cx="352" cy="374" r="15" fill="#33261f"/>
    <circle cx="456" cy="374" r="15" fill="#33261f"/>
    <circle cx="357" cy="368" r="5" fill="#ffffff"/>
    <circle cx="461" cy="368" r="5" fill="#ffffff"/>
  </g>
  <!-- nose + smile -->
  <path d="M 398 400 q 8 22 -4 34" stroke="${shade(skin, -40)}" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M ${400 - smile} 462 Q 400 ${470 + smile} ${400 + smile} 462" stroke="#8c3b34" stroke-width="10" fill="none" stroke-linecap="round"/>
  ${isWoman ? `<ellipse cx="316" cy="428" rx="18" ry="10" fill="${shade(skin, 30)}" opacity="0.6"/><ellipse cx="484" cy="428" rx="18" ry="10" fill="${shade(skin, 30)}" opacity="0.6"/>` : ""}
</svg>`;
}

/** Full 1080x1920 location background. */
export function locationBackgroundSvg(loc: VillaLocation): string {
  const { sky, mid, ground, accent } = loc.palette;
  const rand = mulberry32(loc.imageSeed);
  const stars =
    loc.timeOfDay === "night"
      ? Array.from({ length: 40 })
          .map(() => {
            const x = Math.floor(rand() * 1080);
            const y = Math.floor(rand() * 700);
            return `<circle cx="${x}" cy="${y}" r="${(1 + rand() * 2).toFixed(1)}" fill="#fff" opacity="${(0.4 + rand() * 0.6).toFixed(2)}"/>`;
          })
          .join("")
      : "";
  const sun =
    loc.timeOfDay === "day"
      ? `<circle cx="850" cy="240" r="110" fill="#fff3c2" opacity="0.9"/>`
      : loc.timeOfDay === "sunset"
        ? `<circle cx="540" cy="620" r="170" fill="#ffd98a" opacity="0.85"/>`
        : `<circle cx="820" cy="220" r="70" fill="#f4f0e0" opacity="0.9"/>`;

  const extras: Record<string, string> = {
    pool: `<rect x="0" y="1150" width="1080" height="520" rx="60" fill="#2fb8cc"/>
      <path d="M 0 1230 Q 270 1200 540 1230 T 1080 1230" stroke="#7fe3ef" stroke-width="14" fill="none" opacity="0.7"/>
      <path d="M 0 1370 Q 270 1340 540 1370 T 1080 1370" stroke="#7fe3ef" stroke-width="12" fill="none" opacity="0.5"/>
      <rect x="90" y="1010" width="260" height="70" rx="30" fill="${accent}"/>
      <rect x="730" y="1010" width="260" height="70" rx="30" fill="${accent}"/>`,
    firepit: `<circle cx="540" cy="1430" r="200" fill="${shade(ground, -25)}"/>
      <circle cx="540" cy="1430" r="120" fill="#3a2418"/>
      <path d="M 540 1310 q 55 70 0 150 q -55 -80 0 -150" fill="#ffb347"/>
      <path d="M 540 1345 q 32 45 0 105 q -32 -50 0 -105" fill="#ff6b35"/>
      <rect x="140" y="1280" width="180" height="90" rx="40" fill="${accent}" opacity="0.9"/>
      <rect x="760" y="1280" width="180" height="90" rx="40" fill="${accent}" opacity="0.9"/>`,
    kitchen: `<rect x="0" y="1180" width="1080" height="740" fill="${shade(ground, 25)}"/>
      <rect x="60" y="1120" width="960" height="140" rx="24" fill="#e8e2d6"/>
      <rect x="60" y="1260" width="960" height="60" fill="${shade(ground, -20)}"/>
      <circle cx="300" cy="980" r="46" fill="${accent}"/>
      <circle cx="440" cy="950" r="40" fill="${shade(accent, 25)}"/>
      <circle cx="580" cy="980" r="46" fill="${accent}"/>
      <ellipse cx="820" cy="1180" rx="120" ry="34" fill="#f2d340"/>`,
    bedroom: `<rect x="70" y="1240" width="420" height="220" rx="26" fill="${accent}"/>
      <rect x="70" y="1180" width="420" height="90" rx="26" fill="#fff"/>
      <rect x="590" y="1240" width="420" height="220" rx="26" fill="${accent}"/>
      <rect x="590" y="1180" width="420" height="90" rx="26" fill="#fff"/>
      <circle cx="540" cy="820" r="60" fill="#f7edc8" opacity="0.9"/>`,
    confessional: `<rect x="90" y="1100" width="900" height="700" rx="70" fill="${shade(mid, -18)}"/>
      <path d="M 540 560 C 460 460 300 500 300 620 C 300 730 460 800 540 860 C 620 800 780 730 780 620 C 780 500 620 460 540 560 Z"
        fill="none" stroke="${accent}" stroke-width="22" opacity="0.95"/>
      <ellipse cx="540" cy="1560" rx="330" ry="180" fill="${shade(accent, -60)}" opacity="0.55"/>`,
    terrace: `<rect x="0" y="1240" width="1080" height="680" fill="${shade(ground, 12)}"/>
      ${Array.from({ length: 14 })
        .map(() => {
          const x = Math.floor(rand() * 1080);
          const y = 300 + Math.floor(rand() * 520);
          return `<circle cx="${x}" cy="${y}" r="${14 + rand() * 16}" fill="${accent}" opacity="0.85"/>`;
        })
        .join("")}
      <rect x="120" y="1300" width="240" height="150" rx="40" fill="${shade(ground, -22)}"/>
      <rect x="720" y="1300" width="240" height="150" rx="40" fill="${shade(ground, -22)}"/>`,
    walkway: `<path d="M 380 1920 L 470 1080 L 610 1080 L 700 1920 Z" fill="${shade(ground, 18)}"/>
      ${[0, 1, 2, 3]
        .map((i) => {
          const y = 1180 + i * 180;
          const off = 150 + i * 60;
          return `<rect x="${430 - off}" y="${y}" width="16" height="150" fill="#5a4632"/>
            <path d="M ${438 - off} ${y - 40} q 26 34 0 66 q -26 -36 0 -66" fill="#ffb347"/>
            <rect x="${634 + off - 16}" y="${y}" width="16" height="150" fill="#5a4632"/>
            <path d="M ${642 + off - 16} ${y - 40} q 26 34 0 66 q -26 -36 0 -66" fill="#ffb347"/>`;
        })
        .join("")}`,
  };

  // Palm silhouettes for outdoor daytime/sunset scenes.
  const palms =
    loc.id === "pool" || loc.id === "terrace" || loc.id === "walkway"
      ? `<g fill="${shade(mid, -35)}" opacity="0.9">
      <path d="M 120 1150 q 18 -220 10 -320 q 60 40 130 30 q -80 -60 -90 -110 q 90 30 150 -10 q -110 -30 -150 -80 q -40 50 -150 80 q 60 40 150 10 q -10 50 -90 110 q 70 10 130 -30 q -8 100 10 320 Z" transform="translate(-40 0) scale(0.9)"/>
      <path d="M 980 1150 q 18 -220 10 -320 q 60 40 130 30 q -80 -60 -90 -110 q 90 30 150 -10 q -110 -30 -150 -80 q -40 50 -150 80 q 60 40 150 10 q -10 50 -90 110 q 70 10 130 -30 q -8 100 10 320 Z" transform="translate(20 0) scale(0.9)"/>
    </g>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="sky-${loc.imageSeed}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${sky}"/>
      <stop offset="55%" stop-color="${mid}"/>
      <stop offset="100%" stop-color="${ground}"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#sky-${loc.imageSeed})"/>
  ${stars}
  ${sun}
  <!-- villa arches on the horizon -->
  <g fill="${shade(mid, 30)}" opacity="0.75">
    <rect x="80" y="880" width="920" height="260" rx="30"/>
    <path d="M 180 1140 v -130 a 70 70 0 0 1 140 0 v 130 Z" fill="${shade(mid, -12)}"/>
    <path d="M 470 1140 v -130 a 70 70 0 0 1 140 0 v 130 Z" fill="${shade(mid, -12)}"/>
    <path d="M 760 1140 v -130 a 70 70 0 0 1 140 0 v 130 Z" fill="${shade(mid, -12)}"/>
  </g>
  ${palms}
  ${extras[loc.id] ?? ""}
</svg>`;
}

export class MockImageProvider implements ImageProvider {
  readonly key = "mock-svg";
  readonly mode = "mock" as const;

  async generateImage(_req: ImageRequest): Promise<GeneratedAsset> {
    throw new Error(
      "MockImageProvider generates character/location art via characterCutoutSvg/locationBackgroundSvg — " +
        "generic prompt-to-image is only available with a live provider (set OPENAI_API_KEY).",
    );
  }
}
