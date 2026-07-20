/**
 * Mulberry32 — the scoped seeded PRNG. One algorithm, three habitats:
 * - `mulberry32(seed)` for harness-side use (the random driver, tests)
 * - `prngInitScript(seed)` — injected before game scripts load, defining
 *   `window.__ptc_rng`. Requires the fork to patch every call site to
 *   `(window.__ptc_rng || Math.random)()` — the original per-game
 *   integration model (docs/PORTING.md).
 * - `globalRandomPatchInitScript(seed)` — injected the same way, but
 *   overwrites the global `Math.random` directly. Zero call-site changes
 *   needed in the game: any unmodified `Math.random()` call becomes seeded
 *   for free. This is what `seedStrategy: "global-random-patch"` selects
 *   (see src/games/sdk.ts) — the low-integration-cost path for a game that
 *   only needs to expose state, not patch its own source.
 *
 * All three must produce identical sequences; a unit test pins them
 * together (tests/prng.test.ts) so they can't drift.
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

/**
 * Same generator, but replaces `Math.random` itself instead of defining a
 * separate `window.__ptc_rng` — the game's own source is never touched.
 * Only covers `Math.random`; a game drawing entropy from elsewhere
 * (`crypto.getRandomValues`, `Date.now`-seeded logic) needs the per-site
 * `prngInitScript` model instead.
 */
export function globalRandomPatchInitScript(seed: number): string {
  const s = seed >>> 0;
  return `(() => {
  let a = ${s} >>> 0;
  Math.random = function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();`;
}
