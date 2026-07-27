// Deploy-time database step: `prisma migrate deploy`, plus the idempotent
// seed when SEED_ON_BUILD=1. Hydrates the repo-root .env for local runs;
// on Vercel the variables come from the project environment.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    "";
}
if (!process.env.DATABASE_URL) {
  console.error("[deploy-db] DATABASE_URL is not set — cannot migrate.");
  process.exit(1);
}

const run = (cmd, env = process.env) => execSync(cmd, { stdio: "inherit", cwd: root, env });

// Migrations must use a DIRECT connection: Prisma's advisory lock breaks
// behind PgBouncer/Neon poolers (stranded locks → P1002 timeouts on the
// next deploy). Retry a few times in case a concurrent build holds it.
const migrateEnv = { ...process.env };
if (process.env.POSTGRES_URL_NON_POOLING) {
  migrateEnv.DATABASE_URL = process.env.POSTGRES_URL_NON_POOLING;
}
console.log("[deploy-db] prisma migrate deploy…");
let migrated = false;
for (let attempt = 1; attempt <= 4 && !migrated; attempt++) {
  try {
    run("pnpm --filter @bf/database db:migrate:deploy", migrateEnv);
    migrated = true;
  } catch (err) {
    if (attempt === 4) throw err;
    const wait = attempt * 20;
    console.log(`[deploy-db] migrate attempt ${attempt} failed; retrying in ${wait}s…`);
    execSync(`sleep ${wait}`);
  }
}

if (process.env.SEED_ON_BUILD === "1") {
  console.log("[deploy-db] SEED_ON_BUILD=1 — seeding database (idempotent)…");
  run("pnpm db:seed");
} else {
  console.log("[deploy-db] SEED_ON_BUILD not set — skipping seed.");
}
