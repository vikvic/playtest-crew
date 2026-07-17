/**
 * Replay path: re-execute a trace through the SAME shared executor and
 * assert every preStateHash matches. The replayer never slips (design
 * doc W1 cut order) — it is the product's trust artifact.
 *
 * Header incompatibility (game/stateSource/adapterVersion) is refused as
 * a harness mismatch, never reported as game nondeterminism.
 *
 * W3 verification options: `observeOracles` runs the game's oracle engine
 * (invariants + hang) and the console-error watch during the replay and
 * reports every fire; `continueOnMismatch` keeps replaying past the first
 * hash mismatch (the verifier needs to see whether the oracle still
 * refires — a pre-fire mismatch is a nondeterminism trust signal, not an
 * automatic failure; src/verdict.ts decides). Plain replays keep the old
 * behavior: stop at the first mismatch, everything after it is noise.
 */

import { launchGame } from "./browser.ts";
import { getGame } from "./games/index.ts";
import { step, computeWait, type GameSession } from "./executor.ts";
import { readTrace, assertCompatible } from "./trace.ts";
import { OracleEngine, type OracleFire } from "./oracles.ts";
import type { ConsoleError } from "./runner.ts";

export interface HashMismatch {
  actionIndex: number;
  expected: string;
  actual: string;
  actualState: unknown;
}

export interface ReplayResult {
  ok: boolean;
  actionsReplayed: number;
  totalActions: number;
  /** First mismatch (replay stops here unless continueOnMismatch). */
  mismatch?: HashMismatch;
  consoleErrors: ConsoleError[];
  /** Oracle fires observed during replay; empty unless observeOracles. */
  fires: OracleFire[];
  traceTruncated: boolean;
}

export interface ReplayOptions {
  tracePath: string;
  headed?: boolean;
  maxWaitMs?: number;
  /** Run invariant/hang/console oracles during the replay and report fires. */
  observeOracles?: boolean;
  /** Keep replaying after a hash mismatch (verification needs the refire). */
  continueOnMismatch?: boolean;
}

export async function replay(opts: ReplayOptions): Promise<ReplayResult> {
  const trace = await readTrace(opts.tracePath);
  const game = getGame(trace.header.game);
  assertCompatible(trace.header, {
    game: game.name,
    stateSource: game.stateSource,
    adapterVersion: game.adapterVersion,
  });

  const result: ReplayResult = {
    ok: true,
    actionsReplayed: 0,
    totalActions: trace.lines.length,
    consoleErrors: [],
    fires: [],
    traceTruncated: trace.truncated,
  };

  const launch = await launchGame({
    game,
    seed: trace.header.seed,
    headed: opts.headed,
  });
  const { page } = launch;
  const session: GameSession = { page, readState: () => game.readState(page) };

  const pendingErrors: string[] = [];
  page.on("pageerror", (err) => pendingErrors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") pendingErrors.push(`console.error: ${msg.text()}`);
  });

  const oracles = opts.observeOracles ? new OracleEngine(game) : null;

  try {
    let prevTMs: number | null = null;
    for (const line of trace.lines) {
      const waitMs = computeWait(prevTMs, line.tMs, opts.maxWaitMs);
      prevTMs = line.tMs;
      const { preState, preStateHash } = await step(session, line.action, waitMs);
      result.actionsReplayed = line.i + 1;

      if (oracles) {
        result.fires.push(...oracles.observe(line.i, preState, preStateHash));
      }

      for (const text of pendingErrors.splice(0)) {
        result.consoleErrors.push({ afterActionIndex: line.i, text });
        if (oracles) {
          // Mirror the runner's console-error candidate identity: the
          // signature is the error text itself.
          result.fires.push({
            oracle: "console-error",
            atActionIndex: line.i,
            signature: text,
            detail: `console error after action ${line.i}`,
          });
        }
      }

      if (preStateHash !== line.preStateHash && result.mismatch === undefined) {
        result.ok = false;
        result.mismatch = {
          actionIndex: line.i,
          expected: line.preStateHash,
          actual: preStateHash,
          actualState: preState,
        };
        if (!opts.continueOnMismatch) break;
      }
    }
  } finally {
    await launch.close();
  }
  return result;
}
