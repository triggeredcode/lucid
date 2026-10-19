import { startMockLmStudio, type MockLmStudio } from "@lucid/mock-lmstudio";
import { afterEach, describe, expect, it } from "vitest";
import { LmStudioClient } from "./client";
import { LlmError } from "./errors";
import { DEFAULT_LANES } from "./lanes";

let mock: MockLmStudio | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const lane = DEFAULT_LANES.input;
const messages = [{ role: "user" as const, content: "hello" }];

async function start(script: Parameters<typeof startMockLmStudio>[0] = {}) {
  mock = await startMockLmStudio(script);
  return { mock, client: new LmStudioClient({ baseUrl: mock.url }) };
}

const failure = async (p: Promise<unknown>): Promise<LlmError> => {
  try {
    await p;
  } catch (error) {
    if (error instanceof LlmError) return error;
    throw error;
  }
  throw new Error("expected a failure");
};

describe("chat", () => {
  it("advertises the LM Studio adapter capabilities explicitly", async () => {
    const { client } = await start();
    expect(client.provider).toBe("lmstudio");
    expect(client.capabilities).toEqual({
      streaming: true,
      cancellation: true,
      structuredOutput: "native",
      modelDiscovery: true,
      usage: "provider-or-estimated",
      reasoningControl: true,
      localModelManagement: false,
      customBaseUrl: true,
    });
    expect(client.localModels).toBeUndefined();
  });

  it("streams content, reports usage and timings, and sends the request Lucid needs", async () => {
    const { mock, client } = await start({
      script: [{ kind: "reply", content: "## Load balancer\n- one", chunkChars: 5 }],
    });
    const deltas: string[] = [];
    const result = await client.chat({ lane, messages, onDelta: (d) => deltas.push(d) });
    expect(result.content).toBe("## Load balancer\n- one");
    expect(deltas.join("")).toBe(result.content);
    expect(deltas.length).toBeGreaterThan(2);
    expect(result.usage.completion).toBeGreaterThan(0);
    expect(result.usage.reasoning).toBe(0);
    expect(result.usage.source).toBe("provider");
    expect(result.characters.request).toBeGreaterThan(0);
    expect(result.characters.response).toBe(result.content.length);
    expect(result.repairAttempts).toBe(0);
    expect(result.timings.firstTokenAt).not.toBeNull();
    expect(result.timings.doneAt).toBeGreaterThanOrEqual(result.timings.sentAt);

    const body = mock.requests[0]?.body;
    expect(body).toMatchObject({
      model: lane.model,
      stream: true,
      reasoning_effort: "none",
      temperature: lane.temperature,
      max_tokens: lane.maxTokens,
      stream_options: { include_usage: true },
    });
    expect(body).not.toHaveProperty("response_format");
  });

  it("labels estimated usage when the provider omits token counts", async () => {
    const { client } = await start({
      script: [{ kind: "reply", content: "estimated response", includeUsage: false }],
    });
    const result = await client.chat({ lane, messages });
    expect(result.usage.source).toBe("estimated");
    expect(result.usage.prompt).toBeGreaterThan(0);
    expect(result.usage.completion).toBeGreaterThan(0);
  });

  it("asks for strict structured output when a schema is given", async () => {
    const { mock, client } = await start({
      script: [{ kind: "reply", content: '{"kind":"none","reason":"x"}' }],
    });
    const schema = { type: "object", properties: { kind: { type: "string" } } };
    await client.chat({
      lane,
      messages,
      jsonSchema: { name: "lucid_command", schema },
      reasoning: "low",
    });
    expect(mock.requests[0]?.body["response_format"]).toEqual({
      type: "json_schema",
      json_schema: { name: "lucid_command", strict: true, schema },
    });
    expect(mock.requests[0]?.body["reasoning_effort"]).toBe("low");
  });

  it("retries a reasoning leak once and succeeds", async () => {
    const { mock, client } = await start({
      script: [{ kind: "empty-with-reasoning" }, { kind: "reply", content: "ok" }],
    });
    const result = await client.chat({ lane, messages });
    expect(result.content).toBe("ok");
    expect(result.repairAttempts).toBe(1);
    expect(mock.requests).toHaveLength(2);
  });

  it("gives up on a second reasoning leak", async () => {
    const { mock, client } = await start({ script: [{ kind: "empty-with-reasoning" }] });
    expect((await failure(client.chat({ lane, messages }))).code).toBe("ReasoningLeak");
    expect(mock.requests).toHaveLength(2);
  });

  it("says when no model is loaded, and when the wrong model is asked for", async () => {
    const none = await start({ models: [] });
    expect((await failure(none.client.chat({ lane, messages }))).code).toBe("ModelNotLoaded");
    await none.mock.close();

    const wrong = await start({ models: ["other/model"] });
    const error = await failure(wrong.client.chat({ lane, messages }));
    expect(error.code).toBe("ModelNotLoaded");
    expect(error.message).toContain(lane.model);
  });

  it("reports other HTTP errors with LM Studio's own message", async () => {
    const { client } = await start({
      script: [{ kind: "http-error", status: 500, message: "out of memory" }],
    });
    const error = await failure(client.chat({ lane, messages }));
    expect(error.code).toBe("BadResponse");
    expect(error.message).toContain("out of memory");
  });

  it("reports a dropped connection and keeps what arrived out of the result", async () => {
    const { client } = await start({
      script: [{ kind: "drop", content: "## Half an ans", afterChars: 9 }],
    });
    expect((await failure(client.chat({ lane, messages }))).code).toBe("ConnectionLost");
  });

  it("times out when the first token takes too long", async () => {
    mock = await startMockLmStudio({
      script: [{ kind: "slow-first-token", ms: 600, content: "late" }],
    });
    const client = new LmStudioClient({ baseUrl: mock.url, firstTokenTimeoutMs: 150 });
    expect((await failure(client.chat({ lane, messages }))).code).toBe("FirstTokenTimeout");
  });

  it("times out an answer that never finishes", async () => {
    mock = await startMockLmStudio({
      script: [{ kind: "reply", content: "x".repeat(400), chunkChars: 2, delayMs: 20 }],
    });
    const client = new LmStudioClient({ baseUrl: mock.url, requestTimeoutMs: 150 });
    expect((await failure(client.chat({ lane, messages }))).code).toBe("Timeout");
  });

  it("can be cancelled, before and during an answer", async () => {
    const { client } = await start({
      script: [{ kind: "reply", content: "x".repeat(400), chunkChars: 2, delayMs: 20 }],
    });
    const early = new AbortController();
    early.abort();
    expect((await failure(client.chat({ lane, messages, signal: early.signal }))).code).toBe(
      "Aborted",
    );

    const later = new AbortController();
    const running = client.chat({
      lane,
      messages,
      signal: later.signal,
      onDelta: () => {
        later.abort();
      },
    });
    expect((await failure(running)).code).toBe("Aborted");
  });

  it("says LM Studio is unreachable when nothing is listening", async () => {
    const { mock } = await start();
    const url = mock.url;
    await mock.close();
    const dead = new LmStudioClient({ baseUrl: url });
    expect((await failure(dead.chat({ lane, messages }))).code).toBe("LmUnreachable");
  });

  it("uses the fetch it was given", async () => {
    const { mock } = await start({ script: [{ kind: "reply", content: "via custom fetch" }] });
    const urls: string[] = [];
    const client = new LmStudioClient({
      baseUrl: mock.url,
      fetch: (input, init) => {
        urls.push(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        return fetch(input, init);
      },
    });
    expect((await client.chat({ lane, messages })).content).toBe("via custom fetch");
    expect(urls).toEqual([`${mock.url}/v1/chat/completions`]);
  });
});

describe("health", () => {
  it("lists loaded models", async () => {
    const { client } = await start({ models: ["qwen/qwen3.8-27b"] });
    expect(await client.health()).toEqual({ reachable: true, models: ["qwen/qwen3.8-27b"] });
  });

  it("reports reachable with no model loaded", async () => {
    const { client } = await start({ models: [] });
    expect(await client.health()).toEqual({ reachable: true, models: [] });
  });

  it("reports unreachable without throwing", async () => {
    const { mock } = await start();
    const url = mock.url;
    await mock.close();
    expect(await new LmStudioClient({ baseUrl: url }).health()).toEqual({
      reachable: false,
      models: [],
    });
  });
});
