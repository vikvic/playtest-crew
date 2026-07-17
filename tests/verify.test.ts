import { describe, expect, test } from "bun:test";
import { toObservation } from "../src/verify.ts";
import type { OracleFire } from "../src/oracles.ts";

const fire = (oracle: OracleFire["oracle"], signature: string, at: number): OracleFire => ({
  oracle,
  signature,
  atActionIndex: at,
  detail: "d",
});

describe("toObservation", () => {
  test("matching (oracle, signature) fire becomes the refire index", () => {
    const fires = [fire("invariant", "other", 3), fire("invariant", "score-sane", 7)];
    expect(toObservation(fires, null, { oracle: "invariant", signature: "score-sane" })).toEqual({
      refiredAtIndex: 7,
      firstHashMismatchIndex: null,
    });
  });

  test("same signature under a different oracle tier does NOT count", () => {
    const fires = [fire("invariant-error", "score-sane", 7)];
    expect(
      toObservation(fires, null, { oracle: "invariant", signature: "score-sane" }).refiredAtIndex,
    ).toBeNull();
  });

  test("no matching fire → refiredAtIndex null", () => {
    expect(toObservation([], null, { oracle: "hang", signature: "hang" }).refiredAtIndex).toBeNull();
  });

  test("first matching fire wins when the oracle fires more than once", () => {
    const fires = [fire("console-error", "boom", 4), fire("console-error", "boom", 9)];
    expect(
      toObservation(fires, null, { oracle: "console-error", signature: "boom" }).refiredAtIndex,
    ).toBe(4);
  });

  test("hash mismatch index passes through untouched", () => {
    expect(toObservation([], 2, { oracle: "hang", signature: "hang" }).firstHashMismatchIndex).toBe(2);
  });
});
