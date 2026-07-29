import { z } from "zod";
import { generateStructured } from "../ai/anthropic";
import { guardrails } from "../ai/prompts";
import { type Character, type EpisodeBeat, type SeasonState, type ShowBible } from "../ai/schemas";
import { type CostTracker } from "../utils/cost";

/**
 * THE PLOT WRITER — production employee #1 (Directive 1, DIRECTIVES-V3.md).
 * Story comes BEFORE script: three competing pitches per episode beat, each
 * built around a want, a lie/secret, a public collision, and a REVERSAL that
 * recontextualizes an earlier moment. The strongest pitch wins and the
 * Script Writer must follow it.
 */

export const pitchSchema = z.object({
  pitches: z
    .array(
      z.object({
        logline: z.string().describe("one-paragraph pitch a stranger would stop scrolling for"),
        want: z.string(),
        lieOrSecret: z.string(),
        publicCollision: z.string(),
        reversal: z
          .string()
          .describe("the moment that reveals the situation was never what we thought"),
        whyItsFunny: z.string(),
      }),
    )
    .length(3),
  chosenIndex: z.number().int().min(0).max(2),
  whyChosen: z.string(),
});
export type PitchSet = z.infer<typeof pitchSchema>;

export async function writePitches(params: {
  beat: EpisodeBeat;
  bible: ShowBible;
  cast: Character[];
  state: SeasonState;
  tracker: CostTracker;
}): Promise<PitchSet> {
  const { beat, bible, cast, state, tracker } = params;
  const prompt = [
    `You are the Plot Writer of "${bible.title}". Pitch THREE competing stories for this episode`,
    "beat. Each pitch: a want, a lie or secret, a public collision, and a REVERSAL that makes the",
    "audience re-see an earlier moment (never a mere escalation). Every scene the pitch implies",
    "must change who is winning. Comedy comes from character collision. Then choose the pitch a",
    "cold viewer would most want to see episode 2 of, and say why.",
    guardrails(bible),
    "",
    "Cast (use their wants/secrets):",
    cast.map((c) => `${c.id}: wants ${c.datingStrategy} | secret: ${c.secret}`).join("\n"),
    "",
    "Season state:",
    JSON.stringify({
      couples: state.couples,
      rivalries: state.rivalries,
      unresolvedStorylines: state.unresolvedStorylines,
    }),
    "",
    "EPISODE BEAT:",
    JSON.stringify(beat),
  ].join("\n");
  return generateStructured({
    item: `plot:pitches:e${beat.episode}`,
    prompt,
    schema: pitchSchema,
    mock: () => ({
      pitches: [0, 1, 2].map((i) => ({
        logline: `Mock pitch ${i + 1} for episode ${beat.episode}: ${beat.hook}`,
        want: "mock want",
        lieOrSecret: "mock secret",
        publicCollision: "mock collision",
        reversal: "mock reversal",
        whyItsFunny: "mock",
      })),
      chosenIndex: 0,
      whyChosen: "mock mode",
    }),
    tracker,
    maxTokens: 8000,
  });
}
