import { describe, expect, it } from "vitest";
import { DEFAULT_LANES } from "./lanes";
import { OllamaClient } from "./ollama";

/** Run with LUCID_OLLAMA_LIVE=1 against an installed local model. */
const live = process.env["LUCID_OLLAMA_LIVE"] === "1";
const model = process.env["OLLAMA_TEST_MODEL"] ?? "gemma3:1b";
const client = new OllamaClient({
  baseUrl: process.env["OLLAMA_URL"] ?? "http://127.0.0.1:11434",
});

describe.skipIf(!live)("Ollama native API smoke", () => {
  it("discovers the selected model and runs Input, Command, and Advisor controls", async () => {
    const health = await client.health();
    expect(health.reachable).toBe(true);
    expect(health.models).toContain(model);

    const input = await client.chat({
      lane: { ...DEFAULT_LANES.input, model, maxTokens: 30 },
      messages: [{ role: "user", content: "Say hello briefly." }],
    });
    expect(input.content.trim()).not.toBe("");

    const deltas: string[] = [];
    for (const lane of [DEFAULT_LANES.command, DEFAULT_LANES.advisor]) {
      const result = await client.chat({
        lane: { ...lane, model, maxTokens: 80 },
        messages: [{ role: "user", content: 'Reply with JSON: {"answer":"yes"}.' }],
        jsonSchema: {
          name: "ollama_smoke",
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
            additionalProperties: false,
          },
        },
        onDelta: (piece) => deltas.push(piece),
      });
      expect(result.provider).toBe("ollama");
      expect(result.usage.prompt).toBeGreaterThan(0);
      expect(result.usage.completion).toBeGreaterThan(0);
      expect(result.content).toBe(deltas.join(""));
      const parsed = JSON.parse(result.content) as unknown;
      expect(
        parsed !== null &&
          typeof parsed === "object" &&
          "answer" in parsed &&
          typeof parsed.answer === "string",
      ).toBe(true);
      deltas.length = 0;
    }
  }, 120_000);
});
