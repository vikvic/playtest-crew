import { describe, expect, test } from "bun:test";
import { explorerDriver, actionLabel } from "../src/explorer.ts";
import type { LLMClient, CompletionRequest } from "../src/llm.ts";
import { getGame } from "../src/games/index.ts";

const game = getGame("2048");

function fakeLLM(responses: string[]): LLMClient & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    name: "fake:test",
    requests,
    async complete(req) {
      requests.push(req);
      return {
        text: responses[Math.min(requests.length - 1, responses.length - 1)]!,
        usage: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 80 },
      };
    },
  };
}

const state = { grid: [[2, 0, 0, 0]], score: 4, over: false, won: false };

describe("explorerDriver", () => {
  test("valid response maps to the named action", async () => {
    const llm = fakeLLM([`{"action": "ArrowLeft", "why": "merge the twos"}`]);
    const { driver, stats } = explorerDriver(llm, 42);
    const action = await driver({ game, state, actionIndex: 0, history: [] });
    expect(action).toEqual({ type: "key", key: "ArrowLeft" });
    expect(stats).toMatchObject({ calls: 1, randomFallbacks: 0 });
  });

  test("prompt carries state JSON, action descriptions, and the enum schema", async () => {
    const llm = fakeLLM([`{"action": "ArrowUp", "why": "x"}`]);
    const { driver } = explorerDriver(llm, 42);
    await driver({ game, state, actionIndex: 0, history: [] });
    const req = llm.requests[0]!;
    expect(req.user).toContain(JSON.stringify(state));
    expect(req.system).toContain("ArrowLeft");
    expect(req.system).toContain("merge"); // descriptions from the YAML spec
    expect(req.system).toContain("column-major"); // state_notes from the YAML spec
    const schema = req.schema as { properties: { action: { enum: string[] } } };
    expect(schema.properties.action.enum).toEqual(game.actions.map(actionLabel));
  });

  test("unparseable response falls back to a seeded random action and counts it", async () => {
    const llm = fakeLLM(["definitely not json"]);
    const { driver, stats } = explorerDriver(llm, 42);
    const action = await driver({ game, state, actionIndex: 0, history: [] });
    expect(game.actions).toContainEqual(action);
    expect(stats.randomFallbacks).toBe(1);
  });

  test("unknown action name falls back too", async () => {
    const llm = fakeLLM([`{"action": "KonamiCode", "why": "chaos"}`]);
    const { driver, stats } = explorerDriver(llm, 42);
    const action = await driver({ game, state, actionIndex: 0, history: [] });
    expect(game.actions).toContainEqual(action);
    expect(stats.randomFallbacks).toBe(1);
  });

  test("fallbacks are seeded — same seed, same picks", async () => {
    const picks = async (seed: number) => {
      const { driver } = explorerDriver(fakeLLM(["nope"]), seed);
      const out = [];
      for (let i = 0; i < 8; i++) out.push(await driver({ game, state, actionIndex: i, history: [] }));
      return out;
    };
    expect(await picks(7)).toEqual(await picks(7));
  });

  test("onDecision logs the choice, reasoning, and usage", async () => {
    const decisions: import("../src/explorer.ts").ExplorerDecision[] = [];
    const llm = fakeLLM([`{"action": "ArrowLeft", "why": "merge the twos"}`, "garbage"]);
    const { driver } = explorerDriver(llm, 42, (d) => decisions.push(d));
    await driver({ game, state, actionIndex: 0, history: [] });
    await driver({ game, state, actionIndex: 1, history: [] });

    expect(decisions[0]).toMatchObject({
      actionIndex: 0,
      action: "ArrowLeft",
      why: "merge the twos",
      fallback: false,
      state,
      usage: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 80 },
    });
    expect(decisions[1]).toMatchObject({ actionIndex: 1, fallback: true, raw: "garbage" });
    expect(decisions[1]!.why).toBeUndefined();
  });

  test("API failure propagates (runner reports harness-error)", async () => {
    const llm: LLMClient = {
      name: "fake:down",
      async complete() {
        throw new Error("rate limited after retries");
      },
    };
    const { driver } = explorerDriver(llm, 42);
    await expect(driver({ game, state, actionIndex: 0, history: [] })).rejects.toThrow(
      "rate limited",
    );
  });
});
