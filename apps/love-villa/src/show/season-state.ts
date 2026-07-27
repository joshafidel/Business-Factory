import path from "node:path";
import {
  seasonArcSchema,
  seasonStateSchema,
  type Character,
  type ContinuityUpdate,
  type SeasonArc,
  type SeasonState,
} from "../ai/schemas";
import { DATA_DIR } from "../config";
import { readJsonIfExists, writeJson } from "../utils/fs";

const STATE_FILE = path.join(DATA_DIR, "show-state", "season-state.json");
const ARC_FILE = path.join(DATA_DIR, "show-state", "season-arc.json");

export function initialSeasonState(cast: Character[]): SeasonState {
  const attraction: Record<string, number> = {};
  for (const c of cast) {
    if (c.initialAttraction && c.initialAttraction !== "none") {
      attraction[`${c.id}->${c.initialAttraction}`] = 6;
    }
  }
  return {
    season: 1,
    currentEpisode: 0,
    cast: cast.filter((c) => c.id !== "alejandro-spain").map((c) => c.id),
    eliminated: [],
    couples: [],
    attraction,
    rivalries: [],
    alliances: [],
    secretsRevealed: [],
    secretsUnrevealed: cast.map((c) => `${c.id}: ${c.secret}`),
    previousEpisodeSummary: "Season premiere — nothing has happened yet. Everything is about to.",
    unresolvedStorylines: [],
    viewerDecisions: [],
    popularity: Object.fromEntries(cast.map((c) => [c.id, 50])),
    continuityNotes: [],
  };
}

export function loadSeasonState(): SeasonState {
  const raw = readJsonIfExists<unknown>(STATE_FILE);
  if (!raw) throw new Error(`No season state at ${STATE_FILE}. Run: npm run setup-show`);
  return seasonStateSchema.parse(raw);
}

export function saveSeasonState(state: SeasonState): void {
  writeJson(STATE_FILE, seasonStateSchema.parse(state));
}

export function loadSeasonArc(): SeasonArc {
  const raw = readJsonIfExists<unknown>(ARC_FILE);
  if (!raw) throw new Error(`No season arc at ${ARC_FILE}. Run: npm run generate-season`);
  return seasonArcSchema.parse(raw);
}

export function saveSeasonArc(arc: SeasonArc): void {
  writeJson(ARC_FILE, seasonArcSchema.parse(arc));
}

/** Apply an episode's continuity update to the season state (idempotent-ish). */
export function applyContinuityUpdate(state: SeasonState, update: ContinuityUpdate): SeasonState {
  const next: SeasonState = structuredClone(state);
  next.currentEpisode = Math.max(next.currentEpisode, update.episode);
  next.previousEpisodeSummary = update.summary;

  for (const id of update.arrivals) {
    if (!next.cast.includes(id)) next.cast.push(id);
    if (!(id in next.popularity)) next.popularity[id] = 55;
  }
  for (const id of update.eliminations) {
    next.cast = next.cast.filter((c) => c !== id);
    if (!next.eliminated.includes(id)) next.eliminated.push(id);
  }
  for (const couple of update.newCouples) {
    if (!next.couples.some((c) => c.a === couple.a && c.b === couple.b)) {
      next.couples.push({ ...couple, since: update.episode });
    }
  }
  next.couples = next.couples.filter(
    (c) => !update.brokenCouples.some((b) => b.a === c.a && b.b === c.b),
  );
  for (const ch of update.attractionChanges) {
    next.attraction[`${ch.from}->${ch.to}`] = ch.value;
  }
  for (const r of update.newRivalries) {
    if (!next.rivalries.some((x) => x.a === r.a && x.b === r.b)) next.rivalries.push(r);
  }
  for (const a of update.newAlliances) next.alliances.push(a);
  for (const s of update.secretsRevealed) {
    if (!next.secretsRevealed.includes(s)) next.secretsRevealed.push(s);
    next.secretsUnrevealed = next.secretsUnrevealed.filter(
      (u) => u.split(":")[0] !== s.split(":")[0],
    );
  }
  next.unresolvedStorylines = [
    ...next.unresolvedStorylines.filter((u) => !update.unresolvedStorylines.includes(u)),
    ...update.unresolvedStorylines,
  ].slice(-12);
  next.continuityNotes = [...next.continuityNotes, ...update.continuityNotes].slice(-30);
  return seasonStateSchema.parse(next);
}
