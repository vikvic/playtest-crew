/**
 * Record path: random driver (W1) plays the game through the shared
 * executor, writing the trace as it goes. Console-error oracle rides
 * along — on fire, the trace is cut at the offending action and a
 * candidate-finding bundle is written.
 *
 * W1 outcomes: "pass" | "candidate-finding" | "harness-error".
 * ("finding" proper requires 3/3 replay verification — that pipeline is
 * W3; until then candidates are labeled honestly as candidates.)
 */

import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { launchGame } from "./browser.ts";
import { getGame } from "./games/index.ts";
import { mulberry32 } from "./prng.ts";
import { step, type GameSession } from "./executor.ts";
import {
  TraceWriter,
  cutTrace,
  readTrace,
  writeTraceFile,
  type TraceHeader,
  type TraceLine,
} from "./trace.ts";

export interface RunOptions {
  game: string;
  out: string;
  seed: number;
  maxActions: number;
  screenshotEvery: number;
  /** Nominal inter-action gap the driver aims for (ms). */
  actionGapMs: number;
  headed?: boolean;
}

export interface ConsoleError {
  afterActionIndex: number;
  text: string;
}

export interface RunSummary {
  outcome: "pass" | "candidate-finding" | "harness-error";
  game: string;
  runId: string;
  seed: number;
  actions: number;
  budgetExhausted: boolean;
  tracePath: string;
  videoPath?: string;
  consoleErrors: ConsoleError[];
  findings: { dir: string; oracle: string; atActionIndex: number }[];
  error?: string;
}

export const DEFAULT_RUN_OPTIONS = {
  seed: 42,
  maxActions: 200,
  screenshotEvery: 10,
  actionGapMs: 120,
};

export async function run(opts: RunOptions): Promise<RunSummary> {
  const game = getGame(opts.game);
  const runId = `${opts.game}-${Date.now().toString(36)}-seed${opts.seed}`;
  mkdirSync(opts.out, { recursive: true });
  mkdirSync(join(opts.out, "shots"), { recursive: true });

  const tracePath = join(opts.out, "trace.jsonl");
  const header: TraceHeader = {
    v: 1,
    game: game.name,
    runId,
    seedStrategy: game.seedStrategy,
    seed: opts.seed,
    viewport: game.viewport,
    stateSource: game.stateSource,
    adapterVersion: game.adapterVersion,
  };

  const summary: RunSummary = {
    outcome: "pass",
    game: game.name,
    runId,
    seed: opts.seed,
    actions: 0,
    budgetExhausted: false,
    tracePath,
    consoleErrors: [],
    findings: [],
  };

  let launch;
  try {
    launch = await launchGame({
      game,
      seed: opts.seed,
      headed: opts.headed,
      videoDir: join(opts.out, "video"),
    });
  } catch (e) {
    summary.outcome = "harness-error";
    summary.error = `Game failed to load: ${e instanceof Error ? e.message : String(e)}`;
    writeFileSync(join(opts.out, "summary.json"), JSON.stringify(summary, null, 2));
    return summary;
  }

  const { page } = launch;
  const session: GameSession = { page, readState: () => game.readState(page) };

  // Console-error oracle (tier 2, "free bugs"): page errors + console.error.
  const pendingErrors: string[] = [];
  page.on("pageerror", (err) => pendingErrors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") pendingErrors.push(`console.error: ${msg.text()}`);
  });

  // The driver's choices are themselves seeded so a run is re-creatable
  // from (game, seed) alone. Offset keeps driver and game streams distinct.
  const driverRng = mulberry32(opts.seed ^ 0x9e3779b9);

  const writer = new TraceWriter(tracePath);
  writer.writeHeader(header);

  const t0 = Date.now();
  try {
    for (let i = 0; i < opts.maxActions; i++) {
      const action = game.actions[Math.floor(driverRng() * game.actions.length)]!;
      const { preStateHash } = await step(session, action, i === 0 ? 0 : opts.actionGapMs);
      const tMs = Date.now() - t0;

      const line: TraceLine = { i, tMs, action, preStateHash };
      // Sampled screenshots: every N actions + on oracle fire (never per-action).
      if (i % opts.screenshotEvery === 0) {
        const ref = `shots/${String(i).padStart(4, "0")}.png`;
        await page.screenshot({ path: join(opts.out, ref) });
        line.screenshotRef = ref;
      }
      writer.writeLine(line);
      summary.actions = i + 1;

      if (pendingErrors.length > 0) {
        const errors = pendingErrors.splice(0);
        for (const text of errors) summary.consoleErrors.push({ afterActionIndex: i, text });

        // Candidate finding: cut the trace at the firing action, bundle evidence.
        const findingDir = join(opts.out, "findings", `console-error-${i}`);
        mkdirSync(findingDir, { recursive: true });
        await writer.close();
        const full = await readTrace(tracePath);
        await writeTraceFile(join(findingDir, "trace.cut.jsonl"), cutTrace(full, i));
        writeFileSync(join(findingDir, "console.txt"), errors.join("\n"));
        await page.screenshot({ path: join(findingDir, "at-fire.png") });
        summary.findings.push({ dir: findingDir, oracle: "console-error", atActionIndex: i });
        summary.outcome = "candidate-finding";
        break; // one candidate ends the W1 run; verification pipeline is W3
      }
    }
    if (summary.outcome === "pass" && summary.actions >= opts.maxActions) {
      summary.budgetExhausted = true; // pass by budget exhaustion, per Run Outcomes
    }
  } catch (e) {
    summary.outcome = "harness-error";
    summary.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (summary.outcome !== "candidate-finding") await writer.close();
    const video = page.video();
    await launch.close();
    if (video) {
      try {
        summary.videoPath = await video.path();
      } catch {
        // video may be unavailable if the context died; not fatal
      }
    }
  }

  writeFileSync(join(opts.out, "summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}
