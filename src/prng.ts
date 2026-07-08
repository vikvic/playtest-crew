/**
 * Mulberry32 — the scoped seeded PRNG. One algorithm, two habitats:
 * - `mulberry32(seed)` for harness-side use (the random driver, tests)
 * - `prngInitScript(seed)` — a vanilla-JS string injected into the page
 *   BEFORE game scripts load, defining `window.__ptc_rng`. The fork's
 *   patched call sites use `(window.__ptc_rng || Math.random)()`.
 *
 * The two implementations must produce identical sequences; a unit test
 * pins them together (tests/prng.test.ts) so they can't drift.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function prngInitScript(seed: number): string {
  const s = seed >>> 0;
  return `(() => {
  let a = ${s} >>> 0;
  window.__ptc_rng = function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();`;
}
