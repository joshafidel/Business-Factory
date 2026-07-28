# Animation 2.0 — audit, architecture, style guide, and phased plan

_Last updated: 2026-07-28. Owner objective: videos that feel like a real
animated preschool show, not a slideshow of AI clips._

## 1. Audit of the current system (2026-07-28)

Three video systems live in this repo:

| Area                        | Zoo Shorts                                                                  | Love Villa                  | Listing Factory                  |
| --------------------------- | --------------------------------------------------------------------------- | --------------------------- | -------------------------------- |
| Stills                      | gpt-image-1-mini per scene, text prompt only                                | gpt-image clean plates      | listing photos                   |
| Character consistency       | verbatim "look lines" in prompts (`packages/shared/src/zoo-cast.ts`)        | character sheets in prompts | n/a                              |
| Rigging / keyframes / mocap | none                                                                        | none                        | none                             |
| Motion                      | Higgsfield `dop-lite` i2v, 1 clip/scene, generic prompt                     | fal.ai i2v (Kling)          | Higgsfield/Picsart/deterministic |
| Lip-sync                    | none                                                                        | none                        | n/a                              |
| Music sync                  | none (equal-length scene slots)                                             | none                        | none                             |
| Assembly                    | ffmpeg per-scene renders → stream-copy concat (resumable via storage cache) | Remotion                    | ffmpeg                           |
| Runtime                     | Vercel serverless: 300 s/invocation, throttled post-response CPU, no GPU    | local/scripts               | local/scripts                    |

### Why the animation looks weak

1. **No persistent character representation** — every shot is a fresh
   text-to-image sample; identity drifts across shots and episodes.
2. **dop-lite is a "living photo" tier** — parallax and idle sway, not
   actions; no walking, no weight, no object interaction.
3. **Generic motion prompts** — every scene performs the same "blink and
   bounce"; nothing scene-specific, no anticipation → action → settle.
4. **Time-stretch up to 2.2×** to fill scene slots — the floaty look.
5. **No lip-sync** on a singing channel.
6. **No beat awareness** — cuts land mid-beat, mid-word.
7. **No shot grammar** — one framing per scene; no close-ups, reactions,
   or inserts, because characters would not survive a re-angle.

## 2. Target architecture

### Track A — best-possible generative pipeline (deployable today)

```
CharacterRegistry ──► SceneStills ──► MotionProvider ──► SceneRenders ──► BeatCut ──► QA ──► Publish
 (canonical refs)     (image EDITS     (interface:        (resumable       (beat-     (score
  approved renders,    conditioned      higgsfield dop*,    storage         quantized   gate)
  versioned)           on refs)         fal/kling,          cache)          durations,
                                        hedra…)                             cuts on beats)
        ▲                    ▲
        └── Choreography: per-scene action spec from the script agent
            {anticipation, main action, settle, gaze target, camera hint}
```

Key modules (all in `packages/`):

- `providers/src/motion.ts` — `MotionProvider` interface: `submit(job) →
jobId`, `poll(jobId)`, `download(url)`. Adapters: Higgsfield (model
  tier via `HIGGSFIELD_MODEL`), fal.ai Kling (`FAL_KEY`), future Hedra
  (character lip-sync video). **No vendor coupling anywhere else.**
- `workflows/src/functions/zoo-cast-refs.ts` — canonical reference
  render per cast member, generated once, stored versioned
  (`<org>/zoo-cast/<name>-v<N>.png`), reused as image-edit reference for
  every scene still. Character changes = new version, deliberate.
- `workflows/src/functions/beat-map.ts` — decodes the song, extracts
  onset envelope, estimates tempo + beat grid (pure TS + ffmpeg; no
  native deps).
- Scene schema gains `action` (anticipation/main/settle), `gaze`,
  `camera` fields; the script agent writes them; the renderer compiles
  them into motion prompts with anti-artifact constraints (feet planted,
  no morphing, no sliding, keep exact character design).
- Assembly: scene durations quantized to the beat grid (cuts land on
  strong beats); max time-stretch 1.35×.

### Track B — rigged 3D pipeline (Blender; the real ceiling)

Blender 4.0.2 is installable in the build sandbox (apt candidate
verified). The honest prerequisites before Track B can ship:

1. **A render host.** Vercel serverless cannot run Blender. Options:
   a $5–20/mo VM (render worker polls a queue), GitHub Actions runners
   (free minutes, slow), or on-demand render APIs. Decision needed.
2. **Character assets.** Appealing rigged characters cannot be
   procedurally generated from primitives — that reads as programmer
   art, _below_ current output. Path: one-time character modeling
   (commissioned, or AI-assisted mesh gen + manual Rigify rigging +
   cleanup), then infinite free reuse. This is exactly the economics of
   real preschool studios: expensive once, cheap per episode.

Track B deliverables (Phases 3–4): bpy scene-assembly scripts driven by
typed JSON plans, Rigify-based rigs with facial blendshapes, viseme
lip-sync from phoneme timestamps (ElevenLabs forced alignment), reusable
animation clip library (NLA), camera/lighting templates, Eevee preview +
final renders, mock mode when Blender is absent. Schemas in
`packages/shared/src/animation-schemas.ts` are shared by both tracks so
scene plans are renderer-agnostic.

## 3. Phased plan

| Phase   | Contents                                                                                                                                                                                                                                      | Status                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1 (now) | MotionProvider abstraction; canonical character refs + image-edit stills; choreography prompts; beat map + beat-quantized cuts; stretch ≤1.35×                                                                                                | in progress                         |
| 2       | Shot grammar (close-ups/reactions/inserts via ref-conditioned re-angles); QA scoring gate (identity similarity, motion coverage, AV sync); animatic preview step; Hedra/Kling lip-sync adapter for hero close-ups (needs key + cost approval) | planned                             |
| 3       | Blender track: render worker, character asset creation, rig + viseme system, clip library                                                                                                                                                     | needs render-host + asset decisions |
| 4       | Full Blender production: per-episode scene assembly, 24 fps renders, QA, hybrid with Track A backgrounds                                                                                                                                      | after 3                             |

## 4. Visual style guide — "Zoo Friends" original identity

- **Proportions**: toddler ratios — heads ~40 % of body height, short
  rounded limbs, small hands/feet, no sharp corners anywhere.
- **Eyes**: very large (≈⅓ of face width each), glossy, dark iris with
  two catchlights; thick soft lashes on female-coded characters only as
  accent; eyelids visible for blinks and emotion.
- **Mouths**: wide, simple, high-contrast interior; smile as default
  rest state; open-mouth shapes readable at 200 px.
- **Skin/fur**: smooth matte-glossy hybrid ("soft vinyl toy"), gentle
  subsurface warmth, no realistic fur strands.
- **Palette**: pastel base + one saturated accent per character (Ellie
  pink bow, Pip red scarf, Gigi orange spots, Milo yellow banana); backgrounds
  2 stops less saturated than characters; sky always friendly.
- **Environments**: rounded geometry, low detail density, one clear
  focal prop per scene; depth via soft gradients, not clutter.
- **Lighting**: high-key soft key + ambient fill; shadows soft and
  never on faces; catchlights mandatory.
- **Camera language**: eye-level or slightly low ("child height");
  slow dolly/orbit only; cuts on beats; wide → medium → close rhythm.
- **Motion language**: slightly exaggerated, slow, pose-to-pose;
  anticipation → action → brief hold → settle; one main action per
  scene; secondary motion (ears, tails) always on.
- **Faces**: an expression change at least every scene; eyes look at
  whatever matters _before_ the body reacts.

## 5. Character canon

Character profiles live in `packages/shared/src/zoo-cast.ts` (ID, name,
species, look line, personality). Canonical approved renders (the visual
ground truth) are versioned storage objects; every scene still is an
EDIT conditioned on them. Never regenerate a primary character from text
alone.

## 6. External-service adapters (research summary)

| Capability                 | Options                                                                                       | Status                             |
| -------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| Image-to-video motion      | Higgsfield dop/dop-lite (integrated), fal.ai Kling 2.x (adapter, needs FAL_KEY), Runway, Luma | tier selection via env             |
| Character lip-sync video   | Hedra Character-3 (stylized-friendly), Kling AI-avatar, sync.so                               | Phase 2, needs key + cost approval |
| Speech + song              | ElevenLabs (integrated: TTS v3 + Eleven Music)                                                | live                               |
| Phoneme timestamps         | ElevenLabs forced alignment API                                                               | Phase 2/3 (lip-sync input)         |
| Text-to-motion (rig clips) | MDM-class models, Mixamo library retarget                                                     | Track B                            |

All behind interfaces; no pipeline code imports a vendor SDK directly.

## 7. Cost & platform constraints (why the architecture looks like this)

- Vercel: 300 s/invocation, throttled after-response CPU, no GPU →
  renders must be resumable (storage-backed scene cache) and the final
  assembly must be stream-copy, not re-encode. These are load-bearing;
  see CLAUDE.md before "simplifying".
- Higgsfield account: max 4 concurrent jobs; global queue can back up
  ~10× — assembly waits patiently and ships partial only as last resort.
- Budget: $15/day hard stop, ~$2.5–4.5 per episode at current tiers.
