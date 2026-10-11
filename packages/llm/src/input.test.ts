import { addRow, applyPatch, createSequentialIds, createTable, type LucidDoc } from "@lucid/core";
import { block, bullets, doc, h1, h2, p } from "@lucid/core/testing";
import { startMockLmStudio, type MockLmStudio } from "@lucid/mock-lmstudio";
import { afterEach, describe, expect, it } from "vitest";
import { LmStudioClient } from "./client";
import { LlmError } from "./errors";
import { cleanAnswer, runInput, unprocessedPatch, type InputJob } from "./input";
import { INPUT_EXAMPLES, buildInputMessages } from "./prompts/input";

let mock: MockLmStudio | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

async function setup(script: Parameters<typeof startMockLmStudio>[0]) {
  mock = await startMockLmStudio(script);
  return { mock, client: new LmStudioClient({ baseUrl: mock.url }) };
}
const ids = () => createSequentialIds("n");
const reply = (content: string) => ({ kind: "reply" as const, content, chunkChars: 200 });

const empty: LucidDoc = { blocks: [] };
const said = "Load balancer. Multiple application servers behind it. Distribute incoming traffic.";
const good =
  "## Load Balancer\nA **load balancer** distributes incoming traffic across multiple application servers.";
const job = (over: Partial<InputJob> = {}): InputJob => ({ doc: empty, utterance: said, ...over });

describe("the few-shot examples", () => {
  for (const [i, ex] of INPUT_EXAMPLES.entries()) {
    it(`example ${String(i + 1)} is accepted as it is, with no repair and no warnings`, async () => {
      const { client } = await setup({ script: [reply(ex.answer)] });
      const out = await runInput(
        { doc: ex.doc, utterance: ex.utterance, cursorBlockId: ex.focus },
        { client, ids: ids() },
      );
      expect(out).toMatchObject({ kind: "applied", repaired: false, warnings: [] });
    });
  }
});

describe("runInput", () => {
  it("returns a patch that adds the notes, in the right place", async () => {
    const { client, mock } = await setup({ script: [reply(good)] });
    const d = doc(h1("Notes", { id: "h" }), p("existing", { id: "e" }));
    const out = await runInput(job({ doc: d, cursorBlockId: "h" }), { client, ids: ids() });
    if (out.kind !== "applied") throw new Error(out.kind);
    const next = applyPatch(d, out.patch);
    expect(next.blocks.map((b) => b.id)).toEqual(["h", "n1", "n2", "e"]);
    expect(out.repaired).toBe(false);
    expect(mock.requests).toHaveLength(1);
    expect(out.calls).toHaveLength(1);
  });

  it("sends the static prompt first and the document, cursor and utterance last", async () => {
    const { client, mock } = await setup({ script: [reply(good)] });
    await runInput(
      job({
        doc: doc(h1("Notes", { id: "h" })),
        cursorBlockId: "h",
        recent: [{ mode: "input", text: "earlier" }],
      }),
      { client, ids: ids() },
    );
    const messages = mock.requests[0]?.body["messages"] as { role: string; content: string }[];
    const expected = buildInputMessages(
      job({
        doc: doc(h1("Notes", { id: "h" })),
        cursorBlockId: "h",
        recent: [{ mode: "input", text: "earlier" }],
      }),
    ).messages;
    expect(messages).toEqual(expected);
    const last = messages.at(-1)?.content ?? "";
    expect(last).toContain("OUTLINE");
    expect(last).toContain("[b1] h1 Notes");
    expect(last).toContain("CURSOR: in [b1]");
    expect(last).toContain("- (input) earlier");
    expect(last.endsWith(`UTTERANCE:\n${said}`)).toBe(true);
  });

  it("streams the answer while it arrives", async () => {
    const { client } = await setup({ script: [{ kind: "reply", content: good, chunkChars: 10 }] });
    const parts: string[] = [];
    await runInput(job(), { client, ids: ids(), onDelta: (t) => parts.push(t) });
    expect(parts.join("")).toBe(good);
    expect(parts.length).toBeGreaterThan(3);
  });

  it("strips a markdown fence the model wrapped around the whole answer", async () => {
    const { client } = await setup({ script: [reply("```markdown\n" + good + "\n```")] });
    const out = await runInput(job(), { client, ids: ids() });
    expect(out).toMatchObject({ kind: "applied", repaired: false });
  });

  it("repairs once when the answer cannot be parsed, telling the model what was wrong", async () => {
    const { client, mock } = await setup({
      script: [reply("```graph type=flowchart\nweb -> \n```"), reply(good)],
    });
    const out = await runInput(job(), { client, ids: ids() });
    expect(out).toMatchObject({ kind: "applied", repaired: true });
    expect(mock.requests).toHaveLength(2);
    const second = mock.requests[1]?.body["messages"] as { role: string; content: string }[];
    expect(second.at(-2)?.role).toBe("assistant");
    expect(second.at(-1)?.content).toContain("Your output had these problems");
  });

  it("repairs a placement that points at a block that does not exist", async () => {
    const { client } = await setup({ script: [reply("@@ after b9\n" + good), reply(good)] });
    const out = await runInput(job(), { client, ids: ids() });
    expect(out).toMatchObject({ kind: "applied", repaired: true });
  });

  it("repairs invented numbers, and keeps the user's words if the model keeps inventing", async () => {
    const invented =
      "## Load Balancer\nHandles 10000 requests per second across multiple application servers.";
    const { client, mock } = await setup({ script: [reply(invented)] });
    const d = doc(h1("Notes", { id: "h" }));
    const out = await runInput(job({ doc: d, cursorBlockId: "h" }), { client, ids: ids() });
    expect(mock.requests).toHaveLength(2);
    if (out.kind !== "unprocessed") throw new Error(out.kind);
    expect(out.reason).toContain("10000");
    const next = applyPatch(d, out.patch);
    expect(next.blocks.at(-1)).toMatchObject({ type: "paragraph", props: { unprocessed: true } });
    expect(next.blocks.at(-1)?.content).toEqual([{ type: "text", text: said, styles: {} }]);
  });

  it("falls back to the unprocessed paragraph when the repair is still unreadable", async () => {
    const { client } = await setup({ script: [reply("```graph\nx ->\n```")] });
    const out = await runInput(job(), { client, ids: ids() });
    expect(out.kind).toBe("unprocessed");
  });

  it("keeps notes that dropped some words after one repair, with a warning", async () => {
    const thin = "## Load Balancer\nIt balances load.";
    const { client } = await setup({ script: [reply(thin)] });
    const out = await runInput(job(), { client, ids: ids() });
    if (out.kind !== "applied") throw new Error(out.kind);
    expect(out.repaired).toBe(true);
    expect(out.warnings.join(" ")).toContain("You dropped");
  });

  it("flags diagram components the user never mentioned", async () => {
    const withCdn =
      '```graph type=flowchart dir=LR title="Flow"\nclient [client]: Client\nweb [service]: Web Server\ncdn [cdn]: CDN\nclient -> cdn\ncdn -> web\n```';
    const { client } = await setup({ script: [reply(withCdn)] });
    const out = await runInput(
      job({ utterance: "The client sends a request to the web server." }),
      { client, ids: ids() },
    );
    if (out.kind !== "applied") throw new Error(out.kind);
    expect(out.warnings.join(" ")).toContain("CDN");
  });

  it("does not run an instruction as a command by itself", async () => {
    const { client, mock } = await setup({ script: [reply("@@ command")] });
    const out = await runInput(job({ utterance: "turn that into a table" }), {
      client,
      ids: ids(),
    });
    expect(out.kind).toBe("command");
    expect(mock.requests).toHaveLength(1);
  });

  it("passes LM Studio problems on to the caller", async () => {
    const { client, mock: server } = await setup({ script: [reply(good)] });
    await server.close();
    await expect(runInput(job(), { client, ids: ids() })).rejects.toBeInstanceOf(LlmError);
  });

  it("accepts the user's vocabulary as spoken", async () => {
    const { client } = await setup({ script: [reply("## Notes\n- Use Kafka for the queue")] });
    const out = await runInput(
      job({ utterance: "use the thing for the queue", vocabulary: ["Kafka"] }),
      { client, ids: ids() },
    );
    expect(out.kind).toBe("applied");
  });

  it("can continue a list with append_to", async () => {
    const d = doc(
      h2("Requirements", { id: "r" }),
      bullets({ text: "a", id: "a" }, { text: "b", id: "b" }),
    );
    const { client } = await setup({ script: [reply("@@ append_to b2\n- Custom aliases")] });
    const out = await runInput(job({ doc: d, utterance: "also custom aliases" }), {
      client,
      ids: ids(),
    });
    if (out.kind !== "applied") throw new Error(out.kind);
    expect(applyPatch(d, out.patch).blocks.map((b) => b.id)).toEqual(["r", "a", "b", "n1"]);
  });
});

describe("a page with a note format", () => {
  it("tells the model the sections and how to put notes in one, and names the format in the outline", () => {
    const d = doc(h2("Context", { id: "c" }), h2("Options", { id: "o" }));
    const { messages } = buildInputMessages({
      doc: d,
      utterance: "Kafka or SQS",
      format: "comparison",
    });
    const last = messages.at(-1)?.content ?? "";
    expect(last).toContain("(format: Comparison)");
    expect(last).toContain(
      'SECTIONS of this comparison (to put notes in one, start with "@@ section <heading>"',
    );
    expect(last).toContain(
      "- Options: The candidates; cross out what is dropped. Suits: bulletListItem.",
    );
    expect(last).toContain("- Decision: What was chosen and why. Suits: callout.");
    // The static part is the same with or without a format.
    expect(messages.slice(0, -1)).toEqual(
      buildInputMessages({ doc: d, utterance: "x" }).messages.slice(0, -1),
    );
  });

  it("says nothing about sections on a blank page or for a format it does not know", () => {
    const last = (format?: string) =>
      buildInputMessages({ doc: empty, utterance: "x", format }).messages.at(-1)?.content ?? "";
    expect(last()).not.toContain("SECTIONS");
    expect(last("whatever")).not.toContain("SECTIONS");
    expect(last("whatever")).toContain("(format: whatever)");
  });

  it("puts what the model writes under the section it names", async () => {
    const d = doc(
      h2("Context", { id: "c" }),
      h2("Options", { id: "o" }),
      h2("Decision", { id: "d" }),
    );
    const { client } = await setup({ script: [reply("@@ section Options\n- Kafka\n- SQS")] });
    const out = await runInput(
      job({ doc: d, utterance: "the options are Kafka and SQS", format: "comparison" }),
      {
        client,
        ids: ids(),
      },
    );
    if (out.kind !== "applied") throw new Error(`${out.kind}: ${out.raw}`);
    const after = applyPatch(d, out.patch).blocks;
    expect(after.map((b) => b.type)).toEqual([
      "heading",
      "heading",
      "bulletListItem",
      "bulletListItem",
      "heading",
    ]);
    expect([after[0]?.id, after[1]?.id, after[4]?.id]).toEqual(["c", "o", "d"]);
  });
});

describe("rows appended to a table", () => {
  const withTable = (): LucidDoc => {
    const t = addRow(createTable(["Property", "Kafka", "SQS"]), {
      cells: ["Hosting", "Self-managed", "Managed"],
    });
    return doc(
      h2("Comparison", { id: "h" }),
      block("table", { table: t, caption: "" }, { id: "t" }),
    );
  };

  it("are read as rows of that table even when the model leaves out the header", async () => {
    const d = withTable();
    const { client } = await setup({
      script: [reply("@@ append_to b2\n| Cost | Own infrastructure | Pay per request |")],
    });
    const out = await runInput(
      job({
        doc: d,
        utterance:
          "also a row for cost: Kafka needs your own infrastructure, SQS is pay per request",
      }),
      {
        client,
        ids: ids(),
      },
    );
    if (out.kind !== "applied") throw new Error(`${out.kind}: ${out.raw}`);
    const after = applyPatch(d, out.patch);
    const t = after.blocks.find((b) => b.type === "table")?.props["table"] as {
      rows: { cells: string[] }[];
    };
    expect(t.rows.map((r) => r.cells[0])).toEqual(["Hosting", "Cost"]);
    expect(after.blocks.filter((b) => b.type === "table")).toHaveLength(1);
  });

  it("still keeps the words as a note when the row does not fit the table", async () => {
    const d = withTable();
    const { client } = await setup({
      script: [reply("@@ append_to b2\n| Cost | a | b | c | d |")],
    });
    const out = await runInput(job({ doc: d, utterance: "also a row for cost with four things" }), {
      client,
      ids: ids(),
    });
    expect(out.kind).toBe("unprocessed");
  });
});

describe("helpers", () => {
  it("cleanAnswer only removes a wrapping fence of notes", () => {
    expect(cleanAnswer("```md\nhello\n```")).toBe("hello");
    expect(cleanAnswer("  hello  ")).toBe("hello");
    expect(cleanAnswer("```graph type=flowchart\na -> b\n```")).toBe(
      "```graph type=flowchart\na -> b\n```",
    );
  });

  it("unprocessedPatch goes after the cursor block, or at the end", () => {
    const d = doc(h1("T", { id: "h" }), p("x", { id: "x" }));
    const at = (cursor?: string) =>
      applyPatch(d, unprocessedPatch(d, " hello ", cursor, ids())).blocks.map((b) => b.id);
    expect(at("h")).toEqual(["h", "n1", "x"]);
    expect(at()).toEqual(["h", "x", "n1"]);
    expect(at("gone")).toEqual(["h", "x", "n1"]);
  });
});
