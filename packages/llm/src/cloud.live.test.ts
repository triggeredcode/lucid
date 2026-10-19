import { describe, expect, it } from "vitest";
import { AnthropicClient, OpenAiClient } from "./cloud";
import { DEFAULT_LANES } from "./lanes";

/** Opt-in, billable smoke tests. Set both a key and model for only the provider under test. */
const cases = [
  {
    name: "OpenAI",
    key: process.env["LUCID_OPENAI_TEST_KEY"],
    model: process.env["LUCID_OPENAI_TEST_MODEL"],
    create: (key: string) => new OpenAiClient({ apiKey: key }),
  },
  {
    name: "Anthropic",
    key: process.env["LUCID_ANTHROPIC_TEST_KEY"],
    model: process.env["LUCID_ANTHROPIC_TEST_MODEL"],
    create: (key: string) => new AnthropicClient({ apiKey: key }),
  },
] as const;

for (const provider of cases) {
  describe.skipIf(!provider.key || !provider.model)(`${provider.name} live API smoke`, () => {
    it("runs Input, Command, and Advisor response shapes", async () => {
      const client = provider.create(provider.key ?? "");
      const model = provider.model ?? "";
      const input = await client.chat({
        lane: { ...DEFAULT_LANES.input, model, maxTokens: 80 },
        messages: [{ role: "user", content: "Reply with a short greeting." }],
      });
      expect(input.content.trim()).not.toBe("");
      for (const lane of [DEFAULT_LANES.command, DEFAULT_LANES.advisor]) {
        const result = await client.chat({
          lane: { ...lane, model, maxTokens: 120 },
          messages: [{ role: "user", content: 'Reply with JSON: {"answer":"yes"}.' }],
          jsonSchema: {
            name: "lucid_smoke",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: { answer: { type: "string" } },
              required: ["answer"],
            },
          },
        });
        expect(JSON.parse(result.content)).toMatchObject({ answer: "yes" });
      }
    }, 120_000);
  });
}
