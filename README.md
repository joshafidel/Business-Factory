# AI Business Factory

A production-ready, modular AI operations platform — the shared infrastructure
that will run multiple AI-assisted businesses (children's Shorts, dating-parody
videos, Amazon review videos, small-business websites, real-estate walkthrough
videos). **This repo contains the platform only; the businesses will plug in
later as isolated modules.**

Everything is real infrastructure: Postgres-backed domain models, a BullMQ
worker, a DB-driven workflow state machine, human approval gates, and enforced
cost limits. Where external APIs are not yet configured (Anthropic, OpenAI,
S3), safe local mocks and filesystem adapters keep the whole pipeline working
end-to-end with zero external spend.

- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Phased plan & checklist: [`docs/PLAN.md`](docs/PLAN.md)
- Listing Video Factory (real-estate tour videos):
  [`docs/LISTING_VIDEO_FACTORY.md`](docs/LISTING_VIDEO_FACTORY.md)

## Stack

Next.js 15 (App Router) · TypeScript (strict) · Tailwind CSS 4 · Prisma /
PostgreSQL 16 · Redis 7 / BullMQ · Auth.js v5 (credentials, JWT) · Zod ·
Vitest · Playwright · pnpm workspaces + Turborepo.

```
apps/web        Dashboard + API routes (deployable to Vercel with pooled PG)
apps/worker     Standalone queue worker (deploy anywhere Node runs)
packages/*      config, shared, database, storage, providers, prompts,
                notifications, agents, workflows, queue, analytics
```

## Quick start

Prereqs: Node ≥ 20, pnpm ≥ 9, Docker (for Postgres/Redis).

```bash
pnpm install
cp .env.example .env
# set AUTH_SECRET (openssl rand -base64 32)
# set SECRET_ENCRYPTION_KEY (openssl rand -hex 32)

pnpm infra:up          # postgres + redis via docker compose
pnpm db:migrate        # prisma migrate dev
pnpm db:seed           # demo org, users, agents, sample workflow

pnpm dev:web           # http://localhost:3000
pnpm dev:worker        # background worker (separate terminal)
```

Sign in with any seeded account (password `factory-dev-password`):

| Email                  | Role          |
| ---------------------- | ------------- |
| owner@factory.local    | Owner         |
| admin@factory.local    | Administrator |
| operator@factory.local | Operator      |
| reviewer@factory.local | Reviewer      |
| viewer@factory.local   | Viewer        |

### Try the sample workflow (safe, mock-only)

1. Sign in as `owner@factory.local` → **Workflows** → _Content Brief Pipeline_ → enter a topic → **Start run**.
2. Watch the run: research agent → writing agent → QC agent (all on the mock provider — $0.00).
3. The run parks at **AWAITING APPROVAL**; open the **Approval Inbox**, review the draft + QC score, and Approve / Reject / Request revision.
4. On approval the draft is saved to the **Asset Library**. Nothing is ever published externally.

## Commands

| Command                                                           | Purpose                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                                                        | web + worker together (turbo)                                 |
| `pnpm dev:web` / `pnpm dev:worker`                                | run one app                                                   |
| `pnpm build`                                                      | build all                                                     |
| `pnpm lint` / `pnpm format` / `pnpm typecheck`                    | quality gates                                                 |
| `pnpm test`                                                       | Vitest unit + integration tests (DB tests skip if PG is down) |
| `pnpm test:e2e`                                                   | Playwright end-to-end (needs infra + seed)                    |
| `pnpm db:migrate` / `db:migrate:deploy` / `db:push` / `db:studio` | Prisma                                                        |
| `pnpm db:seed`                                                    | idempotent seed                                               |
| `pnpm queue:clean`                                                | purge completed/failed queue jobs                             |
| `pnpm infra:up` / `infra:down`                                    | Postgres + Redis containers                                   |
| `docker compose --profile minio up -d`                            | optional S3-compatible MinIO                                  |

## How the platform is wired

**Agents** are versioned DB records (instructions, JSON I/O schemas, provider +
model, temperature, token/cost budget, retries, timeout, tool allow/deny
lists). The runner validates input → resolves the exact prompt version → checks
cost limits → calls the provider → validates structured output → records
usage/cost → retries recoverable errors → escalates failures. No unbounded
loops: every run has a goal, budget, and max steps.

**Workflows** are versioned step pipelines (`AGENT_TASK`, `API_CALL`,
`CODE_FUNCTION`, `TRANSFORM`, `FILE_GENERATION`, `HUMAN_APPROVAL`, `DELAY`,
`CONDITION`, `NOTIFICATION`, `CHILD_WORKFLOW`, `PUBLISH`) executed as a
DB-backed state machine driven by BullMQ jobs — worker restarts are safe, and
runs can park for days awaiting approval.

**Approvals**: `HUMAN_APPROVAL` and `PUBLISH` steps always gate. Policies can
additionally require approval by module, workflow, step, action type, cost
threshold, and risk level, and can raise the deciding role. Reject cancels the
run; request-revision re-runs the producing agent step and re-gates.

**Cost control**: every provider call writes `ProviderUsage` + `CostRecord`
(integer micro-USD). Limits (per-run, daily, monthly, per-provider, per-module)
are checked _before_ each step and each agent attempt; hard stops fail the run
with `COST_LIMIT` and notify admins; warning thresholds notify once per day.

**Providers**: `mock` is always available and schema-aware (structured outputs
actually validate). `anthropic` / `openai` register automatically when their
API keys exist in the server environment. Keys never reach the browser.

**Secrets**: `SecretReference` rows point at env var names or AES-256-GCM
ciphertext (`SECRET_ENCRYPTION_KEY`). The UI only ever shows masked previews.

**Isolation & RBAC**: every row is organization-scoped; all reads/writes go
through an org context resolved from the session. Roles: Owner > Admin >
Operator > Reviewer > Viewer, enforced by one policy map shared by pages,
server actions, and API routes. Everything meaningful lands in `AuditLog`.

## Deploying to Vercel

The web app deploys to Vercel as-is and runs **without Redis or a worker**
thanks to inline execution mode (see below). You only need a hosted Postgres.

1. **Database**: in your Vercel project, add a Postgres integration
   (Vercel Postgres / Neon / Supabase). Copy the **pooled** connection string.
2. **Project settings → General → Root Directory**: set to `apps/web`
   (leave "Include files outside root directory" enabled). The committed
   `apps/web/vercel.json` supplies the build command, which runs
   `prisma generate` → `prisma migrate deploy` → optional seed → `next build`.
3. **Environment variables** (Production + Preview):

   | Variable                               | Value                                                                          |
   | -------------------------------------- | ------------------------------------------------------------------------------ |
   | `DATABASE_URL`                         | pooled Postgres connection string                                              |
   | `AUTH_SECRET`                          | `openssl rand -base64 32`                                                      |
   | `SECRET_ENCRYPTION_KEY`                | `openssl rand -hex 32`                                                         |
   | `SEED_ON_BUILD`                        | `1` for the **first** deploy (demo org + users + sample workflow), then remove |
   | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | optional — enables real providers                                              |
   | `REDIS_URL`                            | optional — only when running the worker (switches to queue mode)               |
   | `STORAGE_DRIVER` + `S3_*`              | optional — S3/R2 for persistent assets                                         |

4. Deploy. Sign in with `owner@factory.local` / `factory-dev-password` and
   **change the seeded passwords immediately** (Settings → members) — the
   defaults are public knowledge from this README.

### Execution modes

- **inline** (automatic when `REDIS_URL` is not set — the Vercel-only setup):
  workflow steps execute inside the serverless function right after the
  request via Next's `after()`. The sample pipeline works end-to-end.
  Limitations: cron schedules don't fire on their own ("Run now" works), and
  `DELAY` steps are capped at 10s.
- **queue** (set `REDIS_URL`, deploy `apps/worker` to Railway/Fly/ECS/a VM
  with `pnpm --filter @bf/worker start`): full feature set — cron schedules,
  long delays, retries with real backoff, worker health. Use Upstash or any
  hosted Redis reachable by both Vercel and the worker.

### Storage on Vercel

Without S3 configured, local storage falls back to `/tmp` (ephemeral, per
instance): generated assets keep their metadata but bytes may not survive
between requests. Set `STORAGE_DRIVER=s3` with any S3-compatible store
(AWS S3, Cloudflare R2, MinIO) for persistence.

## Testing

- Unit: providers (mock determinism, cost tables, error normalization), RBAC,
  money math, JSON-schema validation, prompt rendering, local storage.
- Integration (require Postgres; auto-skip otherwise): agent runner happy path
  - retries + escalation, cost-guard hard stops, full workflow lifecycle —
    approval, rejection, revision loop, role enforcement, cancellation.
- E2E (Playwright): auth + RBAC, sample workflow through approval to asset,
  rejection path. Prereqs: `pnpm infra:up && pnpm db:migrate && pnpm db:seed`.

## Troubleshooting

| Symptom                                       | Fix                                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Invalid environment configuration` on boot   | Copy `.env.example` → `.env`; generate `AUTH_SECRET` and `SECRET_ENCRYPTION_KEY` as shown inside.                     |
| `Can't reach database server`                 | `pnpm infra:up`, then `pg_isready -h localhost`. Check `DATABASE_URL`.                                                |
| Runs stay `QUEUED` forever                    | The worker isn't running — `pnpm dev:worker`. Check Redis with `redis-cli ping`.                                      |
| Jobs page shows “No workers seen”             | Same as above; workers heartbeat into Redis every 10s.                                                                |
| Provider “not enabled” error                  | The agent's version references `anthropic`/`openai` but no API key is set. Switch the agent to `mock` or set the key. |
| Run fails with `COST_LIMIT`                   | A hard cost limit was hit (seed sets $10/day, $100/month). Raise/disable it under **Costs**.                          |
| Prisma client out of date after schema change | `pnpm db:generate` (or rerun `pnpm db:migrate`).                                                                      |
| E2E tests hang on startup                     | Ports 3000/3010 already in use, or seed not run.                                                                      |
| Playwright browser not found                  | `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium` to use a system browser.       |
| Sign-in loops back                            | Wrong `AUTH_SECRET` between restarts invalidates JWTs — clear cookies.                                                |

## What's deliberately NOT here yet

- Three of the five business modules (still disabled `COMING_NEXT`
  placeholders). **Zoo Shorts** and **Listing Video Factory**
  (`/apps/listing-video-factory`, see
  [`docs/LISTING_VIDEO_FACTORY.md`](docs/LISTING_VIDEO_FACTORY.md)) are
  installed and working.
- Real publishing/outreach/deployment integrations — `PUBLISH` steps execute as
  approval-gated dry runs.
- Real email/Slack/SMS delivery (in-app + mock email only).
