import { describe, expect, test } from "bun:test";
import { parseSeeds, renderReport, type HuntReport } from "../src/hunt.ts";

describe("parseSeeds", () => {
  test.each([
    ["7", [7]],
    ["1-4", [1, 2, 3, 4]],
    ["3,5,9", [3, 5, 9]],
    ["1-3,10", [1, 2, 3, 10]],
    [" 2 , 4 ", [2, 4]],
  ])("%s → %p", (spec, expected) => {
    expect(parseSeeds(spec)).toEqual(expected);
  });

  test.each([["abc"], ["4-1"], [""], ["1-999999"]])("rejects %s", (spec) => {
    expect(() => parseSeeds(spec)).toThrow();
  });
});

function reportFixture(): HuntReport {
  return {
    game: "2048",
    driver: "random",
    startedAt: "2026-07-12T10:00:00Z",
    finishedAt: "2026-07-12T10:05:00Z",
    seeds: [1, 2],
    totalActions: 400,
    runs: [
      { seed: 1, outcome: "candidate-finding", actions: 200, distinctStates: 120, candidates: 1 },
      { seed: 2, outcome: "pass", actions: 200, distinctStates: 118, candidates: 0 },
    ],
    findings: [
      {
        findingDir: "runs/hunt/seed-1/findings/invariant-42",
        candidate: {
          game: "2048",
          seed: 1,
          oracle: "invariant",
          signature: "score-sane",
          atActionIndex: 42,
          detail: 'invariant "score-sane" violated',
        },
        observations: [
          { refiredAtIndex: 42, firstHashMismatchIndex: null },
          { refiredAtIndex: 42, firstHashMismatchIndex: null },
          { refiredAtIndex: 43, firstHashMismatchIndex: null },
        ],
        verdict: "finding",
        reproductions: 3,
        nondeterministic: false,
      },
    ],
    flakes: [
      {
        findingDir: "runs/hunt/seed-2/findings/hang-77",
        candidate: {
          game: "2048",
          seed: 2,
          oracle: "hang",
          signature: "hang",
          atActionIndex: 77,
          detail: "state hash unchanged",
        },
        observations: [
          { refiredAtIndex: null, firstHashMismatchIndex: 10 },
          { refiredAtIndex: 77, firstHashMismatchIndex: null },
          { refiredAtIndex: 77, firstHashMismatchIndex: null },
        ],
        verdict: "flake",
        reproductions: 2,
        nondeterministic: true,
      },
    ],
    unverified: [
      {
        seed: 1,
        oracle: "console-error",
        signature: "boom",
        atActionIndex: 90,
        detail: "console error after action 90",
      },
    ],
  };
}

describe("renderReport", () => {
  test("carries counts, sections, and the replay command", () => {
    const md = renderReport(reportFixture());
    expect(md).toContain("# Bug hunt: 2048");
    expect(md).toContain("**1 verified finding(s)**, 1 flake(s), 1 unverified candidate(s)");
    expect(md).toContain("### invariant: score-sane");
    expect(md).toContain("replay --trace");
    expect(md).toContain("trace.cut.jsonl");
    expect(md).toContain("## Flakes");
    expect(md).toContain("2/3 reproductions");
    expect(md).toContain("## Unverified candidates");
    expect(md).toContain("| 1 | candidate-finding | 200 | 120 | 1 |");
  });

  test("a clean hunt reads as zero findings, no bug sections", () => {
    const clean: HuntReport = { ...reportFixture(), findings: [], flakes: [], unverified: [] };
    const md = renderReport(clean);
    expect(md).toContain("**0 verified finding(s)**");
    expect(md).not.toContain("## Verified findings");
    expect(md).not.toContain("## Flakes");
  });
});
