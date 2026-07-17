/**
 * Record path: a driver (seeded random, or the W2 LLM explorer) plays the
 * game through the shared executor, writing the trace as it goes. Oracles
 * ride along: console-error (event-driven), invariant + hang (state-driven,
 * src/oracles.ts). On fire, a candidate bundle is written with the trace
 * cut at the offending action.
 *
 * Outcomes: "pass" | "candidate-finding" | "harness-error".
 * ("finding" proper requires 3/3 replay verification — that pipeline is
 * W3; until then candidates are labeled honestly as candidates.)
 *
 * W2 candidate policy (design doc "Run Outcomes"): candidates are deduped
 * by (oracle tier, signature); at most max_verifications distinct
 * candidates get evidence bundles (they are the verification queue);
 * overflow is listed in the summary as unverified candidates, never as
 * findings. The run continues after a candidate — one broken invariant
 * shouldn't hide a console error 50 actions later.
 */

import { join } from "node:path";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { launchGame } from "./browser.ts";
import { getGame } from "./games/index.ts";
import type { GameConfig } from "./games/types.ts";
import { mulberry32 } from "./prng.ts";
import { step, type GameSession } from "./executor.ts";
import { OracleEngine, type OracleFire } from "./oracles.ts";
import { explorerDriver, type ExplorerStats } from "./explorer.ts";
import { AnthropicClient } from "./llm.ts";
import { TraceWriter, cutTrace, writeTraceFile, type TraceHeader, type TraceLine } from "./trace.ts";

export interface RunOptions {
  game: string;
  out: string;
  seed: number;
  /** Omitted flags fall back to the game spec's budgets. */
  maxActions?: number;
  screenshotEvery?: number;
  /** Nominal inter-action gap the driver aims for (ms). */
  actionGapMs: number;
  headed?: boolean;
  driver?: Driver;
  driverName?: string;
  /** Disable video recording (rebaseline wants a lean, fast run). */
  video?: boolean;
}

/**
 * A driver proposes the next action. The seeded random walker is the
 * baseline; the W2 explorer is the other implementation. Pure seam:
 * everything downstream (trace, hashing, oracles, replay) is driver-blind.
 */
export type Driver = (context: {
  game: GameConfig;
  state: unknown;
  actionIndex: number;
  history: TraceLine[];
}) => Promise<import("./trace.ts").Action> | import("./trace.ts").Action;

export interface ConsoleError {
  afterActionIndex: number;
  text: string;
}

export interface Candidate {
  oracle: string;
  signature: string;
  atActionIndex: number;
  detail: string;
  /** Bundle dir; absent for overflow beyond max_verifications. */
  dir?: string;
}

export interface RunSummary {
  outcome: "pass" | "candidate-finding" | "harness-error";
  game: string;
  runId: string;
  seed: number;
  driver: string;
  actions: number;
  /** Explorer-vs-random coverage metric: unique preStateHash count (T10). */
  distinctStates: number;
  budgetExhausted: boolean;
  tracePath: string;
  videoPath?: string;
  consoleErrors: ConsoleError[];
  /** Deduped (oracle, signature) candidates, bundled up to max_verifications. */
  candidates: Candidate[];
  /** Candidates beyond the max_verifications cap — queued, not bundled. */
  unverifiedCandidates: Candidate[];
  /** Present on explorer runs: API call count + random-fallback rate. */
  llm?: ExplorerStats;
  error?: string;
}

export const DEFAULT_ACTION_GAP_MS = 120;

export function randomDriver(seed: number): Driver {
  // Seeded so a run is re-creatable from (game, seed) alone. Offset keeps
  // driver and game PRNG streams distinct.
  const rng = mulberry32(seed ^ 0x9e3779b9);
  return ({ game }) => game.actions[Math.floor(rng() * game.actions.length)]!;
}

export async function run(opts: RunOptions): Promise<RunSummary> {
  const game = getGame(opts.game);
  const maxActions = opts.maxActions ?? game.budgets.maxActions;
  const screenshotEvery = opts.screenshotEvery ?? game.budgets.screenshotEvery;
  const driverName = opts.driverName ?? "random";
  let driver = opts.driver;
  let llmStats: ExplorerStats | undefined;
  // Set once the browser is up; decisions are stamped with an offset into
  // the video so each llm.jsonl line can be found in the recording.
  let videoStartedAt: number | undefined;
  if (!driver) {
    if (driverName === "explorer") {
      const llmLogPath = join(opts.out, "llm.jsonl");
      const explorer = explorerDriver(new AnthropicClient(), opts.seed, (decision) => {
        const now = Date.now();
        const videoTMs = videoStartedAt === undefined ? null : now - videoStartedAt;
        const videoTs =
          videoTMs === null
            ? null
            : `${Math.floor(videoTMs / 60_000)}:${((videoTMs % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
        appendFileSync(llmLogPath, JSON.stringify({ videoTs, videoTMs, ...decision }) + "\n");
      });
      driver = explorer.driver;
      llmStats = explorer.stats;
    } else {
      driver = randomDriver(opts.seed);
    }
  }

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
    driver: driverName,
    actions: 0,
    distinctStates: 0,
    budgetExhausted: false,
    tracePath,
    consoleErrors: [],
    candidates: [],
    unverifiedCandidates: [],
  };

  let launch;
  try {
    launch = await launchGame({
      game,
      seed: opts.seed,
      headed: opts.headed,
      videoDir: opts.video === false ? undefined : join(opts.out, "video"),
    });
  } catch (e) {
    summary.outcome = "harness-error";
    summary.error = `Game failed to load: ${e instanceof Error ? e.message : String(e)}`;
    writeFileSync(join(opts.out, "summary.json"), JSON.stringify(summary, null, 2));
    return summary;
  }

  const { page } = launch;
  videoStartedAt = launch.videoStartedAt;
  const session: GameSession = { page, readState: () => game.readState(page) };

  // Console-error oracle (tier 2, "free bugs"): page errors + console.error.
  const pendingErrors: string[] = [];
  page.on("pageerror", (err) => pendingErrors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") pendingErrors.push(`console.error: ${msg.text()}`);
  });

  const oracles = new OracleEngine(game);
  const seenSignatures = new Set<string>();
  const seenHashes = new Set<string>();
  const lines: TraceLine[] = []; // in-memory mirror so bundles can cut without closing the writer

  const writer = new TraceWriter(tracePath);
  writer.writeHeader(header);

  async function recordCandidate(fire: OracleFire, extraEvidence?: string): Promise<void> {
    const key = `${fire.oracle}:${fire.signature}`;
    if (seenSignatures.has(key)) return; // dedupe by (tier, signature)
    seenSignatures.add(key);

    const candidate: Candidate = {
      oracle: fire.oracle,
      signature: fire.signature,
      atActionIndex: fire.atActionIndex,
      detail: fire.detail,
    };

    if (summary.candidates.length >= game.budgets.maxVerifications) {
      summary.unverifiedCandidates.push(candidate);
      return;
    }

    // Bundle: trace cut at the firing action + evidence.
    const dirName = `${fire.oracle}-${fire.atActionIndex}`;
    const findingDir = join(opts.out, "findings", dirName);
    mkdirSync(findingDir, { recursive: true });
    await writeTraceFile(
      join(findingDir, "trace.cut.jsonl"),
      cutTrace({ header, lines: [...lines], truncated: false }, fire.atActionIndex),
    );
    writeFileSync(
      join(findingDir, "oracle.txt"),
      extraEvidence !== undefined ? `${fire.detail}\n\n${extraEvidence}` : fire.detail,
    );
    // Machine-readable candidate identity — the W3 verifier reads this to
    // know which (oracle, signature) must refire during replay.
    writeFileSync(
      join(findingDir, "candidate.json"),
      JSON.stringify(
        {
          game: game.name,
          seed: opts.seed,
          oracle: fire.oracle,
          signature: fire.signature,
          atActionIndex: fire.atActionIndex,
          detail: fire.detail,
        },
        null,
        2,
      ),
    );
    await page.screenshot({ path: join(findingDir, "at-fire.png") });
    candidate.dir = findingDir;
    summary.candidates.push(candidate);
    summary.outcome = "candidate-finding";
  }

  const t0 = Date.now();
  try {
    for (let i = 0; i < maxActions; i++) {
      // Fresh read for the driver: the explorer must see the CURRENT state
      // (post previous action), or it can't tell that its last move was a
      // no-op and will wedge on it. The executor re-reads inside step() for
      // the hash; the double read is a cheap evaluate and race-free for
      // input-driven games.
      const preview = await session.readState();
      const action = await driver({ game, state: preview, actionIndex: i, history: lines });

      const { preState, preStateHash } = await step(session, action, i === 0 ? 0 : opts.actionGapMs);
      const tMs = Date.now() - t0;

      const line: TraceLine = { i, tMs, action, preStateHash };
      if (screenshotEvery > 0 && i % screenshotEvery === 0) {
        const ref = `shots/${String(i).padStart(4, "0")}.png`;
        await page.screenshot({ path: join(opts.out, ref) });
        line.screenshotRef = ref;
      }
      writer.writeLine(line);
      lines.push(line);
      summary.actions = i + 1;
      seenHashes.add(preStateHash);

      // State-driven oracles (invariant + hang) observe the pre-action state.
      for (const fire of oracles.observe(i, preState, preStateHash)) {
        await recordCandidate(fire);
      }

      // Event-driven console oracle.
      if (pendingErrors.length > 0) {
        const errors = pendingErrors.splice(0);
        for (const text of errors) summary.consoleErrors.push({ afterActionIndex: i, text });
        await recordCandidate(
          {
            oracle: "console-error",
            atActionIndex: i,
            signature: errors[0]!,
            detail: `console error after action ${i}`,
          },
          errors.join("\n"),
        );
      }
    }
    if (summary.actions >= maxActions) {
      summary.budgetExhausted = true; // budget exhaustion, per Run Outcomes
    }
  } catch (e) {
    summary.outcome = "harness-error";
    summary.error = e instanceof Error ? e.message : String(e);
  } finally {
    await writer.close();
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

  summary.distinctStates = seenHashes.size;
  if (llmStats) summary.llm = llmStats;
  writeFileSync(join(opts.out, "summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}
