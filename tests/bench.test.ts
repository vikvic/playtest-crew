import { describe, expect, test } from "bun:test";
import { parseModelSpecs, avgLatencyMs, renderBenchReport, type BenchReport } from "../src/bench.ts";

describe("parseModelSpecs", () => {
  test("splits on the first colon so a model name may itself contain one", () => {
    expect(parseModelSpecs("openai-compatible:qwen2.5:7b-instruct")).toEqual([
      { provider: "openai-compatible", model: "qwen2.5:7b-instruct" },
    ]);
  });

  test("parses a comma-separated list, trimming whitespace", () => {
    expect(parseModelSpecs(" anthropic:claude-opus-4-8 , gemini:gemini-2.5-flash ")).toEqual([
      { provider: "anthropic", model: "claude-opus-4-8" },
      { provider: "gemini", model: "gemini-2.5-flash" },
    ]);
  });

  test("rejects an unknown provider", () => {
    expect(() => parseModelSpecs("ollama:llama3.2")).toThrow(/unknown provider/);
  });

  test("rejects a spec with no colon", () => {
    expect(() => parseModelSpecs("llama3.2")).toThrow(/must be "provider:model"/);
  });

  test("rejects a spec with an empty model name", () => {
    expect(() => parseModelSpecs("anthropic:")).toThrow(/missing a model name/);
  });
});

describe("avgLatencyMs", () => {
  test("averages consecutive deltas", () => {
    expect(avgLatencyMs([1000, 1500, 2500])).toBe(750);
  });

  test("ignores null entries (fallback/error lines with no timestamp)", () => {
    expect(avgLatencyMs([1000, null, 2000])).toBe(1000);
  });

  test("returns null with fewer than two timestamps", () => {
    expect(avgLatencyMs([1000])).toBeNull();
    expect(avgLatencyMs([])).toBeNull();
  });
});

describe("renderBenchReport", () => {
  function reportFixture(): BenchReport {
    return {
      game: "2048",
      seed: 7,
      maxActions: 60,
      models: [
        {
          label: "openai-compatible:llama3.2",
          outcome: "pass",
          actions: 60,
          distinctStates: 51,
          coverageRate: 0.85,
          calls: 60,
          randomFallbacks: 0,
          avgCallLatencyMs: 456,
        },
        {
          label: "openai-compatible:qwen2.5:7b-instruct",
          outcome: "pass",
          actions: 60,
          distinctStates: 57,
          coverageRate: 0.95,
          calls: 60,
          randomFallbacks: 0,
          avgCallLatencyMs: 812,
        },
        {
          label: "gemini:gemini-2.5-flash",
          outcome: "harness-error",
          actions: 0,
          distinctStates: 0,
          coverageRate: 0,
          calls: 0,
          randomFallbacks: 0,
          avgCallLatencyMs: null,
          error: "GEMINI_API_KEY is required",
        },
      ],
    };
  }

  test("carries the header, every model row, and a failed model's error", () => {
    const md = renderBenchReport(reportFixture());
    expect(md).toContain("# Model bench: 2048, seed 7, 60 actions");
    expect(md).toContain("| openai-compatible:llama3.2 | pass | 51 | 85% | 60 | 0 | 456ms |");
    expect(md).toContain("| openai-compatible:qwen2.5:7b-instruct | pass | 57 | 95% | 60 | 0 | 812ms |");
    expect(md).toContain("harness-error (GEMINI_API_KEY is required)");
    expect(md).toContain("n/a");
  });
});
