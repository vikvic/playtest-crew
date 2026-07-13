import { describe, expect, test } from "bun:test";
import { judge, type ReplayObservation } from "../src/verdict.ts";

const clean = (refiredAtIndex: number | null): ReplayObservation => ({
  refiredAtIndex,
  firstHashMismatchIndex: null,
});

describe("judge — verdict boundaries (design doc Run Outcomes)", () => {
  test("refire at exactly the original index, 3/3 → finding", () => {
    const v = judge(31, [clean(31), clean(31), clean(31)]);
    expect(v).toEqual({ verdict: "finding", reproductions: 3, nondeterministic: false });
  });

  test("refire at +3 (tolerance boundary) → finding", () => {
    const v = judge(31, [clean(34), clean(34), clean(34)]);
    expect(v.verdict).toBe("finding");
  });

  test("refire at -3 → finding (tolerance is symmetric)", () => {
    const v = judge(31, [clean(28), clean(28), clean(28)]);
    expect(v.verdict).toBe("finding");
  });

  test("refire at +4 → flake, never loosened to rescue a demo", () => {
    const v = judge(31, [clean(35), clean(35), clean(35)]);
    expect(v).toMatchObject({ verdict: "flake", reproductions: 0 });
  });

  test("one replay at +4 among two in tolerance → flake (2/3)", () => {
    const v = judge(31, [clean(31), clean(30), clean(35)]);
    expect(v).toMatchObject({ verdict: "flake", reproductions: 2 });
  });

  test("2/3 reproduction (one never refires) → flake", () => {
    const v = judge(31, [clean(31), clean(31), clean(null)]);
    expect(v).toMatchObject({ verdict: "flake", reproductions: 2 });
  });

  test("0/3 → flake", () => {
    const v = judge(31, [clean(null), clean(null), clean(null)]);
    expect(v).toMatchObject({ verdict: "flake", reproductions: 0 });
  });

  test("fewer than 3 replays can never be a finding", () => {
    expect(judge(31, [clean(31), clean(31)]).verdict).toBe("flake");
    expect(judge(31, [clean(31)]).verdict).toBe("flake");
    expect(judge(31, []).verdict).toBe("flake");
  });

  test("pre-fire hash mismatch does NOT change the verdict, marks nondeterministic", () => {
    const v = judge(31, [
      { refiredAtIndex: 31, firstHashMismatchIndex: 10 },
      clean(31),
      clean(31),
    ]);
    expect(v).toEqual({ verdict: "finding", reproductions: 3, nondeterministic: true });
  });

  test("hash mismatch after the refire point does not mark nondeterministic", () => {
    const v = judge(31, [
      { refiredAtIndex: 30, firstHashMismatchIndex: 31 }, // post-fire
      clean(31),
      clean(31),
    ]);
    expect(v.nondeterministic).toBe(false);
  });

  test("mismatch with no refire counts against the original fire index", () => {
    const v = judge(31, [
      { refiredAtIndex: null, firstHashMismatchIndex: 5 }, // pre-fire, no refire
      clean(31),
      clean(31),
    ]);
    expect(v).toMatchObject({ verdict: "flake", reproductions: 2, nondeterministic: true });
  });

  test("custom tolerance is honored", () => {
    expect(judge(31, [clean(36), clean(36), clean(36)], 5).verdict).toBe("finding");
    expect(judge(31, [clean(36), clean(36), clean(36)], 4).verdict).toBe("flake");
  });
});
