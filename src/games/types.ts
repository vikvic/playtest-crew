import type { Page } from "playwright";
import type { Action, SeedStrategy, StateSource } from "../trace.ts";

/**
 * Per-game config. Harness-owned (design doc "State adapter ownership"):
 * third-party demo targets get forked and patched; the config points the
 * harness at the fork and knows how to read its state.
 */
export interface GameConfig {
  name: string;
  /** Directory served over localhost (the vendored fork). */
  dir: string;
  /** Entry file relative to dir. */
  entry: string;
  viewport: { w: number; h: number };
  seedStrategy: SeedStrategy;
  stateSource: StateSource;
  /** Bumped on any adapter/fork change; replayer refuses mismatched traces. */
  adapterVersion: string;
  /** The action alphabet the random driver samples from. */
  actions: Action[];
  waitUntilReady(page: Page): Promise<void>;
  /** Synchronous-truth state read; hash-safe values only (no floats). */
  readState(page: Page): Promise<unknown>;
}
