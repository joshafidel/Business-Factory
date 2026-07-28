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
- **Deploy ONLY via `node scripts/vercel-redeploy.mjs`.** It converges the active session
  branches (merges all tips, pushes the converged commit back to every branch) and only then
  creates the production deployment. On merge conflict it ABORTS — resolve the cross-session
  merge first, then rerun. Never call the Vercel deployments API directly: a deploy from a
  branch that lacks a sibling's work silently reverts their production fixes and can strand
  their in-flight workflow runs. Active branches:
  - `claude/ai-business-factory-platform-12estn` (platform + Zoo Shorts; also the deploy branch)
  - `claude/ai-business-factory-real-estate-3gkuep` (Listing Video Factory)
  - `claude/ai-video-tiktok-app-2e3voe` (Love Villa: Nations)

**Owner directive: always deploy to production.** Finished work doesn't sit
on a branch — after your quality gates pass, run
`node scripts/vercel-redeploy.mjs` (it converges all session branches first)
so the owner sees the work live. Then smoke-check the other apps' pages
(rule 10 below).

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
- **Converge at session start**: `node scripts/sync-sessions.mjs` (or `pnpm sync`) fetches and
  merges every sibling `claude/*` branch into your branch so you build on everyone's latest
  work; `--check` exits non-zero if you're behind (pre-push/pre-deploy gate), `--push-back`
  fast-forwards the siblings to the merged head. Complementary to `scripts/sync-deploy.mjs`,
  which lands your branch on the deploy branch.
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

## Piggyback, don't compete (owner directive)

Sessions run simultaneously. The owner's rule: **build on each other's work,
never around it.** Concretely:

6. **Sync before every push, not just before deploys.** `git fetch origin
   <your-branch> && git merge --ff-only` (or a real merge if diverged) before
   committing on top. Never force-push a shared branch. If your deploy loses a
   race (another session's deploy finished after yours), merge and redeploy —
   the fix is convergence, not a bigger hammer.

7. **Reuse the shared toolbox before building your own.** Existing, tested
   capabilities any session should lean on (grep before you reinvent):
   - `packages/workflows/src/functions/media-utils.ts` — `resolveFfmpeg`,
     `mp3DurationSeconds`, `pcmToWav`, `publicBaseUrl`.
   - `/api/assets/raw` — org-checked asset streaming **with HTTP Range
     support** (use it for any media playback; don't add parallel endpoints).
   - `/api/assets/public` + `signAssetToken` — short-lived signed URLs for
     external fetchers (Higgsfield, Picsart, …).
   - Stuck-run self-healing — `/api/runs/[id]` and
     `/api/listing-factory/renders/[renderId]` re-dispatch steps stuck
     RUNNING > 7 min. Copy that pattern into any new polling endpoint.
   - `/api/maintenance/storage` (Owner) — usage report + prune of regenerable
     media + VACUUM. Respect its exclusions (rule 2).
   - Runtime installers (`ensure*Installed` with a manifest version marker) —
     modules must self-install on first page/API touch; never rely on the
     one-time seed for prod.
   - Media/AI providers in `packages/providers` — OpenAI image/TTS,
     ElevenLabs voice/music, Higgsfield i2v (+ retry patience), Picsart GenAI
     adapter, cost tables. Extend the registry; don't fork per app.
   - `recordCost` + workflow `costLimitMicroUsd` — every paid call goes
     through the ledger so the shared $15/day cap actually protects everyone.
   - Mobile shell & media UI — every dashboard page renders inside
     `apps/web/src/components/dashboard-shell.tsx` (drawer sidebar + bottom
     tabs on phones; fixed rail on lg+). Reuse `MediaActions` (download +
     save-to-camera-roll via Web Share) and `AssetPreview` (inline
     video/image player + actions) instead of hand-rolling media links;
     `/api/assets/raw?id=…&download=1` serves attachment downloads.
8. **Announce new shared capabilities here.** If you build something another
   session could use, add one line to the toolbox list above in the same PR.
9. **Database is a shared 512MB Neon budget.** Media bytes live in Postgres
   (DbStorage) until S3/R2 lands — keep intermediates prunable (asset
   `metadata.role` and `source` set), clean up after failed runs, and prefer
   external URLs over copying bytes when a provider hosts output. Schema
   changes: additive migrations only; never rename/drop another session's
   tables or columns.
10. **Deploys are whole-site releases.** After your deploy goes READY, load
    the OTHER apps' dashboards once (`/apps/kids-shorts`, `/apps/love-villa`,
    `/apps/listing-video-factory`) — a 500 on a sibling page means your
    deploy broke them: fix forward immediately or redeploy the previous
    merged commit.

## UI conventions (owner uses the dashboard from a phone)

- The site installs to home screens (PWA manifest + icons; branding source in
  `apps/web/public/logo.svg`, inline mark in `apps/web/src/components/logo.tsx`).
  Keep icon/manifest changes in the mobile session's lane.
- Don't reintroduce fixed-width/desktop-only layouts; sanity-check new pages at
  390px wide. Wide content (tables, JSON dumps) needs its own `overflow-x-auto`.
- Every video surfaced in the UI must be downloadable (and savable to the
  camera roll) — wire `MediaActions`/`AssetPreview` when you add media.

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
- **Visual QA gate (Zoo Shorts)**: every still and motion clip is machine-inspected for
  AI-generation defects (extra limbs/trunks, vanishing props, garbled text) — see
  `docs/animation/VISUAL-QA.md`. Never remove the gate. Before APPROVING any Zoo Shorts
  video, a session must read the run's `stillQa`/`clipQa` outputs AND extract frames from
  the final video and apply the checklist itself; any visible critical defect → reject the
  approval and rerun until clean. Owner mandate (2026-07-28): no video ships that "looks AI".
- **Every scene must be truly animated (owner mandate 2026-07-28, "never do that again")**:
  static Ken Burns scenes and freeze-hold padding are BANNED as quality degradation. A
  QA-rejected or failed clip is REGENERATED (defects fed back into the motion prompt, up to
  3 tries/scene, 10 submissions/run) — never silently replaced by a still. `animationFallbacks`
  in the assemble output lists any scene that exhausted its budget; a non-empty list means
  the video needs extra scrutiny before approval, and more than one fallback scene → reject.

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
