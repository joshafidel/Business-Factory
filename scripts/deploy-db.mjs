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

const run = (cmd) => execSync(cmd, { stdio: "inherit", cwd: root, env: process.env });

console.log("[deploy-db] prisma migrate deploy…");
run("pnpm --filter @bf/database db:migrate:deploy");

if (process.env.SEED_ON_BUILD === "1") {
  console.log("[deploy-db] SEED_ON_BUILD=1 — seeding database (idempotent)…");
  run("pnpm db:seed");
} else {
  console.log("[deploy-db] SEED_ON_BUILD not set — skipping seed.");
}
