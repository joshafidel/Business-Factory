# Business Factory — shared repo, multiple Claude sessions

Several Claude sessions (Zoo Shorts / Love Villa / Listing Video Factory)
work in this repo on separate branches, but they share ONE Vercel project:
**every production deploy replaces the whole site for everyone.**

## Coordination rules (all sessions MUST follow)

**The full protocol + session/branch/ownership registry lives in
`docs/SESSIONS.md` — read it first.** The one-command version:

```
node scripts/sync-sessions.mjs            # start of session: build on everyone's latest
node scripts/sync-sessions.mjs --check    # pre-deploy gate: fails if you're behind a sibling
node scripts/sync-sessions.mjs --push-back  # optional: share merged history back
```

1. **Converge before you deploy.** Before any production deployment, run
   `node scripts/sync-sessions.mjs` — it fetches and merges every other
   active `claude/*` session branch into yours (and `--push-back` pushes
   the merge back so history stays shared).
   Deploying a branch that lacks a sibling's latest work silently reverts
   their production fixes and can strand their in-flight workflow runs.

2. **Never delete `scene-render-` blobs** (StorageBlob keys containing
   `/scene-render-`). They are the Zoo pipeline's resumable-encode progress;
   pruning them mid-run strands the run. The storage maintenance route
   already excludes them — keep that exclusion.

3. **Don't edit another session's owned paths** (ownership map in
   `docs/SESSIONS.md`) except via merges. Shared packages
   (`packages/shared`, `packages/config`, `packages/database`) are
   append-friendly: add, don't rewrite. Conflicts resolve by ownership:
   their file → their side; your file → your side; shared → keep both.

4. **Database migrations & seeds are shared.** `prisma migrate` runs over the
   direct (non-pooling) connection with a stale-advisory-lock buster (see
   `scripts/deploy-db.mjs`) — don't bypass it. Seeds must stay idempotent.

5. **Serverless constraints that shaped the Zoo renderer** (don't "simplify"
   them away): 300s invocation cap, throttled post-response CPU, so scene
   renders persist to storage as they finish and the final stitch is a
   stream-copy concat. Workflow steps self-dispatch via
   `/api/internal/advance` (HMAC), and stuck runs self-heal via the runs API.

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

## Mobile shell (owner uses the dashboard from a phone)

- Every dashboard page renders inside `apps/web/src/components/dashboard-shell.tsx`
  (mobile drawer + bottom tabs, desktop fixed sidebar). Don't reintroduce
  fixed-width/desktop-only layouts; sanity-check new pages at 390px wide.
- Videos must stay downloadable: serve bytes via `/api/assets/raw?id=…`
  (supports `&download=1`) and reuse `MediaActions` / `AssetPreview`
  components for download + save-to-camera-roll buttons.

## Env notes

- `AUTH_DISABLED=1` (production): owner asked for no login page. Both the
  middleware and `getOrgContext` honor it — keep it working after merges.
- Cost limits: $15/day, $100/month hard stops (owner-approved levels).
