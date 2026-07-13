import type { Page } from "playwright";
import type { Action, SeedStrategy, StateSource } from "../trace.ts";
import type { Budgets, DescribedAction, OracleSpec, CompiledTerminal } from "../spec.ts";

/**
 * Code hooks for a game — the imperative half of an integration. The
 * declarative half (identity, actions, budgets, oracles) lives in
 * specs/<game>.yaml; src/games/index.ts merges the two into a ResolvedGame.
 * Harness-owned (design doc "State adapter ownership"): third-party demo
 * targets get forked and patched; the hooks point the harness at the fork
 * and know how to read its state.
 */
export interface GameHooks {
  name: string;
  /** Directory served over localhost (the vendored fork). */
  dir: string;
  waitUntilReady(page: Page): Promise<void>;
  /** Synchronous-truth state read; hash-safe values only (no floats). */
  readState(page: Page): Promise<unknown>;
}

/** Spec + hooks, merged. What the runner/replayer/explorer consume. */
export interface GameConfig {
  name: string;
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
  /** Same alphabet with descriptions — the explorer's context. */
  describedActions: DescribedAction[];
  /** Explorer context: how to read the state JSON. Empty when unspecified. */
  stateNotes: string;
  budgets: Budgets;
  oracles: OracleSpec;
  terminalStates: CompiledTerminal[];
  waitUntilReady(page: Page): Promise<void>;
  readState(page: Page): Promise<unknown>;
}
