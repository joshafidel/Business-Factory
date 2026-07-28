# Session registry & coordination protocol

Several Claude sessions build this repo **at the same time** on separate
branches, sharing one production deployment. This file is the contract that
lets them piggyback off each other instead of competing. Every session must
read it before touching code, and update it when it claims new territory.

## Registry

| Session | Branch | Owns (exclusive write access) |
| --- | --- | --- |
| Platform + Zoo Shorts | `claude/ai-business-factory-platform-12estn` | `packages/workflows/src/functions/zoo-render.ts`, zoo pipeline workflow defs, platform plumbing |
| Love Villa | `claude/ai-video-tiktok-app-2e3voe` | `apps/love-villa/**`, `apps/web/public/love-villa/**` |
| Listing Video Factory | `claude/ai-business-factory-real-estate-3gkuep` | `packages/workflows/src/listing-factory/**`, `apps/web/src/app/(dashboard)/apps/listing-video-factory/**`, `apps/web/src/app/api/listing-factory/**` |
| Mobile & shared UI | `claude/factory-mobile-redesign-kkq0qa` | `apps/web/src/components/dashboard-shell.tsx`, `logo.tsx`, `media-actions.tsx`, `asset-preview.tsx`, app icons/manifest, `(dashboard)/layout.tsx` |

Everything not listed is **shared surface**: change it additively, never
rewrite it out from under a sibling. New sessions: add a row here (via your
own branch) before claiming files.

## The protocol (all sessions)

1. **Start of every work session**
   `node scripts/sync-sessions.mjs` — merges every sibling `claude/*`
   branch into yours. You now build on everyone's latest work.

2. **Before every push that can reach production**
   Run the sync again (siblings may have pushed while you worked). The
   shared Vercel project deploys whole branches — a push that lacks a
   sibling's latest work silently reverts their production fixes.
   `node scripts/sync-sessions.mjs --check` exits non-zero if you're behind
   (useful as a pre-deploy gate).

3. **After merging, optionally share history back**
   `node scripts/sync-sessions.mjs --push-back` fast-forwards each sibling
   branch to the merged head so everyone's next sync is trivial. Skip it if
   your branch carries risky work-in-progress you don't want deployed by a
   sibling yet.

4. **Merge conflicts** are resolved by ownership, not by preference:
   - file owned by the other session → take **their** side, then re-apply
     your intent additively;
   - file owned by you → keep **yours**, but read their diff and fold in
     what they were trying to achieve;
   - shared file → keep **both** changes (these should be additive by rule).

5. **Never** edit another session's owned paths directly — ask via a TODO
   comment or an addition in a shared file instead. Exception: mechanical,
   behavior-preserving fixes needed to keep the build green (typecheck/lint),
   kept as small as possible.

## Shared-surface rules (unchanged from CLAUDE.md, restated)

- `packages/shared`, `packages/config`, `packages/database` are
  append-friendly: add exports/models, don't rewrite or remove.
- Database migrations & seeds are shared; seeds must stay idempotent;
  always go through `scripts/deploy-db.mjs` (advisory-lock buster).
- Never delete `scene-render-` blobs (Zoo resumable-encode progress).
- `AUTH_DISABLED=1` must keep working (middleware + `getOrgContext`).
- Cost limits: $15/day, $100/month hard stops.
- The mobile shell (`dashboard-shell.tsx`) wraps every dashboard page —
  test your pages at 390 px width; don't reintroduce fixed-width layouts.

## Why merge-based (not rebase)

Merges keep every session's commits intact so `--is-ancestor` checks work
and no session ever force-pushes over another's history. Never rebase or
force-push a shared `claude/*` branch (`--force-with-lease` included),
except the documented restart-after-PR-merge case.
