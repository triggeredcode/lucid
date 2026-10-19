import { describe, expect, it } from "vitest";
import { LlmError } from "./errors";
import { DEFAULT_LANES } from "./lanes";
import { OllamaClient } from "./ollama";

const lane = { ...DEFAULT_LANES.input, model: "qwen3:8b" };
const messages = [{ role: "user" as const, content: "hello" }];

const failure = async (promise: Promise<unknown>): Promise<LlmError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LlmError) return error;
    throw error;
  }
  throw new Error("expected a failure");
};

const fetchWith =
  (handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch =>
  (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(url, init));
  };

const stream = (...chunks: object[]): Response =>
  new Response(chunks.map((chunk) => JSON.stringify(chunk)).join("\n"), {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });

describe("OllamaClient", () => {
  it("advertises the native local API capabilities honestly", () => {
    const client = new OllamaClient();
    expect(client.provider).toBe("ollama");
    expect(client.capabilities).toEqual({
      streaming: true,
      cancellation: true,
      structuredOutput: "json-schema",
      modelDiscovery: true,
      usage: "provider-or-estimated",
      reasoningControl: false,
      localModelManagement: false,
      customBaseUrl: true,
    });
  });

  it("discovers installed models from the tags endpoint", async () => {
    const urls: string[] = [];
    const client = new OllamaClient({
      fetch: fetchWith((url) => {
        urls.push(url);
        return Response.json({
          models: [{ model: "qwen3:8b" }, { name: "gemma3:4b" }, { name: "remote:cloud" }],
        });
      }),
    });
    await expect(client.health()).resolves.toEqual({
      reachable: true,
      models: ["qwen3:8b", "gemma3:4b"],
    });
    expect(urls).toEqual(["http://127.0.0.1:11434/api/tags"]);
  });

  it("streams content and maps schema, sampling, timing, and provider usage", async () => {
    let sent: unknown;
    const deltas: string[] = [];
    const schema = { type: "object", properties: { answer: { type: "string" } } };
    const client = new OllamaClient({
      baseUrl: "http://localhost:11434/",
      fetch: fetchWith((_url, init) => {
        if (typeof init?.body !== "string") throw new Error("expected a JSON request body");
        sent = JSON.parse(init.body) as unknown;
        return stream(
          { model: "qwen3:8b", message: { content: '{"answer":' }, done: false },
          {
            model: "qwen3:8b",
            message: { content: '"yes"}' },
            done: true,
            prompt_eval_count: 12,
            eval_count: 4,
          },
        );
      }),
    });
    const result = await client.chat({
      lane,
      messages,
      jsonSchema: { name: "answer", schema },
      onDelta: (delta) => deltas.push(delta),
    });
    expect(result).toMatchObject({
      content: '{"answer":"yes"}',
      provider: "ollama",
      model: "qwen3:8b",
      usage: { prompt: 12, completion: 4, reasoning: 0, source: "provider" },
      repairAttempts: 0,
    });
    expect(result.timings.firstTokenAt).not.toBeNull();
    expect(deltas.join("")).toBe(result.content);
    expect(sent).toMatchObject({
      model: "qwen3:8b",
      messages,
      stream: true,
      think: false,
      format: schema,
      options: {
        temperature: lane.temperature,
        top_p: lane.topP,
        top_k: lane.topK,
        num_predict: lane.maxTokens,
      },
    });
  });

  it("marks usage as estimated when Ollama omits counts", async () => {
    const client = new OllamaClient({
      fetch: fetchWith(() => stream({ message: { content: "hello" }, done: true })),
    });
    const result = await client.chat({ lane, messages });
    expect(result.usage.source).toBe("estimated");
    expect(result.usage.prompt).toBeGreaterThan(0);
    expect(result.usage.completion).toBeGreaterThan(0);
  });

  it("gives actionable missing-model errors", async () => {
    const client = new OllamaClient({
      fetch: fetchWith(() => Response.json({ error: "model not found" }, { status: 404 })),
    });
    const error = await failure(client.chat({ lane, messages }));
    expect(error.code).toBe("ModelNotLoaded");
    expect(error.message).toContain("ollama pull qwen3:8b");
  });

  it("rejects Ollama Cloud aliases before making a local-profile request", async () => {
    let requested = false;
    const client = new OllamaClient({
      fetch: fetchWith(() => {
        requested = true;
        return stream();
      }),
    });
    const error = await failure(
      client.chat({ lane: { ...lane, model: "remote:cloud" }, messages }),
    );
    expect(error.code).toBe("BadResponse");
    expect(error.message).toContain("Ollama Cloud");
    expect(requested).toBe(false);
  });

  it("fails safely when structured output is rejected", async () => {
    const client = new OllamaClient({
      fetch: fetchWith(() => Response.json({ error: "invalid format" }, { status: 400 })),
    });
    const error = await failure(
      client.chat({
        lane,
        messages,
        jsonSchema: { name: "answer", schema: { type: "object" } },
      }),
    );
    expect(error.code).toBe("BadResponse");
    expect(error.message).toContain("structured output");
    expect(error.message).toContain("Command Mode");
  });

  it("reports NDJSON errors and truncated streams", async () => {
    const midstream = new OllamaClient({
      fetch: fetchWith(() => stream({ message: { content: "half" } }, { error: "out of memory" })),
    });
    expect((await failure(midstream.chat({ lane, messages }))).message).toContain("out of memory");

    const truncated = new OllamaClient({
      fetch: fetchWith(() => stream({ message: { content: "half" }, done: false })),
    });
    expect((await failure(truncated.chat({ lane, messages }))).code).toBe("ConnectionLost");
  });

  it("supports cancellation before a request and while waiting for the first token", async () => {
    const early = new AbortController();
    early.abort();
    const client = new OllamaClient({ fetch: fetchWith(() => stream()) });
    expect((await failure(client.chat({ lane, messages, signal: early.signal }))).code).toBe(
      "Aborted",
    );

    const later = new AbortController();
    const waiting = new OllamaClient({
      fetch: fetchWith(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      ),
    }).chat({ lane, messages, signal: later.signal });
    later.abort();
    expect((await failure(waiting)).code).toBe("Aborted");
  });

  it("stops an active stream when cancelled after a delta", async () => {
    const controller = new AbortController();
    const client = new OllamaClient({
      fetch: fetchWith((_url, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(streamController) {
            streamController.enqueue(
              new TextEncoder().encode('{"message":{"content":"first"},"done":false}\n'),
            );
            init?.signal?.addEventListener("abort", () => {
              streamController.error(new DOMException("aborted", "AbortError"));
            });
          },
        });
        return new Response(body);
      }),
    });
    const error = await failure(
      client.chat({
        lane,
        messages,
        signal: controller.signal,
        onDelta: () => {
          controller.abort();
        },
      }),
    );
    expect(error.code).toBe("Aborted");
  });

  it("classifies a first-token timeout", async () => {
    const client = new OllamaClient({
      firstTokenTimeoutMs: 5,
      requestTimeoutMs: 100,
      fetch: fetchWith(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      ),
    });
    expect((await failure(client.chat({ lane, messages }))).code).toBe("FirstTokenTimeout");
  });
});
