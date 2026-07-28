# Active workstreams ledger

One row per Claude session/workstream. **Add your row when you start; update Status when you
land or stop.** Keep rows append-only (edit only your own row) — this file is how simultaneous
sessions avoid stepping on each other. See CLAUDE.md for the full collaboration protocol.

| Workstream                                                                            | Branch                               | Owns (paths)                                                                                                          | Status                                                            |
| ------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Love Villa: Nations (AI TikTok show: pipeline, dashboard app page, TikTok publishing) | `claude/ai-video-tiktok-app-2e3voe`  | `apps/love-villa/**`, `apps/web/**/love-villa*`, `apps/web/public/love-villa/**`, `packages/shared/src/love-villa.ts` | Active — episode 1 shipped (narrator format); episodes 2+ pending |
| Zoo Shorts / kids-shorts (platform's first business)                                  | (various, pre-dates ledger)          | `packages/workflows/src/functions/zoo-*`, kids-shorts dashboard surfaces, `packages/shared/src/zoo-cast.ts`           | Active                                                            |
| Listing factory (real-estate videos)                                                  | (see recent merges on deploy branch) | `packages/workflows/src/listing-factory/**`                                                                           | Active                                                            |

Shared surfaces (seed, prisma schema, dashboard home page, shared UI): additive-only edits per
CLAUDE.md — no single owner.
