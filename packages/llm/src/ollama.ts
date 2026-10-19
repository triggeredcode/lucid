import { LlmError, isLlmError, type LlmErrorCode } from "./errors";
import type {
  AiClient,
  ChatRequest,
  ChatResult,
  ProviderCapabilities,
  ProviderHealth,
} from "./provider";

export interface OllamaClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  firstTokenTimeoutMs?: number;
  requestTimeoutMs?: number;
}

interface OllamaChunk {
  model?: unknown;
  message?: { content?: unknown; thinking?: unknown };
  done?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
  error?: unknown;
}

const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));
const validCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const count = (value: unknown): number => (validCount(value) ? value : 0);

async function* readNdjson(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) yield trimmed;
    }
  }
  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) yield tail;
}

const responseError = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: unknown };
    return typeof body.error === "string" ? body.error : text;
  } catch {
    return text;
  }
};

/** Ollama's native local API adapter. Network access is supplied by Electron main. */
export class OllamaClient implements AiClient {
  readonly provider = "ollama";
  readonly localModels = undefined;
  readonly capabilities: Readonly<ProviderCapabilities> = Object.freeze({
    streaming: true,
    cancellation: true,
    structuredOutput: "native",
    modelDiscovery: true,
    usage: "provider-or-estimated",
    reasoningControl: false,
    localModelManagement: false,
    customBaseUrl: true,
  });
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;
  private readonly firstTokenTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(options: OllamaClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.firstTokenTimeoutMs = options.firstTokenTimeoutMs ?? 120_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 180_000;
  }

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
      const response = await this.doFetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      if (!response.ok) return { reachable: true, models: [] };
      const body = (await response.json()) as { models?: unknown };
      const models = Array.isArray(body.models)
        ? body.models
            .map((entry) => {
              if (!entry || typeof entry !== "object") return undefined;
              const item = entry as { model?: unknown; name?: unknown };
              const id = item.model ?? item.name;
              return typeof id === "string" ? id : undefined;
            })
            .filter((id): id is string => id !== undefined && !/:cloud$/i.test(id))
        : [];
      return { reachable: true, models };
    } catch {
      return { reachable: false, models: [] };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }

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
    if (/:cloud$/i.test(request.lane.model))
      throw new LlmError(
        "BadResponse",
        "That model runs in Ollama Cloud. Choose an installed local model or configure Ollama Cloud explicitly in Settings.",
      );
    const body = {
      model: request.lane.model,
      messages: request.messages,
      stream: true,
      think: false,
      keep_alive: "1h",
      options: {
        temperature: request.lane.temperature,
        top_p: request.lane.topP,
        top_k: request.lane.topK,
        num_predict: request.lane.maxTokens,
      },
      ...(request.jsonSchema ? { format: request.jsonSchema.schema } : {}),
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
          "Ollama is taking too long. Try again, or choose a smaller model.",
        );
      if (reason === "FirstTokenTimeout")
        return new LlmError("FirstTokenTimeout", "Ollama did not start answering in time.");
      return fallback;
    };

    const sentAt = Date.now();
    let completed = false;
    try {
      let response: Response;
      try {
        response = await this.doFetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        throw fail(
          new LlmError("LmUnreachable", `Can't reach Ollama at ${this.baseUrl}. Is it running?`, {
            cause: error,
          }),
        );
      }

      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 404 || /model .*not found|pull model/i.test(message))
          throw new LlmError(
            "ModelNotLoaded",
            `${request.lane.model} isn't installed in Ollama. Run “ollama pull ${request.lane.model}”, then try again.`,
          );
        if (request.jsonSchema && response.status === 400)
          throw new LlmError(
            "BadResponse",
            "Ollama rejected Lucid’s structured output request. Update Ollama or choose a model that supports JSON Schema before using Command Mode.",
          );
        throw new LlmError(
          "BadResponse",
          `Ollama answered ${String(response.status)}: ${message.slice(0, 300)}`,
        );
      }
      if (!response.body) throw new LlmError("BadResponse", "Ollama sent an empty response.");

      let content = "";
      let firstTokenAt: number | null = null;
      let sawThinking = false;
      let done = false;
      let model = request.lane.model;
      const usage = { prompt: 0, completion: 0, reasoning: 0 };
      let usageReported = false;
      try {
        for await (const line of readNdjson(response.body)) {
          let chunk: OllamaChunk;
          try {
            chunk = JSON.parse(line) as OllamaChunk;
          } catch {
            throw new LlmError("BadResponse", "Ollama sent an invalid streaming response.");
          }
          if (typeof chunk.error === "string")
            throw new LlmError("BadResponse", `Ollama reported an error: ${chunk.error}`);
          if (typeof chunk.message?.thinking === "string" && chunk.message.thinking)
            sawThinking = true;
          const piece = chunk.message?.content;
          if (typeof piece === "string" && piece) {
            if (firstTokenAt === null) {
              firstTokenAt = Date.now();
              clearFirstToken();
            }
            content += piece;
            request.onDelta?.(piece);
          }
          if (typeof chunk.model === "string") model = chunk.model;
          if (chunk.done === true) {
            done = true;
            usage.prompt = count(chunk.prompt_eval_count);
            usage.completion = count(chunk.eval_count);
            usageReported = validCount(chunk.prompt_eval_count) && validCount(chunk.eval_count);
          }
        }
      } catch (error) {
        if (isLlmError(error)) throw error;
        throw fail(
          new LlmError("ConnectionLost", "The connection to Ollama dropped mid-answer.", {
            cause: error,
          }),
        );
      }
      if (reason) throw fail(new LlmError("ConnectionLost", "The connection to Ollama dropped."));
      if (!done)
        throw new LlmError("ConnectionLost", "The connection to Ollama dropped mid-answer.");
      if (content.trim() === "") {
        if (sawThinking)
          throw new LlmError("ReasoningLeak", "The model only thought and gave no answer.");
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
      if (!completed) controller.abort();
    }
  }
}
