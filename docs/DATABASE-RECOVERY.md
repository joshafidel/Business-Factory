# Database outage recovery guide (Neon Postgres)

Written 2026-07-28 during the outage that took production down. The whole site
(business-factory-woad.vercel.app) runs on one Neon Postgres database; when it is
unreachable every page 500s and deploys fail at `prisma migrate deploy` with
`P1001: Can't reach database server`.

## Step 1 — See what Neon says (2 min)

1. Go to <https://console.neon.tech> and log in (use the account the database was
   created with — if you created it through Vercel, log in at
   <https://vercel.com> → your project → **Storage** tab → the Neon database →
   **Open in Neon Console**).
2. Open the project (database name: `neondb`).
3. Read the banner at the top of the project page. It will tell you which case
   you're in:

| What the banner says                             | Case                      |
| ------------------------------------------------ | ------------------------- |
| "Storage limit exceeded" / usage bar at 100%     | **A — storage full**      |
| "Payment failed" / "Update billing"              | **B — billing**           |
| "Compute suspended" with a Resume/Restart button | **C — suspended compute** |
| No banner, everything green                      | **D — something subtler** |

Also check the usage gauges: **Project → Monitoring** (or **Usage**) shows
storage GB and compute hours against your plan limits.

## Step 2 — Fix by case

### Case A — storage full (most likely)

The free tier caps storage at 512MB, and this platform currently stores media
bytes (video chunks, photos, generated assets) IN the database. Three AI
sessions generating media in one day can blow the cap. Two ways out:

**Option 1 (recommended): upgrade the plan.**
Project → **Billing/Upgrade** → pick the paid tier (usage-based; pricing:
<https://neon.tech/pricing>). Storage limit lifts immediately and the database
resumes on its own. At current usage this is dollars, not tens of dollars, per
month — and it prevents a repeat.

**Option 2: free space without upgrading.**
Only possible if the database still accepts connections (some over-quota states
allow reads/deletes). Once _any_ page of the site loads again, tell Claude
"database is back, prune storage" — the platform has a built-in cleaner at
`/api/maintenance/storage` (Owner-only) that deletes regenerable media
(respecting the Zoo pipeline's protected `scene-render-` blobs) and VACUUMs.
If no connections are accepted at all, Option 1 is the only path.

### Case B — billing

Update the payment method where the banner points (Neon console → Billing, or
Vercel → Settings → Billing if the database is Vercel-managed). The database
resumes automatically once payment clears.

### Case C — suspended compute

Click **Resume**/**Restart** on the compute endpoint (Project → **Branches** →
your branch → compute → restart). If it re-suspends within minutes, you're
actually in Case A — check the storage gauge.

### Case D — no banner, still broken

1. In the Neon console, open **SQL Editor** and run `select 1;` — if that works,
   Neon is fine and the problem is between Vercel and Neon (connection strings).
2. Check Vercel → Project → Settings → Environment Variables: `DATABASE_URL`
   and the `POSTGRES_*` group should exist and point at your Neon host. If the
   Neon integration was disconnected, re-link it: Vercel → Storage → Connect →
   Neon.
3. Check <https://neonstatus.com> for a platform incident in your region.
4. If none of that lands, Neon support: <https://neon.tech/docs/introduction/support>.

## Step 3 — After the fix, everything is automatic

A watchdog in the Claude session checks the site every hour. The moment the
database answers:

1. It redeploys the site (episode 2's dashboard update is committed and queued).
2. It smoke-checks /apps/kids-shorts, /apps/love-villa, /apps/listing-video-factory.
3. It verifies episode 2 appears in the Love Villa Watch section.

You don't need to tell anyone — but saying "database is back" to Claude makes it
happen immediately instead of on the next hourly tick (and triggers the storage
prune if you went with Option 2).

## Step 4 — Prevent a repeat (do this soon)

- **Root cause:** media bytes live in Postgres ("until S3/R2 lands" — see
  CLAUDE.md rule 9). A 512MB database is not a media store for three video
  pipelines. The durable fix is moving media blobs to object storage
  (Cloudflare R2 has a free tier ~10GB; S3 works too). Ask any session to
  prioritize the R2/S3 migration — the storage layer (`packages/storage`,
  DbStorage) was built to be swappable.
- Until then: keep the paid Neon tier as headroom, and run the
  `/api/maintenance/storage` prune whenever the usage gauge passes ~70%.

## What was NOT affected by this outage

- TikTok publishing (episodes 1 and 2 are posted on @love.villa.1, private) —
  it never touches this database.
- All episode videos, art, scripts, and code — safely committed in the git repo.
