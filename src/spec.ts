/**
 * YAML game-spec parser (W2). The spec is the declarative half of a game
 * integration: identity, determinism contract, action alphabet (with the
 * descriptions the explorer consumes), budgets, and oracle config. The code
 * hooks (dir, waitUntilReady, readState) stay in src/games/<game>.ts; the
 * registry merges the two into a ResolvedGame.
 *
 * Predicates (invariants, terminal_states) are compiled once at load time —
 * a compile failure is a SpecError (harness/config bug, never a game bug).
 * Evaluation semantics live in src/oracles.ts.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { Action, SeedStrategy, StateSource } from "./trace.ts";

export class SpecError extends Error {}

export interface DescribedAction {
  action: Action;
  description: string;
}

/** A compiled state predicate. May throw at eval time — callers decide semantics. */
export type StatePredicate = (state: unknown) => boolean;

export interface CompiledInvariant {
  name: string;
  expr: string;
  test: StatePredicate;
}

export interface CompiledTerminal {
  expr: string;
  test: StatePredicate;
}

export interface Budgets {
  maxActions: number;
  screenshotEvery: number;
  maxVerifications: number;
}

export interface OracleSpec {
  consoleErrors: boolean;
  /** N consecutive dispatched actions with unchanged state hash → hang. 0 disables. */
  hangUnchangedActions: number;
  invariants: CompiledInvariant[];
}

export interface GameSpec {
  game: string;
  entry: string;
  /** Explorer context: how to read the state JSON (orientation, units, quirks). */
  stateNotes: string;
  viewport: { w: number; h: number };
  seedStrategy: SeedStrategy;
  stateSource: StateSource;
  adapterVersion: string;
  describedActions: DescribedAction[];
  budgets: Budgets;
  oracles: OracleSpec;
  terminalStates: CompiledTerminal[];
}

export const SPECS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "specs");

const DEFAULT_BUDGETS: Budgets = { maxActions: 200, screenshotEvery: 10, maxVerifications: 5 };
const DEFAULT_HANG_N = 10;

function fail(specName: string, msg: string): never {
  throw new SpecError(`spec ${specName}: ${msg}`);
}

/**
 * Compile a predicate expression into a function of `state`. Strict mode and
 * no other identifiers in scope; this is config-as-code trusted exactly as
 * much as the rest of the repo, not a sandbox against hostile specs.
 */
export function compilePredicate(specName: string, expr: string): StatePredicate {
  if (typeof expr !== "string" || expr.trim() === "") {
    fail(specName, `predicate must be a non-empty string, got ${JSON.stringify(expr)}`);
  }
  try {
    const fn = new Function("state", `"use strict"; return (${expr});`);
    return (state: unknown) => Boolean(fn(state));
  } catch (e) {
    fail(specName, `predicate does not compile: ${expr} (${e instanceof Error ? e.message : e})`);
  }
}

function requireString(specName: string, raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  if (typeof v !== "string" || v === "") fail(specName, `missing or invalid "${key}" (string required)`);
  return v;
}

function optionalInt(specName: string, v: unknown, key: string, fallback: number): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    fail(specName, `"${key}" must be a non-negative integer, got ${JSON.stringify(v)}`);
  }
  return v;
}

function parseAction(specName: string, raw: unknown, index: number): DescribedAction {
  if (typeof raw !== "object" || raw === null) fail(specName, `actions[${index}] must be a mapping`);
  const a = raw as Record<string, unknown>;
  const description = typeof a.description === "string" ? a.description : "";

  if (typeof a.key === "string" && a.key !== "") {
    return { action: { type: "key", key: a.key }, description };
  }
  if (typeof a.click === "object" && a.click !== null) {
    const c = a.click as Record<string, unknown>;
    if (!Number.isInteger(c.x) || !Number.isInteger(c.y)) {
      fail(specName, `actions[${index}].click needs integer x and y`);
    }
    return {
      action: { type: "pointer", kind: "click", x: c.x as number, y: c.y as number },
      description,
    };
  }
  fail(specName, `actions[${index}] needs either "key" or "click: {x, y}"`);
}

/** Parse + validate YAML source into a GameSpec. Exported for tests. */
export function parseSpec(specName: string, source: string): GameSpec {
  let doc: unknown;
  try {
    doc = parseYaml(source);
  } catch (e) {
    fail(specName, `YAML parse error: ${e instanceof Error ? e.message : e}`);
  }
  if (typeof doc !== "object" || doc === null) fail(specName, "spec must be a YAML mapping");
  const raw = doc as Record<string, unknown>;

  const game = requireString(specName, raw, "game");
  const entry = requireString(specName, raw, "entry");

  const vp = raw.viewport as Record<string, unknown> | undefined;
  if (!vp || !Number.isInteger(vp.w) || !Number.isInteger(vp.h)) {
    fail(specName, `missing or invalid "viewport" ({w, h} integers required)`);
  }

  const seedStrategy = requireString(specName, raw, "seed_strategy");
  if (seedStrategy !== "scoped-prng" && seedStrategy !== "none") {
    fail(specName, `"seed_strategy" must be "scoped-prng" or "none", got "${seedStrategy}"`);
  }
  const stateSource = requireString(specName, raw, "state_source");
  if (stateSource !== "dom" && stateSource !== "adapter") {
    fail(specName, `"state_source" must be "dom" or "adapter", got "${stateSource}"`);
  }
  const adapterVersion = requireString(specName, raw, "adapter_version");

  if (!Array.isArray(raw.actions) || raw.actions.length === 0) {
    fail(specName, `"actions" must be a non-empty list`);
  }
  const describedActions = raw.actions.map((a, i) => parseAction(specName, a, i));

  const budgetsRaw = (raw.budgets ?? {}) as Record<string, unknown>;
  const budgets: Budgets = {
    maxActions: optionalInt(specName, budgetsRaw.max_actions, "budgets.max_actions", DEFAULT_BUDGETS.maxActions),
    screenshotEvery: optionalInt(specName, budgetsRaw.screenshot_every, "budgets.screenshot_every", DEFAULT_BUDGETS.screenshotEvery),
    maxVerifications: optionalInt(specName, budgetsRaw.max_verifications, "budgets.max_verifications", DEFAULT_BUDGETS.maxVerifications),
  };

  const oraclesRaw = (raw.oracles ?? {}) as Record<string, unknown>;
  const hangRaw = (oraclesRaw.hang ?? {}) as Record<string, unknown>;
  const invariantsRaw = (oraclesRaw.invariants ?? []) as unknown[];
  if (!Array.isArray(invariantsRaw)) fail(specName, `"oracles.invariants" must be a list`);
  const invariants: CompiledInvariant[] = invariantsRaw.map((inv, i) => {
    if (typeof inv !== "object" || inv === null) fail(specName, `invariants[${i}] must be a mapping`);
    const m = inv as Record<string, unknown>;
    if (typeof m.name !== "string" || m.name === "") fail(specName, `invariants[${i}] needs a "name"`);
    if (typeof m.expr !== "string") fail(specName, `invariants[${i}] needs an "expr"`);
    return { name: m.name, expr: m.expr, test: compilePredicate(specName, m.expr) };
  });

  const terminalRaw = (raw.terminal_states ?? []) as unknown[];
  if (!Array.isArray(terminalRaw)) fail(specName, `"terminal_states" must be a list`);
  const terminalStates: CompiledTerminal[] = terminalRaw.map((expr) => {
    if (typeof expr !== "string") fail(specName, `terminal_states entries must be expression strings`);
    return { expr, test: compilePredicate(specName, expr) };
  });

  return {
    game,
    entry,
    stateNotes: typeof raw.state_notes === "string" ? raw.state_notes.trim() : "",
    viewport: { w: vp.w as number, h: vp.h as number },
    seedStrategy,
    stateSource,
    adapterVersion,
    describedActions,
    budgets,
    oracles: {
      consoleErrors: oraclesRaw.console_errors !== false, // default on
      hangUnchangedActions: optionalInt(specName, hangRaw.unchanged_actions, "oracles.hang.unchanged_actions", DEFAULT_HANG_N),
      invariants,
    },
    terminalStates,
  };
}

/** Load specs/<name>.yaml. */
export function loadSpec(name: string, specsDir: string = SPECS_DIR): GameSpec {
  const path = join(specsDir, `${name}.yaml`);
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    throw new SpecError(`no spec for game "${name}" (expected ${path})`);
  }
  const spec = parseSpec(name, source);
  if (spec.game !== name) {
    throw new SpecError(`spec ${path} declares game "${spec.game}" but file is named "${name}.yaml"`);
  }
  return spec;
}
