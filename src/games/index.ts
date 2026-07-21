import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameConfig, GameHooks } from "./types.ts";
import { g2048 } from "./g2048.ts";
import { sdkGameHooks } from "./sdk.ts";
import { loadSpec } from "../spec.ts";

const GAMES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "games");

const hooksRegistry: Record<string, GameHooks> = {
  "2048": g2048,
  // Zero bespoke TypeScript — proves the sdk.ts adoption path (see
  // sdk/ptc-sdk.js, specs/dice-demo.yaml, games/dice-demo/index.html).
  "dice-demo": sdkGameHooks({ name: "dice-demo", dir: join(GAMES_ROOT, "dice-demo") }),
  // Real third-party game (github.com/davidjbrossard/minesweeper),
  // integrated the way an outside developer following sdk/README.md
  // would — see specs/minesweeper.yaml for what that took.
  "minesweeper": sdkGameHooks({ name: "minesweeper", dir: join(GAMES_ROOT, "minesweeper") }),
};

/**
 * Merge specs/<name>.yaml (declarative) with the game's code hooks into the
 * config the runner/replayer/explorer consume. Spec load failures are
 * SpecErrors — config bugs, never game bugs.
 */
export function getGame(name: string): GameConfig {
  const hooks = hooksRegistry[name];
  if (!hooks) {
    throw new Error(
      `Unknown game "${name}". Known games: ${Object.keys(hooksRegistry).join(", ")}`,
    );
  }
  const spec = loadSpec(name);
  return {
    name: spec.game,
    dir: hooks.dir,
    entry: spec.entry,
    viewport: spec.viewport,
    seedStrategy: spec.seedStrategy,
    stateSource: spec.stateSource,
    adapterVersion: spec.adapterVersion,
    actions: spec.describedActions.map((a) => a.action),
    describedActions: spec.describedActions,
    stateNotes: spec.stateNotes,
    budgets: spec.budgets,
    oracles: spec.oracles,
    terminalStates: spec.terminalStates,
    waitUntilReady: hooks.waitUntilReady,
    readState: hooks.readState,
  };
}

export const knownGames = (): string[] => Object.keys(hooksRegistry);
