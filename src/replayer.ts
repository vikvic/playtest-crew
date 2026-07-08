/**
 * Replay path: re-execute a trace through the SAME shared executor and
 * assert every preStateHash matches. The replayer never slips (design
 * doc W1 cut order) — it is the product's trust artifact.
 *
 * Header incompatibility (game/stateSource/adapterVersion) is refused as
 * a harness mismatch, never reported as game nondeterminism.
 */

import { launchGame } from "./browser.ts";
import { getGame } from "./games/index.ts";
import { step, computeWait, type GameSession } from "./executor.ts";
import { readTrace, assertCompatible } from "./trace.ts";
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
  /** First mismatch stops the replay — everything after it is noise. */
  mismatch?: HashMismatch;
  consoleErrors: ConsoleError[];
  traceTruncated: boolean;
}

export interface ReplayOptions {
  tracePath: string;
  headed?: boolean;
  maxWaitMs?: number;
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

  try {
    let prevTMs: number | null = null;
    for (const line of trace.lines) {
      const waitMs = computeWait(prevTMs, line.tMs, opts.maxWaitMs);
      prevTMs = line.tMs;
      const { preState, preStateHash } = await step(session, line.action, waitMs);
      result.actionsReplayed = line.i + 1;

      for (const text of pendingErrors.splice(0)) {
        result.consoleErrors.push({ afterActionIndex: line.i, text });
      }

      if (preStateHash !== line.preStateHash) {
        result.ok = false;
        result.mismatch = {
          actionIndex: line.i,
          expected: line.preStateHash,
          actual: preStateHash,
          actualState: preState,
        };
        break;
      }
    }
  } finally {
    await launch.close();
  }
  return result;
}
