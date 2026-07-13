import { describe, expect, test } from "bun:test";
import { parseSpec, loadSpec, compilePredicate, SpecError } from "../src/spec.ts";

const MINIMAL = `
game: "mini"
entry: index.html
viewport: { w: 800, h: 600 }
seed_strategy: none
state_source: adapter
adapter_version: mini@1
actions:
  - key: Space
    description: Jump.
`;

describe("parseSpec", () => {
  test("minimal spec parses with defaults applied", () => {
    const spec = parseSpec("mini", MINIMAL);
    expect(spec.game).toBe("mini");
    expect(spec.budgets).toEqual({ maxActions: 200, screenshotEvery: 10, maxVerifications: 5 });
    expect(spec.oracles.consoleErrors).toBe(true);
    expect(spec.oracles.hangUnchangedActions).toBe(10);
    expect(spec.oracles.invariants).toEqual([]);
    expect(spec.terminalStates).toEqual([]);
    expect(spec.describedActions).toEqual([
      { action: { type: "key", key: "Space" }, description: "Jump." },
    ]);
  });

  test("full 2048 spec loads from specs/", () => {
    const spec = loadSpec("2048");
    expect(spec.game).toBe("2048");
    expect(spec.seedStrategy).toBe("scoped-prng");
    expect(spec.adapterVersion).toBe("2048-fork@1");
    expect(spec.describedActions).toHaveLength(4);
    for (const a of spec.describedActions) expect(a.description.length).toBeGreaterThan(0);
    expect(spec.oracles.invariants.length).toBeGreaterThanOrEqual(3);
    expect(spec.terminalStates.length).toBeGreaterThanOrEqual(2);
  });

  test("2048 invariants hold on a sane state and fail on a broken one", () => {
    const spec = loadSpec("2048");
    const sane = {
      grid: [
        [2, 0, 0, 0],
        [0, 4, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 2048],
      ],
      score: 12,
      over: false,
      won: false,
    };
    for (const inv of spec.oracles.invariants) expect(inv.test(sane)).toBe(true);

    const broken = { ...sane, score: -1 };
    const scoreInv = spec.oracles.invariants.find((i) => i.name === "score-non-negative")!;
    expect(scoreInv.test(broken)).toBe(false);

    const badTile = { ...sane, grid: sane.grid.map((c) => [...c]) };
    badTile.grid[1]![1] = 3; // not a power of two
    const powInv = spec.oracles.invariants.find((i) => i.name === "tiles-are-powers-of-two")!;
    expect(powInv.test(badTile)).toBe(false);
  });

  test("2048 terminal predicates track over/won", () => {
    const spec = loadSpec("2048");
    const alive = { grid: [], score: 0, over: false, won: false };
    const dead = { ...alive, over: true };
    expect(spec.terminalStates.some((t) => t.test(alive))).toBe(false);
    expect(spec.terminalStates.some((t) => t.test(dead))).toBe(true);
  });

  test("pointer actions parse", () => {
    const spec = parseSpec(
      "mini",
      MINIMAL + `  - click: { x: 100, y: 200 }\n    description: Press start.\n`,
    );
    expect(spec.describedActions[1]!.action).toEqual({
      type: "pointer",
      kind: "click",
      x: 100,
      y: 200,
    });
  });

  test.each([
    ["missing game", MINIMAL.replace(`game: "mini"`, "")],
    ["empty actions", MINIMAL.replace(/actions:[\s\S]*$/, "actions: []\n")],
    ["bad seed_strategy", MINIMAL.replace("seed_strategy: none", "seed_strategy: hope")],
    ["bad state_source", MINIMAL.replace("state_source: adapter", "state_source: vibes")],
    ["action without key or click", MINIMAL.replace("key: Space", "frob: Space")],
    ["negative budget", MINIMAL + "budgets: { max_actions: -5 }\n"],
    ["non-string terminal", MINIMAL + "terminal_states: [42]\n"],
    ["invariant without name", MINIMAL + `oracles:\n  invariants:\n    - expr: "true"\n`],
  ])("rejects %s", (_label, source) => {
    expect(() => parseSpec("mini", source)).toThrow(SpecError);
  });

  test("unknown game name is a SpecError with the expected path", () => {
    expect(() => loadSpec("no-such-game")).toThrow(SpecError);
    expect(() => loadSpec("no-such-game")).toThrow(/no-such-game\.yaml/);
  });
});

describe("compilePredicate", () => {
  test("compiles and evaluates against state", () => {
    const p = compilePredicate("t", "state.score >= 0");
    expect(p({ score: 1 })).toBe(true);
    expect(p({ score: -1 })).toBe(false);
  });

  test("coerces truthy results to boolean", () => {
    const p = compilePredicate("t", "state.score");
    expect(p({ score: 5 })).toBe(true);
    expect(p({ score: 0 })).toBe(false);
  });

  test("syntax error is a SpecError at compile time", () => {
    expect(() => compilePredicate("t", "state.score >=")).toThrow(SpecError);
  });

  test("runtime errors propagate to the caller (oracle decides semantics)", () => {
    const p = compilePredicate("t", "state.grid.every(r => r.length === 4)");
    expect(() => p({ grid: null })).toThrow();
  });
});
