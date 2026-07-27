import path from "node:path";
import { castSchema, type Character } from "../ai/schemas";
import { DATA_DIR } from "../config";
import { readJsonIfExists, writeJson, writeText } from "../utils/fs";

/**
 * Cast persistence. The cast file is the single source of truth for character
 * identity: palettes, image seeds, voice configs, and look-lines are LOCKED
 * fields that keep visuals and voices consistent across every episode.
 */

const CAST_FILE = path.join(DATA_DIR, "characters", "cast.json");

export function loadCast(): Character[] {
  const raw = readJsonIfExists<unknown>(CAST_FILE);
  if (!raw) {
    throw new Error(`No cast found at ${CAST_FILE}. Run: npm run setup-show`);
  }
  return castSchema.parse(raw);
}

export function saveCast(cast: Character[]): void {
  writeJson(CAST_FILE, castSchema.parse(cast));
  for (const c of cast) {
    writeJson(path.join(DATA_DIR, "characters", `${c.id}.json`), c);
  }
  writeText(path.join(DATA_DIR, "characters", "CAST.md"), castMarkdown(cast));
}

export function characterById(cast: Character[], id: string): Character {
  const c = cast.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown character id: ${id}`);
  return c;
}

function castMarkdown(cast: Character[]): string {
  const rows = cast
    .map(
      (c) => `## ${c.fullName} — ${c.country} (${c.age})

- **Personality:** ${c.personality}
- **Dating strategy:** ${c.datingStrategy}
- **Strength:** ${c.strength}
- **Fatal flaw:** ${c.fatalFlaw}
- **Secret:** ${c.secret}
- **Romantic preference:** ${c.romanticPreference}
- **Rival:** ${c.rival}
- **Recurring joke:** ${c.recurringJoke}
- **Signature phrase:** "${c.signaturePhrase}"
- **Look (locked):** ${c.visualReference}
- **Voice:** ${c.voiceDescription} (${c.accentDirection})
`,
    )
    .join("\n");
  return `# Love Villa: Nations — Cast\n\nReview this file for the "characters" approval checkpoint.\n\n${rows}`;
}
