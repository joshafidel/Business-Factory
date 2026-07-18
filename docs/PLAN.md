# Implementation Plan & Checklist

## Phase 1 — Planning ✅
- [x] Inspect repository (empty; green field)
- [x] Architecture proposal (`docs/ARCHITECTURE.md`)
- [x] Folder structure
- [x] Database model plan
- [x] Risks & assumptions
- [x] This checklist

## Phase 2 — Foundation
- [ ] pnpm + Turborepo monorepo, strict TS base config, ESLint + Prettier
- [ ] Docker Compose: Postgres 16, Redis 7, MinIO (optional profile)
- [ ] `packages/config`: Zod-validated env
- [ ] `packages/shared`: domain types, ModuleContract, RBAC policy map, logger, errors
- [ ] `packages/database`: full Prisma schema (~30 models), client, seed
- [ ] Auth.js credentials auth, JWT sessions, sign-in page, middleware guard
- [ ] Organization model + membership + role enforcement helpers
- [ ] Dashboard shell: sidebar nav, topbar, org switcher-ready layout

## Phase 3 — Execution engine
- [ ] `packages/providers`: AIProvider interface, Mock/Anthropic/OpenAI, cost tables, error normalization
- [ ] `packages/storage`: StorageAdapter, LocalFS, S3/MinIO
- [ ] `packages/prompts`: versioned prompt service
- [ ] `packages/agents`: definitions, tool registry, agent runner (validate → prompt → permissions → cost check → provider → validate → record → retry → escalate)
- [ ] `packages/queue`: BullMQ queues, idempotency, dead-letter, scheduler reconciliation
- [ ] `packages/workflows`: engine, step executors, transitions
- [ ] `apps/worker`: processors, heartbeat, health endpoint, graceful shutdown
- [ ] Run history persistence (AgentRun, WorkflowRun, StepRun, Job)

## Phase 4 — Governance
- [ ] Approval system: policies, requests, decisions, revision loop
- [ ] Cost controls: CostLimit CRUD, guard enforcement, warning + hard-stop events
- [ ] Audit logging on all mutations
- [ ] ErrorEvent capture + retry/escalation paths
- [ ] `packages/notifications`: in-app + mock email, event triggers
- [ ] Integrations page patterns + SecretReference handling + test-connection

## Phase 5 — Management interface (all DB-backed)
- [ ] Overview, Business Modules, Agents, Workflows, Workflow Runs
- [ ] Approval Inbox, Jobs & Queues, Schedules, Prompt Library, Asset Library
- [ ] Integrations, Analytics, Costs, Error Logs, Audit Logs, Settings

## Phase 6 — Demonstration workflow
- [ ] "Content Brief Pipeline": topic → research agent → writer agent → QC agent
      → human approval → asset saved. Mock provider only; nothing published.
- [ ] Seed data: demo org, users per role, placeholder modules, sample workflow,
      prompts, seeded demo analytics (flagged `isDemo`)

## Phase 7 — Testing & documentation
- [ ] Vitest: agent runner, workflow transitions, approvals, cost limits, providers, storage
- [ ] DB integration tests (gated on DATABASE_URL)
- [ ] Playwright: sample workflow e2e, approve/reject e2e, auth/permissions e2e
- [ ] README: setup, commands, troubleshooting
- [ ] Lint + typecheck + tests green
