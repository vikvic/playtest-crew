import { describe, expect, test } from "bun:test";
import { computeWait, DEFAULT_MAX_WAIT_MS } from "../src/executor";

describe("computeWait (replay honors gaps, clamped)", () => {
  test("first action has no predecessor gap", () => {
    expect(computeWait(null, 1240)).toBe(0);
  });

  test("honors the recorded inter-action gap", () => {
    expect(computeWait(1240, 1900)).toBe(660);
  });

  test("clamps long gaps to the max wait (default 2000ms)", () => {
    expect(computeWait(1000, 60_000)).toBe(DEFAULT_MAX_WAIT_MS);
    expect(computeWait(1000, 10_000, 500)).toBe(500);
  });

  test("zero or negative gaps (clock weirdness) wait nothing", () => {
    expect(computeWait(2000, 2000)).toBe(0);
    expect(computeWait(2000, 1500)).toBe(0);
  });
});
