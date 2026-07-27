import path from "node:path";
import { DATA_DIR, loadConfig } from "../config";
import { episodeId, readJsonIfExists, writeJson } from "./fs";
import { log } from "./log";

export interface CostEntry {
  at: string;
  provider: string;
  item: string;
  estimatedUsd: number;
  mode: "live" | "mock";
}

interface Ledger {
  scope: string;
  entries: CostEntry[];
  totalUsd: number;
}

/**
 * Cost ledger + budget guard. Every would-be paid call goes through charge():
 * the expected cost is logged BEFORE the call, mock calls are recorded at $0,
 * and live calls that would exceed the per-episode budget throw.
 */
export class CostTracker {
  private ledger: Ledger;
  private file: string;

  constructor(scope: { episode?: number }) {
    const name = scope.episode ? episodeId(scope.episode) : "show-setup";
    this.file = scope.episode
      ? path.join(DATA_DIR, "episodes", name, "cost-ledger.json")
      : path.join(DATA_DIR, "show-state", "cost-ledger.json");
    this.ledger = readJsonIfExists<Ledger>(this.file) ?? { scope: name, entries: [], totalUsd: 0 };
  }

  get totalUsd(): number {
    return this.ledger.totalUsd;
  }

  get entries(): CostEntry[] {
    return this.ledger.entries;
  }

  /**
   * Record an upcoming call. Throws when a live call would push the episode
   * past MAX_COST_PER_EPISODE_USD. Call BEFORE issuing the provider request.
   */
  charge(entry: Omit<CostEntry, "at">): void {
    const budget = loadConfig().MAX_COST_PER_EPISODE_USD;
    if (entry.mode === "live") {
      log.info(
        `$ expected cost: ${entry.provider} ${entry.item} ≈ $${entry.estimatedUsd.toFixed(3)}`,
      );
      if (this.ledger.totalUsd + entry.estimatedUsd > budget) {
        throw new Error(
          `Budget guard: ${entry.provider} ${entry.item} ($${entry.estimatedUsd.toFixed(2)}) would exceed ` +
            `the $${budget} per-episode limit (spent so far: $${this.ledger.totalUsd.toFixed(2)}). ` +
            `Raise MAX_COST_PER_EPISODE_USD or reduce asset counts.`,
        );
      }
    }
    const usd = entry.mode === "live" ? entry.estimatedUsd : 0;
    this.ledger.entries.push({ ...entry, estimatedUsd: usd, at: new Date().toISOString() });
    this.ledger.totalUsd = Math.round((this.ledger.totalUsd + usd) * 1000) / 1000;
    writeJson(this.file, this.ledger);
  }
}
