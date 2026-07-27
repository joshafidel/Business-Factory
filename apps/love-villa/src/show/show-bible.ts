import path from "node:path";
import { showBibleSchema, type ShowBible } from "../ai/schemas";
import { DATA_DIR } from "../config";
import { readJsonIfExists, writeJson, writeText } from "../utils/fs";

const FILE = path.join(DATA_DIR, "show-state", "show-bible.json");

export function loadShowBible(): ShowBible {
  const raw = readJsonIfExists<unknown>(FILE);
  if (!raw) throw new Error(`No show bible at ${FILE}. Run: npm run setup-show`);
  return showBibleSchema.parse(raw);
}

export function saveShowBible(bible: ShowBible): void {
  writeJson(FILE, showBibleSchema.parse(bible));
  writeText(path.join(DATA_DIR, "show-state", "SHOW-BIBLE.md"), bibleMarkdown(bible));
}

function bibleMarkdown(b: ShowBible): string {
  return `# ${b.title} — Show Bible

**Logline.** ${b.logline}

**Tone.** ${b.tone.join(" · ")}

**Visual style.** ${b.visualStyle}

## Episode format (${b.format.durationSeconds.min}–${b.format.durationSeconds.max}s vertical)

${b.format.structure.map((s) => `- **${s.beat}** (${s.window}): ${s.rule}`).join("\n")}

## Writing rules

${b.writingRules.map((r) => `- ${r}`).join("\n")}

## Safety rules

${b.safetyRules.map((r) => `- ${r}`).join("\n")}

## Brand safety (original property)

${b.brandSafetyRules.map((r) => `- ${r}`).join("\n")}

Banned phrases (validated on every script): ${b.bannedPhrases.map((p) => `"${p}"`).join(", ")}

## ${b.villa.name} — ${b.villa.island}

${b.villa.description}

${b.villa.locations.map((l) => `- **${l.name}** (\`${l.id}\`, ${l.timeOfDay}): ${l.description}`).join("\n")}
`;
}
