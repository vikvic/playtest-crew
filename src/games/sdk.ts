import type { Page } from "playwright";
import type { GameHooks } from "./types.ts";

/**
 * Generic code hooks for any game integrated via the sdk/ptc-sdk.js
 * convention (`window.PTC.exposeState(fn)`) instead of a bespoke adapter.
 * This is the entire integration cost on the TypeScript side — waiting for
 * readiness and reading state are identical for every such game, because
 * the SDK script defines the same `window.__ptc_state` contract 2048's
 * hand-written hooks (src/games/g2048.ts) happen to also use. Combined
 * with `seed_strategy: global-random-patch` in the YAML spec (no game
 * source patched — see src/prng.ts), a new game needs zero bespoke
 * TypeScript: just `sdkGameHooks({ name, dir })` and a spec file.
 */
export function sdkGameHooks(opts: { name: string; dir: string }): GameHooks {
  return {
    name: opts.name,
    dir: opts.dir,
    async waitUntilReady(page: Page): Promise<void> {
      await page.waitForFunction(() => typeof (window as any).__ptc_state === "function", null, {
        timeout: 10_000,
      });
    },
    async readState(page: Page): Promise<unknown> {
      return page.evaluate(() => (window as any).__ptc_state());
    },
  };
}
