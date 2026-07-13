#!/usr/bin/env bun
/**
 * playtest — CLI entry.
 *
 *   playtest run    --game 2048 --out runs/<ts> [--seed 42] [--max-actions 200]
 *                   [--screenshot-every 10] [--gap 120] [--headed]
 *   playtest replay --trace <path> [--times 1] [--headed]
 */

// ── Windows runtime hop ─────────────────────────────────────────────
// Bun cannot complete Playwright's Chromium launch handshake on Windows
// (oven-sh/bun#27977; raw CDP works, Playwright's transport stalls). The
// gstack browse daemon ships the same fallback: run the browser-touching
// process under Node. Node ≥23.6 strips TS types natively, so the SAME
// source files run unchanged. Linux/macOS (and CI) stay pure Bun.
if (
  process.platform === "win32" &&
  typeof (globalThis as Record<string, unknown>).Bun !== "undefined" &&
  !process.env.PTC_NO_NODE_HOP
) {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const self = fileURLToPath(import.meta.url);
  const result = spawnSync("node", [self, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, PTC_NO_NODE_HOP: "1" },
    shell: false,
  });
  if (result.error) {
    console.error(
      `Could not hop to Node (${result.error.message}). ` +
        `Playwright needs Node on Windows until oven-sh/bun#27977 is fixed — install Node 23.6+.`,
    );
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

import { parseArgs } from "node:util";
import { join } from "node:path";
import { run, DEFAULT_ACTION_GAP_MS } from "./runner.ts";
import { replay } from "./replayer.ts";
import { HarnessMismatchError, TraceFormatError } from "./trace.ts";

function usage(): never {
  console.log(`playtest — replay-first autonomous playtest harness (v0, W2)

Commands:
  playtest run    --game 2048 [--driver random|explorer] [--out runs/<ts>] [--seed 42]
                  [--max-actions N] [--screenshot-every N] [--gap 120] [--headed]
                  (budget defaults come from specs/<game>.yaml; explorer needs
                   ANTHROPIC_API_KEY, model via PTC_MODEL, default claude-opus-4-8)
  playtest replay --trace <path> [--times 1] [--headed]
  playtest rebaseline --game 2048 [--seed 42] [--max-actions 60]
                  (re-records baselines/<game>/trace.jsonl against the current
                   adapter; only replaces it after a 3/3 replay verification)
`);
  process.exit(2);
}

const [, , command, ...rest] = process.argv;

if (command === "run") {
  const { values } = parseArgs({
    args: rest,
    options: {
      game: { type: "string", default: "2048" },
      out: { type: "string" },
      seed: { type: "string", default: "42" },
      // max-actions / screenshot-every default to the game spec's budgets
      "max-actions": { type: "string" },
      "screenshot-every": { type: "string" },
      gap: { type: "string", default: String(DEFAULT_ACTION_GAP_MS) },
      driver: { type: "string", default: "random" },
      headed: { type: "boolean", default: false },
    },
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = values.out ?? join("runs", stamp);
  if (values.driver !== "random" && values.driver !== "explorer") {
    console.error(`--driver must be "random" or "explorer", got "${values.driver}"`);
    process.exit(2);
  }
  const summary = await run({
    game: values.game!,
    out,
    seed: Number(values.seed),
    maxActions: values["max-actions"] === undefined ? undefined : Number(values["max-actions"]),
    screenshotEvery:
      values["screenshot-every"] === undefined ? undefined : Number(values["screenshot-every"]),
    actionGapMs: Number(values.gap),
    driverName: values.driver,
    headed: values.headed,
  });
  console.log(`\nrun ${summary.runId}`);
  console.log(`  outcome:  ${summary.outcome}${summary.budgetExhausted ? " (budget exhausted)" : ""}`);
  console.log(`  driver:   ${summary.driver}`);
  console.log(`  actions:  ${summary.actions} (${summary.distinctStates} distinct states)`);
  if (summary.llm) {
    console.log(`  llm:      ${summary.llm.client} — ${summary.llm.calls} calls, ${summary.llm.randomFallbacks} random fallbacks`);
    console.log(`  decisions: ${join(out, "llm.jsonl")} (per-call reasoning, video timestamps)`);
  }
  console.log(`  trace:    ${summary.tracePath}`);
  if (summary.videoPath) console.log(`  video:    ${summary.videoPath}`);
  for (const c of summary.candidates) {
    console.log(`  CANDIDATE finding (${c.oracle}: ${c.signature}) at action ${c.atActionIndex}: ${c.dir}`);
    console.log(`    (candidate = unverified; replay verification lands in W3)`);
  }
  for (const c of summary.unverifiedCandidates) {
    console.log(`  unverified candidate (${c.oracle}: ${c.signature}) at action ${c.atActionIndex} — over max_verifications cap`);
  }
  if (summary.error) console.log(`  error:    ${summary.error}`);
  process.exit(summary.outcome === "harness-error" ? 1 : 0);
} else if (command === "replay") {
  const { values } = parseArgs({
    args: rest,
    options: {
      trace: { type: "string" },
      times: { type: "string", default: "1" },
      headed: { type: "boolean", default: false },
    },
  });
  if (!values.trace) usage();
  const times = Number(values.times);
  let allOk = true;
  for (let attempt = 1; attempt <= times; attempt++) {
    try {
      const result = await replay({ tracePath: values.trace, headed: values.headed });
      const label = times > 1 ? ` [${attempt}/${times}]` : "";
      if (result.traceTruncated) {
        console.log(`note${label}: trace had a truncated final line (dropped); replaying the complete prefix`);
      }
      if (result.ok) {
        console.log(`replay${label}: OK — ${result.actionsReplayed}/${result.totalActions} actions, all preStateHash match`);
      } else {
        allOk = false;
        const m = result.mismatch!;
        console.log(`replay${label}: HASH MISMATCH at action ${m.actionIndex}`);
        console.log(`  expected ${m.expected}`);
        console.log(`  actual   ${m.actual}`);
        console.log(`  actual state: ${JSON.stringify(m.actualState)}`);
      }
      for (const e of result.consoleErrors) {
        console.log(`  console error after action ${e.afterActionIndex}: ${e.text}`);
      }
    } catch (e) {
      if (e instanceof HarnessMismatchError || e instanceof TraceFormatError) {
        console.error(`${e.name}: ${e.message}`);
        process.exit(2); // harness/format problem, not game nondeterminism
      }
      throw e;
    }
  }
  process.exit(allOk ? 0 : 1);
} else if (command === "rebaseline") {
  const { values } = parseArgs({
    args: rest,
    options: {
      game: { type: "string", default: "2048" },
      seed: { type: "string", default: "42" },
      "max-actions": { type: "string", default: "60" },
    },
  });
  const { rebaseline } = await import("./rebaseline.ts");
  const result = await rebaseline({
    game: values.game!,
    seed: Number(values.seed),
    maxActions: Number(values["max-actions"]),
  });
  if (result.ok) {
    console.log(`rebaseline OK — ${result.actions} actions, ${result.replaysOk}/3 replays clean`);
    console.log(`  baseline updated: ${result.baselinePath}`);
    console.log(`  commit it together with the adapter change.`);
    process.exit(0);
  } else {
    console.error(`rebaseline FAILED: ${result.error}`);
    console.error(`  the checked-in baseline was NOT modified.`);
    process.exit(1);
  }
} else {
  usage();
}
