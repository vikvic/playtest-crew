import type { GameConfig } from "./types.ts";
import { g2048 } from "./g2048.ts";

export const games: Record<string, GameConfig> = {
  "2048": g2048,
};

export function getGame(name: string): GameConfig {
  const game = games[name];
  if (!game) {
    throw new Error(`Unknown game "${name}". Known games: ${Object.keys(games).join(", ")}`);
  }
  return game;
}
