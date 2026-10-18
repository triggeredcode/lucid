import { LmStudioClient } from "@lucid/llm";
import { startMockLmStudio, type Behaviour, type MockLmStudio } from "@lucid/mock-lmstudio";
import { afterEach, describe, expect, it } from "vitest";
import { runTrial, trialsOf } from "./run";
import type { Case } from "./types";

let mock: MockLmStudio | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const reply = (content: string): Behaviour => ({ kind: "reply", content, chunkChars: 400 });
const command = (over: Record<string, unknown>) =>
  JSON.stringify({
    kind: "edit",
    summary: null,
    ops: null,
    question: null,
    options: null,
    reason: null,
    ...over,
  });

async function trial(c: Case, script: Behaviour[], utterance = c.utterance) {
  mock = await startMockLmStudio({ script });
  const client = new LmStudioClient({ baseUrl: mock.url });
  return runTrial(c, utterance, 0, { client });
}

const loadBalancer: Case = {
  id: "t-input",
  category: "input_structure",
  mode: "input",
  doc: "empty",
  utterance: "Load balancer. Multiple servers behind it. Health checks.",
  expect: {
    doc: {
      hasHeading: [{ text: "load balancer" }],
      listItems: ["health checks"],
      blockCounts: { diagram: { eq: 0 }, table: { eq: 0 } },
    },
  },
};

const addCdn: Case = {
  id: "t-cdn",
  category: "diagram_edit",
  mode: "command",
  doc: "request-flow",
  focus: "diagram",
  utterance: "Add a CDN in front of the web server.",
  expect: {
    touchedOnly: ["diagram"],
    graph: {
      hasNodes: ["CDN"],
      hasEdges: [
        { from: "client", to: "cdn" },
        { from: "cdn", to: "web server" },
      ],
    },
  },
};

describe("runTrial", () => {
  it("runs the Input lane and judges the page after the notes", async () => {
    const t = await trial(loadBalancer, [
      reply(
        "## Load Balancer\nIt sits in front of **multiple servers**.\n- **Health checks** drop unhealthy servers.",
      ),
    ]);
    expect(t).toMatchObject({ pass: true, outcome: "applied", failures: [], variant: 0 });
    expect(t.raw).toContain("Load Balancer");
    expect(t.outputTokens).toBeGreaterThan(0);
    expect(t).toMatchObject({
      tokenSource: "provider",
      modelCalls: 1,
      repairCalls: 0,
      affectedBlocks: 3,
      provider: "lmstudio",
    });
    expect(t.firstTokenMs).not.toBeNull();
  });

  it("fails with the reasons when the notes are not what was expected", async () => {
    const t = await trial(loadBalancer, [reply("Just a sentence about balancing.")]);
    expect(t.pass).toBe(false);
    expect(t.failures.join("\n")).toContain('no heading like "load balancer"');
    expect(t.failures.join("\n")).toContain('no list item with "health checks"');
  });

  it("runs the Command lane with the cursor on the focus block, and checks the changed page", async () => {
    const ok = await trial(addCdn, [
      reply(
        command({
          summary: "Added a CDN",
          ops: [
            {
              op: "graph.insert_between",
              target: "b3",
              from: "client",
              to: "web",
              node: "cdn [cdn]: CDN",
              labels: null,
            },
          ],
        }),
      ),
    ]);
    expect(ok).toMatchObject({ pass: true, outcome: "edit", summary: "Added a CDN" });
    expect(ok).toMatchObject({ affectedBlocks: 1, unrelatedBlocksModified: 0 });
    const body = mock?.requests[0]?.body;
    const last = (body?.["messages"] as { content: string }[]).at(-1)?.content ?? "";
    expect(last).toContain("FOCUS");
    expect(last).toContain("Add a CDN in front of the web server.");
  });

  it("records a question or a refusal as the outcome, and judges that", async () => {
    const asked: Case = {
      ...addCdn,
      id: "t-ask",
      category: "ambiguity_clarify",
      doc: "two-tables",
      focus: undefined as never,
      utterance: "Add a row for cost.",
      expect: { outcome: "clarify", clarifyOptionsMin: 2 },
    };
    const t = await trial(asked, [
      reply(
        command({
          kind: "clarify",
          question: "Which table?",
          options: [
            { label: "SQL vs NoSQL", ref: "b2" },
            { label: "Kafka vs SQS", ref: "b3" },
          ],
        }),
      ),
    ]);
    expect(t).toMatchObject({ pass: true, outcome: "clarify" });
    const wrong = await trial({ ...asked, expect: { outcome: "edit" } }, [
      reply(
        command({
          kind: "clarify",
          question: "Which?",
          options: [
            { label: "a", ref: null },
            { label: "b", ref: null },
          ],
        }),
      ),
    ]);
    expect(wrong.failures).toEqual(['expected the outcome "edit", got "clarify"']);
  });

  it("turns a pipeline failure into a failed trial instead of stopping the run", async () => {
    const t = await trial(loadBalancer, [{ kind: "http-error", status: 500, message: "boom" }]);
    expect(t).toMatchObject({ pass: false, outcome: "error" });
    expect(t.error).toBeTruthy();
  });
});

describe("runTrial, advisor and format pages", () => {
  const pick: Case = {
    id: "t-pick",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "SQL versus NoSQL for sessions",
    expect: { formatId: "comparison" },
  };

  it("asks the advisor and judges the format it chose", async () => {
    const good = await trial(pick, [
      reply(
        JSON.stringify({ formatId: "comparison", title: "SQL vs NoSQL", reason: "Two options." }),
      ),
    ]);
    expect(good).toMatchObject({ pass: true, outcome: "advice" });
    expect(good).toMatchObject({ modelCalls: 1, tokenSource: "provider" });
    const bad = await trial(pick, [
      reply(JSON.stringify({ formatId: "system-design", title: "x", reason: "y" })),
    ]);
    expect(bad.failures).toEqual(["expected the format comparison, got system-design"]);
  });

  it("tells the Input lane the page's format, and judges where the notes landed", async () => {
    const c: Case = {
      id: "t-section",
      category: "format_placement",
      mode: "input",
      doc: "format-comparison",
      format: "comparison",
      utterance: "The options are Kafka and SQS.",
      expect: { doc: { underHeading: [{ heading: "Options", contains: ["kafka", "sqs"] }] } },
    };
    const t = await trial(c, [reply("@@ section Options\n- Kafka\n- SQS")]);
    expect(t).toMatchObject({ pass: true, outcome: "applied" });
    const sent = JSON.stringify(mock?.requests[0]?.body);
    expect(sent).toContain("SECTIONS of this comparison");
    const elsewhere = await trial(c, [reply("@@ section Decision\n- Kafka\n- SQS")]);
    expect(elsewhere.pass).toBe(false);
  });
});

describe("trialsOf", () => {
  it("is the utterance, then each variant, or only the utterance", () => {
    const c = { ...loadBalancer, variants: ["a", "b"] };
    expect(trialsOf(c).map((t) => t.utterance)).toEqual([c.utterance, "a", "b"]);
    expect(trialsOf(c, false)).toHaveLength(1);
  });
});
