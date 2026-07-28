// Safe landing of a feature branch onto the shared deploy branch, designed for
// MULTIPLE concurrent Claude sessions (see CLAUDE.md):
//   1. merge deploy INTO the feature branch (conflicts resolved off the shared branch)
//   2. typecheck the merged result
//   3. merge --no-ff back onto deploy and push (retrying once if another session
//      landed in between); never force-pushes.
// Usage: node scripts/sync-deploy.mjs   (run from anywhere inside the repo,
//        with your feature branch checked out)
import { execSync } from "node:child_process";

const DEPLOY = "claude/ai-business-factory-platform-12estn";
const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", encoding: "utf8", ...opts });
const out = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

const feature = out("git rev-parse --abbrev-ref HEAD");
if (feature === DEPLOY) {
  console.error(`✗ You are on the deploy branch (${DEPLOY}). Check out your feature branch first.`);
  process.exit(1);
}
if (out("git status --porcelain") !== "") {
  console.error("✗ Uncommitted changes — commit or stash before syncing.");
  process.exit(1);
}

console.log(`▸ syncing ${feature} → ${DEPLOY}`);
run(`git fetch origin ${DEPLOY}`);

// 1. Bring the latest deploy state into the feature branch.
try {
  run(`git merge --no-edit origin/${DEPLOY}`);
} catch {
  console.error(
    "✗ Merge conflict while merging the deploy branch into your feature branch.\n" +
      "  Resolve conflicts HERE (never on the deploy branch), commit, and re-run.\n" +
      "  Reminder: conflicts in generated files (*.tsbuildinfo, lockfile churn) are resolved\n" +
      "  by regenerating/deleting, not hand-merging.",
  );
  process.exit(1);
}

// 2. Gates on the merged result.
run("pnpm db:generate");
run("pnpm typecheck");

// 3. Land on deploy; retry once if another session pushed meanwhile.
run(`git push -u origin ${feature}`);
run(`git checkout ${DEPLOY}`);
run(`git reset --hard origin/${DEPLOY}`);
run(`git merge --no-ff --no-edit ${feature}`);
for (let attempt = 1; ; attempt++) {
  try {
    run(`git push origin ${DEPLOY}`);
    break;
  } catch {
    if (attempt >= 2) {
      console.error(
        "✗ Push rejected twice — another session is landing right now. Re-run in a minute.",
      );
      run(`git checkout ${feature}`);
      process.exit(1);
    }
    console.log("▸ another session landed first — pulling and retrying");
    run(`git pull --no-edit origin ${DEPLOY}`);
    run("pnpm typecheck");
  }
}
run(`git checkout ${feature}`);
console.log(`✓ ${feature} landed on ${DEPLOY} (Vercel will redeploy).`);
