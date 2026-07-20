/**
 * Cross-model comparison (TODOS #2): run the explorer against the same
 * game/seed/budget under different LLMClient configs, and report which
 * model actually explores better — distinct-state coverage, random-fallback
 * rate, and per-call latency — instead of just "can it play."
 *
 * A model that fails to run (missing API key, model not found) doesn't
 * abort the whole comparison — it's recorded as a row with its error, same
 * honest-accounting philosophy as hunt's findings/flakes/unverified split.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./runner.ts";

export interface BenchModelSpec {
  provider: "anthropic" | "openai-compatible" | "gemini";
  model: string;
}

export interface BenchResult {
  label: string;
  outcome: string;
  actions: number;
  distinctStates: number;
  coverageRate: number;
  calls: number;
  randomFallbacks: number;
  /** Mean gap between consecutive LLM calls, from llm.jsonl's videoTMs. */
  avgCallLatencyMs: number | null;
  error?: string;
}

export interface BenchReport {
  game: string;
  seed: number;
  maxActions: number;
  models: BenchResult[];
}

/** Parse "provider:model,provider:model" — model may itself contain colons
 * (e.g. "openai-compatible:qwen2.5:7b-instruct"), so split on the first. */
export function parseModelSpecs(spec: string): BenchModelSpec[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((part) => {
      const i = part.indexOf(":");
      if (i < 0) throw new Error(`model spec "${part}" must be "provider:model"`);
      const provider = part.slice(0, i);
      const model = part.slice(i + 1);
      if (provider !== "anthropic" && provider !== "openai-compatible" && provider !== "gemini") {
        throw new Error(
          `unknown provider "${provider}" in model spec "${part}" (use anthropic, openai-compatible, or gemini)`,
        );
      }
      if (!model) throw new Error(`model spec "${part}" is missing a model name`);
      return { provider, model };
    });
}

/** Mean delta between consecutive per-call video timestamps. Exported for tests. */
export function avgLatencyMs(videoTMsSeries: Array<number | null>): number | null {
  const timestamps = videoTMsSeries.filter((t): t is number => t !== null);
  if (timestamps.length < 2) return null;
  let total = 0;
  for (let i = 1; i < timestamps.length; i++) total += timestamps[i]! - timestamps[i - 1]!;
  return total / (timestamps.length - 1);
}

function readLlmLatency(llmLogPath: string): number | null {
  let text: string;
  try {
    text = readFileSync(llmLogPath, "utf8");
  } catch {
    return null;
  }
  const series = text
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => (JSON.parse(l) as { videoTMs: number | null }).videoTMs);
  return avgLatencyMs(series);
}

/** Render the markdown comparison table. Pure. Exported for tests. */
export function renderBenchReport(report: BenchReport): string {
  const md: string[] = [];
  md.push(`# Model bench: ${report.game}, seed ${report.seed}, ${report.maxActions} actions`);
  md.push("");
  md.push("| model | outcome | distinct states | coverage | calls | fallbacks | avg latency |");
  md.push("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
  for (const m of report.models) {
    const coverage = `${Math.round(m.coverageRate * 100)}%`;
    const latency = m.avgCallLatencyMs === null ? "n/a" : `${Math.round(m.avgCallLatencyMs)}ms`;
    const outcome = m.error ? `${m.outcome} (${m.error})` : m.outcome;
    md.push(
      `| ${m.label} | ${outcome} | ${m.distinctStates} | ${coverage} | ${m.calls} | ${m.randomFallbacks} | ${latency} |`,
    );
  }
  md.push("");
  return md.join("\n");
}

export interface BenchOptions {
  game: string;
  seed: number;
  maxActions: number;
  models: BenchModelSpec[];
  out: string;
}

export async function bench(opts: BenchOptions): Promise<BenchReport> {
  mkdirSync(opts.out, { recursive: true });
  const report: BenchReport = { game: opts.game, seed: opts.seed, maxActions: opts.maxActions, models: [] };

  for (const spec of opts.models) {
    const label = `${spec.provider}:${spec.model}`;
    const runOut = join(opts.out, label.replace(/[^a-zA-Z0-9_.-]/g, "_"));
    console.log(`bench: ${label} — running...`);
    try {
      const summary = await run({
        game: opts.game,
        out: runOut,
        seed: opts.seed,
        maxActions: opts.maxActions,
        screenshotEvery: 0,
        actionGapMs: 0,
        driverName: "explorer",
        llmProvider: spec.provider,
        llmModel: spec.model,
        video: false,
      });
      report.models.push({
        label,
        outcome: summary.outcome,
        actions: summary.actions,
        distinctStates: summary.distinctStates,
        coverageRate: summary.actions > 0 ? summary.distinctStates / summary.actions : 0,
        calls: summary.llm?.calls ?? 0,
        randomFallbacks: summary.llm?.randomFallbacks ?? 0,
        avgCallLatencyMs: readLlmLatency(join(runOut, "llm.jsonl")),
      });
      console.log(
        `bench: ${label} — ${summary.outcome}, ${summary.distinctStates}/${summary.actions} distinct states`,
      );
    } catch (e) {
      report.models.push({
        label,
        outcome: "harness-error",
        actions: 0,
        distinctStates: 0,
        coverageRate: 0,
        calls: 0,
        randomFallbacks: 0,
        avgCallLatencyMs: null,
        error: e instanceof Error ? e.message : String(e),
      });
      console.log(`bench: ${label} — FAILED (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  writeFileSync(join(opts.out, "bench.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(opts.out, "bench.md"), renderBenchReport(report));
  return report;
}
