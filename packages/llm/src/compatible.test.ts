import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleClient } from "./cloud";
import { DEFAULT_LANES } from "./lanes";
import type { ChatRequest } from "./provider";

const request = (schema = false): ChatRequest => ({
  lane: { ...DEFAULT_LANES.command, model: "example/model" },
  messages: [{ role: "user", content: "Reply briefly." }],
  ...(schema
    ? {
        jsonSchema: {
          name: "lucid_answer",
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
            additionalProperties: false,
          },
        },
      }
    : {}),
});

const stream = (answer = '{"answer":"yes"}'): Response =>
  new Response(
    [
      `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );

describe("OpenAI-compatible hosted endpoints", () => {
  it("requires OpenRouter endpoints to honor the JSON Schema parameter", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(stream());
    const client = new OpenAiCompatibleClient({
      kind: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "secret",
      fetch: fetcher,
    });
    const deltas: string[] = [];
    const result = await client.chat({ ...request(true), onDelta: (piece) => deltas.push(piece) });
    expect(result.content).toBe('{"answer":"yes"}');
    expect(deltas).toEqual(['{"answer":"yes"}']);
    expect(result.usage).toMatchObject({ prompt: 12, completion: 7, source: "provider" });
    const call = fetcher.mock.calls[0];
    if (!call || typeof call[1]?.body !== "string") throw new Error("Expected request body");
    expect(call[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(call[1].body) as Record<string, unknown>;
    expect(body).toMatchObject({
      response_format: { type: "json_schema", json_schema: { name: "lucid_answer", strict: true } },
      provider: { require_parameters: true },
      stream_options: { include_usage: true },
    });
    expect(body).not.toHaveProperty("models");
    expect(client.capabilities.structuredOutput).toBe("native");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("lets custom endpoints use optional bearer authentication and manual models", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(stream("hello"));
    const client = new OpenAiCompatibleClient({
      kind: "custom",
      baseUrl: "https://llm.example.test/v1",
      fetch: fetcher,
    });
    expect((await client.chat(request())).content).toBe("hello");
    expect(JSON.stringify(fetcher.mock.calls[0]?.[1]?.headers)).not.toContain("Authorization");
    const payload = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof payload !== "string") throw new Error("Expected request body");
    expect(JSON.parse(payload)).not.toHaveProperty("stream_options");
    expect(client.capabilities.customBaseUrl).toBe(true);
    expect(client.capabilities.structuredOutput).toBe("prompted");
  });

  it("allows Ollama Cloud Input but blocks Command and Advisor before a network request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(stream("hello"));
    const client = new OpenAiCompatibleClient({
      kind: "ollama-cloud",
      baseUrl: "https://ollama.com/v1",
      apiKey: "secret",
      fetch: fetcher,
    });
    expect(client.capabilities.structuredOutput).toBe("unavailable");
    await expect(client.chat(request(true))).rejects.toThrow(/does not support JSON Schema/);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await client.chat(request())).content).toBe("hello");
  });

  it("discovers Ollama Cloud models through its native tags endpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ models: [{ model: "gemma4:31b" }] }), { status: 200 }),
      );
    const client = new OpenAiCompatibleClient({
      kind: "ollama-cloud",
      baseUrl: "https://ollama.com/v1",
      apiKey: "secret",
      fetch: fetcher,
    });
    expect(await client.health()).toEqual({ reachable: true, models: ["gemma4:31b"] });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://ollama.com/api/tags");
  });

  it("does not accept a truncated or failed stream as a completed edit", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
    const client = new OpenAiCompatibleClient({
      kind: "custom",
      baseUrl: "https://llm.example.test/v1",
      fetch: fetcher,
    });
    await expect(client.chat(request(true))).rejects.toThrow(/did not complete/);
  });

  it("times out before the first token with no alternate-provider request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const client = new OpenAiCompatibleClient({
      kind: "custom",
      baseUrl: "https://llm.example.test/v1",
      fetch: fetcher,
      firstTokenTimeoutMs: 10,
      requestTimeoutMs: 100,
    });
    await expect(client.chat(request())).rejects.toMatchObject({ code: "FirstTokenTimeout" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
