// Trigger a production deployment of the current branch and poll to a
// terminal state. Prints the build-log tail on failure.
//   VERCEL_TOKEN=... node scripts/vercel-redeploy.mjs
import { execFileSync } from "node:child_process";

const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_ID = process.env.VERCEL_PROJECT_ID ?? "prj_avNuDmtHBEX7mIHdEslwzE0NWpPf";
const BRANCH = process.env.DEPLOY_BRANCH ?? "claude/ai-business-factory-platform-12estn";
if (!TOKEN) {
  console.error("VERCEL_TOKEN required");
  process.exit(1);
}

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
