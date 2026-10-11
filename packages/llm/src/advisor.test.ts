import { FORMATS } from "@lucid/kit";
import { startMockLmStudio, type Behaviour, type MockLmStudio } from "@lucid/mock-lmstudio";
import { afterEach, describe, expect, it } from "vitest";
import { runAdvisor, titleFrom } from "./advisor";
import { LmStudioClient } from "./client";
import {
  ADVISOR_EXAMPLES,
  advisorJsonSchema,
  advisorSystemPrompt,
  buildAdvisorMessages,
} from "./prompts/advisor";

let mock: MockLmStudio | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const reply = (content: string): Behaviour => ({ kind: "reply", content, chunkChars: 200 });
async function advise(description: string, script: Behaviour[]) {
  mock = await startMockLmStudio({ script });
  return runAdvisor(description, { client: new LmStudioClient({ baseUrl: mock.url }) });
}

describe("the advisor prompt", () => {
  it("lists every format with its description and asks for one of the ids, as strict JSON", () => {
    const text = advisorSystemPrompt();
    for (const f of FORMATS) {
      expect(text).toContain(`- ${f.id}: ${f.name}.`);
      expect(text).toContain(f.description);
    }
    const schema = advisorJsonSchema() as { properties: { formatId: { enum: string[] } } };
    expect(schema.properties.formatId.enum).toEqual(FORMATS.map((f) => f.id));
  });

  it("shows its examples as turns and ends with the description", () => {
    const messages = buildAdvisorMessages("  SQL vs NoSQL  ");
    expect(messages).toHaveLength(2 + ADVISOR_EXAMPLES.length * 2);
    expect(messages.at(-1)).toEqual({ role: "user", content: "DESCRIPTION:\nSQL vs NoSQL" });
    for (const ex of ADVISOR_EXAMPLES)
      expect(FORMATS.some((f) => f.id === ex.answer.formatId)).toBe(true);
  });
});

describe("runAdvisor", () => {
  it("takes the model's choice and its title", async () => {
    const a = await advise("SQL versus NoSQL for sessions", [
      reply(
        JSON.stringify({
          formatId: "comparison",
          title: "SQL vs NoSQL for sessions",
          reason: "Two options compared.",
        }),
      ),
    ]);
    expect(a).toEqual({
      formatId: "comparison",
      title: "SQL vs NoSQL for sessions",
      reason: "Two options compared.",
      source: "model",
    });
    expect(mock?.requests[0]?.body).toMatchObject({ reasoning_effort: "none" });
  });

  it("falls back to the keywords when the model names a format that does not exist or answers badly", async () => {
    const wrong = await advise("benchmarking qwen vs gemma tok/s", [
      reply(JSON.stringify({ formatId: "essay", title: "x", reason: "y" })),
    ]);
    expect(wrong).toMatchObject({ formatId: "benchmark", source: "keywords" });
    expect(wrong.fallbackBecause).toContain("does not exist");
    const junk = await advise("design a URL shortener", [reply("not json")]);
    expect(junk).toMatchObject({
      formatId: "system-design",
      source: "keywords",
      title: "Design a URL shortener",
    });
    const shape = await advise("consistent hashing", [
      reply(JSON.stringify({ formatId: "concept-note" })),
    ]);
    expect(shape).toMatchObject({
      source: "keywords",
      fallbackBecause: "the answer was not in the expected shape",
    });
  });

  it("falls back when LM Studio cannot be reached or has no model loaded, without throwing", async () => {
    mock = await startMockLmStudio({ models: [] });
    const a = await runAdvisor("how does raft elect a leader", {
      client: new LmStudioClient({ baseUrl: mock.url }),
    });
    expect(a).toMatchObject({ formatId: "concept-note", source: "keywords" });
    expect(a.fallbackBecause).toBeTruthy();
    const down = await runAdvisor("SQL vs NoSQL", {
      client: new LmStudioClient({ baseUrl: "http://127.0.0.1:9" }),
    });
    expect(down).toMatchObject({ formatId: "comparison", source: "keywords" });
  });

  it("does not ask the model about nothing", async () => {
    const a = await advise("   ", []);
    expect(a).toMatchObject({
      source: "keywords",
      title: "Untitled",
      fallbackBecause: "nothing was said",
    });
    expect(mock?.requests).toHaveLength(0);
  });
});

describe("titleFrom", () => {
  it("takes the first eight words, capitalised, without the final full stop", () => {
    expect(titleFrom("notes on how paged attention saves KV cache memory in vLLM.")).toBe(
      "Notes on how paged attention saves KV cache",
    );
    expect(titleFrom("")).toBe("Untitled");
  });
});
