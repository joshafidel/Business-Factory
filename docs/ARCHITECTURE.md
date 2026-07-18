# AI Business Factory — Architecture

## 1. What this is

A multi-tenant AI operations platform that will eventually run several AI-assisted
businesses (children's Shorts, dating-parody videos, Amazon review videos,
small-business websites, real-estate walkthroughs). **This repository currently
contains only the shared platform** — the agent framework, workflow engine,
governance layer, and dashboard that every future business module plugs into.

Guiding principles:

1. **Real infrastructure, mock providers.** Everything is backed by Postgres,
   Redis, and real queue workers. Where an external API key is missing (Anthropic,
   OpenAI, S3), a safe local mock or filesystem adapter is used instead. Nothing
   is a hardcoded screen.
2. **Nothing irreversible without a human.** Publishing, outreach, spending,
   deletion, and deployment are modeled as `PUBLISH`-class steps that always route
   through the approval system. The platform automates *preparation*; humans gate
   *release*.
3. **Modules are plugins.** Business modules implement a `ModuleContract` and are
   registered in the database. The core never imports business logic.
4. **Cost is a first-class citizen.** Every provider call records usage; cost
   limits are enforced *before* execution continues, with hard stops.

## 2. Monorepo layout

```
apps/
  web/                # Next.js 15 (App Router) dashboard + API routes
  worker/             # Standalone BullMQ worker process (deployable separately)
packages/
  config/             # Zod-validated environment loading (server-only)
  shared/             # Domain types, ModuleContract, RBAC, logger, errors, utils
  database/           # Prisma schema, client singleton, seed scripts
  storage/            # S3-compatible storage abstraction + local FS adapter
  providers/          # AI provider abstraction: mock, Anthropic, OpenAI
  prompts/            # Prompt library service (versioning, rollback, testing)
  notifications/      # Notification dispatch: in-app + mock email channels
  agents/             # Agent framework: definitions, tool registry, runner
  workflows/          # Workflow engine: steps, transitions, approvals, cost guard
  queue/              # BullMQ queues, scheduler, job records, idempotency
  analytics/          # Aggregation queries for the analytics/costs dashboards
docs/                 # Architecture, plan, decisions, troubleshooting
```

Packages are consumed **as TypeScript source** (`main: src/index.ts`) and
transpiled by the consumer (Next.js `transpilePackages`, `tsx` for the worker,
Vitest natively). This removes 12 build pipelines while keeping strict types.
If a package ever needs independent publishing, a `tsup` build can be added then.

### Dependency direction (no cycles)

```
config ← shared ← database ← {storage, providers, prompts, notifications, queue}
                                   ↑ agents ← workflows ← analytics
apps/web and apps/worker consume everything; nothing consumes apps.
```

## 3. Core subsystems

### 3.1 Agent framework (`packages/agents`)

An **Agent** is a versioned database record (`Agent` + `AgentVersion`) holding:
role, instructions, input/output JSON Schemas, allowed/forbidden tools, model
config, temperature, budgets (tokens/cost), retries, timeout, approval
requirements. Agents are *not* free-running loops: every `AgentRun` is created
with a goal, validated input, budget, tool permissions, max steps, and explicit
completion/failure conditions.

The **runner** pipeline:
validate input (Zod/JSON-Schema) → resolve prompt version → check tool
permissions → **cost-limit pre-check** → call provider → validate structured
output → record usage + cost → persist run history → retry recoverable errors
with backoff → escalate (notification + `ErrorEvent`) on exhaustion → hand the
result to the owning workflow step.

### 3.2 Provider abstraction (`packages/providers`)

`AIProvider` interface: `generateText`, `generateObject` (structured JSON),
tool-call support, streaming, usage reporting, and normalized `ProviderError`s
(retryable vs terminal). Implementations:

- **MockProvider** — deterministic, latency-simulating, schema-aware fake used
  for all local development and tests. Produces plausible structured output from
  the requested output schema.
- **AnthropicProvider / OpenAIProvider** — real HTTP adapters, enabled only when
  `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` exist. Keys never leave the server.
- **Image/audio/video** — interface + mock adapters only, for now.

A registry selects a provider per agent (`provider` + `model` on the
`AgentVersion`), with per-model cost tables for estimation.

### 3.3 Workflow engine (`packages/workflows`)

Workflows are versioned definitions (`Workflow`/`WorkflowVersion`/`WorkflowStep`)
executed as `WorkflowRun`s with per-step `StepRun`s. Step types:
`AGENT_TASK`, `API_CALL`, `CODE_FUNCTION`, `TRANSFORM`, `FILE_GENERATION`,
`HUMAN_APPROVAL`, `DELAY`, `CONDITION`, `NOTIFICATION`, `CHILD_WORKFLOW`,
`PUBLISH`.

The engine is a **database-backed state machine driven by queue jobs**: each
step executes inside a worker job; the run's next transition is decided from
persisted state, so workers can restart safely. `HUMAN_APPROVAL` and `PUBLISH`
steps park the run in `AWAITING_APPROVAL` and create an `ApprovalRequest`;
an approval decision re-enqueues the run. Every transition is audit-logged.
A **cost guard** checks per-run / daily / monthly / module limits before each
billable step and fails the run (`COST_LIMIT`) on hard stops.

### 3.4 Approvals

`ApprovalRequest` (what, why, inputs/outputs, assets, estimated cost, risk
level) + `ApprovalDecision` (approve / reject / request-revision + comment).
Policies (`ApprovalPolicy`) are configurable by module, workflow, step, action
type, cost threshold, and risk level. The Approval Inbox in the dashboard is the
human control plane. Reviewer role or higher can decide; every decision is
audited and notifies the requester.

### 3.5 Queue, workers, scheduling (`packages/queue`, `apps/worker`)

BullMQ on Redis. Queues: `workflow` (step execution), `agent` (standalone agent
runs), `maintenance`. Features used: delayed jobs, priorities, retries with
exponential backoff, rate limiting, concurrency limits, and a dead-letter
pattern (exhausted jobs recorded as `Job` rows with `DEAD` status + notification).
Idempotency keys dedupe enqueues. `Schedule` rows (cron or one-shot, with
timezone, pause, manual trigger, history) are materialized as BullMQ repeatable
jobs by the worker on boot and on change. The worker exposes an HTTP health
endpoint and heartbeats into Redis so the dashboard can show worker health.

### 3.6 Storage (`packages/storage`)

`StorageAdapter` interface (`put`, `get`, `delete`, `list`, `getSignedUrl`).
Adapters: `LocalFsStorage` (default for dev, writes under `.data/storage`) and
`S3Storage` (any S3-compatible endpoint incl. MinIO). Assets are metadata rows
in Postgres pointing at storage keys — never blobs in the DB.

### 3.7 Security & tenancy

- Auth.js (NextAuth v5) with credentials login (bcrypt) and JWT sessions;
  OAuth providers can be added later without schema changes.
- Every domain row carries `organizationId`; all queries are org-scoped through
  a per-request context. Roles: OWNER > ADMIN > OPERATOR > REVIEWER > VIEWER,
  enforced by a single `can(role, permission)` policy map used by both server
  actions and API routes.
- Secrets: never stored raw in domain tables. `SecretReference` rows point to an
  env var name or an AES-256-GCM encrypted value (key = `SECRET_ENCRYPTION_KEY`).
  UI only ever shows a masked preview.
- Zod validation on every external input; rate limiting on auth and mutation
  routes; secure headers + CSRF-safe (same-site cookies, server actions origin
  checks); upload restrictions by MIME/size; prompt-injection hygiene — external
  content is wrapped in delimited untrusted blocks and never concatenated into
  system instructions.

### 3.8 Observability

Structured logging (pino) with run/step correlation ids; `AuditLog` for every
meaningful mutation (who/what/before/after); `ErrorEvent` for failures with
fingerprints; `ProviderUsage` + `CostRecord` for spend; `Metric` for periodic
aggregates. Dashboards read these tables directly.

## 4. Module contract

```ts
interface ModuleContract {
  key: string;                    // e.g. "kids-shorts"
  name: string;
  description: string;
  workflows: WorkflowBlueprint[]; // definitions the module ships
  agents: AgentBlueprint[];
  requiredIntegrations: string[]; // e.g. ["youtube"]
  requiredPermissions: Permission[];
  dashboard: { navLabel: string; widgets: WidgetDescriptor[] };
  metrics: MetricDescriptor[];
  configSchema: z.ZodTypeAny;     // module settings validated at install time
}
```

The five future businesses exist today only as **disabled placeholder
`BusinessModule` rows** (status `COMING_NEXT`) with contract metadata, so the
dashboard can show them without any business logic existing.

## 5. Database model plan

~30 Prisma models, all org-scoped where applicable, all with
`id / createdAt / updatedAt / status / metadata` conventions:

| Area | Models |
|---|---|
| Identity | `User`, `Organization`, `OrganizationMember` |
| Modules | `BusinessModule` |
| Agents | `Agent`, `AgentVersion`, `AgentRun` |
| Workflows | `Workflow`, `WorkflowVersion`, `WorkflowStep`, `WorkflowRun`, `StepRun` |
| Governance | `ApprovalPolicy`, `ApprovalRequest`, `ApprovalDecision`, `AuditLog` |
| Execution | `Job`, `Schedule`, `ErrorEvent` |
| Prompts | `Prompt`, `PromptVersion` |
| Providers/Cost | `Provider`, `ProviderUsage`, `CostRecord`, `CostLimit` |
| Tools | `Tool`, `ToolPermission` |
| Integrations | `Integration`, `SecretReference` |
| Content | `Asset` |
| Comms | `Notification` |
| Analytics | `Metric` |

Money is stored as **integer micro-USD** (`costMicroUsd BigInt`) to avoid float
drift; tokens as integers. JSON columns (`Json`) hold schemas, step configs, and
metadata; anything read from them is re-validated with Zod at the boundary.

## 6. Key decisions (and why)

| Decision | Rationale |
|---|---|
| pnpm workspaces + Turborepo | Standard, fast, simple task graph |
| Source-level packages (no per-package build) | 12 packages; build pipelines add friction with zero runtime benefit here |
| DB-backed workflow state machine (not in-memory) | Survives worker restarts; approvals can park runs for days |
| BullMQ jobs per *step*, not per run | Small, retryable units; cost checks between steps |
| JWT sessions + credentials auth | Works offline/local with zero external services; OAuth later |
| Micro-USD integers for money | Exact accumulation and limit comparison |
| Mock provider is schema-aware, not canned strings | Sample workflow produces structurally valid output end-to-end |
| `SecretReference` (env or AES-GCM) instead of raw columns | Secrets never sit in plaintext rows; UI shows masks only |

## 7. Risks & assumptions

- **Auth.js v5 is beta** — pinned version; the auth surface is small (credentials
  + JWT) so migration risk is low.
- **Prisma + serverless**: Vercel deployment needs a pooled connection string
  (PgBouncer/Neon); documented in README. Workers use direct connections.
- **BullMQ repeatable jobs vs. DB `Schedule` rows** can drift; the worker
  reconciles schedules from the DB on boot (DB is the source of truth).
- **Mock realism**: mock provider output is structurally valid but semantically
  canned; business modules must be tested against real providers before launch.
- **Assumption**: single-region, single Postgres/Redis for now; org-level
  isolation is row-based, not database-based.
- **Assumption**: no real external publishing exists yet, so `PUBLISH` steps are
  wired to a no-op executor that still exercises the approval path.
