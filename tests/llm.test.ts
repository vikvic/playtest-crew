import { describe, expect, test, afterEach } from "bun:test";
import { OpenAICompatibleClient, DEFAULT_OPENAI_COMPATIBLE_BASE_URL } from "../src/llm.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  globalThis.fetch = (async (url: string, init: RequestInit) => handler(url, init)) as typeof fetch;
}

describe("OpenAICompatibleClient", () => {
  test("defaults to a local Ollama endpoint and llama3.2, no API key required", async () => {
    let seenUrl = "";
    let seenAuth: string | null = null;
    fakeFetch((url, init) => {
      seenUrl = url;
      seenAuth = (init.headers as Record<string, string>).authorization ?? null;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      );
    });
    const client = new OpenAICompatibleClient();
    await client.complete({ system: "s", user: "u" });
    expect(seenUrl).toBe(`${DEFAULT_OPENAI_COMPATIBLE_BASE_URL}/chat/completions`);
    expect(seenAuth).toBeNull();
    expect(client.name).toBe("openai-compatible:llama3.2");
  });

  test("sends system/user messages and a json_schema response_format when a schema is given", async () => {
    let body: Record<string, unknown> = {};
    fakeFetch((_url, init) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    });
    const schema = { type: "object", properties: { action: { enum: ["ArrowLeft"] } } };
    const client = new OpenAICompatibleClient({ model: "llama3.2", apiKey: "k" });
    await client.complete({ system: "sys", user: "usr", schema, maxTokens: 50 });
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
    expect(body.max_tokens).toBe(50);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "action", strict: true, schema },
    });
  });

  test("parses usage from the OpenAI-shaped response", async () => {
    fakeFetch(() =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: `{"action":"ArrowLeft","why":"x"}` } }],
          usage: { prompt_tokens: 12, completion_tokens: 5 },
        }),
      ),
    );
    const client = new OpenAICompatibleClient();
    const result = await client.complete({ system: "s", user: "u" });
    expect(result.text).toBe(`{"action":"ArrowLeft","why":"x"}`);
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5, cacheReadInputTokens: 0 });
  });

  test("a non-OK response is retried, then throws once retries are exhausted", async () => {
    let calls = 0;
    fakeFetch(() => {
      calls += 1;
      return new Response("server error", { status: 500 });
    });
    const client = new OpenAICompatibleClient();
    await expect(client.complete({ system: "s", user: "u" })).rejects.toThrow("HTTP 500");
    expect(calls).toBe(3);
  });

  test("an empty completion is treated as a failure", async () => {
    fakeFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] })));
    const client = new OpenAICompatibleClient();
    await expect(client.complete({ system: "s", user: "u" })).rejects.toThrow("empty completion");
  });
});
