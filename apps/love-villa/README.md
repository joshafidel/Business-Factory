# Love Villa: Nations 🌹

An MVP production pipeline that generates complete, ready-to-upload vertical TikTok episodes of
**Love Villa: Nations** — an original, serialized, AI-animated dating-show comedy about eight
gloriously exaggerated singles from around the world sharing one villa and zero chill.

Each finished episode is a 60–90 second 1080×1920 MP4 with recurring visually-consistent
characters, distinct voices, AI-generated visuals, Remotion camera motion (no slideshow feel),
generated music + SFX, large animated word-highlight subtitles, a cold-open hook, a twist, an
engagement beat, a thumbnail, and a suggested TikTok caption + hashtags.

> **Guides:** [docs/SETUP-APIS.md](docs/SETUP-APIS.md) — step-by-step key setup for every
> provider (Anthropic, ElevenLabs, OpenAI, TikTok, fal.ai) with links ·
> [docs/ANIMATION-QUALITY.md](docs/ANIMATION-QUALITY.md) — how to hit an extremely high
> animation standard. The Business-Factory dashboard shows this app at `/apps/love-villa`.
>
> **TikTok posting:** built in. After a one-time OAuth (`npm run tiktok-auth`),
> `npm run publish-episode -- --episode N` posts the approved episode automatically. Until your
> TikTok app passes TikTok's audit, posts are restricted to private (SELF_ONLY) by TikTok policy.

## Quick start (zero API keys needed)

Everything runs in **mock mode** out of the box — deterministic parametric SVG art, synthesized
per-character voices with realistic timing, generated royalty-free music, and a hand-authored
"writers' room" — so you can develop and render real MP4s for free.

```bash
cd apps/love-villa
pnpm install                      # from the repo root: pnpm install --filter love-villa
cp .env.example .env              # optional — only needed to add API keys

npm run setup-show                              # bible, villa, cast, art, SFX, season state
npm run approve -- --stage characters           # human gate 1
npm run generate-season -- --episodes 10        # connected 10-episode arc
npm run approve -- --stage season               # human gate 2
npm run generate-episode -- --episode 1         # script, shot list, caption, continuity
npm run approve -- --stage script --episode 1          # human gate 3
npm run approve -- --stage visual-prompts --episode 1  # human gate 4
npm run produce-episode -- --episode 1          # images + voices + music + rough-cut draft
npm run approve -- --stage rough-cut --episode 1       # human gate 5
npm run render-episode -- --episode 1           # FINAL 1080x1920 MP4 + thumbnail + package
npm run validate-episode -- --episode 1         # full QA report
npm run approve -- --stage final-export --episode 1    # human gate 6
```

The finished episode lands in:

```
output/episodes/episode-001/
  final.mp4               # the video (1080x1920, h264)
  draft.mp4               # half-res rough cut from produce-episode
  thumbnail.png           # still from the twist scene
  caption.txt             # suggested TikTok caption
  hashtags.txt            # suggested hashtags
  script.md               # human-readable script
  shot-list.json          # per-scene image prompts + motion
  continuity-update.json  # what this episode changes in the season state
  production-report.md    # APIs used, costs, assets, failures, decisions
```

## Commands

| Command                                      | What it does                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run setup-show`                         | Show bible, villa locations, cast (locked visual/voice identities), reference art, SFX bank, initial season state |
| `npm run generate-season -- --episodes 10`   | Connected season arc with hooks, twists, engagement beats, signature lines                                        |
| `npm run generate-episode -- --episode N`    | Episode script + shot list + caption/hashtags + continuity update (advances story canon)                          |
| `npm run produce-episode -- --episode N`     | Generates/collects all assets, builds the timed render plan, renders the draft rough cut                          |
| `npm run render-episode -- --episode N`      | Final 1080×1920 MP4 + thumbnail + upload package + production report                                              |
| `npm run validate-episode -- --episode N`    | Full QA (see checklist below), writes `validation-report.json`                                                    |
| `npm run validate-continuity -- --episode N` | Focused continuity pass (script vs season state)                                                                  |
| `npm run approve [-- --stage S --episode N]` | List / approve / reject / request-revision / lock / unlock checkpoints                                            |
| `npm run tiktok-auth`                        | One-time TikTok account connection (OAuth); `-- --status` to inspect                                              |
| `npm run publish-episode -- --episode N`     | Post the final-export-approved episode to TikTok (Content Posting API)                                            |

Flags: `--force` bypasses an approval gate or lock (logged loudly); `--skip-draft` on
produce-episode skips the draft render; `--no-lock` approves without locking; `--revise`
re-opens a checkpoint with a note.

## Human approval workflow

Six checkpoints gate the pipeline; nothing advances until you approve (approve **locks** the
artifact so it can't be silently regenerated — `--unlock` or `--force` to override):

1. `characters` — review `data/characters/CAST.md`
2. `season` — review `data/show-state/SEASON.md`
3. `script:N` — review `data/episodes/episode-NNN/script.md`
4. `visual-prompts:N` — review `data/episodes/episode-NNN/shot-list.json`
5. `rough-cut:N` — watch `output/episodes/episode-NNN/draft.mp4`
6. `final-export:N` — watch `final.mp4`, then post it

## Providers (all optional, all swappable)

| Provider               | Env key                      | Live behavior                                                                                                                     | Mock behavior (no key)                                            |
| ---------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Anthropic Claude**   | `ANTHROPIC_API_KEY`          | Writes cast refinements, season arcs, episode scripts via structured outputs (`claude-opus-5`), validated by the same Zod schemas | Hand-authored fixtures + a deterministic procedural writers' room |
| **OpenAI gpt-image-1** | `OPENAI_API_KEY`             | Transparent character cutouts + vertical location art from locked prompts/palettes                                                | Deterministic parametric SVG art from the same palettes           |
| **ElevenLabs**         | `ELEVENLABS_API_KEY`         | Stable per-character voices (map IDs in `data/voice-map.json`, template provided)                                                 | Distinct synthesized voices with realistic speech timing          |
| Music & SFX            | —                            | Always generated locally in code — original, royalty-free by construction                                                         | same                                                              |
| **fal.ai i2v**         | `FAL_KEY`                    | True animation: clean-plate scene stills animated via Kling/Hailuo/Veo (`FAL_I2V_MODEL`) — see docs/ANIMATION-QUALITY.md          | Remotion camera moves                                             |
| **TikTok**             | `TIKTOK_CLIENT_KEY`+`SECRET` | Automatic posting via the Content Posting API after `npm run tiktok-auth` (docs/SETUP-APIS.md §4)                                 | manual upload                                                     |

Provider adapters live behind interfaces in `src/providers/` (`ImageProvider`, `TTSProvider`,
`MusicProvider`, `MotionProvider`) — switching providers means implementing one interface.
Capability notes: seed control and reference-image conditioning are part of the interface;
gpt-image-1 doesn't support seeds, so cross-episode consistency comes from locked verbatim
look-lines + palettes injected into every prompt (and locked SVG parameters in mock mode).

## Character & voice consistency

Every character locks: a `visualReference` look-line (injected verbatim into every image prompt),
a color palette, an `imageSeed`, and a voice config (ElevenLabs voice ID + stability settings, or
mock pitch/lilt/rate). `validate-episode` fails if seeds collide or voice configs drift.

## Continuity

`data/show-state/season-state.json` tracks cast, eliminations, couples, attraction scores,
rivalries, alliances, secrets (revealed/unrevealed), previous-episode summary, unresolved
storylines, viewer decisions, popularity, and continuity notes. Episode generation consumes the
state and emits a `continuity-update.json`; the state advances when the script is generated
(story canon), and episodes must be generated in order.

## Validation checklist (`validate-episode`)

Character consistency · voice consistency · story continuity · missing assets · subtitle overflow
(≤2 rows, safe-zone width) · video duration (60–90s) · audio clipping (WAV peak) · duplicate
dialogue · hook strength (cold open, ≤14 words) · cliffhanger/engagement presence · brand-copying
risk (banned-phrase list for protected elements of other shows) · harmful-stereotype risk
(dehumanizing-term screen near nationality references + per-character line-share balance).

## Cost controls

- `MAX_COST_PER_EPISODE_USD` (default **$5**) — hard budget; every live call logs its expected
  cost _before_ the request and the ledger (`data/episodes/*/cost-ledger.json`) throws past budget
- `MAX_IMAGES_PER_EPISODE`, `MAX_TTS_REGENS_PER_LINE`, `MAX_VIDEO_GENS_PER_EPISODE`
- `REUSE_EXISTING_ASSETS=true` reuses character/location art across episodes
- `IMAGE_QUALITY=draft|high` (low ≈ $0.016/img vs medium ≈ $0.063/img)

Typical live-mode episode estimate: ~$0.10–0.30 LLM + ~$0.25–0.90 images (mostly one-time cast/
villa art, amortized) + ~$0.15–0.40 TTS ≈ **$0.50–1.50/episode**, well under the $5 budget.
Mock mode: $0.00.

## Rendering

Remotion 4 renders programmatically (`src/render/`): animated backgrounds (push-ins, pans,
parallax, shakes, zoom-outs), character cutouts with speaker glow + bob, argument split-screens,
confessional framing ("The Spill Room"), arrival walk-ins, text-message overlays, end cards, and
word-highlight subtitles inside TikTok safe zones. A Chromium binary is auto-detected
(`REMOTION_BROWSER_EXECUTABLE` to override; Remotion downloads its own headless shell otherwise).

## Project structure

```
src/
  ai/            anthropic.ts (Claude adapter + mock fallback), prompts.ts, schemas.ts (Zod),
                 mock-content/ (cast, show bible, season arc, procedural episode writer)
  characters/    character-manager.ts (locked identities, CAST.md)
  show/          show-bible.ts, season-state.ts (continuity database)
  episodes/      episode-generator.ts, continuity-checker.ts
  providers/     images/ (openai + svg mock), tts/ (elevenlabs + mock), music/, video/, types.ts
  render/        remotion root/composition, scenes/, captions/, render-plan.ts, render.ts
  approvals/     approvals.ts (checkpoints + locking)
  scripts/       one file per npm command
  utils/         wav synth, cost ledger, fs, args, log
data/            characters/, show-state/, episodes/ (scripts, reports, ledgers)  [committed]
assets/          characters/, locations/, sfx/, episodes/ (art + audio)          [gitignored]
output/          episodes/episode-NNN/ upload packages                            [gitignored]
```

## Content guardrails

The show bible bans: real-person likenesses, characters under 21, racial slurs, dehumanizing
nationality stereotypes (stupid/criminal/dirty/violent/inferior/untrustworthy), photorealistic
deepfakes, and any protected element of existing shows (specific banned-phrase list enforced on
every script). Humor is bold but character-driven; every country gets equal treatment; every
character has strengths, flaws, secrets, and motivations beyond their nationality.

## Switching or adding providers

- **Images**: implement `ImageProvider` (`src/providers/types.ts`), wire it in
  `src/providers/images/index.ts`. Reference-image conditioning hooks are in the interface.
- **TTS**: implement `TTSProvider`, wire in `src/providers/tts/index.ts`. Keep one stable voice
  per character (`data/voice-map.json`).
- **Image-to-video**: implement `MotionProvider` (currently `DisabledMotionProvider`); scenes with
  real clips would then skip the Ken-Burns-style camera moves.
- **LLM**: `ANTHROPIC_MODEL` env switches models; the adapter is `src/ai/anthropic.ts`.

## Generating the rest of season 1

Episodes 1–5 ship generated (episode 1 fully rendered). For 6–10:

```bash
npm run generate-episode -- --episode 6   # …then approve, produce, render, validate
```

The 10-episode arc is already planned (`data/show-state/SEASON.md`); each command walks the same
gates. In live-LLM mode you can plan longer seasons: `npm run generate-season -- --episodes 20`.
