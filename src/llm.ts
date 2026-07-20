/**
 * Provider-agnostic LLMClient seam (CLAUDE.md mandate). Anthropic,
 * OpenAI-compatible (vLLM, Ollama, any /v1/chat/completions gateway), and
 * Gemini all ship here — CLAUDE.md's provider-agnostic mandate is now
 * fully satisfied, not just satisfied by interface.
 *
 * The seam is deliberately tiny: one completion call with a stable system
 * prompt, a per-turn user prompt, and an optional JSON schema the response
 * must conform to. Providers that support constrained decoding enforce the
 * schema server-side (Anthropic: structured outputs; Ollama/vLLM:
 * `response_format: json_schema`); others would prompt for it and validate
 * client-side (the explorer driver already falls back to a seeded random
 * pick on an unparseable or out-of-enum response, so a provider with no
 * schema support at all still degrades safely, just with a higher fallback
 * rate visible in the run summary).
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

export const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "http://localhost:11434/v1";
export const DEFAULT_OPENAI_COMPATIBLE_MODEL = "llama3.2";

/**
 * Talks to any server implementing the OpenAI /v1/chat/completions shape —
 * this is how local models plug in (Ollama, vLLM) as well as hosted
 * OpenAI-compatible gateways. No SDK dependency: the wire format is stable
 * and small enough that `fetch` is simpler than adding one.
 */
export class OpenAICompatibleClient implements LLMClient {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(opts: { model?: string; baseUrl?: string; apiKey?: string } = {}) {
    this.model = opts.model ?? process.env.PTC_MODEL ?? DEFAULT_OPENAI_COMPATIBLE_MODEL;
    this.baseUrl = (opts.baseUrl ?? process.env.PTC_BASE_URL ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.apiKey = opts.apiKey ?? process.env.PTC_API_KEY;
    this.name = `openai-compatible:${this.model}`;
  }

  /**
   * Best-effort preflight: GET /v1/models (standard OpenAI surface — Ollama,
   * vLLM, and hosted gateways all expose it) and confirm this client's model
   * is present. Throws with a copy-pasteable fix instead of letting a
   * missing model surface as an opaque completion error after the browser
   * is already up. If the endpoint is unreachable or doesn't exist, this is
   * NOT proof the model is missing — stays silent and lets the first real
   * `complete()` call fail (or succeed) on its own.
   */
  async checkModelAvailable(): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/models`, {
        headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      });
    } catch {
      return;
    }
    if (!res.ok) return;
    const json = (await res.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
    const ids = json?.data?.map((m) => m.id) ?? [];
    if (ids.length === 0) return;
    // Ollama tags default to ":latest"; match the bare name too so
    // "llama3.2" finds "llama3.2:latest".
    const bare = this.model.split(":")[0];
    const found = ids.some((id) => id === this.model || id.split(":")[0] === bare);
    if (!found) {
      throw new Error(
        `${this.name}: model "${this.model}" not found at ${this.baseUrl}. ` +
          `Available: ${ids.join(", ")}. ` +
          `If this is Ollama, pull it first: ollama pull ${this.model}`,
      );
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      max_tokens: req.maxTokens ?? 300,
      ...(req.schema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "action", strict: true, schema: req.schema },
            },
          }
        : {}),
    };

    let lastError: unknown;
    // Same retry contract as the Anthropic client: exhausted retries
    // propagate, and the runner reports harness-error, not a game bug.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          throw new Error(`${this.name}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
        }
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const text = json.choices?.[0]?.message?.content ?? "";
        if (text === "") throw new Error(`${this.name}: empty completion`);
        return {
          text,
          usage: json.usage
            ? {
                inputTokens: json.usage.prompt_tokens ?? 0,
                outputTokens: json.usage.completion_tokens ?? 0,
                cacheReadInputTokens: 0,
              }
            : undefined,
        };
      } catch (e) {
        lastError = e;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/**
 * Gemini's REST `generateContent` endpoint. No SDK dependency, same
 * reasoning as OpenAICompatibleClient: the wire format is small and stable
 * enough that `fetch` is simpler than adding one. Structured output is
 * enforced server-side via `generationConfig.responseSchema` (Gemini's
 * schema dialect is close enough to standard JSON Schema for the
 * alphabet-enum shape the explorer sends — anything it rejects still
 * degrades safely through the explorer's client-side fallback).
 */
export class GeminiClient implements LLMClient {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts: { model?: string; baseUrl?: string; apiKey?: string } = {}) {
    this.model = opts.model ?? process.env.PTC_MODEL ?? DEFAULT_GEMINI_MODEL;
    this.baseUrl = (opts.baseUrl ?? process.env.PTC_BASE_URL ?? DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, "");
    const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GeminiClient: GEMINI_API_KEY is required (no default — Gemini has no local server mode)");
    this.apiKey = apiKey;
    this.name = `gemini:${this.model}`;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 300,
        ...(req.schema ? { responseMimeType: "application/json", responseSchema: req.schema } : {}),
      },
    };

    let lastError: unknown;
    // Same retry contract as the other clients: exhausted retries propagate,
    // and the runner reports harness-error, not a game bug.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          throw new Error(`${this.name}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
        }
        const json = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        if (text === "") throw new Error(`${this.name}: empty completion`);
        return {
          text,
          usage: json.usageMetadata
            ? {
                inputTokens: json.usageMetadata.promptTokenCount ?? 0,
                outputTokens: json.usageMetadata.candidatesTokenCount ?? 0,
                cacheReadInputTokens: 0,
              }
            : undefined,
        };
      } catch (e) {
        lastError = e;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
