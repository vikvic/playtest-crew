/**
 * `playtest rebaseline` (W2, design doc / T9): re-record the checked-in CI
 * baseline trace against the CURRENT adapter and verify it replays 3/3
 * before it can be committed. Run this as part of any adapter change —
 * `adapterVersion` bumps must never leave CI red; the known-good trace is a
 * baseline that moves with the adapter, not a fossil.
 *
 * CI is replay-only (zero LLM calls, no secrets): it replays
 * baselines/<game>/trace.jsonl and asserts reproduction.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { run } from "./runner.ts";
import { replay } from "./replayer.ts";

export const BASELINES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "baselines");

export interface RebaselineOptions {
  game: string;
  seed: number;
  maxActions: number;
  /** 3 per the design doc; overridable for tests. */
  times?: number;
}

export interface RebaselineResult {
  ok: boolean;
  baselinePath: string;
  actions: number;
  replaysOk: number;
  error?: string;
}

export async function rebaseline(opts: RebaselineOptions): Promise<RebaselineResult> {
  const times = opts.times ?? 3;
  const workDir = join(tmpdir(), `ptc-rebaseline-${Date.now().toString(36)}`);
  const baselinePath = join(BASELINES_DIR, opts.game, "trace.jsonl");
  const result: RebaselineResult = { ok: false, baselinePath, actions: 0, replaysOk: 0 };

  try {
    // 1. Record fresh against the current adapter (lean: no video).
    const summary = await run({
      game: opts.game,
      out: workDir,
      seed: opts.seed,
      maxActions: opts.maxActions,
      screenshotEvery: 0,
      actionGapMs: 60,
      video: false,
    });
    result.actions = summary.actions;
    if (summary.outcome !== "pass") {
      result.error = `baseline recording did not pass cleanly (outcome: ${summary.outcome}${summary.error ? `, ${summary.error}` : ""}) — a CI baseline must be a known-good run`;
      return result;
    }

    // 2. Verify 3/3 before it may replace the checked-in baseline.
    for (let i = 0; i < times; i++) {
      const r = await replay({ tracePath: summary.tracePath });
      if (!r.ok) {
        result.error = `replay ${i + 1}/${times} diverged at action ${r.mismatch?.actionIndex} — adapter is nondeterministic, baseline NOT updated`;
        return result;
      }
      result.replaysOk = i + 1;
    }

    // 3. Only now touch the checked-in file.
    mkdirSync(dirname(baselinePath), { recursive: true });
    copyFileSync(summary.tracePath, baselinePath);
    result.ok = true;
    return result;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
