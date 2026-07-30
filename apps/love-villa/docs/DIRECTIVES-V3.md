# V3 Directives — owner mandate 2026-07-29 (WRITTEN, NOT YET EXECUTED)

A prompt from Claude to Claude. The owner reviewed the finished episodes and ordered four
independent fixes plus a spending freeze: **no paid API calls until the owner approves
executing these directives** (start with one ~$0.50 test scene, then one test episode).
Each directive stands alone — implement and evaluate them independently.

---

## Directive 1 — Scripts: the plot must be entertaining, not just structured

**Diagnosis.** Current scripts are structurally correct (hook/escalation/twist) but the
_stories_ are thin: a mild misunderstanding, stated stakes, no surprise a viewer couldn't
predict by second 15. Structure passed the rubric; entertainment didn't.

**Fix spec.**

- Story-first generation: before writing scenes, generate 3 one-paragraph PITCHES for the
  episode beat and pick the one with the strongest "wait, WHAT?" turn. A pitch must contain:
  a want, a lie or secret, a public collision, and a reversal that recontextualizes an earlier
  moment. No pitch, no script.
- Every scene must change someone's status (who's winning) — if the winner is the same before
  and after a scene, cut or rewrite it.
- The twist must be a REVERSAL (the thing we believed was false), not an escalation
  (the thing we knew, but bigger).
- Steal proven shapes, not content: love-triangle bait-and-switch, public humiliation flipped
  into triumph, the wrong person overhears, the alliance that betrays both sides.
- Comedy comes from character collision (Greta scheduling a heartbreak; Élodie rating her own
  tears) — not from the narrator explaining that something is funny.
- Acceptance: a cold read of the script by a reviewer who must answer "would you watch the
  next episode?" — anything under "yes, immediately" fails.

## Directive 2 — Camera: kill the pan-then-snap-back loop

**Diagnosis (measured).** Each scene is one 5s image-to-video clip looped 2–4× to cover
11–20s of dialogue. The clip's internal camera drifts, then the loop restarts at frame 0 —
a visible snap back to the starting framing, several times per scene. Confirmed in
episode 2's render plan: loops of 2.2×–4.0× on every scene.

**Fix spec (in preference order; combine as needed).**

1. **Ping-pong playback**: play the clip forward then reversed instead of hard-looping.
   Zero cost, removes every snap. (Reverse motion is subtle at candy-gloss energy levels.)
2. **Cut scenes to the footage, not footage to the scenes**: split any scene longer than
   ~8s into two shots with different framings (wide → close-up) so each shot plays a clip
   at most ~1.5× — and a CUT between framings is cinematic language, while a LOOP is a glitch.
3. **Motion prompts must demand a static or completed camera move**: "locked-off camera" or
   "slow push-in that settles" — never an unfinished pan; a settled clip loops invisibly.
4. Remove the per-line punch-in on clip scenes entirely (it stacks with clip drift).

- Acceptance: watch every scene boundary and loop point at 0.5× speed — zero visible
  position snaps in the whole episode.

## Directive 3 — Backgrounds: environments, not wallpaper

**Diagnosis.** Location art is generated once as a pretty postcard, then reused as a flat
backdrop for every scene at that location. It reads as wallpaper: same framing every time,
no relationship to what's happening, characters pasted in front.

**Fix spec.**

- Kill the shared-backdrop model: generate ONE full still PER SCENE that paints the
  characters INTO the environment (image-edit call with character reference images + the
  location reference as inputs), so lighting, shadows, scale, and props are unified.
- Scene stills must be composed for the action: the visual field dictates framing (close on
  faces for a confessional, wide for a group reveal), not a fixed location crop.
- Location reference art becomes a STYLE reference (palette + geography) rather than the
  literal backdrop.
- Time-of-day must progress within an episode (morning kitchen → noon pool → dusk firepit
  → night terrace) so backgrounds tell time like a real show.
- Acceptance: no two scenes in an episode share an identical background crop; characters
  cast shadows consistent with the scene's key light.

## Directive 4 — Character animation: dial the motion way down

**Diagnosis.** Animation quality is decent but EVERYTHING moves at maximum amplitude —
huge gestures, constant swaying, cloth billowing indoors. Reads as AI churn, not acting.

**Fix spec.**

- Motion prompts: replace "expressive, they gesture and react" with "SUBTLE: small head
  turns, blinks, breathing; ONE deliberate gesture per clip at most; everyone else nearly
  still". Stillness is what makes the one gesture read as acting.
- Motion intensity must map to the beat: confessionals nearly static; arguments get the
  budgeted gesture; only the twist gets full energy.
- Ask the i2v provider for lower motion strength where the model supports it
  (cfg/motion-scale parameter) instead of prompting against its defaults.
- Remove the Remotion bob/sway on composited characters (idle sinusoidal motion is the
  definition of AI churn).
- Acceptance: in any 5s clip, at most one intentional movement per character; a paused
  frame at any timestamp looks composed, not mid-flail.

---

## Execution protocol (when the owner un-freezes)

1. Implement all four directives in code/prompts (free).
2. ONE test scene end-to-end (~$0.50) → owner reviews.
3. On approval: one full test episode → Creative Director + Quality Director must both pass
   it → owner reviews before it is published or deployed anywhere.
4. Only then does regular production resume.
