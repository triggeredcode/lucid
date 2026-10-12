import { SAMPLE_DOC as COMMAND_DOC } from "@lucid/kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { MemoryBackend } from "./backend";
import { createLucidMcpServer } from "./server";
import { revisionOf } from "./tools";

/** A real MCP client talking to the real server, in memory. */
async function connect(backend: MemoryBackend) {
  const server = createLucidMcpServer(backend);
  const client = new Client({ name: "test-agent", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
    return { text, isError: r.isError === true };
  };
  return { client, call };
}

const setup = () => new MemoryBackend().add("p1", "Request flow and databases", COMMAND_DOC, true);

describe("the MCP server", () => {
  it("offers the tools an agent needs, with read-only ones marked", async () => {
    const { client } = await connect(setup());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "apply_ops",
      "create_document",
      "describe_kit",
      "export_pdf",
      "get_outline",
      "insert_notes",
      "list_documents",
      "list_formats",
      "read_document",
    ]);
    const readOnly = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.readOnlyHint]));
    expect(readOnly).toMatchObject({
      get_outline: true,
      list_documents: true,
      insert_notes: false,
      apply_ops: false,
      export_pdf: false,
    });
    expect(client.getInstructions()).toContain("get_outline");
  });

  it("lists pages and shows the open one's outline with references and a revision", async () => {
    const { call } = await connect(setup());
    expect((await call("list_documents")).text).toContain("p1  ");
    const { text } = await call("get_outline");
    expect(text).toContain('PAGE "Request flow and databases" (id p1, open in Lucid, revision ');
    expect(text).toMatch(/\[b3\].*[Dd]iagram/);
    expect(text).toContain("[b6.2]");
    expect(text).toContain("MongoDB");
  });

  it("reads the page as Lucid Markdown", async () => {
    const { text } = await (await connect(setup())).call("read_document", { page_id: "p1" });
    expect(text).toContain("Caching reduces database load");
    expect(text).toContain("```graph");
  });

  it("describes the kit once: blocks, Lucid Markdown and ops", async () => {
    const { text } = await (await connect(setup())).call("describe_kit");
    expect(text).toContain("BLOCKS");
    expect(text).toContain("LUCID MARKDOWN");
    expect(text).toContain("graph.insert_between");
  });
});

describe("insert_notes", () => {
  it("adds typed blocks at the end by default, as a change made by the agent", async () => {
    const backend = setup();
    const { call } = await connect(backend);
    const r = await call("insert_notes", {
      lmd: "## Eviction\nLRU **evicts** the least recently used key.\n- TTL\n- LFU",
    });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Added 4 blocks");
    const doc = (await backend.getPage("p1")).doc;
    expect(doc.blocks.slice(-4).map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "bulletListItem",
      "bulletListItem",
    ]);
    expect(backend.changes).toEqual([
      expect.objectContaining({ source: "agent:test-agent", summary: "Added 4 blocks" }),
    ]);
  });

  it("places notes after a block, or as more rows of a table (references are those of the page as it is)", async () => {
    const backend = setup();
    const { call } = await connect(backend);
    await call("insert_notes", {
      lmd: "| Property | SQL | NoSQL |\n| --- | --- | --- |\n| Consistency | Strong | Eventual |",
      position: "append_to:b4",
    });
    let doc = (await backend.getPage("p1")).doc;
    const table = doc.blocks.find((b) => b.type === "table");
    expect((table?.props["table"] as { rows: unknown[] }).rows).toHaveLength(4);
    await call("insert_notes", { lmd: "A note after the paragraph.", position: "after:b2" });
    doc = (await backend.getPage("p1")).doc;
    expect(doc.blocks[2]?.type).toBe("paragraph");
    expect(doc.blocks).toHaveLength(COMMAND_DOC.blocks.length + 1);
  });

  it("refuses unreadable notes, bad positions and unknown references, changing nothing", async () => {
    const backend = setup();
    const { call } = await connect(backend);
    const before = revisionOf((await backend.getPage("p1")).doc);
    expect((await call("insert_notes", { lmd: "x", position: "somewhere" })).isError).toBe(true);
    const missing = await call("insert_notes", { lmd: "x", position: "after:b99" });
    expect(missing.isError).toBe(true);
    expect((await call("insert_notes", { lmd: "@@ command" })).isError).toBe(true);
    expect(revisionOf((await backend.getPage("p1")).doc)).toBe(before);
    expect(backend.changes).toEqual([]);
  });

  it("refuses to edit a page that changed since it was read", async () => {
    const backend = setup();
    const { call } = await connect(backend);
    const r = await call("insert_notes", { lmd: "x", revision: "deadbeef" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("changed since you read it");
  });
});

describe("apply_ops", () => {
  it("edits by reference: add a node between two others, strike an item", async () => {
    const backend = setup();
    const { call } = await connect(backend);
    const rev = revisionOf((await backend.getPage("p1")).doc);
    const r = await call("apply_ops", {
      revision: rev,
      summary: "Added a CDN and struck MongoDB",
      ops: [
        {
          op: "graph.insert_between",
          target: "b3",
          from: "client",
          to: "web",
          node: "cdn [cdn]: CDN",
          labels: null,
        },
        { op: "set_status", target: "b6.2", in: null, status: "struck" },
      ],
    });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Added a CDN and struck MongoDB");
    const doc = (await backend.getPage("p1")).doc;
    const graph = doc.blocks.find((b) => b.type === "diagram")?.props["graph"] as {
      nodes: { id: string }[];
    };
    expect(graph.nodes.map((n) => n.id)).toContain("cdn");
    const list = doc.blocks.filter((b) => b.type === "bulletListItem");
    expect(list.map((b) => b.props["status"])).toContain("struck");
    expect(backend.changes).toHaveLength(1);
  });

  it("refuses ops that throw content away unless the agent says so", async () => {
    const backend = setup();
    const { call } = await connect(backend);
    const ops = [{ op: "delete", target: "b4" }];
    const refused = await call("apply_ops", { ops });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("throw something away");
    expect((await backend.getPage("p1")).doc.blocks.some((b) => b.type === "table")).toBe(true);
    const allowed = await call("apply_ops", { ops, allow_destructive: true });
    expect(allowed.isError).toBe(false);
    expect((await backend.getPage("p1")).doc.blocks.some((b) => b.type === "table")).toBe(false);
  });

  it("explains a bad reference in plain words and applies nothing, all or none", async () => {
    const backend = setup();
    const { call } = await connect(backend);
    const before = revisionOf((await backend.getPage("p1")).doc);
    const r = await call("apply_ops", {
      ops: [
        { op: "set_status", target: "b6.2", in: null, status: "struck" },
        { op: "set_status", target: "b99", in: null, status: "struck" },
      ],
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("b99");
    expect(r.text).toContain("There is no");
    expect(revisionOf((await backend.getPage("p1")).doc)).toBe(before);
  });

  it("rejects malformed ops before they reach the page", async () => {
    const { client } = await connect(setup());
    const r = await client.callTool({
      name: "apply_ops",
      arguments: { ops: [{ op: "explode", target: "b1" }] },
    });
    expect(r.isError).toBe(true);
  });
});

describe("note formats", () => {
  it("lists the formats with their sections, hints and the fields under the title", async () => {
    const { text } = await (await connect(setup())).call("list_formats");
    for (const id of ["concept-note", "system-design", "comparison"])
      expect(text).toContain(`${id}: `);
    expect(text).not.toContain("benchmark");
    expect(text).toContain("fields under the title: Source, Date");
    expect(text).toContain(
      "  - Options: The candidates; cross out what is dropped. Suits: bulletListItem.",
    );
  });

  it("creates a blank page or a format page, which then shows its sections in the outline", async () => {
    const backend = setup();
    const { call } = await connect(backend);
    const blank = await call("create_document", { title: "Scratch" });
    expect(blank.isError).toBe(false);
    expect(blank.text).toContain("blank");
    const made = await call("create_document", { title: "Kafka vs SQS", format: "comparison" });
    expect(made.isError).toBe(false);
    const id = /id (page-\d+)/.exec(made.text)?.[1] ?? "";
    const outline = (await call("get_outline", { page_id: id })).text;
    expect(outline).toContain(`format comparison`);
    expect(outline).toContain("SECTIONS of this comparison");
    expect(outline).toContain("[b2]");
    // Notes go under a section by name.
    const added = await call("insert_notes", {
      page_id: id,
      lmd: "- Kafka\n- SQS",
      position: "section:Options",
    });
    expect(added.isError).toBe(false);
    const doc = (await backend.getPage(id)).doc;
    expect(doc.blocks.map((b) => b.type)).toEqual([
      "heading",
      "heading",
      "bulletListItem",
      "bulletListItem",
      "heading",
      "heading",
      "heading",
    ]);
  });

  it("refuses a format that does not exist, and creates nothing", async () => {
    const backend = setup();
    const { call } = await connect(backend);
    const r = await call("create_document", { title: "X", format: "essay" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("concept-note, system-design");
    expect((await backend.listPages()).map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("export_pdf", () => {
  it("makes the PDF of the open page, or of the one asked for, and reports where it is", async () => {
    const backend = setup().add("p2", "Closed page", COMMAND_DOC);
    const { call } = await connect(backend);
    const open = await call("export_pdf");
    expect(open.isError).toBe(false);
    expect(open.text).toBe(
      "Saved the PDF (51 KB): /library/exports/Request flow and databases.pdf",
    );
    expect((await call("export_pdf", { page_id: "p2" })).text).toContain("Closed page.pdf");
    expect(backend.exports).toEqual(["p1", "p2"]);
  });

  it("does not change the page", async () => {
    const backend = setup();
    const { call } = await connect(backend);
    const before = (await call("get_outline")).text;
    await call("export_pdf");
    expect((await call("get_outline")).text).toBe(before);
    expect(backend.changes).toEqual([]);
  });

  it("says so for a page that is not there", async () => {
    const r = await (await connect(setup())).call("export_pdf", { page_id: "nope" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('There is no page "nope"');
  });
});

describe("a page that is not there", () => {
  it("says so, for a wrong id and for no open page", async () => {
    const { call } = await connect(new MemoryBackend().add("p1", "Closed", COMMAND_DOC));
    expect((await call("get_outline", { page_id: "nope" })).text).toContain(
      'There is no page "nope"',
    );
    const r = await call("get_outline");
    expect(r.isError).toBe(true);
    expect(r.text).toContain("No page is open");
  });
});
