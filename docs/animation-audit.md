# Animation Audit — Zoo Shorts (2026-07-29)

Requested by the owner against a full 3D-animation-director brief
(rigging, layered animation, phoneme lip-sync, IK, staged renders). This
audit maps that brief honestly onto what this system IS, why its output
has looked stiff, and the smallest architecture that fixes the visible
problems. Companion docs: `docs/animation/ANIMATION-2.0.md` (architecture),
`docs/animation/VISUAL-QA.md` (defect gate), `docs/character-style-guide.md`.

## 1. What the pipeline actually is

There are no 3D models, rigs, bones, blend shapes, keyframes, or a
renderer. The pipeline is **generative image-to-video**, running entirely
in serverless functions (Vercel, 300s/invocation, no GPU):

1. LLM agents write idea → song script (6 scenes with per-scene
   choreography: anticipation / main action / settle / gaze) → SEO metadata.
2. Eleven Music sings an original ~40s song from the lyrics.
3. gpt-image composes one still per scene, **conditioned on canonical cast
   reference renders** so Ellie/Milo/Gigi/Pip stay pixel-consistent.
4. A motion provider turns each still into a 5–8s animated clip from a
   choreography prompt (vendor-agnostic adapter: Veo 3.1 Fast ▸ Kling ▸
   Higgsfield).
5. ffmpeg stretches clips to beat-aligned scene lengths (cuts land on the
   song's beats), bakes dip-to-black edges, stream-copy concats, and mixes
   the song.
6. Two QA gates (vision model, strict defect checklist) inspect every
   still and every clip; failures regenerate with defect feedback.

## 2. Why the animation looked stiff / robotic

Ranked by measured impact on real runs:

1. **Motion engine ceiling (the dominant cause).** Higgsfield dop-lite is
   a "living photo" tool: it drifts object counts (bananas multiplied in 5
   of 6 attempts across two episodes), morphs anatomy (a second trunk, a
   muzzle turning into a blob, an invented fifth character), and ignores
   choreography. No prompt fixes a model that can't follow direction.
2. **Static fallbacks.** When clips failed QA the old behavior swapped in
   Ken Burns zooms — "a collection of static AI images with basic motion"
   is literally what that produces. Now banned; clips regenerate instead.
3. **Freeze-holds.** A filter-order bug silently shortened animated scenes
   ~2.4s each; clone-padding and container mismatch produced frozen tails.
   Fixed (pad-before-stretch; duration reconciliation; audio fades at the
   animation-capacity cap).
4. **Uniform pacing.** Pre-beat-map cuts ignored the music. Fixed: cuts
   snap to the song's detected beat grid.
5. **Vague motion prompts.** "Cute animals move" produced idle sway. Now:
   three-beat choreography per scene + continuous-energy directive +
   anti-morph guardrails + count-freeze for number scenes.

## 3. The brief vs. this architecture — honest mapping

| Brief item | Status here |
|---|---|
| Appealing rounded characters, big readable faces | ✅ via cast reference renders + style guide (generative, not modeled) |
| Anticipation / follow-through / arcs / weight | ⚠️ Expressed through choreography prompts; the motion model interprets them. Veo 3.1 honors them well; Higgsfield mostly doesn't. Not keyframable. |
| Layered animation (body/head/eyes/brows/breath) | ❌ Not addressable — no rig exists. The generative model produces all layers jointly. |
| Phoneme/viseme lip-sync | ❌ Not possible in i2v clips (no mouth rig). Best practical alternative: song-mode videos where characters dance rather than mouth words, and a future dedicated lip-sync pass (Hedra-class tool) for close-up "singing" shots. |
| IK, planted feet, no sliding | ⚠️ Prompt guardrails + QA rejection of sliding/floating; not guaranteed per-frame. |
| Eye darts, blinking, listening reactions | ⚠️ Veo produces these natively when prompted ("blinking, look at each other"); verified in test clips. |
| Shot planning JSON | ✅ Partially exists (per-scene action/gaze in the script). Extension planned: framing + camera move per scene. |
| Staged previews (storyboard → animatic → final) | ⚠️ Stills ARE the storyboard; assemble caches per-scene renders. Full staging is a Blender-track feature (see ANIMATION-2.0.md Phases 3–4, needs a render host). |
| Automated animation QA | ✅ Live: 6-frame clip inspection for morphing, count drift, identity breaks, garbled text; regenerate-until-clean loop; approval checklist enforced frame-by-frame. |
| Camera: gentle push-ins, no shake | ✅ In motion prompts ("smooth gentle camera"); QA flags wild moves. |
| Repetition with variation | ✅ Chorus repeats lyrics at scenes 2 & 5 with different stills/choreography. |

**Conclusion:** the rig-based items are impossible in this serverless
generative pipeline — the leverage is (a) the motion engine, (b) the
choreography language, (c) ruthless QA with regeneration, (d) edit
discipline (beats, trims, no freezes). A true rigged pipeline is the
Blender track (documented separately; needs a GPU render host + character
assets — an owner decision).

## 4. Engine decision (tested head-to-head, 2026-07-29)

| | Higgsfield dop-lite | Higgsfield dop-turbo | **Veo 3.1 Fast (chosen)** |
|---|---|---|---|
| Character motion | Sway/idle only | Sharper but morphs | **Real dance poses, expressions, blinks** |
| Instruction following | Poor | Poor (invented a 5th character) | **Held banana count ~80% of clip** |
| Known flaw | Count drift, morphs | Trunk shrank to pig snout | Final ~1s drifts → **trim to first 7s** (implemented) |
| Cost / clip | $0.55 | ~$1.10 | $0.96 (8s @ $0.12/s, 1080p 9:16) |

## 5. Prioritized fixes

1. ✅ DONE: Veo 3.1 Fast as preferred engine (adapter live, key validated,
   tail-trim implemented). Biggest single quality jump available.
2. ✅ DONE: regenerate-on-defect (never static fallback), count-freeze
   choreography, beat-aligned cuts, freeze-hold elimination, duplicate-
   execution claim guard.
3. NEXT: structured shot plan v2 — per-scene `framing` (wide/medium/
   close-up) + `cameraMove` (push-in/pan/hold) emitted by the script agent
   and compiled into motion prompts; close-up scenes on choruses.
4. NEXT: lip-sync pass for one hero close-up per video (Hedra-class
   vendor; needs a key + cost approval).
5. LATER: Blender rig track for true layered/keyframed animation
   (ANIMATION-2.0.md Phases 3–4; owner decisions pending on render host).
