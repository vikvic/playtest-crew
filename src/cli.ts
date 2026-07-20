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
  console.log(`playtest — replay-first autonomous playtest harness (v0, W3)

Commands:
  playtest run    --game 2048 [--driver random|explorer] [--out runs/<ts>] [--seed 42]
                  [--max-actions N] [--screenshot-every N] [--gap 120] [--headed]
                  [--llm-provider anthropic|openai-compatible] [--llm-model NAME]
                  (budget defaults come from specs/<game>.yaml; explorer:
                   anthropic needs ANTHROPIC_API_KEY (model default claude-opus-4-8);
                   openai-compatible talks to PTC_BASE_URL (default a local Ollama
                   at http://localhost:11434/v1, model default llama3.2) — no
                   API key needed for a local server. --llm-model overrides
                   PTC_MODEL for this run either way.)
  playtest verify --run <run-dir> | --finding <bundle-dir> [--times 3]
                  (replay each candidate's cut trace; finding = same oracle
                   refires within ±3 actions on EVERY replay, else flake)
  playtest hunt   --game 2048 --seeds 1-20 [--driver random|explorer]
                  [--max-actions N] [--out runs/hunt-<ts>] [--times 3]
                  (unattended sweep: run every seed, verify every candidate,
                   write report.md + report.json)
  playtest replay --trace <path> [--times 1] [--headed]
  playtest rebaseline --game 2048 [--seed 42] [--max-actions 60]
                  (re-records baselines/<game>/trace.jsonl against the current
                   adapter; only replaces it after a 3/3 replay verification)
`);
  process.exit(2);
}

function printVerdict(v: import("./verify.ts").BundleVerdict): void {
  const tag = v.verdict === "finding" ? "FINDING" : "flake";
  console.log(
    `  ${tag}: ${v.candidate.oracle}: ${v.candidate.signature} — ` +
      `${v.reproductions}/${v.observations.length} reproductions` +
      `${v.nondeterministic ? " (nondeterministic pre-fire state — trust accordingly)" : ""}`,
  );
  console.log(`    verdict.json: ${join(v.findingDir, "verdict.json")}`);
  if (v.verdict === "finding") {
    console.log(`    reproduce: bun src/cli.ts replay --trace ${join(v.findingDir, "trace.cut.jsonl")} --headed`);
  }
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
      "llm-provider": { type: "string", default: "anthropic" },
      "llm-model": { type: "string" },
      headed: { type: "boolean", default: false },
    },
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = values.out ?? join("runs", stamp);
  if (values.driver !== "random" && values.driver !== "explorer") {
    console.error(`--driver must be "random" or "explorer", got "${values.driver}"`);
    process.exit(2);
  }
  if (values["llm-provider"] !== "anthropic" && values["llm-provider"] !== "openai-compatible") {
    console.error(
      `--llm-provider must be "anthropic" or "openai-compatible", got "${values["llm-provider"]}"`,
    );
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
    llmProvider: values["llm-provider"] as "anthropic" | "openai-compatible",
    llmModel: values["llm-model"],
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
    console.log(`    (candidate = unverified; run \`bun src/cli.ts verify --run ${out}\` to judge it)`);
  }
  for (const c of summary.unverifiedCandidates) {
    console.log(`  unverified candidate (${c.oracle}: ${c.signature}) at action ${c.atActionIndex} — over max_verifications cap`);
  }
  if (summary.error) console.log(`  error:    ${summary.error}`);
  process.exit(summary.outcome === "harness-error" ? 1 : 0);
} else if (command === "verify") {
  const { values } = parseArgs({
    args: rest,
    options: {
      run: { type: "string" },
      finding: { type: "string" },
      times: { type: "string", default: "3" },
    },
  });
  if (!values.run && !values.finding) usage();
  const { verifyBundle, verifyRun } = await import("./verify.ts");
  const times = Number(values.times);
  const verdicts = values.finding
    ? [await verifyBundle({ findingDir: values.finding, times })]
    : await verifyRun(values.run!, { times });
  if (verdicts.length === 0) {
    console.log("no bundled candidates to verify in this run");
  }
  for (const v of verdicts) printVerdict(v);
  const findings = verdicts.filter((v) => v.verdict === "finding").length;
  console.log(`\nverify: ${findings} finding(s), ${verdicts.length - findings} flake(s)`);
  process.exit(0);
} else if (command === "hunt") {
  const { values } = parseArgs({
    args: rest,
    options: {
      game: { type: "string", default: "2048" },
      seeds: { type: "string" },
      driver: { type: "string", default: "random" },
      "max-actions": { type: "string" },
      out: { type: "string" },
      times: { type: "string", default: "3" },
    },
  });
  if (!values.seeds) usage();
  if (values.driver !== "random" && values.driver !== "explorer") {
    console.error(`--driver must be "random" or "explorer", got "${values.driver}"`);
    process.exit(2);
  }
  const { hunt, parseSeeds } = await import("./hunt.ts");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = await hunt({
    game: values.game!,
    seeds: parseSeeds(values.seeds),
    out: values.out ?? join("runs", `hunt-${stamp}`),
    driverName: values.driver,
    maxActions: values["max-actions"] === undefined ? undefined : Number(values["max-actions"]),
    times: Number(values.times),
  });
  console.log(`\nhunt: ${report.seeds.length} seeds, ${report.totalActions} actions`);
  console.log(
    `  ${report.findings.length} verified finding(s), ${report.flakes.length} flake(s), ` +
      `${report.unverified.length} unverified over budget`,
  );
  console.log(`  report: ${join(values.out ?? join("runs", `hunt-${stamp}`), "report.md")}`);
  process.exit(0);
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
