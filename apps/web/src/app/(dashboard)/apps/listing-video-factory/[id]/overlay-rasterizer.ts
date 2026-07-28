import {
  type ListingOptions,
  type ListingProperty,
  type ListingScript,
} from "@bf/workflows/src/listing-factory/types";

/**
 * Client-side overlay rasterizer. All video typography (captions, the
 * property-facts card, the agent outro card, the preview watermark) is drawn
 * on canvas in the browser at render time and uploaded as full-frame
 * transparent PNGs — the server's ffmpeg build has no text renderer, and
 * canvas gives pixel-perfect, font-safe results anyway.
 */

export interface RasterizedOverlay {
  role: "caption" | "facts" | "outro" | "watermark";
  sceneIndex?: number;
  blob: Blob;
}

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  return [canvas, ctx];
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}

/** measureText-based wrap: max 2 lines, ellipsized overflow. */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 2,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1]!;
    const joined = lines.join(" ") + current;
    if (joined.length < words.join(" ").length) {
      while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

function drawCaption(width: number, height: number, text: string): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(width, height);
  const base = Math.round(width / 20); // ≈54px at 1080
  ctx.font = `700 ${base}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, text, width * 0.84);
  if (lines.length === 0) return canvas;
  const lineHeight = base * 1.25;
  // Safe zone: captions sit at ~78% height — above platform UI chrome.
  const centerY = height * 0.8 - ((lines.length - 1) * lineHeight) / 2;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const padX = base * 0.7;
  const padY = base * 0.45;
  const boxW = widest + padX * 2;
  const boxH = lines.length * lineHeight + padY * 2;
  const blockTop = centerY - lineHeight / 2;
  ctx.fillStyle = "rgba(12, 14, 18, 0.62)";
  ctx.beginPath();
  ctx.roundRect((width - boxW) / 2, blockTop - padY, boxW, boxH, base * 0.35);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = base * 0.15;
  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, centerY + i * lineHeight);
  });
  return canvas;
}

function drawFactsCard(
  width: number,
  height: number,
  property: ListingProperty,
  options: ListingOptions,
): HTMLCanvasElement | null {
  const [canvas, ctx] = makeCanvas(width, height);
  const rows: string[] = [];
  if (options.showAddress && property.address) rows.push(property.address);
  if (options.showPrice && property.price) rows.push(property.price);
  const chips = [
    property.beds && `${property.beds} bd`,
    property.baths && `${property.baths} ba`,
    property.sqft && `${property.sqft} sqft`,
  ].filter(Boolean) as string[];
  if (rows.length === 0 && chips.length === 0) return null;

  const base = Math.round(width / 24);
  const cardW = width * 0.84;
  const lineHeights = [base * 1.1, base * 1.9, base * 1.4];
  const cardH =
    base * 1.6 + (rows[0] ? lineHeights[0]! + base * 0.5 : 0) + (rows[1] ? lineHeights[1]! : 0) + (chips.length ? lineHeights[2]! : 0);
  const x = (width - cardW) / 2;
  const y = height * 0.34 - cardH / 2;
  ctx.fillStyle = "rgba(12, 14, 18, 0.68)";
  ctx.beginPath();
  ctx.roundRect(x, y, cardW, cardH, base * 0.5);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let cursor = y + base * 0.8;
  if (rows[0]) {
    ctx.font = `500 ${base}px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(rows[0], width / 2, cursor, cardW * 0.92);
    cursor += lineHeights[0]! + base * 0.5;
  }
  if (rows[1]) {
    ctx.font = `800 ${base * 1.6}px ${FONT}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(rows[1], width / 2, cursor, cardW * 0.92);
    cursor += lineHeights[1]!;
  }
  if (chips.length) {
    ctx.font = `600 ${base * 0.9}px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(chips.join("   ·   "), width / 2, cursor, cardW * 0.92);
  }
  return canvas;
}

function drawOutroCard(
  width: number,
  height: number,
  property: ListingProperty,
  script: ListingScript,
): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(width, height);
  ctx.fillStyle = "rgba(10, 12, 16, 0.82)";
  ctx.fillRect(0, 0, width, height);
  const base = Math.round(width / 22);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines: { text: string; font: string; color: string; gap: number }[] = [];
  const cta = script.cta || property.callToAction;
  if (cta) lines.push({ text: cta, font: `700 ${base * 1.15}px ${FONT}`, color: "#ffffff", gap: base * 2.2 });
  if (property.agentName)
    lines.push({ text: property.agentName, font: `700 ${base}px ${FONT}`, color: "#ffffff", gap: base * 1.6 });
  if (property.brokerage)
    lines.push({ text: property.brokerage, font: `500 ${base * 0.8}px ${FONT}`, color: "rgba(255,255,255,0.8)", gap: base * 1.3 });
  const contact = [property.agentPhone, property.agentEmail].filter(Boolean).join("  ·  ");
  if (contact)
    lines.push({ text: contact, font: `500 ${base * 0.75}px ${FONT}`, color: "rgba(255,255,255,0.85)", gap: base * 1.5 });
  if (property.address)
    lines.push({ text: property.address, font: `400 ${base * 0.65}px ${FONT}`, color: "rgba(255,255,255,0.6)", gap: base * 1.2 });
  const totalH = lines.reduce((acc, l) => acc + l.gap, 0);
  let cursor = height / 2 - totalH / 2;
  for (const line of lines) {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, width / 2, cursor, width * 0.86);
    cursor += line.gap;
  }
  return canvas;
}

function drawWatermark(width: number, height: number): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(width, height);
  const base = Math.round(width / 14);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 9);
  ctx.font = `800 ${base}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fillText("PREVIEW", 0, 0);
  ctx.font = `600 ${base * 0.35}px ${FONT}`;
  ctx.fillText("Listing Video Factory", 0, base * 0.75);
  ctx.restore();
  ctx.font = `600 ${Math.round(width / 42)}px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillText("PREVIEW", width - base * 0.4, height - base * 0.5);
  return canvas;
}

export async function rasterizeOverlays(params: {
  width: number;
  height: number;
  script: ListingScript;
  property: ListingProperty;
  options: ListingOptions;
  isPreview: boolean;
}): Promise<RasterizedOverlay[]> {
  const { width, height, script, property, options } = params;
  const overlays: RasterizedOverlay[] = [];
  if (options.captions) {
    for (let i = 0; i < script.scenes.length; i++) {
      const caption = i === 0 && !script.scenes[0]?.caption ? script.hook : script.scenes[i]?.caption;
      if (!caption?.trim()) continue;
      overlays.push({ role: "caption", sceneIndex: i, blob: await toBlob(drawCaption(width, height, caption)) });
    }
  }
  if (options.showPrice || options.showAddress) {
    const card = drawFactsCard(width, height, property, options);
    if (card) overlays.push({ role: "facts", blob: await toBlob(card) });
  }
  if (options.agentOutro) {
    overlays.push({ role: "outro", blob: await toBlob(drawOutroCard(width, height, property, script)) });
  }
  if (params.isPreview) {
    overlays.push({ role: "watermark", blob: await toBlob(drawWatermark(width, height)) });
  }
  return overlays;
}
