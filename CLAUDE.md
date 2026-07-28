# Business Factory — shared repo, multiple Claude sessions

Several Claude sessions (Zoo Shorts / Love Villa / Listing Video Factory) work in this repo
**simultaneously** on separate branches, but they share ONE Vercel project: **every production
deploy replaces the whole site for everyone.** These rules make sessions piggyback off each
other instead of competing. Follow them in every session.

## Branch model

- **Deploy branch: `claude/ai-business-factory-platform-12estn`** — Vercel serves production
  (business-factory-woad.vercel.app) from it. Treat it as `main`.
- Develop on your own `claude/<topic>-<id>` feature branch. Never commit work directly on the
  deploy branch — it only receives merges.
- **Never force-push or rewrite history on the deploy branch.** Merge commits are expected and
  fine.
- **Converge before you deploy.** Before any production deployment, merge the other active
  session branches into yours so a deploy never silently reverts a sibling's production fixes
  or strands their in-flight workflow runs. Active branches:
  - `claude/ai-business-factory-platform-12estn` (platform + Zoo Shorts; also the deploy branch)
  - `claude/ai-business-factory-real-estate-3gkuep` (Listing Video Factory)
  - `claude/ai-video-tiktok-app-2e3voe` (Love Villa: Nations)

## Landing work on the deploy branch (the safe dance)

Use `node scripts/sync-deploy.mjs` (does all of this), or by hand:

1. `git fetch origin claude/ai-business-factory-platform-12estn`
2. Merge the deploy branch INTO your feature branch first; resolve conflicts there.
3. Run `pnpm db:generate && pnpm typecheck` (and `pnpm --filter @bf/web typecheck` if you touched
   web) on the merged result.
4. Merge your branch into the deploy branch with `--no-ff`, push, switch back.
5. If the push is rejected (another session landed first): pull, re-run typecheck, push again.
   Never `--force`.

## Avoiding collisions with concurrent sessions

- **Check the ledger first**: `docs/SESSIONS.md` lists active workstreams and which paths they
  own. Add/update your row when you start or finish a workstream.
- **Own your lane.** Prefer creating new files/modules over editing shared ones. Don't edit
  another session's pipeline code except via merges. Current lanes:
  - `apps/love-villa/**` — Love Villa: Nations pipeline
  - `packages/workflows/src/listing-factory/**` — Listing Video Factory
  - `packages/workflows/src/functions/zoo-*` + kids-shorts surfaces — Zoo Shorts
- **Shared surfaces** (`packages/database/prisma/seed.ts`, `schema.prisma`,
  `apps/web/src/app/(dashboard)/**` shared pages, `packages/shared/src/index.ts`,
  `packages/config`): make **additive, idempotent** changes only — append your own
  block/module/upsert; never rewrite or reorder another workstream's block. Seed code must stay
  safe to run repeatedly.
- **Prisma schema**: only add models/fields; never rename or delete another lane's models. After
  schema changes run `pnpm db:generate` so other sessions' typechecks pass, and create a
  migration (`pnpm db:migrate`) rather than editing existing ones. `prisma migrate` runs over
  the direct (non-pooling) connection with a stale-advisory-lock buster (see
  `scripts/deploy-db.mjs`) — don't bypass it.
- **Don't reformat files you didn't functionally change** (no repo-wide prettier runs) — it
  creates artificial conflicts between sessions.
- **Never commit build artifacts or secrets**: `*.tsbuildinfo`, `.next/`, `dist/`,
  `apps/love-villa/output|assets`, `.env*` (except `.env.example`), `data/tiktok-tokens.json`.
  If a generated file shows up in `git status`, gitignore it instead of committing it.
- **A merge conflict in a generated/artifact file** is always resolved by deleting or
  regenerating the file, never by hand-merging its content.

## Production invariants (don't "simplify" these away)

- **Never delete `scene-render-` blobs** (StorageBlob keys containing `/scene-render-`). They
  are the Zoo pipeline's resumable-encode progress; pruning them mid-run strands the run. The
  storage maintenance route already excludes them — keep that exclusion.
- **Serverless constraints that shaped the Zoo renderer**: 300s invocation cap, throttled
  post-response CPU, so scene renders persist to storage as they finish and the final stitch is
  a stream-copy concat. Workflow steps self-dispatch via `/api/internal/advance` (HMAC), and
  stuck runs self-heal via the runs API.
- **`AUTH_DISABLED=1` (production)**: owner asked for no login page. Both the middleware and
  `getOrgContext` honor it — keep it working after merges.

## Quality gates before any push

- `pnpm typecheck` for touched packages; `npx eslint` on files you changed.
- If you changed `packages/shared`, `packages/database`, or anything imported by `@bf/web`,
  run `pnpm --filter @bf/web typecheck` — the deploy branch must always build on Vercel.

## Databases, costs & external state

- The production DB is shared. Seed/lazy-registration code must be idempotent upserts keyed on
  stable keys (`organizationId_key`) so any session's deploy can run it safely.
- Platform cost limits: $15/day, $100/month hard stops (owner-approved levels).
- Love Villa's cost-metered providers (OpenAI/ElevenLabs/fal/Anthropic keys in
  `apps/love-villa/.env`) are budget-guarded at $5/episode; don't remove the guards.
