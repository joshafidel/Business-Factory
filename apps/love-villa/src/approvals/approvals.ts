import path from "node:path";
import { DATA_DIR } from "../config";
import { readJsonIfExists, writeJson } from "../utils/fs";

/**
 * Human approval workflow. Nothing advances to the next production stage
 * until its checkpoint is approved (or explicitly bypassed with --force,
 * which is logged). Approved items can be locked so generators refuse to
 * overwrite them.
 *
 * Checkpoints:
 *   characters                     (setup-show)
 *   season                         (generate-season)
 *   script:<episode>               (generate-episode)
 *   visual-prompts:<episode>       (generate-episode)
 *   rough-cut:<episode>            (produce-episode)
 *   final-export:<episode>         (render-episode)
 */

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalEntry {
  status: ApprovalStatus;
  at: string;
  note: string;
  locked: boolean;
}

type ApprovalsFile = Record<string, ApprovalEntry>;

const FILE = path.join(DATA_DIR, "show-state", "approvals.json");

export function approvalKey(stage: string, episode?: number): string {
  return episode == null ? stage : `${stage}:${episode}`;
}

export function loadApprovals(): ApprovalsFile {
  return readJsonIfExists<ApprovalsFile>(FILE) ?? {};
}

export function setApproval(
  stage: string,
  episode: number | undefined,
  status: ApprovalStatus,
  note = "",
  locked = false,
): ApprovalEntry {
  const all = loadApprovals();
  const entry: ApprovalEntry = { status, at: new Date().toISOString(), note, locked };
  all[approvalKey(stage, episode)] = entry;
  writeJson(FILE, all);
  return entry;
}

export function getApproval(stage: string, episode?: number): ApprovalEntry | null {
  return loadApprovals()[approvalKey(stage, episode)] ?? null;
}

export function isLocked(stage: string, episode?: number): boolean {
  return getApproval(stage, episode)?.locked ?? false;
}

/** Throw unless the checkpoint is approved (or force=true, which is logged). */
export function requireApproved(stage: string, episode: number | undefined, force: boolean): void {
  const entry = getApproval(stage, episode);
  if (entry?.status === "approved") return;
  const key = approvalKey(stage, episode);
  if (force) {
    console.warn(
      `⚠ approval checkpoint "${key}" bypassed with --force (status: ${entry?.status ?? "pending"})`,
    );
    return;
  }
  const epFlag = episode == null ? "" : ` --episode ${episode}`;
  throw new Error(
    `Approval required: checkpoint "${key}" is ${entry?.status ?? "pending"}.\n` +
      `Review the generated files under data/, then run:\n` +
      `  npm run approve -- --stage ${stage}${epFlag}\n` +
      `(or pass --force to this command to bypass, e.g. for demos).`,
  );
}

/** Throw when trying to regenerate a locked artifact without --force. */
export function refuseIfLocked(stage: string, episode: number | undefined, force: boolean): void {
  if (!isLocked(stage, episode)) return;
  const key = approvalKey(stage, episode);
  if (force) {
    console.warn(`⚠ locked checkpoint "${key}" overwritten with --force`);
    return;
  }
  throw new Error(
    `"${key}" is approved and LOCKED — refusing to overwrite it. ` +
      `Unlock first (npm run approve -- --stage ${stage}${episode == null ? "" : ` --episode ${episode}`} --unlock) or pass --force.`,
  );
}
