import type { GameConfig, GameHooks } from "./types.ts";
import { g2048 } from "./g2048.ts";
import { loadSpec } from "../spec.ts";

const hooksRegistry: Record<string, GameHooks> = {
  "2048": g2048,
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
