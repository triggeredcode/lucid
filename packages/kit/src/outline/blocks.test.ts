import { buildRefMap, type Block, type LucidDoc } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { blockMentionNotes, describeBlocks, parseBlockMentions } from "./blocks";

const run = (text: string) => ({ type: "text" as const, text, styles: {} });
const heading = (id: string, text: string): Block => ({
  id,
  type: "heading",
  props: { level: 2 },
  content: [run(text)],
});
const paragraph = (id: string, text: string): Block => ({
  id,
  type: "paragraph",
  props: {},
  content: [run(text)],
});
const item = (
  id: string,
  text: string,
  type = "bulletListItem",
  children: Block[] = [],
): Block => ({
  id,
  type: type as Block["type"],
  props: {},
  content: [run(text)],
  children,
});
const table: Block = {
  id: "tb",
  type: "table",
  props: {
    caption: "SQL vs NoSQL",
    table: {
      headerColumn: true,
      columns: [
        { id: "c1", name: "Property", status: "normal" },
        { id: "c2", name: "SQL", status: "normal" },
        { id: "c3", name: "NoSQL", status: "normal" },
      ],
      rows: [
        { id: "r1", cells: ["Schema", "Fixed", "Flexible"], status: "normal" },
        { id: "r2", cells: ["Scaling", "Vertical", "Horizontal"], status: "normal" },
      ],
    },
  },
};
const node = (id: string, label: string) => ({ id, label, kind: "service", status: "normal" });
const diagram: Block = {
  id: "dg",
  type: "diagram",
  props: {
    caption: "",
    graph: {
      type: "flowchart",
      direction: "LR",
      title: "Request flow",
      nodes: [node("client", "Client"), node("dns", "DNS"), node("cache", "Cache")],
      edges: [
        {
          id: "e1",
          from: "client",
          to: "dns",
          label: "resolve",
          arrow: "directed",
          style: "solid",
          status: "normal",
        },
        {
          id: "e2",
          from: "client",
          to: "cache",
          arrow: "directed",
          style: "solid",
          status: "normal",
        },
      ],
      groups: [],
      fragments: [],
    },
  },
};

// 1 heading, 2 paragraph, 3 bullets (three items, the second with a sub-item), 4 table, 5 diagram, 6 numbered list
const doc: LucidDoc = {
  blocks: [
    heading("h", "Caching"),
    paragraph("p", "A cache hit costs microseconds, a miss costs a database round trip."),
    item("l1", "Redis"),
    item("l2", "Memcached", "bulletListItem", [item("l2a", "Local LRU")]),
    item("l3", "Local LRU"),
    table,
    diagram,
    item("n1", "Client to DNS server", "numberedListItem"),
    item("n2", "DNS gives back the IP address", "numberedListItem"),
  ],
};

describe("describeBlocks", () => {
  const infos = describeBlocks(doc);

  it("numbers the blocks as the model's outline does: a list is one block, a table is one, a diagram is one", () => {
    expect(infos.map((b) => [b.n, b.ref, b.kind])).toEqual([
      [1, "b1", "heading"],
      [2, "b2", "paragraph"],
      [3, "b3", "list"],
      [4, "b4", "table"],
      [5, "b5", "diagram"],
      [6, "b6", "list"],
    ]);
    expect(infos[2]?.ids).toEqual(["l1", "l2", "l3"]);
    expect(infos[5]?.ids).toEqual(["n1", "n2"]);
    const refMap = buildRefMap(doc);
    for (const b of infos) expect(refMap.resolve(b.ref), b.ref).toBeDefined();
    // The block of a block id is the one the reference map gives it.
    expect(refMap.refOf("tb")).toBe("b4");
  });

  it("starts a new block when the kind of list changes, and has none for an empty page", () => {
    expect(infos[2]?.kind).toBe("list");
    expect(
      describeBlocks({ blocks: [item("a", "x"), item("b", "y", "numberedListItem")] }).map(
        (b) => b.ref,
      ),
    ).toEqual(["b1", "b2"]);
    expect(describeBlocks({ blocks: [] })).toEqual([]);
  });

  it("says what each block is in a few words", () => {
    expect(infos.map((b) => b.label)).toEqual([
      "Caching",
      "A cache hit costs microseconds, a miss…",
      "3 items",
      "SQL vs NoSQL",
      "Request flow",
      "2 items",
    ]);
  });

  it("gives a list its items, and the items their sub-items, with the references the model uses", () => {
    const items = infos[2]?.groups[0];
    expect(items?.title).toBe("Items");
    expect(items?.items.map((i) => [i.n, i.ref, i.label])).toEqual([
      [1, "b3.1", "Redis"],
      [2, "b3.2", "Memcached"],
      [3, "b3.3", "Local LRU"],
    ]);
    expect(infos[2]?.groups[1]?.items.map((i) => [i.ref, i.label])).toEqual([
      ["b3.2.1", "Local LRU"],
    ]);
  });

  it("gives a table its rows from the top and its columns from the left, with their ids", () => {
    const [columns, rows] = infos[3]?.groups ?? [];
    expect(columns?.items.map((c) => [c.n, c.id, c.label])).toEqual([
      [1, "c1", "Property"],
      [2, "c2", "SQL"],
      [3, "c3", "NoSQL"],
    ]);
    expect(rows?.items.map((r) => [r.n, r.id, r.label])).toEqual([
      [1, "r1", "Schema"],
      [2, "r2", "Scaling"],
    ]);
  });

  it("gives a diagram its parts and connections in the order the builder numbers them", () => {
    const [parts, links] = infos[4]?.groups ?? [];
    expect(parts?.items.map((p) => [p.n, p.id, p.label])).toEqual([
      [1, "client", "Client"],
      [2, "dns", "DNS"],
      [3, "cache", "Cache"],
    ]);
    expect(links?.items.map((l) => [l.n, l.id, l.label])).toEqual([
      [1, "e1", "Client → DNS: resolve"],
      [2, "e2", "Client → Cache"],
    ]);
  });
});

describe("parseBlockMentions", () => {
  const blocks = (text: string) => parseBlockMentions(text).map((m) => m.block);

  it.each([
    ["In block 3 rename Redis to Cache", [3]],
    ["in block three, add a row", [3]],
    ["Block number 4: make it bold", [4]],
    ["B5 needs a title", [5]],
    ["in the third block add a row", [3]],
    ["look at the first block", [1]],
    ["merge blocks 2 and 3", [2, 3]],
    ["add a heading above the last block", ["last"]],
    ["add a cache to the block diagram", []],
    ["the last block diagram is too wide", []],
    ["the first block chart looks odd", []],
    ["these are the building blocks of the system", []],
    ["nothing numbered here", []],
  ])("%j", (text, expected) => {
    expect(blocks(text)).toEqual(expected);
  });

  it.each([
    ["item 2 of block 3", { block: 3, kind: "item", n: 2 }],
    ["block 3 item 2", { block: 3, kind: "item", n: 2 }],
    ["row two in block 4", { block: 4, kind: "row", n: 2 }],
    ["column 3 of block 4", { block: 4, kind: "column", n: 3 }],
    ["node 2 of the fifth block", { block: 5, kind: "node", n: 2 }],
    ["connection 1 in block 5", { block: 5, kind: "connection", n: 1 }],
    ["step 4 of block 6", { block: 6, kind: "item", n: 4 }],
  ])("%j has a part", (text, expected) => {
    const [m] = parseBlockMentions(text);
    expect(m).toMatchObject({
      block: expected.block,
      part: { kind: expected.kind, n: expected.n },
    });
    expect(parseBlockMentions(text)).toHaveLength(1);
  });
});

describe("blockMentionNotes", () => {
  it("says nothing when no block is named", () => {
    expect(blockMentionNotes(doc, "add a cache between the client and DNS")).toEqual([]);
  });

  it("tells the model which reference a number is, with what it holds", () => {
    const notes = blockMentionNotes(doc, "In block 4, add a row for consistency").join("\n");
    expect(notes).toContain("the page margin");
    expect(notes).toContain('"block 4" → [b4] table "SQL vs NoSQL"');
  });

  it("resolves the parts a person names", () => {
    const n = (text: string) => blockMentionNotes(doc, text).join("\n");
    expect(n("rename item 2 of block 3")).toContain('→ [b3.2] "Memcached"');
    expect(n("fill row 2 of block 4")).toContain('row r2 ("Scaling") of the table [b4]');
    expect(n("delete column 3 of block 4")).toContain('column c3 ("NoSQL") of the table [b4]');
    expect(n("rename node 3 of block 5 to Redis")).toContain(
      'part "cache" ("Cache") of the diagram [b5]',
    );
    expect(n("reverse connection 1 in block 5")).toContain(
      "connection e1 (Client → DNS: resolve) of the diagram [b5]",
    );
  });

  it("knows the last block", () => {
    expect(blockMentionNotes(doc, "add a heading after the last block").join("\n")).toContain(
      "[b6]",
    );
  });

  it("says when there is no such block or part, so the model asks instead of guessing", () => {
    const n = (text: string) => blockMentionNotes(doc, text).join("\n");
    expect(n("in block 9 add a note")).toContain(
      "there is no block 9: the page has 6 blocks (b1 to b6)",
    );
    expect(n("row 7 of block 4")).toContain("the table has 2 rows");
    expect(n("node 1 of block 4")).toContain("block 4 is a table, not a diagram");
    expect(n("item 1 of block 2")).toContain("block 2 is a paragraph, not a list");
  });

  it("is quiet on an empty page", () => {
    expect(blockMentionNotes({ blocks: [] }, "in block 1 add a note").join("\n")).toContain(
      "the page has no blocks",
    );
  });
});
