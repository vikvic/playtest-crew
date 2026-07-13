import type { Page } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameHooks } from "./types.ts";

/**
 * Code hooks for the forked, seeded 2048 (games/2048). Declarative config
 * lives in specs/2048.yaml. Fork patches:
 *  - grid.js / game_manager.js call (window.__ptc_rng || Math.random)()
 *  - application.js exposes window.__ptc_state() reading the GameManager
 *    directly — synchronous truth, no race with the rAF-deferred DOM
 *    actuator. stateSource is therefore "adapter" (deviation from the
 *    design doc's "W1: DOM-derived", chosen because the fork makes the
 *    adapter free and the DOM read has a ~1-frame staleness window;
 *    determinism never slips).
 * State shape: { grid: number[4][4] (0 = empty), score, over, won } —
 * integers and booleans only, float-free by construction.
 */
export const g2048: GameHooks = {
  name: "2048",
  dir: join(dirname(fileURLToPath(import.meta.url)), "..", "..", "games", "2048"),
  async waitUntilReady(page: Page): Promise<void> {
    await page.waitForFunction(() => typeof (window as any).__ptc_state === "function", null, {
      timeout: 10_000,
    });
  },
  async readState(page: Page): Promise<unknown> {
    return page.evaluate(() => (window as any).__ptc_state());
  },
};
