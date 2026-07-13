/**
 * Provider-agnostic LLMClient seam (CLAUDE.md mandate). v0 ships the
 * Anthropic implementation only; OpenAI-compatible and Gemini impls are
 * post-v0 (TODOS.md #1) — copy this shape.
 *
 * The seam is deliberately tiny: one completion call with a stable system
 * prompt, a per-turn user prompt, and an optional JSON schema the response
 * must conform to. Providers that support constrained decoding enforce the
 * schema server-side (Anthropic: structured outputs); others would prompt
 * for it and validate client-side.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface CompletionRequest {
  /** Stable per-run instructions — implementations should prompt-cache this. */
  system: string;
  /** Per-turn content (state JSON, history). */
  user: string;
  /** JSON schema for the response body. */
  schema?: Record<string, unknown>;
  maxTokens?: number;
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
}

export interface CompletionResult {
  text: string;
  /** Present when the provider reports it; feeds the per-call llm.jsonl log. */
  usage?: CompletionUsage;
}

export interface LLMClient {
  readonly name: string;
  /** Returns the raw completion text. Throws after internal retries are exhausted. */
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export const DEFAULT_MODEL = "claude-opus-4-8";

export class AnthropicClient implements LLMClient {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: { model?: string; apiKey?: string } = {}) {
    this.model = opts.model ?? process.env.PTC_MODEL ?? DEFAULT_MODEL;
    this.name = `anthropic:${this.model}`;
    // Design doc: LLM API failure after 3 retries with backoff → harness-error.
    // The SDK retries 429/5xx/connection errors with backoff; after that the
    // throw propagates to the runner, which reports harness-error.
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 3 });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 300,
      // Stable prefix cached across the run's ~hundreds of calls (5-min TTL
      // outlives the inter-action gap by orders of magnitude).
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: req.user }],
      ...(req.schema
        ? { output_config: { format: { type: "json_schema" as const, schema: req.schema } } }
        : {}),
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text === "") {
      throw new Error(
        `LLM returned no text (stop_reason: ${response.stop_reason ?? "unknown"})`,
      );
    }
    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}
