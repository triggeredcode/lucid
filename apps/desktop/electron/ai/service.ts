import type { AiClient, ChatResult, Lane } from "@lucid/llm";
import type { AiEvent, AiStartRequest, AiStartResult } from "../ipc/types";
import { redactSensitive, validateProviderEndpoint } from "./security";

export interface AiRuntime {
  client: AiClient;
  /** Main-owned endpoint configuration, never supplied in an individual renderer request. */
  endpoint: string;
  /** Known credentials are used only to scrub provider errors before they leave main. */
  secrets?: readonly string[] | undefined;
}
export type AiRuntimeResolver = (providerId: string) => Promise<AiRuntime | undefined>;

const validRequest = (request: AiStartRequest): boolean =>
  Number.isSafeInteger(request.id) &&
  request.id >= 0 &&
  /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(request.providerId) &&
  request.model.length > 0 &&
  request.model.length <= 240 &&
  request.messages.length > 0 &&
  request.messages.length <= 100 &&
  request.messages.every((message) => message.content.length <= 1_000_000);

export class MainAiService {
  private readonly running = new Map<number, AbortController>();

  constructor(private readonly resolve: AiRuntimeResolver) {}

  async start(request: AiStartRequest, emit: (event: AiEvent) => void): Promise<AiStartResult> {
    if (!validRequest(request)) return { ok: false, message: "Invalid AI request." };
    if (this.running.has(request.id))
      return { ok: false, message: "That AI request is already running." };
    const runtime = await this.resolve(request.providerId);
    if (!runtime) return { ok: false, message: "That AI provider is not configured." };
    try {
      validateProviderEndpoint(runtime.endpoint);
    } catch (error) {
      return { ok: false, message: redactSensitive(error, runtime.secrets) };
    }
    const controller = new AbortController();
    this.running.set(request.id, controller);
    const lane: Lane = { ...request.lane, model: request.model };
    void runtime.client
      .chat({
        lane,
        messages: request.messages,
        jsonSchema: request.jsonSchema,
        reasoning: request.reasoning,
        signal: controller.signal,
        onDelta: (text) => {
          emit({ id: request.id, type: "delta", text });
        },
      })
      .then((result: ChatResult) => {
        const { content: _content, ...safeResult } = result;
        emit({ id: request.id, type: "complete", result: safeResult });
      })
      .catch((error: unknown) => {
        const code =
          error instanceof Error &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : "ProviderError";
        emit({
          id: request.id,
          type: "error",
          code,
          message: redactSensitive(error, runtime.secrets),
        });
      })
      .finally(() => this.running.delete(request.id));
    return { ok: true };
  }

  abort(id: number): void {
    this.running.get(id)?.abort();
  }
}
