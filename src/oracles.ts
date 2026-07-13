/**
 * Oracles (W2). The engine is pure and session-scoped: the runner feeds it
 * each step's pre-action state + hash, it returns any fires. Console errors
 * are event-driven (Playwright page events) and stay in the runner; this
 * module owns the state-derived oracles:
 *
 * - invariant: a spec predicate evaluated false → fire. A predicate that
 *   THROWS also fires (tier "invariant-error") — a state shape the spec
 *   author didn't anticipate is itself a candidate finding, per the design
 *   doc's true/false/throws semantics. Each invariant fires at most once
 *   per run (the broken state usually persists; refiring every action is
 *   noise, and dedupe-by-signature would collapse them anyway).
 *
 * - hang: hashed state unchanged for N consecutive dispatched actions →
 *   fire (a frozen game is the most common smoke failure). Suppressed while
 *   any terminal_states predicate holds — a game-over screen that ignores
 *   input is not a hang; without the guard it would reproduce 3/3 and ship
 *   as a confidently-verified non-bug (reproducible ≠ true). A throwing
 *   terminal predicate is a spec/config bug and propagates as SpecError
 *   (harness-error, never a game bug).
 */

import type { CompiledInvariant, CompiledTerminal, OracleSpec } from "./spec.ts";
import { SpecError } from "./spec.ts";

export type OracleTier = "console-error" | "invariant" | "invariant-error" | "hang";

export interface OracleFire {
  oracle: OracleTier;
  atActionIndex: number;
  /** Dedupe key within the tier — (oracle, signature) identifies a candidate. */
  signature: string;
  detail: string;
}

export class OracleEngine {
  private readonly invariants: CompiledInvariant[];
  private readonly hangN: number;
  private readonly terminals: CompiledTerminal[];
  private readonly firedInvariants = new Set<string>();
  private lastHash: string | null = null;
  private unchangedStreak = 0;
  private hangFired = false;

  constructor(spec: { oracles: OracleSpec; terminalStates: CompiledTerminal[] }) {
    this.invariants = spec.oracles.invariants;
    this.hangN = spec.oracles.hangUnchangedActions;
    this.terminals = spec.terminalStates;
  }

  /** True while any terminal_states predicate holds for this state. */
  isTerminal(state: unknown): boolean {
    for (const t of this.terminals) {
      try {
        if (t.test(state)) return true;
      } catch (e) {
        throw new SpecError(
          `terminal_states predicate threw: ${t.expr} (${e instanceof Error ? e.message : e})`,
        );
      }
    }
    return false;
  }

  /**
   * Observe one step's pre-action state. Call once per dispatched action,
   * in action order. Returns zero or more fires.
   */
  observe(actionIndex: number, state: unknown, stateHash: string): OracleFire[] {
    const fires: OracleFire[] = [];

    for (const inv of this.invariants) {
      if (this.firedInvariants.has(inv.name)) continue;
      let holds: boolean;
      try {
        holds = inv.test(state);
      } catch (e) {
        this.firedInvariants.add(inv.name);
        fires.push({
          oracle: "invariant-error",
          atActionIndex: actionIndex,
          signature: inv.name,
          detail: `invariant "${inv.name}" threw: ${e instanceof Error ? e.message : e} (expr: ${inv.expr})`,
        });
        continue;
      }
      if (!holds) {
        this.firedInvariants.add(inv.name);
        fires.push({
          oracle: "invariant",
          atActionIndex: actionIndex,
          signature: inv.name,
          detail: `invariant "${inv.name}" violated (expr: ${inv.expr})`,
        });
      }
    }

    if (this.hangN > 0 && !this.hangFired) {
      if (this.isTerminal(state)) {
        // Terminal screens legitimately ignore input; not a hang.
        this.unchangedStreak = 0;
      } else if (this.lastHash !== null && stateHash === this.lastHash) {
        this.unchangedStreak += 1;
        if (this.unchangedStreak >= this.hangN) {
          this.hangFired = true;
          fires.push({
            oracle: "hang",
            atActionIndex: actionIndex,
            signature: "hang",
            detail: `state hash unchanged for ${this.unchangedStreak} consecutive dispatched actions (threshold ${this.hangN})`,
          });
        }
      } else {
        this.unchangedStreak = 0;
      }
    }
    this.lastHash = stateHash;

    return fires;
  }
}
