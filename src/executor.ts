/**
 * The shared executor — record and replay both dispatch inputs through
 * THIS module and nothing else (design doc "Shared executor"). Any
 * difference in how the two paths press keys shows up as replay
 * divergence billed to the game as a flake; one code path removes the
 * failure class by construction.
 *
 *  RECORD: driver proposes action ─┐
 *  REPLAY: trace reader reads line ─┴→ step(): wait(gap, clamped) →
 *          hash preState → dispatch key/pointer
 */

import type { Page } from "playwright";
import type { Action } from "./trace.ts";
import { hashState } from "./hash.ts";

export const DEFAULT_MAX_WAIT_MS = 2000;

/**
 * Inter-action wait: replay honors the recorded gap (tMs[i] - tMs[i-1]),
 * clamped to a max because game-side animations are time-dependent but
 * nobody needs to wait out a coffee break in a trace.
 */
export function computeWait(
  prevTMs: number | null,
  curTMs: number,
  maxWaitMs: number = DEFAULT_MAX_WAIT_MS,
): number {
  if (prevTMs === null) return 0; // first action: no predecessor gap
  const gap = curTMs - prevTMs;
  if (gap <= 0) return 0;
  return Math.min(gap, maxWaitMs);
}

export interface StepResult {
  preState: unknown;
  preStateHash: string;
}

export interface GameSession {
  page: Page;
  /** Synchronous-truth state read (adapter or DOM-derived, per game config). */
  readState(): Promise<unknown>;
}

async function dispatch(page: Page, action: Action): Promise<void> {
  switch (action.type) {
    case "key":
      await page.keyboard.press(action.key);
      return;
    case "pointer":
      if (action.kind === "click") await page.mouse.click(action.x, action.y);
      else await page.mouse.move(action.x, action.y);
      return;
  }
}

/**
 * Execute one step: wait the inter-action gap, hash the pre-action state,
 * dispatch the input. Both the runner and the replayer call this and only
 * this.
 */
export async function step(
  session: GameSession,
  action: Action,
  waitMs: number,
): Promise<StepResult> {
  if (waitMs > 0) await session.page.waitForTimeout(waitMs);
  const preState = await session.readState();
  const preStateHash = hashState(preState);
  await dispatch(session.page, action);
  return { preState, preStateHash };
}
