/**
 * Replay verification of candidate findings (W3). This is where a
 * "candidate" earns the name "finding": replay its cut trace 3 times with
 * oracles observing; the same (oracle, signature) must refire within ±3
 * actions of the original index on EVERY replay, or the candidate is
 * demoted to a flake. Judgment semantics live in src/verdict.ts (pure,
 * unit-tested); this module produces the observations by actually
 * re-running the trace.
 *
 * Each verified bundle gains a verdict.json next to its trace.cut.jsonl —
 * the complete verification record (verdict, per-replay observations,
 * nondeterminism flag).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { replay } from "./replayer.ts";
import type { OracleFire } from "./oracles.ts";
import {
  judge,
  DEFAULT_REPLAY_INDEX_TOLERANCE,
  REQUIRED_REPRODUCTIONS,
  type ReplayObservation,
  type Verdict,
} from "./verdict.ts";

/** Written by the runner into each bundle as candidate.json. */
export interface CandidateMeta {
  game: string;
  seed: number;
  oracle: string;
  signature: string;
  atActionIndex: number;
  detail: string;
}

export interface BundleVerdict extends Verdict {
  findingDir: string;
  candidate: CandidateMeta;
  observations: ReplayObservation[];
}

/** Reduce one observed replay to what the verdict logic needs. Pure. */
export function toObservation(
  fires: OracleFire[],
  firstHashMismatchIndex: number | null,
  target: { oracle: string; signature: string },
): ReplayObservation {
  const refire = fires.find(
    (f) => f.oracle === target.oracle && f.signature === target.signature,
  );
  return {
    refiredAtIndex: refire ? refire.atActionIndex : null,
    firstHashMismatchIndex,
  };
}

export interface VerifyBundleOptions {
  /** A findings/<oracle>-<i>/ dir containing candidate.json + trace.cut.jsonl. */
  findingDir: string;
  times?: number;
  tolerance?: number;
  headed?: boolean;
}

export async function verifyBundle(opts: VerifyBundleOptions): Promise<BundleVerdict> {
  const candidatePath = join(opts.findingDir, "candidate.json");
  if (!existsSync(candidatePath)) {
    throw new Error(
      `${opts.findingDir} has no candidate.json — bundle predates the W3 verifier; re-record the run`,
    );
  }
  const candidate = JSON.parse(readFileSync(candidatePath, "utf8")) as CandidateMeta;
  const tracePath = join(opts.findingDir, "trace.cut.jsonl");
  const times = opts.times ?? REQUIRED_REPRODUCTIONS;

  const observations: ReplayObservation[] = [];
  for (let t = 0; t < times; t++) {
    const r = await replay({
      tracePath,
      headed: opts.headed,
      observeOracles: true,
      continueOnMismatch: true,
    });
    observations.push(toObservation(r.fires, r.mismatch?.actionIndex ?? null, candidate));
  }

  const verdict = judge(
    candidate.atActionIndex,
    observations,
    opts.tolerance ?? DEFAULT_REPLAY_INDEX_TOLERANCE,
  );
  const result: BundleVerdict = {
    findingDir: opts.findingDir,
    candidate,
    observations,
    ...verdict,
  };
  writeFileSync(join(opts.findingDir, "verdict.json"), JSON.stringify(result, null, 2));
  return result;
}

/** Verify every bundled candidate of a completed run (reads summary.json). */
export async function verifyRun(
  runDir: string,
  opts: { times?: number; tolerance?: number } = {},
): Promise<BundleVerdict[]> {
  const summary = JSON.parse(readFileSync(join(runDir, "summary.json"), "utf8")) as {
    candidates?: { dir?: string }[];
  };
  const results: BundleVerdict[] = [];
  for (const c of summary.candidates ?? []) {
    if (!c.dir) continue;
    results.push(await verifyBundle({ findingDir: c.dir, ...opts }));
  }
  return results;
}
