import type { Lane } from "./lanes";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

export interface ChatRequest {
  lane: Lane;
  messages: ChatMessage[];
  /** Strict structured output (Command and Advisor lanes). Input streams plain text. */
  jsonSchema?: { name: string; schema: object } | undefined;
  /** Used only when the provider advertises reasoningControl. */
  reasoning?: ReasoningEffort | undefined;
  signal?: AbortSignal | undefined;
  /** Called with each piece of streamed content. */
  onDelta?: ((text: string) => void) | undefined;
}

export interface ChatResult {
  content: string;
  usage: {
    prompt: number;
    completion: number;
    reasoning: number;
    /** Provider counts are preferred; estimates are explicitly marked when omitted. */
    source: "provider" | "estimated";
  };
  characters: { request: number; response: number };
  timings: { sentAt: number; firstTokenAt: number | null; doneAt: number };
  model: string;
  provider: string;
  /** Automatic retries performed inside the provider adapter before returning the answer. */
  repairAttempts: number;
}

export interface ProviderHealth {
  reachable: boolean;
  /** Model ids discovered from the provider. Empty may also mean discovery is unsupported. */
  models: string[];
}

export interface LocalModelControl {
  status(
    model: string,
    signal?: AbortSignal,
  ): Promise<"loaded" | "unloaded" | "loading" | "unknown">;
  load(model: string, signal?: AbortSignal): Promise<void>;
}

export interface ProviderCapabilities {
  streaming: boolean;
  cancellation: boolean;
  /**
   * `native` means the provider enforces Lucid's JSON Schema. `prompted` means Lucid must include the
   * schema in the prompt and validate the answer itself. `unavailable` must stop structured work before
   * any request is sent; adapters never silently downgrade between these modes.
   */
  structuredOutput: "native" | "prompted" | "unavailable";
  modelDiscovery: boolean;
  usage: "provider-or-estimated" | "estimated" | "none";
  reasoningControl: boolean;
  localModelManagement: boolean;
  customBaseUrl: boolean;
}

/** Lucid's stable boundary. Provider SDKs and wire protocols stay behind this interface. */
export interface AiClient {
  readonly provider: string;
  readonly capabilities: Readonly<ProviderCapabilities>;
  readonly localModels?: LocalModelControl | undefined;
  chat(request: ChatRequest): Promise<ChatResult>;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
}
