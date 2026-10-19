import {
  LlmError,
  type AiClient,
  type ChatRequest,
  type ChatResult,
  type LlmErrorCode,
  type ProviderCapabilities,
  type ProviderHealth,
} from "@lucid/llm";
import type {
  AiEvent,
  AiStartRequest,
  AiStartResult,
  ProviderConnectionResult,
  ProviderProfile,
} from "../../electron/ipc/types";

export interface MainAiTransport {
  start(request: AiStartRequest): Promise<AiStartResult>;
  abort(id: number): Promise<void>;
  onEvent(listener: (event: AiEvent) => void): () => void;
  models(id: string): Promise<ProviderConnectionResult>;
}

const LOCAL_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  streaming: true,
  cancellation: true,
  structuredOutput: "json-schema",
  modelDiscovery: true,
  usage: "provider-or-estimated",
  reasoningControl: false,
  localModelManagement: false,
  customBaseUrl: true,
});

const ERROR_CODES = new Set<LlmErrorCode>([
  "LmUnreachable",
  "ModelNotLoaded",
  "ReasoningLeak",
  "Timeout",
  "FirstTokenTimeout",
  "ConnectionLost",
  "BadResponse",
  "Aborted",
]);
const errorCode = (value: string): LlmErrorCode =>
  ERROR_CODES.has(value as LlmErrorCode) ? (value as LlmErrorCode) : "BadResponse";

let requestId = 0;

const defaultTransport = (): MainAiTransport => ({
  ...window.lucid.ai,
  models: (id) => window.lucid.providers.models(id),
});

/**
 * Renderer-side AiClient facade. It carries only prompts, lane controls, and a persisted profile id;
 * endpoint resolution, credentials, HTTP, retries, and response parsing stay in Electron main.
 */
export class MainProcessAiClient implements AiClient {
  readonly provider: string;
  readonly capabilities: Readonly<ProviderCapabilities>;
  readonly localModels = undefined;

  constructor(
    private readonly profile: ProviderProfile,
    private readonly transport: MainAiTransport = defaultTransport(),
  ) {
    this.provider = profile.kind;
    this.capabilities =
      profile.kind === "lmstudio"
        ? { ...LOCAL_CAPABILITIES, reasoningControl: true }
        : profile.kind === "openai" || profile.kind === "anthropic"
          ? { ...LOCAL_CAPABILITIES, customBaseUrl: false }
          : LOCAL_CAPABILITIES;
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    if (signal?.aborted) return { reachable: false, models: [] };
    try {
      const result = await this.transport.models(this.profile.id);
      return { reachable: result.ok, models: result.models ?? [] };
    } catch {
      return { reachable: false, models: [] };
    }
  }

  chat(request: ChatRequest): Promise<ChatResult> {
    const id = ++requestId;
    const chunks: string[] = [];
    return new Promise((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        stop();
        request.signal?.removeEventListener("abort", onAbort);
      };
      const fail = (code: LlmErrorCode, message: string, cause?: unknown) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(new LlmError(code, message, cause === undefined ? undefined : { cause }));
      };
      const onAbort = () => {
        if (finished) return;
        void this.transport.abort(id).catch(() => undefined);
        fail("Aborted", "Cancelled.");
      };
      const stop = this.transport.onEvent((event) => {
        if (event.id !== id || finished) return;
        if (event.type === "delta") {
          chunks.push(event.text);
          request.onDelta?.(event.text);
          return;
        }
        if (event.type === "error") {
          fail(errorCode(event.code), event.message);
          return;
        }
        finished = true;
        cleanup();
        resolve({ content: chunks.join(""), ...event.result });
      });
      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) {
        onAbort();
        return;
      }
      void this.transport
        .start({
          id,
          providerId: this.profile.id,
          model: request.lane.model,
          messages: request.messages,
          lane: {
            temperature: request.lane.temperature,
            topP: request.lane.topP,
            topK: request.lane.topK,
            presencePenalty: request.lane.presencePenalty,
            maxTokens: request.lane.maxTokens,
          },
          jsonSchema: request.jsonSchema,
          reasoning: request.reasoning,
        })
        .then((result) => {
          if (!result.ok) fail("LmUnreachable", result.message);
        })
        .catch((error: unknown) => {
          fail(
            "ConnectionLost",
            error instanceof Error ? error.message : "The AI request could not start.",
            error,
          );
        });
    });
  }
}
