# The Quality Director — the pipeline's standing reviewer

Owner directive (2026-07-28): better voices, better backgrounds, better scripts, and a
"new employee" that constantly evaluates the show against those criteria. This module is
that employee: `src/quality/quality-director.ts`.

## What it reviews, and when

| Axis    | When it runs                                               | How                                                                                                                     | Blocking?                                |
| ------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Script  | inside `generate-episode` (every draft)                    | Claude rubric: hook, ONE-premise comedic engine, causal escalation, character voice, comedic pacing, ending (1–10 each) | below bar → auto-revise (up to 3 drafts) |
| Audio   | inside `produce-episode` (after TTS)                       | ffmpeg per line: duration sanity, loudness window (−30…−8 dB mean), clipping                                            | critical → produce aborts                |
| Visuals | inside `produce-episode` (after stills) + `quality-review` | Claude vision on stills/frames: AI defects, style/proportion consistency across cuts, nationality-obvious flag wardrobe | critical → `validate-episode` fails      |

Everything lands in `data/episodes/<ep>/quality-report.json`; `validate-episode` refuses to
pass an episode whose report has critical findings, and publishing is gated on validation +
the final-export approval, so nothing below the bar can ship.

## Standalone inspection

```bash
npm run quality-review -- --episode N   # re-runs script rubric + audio + stills review
```

Exit code 1 while critical findings remain.

## The bars (raise them, never delete them)

- Script: every rubric axis ≥ 6 and average ≥ 7, plus an explicit pass verdict.
- Audio: no line quieter than −30 dB mean, shorter than 0.4 s, or missing.
- Visuals: zero findings a viewer would notice as "looks AI" (severity critical), including
  inconsistent character proportions between cuts.

## Quality directives it encodes (from the owner, 2026-07-28)

- Narration pacing breathes: setup → beat → punchline; pauses after punchlines (see
  `render-plan.ts` pacing constants).
- Captions are horizontal complete clauses in the lower-middle third, never single-word
  stacks (see `captions/Subtitles.tsx`).
- ONE comedic engine per episode; recurring bits need setup; no non-sequitur concepts
  (enforced in `prompts.ts` + the script rubric).
- Visual consistency: locked character designs + flag wardrobe, deterministic character
  placement, uniform house grade (see `SceneShot.tsx`, `episode-composition.tsx`).
