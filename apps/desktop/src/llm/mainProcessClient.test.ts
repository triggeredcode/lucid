import { describe, expect, it, vi } from "vitest";
import { LlmError, type ChatRequest } from "@lucid/llm";
import type {
  AiEvent,
  AiStartRequest,
  AiStartResult,
  ProviderConnectionResult,
  ProviderProfile,
} from "../../electron/ipc/types";
import { MainProcessAiClient, type MainAiTransport } from "./mainProcessClient";

const profile: ProviderProfile = {
  id: "lmstudio",
  name: "LM Studio",
  kind: "lmstudio",
  baseUrl: "http://127.0.0.1:1234",
  model: "local/model",
};
const request: ChatRequest = {
  messages: [{ role: "user", content: "hello" }],
  lane: {
    model: "local/model",
    temperature: 0.1,
    topP: 0.9,
    topK: 20,
    presencePenalty: 0,
    maxTokens: 200,
  },
};
const completion = {
  usage: { prompt: 2, completion: 2, reasoning: 0, source: "provider" as const },
  characters: { request: 5, response: 11 },
  timings: { sentAt: 1, firstTokenAt: 2, doneAt: 3 },
  model: "local/model",
  provider: "lmstudio",
  repairAttempts: 0,
};

function controlledTransport() {
  let listener: ((event: AiEvent) => void) | undefined;
  const unsubscribe = vi.fn();
  const start = vi.fn<(request: AiStartRequest) => Promise<AiStartResult>>();
  start.mockResolvedValue({ ok: true });
  const abort = vi.fn<(id: number) => Promise<void>>();
  abort.mockResolvedValue(undefined);
  const onEvent = vi.fn((next: (event: AiEvent) => void) => {
    listener = next;
    return unsubscribe;
  });
  const models = vi.fn<(providerId: string) => Promise<ProviderConnectionResult>>();
  models.mockResolvedValue({ ok: true, message: "Connected.", models: ["b", "a"] });
  const transport: MainAiTransport = {
    start,
    abort,
    onEvent,
    models,
  };
  return {
    transport,
    start,
    abort,
    models,
    unsubscribe,
    emit: (event: AiEvent) => {
      listener?.(event);
    },
  };
}

describe("MainProcessAiClient", () => {
  it("forwards structured controls and reconstructs ordered streamed content", async () => {
    const { transport, start, unsubscribe, emit } = controlledTransport();
    const onDelta = vi.fn();
    const client = new MainProcessAiClient(profile, transport);
    const promise = client.chat({
      ...request,
      onDelta,
      jsonSchema: { name: "answer", schema: { type: "object" } },
      reasoning: "none",
    });
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledOnce();
    });
    const sent = start.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      providerId: "lmstudio",
      model: "local/model",
      messages: request.messages,
      lane: {
        temperature: 0.1,
        topP: 0.9,
        topK: 20,
        presencePenalty: 0,
        maxTokens: 200,
      },
      jsonSchema: { name: "answer", schema: { type: "object" } },
      reasoning: "none",
    });
    emit({ id: sent?.id ?? -1, type: "delta", text: "hello " });
    emit({ id: sent?.id ?? -1, type: "delta", text: "world" });
    emit({ id: sent?.id ?? -1, type: "complete", result: completion });
    await expect(promise).resolves.toEqual({ content: "hello world", ...completion });
    expect(onDelta.mock.calls.flat()).toEqual(["hello ", "world"]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("turns a rejected start into a user-facing LLM error and cleans up", async () => {
    const { transport, start, unsubscribe } = controlledTransport();
    start.mockResolvedValue({ ok: false, message: "LM Studio is offline." });
    const promise = new MainProcessAiClient(profile, transport).chat(request);
    await expect(promise).rejects.toBeInstanceOf(LlmError);
    await expect(promise).rejects.toMatchObject({
      code: "LmUnreachable",
      message: "LM Studio is offline.",
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("propagates known provider errors and maps unknown codes safely", async () => {
    const { transport, start, emit } = controlledTransport();
    const client = new MainProcessAiClient(profile, transport);
    const known = client.chat(request);
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledTimes(1);
    });
    const knownId = start.mock.calls[0]?.[0].id ?? -1;
    emit({ id: knownId, type: "error", code: "ModelNotLoaded", message: "Load it first." });
    await expect(known).rejects.toMatchObject({ code: "ModelNotLoaded" });

    const unknown = client.chat(request);
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledTimes(2);
    });
    const unknownId = start.mock.calls[1]?.[0].id ?? -1;
    emit({ id: unknownId, type: "error", code: "ProviderError", message: "Bad reply." });
    await expect(unknown).rejects.toMatchObject({ code: "BadResponse" });
  });

  it("aborts main exactly once and removes its listener", async () => {
    const { transport, start, abort, unsubscribe } = controlledTransport();
    const controller = new AbortController();
    const promise = new MainProcessAiClient(profile, transport).chat({
      ...request,
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledOnce();
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "Aborted", message: "Cancelled." });
    expect(abort).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("uses the main-process model discovery result for health", async () => {
    const { transport, models } = controlledTransport();
    await expect(new MainProcessAiClient(profile, transport).health()).resolves.toEqual({
      reachable: true,
      models: ["b", "a"],
    });
    expect(models).toHaveBeenCalledWith("lmstudio");
  });

  it("declares Ollama structured output without claiming reasoning controls", () => {
    const ollama = new MainProcessAiClient(
      {
        id: "ollama",
        name: "Ollama",
        kind: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen3:8b",
      },
      controlledTransport().transport,
    );
    expect(ollama.provider).toBe("ollama");
    expect(ollama.capabilities).toMatchObject({
      structuredOutput: "json-schema",
      usage: "provider-or-estimated",
      reasoningControl: false,
    });
  });
});
