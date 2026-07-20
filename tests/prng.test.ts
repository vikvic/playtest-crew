import { describe, expect, test } from "bun:test";
import { mulberry32, prngInitScript, globalRandomPatchInitScript } from "../src/prng";

describe("mulberry32", () => {
  test("same seed → same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  test("different seeds → different sequences", () => {
    const a = mulberry32(42);
    const b = mulberry32(43);
    const same = Array.from({ length: 100 }, () => a() === b()).filter(Boolean).length;
    expect(same).toBeLessThan(5);
  });

  test("values in [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("injected page script produces the IDENTICAL sequence (DRY pin)", () => {
    // The init script and the TS function are two copies of one algorithm;
    // this test is the contract that stops them drifting apart.
    const script = prngInitScript(42);
    const fakeWindow: { __ptc_rng?: () => number } = {};
    new Function("window", script)(fakeWindow);
    const ts = mulberry32(42);
    for (let i = 0; i < 1000; i++) expect(fakeWindow.__ptc_rng!()).toBe(ts());
  });

  test("global-random-patch script overwrites Math.random with the IDENTICAL sequence", () => {
    const script = globalRandomPatchInitScript(42);
    const fakeMath = { random: Math.random, imul: Math.imul };
    new Function("Math", script)(fakeMath);
    const ts = mulberry32(42);
    for (let i = 0; i < 1000; i++) expect(fakeMath.random()).toBe(ts());
  });
});
