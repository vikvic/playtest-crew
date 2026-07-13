/**
 * LLM Explorer driver (W2). Observe → propose → execute: the model sees the
 * serialized adapter state (text only — screenshots never enter the action
 * loop, per the design doc's observation-channel decision), the described
 * action alphabet, and recent history, and returns the next action.
 *
 * The choice is constrained to the alphabet by a JSON-schema enum — the
 * provider enforces it server-side. If a response still fails to parse or
 * names an unknown action, the step falls back to a seeded random pick and
 * the fallback is counted in the run summary (a high fallback rate means
 * the explorer isn't earning its API cost). An API failure that survives
 * the client's retries propagates → harness-error, per Run Outcomes.
 */

import type { GameConfig } from "./games/types.ts";
import type { Action, TraceLine } from "./trace.ts";
import type { Driver } from "./runner.ts";
import type { LLMClient } from "./llm.ts";
import type { DescribedAction } from "./spec.ts";
import { mulberry32 } from "./prng.ts";
import { hashState } from "./hash.ts";

export interface ExplorerStats {
  client: string;
  calls: number;
  /** Steps where the LLM response was unusable and a random pick was made. */
  randomFallbacks: number;
}

/** One per LLM call — written to the run's llm.jsonl by the runner. */
export interface ExplorerDecision {
  actionIndex: number;
  /** The state JSON the model saw. */
  state: unknown;
  /** Chosen action label (post-fallback if the response was unusable). */
  action: string;
  /** The model's stated reasoning; absent on fallback. */
  why?: string;
  fallback: boolean;
  /** Raw response text, kept only when it failed to parse. */
  raw?: string;
  usage?: import("./llm.ts").CompletionUsage;
}

export function actionLabel(action: Action): string {
  return action.type === "key" ? action.key : `${action.kind}@${action.x},${action.y}`;
}

function systemPrompt(game: GameConfig): string {
  const actions = game.describedActions
    .map((a: DescribedAction) => `- ${actionLabel(a.action)}: ${a.description || "(no description)"}`)
    .join("\n");
  const stateNotes = game.stateNotes ? `\nHow to read the state JSON:\n${game.stateNotes}\n` : "";
  return `You are an expert game playtester exploring the game "${game.name}" to surface bugs.

Each turn you receive the game's current state as JSON plus your recent actions, and you choose exactly one next action.
${stateNotes}
Available actions:
${actions}

Your goals, in priority order:
1. Reach game states that have not been seen before — deep, unusual, or extreme states are where bugs live.
2. Avoid actions that would change nothing in the current state (wasted budget).
3. Play competently enough to keep the game going; a terminated game explores nothing.

Respond with JSON: {"action": <one of the action names above>, "why": <one short sentence>}.`;
}

function userPrompt(state: unknown, history: TraceLine[]): string {
  // Effect feedback: action i changed nothing iff the state hash before
  // action i+1 equals the one before action i (for the newest action,
  // compare against the current state). Without this the model cannot see
  // that a move was a no-op and will wedge on it.
  const currentHash = hashState(state);
  const recent = history.slice(-12).map((line, idx, window) => {
    const nextHash =
      idx + 1 < window.length ? window[idx + 1]!.preStateHash : currentHash;
    const noop = nextHash === line.preStateHash ? " (changed nothing!)" : "";
    return `${actionLabel(line.action)}${noop}`;
  });
  return `Current state:
${JSON.stringify(state)}

Your last ${recent.length} actions (oldest first): ${recent.join(", ") || "(none yet)"}

Choose the next action.`;
}

export function explorerDriver(
  llm: LLMClient,
  seed: number,
  onDecision?: (decision: ExplorerDecision) => void,
): { driver: Driver; stats: ExplorerStats } {
  const stats: ExplorerStats = { client: llm.name, calls: 0, randomFallbacks: 0 };
  // Fallback picks are seeded (distinct stream from game and random driver)
  // so even a fallback-heavy run stays re-creatable from (game, seed).
  const rng = mulberry32(seed ^ 0x51ed270b);

  const driver: Driver = async ({ game, state, actionIndex, history }) => {
    const labels = game.actions.map(actionLabel);
    const schema = {
      type: "object",
      properties: {
        action: { type: "string", enum: labels },
        why: { type: "string" },
      },
      required: ["action", "why"],
      additionalProperties: false,
    };

    stats.calls += 1;
    const { text, usage } = await llm.complete({
      system: systemPrompt(game),
      user: userPrompt(state, history),
      schema,
      maxTokens: 300,
    });

    const context = { actionIndex, state, usage };
    try {
      const parsed = JSON.parse(text) as { action?: unknown; why?: unknown };
      const index = labels.indexOf(String(parsed.action));
      if (index >= 0) {
        const action = game.actions[index]!;
        onDecision?.({
          ...context,
          action: labels[index]!,
          why: typeof parsed.why === "string" ? parsed.why : undefined,
          fallback: false,
        });
        return action;
      }
    } catch {
      // fall through to random fallback
    }
    stats.randomFallbacks += 1;
    const fallbackAction = game.actions[Math.floor(rng() * game.actions.length)]!;
    onDecision?.({ ...context, action: actionLabel(fallbackAction), fallback: true, raw: text });
    return fallbackAction;
  };

  return { driver, stats };
}
