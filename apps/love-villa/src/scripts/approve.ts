import { getApproval, loadApprovals, setApproval } from "../approvals/approvals";
import { parseArgs } from "../utils/args";
import { log } from "../utils/log";

const STAGES = ["characters", "season", "script", "visual-prompts", "rough-cut", "final-export"];

/**
 * Human approval CLI.
 *
 *   npm run approve                                   # list all checkpoints
 *   npm run approve -- --stage script --episode 1     # approve + lock
 *   npm run approve -- --stage script --episode 1 --reject --note "too mean"
 *   npm run approve -- --stage script --episode 1 --revise --note "punch up hook"
 *   npm run approve -- --stage script --episode 1 --unlock
 *   npm run approve -- --stage characters --no-lock   # approve without locking
 */
async function main(): Promise<void> {
  const args = parseArgs();
  const stage = typeof args.stage === "string" ? args.stage : null;

  if (!stage) {
    const all = loadApprovals();
    log.step("Approval checkpoints");
    if (Object.keys(all).length === 0) log.info("none yet — run setup-show first");
    for (const [key, entry] of Object.entries(all)) {
      log.info(
        `${entry.status === "approved" ? "✓" : entry.status === "rejected" ? "✗" : "…"} ${key}` +
          ` — ${entry.status}${entry.locked ? " [locked]" : ""}${entry.note ? ` (${entry.note})` : ""}`,
      );
    }
    return;
  }

  if (!STAGES.includes(stage)) {
    throw new Error(`Unknown stage "${stage}". Stages: ${STAGES.join(", ")}`);
  }
  const episode = typeof args.episode === "string" ? Number(args.episode) : undefined;
  const episodeScoped = ["script", "visual-prompts", "rough-cut", "final-export"].includes(stage);
  if (episodeScoped && episode == null) throw new Error(`Stage "${stage}" needs --episode <n>`);
  const note = typeof args.note === "string" ? args.note : "";

  if (args.unlock === true) {
    const cur = getApproval(stage, episode);
    setApproval(stage, episode, cur?.status ?? "pending", cur?.note ?? "", false);
    log.ok(`unlocked ${stage}${episode == null ? "" : `:${episode}`}`);
    return;
  }
  if (args.reject === true || args.revise === true) {
    const kind = args.reject === true ? "rejected" : "pending";
    setApproval(
      stage,
      episode,
      kind,
      note || (args.revise === true ? "revision requested" : ""),
      false,
    );
    log.ok(`${stage}${episode == null ? "" : `:${episode}`} → ${kind}${note ? ` (${note})` : ""}`);
    if (args.revise === true)
      log.info("Regenerate the artifact (the checkpoint is back to pending).");
    return;
  }
  const lock = args["no-lock"] !== true;
  setApproval(stage, episode, "approved", note, lock);
  log.ok(`approved ${stage}${episode == null ? "" : `:${episode}`}${lock ? " [locked]" : ""}`);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
