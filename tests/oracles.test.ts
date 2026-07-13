import { describe, expect, test } from "bun:test";
import { OracleEngine } from "../src/oracles.ts";
import { compilePredicate, SpecError, type OracleSpec, type CompiledTerminal } from "../src/spec.ts";

function engine(opts: {
  invariants?: { name: string; expr: string }[];
  hangN?: number;
  terminals?: string[];
}): OracleEngine {
  const oracles: OracleSpec = {
    consoleErrors: true,
    hangUnchangedActions: opts.hangN ?? 0,
    invariants: (opts.invariants ?? []).map((i) => ({
      ...i,
      test: compilePredicate("test", i.expr),
    })),
  };
  const terminalStates: CompiledTerminal[] = (opts.terminals ?? []).map((expr) => ({
    expr,
    test: compilePredicate("test", expr),
  }));
  return new OracleEngine({ oracles, terminalStates });
}

describe("invariant oracle", () => {
  const scoreInv = { name: "score-non-negative", expr: "state.score >= 0" };

  test("holds → no fire", () => {
    const e = engine({ invariants: [scoreInv] });
    expect(e.observe(0, { score: 0 }, "h0")).toEqual([]);
    expect(e.observe(1, { score: 5 }, "h1")).toEqual([]);
  });

  test("false → fires once with tier invariant, then never refires", () => {
    const e = engine({ invariants: [scoreInv] });
    const fires = e.observe(3, { score: -1 }, "h3");
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({
      oracle: "invariant",
      atActionIndex: 3,
      signature: "score-non-negative",
    });
    // broken state persists — no refire spam
    expect(e.observe(4, { score: -1 }, "h4")).toEqual([]);
  });

  test("throw → fires as invariant-error (unanticipated state shape is a candidate)", () => {
    const e = engine({
      invariants: [{ name: "grid-shape", expr: "state.grid.length === 4" }],
    });
    const fires = e.observe(0, { grid: null }, "h0");
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ oracle: "invariant-error", signature: "grid-shape" });
    expect(fires[0]!.detail).toContain("grid-shape");
  });

  test("independent invariants fire independently at the same step", () => {
    const e = engine({
      invariants: [scoreInv, { name: "alive", expr: "state.lives > 0" }],
    });
    const fires = e.observe(0, { score: -5, lives: 0 }, "h0");
    expect(fires.map((f) => f.signature).sort()).toEqual(["alive", "score-non-negative"]);
  });
});

describe("hang oracle", () => {
  test("N-1 unchanged observations do not fire, Nth fires", () => {
    const e = engine({ hangN: 3 });
    expect(e.observe(0, {}, "same")).toEqual([]); // baseline
    expect(e.observe(1, {}, "same")).toEqual([]); // streak 1
    expect(e.observe(2, {}, "same")).toEqual([]); // streak 2
    const fires = e.observe(3, {}, "same"); // streak 3 = N
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ oracle: "hang", atActionIndex: 3, signature: "hang" });
  });

  test("a changing hash resets the streak", () => {
    const e = engine({ hangN: 3 });
    e.observe(0, {}, "a");
    e.observe(1, {}, "a");
    e.observe(2, {}, "a");
    expect(e.observe(3, {}, "b")).toEqual([]); // reset
    e.observe(4, {}, "b");
    e.observe(5, {}, "b");
    expect(e.observe(6, {}, "b")).toHaveLength(1); // fresh streak reaches N
  });

  test("fires at most once per run", () => {
    const e = engine({ hangN: 2 });
    e.observe(0, {}, "x");
    e.observe(1, {}, "x");
    expect(e.observe(2, {}, "x")).toHaveLength(1);
    expect(e.observe(3, {}, "x")).toEqual([]);
  });

  test("suppressed while a terminal predicate holds (game over is not a hang)", () => {
    const e = engine({ hangN: 2, terminals: ["state.over === true"] });
    const dead = { over: true };
    e.observe(0, dead, "same");
    e.observe(1, dead, "same");
    e.observe(2, dead, "same");
    expect(e.observe(3, dead, "same")).toEqual([]); // would have fired long ago
  });

  test("terminal ending resets the streak (no carryover into terminal screens)", () => {
    const e = engine({ hangN: 2, terminals: ["state.over === true"] });
    e.observe(0, { over: false }, "same");
    e.observe(1, { over: false }, "same"); // streak 1
    e.observe(2, { over: true }, "same"); // terminal: suppressed + reset
    expect(e.observe(3, { over: false }, "same")).toEqual([]); // streak restarts at 1
  });

  test("hangN 0 disables the oracle", () => {
    const e = engine({ hangN: 0 });
    for (let i = 0; i < 50; i++) expect(e.observe(i, {}, "same")).toEqual([]);
  });

  test("throwing terminal predicate is a SpecError (config bug, not a finding)", () => {
    const e = engine({ hangN: 2, terminals: ["state.flags.done"] });
    expect(() => e.observe(0, {}, "h")).toThrow(SpecError);
  });
});

describe("isTerminal", () => {
  test("any-of semantics across predicates", () => {
    const e = engine({ terminals: ["state.over === true", "state.won === true"] });
    expect(e.isTerminal({ over: false, won: false })).toBe(false);
    expect(e.isTerminal({ over: true, won: false })).toBe(true);
    expect(e.isTerminal({ over: false, won: true })).toBe(true);
  });
});
