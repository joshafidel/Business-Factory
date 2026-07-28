# Active workstreams ledger

One row per Claude session/workstream. **Add your row when you start; update Status when you
land or stop.** Keep rows append-only (edit only your own row) — this file is how simultaneous
sessions avoid stepping on each other. See CLAUDE.md for the full collaboration protocol.

| Workstream                                                                            | Branch                               | Owns (paths)                                                                                                          | Status                                                            |
| ------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Love Villa: Nations (AI TikTok show: pipeline, dashboard app page, TikTok publishing) | `claude/ai-video-tiktok-app-2e3voe`  | `apps/love-villa/**`, `apps/web/**/love-villa*`, `apps/web/public/love-villa/**`, `packages/shared/src/love-villa.ts` | Active — episode 1 shipped (narrator format); episodes 2+ pending |
| Zoo Shorts / kids-shorts (platform's first business)                                  | (various, pre-dates ledger)          | `packages/workflows/src/functions/zoo-*`, kids-shorts dashboard surfaces, `packages/shared/src/zoo-cast.ts`           | Active                                                            |
| Listing factory (real-estate videos)                                                  | `claude/ai-business-factory-real-estate-3gkuep` | `packages/workflows/src/listing-factory/**`, `apps/web/**/listing-video-factory/**`, `apps/web/src/lib/lvf-*.ts`, `packages/providers/src/media-picsart.ts` | Active — full pipeline live (feed import, portal-URL parse, drone AI motion, Range streaming); awaiting valid Picsart dev key for seamless keyframe-chained clips |
| Mobile & shared UI (responsive shell, branding/icons, video download UX)              | `claude/factory-mobile-redesign-kkq0qa` | `apps/web/src/components/dashboard-shell.tsx` + `logo.tsx` + `media-actions.tsx` + `asset-preview.tsx`, `(dashboard)/layout.tsx`, app icons/manifest, `scripts/sync-sessions.mjs` | Active — mobile shell, PWA branding, video downloads shipped |

Shared surfaces (seed, prisma schema, dashboard home page, shared UI): additive-only edits per
CLAUDE.md — no single owner.

## Converging with siblings (the one-command habit)

```
node scripts/sync-sessions.mjs             # start of session: merge every sibling claude/* tip into HEAD
node scripts/sync-sessions.mjs --check     # pre-push/deploy gate: exit 1 if behind any sibling
node scripts/sync-sessions.mjs --push-back # optional: fast-forward siblings to the merged head
```

Landing on the deploy branch itself is `scripts/sync-deploy.mjs` / deploying is
`scripts/vercel-redeploy.mjs` (see CLAUDE.md).

**Merge conflicts resolve by ownership, not preference:**

- file owned by the other session → take **their** side, then re-apply your intent additively;
- file owned by you → keep **yours**, but read their diff and fold in what they were doing;
- shared file → keep **both** (shared-surface edits are additive by rule);
- generated/artifact file → regenerate or delete, never hand-merge.

Never rebase or force-push a shared `claude/*` branch — merges keep every session's history
intact so ancestor checks (and each other's in-flight work) survive.
