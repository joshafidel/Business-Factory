import { type Character, type EpisodeBeat, type SeasonState, type ShowBible } from "./schemas";

/**
 * Prompt builders for every Claude generation task. Each prompt embeds the
 * show bible's safety + brand rules so live generations honor the same
 * guardrails the validators enforce.
 */

export function guardrails(bible: ShowBible): string {
  return [
    "NON-NEGOTIABLE RULES:",
    ...bible.safetyRules.map((r) => `- ${r}`),
    ...bible.brandSafetyRules.map((r) => `- ${r}`),
    `- Never use any of these phrases: ${bible.bannedPhrases.join(", ")}`,
    ...bible.writingRules.map((r) => `- ${r}`),
  ].join("\n");
}

export function castSheet(cast: Character[]): string {
  return cast
    .map(
      (c) =>
        `${c.id} — ${c.fullName}, ${c.age}, ${c.country}. ${c.personality} ` +
        `Strength: ${c.strength} Flaw: ${c.fatalFlaw} Secret: ${c.secret} ` +
        `Signature: "${c.signaturePhrase}" Look: ${c.visualReference}`,
    )
    .join("\n");
}

export function refineCastPrompt(bible: ShowBible, seedCast: Character[]): string {
  return [
    `You are the head writer of "${bible.title}": ${bible.logline}`,
    guardrails(bible),
    "Refine and enrich this seed cast. Keep every id, country, age, gender, palette, imageSeed and",
    "voice config EXACTLY as given (they are locked for visual/voice consistency). Improve the prose",
    "fields (personality, jokes, voice patterns) to be funnier and more specific. Return the full cast.",
    "",
    JSON.stringify(seedCast),
  ].join("\n");
}

export function seasonPrompt(bible: ShowBible, cast: Character[], episodes: number): string {
  return [
    `You are the showrunner of "${bible.title}". Plan a connected ${episodes}-episode season arc.`,
    guardrails(bible),
    "Cast:",
    castSheet(cast),
    "",
    "Requirements: every episode has a cold-open hook, a twist, an engagement beat (cliffhanger/vote/",
    "question/preview), 2-4 hand-tuned signature keyLines, unresolved threads, and an explicit",
    "connection to a previous or future episode. Secrets from character profiles should pay off across",
    "the season. Episode 1 must center on two contestants discovering they want the same person, and",
    "end with a new arrival from another country chosen for maximum future storyline.",
  ].join("\n");
}

export function episodePrompt(
  bible: ShowBible,
  cast: Character[],
  state: SeasonState,
  beat: EpisodeBeat,
): string {
  return [
    `You are the episode writer of "${bible.title}". Write episode ${beat.episode}: "${beat.title}".`,
    guardrails(bible),
    "Cast (only use characters currently in the villa, by id):",
    castSheet(cast.filter((c) => !state.eliminated.includes(c.id))),
    "",
    "CONTINUITY — the villa remembers everything:",
    JSON.stringify({
      previousEpisodeSummary: state.previousEpisodeSummary,
      couples: state.couples,
      rivalries: state.rivalries,
      secretsRevealed: state.secretsRevealed,
      unresolvedStorylines: state.unresolvedStorylines,
      viewerDecisions: state.viewerDecisions,
    }),
    "",
    "EPISODE BEAT (follow it; keyLines MUST appear verbatim as contestant quotes):",
    JSON.stringify(beat),
    "",
    "FORMAT — viral narrator-led animated reality short (the object-love-island genre):",
    '- Speaker id "narrator" is an off-screen, omniscient, extremely sassy storyteller. She',
    '  carries the episode: ~60-70% of all lines are hers. NEVER list "narrator" in a scene\'s',
    "  characters array (she is off-screen).",
    "- Narrator voice: fast present-tense gossip in 3-10 word sentences, talking half to the",
    "  audience. Examples of the ENERGY (do not copy verbatim): 'This is Brock.' / 'Brock has a",
    "  plan.' / 'The plan is terrible.' / 'Watch her face.' / 'That was a mistake.'",
    "- Contestants interject with ONE-line reactions (under 12 words), including the beat's",
    "  keyLines verbatim. Give at least three contestants a spoken reaction.",
    "- Open on the hook: line 1 names a character + an imminent disaster. No intro, no greeting.",
    "- Escalate relentlessly: statement → reaction → betrayal → gasp. End scenes on mini-cliffs.",
    "- The engagement endcard beat is a direct narrator command to the audience (vote/question).",
    "",
    `Scene locationId MUST be exactly one of: ${bible.villa.locations.map((l) => l.id).join(", ")}.`,
    "Scene characters arrays may only contain contestant ids from the cast list above (never",
    '"narrator").',
    "",
    "Structure: 8-10 scenes — hook (0-3s), setup, escalations (≥1 Spill Room confessional quote,",
    "≥1 argument, ≥1 pure reaction beat), twist, engagement endcard. Total spoken runtime",
    "~55-70 seconds (aim ~150-170 spoken words TOTAL — count them). Scene 'visual' fields describe",
    "one clear dramatic picture, naming each on-screen character, their expression, and action.",
    "Set 'emphasize' on 1-2 punch words per line. Include a TikTok caption + 8+ hashtags.",
  ].join("\n");
}

export function continuityCheckPrompt(
  bible: ShowBible,
  state: SeasonState,
  scriptJson: string,
): string {
  return [
    `You are the continuity supervisor of "${bible.title}". Review this episode script against season state.`,
    "Flag: characters acting against established relationships, forgotten secrets, contradicted events,",
    "eliminated characters appearing, and any brand-copying or harmful-stereotype risk.",
    guardrails(bible),
    "SEASON STATE:",
    JSON.stringify(state),
    "SCRIPT:",
    scriptJson,
  ].join("\n");
}
