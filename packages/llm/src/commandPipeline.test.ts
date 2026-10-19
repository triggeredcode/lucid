import { applyPatch, createSequentialIds, type LucidDoc } from "@lucid/core";
import { startMockLmStudio, type MockLmStudio } from "@lucid/mock-lmstudio";
import { afterEach, describe, expect, it } from "vitest";
import { LmStudioClient } from "./client";
import { runCommand, type CommandJob } from "./commandPipeline";
import { COMMAND_DOC, COMMAND_EXAMPLES, buildCommandMessages } from "./prompts/command";
import type { AiClient, ProviderCapabilities } from "./provider";

let mock: MockLmStudio | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});
async function setup(script: Parameters<typeof startMockLmStudio>[0]) {
  mock = await startMockLmStudio(script);
  return { mock, client: new LmStudioClient({ baseUrl: mock.url }) };
}
const withStructuredOutput = (
  client: AiClient,
  structuredOutput: ProviderCapabilities["structuredOutput"],
): AiClient => ({
  provider: client.provider,
  capabilities: { ...client.capabilities, structuredOutput },
  localModels: client.localModels,
  chat: (request) => client.chat(request),
  health: (signal) => client.health(signal),
});
const ids = () => createSequentialIds("n");
const json = (over: Record<string, unknown>) =>
  JSON.stringify({
    kind: "edit",
    summary: null,
    ops: null,
    question: null,
    options: null,
    reason: null,
    ...over,
  });
const reply = (content: string) => ({ kind: "reply" as const, content, chunkChars: 500 });
const job = (utterance: string, over: Partial<CommandJob> = {}): CommandJob => ({
  doc: COMMAND_DOC,
  utterance,
  ...over,
});

describe("the few-shot examples", () => {
  for (const [i, ex] of COMMAND_EXAMPLES.entries()) {
    it(`example ${String(i + 1)} compiles on its own document`, async () => {
      const { client } = await setup({ script: [reply(JSON.stringify(ex.answer))] });
      const out = await runCommand(
        job(ex.utterance, { cursorBlockId: ex.cursor, touched: ex.touched }),
        { client, ids: ids() },
      );
      const kind = (ex.answer as { kind: string }).kind;
      expect(out.kind).toBe(kind === "edit" ? "edit" : kind);
      if (out.kind === "edit") expect(out.repaired).toBe(false);
    });
  }
});

describe("runCommand", () => {
  it("runs an exact selected-block command without contacting the provider", async () => {
    const { client, mock } = await setup({ script: [] });
    const out = await runCommand(job("delete this block", { cursorBlockId: "t1" }), {
      client: withStructuredOutput(client, "unavailable"),
      ids: ids(),
    });
    expect(out).toMatchObject({
      kind: "edit",
      execution: "deterministic",
      calls: [],
      summary: "Deleted selected block",
    });
    if (out.kind !== "edit") throw new Error(out.kind);
    expect(out.next.blocks.some((block) => block.id === "t1")).toBe(false);
    expect(mock.requests).toHaveLength(0);
  });

  it("falls through to the model for wording outside the exact allowlist", async () => {
    const { client, mock } = await setup({
      script: [reply(json({ kind: "none", reason: "ambiguous wording" }))],
    });
    const out = await runCommand(job("delete this block please", { cursorBlockId: "t1" }), {
      client,
      ids: ids(),
    });
    expect(out).toMatchObject({ kind: "none", execution: "model" });
    expect(mock.requests).toHaveLength(1);
  });

  it("uses a prompted-and-validated contract without claiming native schema enforcement", async () => {
    const { client, mock } = await setup({
      script: [
        reply(
          json({
            summary: "Struck it",
            ops: [{ op: "set_status", target: "b6.2", in: null, status: "struck" }],
          }),
        ),
      ],
    });
    const out = await runCommand(job("cross out MongoDB"), {
      client: withStructuredOutput(client, "prompted"),
      ids: ids(),
    });
    expect(out).toMatchObject({ kind: "edit", repaired: false });
    const body = mock.requests[0]?.body;
    expect(body).not.toHaveProperty("response_format");
    const messages = body?.["messages"] as { role: string; content: string }[];
    expect(messages.at(-1)?.content).toContain("STRUCTURED OUTPUT CONTRACT");
    expect(messages.at(-1)?.content).toContain('"required"');
  });

  it.each([
    ["malformed", "{ not json"],
    ["partial", "{}"],
    ["schema-violating", json({ kind: "clarify", question: 42, options: [] })],
  ])("rejects %s prompted responses after one repair", async (_name, answer) => {
    const { client, mock } = await setup({ script: [reply(answer)] });
    const out = await runCommand(job("cross out MongoDB"), {
      client: withStructuredOutput(client, "prompted"),
      ids: ids(),
    });
    expect(out.kind).toBe("failed");
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests.every((request) => !("response_format" in request.body))).toBe(true);
  });

  it("stops an unavailable structured provider before sending a request", async () => {
    const { client, mock } = await setup({ script: [] });
    const out = await runCommand(job("delete the table"), {
      client: withStructuredOutput(client, "unavailable"),
      ids: ids(),
    });
    expect(out).toMatchObject({ kind: "unavailable", calls: [], raw: "" });
    expect(mock.requests).toHaveLength(0);
  });

  it("returns a patch that applies the change to the document", async () => {
    const { client, mock } = await setup({
      script: [
        reply(
          json({
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
      ],
    });
    const out = await runCommand(job("Add a CDN in front of the web server."), {
      client,
      ids: ids(),
    });
    if (out.kind !== "edit") throw new Error(out.kind);
    expect(out.summary).toBe("Added a CDN");
    expect(applyPatch(COMMAND_DOC, out.patch)).toEqual(out.next);
    expect(out.affected).toEqual(["d1"]);
    // The model is asked with strict structured output and the document, hints and utterance last.
    const body = mock.requests[0]?.body;
    expect(body?.["response_format"]).toMatchObject({
      type: "json_schema",
      json_schema: { name: "lucid_command", strict: true },
    });
    expect(body?.["messages"]).toEqual(
      buildCommandMessages(job("Add a CDN in front of the web server.")).messages,
    );
    const last = (body?.["messages"] as { content: string }[]).at(-1)?.content ?? "";
    expect(last).toContain("OUTLINE");
    expect(last).toContain("HINTS:");
    expect(last.endsWith("UTTERANCE:\nAdd a CDN in front of the web server.")).toBe(true);
  });

  it("asks the user when the model asks", async () => {
    const { client } = await setup({
      script: [
        reply(
          json({
            kind: "clarify",
            question: "Which one?",
            options: [
              { label: "A", ref: "e2" },
              { label: "B", ref: null },
            ],
          }),
        ),
      ],
    });
    const out = await runCommand(job("remove that connection"), { client, ids: ids() });
    expect(out).toMatchObject({
      kind: "clarify",
      question: "Which one?",
      options: [
        { label: "A", ref: "e2" },
        { label: "B", ref: null },
      ],
    });
  });

  it("says when the words were notes, not an instruction", async () => {
    const { client } = await setup({ script: [reply(json({ kind: "none", reason: "content" }))] });
    expect(
      await runCommand(job("Entries expire after thirty days"), { client, ids: ids() }),
    ).toMatchObject({ kind: "none", content: true });
    await mock?.close();
    const other = await setup({
      script: [reply(json({ kind: "none", reason: "Nothing like that in the document." }))],
    });
    expect(
      await runCommand(job("Do the thing"), { client: other.client, ids: ids() }),
    ).toMatchObject({ kind: "none", content: false });
  });

  it("repairs once when the answer is not valid, and tells the model what was wrong", async () => {
    const { client, mock } = await setup({
      script: [
        reply("{ not json"),
        reply(
          json({
            summary: "Struck it",
            ops: [{ op: "set_status", target: "b6.2", in: null, status: "struck" }],
          }),
        ),
      ],
    });
    const out = await runCommand(job("cross out MongoDB"), { client, ids: ids() });
    expect(out).toMatchObject({ kind: "edit", repaired: true });
    const second = mock.requests[1]?.body["messages"] as { role: string; content: string }[];
    expect(second.at(-1)?.content).toContain("The answer is not valid JSON");
  });

  it("repairs a reference that does not exist, quoting the problem", async () => {
    const { client, mock } = await setup({
      script: [
        reply(
          json({
            summary: "x",
            ops: [{ op: "set_status", target: "b99", in: null, status: "struck" }],
          }),
        ),
        reply(
          json({
            summary: "Struck it",
            ops: [{ op: "set_status", target: "b6.2", in: null, status: "struck" }],
          }),
        ),
      ],
    });
    const out = await runCommand(job("cross out MongoDB"), { client, ids: ids() });
    expect(out).toMatchObject({ kind: "edit", repaired: true });
    const second = mock.requests[1]?.body["messages"] as { content: string }[];
    expect(second.at(-1)?.content).toContain("called b99");
  });

  it("gives up after one repair and says why", async () => {
    const bad = json({
      summary: "x",
      ops: [{ op: "set_status", target: "b99", in: null, status: "struck" }],
    });
    const { client, mock } = await setup({ script: [reply(bad)] });
    const out = await runCommand(job("cross out MongoDB"), { client, ids: ids() });
    expect(out).toMatchObject({ kind: "failed" });
    expect((out as { message: string }).message).toContain("b99");
    expect(mock.requests).toHaveLength(2);
  });

  it("repairs a diagram component the user never mentioned", async () => {
    const withQueue = json({
      summary: "Added a queue",
      ops: [
        {
          op: "graph.insert_between",
          target: "b3",
          from: "client",
          to: "web",
          node: "queue [queue]: Message Queue",
          labels: null,
        },
      ],
    });
    const { client, mock } = await setup({
      script: [
        reply(withQueue),
        reply(
          json({
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
      ],
    });
    const out = await runCommand(job("Add a CDN in front of the web server."), {
      client,
      ids: ids(),
    });
    expect(out).toMatchObject({ kind: "edit", repaired: true });
    const second = mock.requests[1]?.body["messages"] as { content: string }[];
    expect(second.at(-1)?.content).toContain("Message Queue");
  });

  it("does not change anything when the ops change nothing", async () => {
    const { client } = await setup({
      script: [
        reply(
          json({
            summary: "x",
            ops: [{ op: "set_status", target: "b6.2", in: null, status: "normal" }],
          }),
        ),
      ],
    });
    expect(await runCommand(job("keep MongoDB as it is"), { client, ids: ids() })).toMatchObject({
      kind: "none",
      content: false,
    });
  });

  it("asks before throwing something away that the user did not ask to remove", async () => {
    const ops = [{ op: "delete", target: "b4" }];
    const { client } = await setup({
      script: [reply(json({ summary: "Removed the table", ops }))],
    });
    const ask = await runCommand(job("clean up the comparison"), { client, ids: ids() });
    expect(ask.kind).toBe("proposal");
    if (ask.kind === "proposal") expect(ask.destructive[0]?.reason).toContain("delete b4");

    await mock?.close();
    const sure = await setup({ script: [reply(json({ summary: "Removed the table", ops }))] });
    expect(
      (await runCommand(job("delete the table"), { client: sure.client, ids: ids() })).kind,
    ).toBe("edit");
  });

  it("warns about numbers the user did not say, without refusing the change", async () => {
    const ops = [
      {
        op: "table.add_row",
        target: "b4",
        after: "end",
        cells: ["Throughput", "10000 ops/s", "100000 ops/s"],
      },
    ];
    const { client } = await setup({ script: [reply(json({ summary: "Added a row", ops }))] });
    const out = await runCommand(
      job("add a row for throughput to this table", { cursorBlockId: "t1" }),
      { client, ids: ids() },
    );
    expect(out.kind).toBe("edit");
    if (out.kind === "edit") expect(out.warnings.join(" ")).toContain("10000");
  });

  it("passes LM Studio problems on to the caller", async () => {
    const { client, mock } = await setup({ script: [reply("{}")] });
    await mock.close();
    await expect(runCommand(job("x"), { client, ids: ids() })).rejects.toThrow();
  });

  it("never changes the document it was given", async () => {
    const before = JSON.stringify(COMMAND_DOC);
    const { client } = await setup({
      script: [reply(json({ summary: "x", ops: [{ op: "delete", target: "b6" }] }))],
    });
    await runCommand(job("delete the options"), { client, ids: ids() });
    expect(JSON.stringify(COMMAND_DOC)).toBe(before);
    const doc: LucidDoc = COMMAND_DOC;
    expect(doc.blocks).toHaveLength(8);
  });
});
