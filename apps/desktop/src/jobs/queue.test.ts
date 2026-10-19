import {
  PatchError,
  applyPatch,
  createSequentialIds,
  type BlockPatch,
  type ChangeEntry,
  type LucidDoc,
  type TranscriptEntry,
} from "@lucid/core";
import {
  COMMAND_DOC,
  DEFAULT_LANES,
  LmStudioClient,
  type AiClient,
  type ProviderCapabilities,
} from "@lucid/llm";
import { startMockLmStudio, type Behaviour, type MockLmStudio } from "@lucid/mock-lmstudio";
import { afterEach, describe, expect, it } from "vitest";
import { JobQueue, type EditorPort, type JobStatus, type Utterance } from "./queue";

let mock: MockLmStudio | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const good =
  "## Load Balancer\nA **load balancer** distributes incoming traffic across multiple application servers.\n- **Health checks** keep traffic away from unhealthy servers.";
const said =
  "Load balancer. Multiple application servers behind it. Distribute incoming traffic. Health checks to avoid unhealthy servers.";
const reply = (
  content: string,
  extra: Partial<Extract<Behaviour, { kind: "reply" }>> = {},
): Behaviour => ({ kind: "reply", content, chunkChars: 400, ...extra });

class FakeEditor implements EditorPort {
  doc: LucidDoc = { blocks: [] };
  cursor: string | undefined;
  failApply = 0;
  applied: BlockPatch[] = [];
  getDoc = () => this.doc;
  cursorBlockId = () => this.cursor;
  apply = (patch: BlockPatch) => {
    if (this.failApply > 0) {
      this.failApply -= 1;
      throw new PatchError("StaleTarget", "gone");
    }
    this.doc = applyPatch(this.doc, patch);
    this.applied.push(patch);
    return this.doc;
  };
}

async function setup(
  script: Behaviour[] | undefined,
  options: {
    fetch?: typeof fetch;
    models?: string[];
    firstTokenTimeoutMs?: number;
    structuredOutput?: ProviderCapabilities["structuredOutput"];
  } = {},
) {
  mock = await startMockLmStudio({
    script: script ?? [],
    ...(options.models ? { models: options.models } : {}),
  });
  const editor = new FakeEditor();
  const statuses: JobStatus[] = [];
  const transcripts: TranscriptEntry[] = [];
  const changes: ChangeEntry[] = [];
  const nativeClient = new LmStudioClient({
    baseUrl: mock.url,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.firstTokenTimeoutMs ? { firstTokenTimeoutMs: options.firstTokenTimeoutMs } : {}),
  });
  const client: AiClient = options.structuredOutput
    ? {
        provider: nativeClient.provider,
        capabilities: { ...nativeClient.capabilities, structuredOutput: options.structuredOutput },
        localModels: nativeClient.localModels,
        chat: (request) => nativeClient.chat(request),
        health: (signal) => nativeClient.health(signal),
      }
    : nativeClient;
  const queue = new JobQueue({
    client,
    lanes: { input: DEFAULT_LANES.input, command: DEFAULT_LANES.command },
    modelName: "qwen3.8-27b",
    editor: () => editor,
    title: () => "Notes",
    onStatus: (s) => {
      statuses.push(s);
    },
    onTranscript: (t) => {
      transcripts.push(t);
    },
    onChange: (c) => {
      changes.push(c);
    },
    pollMs: 20,
    ids: createSequentialIds("n"),
  });
  const ids = createSequentialIds("u");
  const say = (
    text: string,
    source: Utterance["source"] = "typed",
    mode: Utterance["mode"] = "input",
  ) => {
    queue.submit({ id: ids(), text, source, mode, createdAt: new Date(0).toISOString() });
  };
  const settled = async () => {
    for (let i = 0; i < 400 && queue.pendingCount > 0; i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(queue.pendingCount).toBe(0);
  };
  return {
    mock,
    editor,
    statuses,
    transcripts,
    changes,
    queue,
    say,
    settled,
    last: () => statuses.at(-1),
  };
}

describe("JobQueue", () => {
  it("shows an explicit unavailable state and applies nothing when Command is unsupported", async () => {
    const t = await setup([], { structuredOutput: "unavailable" });
    t.editor.doc = COMMAND_DOC;
    t.say("delete the table", "typed", "command");
    await t.settled();
    const last = t.last();
    expect(last?.kind).toBe("unavailable");
    if (last?.kind !== "unavailable") throw new Error("Expected unavailable status");
    expect(last.message).toContain("No edit was applied");
    expect(t.editor.applied).toHaveLength(0);
    expect(t.mock.requests).toHaveLength(0);
    expect(t.transcripts.at(-1)?.status).toBe("rejected");
  });

  it("turns an utterance into notes in the page and records what happened", async () => {
    const t = await setup([reply(good)]);
    t.say(said, "wispr");
    await t.settled();
    expect(t.editor.doc.blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "bulletListItem",
    ]);
    expect(t.last()).toMatchObject({
      kind: "done",
      summary: "Added a heading, a paragraph and a bullet",
    });
    expect(t.statuses[0]).toMatchObject({ kind: "working", queued: 0 });
    expect(t.transcripts).toEqual([
      {
        id: "u1",
        text: said,
        source: "wispr",
        mode: "input",
        createdAt: new Date(0).toISOString(),
        status: "applied",
      },
    ]);
    expect(t.changes).toHaveLength(1);
    expect(t.changes[0]).toMatchObject({
      summary: "Added a heading, a paragraph and a bullet",
      source: "local-model",
      affected: ["n1", "n2", "n3"],
    });
  });

  it("gives the model the page and the last things said", async () => {
    const t = await setup([reply(good), reply("- Second note about load balancer health checks")]);
    t.say(said);
    await t.settled();
    t.say("Second note about load balancer health checks");
    await t.settled();
    const second =
      (t.mock.requests[1]?.body["messages"] as { content: string }[]).at(-1)?.content ?? "";
    expect(second).toContain("[b1] h2 Load Balancer");
    expect(second).toContain(`- (input) ${said}`);
  });

  it("joins utterances that arrive while a job runs into one job", async () => {
    const t = await setup([
      reply(good, { delayMs: 40, chunkChars: 30 }),
      reply("- Database can become the bottleneck, and caching helps"),
    ]);
    t.say(said);
    await new Promise((r) => setTimeout(r, 30));
    t.say("Database can become the bottleneck.");
    t.say("And caching helps.");
    await t.settled();
    expect(t.mock.requests).toHaveLength(2);
    const joined =
      (t.mock.requests[1]?.body["messages"] as { content: string }[]).at(-1)?.content ?? "";
    expect(
      joined.endsWith("UTTERANCE:\nDatabase can become the bottleneck.\nAnd caching helps."),
    ).toBe(true);
    expect(t.transcripts.map((x) => x.text)).toEqual([
      said,
      "Database can become the bottleneck.",
      "And caching helps.",
    ]);
  });

  it("waits for LM Studio when it is down and carries on when it is back", async () => {
    let down = true;
    const realFetch = globalThis.fetch.bind(globalThis);
    const flaky: typeof fetch = (input, init) =>
      down ? Promise.reject(new TypeError("connect ECONNREFUSED")) : realFetch(input, init);
    const t = await setup([reply(good)], { fetch: flaky });
    t.say(said);
    await new Promise((r) => setTimeout(r, 120));
    expect(t.last()).toEqual({ kind: "waiting", reason: "Waiting for LM Studio…" });
    expect(t.editor.doc.blocks).toHaveLength(0);
    down = false;
    await t.settled();
    expect(t.editor.doc.blocks).toHaveLength(3);
    expect(t.last()).toMatchObject({ kind: "done" });
  });

  it("asks for the model to be loaded, and runs the same job again on retry", async () => {
    const t = await setup([reply(good)], { models: [] });
    t.say(said);
    await t.settled();
    expect(t.last()).toEqual({
      kind: "failed",
      message: "qwen3.8-27b isn't loaded in LM Studio. Load it, then try again.",
      text: said,
    });
    expect(t.editor.doc.blocks).toHaveLength(0);
    t.mock.setModels(["qwen/qwen3.8-27b"]);
    t.queue.retry();
    await t.settled();
    expect(t.editor.doc.blocks).toHaveLength(3);
  });

  it("keeps the user's words when the model's notes cannot be used", async () => {
    const t = await setup([reply("```graph\nbroken ->\n```")]);
    t.say(said);
    await t.settled();
    expect(t.editor.doc.blocks).toHaveLength(1);
    expect(t.editor.doc.blocks[0]).toMatchObject({
      type: "paragraph",
      props: { unprocessed: true },
    });
    expect(t.last()).toMatchObject({
      kind: "done",
      notice: "I couldn't structure that, so I added your words as they are.",
    });
    expect(t.transcripts[0]?.status).toBe("unprocessed");
  });

  it("keeps the user's words when LM Studio errors out", async () => {
    const t = await setup([{ kind: "http-error", status: 500, message: "out of memory" }]);
    t.say(said);
    await t.settled();
    expect(t.editor.doc.blocks[0]).toMatchObject({
      type: "paragraph",
      props: { unprocessed: true },
    });
    expect(t.last()).toMatchObject({ kind: "done" });
    expect((t.last() as { notice: string }).notice).toContain("out of memory");
    expect(t.transcripts[0]?.status).toBe("unprocessed");
  });

  it("does not run an instruction as a command, and says so", async () => {
    const t = await setup([reply("@@ command")]);
    t.say("turn that into a table");
    await t.settled();
    expect(t.editor.doc.blocks[0]).toMatchObject({
      type: "paragraph",
      props: { unprocessed: true },
    });
    expect((t.last() as { notice: string }).notice).toContain("sounded like an instruction");
  });

  it("looks at the page again once if a block it needed has gone", async () => {
    const t = await setup([reply(good), reply(good)]);
    t.editor.failApply = 1;
    t.say(said);
    await t.settled();
    expect(t.mock.requests).toHaveLength(2);
    expect(t.editor.doc.blocks).toHaveLength(3);
  });

  it("can be cancelled: nothing is added", async () => {
    const t = await setup([reply(good, { delayMs: 50, chunkChars: 5 })]);
    t.say(said);
    await new Promise((r) => setTimeout(r, 80));
    t.queue.cancel();
    await t.settled();
    expect(t.editor.doc.blocks).toHaveLength(0);
    expect(t.last()).toEqual({ kind: "idle" });
    expect(t.transcripts[0]?.status).toBe("rejected");
  });
});

describe("JobQueue when the model stalls", () => {
  it("tries once more after a stall or a dropped connection before giving up", async () => {
    const t = await setup([{ kind: "slow-first-token", ms: 600, content: good }, reply(good)], {
      firstTokenTimeoutMs: 200,
    });
    t.say(said);
    await t.settled();
    expect(t.mock.requests).toHaveLength(2);
    expect(t.editor.doc.blocks).toHaveLength(3);
    expect(t.last()).toMatchObject({
      kind: "done",
      summary: "Added a heading, a paragraph and a bullet",
    });

    const drop = await setup([{ kind: "drop", content: "## Half", afterChars: 5 }, reply(good)]);
    drop.say(said);
    await drop.settled();
    expect(drop.mock.requests).toHaveLength(2);
    expect(drop.editor.doc.blocks).toHaveLength(3);
  });

  it("keeps the user's words when the second try fails as well", async () => {
    const t = await setup([{ kind: "slow-first-token", ms: 500, content: good }], {
      firstTokenTimeoutMs: 150,
    });
    t.say(said);
    await t.settled();
    expect(t.mock.requests).toHaveLength(2);
    expect(t.editor.doc.blocks[0]).toMatchObject({
      type: "paragraph",
      props: { unprocessed: true },
    });
  });
});

describe("JobQueue in Command mode", () => {
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
  const strike = json({
    summary: "Crossed out MongoDB",
    ops: [{ op: "set_status", target: "b6.2", in: null, status: "struck" }],
  });
  const withDoc = async (script: Behaviour[]) => {
    const t = await setup(script);
    t.editor.doc = JSON.parse(JSON.stringify(COMMAND_DOC)) as LucidDoc;
    return t;
  };
  const props = (t: Awaited<ReturnType<typeof withDoc>>, id: string) =>
    t.editor.doc.blocks.find((b) => b.id === id)?.props;

  it("carries out a command on the page and records it", async () => {
    const t = await withDoc([reply(strike)]);
    t.say("cross out MongoDB", "typed", "command");
    await t.settled();
    expect(props(t, "o2")).toEqual({ status: "struck" });
    expect(t.last()).toMatchObject({
      kind: "done",
      summary: "Crossed out MongoDB",
      undoable: true,
    });
    expect(t.transcripts[0]).toMatchObject({
      mode: "command",
      status: "applied",
      text: "cross out MongoDB",
    });
    expect(t.changes[0]).toMatchObject({ summary: "Crossed out MongoDB", affected: ["o2"] });
  });

  it("tells the model what a block number is, when the person numbers blocks, and says nothing otherwise", async () => {
    const t = await withDoc([reply(strike), reply(strike)]);
    t.say("cross out MongoDB", "typed", "command");
    await t.settled();
    const plain =
      (t.mock.requests[0]?.body["messages"] as { content: string }[]).at(-1)?.content ?? "";
    expect(plain).not.toContain("BLOCK NUMBERS");

    t.say("cross out item 2 of block 6", "typed", "command");
    await t.settled();
    const numbered =
      (t.mock.requests[1]?.body["messages"] as { content: string }[]).at(-1)?.content ?? "";
    expect(numbered).toContain("BLOCK NUMBERS");
    expect(numbered).toMatch(/"item 2 of block 6" → \[b6\.2\] "MongoDB"/);
    // After the hints, before what was said.
    expect(numbered.indexOf("BLOCK NUMBERS")).toBeLessThan(numbered.indexOf("UTTERANCE:"));
  });

  it("remembers what it changed, so 'that' means the right block next time", async () => {
    const t = await withDoc([reply(strike), reply(json({ kind: "none", reason: "nothing" }))]);
    t.say("cross out MongoDB", "typed", "command");
    await t.settled();
    t.say("what about that one", "typed", "command");
    await t.settled();
    const second =
      (t.mock.requests[1]?.body["messages"] as { content: string }[]).at(-1)?.content ?? "";
    expect(second).toContain("RECENT_AI_CHANGES: [b6] (crossed out mongodb)");
    expect(second).toContain("- (command) cross out MongoDB");
  });

  it("waits for a yes before throwing something away, and then does it", async () => {
    const t = await withDoc([
      reply(json({ summary: "Removed the table", ops: [{ op: "delete", target: "b4" }] })),
    ]);
    t.say("clean up the comparison", "typed", "command");
    await t.settled();
    expect(t.last()).toMatchObject({
      kind: "proposal",
      summary: "Removed the table",
      reasons: ["delete the table “SQL vs NoSQL”"],
    });
    expect(t.queue.interaction).toEqual({ proposal: true, clarify: false, running: false });
    expect(t.editor.doc.blocks.some((b) => b.id === "t1")).toBe(true);
    t.queue.accept();
    expect(t.editor.doc.blocks.some((b) => b.id === "t1")).toBe(false);
    expect(t.last()).toMatchObject({ kind: "done", summary: "Removed the table" });
    expect(t.transcripts.at(-1)?.status).toBe("applied");
  });

  it("leaves the page alone when a proposal is rejected or ignored", async () => {
    const t = await withDoc([
      reply(json({ summary: "Removed the table", ops: [{ op: "delete", target: "b4" }] })),
    ]);
    t.say("clean up the comparison", "typed", "command");
    await t.settled();
    t.queue.reject();
    expect(t.last()).toEqual({ kind: "idle" });
    expect(t.editor.doc.blocks.some((b) => b.id === "t1")).toBe(true);
    expect(t.transcripts.at(-1)?.status).toBe("rejected");

    t.mock.setScript([
      reply(json({ summary: "Removed the table", ops: [{ op: "delete", target: "b4" }] })),
      reply(json({ kind: "none", reason: "nothing" })),
    ]);
    t.say("clean up the comparison", "typed", "command");
    await t.settled();
    t.say("something else", "typed", "command");
    await t.settled();
    expect(t.transcripts.filter((x) => x.status === "rejected").length).toBeGreaterThanOrEqual(2);
    expect(t.editor.doc.blocks.some((b) => b.id === "t1")).toBe(true);
  });

  it("asks which one, and runs the command again with the answer", async () => {
    const clarify = json({
      kind: "clarify",
      question: "Which connection?",
      options: [
        { label: "Web Server to Redis", ref: "e2" },
        { label: "Web Server to Client", ref: "e5" },
      ],
    });
    const t = await withDoc([
      reply(clarify),
      reply(
        json({
          summary: "Removed it",
          ops: [{ op: "graph.remove", target: "b3", nodes: [], edges: ["e5"] }],
        }),
      ),
    ]);
    t.say("remove the connection to the client", "typed", "command");
    await t.settled();
    expect(t.last()).toMatchObject({ kind: "clarify", question: "Which connection?" });
    expect(t.queue.interaction.clarify).toBe(true);
    t.queue.choose(2);
    await t.settled();
    const second =
      (t.mock.requests[1]?.body["messages"] as { content: string }[]).at(-1)?.content ?? "";
    expect(
      second.endsWith(
        "UTTERANCE:\nremove the connection to the client (I mean: Web Server to Client, e5)",
      ),
    ).toBe(true);
    expect(t.last()).toMatchObject({ kind: "done" });
    // The transcript keeps what was really said.
    expect(t.transcripts.at(-1)?.text).toBe("remove the connection to the client");
  });

  it("offers to add a command that was really notes, as notes", async () => {
    const t = await withDoc([
      reply(json({ kind: "none", reason: "content" })),
      reply("- Entries expire after thirty days"),
    ]);
    t.say("Entries expire after thirty days", "typed", "command");
    await t.settled();
    expect(t.last()).toEqual({ kind: "content", text: "Entries expire after thirty days" });
    t.queue.insertAsContent();
    await t.settled();
    expect(t.editor.doc.blocks.at(-1)?.type).toBe("bulletListItem");
    expect(t.transcripts.at(-1)).toMatchObject({ mode: "input", status: "applied" });
  });

  it("says when there was nothing to do", async () => {
    const t = await withDoc([reply(json({ kind: "none", reason: "There is no such thing." }))]);
    t.say("do the thing", "typed", "command");
    await t.settled();
    expect(t.last()).toMatchObject({
      kind: "done",
      summary: "No change",
      notice: "There is no such thing.",
    });
  });

  it("does not add a failed command as a note, and lets the user try again", async () => {
    const bad = json({ summary: "x", ops: [{ op: "delete", target: "b99" }] });
    const t = await withDoc([reply(bad), reply(bad), reply(strike)]);
    t.say("cross out MongoDB", "typed", "command");
    await t.settled();
    expect(t.last()).toMatchObject({ kind: "failed" });
    expect((t.last() as { message: string }).message).toContain(
      "I couldn't work out how to do that",
    );
    expect(t.editor.doc.blocks).toHaveLength(COMMAND_DOC.blocks.length);
    t.queue.retry();
    await t.settled();
    expect(props(t, "o2")).toEqual({ status: "struck" });
  });

  it("does not join commands the way it joins notes", async () => {
    const t = await withDoc([
      reply(
        json({
          summary: "a",
          ops: [{ op: "set_status", target: "b6.1", in: null, status: "struck" }],
        }),
        { delayMs: 20, chunkChars: 20 },
      ),
      reply(strike),
    ]);
    t.say("cross out PostgreSQL", "typed", "command");
    await new Promise((r) => setTimeout(r, 30));
    t.say("cross out MongoDB", "typed", "command");
    await t.settled();
    expect(t.mock.requests).toHaveLength(2);
    expect(props(t, "o1")).toEqual({ status: "struck" });
    expect(props(t, "o2")).toEqual({ status: "struck" });
  });
});
