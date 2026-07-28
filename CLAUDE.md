# Business Factory — shared repo, multiple Claude sessions

Several Claude sessions (Zoo Shorts / Love Villa / Listing Video Factory)
work in this repo on separate branches, but they share ONE Vercel project:
**every production deploy replaces the whole site for everyone.**

## Coordination rules (all sessions MUST follow)

1. **Converge before you deploy.** Before any production deployment, merge
   the other active session branches into yours (and push the merge back to
   their branches so history stays shared):
   - `claude/ai-business-factory-platform-12estn` (platform + Zoo Shorts)
   - `claude/ai-business-factory-real-estate-3gkuep` (Listing Video Factory)
   Deploying a branch that lacks a sibling's latest work silently reverts
   their production fixes and can strand their in-flight workflow runs.

2. **Never delete `scene-render-` blobs** (StorageBlob keys containing
   `/scene-render-`). They are the Zoo pipeline's resumable-encode progress;
   pruning them mid-run strands the run. The storage maintenance route
   already excludes them — keep that exclusion.

3. **Don't edit another session's pipeline code** (`packages/workflows/src/functions/zoo-render.ts`,
   `apps/love-villa/**`, `packages/workflows/src/listing-factory/**`) except
   via merges. Shared packages (`packages/shared`, `packages/config`,
   `packages/database`) are append-friendly: add, don't rewrite.

4. **Database migrations & seeds are shared.** `prisma migrate` runs over the
   direct (non-pooling) connection with a stale-advisory-lock buster (see
   `scripts/deploy-db.mjs`) — don't bypass it. Seeds must stay idempotent.

5. **Serverless constraints that shaped the Zoo renderer** (don't "simplify"
   them away): 300s invocation cap, throttled post-response CPU, so scene
   renders persist to storage as they finish and the final stitch is a
   stream-copy concat. Workflow steps self-dispatch via
   `/api/internal/advance` (HMAC), and stuck runs self-heal via the runs API.

## Env notes

- `AUTH_DISABLED=1` (production): owner asked for no login page. Both the
  middleware and `getOrgContext` honor it — keep it working after merges.
- Cost limits: $15/day, $100/month hard stops (owner-approved levels).
