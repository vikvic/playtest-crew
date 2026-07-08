import { describe, expect, test } from "bun:test";
import { canonicalJson, hashState, FloatInHashError } from "../src/hash";

describe("canonicalJson", () => {
  test("sorts keys recursively — key order never changes the hash", () => {
    const a = { score: 4, grid: [[2, 0]], meta: { won: false, over: true } };
    const b = { meta: { over: true, won: false }, grid: [[2, 0]], score: 4 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(hashState(a)).toBe(hashState(b));
  });

  test("produces compact deterministic output", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson([1, "x", true, null])).toBe('[1,"x",true,null]');
  });

  test("rejects floats anywhere in the state, with a path", () => {
    expect(() => canonicalJson({ score: 1.5 })).toThrow(FloatInHashError);
    expect(() => canonicalJson({ a: { b: [0, 3.14] } })).toThrow('"$.a.b[1]"');
  });

  test("accepts integers, strings, booleans, null", () => {
    expect(() => canonicalJson({ i: -3, s: "x", b: false, n: null })).not.toThrow();
  });

  test("hash is stable across calls (pinned vector)", () => {
    const h = hashState({ grid: [[0, 2], [4, 0]], score: 4, over: false, won: false });
    expect(h).toBe(hashState({ won: false, over: false, score: 4, grid: [[0, 2], [4, 0]] }));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
