// Converge-and-deploy: THE only sanctioned way to ship production.
//
// Multiple Claude sessions work on this repo on separate branches but share
// one Vercel project — a deploy from a stale branch silently reverts the
// other sessions' production fixes. This script makes cooperation
// structural:
//   1. Fetches every `claude/ai-business-factory-*` session branch.
//   2. Merges them all into the current branch (octopus of tips).
//      A conflict ABORTS the deploy — resolve the merge first; never ship a
//      branch that lacks a sibling's work.
//   3. Pushes the converged commit back to EVERY session branch, so all
//      sessions build on the same state.
//   4. Creates the production deployment from the converged commit and
//      polls to a terminal state.
//
//   VERCEL_TOKEN=... node scripts/vercel-redeploy.mjs
//   SKIP_CONVERGE=1 to bypass step 1-3 in an emergency (discouraged).
import { execFileSync, execSync } from "node:child_process";

const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_ID = process.env.VERCEL_PROJECT_ID ?? "prj_avNuDmtHBEX7mIHdEslwzE0NWpPf";
if (!TOKEN) {
  console.error("VERCEL_TOKEN required");
  process.exit(1);
}

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

// ── Converge all session branches ─────────────────────────────────────────
let BRANCH = process.env.DEPLOY_BRANCH ?? sh("git rev-parse --abbrev-ref HEAD");
if (process.env.SKIP_CONVERGE !== "1") {
  // Session branches (see docs/SESSIONS.md ledger) — session branch names
  // only share the claude/ prefix (e.g. claude/factory-mobile-redesign-*),
  // so converge every claude/* branch; a missed sibling means its
  // production work silently ships reverted.
  sh("git fetch origin '+refs/heads/claude/*:refs/remotes/origin/claude/*'");
  const branches = sh("git for-each-ref --format='%(refname:short)' refs/remotes/origin/claude/")
    .split("\n")
    .map((b) => b.replace(/^'|'$/g, ""))
    .filter(Boolean);
  console.log(`[converge] session branches: ${branches.join(", ")}`);
  // Start from the current branch's remote tip so local drift can't ship.
  const local = branches.find((b) => b.endsWith(BRANCH)) ?? branches[0];
  sh(`git checkout -B ${BRANCH} ${local}`);
  for (const b of branches) {
    try {
      sh(`git merge --no-edit ${b}`);
    } catch (err) {
      execSync("git merge --abort || true");
      console.error(
        `[converge] CONFLICT merging ${b}. Deploy aborted — resolve the merge between ` +
          `session branches first (see CLAUDE.md), then rerun. Never deploy past a sibling's work.`,
      );
      process.exit(2);
    }
  }
  const head = sh("git rev-parse HEAD");
  console.log(`[converge] converged commit ${head.slice(0, 7)}`);
  for (const b of branches) {
    const name = b.replace(/^origin\//, "");
    try {
      sh(`git push origin HEAD:${name}`);
      console.log(`[converge] pushed → ${name}`);
    } catch {
      console.error(`[converge] WARNING: push to ${name} failed (non-fast-forward?); continuing`);
    }
  }
}

// ── Deploy ────────────────────────────────────────────────────────────────
function api(method, path, body) {
  const args = [
    "-sS", "--max-time", "60", "-X", method,
    `https://api.vercel.com${path}`,
    "-H", `Authorization: Bearer ${TOKEN}`,
    "-H", "Content-Type: application/json",
  ];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const out = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      return JSON.parse(out);
    } catch (err) {
      lastErr = err;
      execFileSync("sleep", [String(2 * (attempt + 1))]);
    }
  }
  throw lastErr;
}

const project = api("GET", `/v9/projects/${PROJECT_ID}`);
const deployment = api("POST", `/v13/deployments?skipAutoDetectionConfirmation=1`, {
  name: project.name,
  project: project.id,
  target: "production",
  gitSource: { type: "github", repoId: project.link.repoId, ref: BRANCH },
});
if (deployment.error) {
  console.error(`Failed to start: ${deployment.error.message}`);
  process.exit(1);
}
console.log(`Deployment ${deployment.id} started (${deployment.url})`);

let state = deployment.readyState ?? "QUEUED";
const deadline = Date.now() + 20 * 60_000;
while (!["READY", "ERROR", "CANCELED"].includes(state)) {
  if (Date.now() > deadline) {
    console.error("Timed out.");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 10_000));
  const d = api("GET", `/v13/deployments/${deployment.id}`);
  if (d.readyState !== state) {
    state = d.readyState;
    console.log(`  … ${state}`);
  }
}
if (state !== "READY") {
  console.error(`Deployment ended ${state}. Build log tail:`);
  const events = api("GET", `/v3/deployments/${deployment.id}/events?limit=250&builds=1`);
  const lines = (Array.isArray(events) ? events : [])
    .map((e) => e?.payload?.text ?? "")
    .filter(Boolean);
  console.error(lines.slice(-60).join("\n"));
  process.exit(1);
}
console.log("READY");
