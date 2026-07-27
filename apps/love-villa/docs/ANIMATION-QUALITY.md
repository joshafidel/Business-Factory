# Hitting an extremely high animation standard

The pipeline has three animation tiers. Each is a strict upgrade and they compose — the
difference between "AI slideshow" and "looks like a real animated show" is tiers 2+3 plus the
craft rules below.

## Tier 1 — Remotion motion (free, always on)

Camera language generated in code: push-ins, pans, parallax, shakes, zoom-outs, split-screen
arguments, arrival walk-ins, speaker glow + idle bob, word-highlight subtitles. This is the
floor: it guarantees the video never feels static, and it's the automatic fallback whenever a
generated clip fails.

## Tier 2 — Real art (OpenAI gpt-image-1)

Animation quality is capped by the plates you animate. Before turning on image-to-video:

- Set `OPENAI_API_KEY` and `IMAGE_QUALITY=high`, then regenerate the cast/villa once
  (`npm run setup-show -- --force`). Approve the new art at the `characters` gate.
- The show's look is locked by the style block in every prompt (glossy, exaggerated,
  semi-realistic, slightly cartoonish) plus per-character verbatim look-lines and palettes.
  **Never edit a character's look-line after episode 1 ships** — that's what keeps them
  on-model across episodes and inside every generated clip.
- Keep `REUSE_EXISTING_ASSETS=true` so identity stays pixel-identical between episodes.

## Tier 3 — True animation (fal.ai image-to-video) ★ the big one

With `FAL_KEY` set, `produce-episode` renders a **clean plate** of every scene (the fully
composited frame: set + characters, no UI overlays) and sends it to an image-to-video model with
a motion prompt derived from the scene's action. The final render then plays the real clip —
blinking, breathing, gesturing characters with cloth/hair physics — with subtitles, SFX and
music layered on top. Scenes are animated in priority order (hook → twist → setup → rest) up to
`MAX_VIDEO_GENS_PER_EPISODE`, and every clip is budget-guarded.

### Choosing the model (`FAL_I2V_MODEL`)

One `FAL_KEY` unlocks all of these — switching models is a one-line env change. Catalog with
live pricing: <https://fal.ai/models?categories=image-to-video>

| Model (fal id)                                      | Character animation quality | Cost/clip (≈, 5s) | Notes                                                               |
| --------------------------------------------------- | --------------------------- | ----------------- | ------------------------------------------------------------------- |
| `fal-ai/kling-video/v2.1/standard/image-to-video`   | very good, stays on-model   | ~$0.25–0.35       | **Recommended default** — best quality/cost for stylized characters |
| `fal-ai/kling-video/v2.1/pro/image-to-video`        | excellent, strong physics   | ~$0.45–0.90       | Use for hook + twist scenes of publishable episodes                 |
| `fal-ai/minimax/hailuo-02/standard/image-to-video`  | very good, expressive faces | ~$0.28            | Great facial acting; alternative default                            |
| `fal-ai/veo3/image-to-video` (fast variants)        | top tier                    | ~$1+              | Hero shots / trailers; watch the budget guard                       |
| `fal-ai/ltx-video-13b-098-distilled/image-to-video` | fair                        | ~$0.02–0.05       | Cheap draft-mode animation for rough cuts                           |

Strategy that maximizes quality per dollar: `standard` Kling for all 7 scenes during iteration;
for the publishable render, bump hook + twist to `pro` (run produce twice with different
`FAL_I2V_MODEL` values — clips are cached per scene file, and `MAX_COST_PER_EPISODE_USD` keeps
you honest).

### Motion-prompt craft (already encoded, tune in `produce-episode.ts`)

The pipeline's motion prompt enforces the rules that matter for stylized characters:

1. **Describe behavior, not topology** — "she rolls her eyes and sips tea" animates; "the
   camera orbits 180°" melts stylized characters.
2. **Pin the style** — "keep the exact glossy animated reality-show art style and character
   designs of the image" prevents drift toward photorealism.
3. **Ban text and morphing explicitly** — i2v models love inventing captions.
4. **Slow cinematic camera** — big generated camera moves fight the Remotion push-in layered on
   top; subtle beats loud.

### Craft rules that keep the standard high (regardless of tier)

- **Cut on beats.** Scene lengths are driven by real voice-audio durations — keep lines short
  (the validator flags >18 words) so cuts stay fast; TikTok pacing is ~2–4s per shot.
- **One motion idea per scene.** Push-in on confessionals, shake only on the twist, parallax
  only on arguments. Reusing the grammar consistently is what reads as "a show".
- **Faces > everything.** Prefer models ranked for facial acting (Kling, Hailuo); the audience
  watches faces, not backgrounds.
- **Never let a clip fail silently.** Failures land in `assets.json → failures` and the
  production report, and the scene falls back to a camera move — episodes always ship.
- **QA at the rough-cut gate.** Watch `draft.mp4` specifically for identity drift (character
  suddenly off-model) and re-run produce for that scene before the expensive final render.

### The next ceiling (not yet wired — in priority order)

1. **Lip-sync pass**: run each animated scene's clip + line audio through a lip-sync model
   (e.g. `fal-ai/sync-lipsync` family) so mouths match the dialogue. Slot: a second
   MotionProvider stage in `produce-episode` after clips download.
2. **Per-character pose/expression sheets**: generate 3–4 expressions per character with
   gpt-image-1 (same look-line), swap cutouts by line sentiment in Tier-1 scenes.
3. **Kling elements / reference-to-video**: some models accept multiple reference images
   (character + set separately) for even tighter identity control — the `MotionProvider`
   interface already carries `referenceImages` for this.
