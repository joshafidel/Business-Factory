# Visual QA Gate (Animation 2.0)

Automatic defect inspection for every Zoo Shorts asset. Added after a
published video shipped with an elephant growing a second trunk out of its
cheek and a bucket that vanished mid-scene — the two canonical AI-generation
tells. Nothing in the pipeline was looking at the pixels; now something is.

## Where it runs (all automatic, every run)

| Stage | What's inspected | On failure |
|---|---|---|
| `render` step | Every scene still (1 downscaled frame) | Regenerated once with the specific defects fed back into the prompt; best-scoring attempt wins |
| `assemble` step | Every downloaded motion clip (6 frames sampled across the clip) | Clip is **rejected and the animation is REGENERATED** with the defects appended to the motion prompt (up to 3 tries/scene, 10 submissions/run). Static fallback is a last resort only, reported in `animationFallbacks` |
| Approval | `stillQa` / `clipQa` / `animationFallbacks` in step outputs + final review of extracted frames | Reject the approval; rerun the pipeline |

**Motion quality bar (owner mandate 2026-07-28):** every scene must be truly
animated — NunuTV/Cocomelon energy. Static Ken Burns scenes and freeze-hold
padding are banned; the video's duration is sized to what real animation can
cover and the song fades at that cap.

Critic model: `gpt-4o`, temperature 0, JSON verdict, ~$0.01 per inspection
(~$0.15–0.30 per video). Fail-open: a vision-API outage passes assets through
rather than wedging the pipeline (defects are recoverable at approval; a
wedged run is not).

## The standing QA prompt

The canonical text lives in `packages/providers/src/vision-qa.ts`
(`VISUAL_QA_PROMPT`) and is reproduced here so every session and reviewer
applies the same bar:

> You are a ruthless senior animation QA reviewer for a children's studio.
> Your job is to catch every visual defect that would reveal this image/clip
> as AI-generated. Toddler-cartoon stylization (big eyes, pastel colors,
> simplified shapes) is the INTENDED style — never flag it. Flag REAL defects
> only.
>
> CHECK EVERY FRAME FOR:
> 1. **ANATOMY** — each animal has exactly the right body parts for its
>    species: ONE trunk per elephant, ONE tail, TWO ears, TWO eyes, FOUR legs
>    (or two arms + two legs when standing cartoon-style). No extra, missing,
>    fused, or detached limbs/trunks/tails. No hands growing from wrong
>    places. No second face. Mouths and eyes well-formed.
> 2. **OBJECT PERMANENCE** (multi-frame clips) — every prop visible in one
>    frame must exist in the others unless it plausibly moved off-screen:
>    buckets, brushes, toys, food must NOT vanish, appear from nowhere,
>    teleport, or morph into different objects. Characters must not
>    appear/disappear mid-clip.
> 3. **GEOMETRY & PHYSICS** — no melting or smearing shapes, no body parts
>    passing through objects or each other, no floating detached objects, no
>    impossible bends, water/bubbles behave plausibly for a cartoon.
> 4. **IDENTITY** — the same character keeps identical colors, proportions
>    and design in every frame (no color shifts, no turning into a different
>    animal).
> 5. **RENDERING ARTIFACTS** — no garbled text or pseudo-letters anywhere
>    (signs, arches, labels), no watermarks, no ghosting/double exposure, no
>    random noise patches, no severed cropping of a main character's face.
> 6. **COMPOSITION** — main characters fully in frame and readable; no
>    unintended horror-adjacent look (dead eyes, unsettling grins).
>
> A defect is **critical** if a parent watching would think "that's wrong /
> AI-made". Zero critical defects = publishable. Be strict: a missed defect
> ships to YouTube; a false positive only costs one cheap regeneration.

## Approval rule (binding on every session — see CLAUDE.md)

Before approving any Zoo Shorts video:

1. Read `stillQa` (render output) and `clipQa` (assemble output). Any scene
   with `rejected: true` or a critical defect that survived retries → look at
   that scene's frames yourself before deciding.
2. Download the final video, extract ≥6 frames spread across it, and apply
   the checklist above yourself (the model that generated cannot be the only
   judge of what it generated).
3. If any critical defect is visible: **reject** the approval with the defect
   named, and start a fresh run. Repeat until a run passes. Never approve a
   video you haven't looked at frame-by-frame.
