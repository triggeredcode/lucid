import { describe, expect, it, vi } from "vitest";
import { commandJsonSchema } from "@lucid/core";
import { DEFAULT_LANES } from "./lanes";
import { AnthropicClient, OpenAiClient, anthropicSchema } from "./cloud";
import type { ChatRequest } from "./provider";

const schema = {
  name: "lucid_command",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { kind: { type: "string", enum: ["none"], maxLength: 20 } },
    required: ["kind"],
  },
};
const request = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  lane: { ...DEFAULT_LANES.command, model: "test-model" },
  messages: [
    { role: "system", content: "Be precise." },
    { role: "user", content: "Change this note." },
  ],
  jsonSchema: schema,
  ...over,
});
const sse = (...events: object[]): Response =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
const openaiEvents = (content = '{"kind":"none"}') =>
  sse(
    { type: "response.output_text.delta", delta: content },
    {
      type: "response.completed",
      response: {
        model: "test-model",
        usage: {
          input_tokens: 31,
          output_tokens: 8,
          output_tokens_details: { reasoning_tokens: 2 },
        },
      },
    },
  );
const anthropicEvents = (content = '{"kind":"none"}') =>
  sse(
    { type: "message_start", message: { model: "test-model", usage: { input_tokens: 31 } } },
    { type: "content_block_delta", delta: { type: "text_delta", text: content } },
    { type: "message_delta", usage: { output_tokens: 8 } },
    { type: "message_stop" },
  );

describe("native cloud provider adapters", () => {
  it.each([
    ["openai", OpenAiClient, openaiEvents],
    ["anthropic", AnthropicClient, anthropicEvents],
  ] as const)("%s streams all three Lucid lanes with exact usage", async (kind, Client, events) => {
    for (const laneName of ["input", "command", "advisor"] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(events());
      const client = new Client({ apiKey: "secret", fetch: fetcher });
      const chunks: string[] = [];
      const result = await client.chat(
        request({
          lane: { ...DEFAULT_LANES[laneName], model: "test-model" },
          jsonSchema: laneName === "input" ? undefined : schema,
          onDelta: (text) => chunks.push(text),
        }),
      );
      expect(result.content).toBe('{"kind":"none"}');
      expect(chunks).toEqual(['{"kind":"none"}']);
      expect(result.usage).toMatchObject({ prompt: 31, completion: 8, source: "provider" });
      expect(result.provider).toBe(kind);
      const call = fetcher.mock.calls[0];
      if (!call || typeof call[1]?.body !== "string") throw new Error("Expected request body");
      const [url, init] = call;
      expect(url instanceof Request ? url.url : url.toString()).toContain(
        kind === "openai" ? "/responses" : "/messages",
      );
      const body = JSON.parse(call[1].body) as Record<string, unknown>;
      expect(body.max_output_tokens ?? body.max_tokens).toBe(DEFAULT_LANES[laneName].maxTokens);
      expect(body).not.toHaveProperty("top_k");
      expect(body).not.toHaveProperty("top_p");
      expect(body).not.toHaveProperty("temperature");
      if (laneName === "input") {
        expect(body).not.toHaveProperty(kind === "openai" ? "text" : "output_config");
      } else if (kind === "openai") {
        expect(body).toMatchObject({ text: { format: { type: "json_schema", strict: true } } });
        expect(body.store).toBe(false);
      } else {
        expect(body).toMatchObject({ output_config: { format: { type: "json_schema" } } });
      }
      expect(JSON.stringify(init.headers)).toContain("secret");
    }
  });

  it("moves Anthropic system text out of the message list and strips unsupported constraints", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(anthropicEvents());
    await new AnthropicClient({ apiKey: "secret", fetch: fetcher }).chat(request());
    const payload = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof payload !== "string") throw new Error("Expected request body");
    const body = JSON.parse(payload) as Record<string, unknown>;
    expect(body.system).toBe("Be precise.");
    expect(body.messages).toEqual([{ role: "user", content: "Change this note." }]);
    expect(JSON.stringify(body.output_config)).not.toContain("maxLength");
    expect(anthropicSchema(schema.schema)).toMatchObject({
      properties: { kind: { type: "string", enum: ["none"] } },
    });
  });

  it.each([
    ["openai", OpenAiClient],
    ["anthropic", AnthropicClient],
  ] as const)("%s fails closed when a structured stream is incomplete", async (_kind, Client) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(sse({ type: "ping" }));
    await expect(new Client({ apiKey: "secret", fetch: fetcher }).chat(request())).rejects.toThrow(
      /did not complete/,
    );
  });

  it("does not echo provider error bodies that may contain credentials or note text", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("secret Change this note.", { status: 401 }));
    await expect(
      new OpenAiClient({ apiKey: "secret", fetch: fetcher }).chat(request()),
    ).rejects.toThrow(/Check the API key/);
    await expect(
      new OpenAiClient({ apiKey: "secret", fetch: fetcher }).chat(request()),
    ).rejects.not.toThrow(/secret Change this note/);
  });

  it.each([
    [OpenAiClient, "openai"],
    [AnthropicClient, "anthropic"],
  ] as const)(
    "%s rejects Command schema errors without an unstructured retry",
    async (Client, kind) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("secret: Change this note.", { status: 400 }));
      const client = new Client({ apiKey: "secret", fetch: fetcher });
      await expect(
        client.chat(
          request({ jsonSchema: { name: "lucid_command", schema: commandJsonSchema() } }),
        ),
      ).rejects.toThrow(/structured output schema/);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const payload = fetcher.mock.calls[0]?.[1]?.body;
      if (typeof payload !== "string") throw new Error("Expected request body");
      const body = JSON.parse(payload) as Record<string, unknown>;
      if (kind === "openai")
        expect(body).toMatchObject({ text: { format: { name: "lucid_command", strict: true } } });
      else
        expect(body).toMatchObject({ output_config: { format: { schema: { type: "object" } } } });
    },
  );

  it("rejects malformed SSE data instead of returning a partial edit", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("data: {not-json}\n\n", { status: 200 }));
    await expect(
      new OpenAiClient({ apiKey: "secret", fetch: fetcher }).chat(request()),
    ).rejects.toThrow(/malformed stream data/);
  });

  it("cancels an in-flight provider call", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("cancelled"));
          });
        }),
    );
    const pending = new AnthropicClient({ apiKey: "secret", fetch: fetcher }).chat(
      request({ signal: controller.signal }),
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "Aborted" });
  });
});
