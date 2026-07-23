/**
 * One-shot Vercel setup + production deploy.
 *
 *   VERCEL_TOKEN=... node scripts/vercel-setup.mjs [--branch <ref>]
 *
 * What it does:
 *  1. Finds the Vercel project linked to this repo (personal or team scope);
 *     creates one linked to the GitHub repo if none exists.
 *  2. Sets Root Directory to apps/web and framework to Next.js.
 *  3. Ensures AUTH_SECRET / SECRET_ENCRYPTION_KEY / SEED_ON_BUILD env vars
 *     exist (generates secrets; never overwrites existing values).
 *  4. Verifies a Postgres env var exists (DATABASE_URL or POSTGRES_*).
 *     Exits with instructions if the project has no database yet.
 *  5. Triggers a production deployment from the given git branch, polls until
 *     READY/ERROR, prints build log tail on failure.
 *  6. Smoke-tests the live site (sign-in page must render).
 *
 * Uses curl for HTTP so corporate proxies (HTTPS_PROXY + CA bundle) work.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const TOKEN = process.env.VERCEL_TOKEN;
if (!TOKEN) {
  console.error("VERCEL_TOKEN is required.");
  process.exit(1);
}
const REPO_ORG = process.env.GITHUB_ORG ?? "joshafidel";
const REPO_NAME = process.env.GITHUB_REPO ?? "Business-Factory";
const BRANCH = process.argv.includes("--branch")
  ? process.argv[process.argv.indexOf("--branch") + 1]
  : (process.env.DEPLOY_BRANCH ?? "claude/ai-business-factory-platform-12estn");
const PROJECT_HINT = (process.env.VERCEL_PROJECT_NAME ?? "").toLowerCase();

function api(method, path, body) {
  const args = [
    "-sS",
    "--max-time",
    "60",
    "-X",
    method,
    `https://api.vercel.com${path}`,
    "-H",
    `Authorization: Bearer ${TOKEN}`,
    "-H",
    "Content-Type: application/json",
  ];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const out = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      return JSON.parse(out);
    } catch (err) {
      lastErr = err;
      // Transient network failure — back off and retry.
      execFileSync("sleep", [String(2 * (attempt + 1))]);
    }
  }
  throw lastErr;
}

function teamQuery(teamId, extra = "") {
  const params = new URLSearchParams();
  if (teamId) params.set("teamId", teamId);
  const s = params.toString();
  return s ? `?${s}${extra ? `&${extra}` : ""}` : extra ? `?${extra}` : "";
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

// ── 1. Locate the project ────────────────────────────────────────────────────
const user = api("GET", "/v2/user");
if (user.error) fail(`Token rejected: ${user.error.message ?? JSON.stringify(user.error)}`);
console.log(`✓ Authenticated as ${user.user?.username ?? user.user?.email ?? "unknown"}`);

const teams = api("GET", "/v2/teams?limit=100");
const scopes = [null, ...(teams.teams ?? []).map((t) => t.id)];

let project = null;
let teamId = null;
const candidates = [];
for (const scope of scopes) {
  const res = api("GET", `/v9/projects${teamQuery(scope, "limit=100")}`);
  for (const p of res.projects ?? []) {
    const repoMatch =
      p.link?.type === "github" &&
      `${p.link.org}/${p.link.repo}`.toLowerCase() === `${REPO_ORG}/${REPO_NAME}`.toLowerCase();
    const nameMatch =
      PROJECT_HINT.length > 0
        ? p.name.toLowerCase() === PROJECT_HINT
        : p.name.toLowerCase().includes("business") || p.name.toLowerCase().includes("factory");
    if (repoMatch || nameMatch) candidates.push({ project: p, teamId: scope, repoMatch });
  }
}
candidates.sort((a, b) => Number(b.repoMatch) - Number(a.repoMatch));
if (candidates.length > 0) {
  project = candidates[0].project;
  teamId = candidates[0].teamId;
  console.log(
    `✓ Found project "${project.name}" (${project.id})${teamId ? ` in team ${teamId}` : ""}` +
      `${candidates[0].repoMatch ? " — linked to this repo" : " — matched by name"}`,
  );
} else {
  console.log("No existing project matched; creating one linked to the GitHub repo…");
  const created = api("POST", `/v11/projects${teamQuery(null)}`, {
    name: REPO_NAME.toLowerCase(),
    framework: "nextjs",
    rootDirectory: "apps/web",
    gitRepository: { type: "github", repo: `${REPO_ORG}/${REPO_NAME}` },
  });
  if (created.error) {
    fail(
      `Could not create a project: ${created.error.message}. ` +
        `Create one in the Vercel dashboard (Add New → Project → import ${REPO_ORG}/${REPO_NAME}) and re-run.`,
    );
  }
  project = created;
  console.log(`✓ Created project "${project.name}"`);
}

// ── 2. Project settings ──────────────────────────────────────────────────────
if (project.rootDirectory !== "apps/web" || project.framework !== "nextjs") {
  const patched = api("PATCH", `/v9/projects/${project.id}${teamQuery(teamId)}`, {
    rootDirectory: "apps/web",
    framework: "nextjs",
  });
  if (patched.error) fail(`Failed to set root directory: ${patched.error.message}`);
  console.log("✓ Root directory set to apps/web (framework: nextjs)");
} else {
  console.log("✓ Root directory already apps/web");
}

// ── 3. Environment variables ─────────────────────────────────────────────────
const envRes = api("GET", `/v9/projects/${project.id}/env${teamQuery(teamId)}`);
const existing = new Set((envRes.envs ?? []).map((e) => e.key));

const wanted = [
  { key: "AUTH_SECRET", value: crypto.randomBytes(32).toString("base64") },
  { key: "SECRET_ENCRYPTION_KEY", value: crypto.randomBytes(32).toString("hex") },
  { key: "SEED_ON_BUILD", value: "1" },
];
const toCreate = wanted.filter((w) => !existing.has(w.key));
if (toCreate.length > 0) {
  const created = api(
    "POST",
    `/v10/projects/${project.id}/env${teamQuery(teamId)}`,
    toCreate.map((w) => ({
      key: w.key,
      value: w.value,
      type: "encrypted",
      target: ["production", "preview"],
    })),
  );
  if (created.error) fail(`Failed to create env vars: ${created.error.message}`);
  console.log(`✓ Created env vars: ${toCreate.map((w) => w.key).join(", ")}`);
} else {
  console.log("✓ AUTH_SECRET / SECRET_ENCRYPTION_KEY / SEED_ON_BUILD already set");
}

// ── 4. Database present? ─────────────────────────────────────────────────────
const DB_KEYS = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"];
const hasDb = DB_KEYS.some((k) => existing.has(k));
if (!hasDb) {
  console.error(`
✗ The project has no Postgres database yet. This is the one step that needs a human:

  1. Open the project in the Vercel dashboard
  2. Click the "Storage" tab
  3. Click "Create Database" → choose "Neon" (Postgres, free plan is fine)
  4. Accept the defaults and click "Connect" so it attaches to this project

Then re-run this script — everything else is automated.`);
  process.exit(42);
}
console.log("✓ Database env var present");

// ── 5. Deploy ────────────────────────────────────────────────────────────────
const fullProject = api("GET", `/v9/projects/${project.id}${teamQuery(teamId)}`);
const repoId = fullProject.link?.repoId;
if (!repoId) {
  fail(
    "Project is not linked to the GitHub repo. In Vercel: Settings → Git → Connect Git Repository, " +
      `pick ${REPO_ORG}/${REPO_NAME}, then re-run.`,
  );
}
console.log(`Deploying branch "${BRANCH}" to production…`);
const deployment = api(
  "POST",
  `/v13/deployments${teamQuery(teamId, "skipAutoDetectionConfirmation=1")}`,
  {
    name: project.name,
    project: project.id,
    target: "production",
    gitSource: { type: "github", repoId, ref: BRANCH },
  },
);
if (deployment.error) fail(`Failed to start deployment: ${deployment.error.message}`);
console.log(`✓ Deployment started: ${deployment.id} (${deployment.url})`);

// Poll until terminal state.
let state = deployment.readyState ?? "QUEUED";
const deadline = Date.now() + 20 * 60_000;
while (!["READY", "ERROR", "CANCELED"].includes(state)) {
  if (Date.now() > deadline) fail("Timed out waiting for deployment (20 min).");
  await new Promise((r) => setTimeout(r, 10_000));
  const d = api("GET", `/v13/deployments/${deployment.id}${teamQuery(teamId)}`);
  if (d.error) fail(`Polling failed: ${d.error.message}`);
  if (d.readyState !== state) {
    state = d.readyState;
    console.log(`  … ${state}`);
  }
}

if (state !== "READY") {
  console.error(`\n✗ Deployment finished with state ${state}. Build log tail:`);
  const events = api(
    "GET",
    `/v3/deployments/${deployment.id}/events${teamQuery(teamId, "limit=250&builds=1")}`,
  );
  const lines = (Array.isArray(events) ? events : [])
    .map((e) => e?.payload?.text ?? "")
    .filter(Boolean);
  console.error(lines.slice(-60).join("\n"));
  process.exit(1);
}

// ── 6. Verify ────────────────────────────────────────────────────────────────
const aliases = api("GET", `/v9/projects/${project.id}/domains${teamQuery(teamId)}`);
const domain =
  (aliases.domains ?? []).map((d) => d.name).find((n) => n.endsWith(".vercel.app")) ??
  (aliases.domains ?? [])[0]?.name ??
  deployment.url;
const url = `https://${domain}`;
let page = "";
try {
  page = execFileSync("curl", ["-sS", "-L", "--max-time", "30", `${url}/sign-in`], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
} catch (err) {
  fail(`Deployment is READY but ${url}/sign-in did not respond: ${err.message}`);
}
if (!page.includes("Business Factory")) {
  fail(`Deployment is READY but ${url}/sign-in did not render the sign-in page.`);
}
console.log(`\n✅ Deployed and verified: ${url}`);
console.log("   Sign in: owner@factory.local / factory-dev-password (change it after login).");
