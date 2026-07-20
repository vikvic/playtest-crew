/**
 * Unattended bug hunt (W3): sweep a game across many seeds, auto-verify
 * every candidate the runs surface, and write one human-readable report.
 * Runs are lean (no video, no screenshots, gap 0) — the evidence that
 * matters is the cut trace, and each verified finding's report entry
 * carries the exact replay command.
 *
 * Honest accounting is the point: verified findings, flakes, and
 * over-budget unverified candidates are reported separately, and a hunt
 * that finds nothing says so plainly — "0 findings over N seeds × M
 * actions" is itself the deliverable.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, type RunSummary, type Candidate } from "./runner.ts";
import { verifyBundle, type BundleVerdict } from "./verify.ts";

export interface HuntOptions {
  game: string;
  seeds: number[];
  out: string;
  driverName?: string;
  maxActions?: number;
  /** Explorer only: which LLMClient to build. Default "anthropic". */
  llmProvider?: "anthropic" | "openai-compatible";
  /** Explorer only: overrides PTC_MODEL for every seed in the sweep. */
  llmModel?: string;
  /** Replays per candidate (default 3, the finding bar). */
  times?: number;
}

export interface HuntRunRecord {
  seed: number;
  outcome: RunSummary["outcome"];
  actions: number;
  distinctStates: number;
  candidates: number;
  error?: string;
}

export interface UnverifiedRecord extends Candidate {
  seed: number;
}

export interface HuntReport {
  game: string;
  driver: string;
  startedAt: string;
  finishedAt: string;
  seeds: number[];
  totalActions: number;
  runs: HuntRunRecord[];
  findings: BundleVerdict[];
  flakes: BundleVerdict[];
  /** Candidates over the per-run max_verifications cap — never replayed. */
  unverified: UnverifiedRecord[];
}

/** Parse a seed spec: "1-20", "3,5,9", or "7". Exported for tests. */
export function parseSeeds(spec: string): number[] {
  const seeds: number[] = [];
  for (const part of spec.split(",").map((s) => s.trim()).filter((s) => s.length > 0)) {
    const range = part.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (hi < lo) throw new Error(`seed range "${part}" is backwards`);
      if (hi - lo >= 10_000) throw new Error(`seed range "${part}" is implausibly large`);
      for (let s = lo; s <= hi; s++) seeds.push(s);
    } else if (/^-?\d+$/.test(part)) {
      seeds.push(Number(part));
    } else {
      throw new Error(`cannot parse seed spec part "${part}" (use "1-20", "3,5,9", or "7")`);
    }
  }
  if (seeds.length === 0) throw new Error("seed spec is empty");
  return seeds;
}

/** Render the markdown report. Pure. Exported for tests. */
export function renderReport(report: HuntReport): string {
  const md: string[] = [];
  md.push(`# Bug hunt: ${report.game}`);
  md.push("");
  md.push(
    `${report.seeds.length} seeds × up to ${Math.max(
      ...report.runs.map((r) => r.actions),
      0,
    )} actions (driver: ${report.driver}) — ` +
      `${report.totalActions} actions total, ${report.startedAt} → ${report.finishedAt}.`,
  );
  md.push("");
  md.push(
    `**${report.findings.length} verified finding(s)**, ${report.flakes.length} flake(s), ` +
      `${report.unverified.length} unverified candidate(s) over budget.`,
  );

  if (report.findings.length > 0) {
    md.push("");
    md.push(`## Verified findings (reproduced ${report.findings[0]!.observations.length}/${report.findings[0]!.observations.length})`);
    for (const f of report.findings) {
      md.push("");
      md.push(`### ${f.candidate.oracle}: ${f.candidate.signature}`);
      md.push("");
      md.push(`- ${f.candidate.detail}`);
      md.push(`- seed ${f.candidate.seed}, fires at action ${f.candidate.atActionIndex}`);
      if (f.nondeterministic) {
        md.push(`- ⚠ pre-fire state hash mismatch seen during replay (nondeterministic trace — trust accordingly)`);
      }
      md.push(`- evidence: \`${f.findingDir}\``);
      md.push(`- reproduce: \`bun src/cli.ts replay --trace ${join(f.findingDir, "trace.cut.jsonl")} --headed\``);
    }
  }

  if (report.flakes.length > 0) {
    md.push("");
    md.push("## Flakes (did not reproduce 3/3 — evidence kept, not bug reports)");
    for (const f of report.flakes) {
      md.push(
        `- ${f.candidate.oracle}: ${f.candidate.signature} (seed ${f.candidate.seed}, ` +
          `${f.reproductions}/${f.observations.length} reproductions) — \`${f.findingDir}\``,
      );
    }
  }

  if (report.unverified.length > 0) {
    md.push("");
    md.push("## Unverified candidates (over the per-run max_verifications cap)");
    for (const u of report.unverified) {
      md.push(`- ${u.oracle}: ${u.signature} (seed ${u.seed}, action ${u.atActionIndex})`);
    }
  }

  md.push("");
  md.push("## Runs");
  md.push("");
  md.push("| seed | outcome | actions | distinct states | candidates |");
  md.push("| ---: | --- | ---: | ---: | ---: |");
  for (const r of report.runs) {
    md.push(
      `| ${r.seed} | ${r.outcome}${r.error ? ` (${r.error})` : ""} | ${r.actions} | ${r.distinctStates} | ${r.candidates} |`,
    );
  }
  md.push("");
  return md.join("\n");
}

export async function hunt(opts: HuntOptions): Promise<HuntReport> {
  const driverName = opts.driverName ?? "random";
  mkdirSync(opts.out, { recursive: true });

  const report: HuntReport = {
    game: opts.game,
    driver: driverName,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    seeds: opts.seeds,
    totalActions: 0,
    runs: [],
    findings: [],
    flakes: [],
    unverified: [],
  };

  for (const seed of opts.seeds) {
    const runOut = join(opts.out, `seed-${seed}`);
    console.log(`hunt: seed ${seed} — running...`);
    const summary = await run({
      game: opts.game,
      out: runOut,
      seed,
      maxActions: opts.maxActions,
      screenshotEvery: 0,
      actionGapMs: 0,
      driverName,
      llmProvider: opts.llmProvider,
      llmModel: opts.llmModel,
      video: false,
    });
    report.totalActions += summary.actions;
    report.runs.push({
      seed,
      outcome: summary.outcome,
      actions: summary.actions,
      distinctStates: summary.distinctStates,
      candidates: summary.candidates.length + summary.unverifiedCandidates.length,
      ...(summary.error ? { error: summary.error } : {}),
    });
    for (const c of summary.unverifiedCandidates) {
      report.unverified.push({ ...c, seed });
    }
    for (const c of summary.candidates) {
      if (!c.dir) continue;
      console.log(`hunt: seed ${seed} — verifying ${c.oracle}: ${c.signature} ...`);
      const verdict = await verifyBundle({ findingDir: c.dir, times: opts.times });
      (verdict.verdict === "finding" ? report.findings : report.flakes).push(verdict);
      console.log(
        `hunt: seed ${seed} — ${verdict.verdict.toUpperCase()} ` +
          `(${verdict.reproductions}/${verdict.observations.length} reproductions)`,
      );
    }
  }

  report.finishedAt = new Date().toISOString();
  writeFileSync(join(opts.out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(opts.out, "report.md"), renderReport(report));
  return report;
}
