import { LlmError, isLlmError, type LlmErrorCode } from "./errors";
import type {
  AiClient,
  ChatRequest,
  ChatResult,
  ProviderCapabilities,
  ProviderHealth,
} from "./provider";
import { readSse } from "./sse";

export type { ChatMessage, ChatRequest, ChatResult, ProviderHealth as Health } from "./provider";

export interface ClientOptions {
  baseUrl?: string;
  /** The fetch to use. The desktop app passes one that goes through the main process (LM Studio sends no CORS headers). */
  fetch?: typeof fetch;
  firstTokenTimeoutMs?: number;
  requestTimeoutMs?: number;
}

interface StreamChunk {
  choices?: {
    delta?: { content?: string; reasoning?: string; reasoning_content?: string };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string } | string;
}

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

/** The only request shape Lucid uses: /v1/chat/completions, streamed, with reasoning off. */
export class LmStudioClient implements AiClient {
  readonly provider = "lmstudio";
  readonly localModels = undefined;
  readonly capabilities: Readonly<ProviderCapabilities> = Object.freeze({
    streaming: true,
    cancellation: true,
    structuredOutput: "native",
    modelDiscovery: true,
    usage: "provider-or-estimated",
    reasoningControl: true,
    localModelManagement: false,
    customBaseUrl: true,
  });
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;
  private readonly firstTokenTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:1234").replace(/\/+$/, "");
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.firstTokenTimeoutMs = options.firstTokenTimeoutMs ?? 120_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 180_000;
  }

  /** Never throws: an unreachable server is just `{ reachable: false }`. */
  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 3000);
    const stop = () => {
      controller.abort();
    };
    signal?.addEventListener("abort", stop);
    try {
      const res = await this.doFetch(`${this.baseUrl}/v1/models`, { signal: controller.signal });
      if (!res.ok) return { reachable: true, models: [] };
      const json = (await res.json()) as { data?: { id?: unknown }[] };
      return {
        reachable: true,
        models: (json.data ?? [])
          .map((m) => m.id)
          .filter((id): id is string => typeof id === "string"),
      };
    } catch {
      return { reachable: false, models: [] };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }

  /** One streamed chat. A reasoning leak (thinking tokens and no answer) is retried once. */
  async chat(request: ChatRequest): Promise<ChatResult> {
    try {
      return await this.once(request);
    } catch (error) {
      if (isLlmError(error) && error.code === "ReasoningLeak") {
        const repaired = await this.once(request);
        return { ...repaired, repairAttempts: repaired.repairAttempts + 1 };
      }
      throw error;
    }
  }

  private async once(request: ChatRequest): Promise<ChatResult> {
    const { lane } = request;
    const body = {
      model: lane.model,
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: lane.temperature,
      top_p: lane.topP,
      top_k: lane.topK,
      presence_penalty: lane.presencePenalty,
      max_tokens: lane.maxTokens,
      reasoning_effort: request.reasoning ?? "none",
      ttl: 3600,
      ...(request.jsonSchema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: request.jsonSchema.name,
                strict: true,
                schema: request.jsonSchema.schema,
              },
            },
          }
        : {}),
    };
    const requestCharacters = JSON.stringify(body).length;

    const controller = new AbortController();
    let reason: LlmErrorCode | undefined;
    const abort = (why: LlmErrorCode) => {
      reason ??= why;
      controller.abort();
    };
    if (request.signal?.aborted) throw new LlmError("Aborted", "Cancelled.");
    const onUserAbort = () => {
      abort("Aborted");
    };
    request.signal?.addEventListener("abort", onUserAbort);
    const requestTimer = setTimeout(() => {
      abort("Timeout");
    }, this.requestTimeoutMs);
    let firstTokenTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      abort("FirstTokenTimeout");
    }, this.firstTokenTimeoutMs);
    const clearFirstToken = () => {
      if (firstTokenTimer !== undefined) clearTimeout(firstTokenTimer);
      firstTokenTimer = undefined;
    };
    const fail = (fallback: LlmError): LlmError => {
      if (reason === "Aborted") return new LlmError("Aborted", "Cancelled.");
      if (reason === "Timeout")
        return new LlmError(
          "Timeout",
          "The model is taking too long. Try again, or use a smaller model.",
        );
      if (reason === "FirstTokenTimeout")
        return new LlmError("FirstTokenTimeout", "The model did not start answering in time.");
      return fallback;
    };

    const sentAt = Date.now();
    let completed = false;
    try {
      let res: Response;
      try {
        res = await this.doFetch(`${this.baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        throw fail(
          new LlmError(
            "LmUnreachable",
            `Can't reach LM Studio at ${this.baseUrl}. Is it running?`,
            {
              cause: error,
            },
          ),
        );
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let message = text;
        try {
          const parsed = JSON.parse(text) as { error?: { message?: string } | string };
          message =
            typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? text);
        } catch {
          // Not JSON: keep the raw text.
        }
        if (
          (res.status === 400 || res.status === 404) &&
          /no models? loaded|not loaded|model .*not found|unknown model/i.test(message)
        ) {
          throw new LlmError("ModelNotLoaded", `${lane.model} isn't loaded in LM Studio.`);
        }
        throw new LlmError(
          "BadResponse",
          `LM Studio answered ${String(res.status)}: ${message.slice(0, 300)}`,
        );
      }
      if (!res.body) throw new LlmError("BadResponse", "LM Studio sent an empty response.");

      let content = "";
      let firstTokenAt: number | null = null;
      let sawReasoning = false;
      let finished = false;
      let done = false;
      let model = lane.model;
      const usage = { prompt: 0, completion: 0, reasoning: 0 };
      let usageReported = false;
      try {
        for await (const data of readSse(res.body)) {
          if (data === "[DONE]") {
            done = true;
            break;
          }
          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(data) as StreamChunk;
          } catch {
            continue;
          }
          if (chunk.error) {
            const message =
              typeof chunk.error === "string"
                ? chunk.error
                : (chunk.error.message ?? "unknown error");
            throw new LlmError("BadResponse", `LM Studio reported an error: ${message}`);
          }
          const choice = chunk.choices?.[0];
          if (choice?.delta?.reasoning || choice?.delta?.reasoning_content) sawReasoning = true;
          const piece = choice?.delta?.content;
          if (piece) {
            if (firstTokenAt === null) {
              firstTokenAt = Date.now();
              clearFirstToken();
            }
            content += piece;
            request.onDelta?.(piece);
          }
          if (choice?.finish_reason) finished = true;
          if (chunk.usage) {
            usage.prompt = num(chunk.usage.prompt_tokens);
            usage.completion = num(chunk.usage.completion_tokens);
            usage.reasoning = num(chunk.usage.completion_tokens_details?.reasoning_tokens);
            usageReported =
              typeof chunk.usage.prompt_tokens === "number" &&
              typeof chunk.usage.completion_tokens === "number";
          }
          if (typeof (chunk as { model?: unknown }).model === "string")
            model = (chunk as { model: string }).model;
        }
      } catch (error) {
        if (isLlmError(error)) throw error;
        throw fail(
          new LlmError("ConnectionLost", "The connection to LM Studio dropped mid-answer.", {
            cause: error,
          }),
        );
      }
      if (reason)
        throw fail(new LlmError("ConnectionLost", "The connection to LM Studio dropped."));
      if (!done && !finished)
        throw new LlmError("ConnectionLost", "The connection to LM Studio dropped mid-answer.");

      if (content.trim() === "") {
        if (sawReasoning || usage.reasoning > 0) {
          throw new LlmError("ReasoningLeak", "The model only thought and gave no answer.");
        }
        throw new LlmError("BadResponse", "The model gave an empty answer.");
      }
      completed = true;
      return {
        content,
        usage: usageReported
          ? { ...usage, source: "provider" }
          : {
              prompt: estimateTokens(JSON.stringify(request.messages)),
              completion: estimateTokens(content),
              reasoning: 0,
              source: "estimated",
            },
        characters: { request: requestCharacters, response: content.length },
        timings: { sentAt, firstTokenAt, doneAt: Date.now() },
        model,
        provider: this.provider,
        repairAttempts: 0,
      };
    } finally {
      clearTimeout(requestTimer);
      clearFirstToken();
      request.signal?.removeEventListener("abort", onUserAbort);
      // A finished answer is left alone: cutting the connection the instant it ends can stop LM Studio from saving its
      // work on the prompt, and the next request then pays for the whole prompt again.
      if (!completed) controller.abort();
    }
  }
}
