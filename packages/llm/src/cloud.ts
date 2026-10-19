import { LlmError, type LlmErrorCode } from "./errors";
import type {
  AiClient,
  ChatRequest,
  ChatResult,
  ProviderCapabilities,
  ProviderHealth,
} from "./provider";
import { readSse } from "./sse";

export interface CloudClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  firstTokenTimeoutMs?: number;
  requestTimeoutMs?: number;
}

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const estimate = (text: string): number => Math.max(1, Math.ceil(text.length / 4));
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/** Anthropic accepts a smaller JSON Schema subset. Lucid validates the original schema after receipt. */
export const anthropicSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(anthropicSchema);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (["minLength", "maxLength", "minimum", "maximum", "multipleOf", "maxItems"].includes(key))
      continue;
    if (key === "minItems" && child !== 0 && child !== 1) continue;
    result[key] = anthropicSchema(child);
  }
  return result;
};

abstract class CloudClient implements AiClient {
  abstract readonly provider: string;
  abstract readonly capabilities: Readonly<ProviderCapabilities>;
  readonly localModels = undefined;
  protected readonly baseUrl: string;
  protected readonly apiKey: string;
  protected readonly doFetch: typeof fetch;
  protected readonly firstTokenTimeoutMs: number;
  protected readonly requestTimeoutMs: number;

  constructor(options: CloudClientOptions, defaultBaseUrl: string) {
    this.baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.firstTokenTimeoutMs = options.firstTokenTimeoutMs ?? 60_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 180_000;
  }

  abstract health(signal?: AbortSignal): Promise<ProviderHealth>;
  abstract chat(request: ChatRequest): Promise<ChatResult>;

  protected async stream(
    path: string,
    headers: Record<string, string>,
    payload: object,
    request: ChatRequest,
    onEvent: (event: Record<string, unknown>) => boolean,
  ): Promise<{
    sentAt: number;
    firstTokenAt: number | null;
    doneAt: number;
    requestChars: number;
  }> {
    if (request.signal?.aborted) throw new LlmError("Aborted", "Cancelled.");
    const controller = new AbortController();
    let abortReason: LlmErrorCode | undefined;
    const abort = (reason: LlmErrorCode) => {
      abortReason ??= reason;
      controller.abort();
    };
    const onAbort = () => {
      abort("Aborted");
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    const requestTimer = setTimeout(() => {
      abort("Timeout");
    }, this.requestTimeoutMs);
    let firstTokenAt: number | null = null;
    const firstTokenTimer = setTimeout(() => {
      abort("FirstTokenTimeout");
    }, this.firstTokenTimeoutMs);
    const body = JSON.stringify(payload);
    const sentAt = Date.now();
    try {
      let response: Response;
      try {
        response = await this.doFetch(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body,
          signal: controller.signal,
        });
      } catch {
        throw this.abortError(abortReason, "Could not connect to the AI provider.");
      }
      if (!response.ok) {
        const status = response.status;
        // Provider bodies can echo prompts and credentials. Only expose status and useful generic guidance.
        const hint =
          status === 401 || status === 403
            ? "Check the API key and account access."
            : status === 404
              ? "Check the selected model and provider address."
              : status === 429
                ? "The provider is rate limiting requests or the account is out of quota."
                : status === 400 && request.jsonSchema
                  ? "The selected model rejected Lucid's structured output schema; choose a compatible model. No edit was applied."
                  : "Check the provider status and model configuration.";
        throw new LlmError("BadResponse", `${this.provider} returned HTTP ${status}. ${hint}`);
      }
      if (!response.body)
        throw new LlmError("BadResponse", `${this.provider} sent an empty response.`);
      try {
        for await (const data of readSse(response.body)) {
          if (data === "[DONE]") continue;
          let event: Record<string, unknown>;
          try {
            event = object(JSON.parse(data) as unknown);
          } catch {
            throw new LlmError("BadResponse", `${this.provider} sent malformed stream data.`);
          }
          const textDelta = onEvent(event);
          if (firstTokenAt === null && textDelta) {
            firstTokenAt = Date.now();
            clearTimeout(firstTokenTimer);
          }
        }
      } catch (error) {
        if (abortReason) throw this.abortError(abortReason, "The provider connection ended.");
        if (error instanceof LlmError) throw error;
        throw new LlmError(
          "ConnectionLost",
          `The connection to ${this.provider} dropped mid-answer.`,
        );
      }
      if (abortReason) throw this.abortError(abortReason, "The provider connection ended.");
      return { sentAt, firstTokenAt, doneAt: Date.now(), requestChars: body.length };
    } finally {
      clearTimeout(requestTimer);
      clearTimeout(firstTokenTimer);
      request.signal?.removeEventListener("abort", onAbort);
      controller.abort();
    }
  }

  private abortError(reason: LlmErrorCode | undefined, fallback: string): LlmError {
    if (reason === "Aborted") return new LlmError("Aborted", "Cancelled.");
    if (reason === "FirstTokenTimeout")
      return new LlmError("FirstTokenTimeout", `${this.provider} did not start answering in time.`);
    if (reason === "Timeout") return new LlmError("Timeout", `${this.provider} took too long.`);
    return new LlmError("LmUnreachable", fallback);
  }

  protected result(
    request: ChatRequest,
    content: string,
    model: string,
    usage: { prompt?: number; completion?: number; reasoning?: number },
    timing: { sentAt: number; firstTokenAt: number | null; doneAt: number; requestChars: number },
  ): ChatResult {
    if (!content.trim())
      throw new LlmError("BadResponse", `${this.provider} returned no text answer.`);
    const { prompt, completion } = usage;
    const providerUsage = prompt !== undefined && completion !== undefined;
    return {
      content,
      model,
      provider: this.provider,
      usage: providerUsage
        ? {
            prompt,
            completion,
            reasoning: usage.reasoning ?? 0,
            source: "provider",
          }
        : {
            prompt: estimate(JSON.stringify(request.messages)),
            completion: estimate(content),
            reasoning: 0,
            source: "estimated",
          },
      characters: { request: timing.requestChars, response: content.length },
      timings: {
        sentAt: timing.sentAt,
        firstTokenAt: timing.firstTokenAt,
        doneAt: timing.doneAt,
      },
      repairAttempts: 0,
    };
  }
}

export class OpenAiClient extends CloudClient {
  readonly provider = "openai";
  readonly capabilities: Readonly<ProviderCapabilities> = Object.freeze({
    streaming: true,
    cancellation: true,
    structuredOutput: "json-schema",
    modelDiscovery: true,
    usage: "provider-or-estimated",
    reasoningControl: false,
    localModelManagement: false,
    customBaseUrl: false,
  });

  constructor(options: CloudClientOptions) {
    super(options, "https://api.openai.com/v1");
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const response = await this.doFetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) return { reachable: false, models: [] };
      const data = object(await response.json()).data;
      return {
        reachable: true,
        models: Array.isArray(data)
          ? data.map((item) => object(item).id).filter((id): id is string => typeof id === "string")
          : [],
      };
    } catch {
      return { reachable: false, models: [] };
    }
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    let content = "";
    let model = request.lane.model;
    const state = { complete: false, failure: false };
    const usage: { prompt?: number; completion?: number; reasoning?: number } = {};
    const timing = await this.stream(
      "/responses",
      { Authorization: `Bearer ${this.apiKey}` },
      {
        model,
        input: request.messages,
        stream: true,
        store: false,
        max_output_tokens: request.lane.maxTokens,
        ...(request.jsonSchema
          ? {
              text: {
                format: {
                  type: "json_schema",
                  name: request.jsonSchema.name,
                  schema: request.jsonSchema.schema,
                  strict: true,
                },
              },
            }
          : {}),
      },
      request,
      (event) => {
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          content += event.delta;
          request.onDelta?.(event.delta);
          return true;
        } else if (event.type === "response.completed") {
          state.complete = true;
          const response = object(event.response);
          if (typeof response.model === "string") model = response.model;
          const counts = object(response.usage);
          const prompt = count(counts.input_tokens);
          const completion = count(counts.output_tokens);
          const reasoning = count(object(counts.output_tokens_details).reasoning_tokens);
          if (prompt !== undefined) usage.prompt = prompt;
          if (completion !== undefined) usage.completion = completion;
          if (reasoning !== undefined) usage.reasoning = reasoning;
        } else if (event.type === "response.failed" || event.type === "error") {
          state.failure = true;
        }
        return false;
      },
    );
    if (state.failure || !state.complete)
      throw new LlmError(
        "BadResponse",
        "OpenAI did not complete the response. No edit was applied.",
      );
    return this.result(request, content, model, usage, timing);
  }
}

export class AnthropicClient extends CloudClient {
  readonly provider = "anthropic";
  readonly capabilities: Readonly<ProviderCapabilities> = Object.freeze({
    streaming: true,
    cancellation: true,
    structuredOutput: "json-schema",
    modelDiscovery: true,
    usage: "provider-or-estimated",
    reasoningControl: false,
    localModelManagement: false,
    customBaseUrl: false,
  });

  constructor(options: CloudClientOptions) {
    super(options, "https://api.anthropic.com/v1");
  }

  private headers(): Record<string, string> {
    return { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" };
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const response = await this.doFetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) return { reachable: false, models: [] };
      const data = object(await response.json()).data;
      return {
        reachable: true,
        models: Array.isArray(data)
          ? data.map((item) => object(item).id).filter((id): id is string => typeof id === "string")
          : [],
      };
    } catch {
      return { reachable: false, models: [] };
    }
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const messages = request.messages.filter((message) => message.role !== "system");
    if (!messages.length)
      throw new LlmError("BadResponse", "Anthropic needs at least one user message.");
    let content = "";
    let model = request.lane.model;
    const state = { complete: false, failure: false };
    const usage: { prompt?: number; completion?: number } = {};
    const timing = await this.stream(
      "/messages",
      this.headers(),
      {
        model,
        messages,
        ...(system ? { system } : {}),
        stream: true,
        max_tokens: request.lane.maxTokens,
        ...(request.jsonSchema
          ? {
              output_config: {
                format: { type: "json_schema", schema: anthropicSchema(request.jsonSchema.schema) },
              },
            }
          : {}),
      },
      request,
      (event) => {
        if (event.type === "message_start") {
          const message = object(event.message);
          if (typeof message.model === "string") model = message.model;
          const prompt = count(object(message.usage).input_tokens);
          if (prompt !== undefined) usage.prompt = prompt;
        } else if (event.type === "content_block_delta") {
          const delta = object(event.delta);
          if (delta.type === "text_delta" && typeof delta.text === "string") {
            content += delta.text;
            request.onDelta?.(delta.text);
            return true;
          }
        } else if (event.type === "message_delta") {
          const completion = count(object(event.usage).output_tokens);
          if (completion !== undefined) usage.completion = completion;
        } else if (event.type === "message_stop") {
          state.complete = true;
        } else if (event.type === "error") {
          state.failure = true;
        }
        return false;
      },
    );
    if (state.failure || !state.complete)
      throw new LlmError(
        "BadResponse",
        "Anthropic did not complete the response. No edit was applied.",
      );
    return this.result(request, content, model, usage, timing);
  }
}
