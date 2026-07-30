# Production Standards Charter (owner-adopted 2026-07-29)

Distilled from the owner's external production blueprint. Rule of adoption: **add, never
demolish** — existing infrastructure stays; the blueprint's ideas are layered on top. The
Standards Officer (`src/quality/standards-officer.ts`) enforces the measurable parts of this
charter on every episode.

## The employee roster (all live in `src/quality/`)

| Employee              | Question it answers               | Blueprint roles it covers                          |
| --------------------- | --------------------------------- | -------------------------------------------------- |
| **Quality Director**  | Is it broken?                     | Render/QC agent (defects, audio, consistency)      |
| **Creative Director** | Is it good?                       | Showrunner taste, animation-director standards     |
| **Standards Officer** | Does it meet the charter, always? | Scoring thresholds, cultural review, writing rules |

Existing pipeline modules already play the other blueprint roles: episode-generator =
plot/scriptwriter; continuity-checker = continuity editor; shot-list = storyboard;
produce-episode = animation director + asset manager; voice-map + delivery notes = voice
director; publish-episode = publishing agent (approval-gated, never auto-public).

## Hard scoring gates (Standards Officer, per episode)

Sixteen axes scored 1–10: opening hook, plot clarity, character consistency, dialogue,
humor, emotional stakes, animation smoothness, facial acting, lip/voice sync feel, camera
work, sound design, subtitle readability, visual continuity, cultural treatment,
cliffhanger, rewatch potential.

**Automatic rejection if:** overall average < 8 · animation consistency < 8 · character
consistency < 9 · cultural treatment < 9 · hook < 8.

## Adopted now (changes existing behavior)

- **Runtime target: 35–60 seconds** (was 60–90). Shorter, denser episodes; the pacing air
  stays, the word budget shrinks.
- **Engagement endings**: a natural audience question ("Who should Élodie choose?") — never
  a generic "like and follow" line. Checked deterministically.
- **Per-episode writing invariants** (checked): one central conflict; ≥1 confessional or
  private conversation; ≥1 pure reaction beat; ends unresolved (question); understandable
  cold but rewards followers; no exposition dumps; characters must not share a rhythm.
- **Cultural comedy lanes** (cultural-review axis): food, fashion, music, sports, weather,
  nightlife, transport, dating customs, work habits, tourism, architecture, playful
  rivalries, pop culture, famous cities, common phrases, etiquette. Never: racist features,
  skin-color jokes, religious mockery, slurs, colonial/poverty/terrorism stereotypes, or
  "all people from X are Y". One country must never be consistently inferior.
- **Character bible expansion** (apply at next cast touch, additively): silhouette notes,
  facial-expression library, animation mannerisms, per-character forbidden topics,
  relationship map to every other cast member, prop list.
- **Season architecture beats** (fold into season arc as episodes progress): first jealousy,
  first secret alliance, first betrayal, love triangle, friendship breakup, surprise
  arrival, audience-influenced decision, recoupling, elimination, returning contestant,
  fake rumor vs genuine secret, finale choice.

## Adopted as roadmap (needs owner-approved spend or new accounts)

- **Rig-based animation core** (Blender + reusable rigs + phoneme lip-sync, generative video
  demoted to backgrounds/transitions). The blueprint is right that text-to-video is the
  character-consistency ceiling — this is the Phase-Prototype decision AFTER the V3 test
  scene verdict: if painted-still + i2v still fails character consistency, the rig pipeline
  is the next architecture. Estimated: days of build, near-zero marginal render cost after.
- **Analytics employee** (retention, drop-off timestamps, hook performance → recommendations
  that never rewrite established characters for one video): needs TikTok audit + analytics
  API access.
- **Asset registry with permanent IDs + versions** across lanes (fits the existing
  packages/storage layer).

## Explicitly NOT adopted (with reasons)

- **Renaming/rebranding the show**: "Love Villa: Nations" has two published episodes and a
  connected TikTok account; identity churn resets the audience. (The blueprint's 20-title
  exercise is moot — the show exists.)
- **Recasting to its suggested lineup**: our 9-country cast is locked canon. Japan and
  Nigeria enter the roster as FUTURE ARRIVALS (the season already has an arrival mechanic)
  rather than replacing anyone.
- **Blueprint repo layout**: ideas map into the existing monorepo lanes; moving files for
  cosmetics creates cross-session merge chaos (CLAUDE.md rule: don't reformat what you
  didn't change).

## Standing constraints (unchanged by the blueprint)

- Spending freeze until the owner approves the V3 test scene (docs/DIRECTIVES-V3.md).
- Nothing publishes or deploys without the human approval gates already in place.
- All owner mandates in DIRECTIVES-V3.md remain in force.
