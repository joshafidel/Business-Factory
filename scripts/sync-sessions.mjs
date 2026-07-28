#!/usr/bin/env node
/**
 * sync-sessions — keep parallel Claude session branches converged.
 *
 * Several Claude sessions develop this repo on separate `claude/*` branches
 * but share one Vercel production deployment. This script makes "piggyback,
 * don't compete" a one-command habit:
 *
 *   node scripts/sync-sessions.mjs               merge every sibling branch into HEAD
 *   node scripts/sync-sessions.mjs --check       exit 1 if any sibling isn't merged (no changes)
 *   node scripts/sync-sessions.mjs --push-back   after merging, push the merged HEAD back
 *                                                to each sibling so history stays shared
 *
 * Run it at the START of a work session (build on everyone's latest) and
 * BEFORE any push that will be deployed (never ship a build that reverts a
 * sibling's production fixes). See docs/SESSIONS.md for the full protocol.
 */
import { execFileSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");
const PUSH_BACK = args.has("--push-back");

function git(...argv) {
  return execFileSync("git", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryGit(...argv) {
  try {
    return { ok: true, out: git(...argv) };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() };
  }
}

const current = git("rev-parse", "--abbrev-ref", "HEAD");
if (!current.startsWith("claude/")) {
  console.error(`✋ HEAD is '${current}', not a claude/* session branch — nothing to sync.`);
  process.exit(CHECK_ONLY ? 1 : 0);
}

if (git("status", "--porcelain") !== "" && !CHECK_ONLY) {
  console.error("✋ Working tree is dirty. Commit or stash before syncing.");
  process.exit(1);
}

console.log("Fetching origin…");
const fetch = tryGit("fetch", "origin", "--prune");
if (!fetch.ok) {
  console.error(`⚠ fetch failed (offline?): ${fetch.out}`);
  process.exit(1);
}

const siblings = git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/claude/")
  .split("\n")
  .filter(Boolean)
  .filter((ref) => ref !== `origin/${current}`);

if (siblings.length === 0) {
  console.log("No sibling session branches found. Done.");
  process.exit(0);
}

let behind = [];
for (const ref of siblings) {
  const merged = tryGit("merge-base", "--is-ancestor", ref, "HEAD").ok;
  console.log(`${merged ? "✓" : "○"} ${ref}${merged ? "" : "  (not merged into HEAD)"}`);
  if (!merged) behind.push(ref);
}

if (CHECK_ONLY) {
  if (behind.length > 0) {
    console.error(
      `\n✗ ${behind.length} sibling branch(es) not merged. Run: node scripts/sync-sessions.mjs`,
    );
    process.exit(1);
  }
  console.log("\n✓ Converged with every sibling session.");
  process.exit(0);
}

for (const ref of behind) {
  console.log(`\nMerging ${ref}…`);
  const merge = tryGit("merge", "--no-edit", ref);
  if (!merge.ok) {
    const conflicts = tryGit("diff", "--name-only", "--diff-filter=U").out;
    tryGit("merge", "--abort");
    console.error(
      [
        `✗ Merge of ${ref} conflicts — aborted, your branch is untouched.`,
        conflicts ? `Conflicting files:\n${conflicts}` : "",
        "Resolve manually with the ownership rules in docs/SESSIONS.md:",
        "  · files owned by the other session → take THEIR side",
        "  · files owned by this session      → keep YOURS, re-apply their intent",
        "  · shared packages                  → keep BOTH (additive)",
        `Then: git merge ${ref}  and fix the listed files.`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    process.exit(1);
  }
  console.log(merge.out.split("\n").at(-1) ?? "merged");
}

if (behind.length === 0) {
  console.log("\nAlready converged — nothing to merge.");
} else {
  console.log(`\n✓ Merged ${behind.length} sibling branch(es) into ${current}.`);
}

if (PUSH_BACK) {
  console.log("\nPushing merged history back to siblings (fast-forward only)…");
  for (const ref of siblings) {
    const branch = ref.replace(/^origin\//, "");
    // Plain push: fails safely if the sibling moved since our fetch.
    const push = tryGit("push", "origin", `HEAD:${branch}`);
    console.log(push.ok ? `✓ ${branch}` : `⚠ ${branch}: ${push.out.split("\n").at(-1)}`);
  }
}
