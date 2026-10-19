import type { AiClient } from "@lucid/llm";
import { describe, expect, it, vi } from "vitest";
import type { AiEvent, AiStartRequest } from "../ipc/types";
import { MainAiService } from "./service";

const request: AiStartRequest = {
  id: 7,
  providerId: "test",
  model: "model",
  messages: [{ role: "user", content: "hello" }],
  lane: { temperature: 0, topP: 1, topK: 20, presencePenalty: 0, maxTokens: 100 },
};

const client = (chat: AiClient["chat"]): AiClient => ({
  provider: "test",
  capabilities: {
    streaming: true,
    cancellation: true,
    structuredOutput: "native",
    modelDiscovery: false,
    usage: "estimated",
    reasoningControl: false,
    localModelManagement: false,
    customBaseUrl: false,
  },
  chat,
  health: () => Promise.resolve({ reachable: true, models: [] }),
});

describe("MainAiService", () => {
  it("streams deltas and a secret-free completion through narrow events", async () => {
    const emit = vi.fn<(event: AiEvent) => void>();
    const service = new MainAiService(() =>
      Promise.resolve({
        endpoint: "https://api.example.test/v1",
        client: client(({ onDelta }) => {
          onDelta?.("hello");
          return Promise.resolve({
            content: "hello",
            usage: { prompt: 2, completion: 1, reasoning: 0, source: "estimated" },
            characters: { request: 5, response: 5 },
            timings: { sentAt: 1, firstTokenAt: 2, doneAt: 3 },
            model: "model",
            provider: "test",
            repairAttempts: 0,
          });
        }),
      }),
    );
    expect(await service.start(request, emit)).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledTimes(2);
    });
    expect(emit.mock.calls[0]?.[0]).toEqual({ id: 7, type: "delta", text: "hello" });
    expect(emit.mock.calls[1]?.[0]).toMatchObject({ id: 7, type: "complete" });
    expect(emit.mock.calls[1]?.[0]).not.toHaveProperty("result.content");
  });

  it("cancels through AbortSignal and redacts provider errors", async () => {
    const emit = vi.fn<(event: AiEvent) => void>();
    const service = new MainAiService(() =>
      Promise.resolve({
        endpoint: "https://api.example.test/v1",
        secrets: ["sk-secret"],
        client: client(
          ({ signal }) =>
            new Promise((_resolve, reject) => {
              signal?.addEventListener("abort", () => {
                reject(new Error("Bearer sk-secret cancelled"));
              });
            }),
        ),
      }),
    );
    expect(await service.start(request, emit)).toEqual({ ok: true });
    service.abort(request.id);
    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledOnce();
    });
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      type: "error",
      message: "Bearer [redacted] cancelled",
    });
  });
});
