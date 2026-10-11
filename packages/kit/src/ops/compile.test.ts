import {
  GraphSchema,
  TableSchema,
  applyPatch,
  buildRefMap,
  createSequentialIds,
  findDuplicateIds,
  type Block,
  type LucidDoc,
  type Op,
} from "@lucid/core";
import { bullets, doc, h1, h2, p } from "@lucid/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { registry } from "../index";
import { inlineToPlain } from "../text";
import { compileOps, OpError } from "./compile";

const fx = (type: Block["type"], id: string): Block => {
  const found = registry.get(type).fixtures.find((f) => f.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

/** b1 title, b2 Requirements, b3 bullets, b4 paragraph, b5 diagram, b6 table, b7 callout, b8 options (3 bullets). */
const sample = (): LucidDoc => {
  const base = doc(
    h1("Designing a URL shortener", { id: "h1" }),
    h2("Requirements", { id: "h2" }),
    bullets("100M new URLs per day", "Reads far outnumber writes", "Custom aliases"),
    p("Redis stores hot keys so most reads never reach PostgreSQL.", { id: "p1" }),
  );
  const options = doc(
    ...bullets(
      { text: "PostgreSQL", id: "o1" },
      { text: "MongoDB", id: "o2" },
      { text: "DynamoDB", id: "o3" },
    ),
  );
  return {
    blocks: [
      ...base.blocks,
      fx("diagram", "fx-diagram-1"),
      fx("table", "fx-table-1"),
      fx("callout", "fx-callout-1"),
      ...options.blocks,
    ],
  };
};

const run = (ops: Op[], d = sample()) => compileOps(d, ops, { ids: createSequentialIds("n") });
const byId = (d: LucidDoc, id: string): Block => {
  const found = d.blocks.find((b) => b.id === id);
  if (!found) throw new Error(`no block ${id}`);
  return found;
};
const graphOf = (d: LucidDoc) => GraphSchema.parse(byId(d, "fx-diagram-1").props["graph"]);
const tableOf = (d: LucidDoc) => TableSchema.parse(byId(d, "fx-table-1").props["table"]);
const text = (b: Block) => inlineToPlain(b.content);

describe("the worked examples", () => {
  it("adds a CDN in front of the web server", () => {
    const r = run([
      {
        op: "graph.insert_between",
        target: "b5",
        from: "client",
        to: "web",
        node: "cdn [cdn]: CDN",
        labels: null,
      },
    ]);
    const g = graphOf(r.next);
    expect(g.nodes.map((n) => n.id)).toContain("cdn");
    expect(g.edges.some((e) => e.from === "client" && e.to === "cdn")).toBe(true);
    expect(g.edges.some((e) => e.from === "cdn" && e.to === "web")).toBe(true);
    expect(g.edges.some((e) => e.from === "client" && e.to === "web")).toBe(false);
    expect(r.affected).toEqual(["fx-diagram-1"]);
  });

  it("adds a row to the table", () => {
    const r = run([
      {
        op: "table.add_row",
        target: "b6",
        after: "r3",
        cells: ["Consistency", "Strong", "Tunable"],
      },
    ]);
    const t = tableOf(r.next);
    expect(t.rows.map((row) => row.cells[0])).toEqual([
      "Schema",
      "Relationships",
      "Scaling",
      "Consistency",
      "Use cases",
    ]);
    expect(r.patch.steps).toHaveLength(1);
  });

  it("crosses out two alternatives and chooses the third", () => {
    const r = run([
      { op: "set_status", target: "b8.1", in: null, status: "struck" },
      { op: "set_status", target: "b8.2", in: null, status: "struck" },
      { op: "set_status", target: "b8.3", in: null, status: "chosen" },
    ]);
    expect(["o1", "o2", "o3"].map((id) => byId(r.next, id).props["status"])).toEqual([
      "struck",
      "struck",
      "chosen",
    ]);
    expect(text(byId(r.next, "o1"))).toBe("PostgreSQL");
    expect(r.affected.sort()).toEqual(["o1", "o2", "o3"]);
  });

  it("makes the first sentence a heading, keeping the paragraph's id for the first new block", () => {
    const r = run([
      {
        op: "replace",
        target: "b4",
        lmd: "### Caching reduces database load\nRedis stores hot keys so most reads never reach PostgreSQL.",
      },
    ]);
    const at = r.next.blocks.findIndex((b) => b.id === "p1");
    expect(r.next.blocks[at]).toMatchObject({ type: "heading", props: { level: 3 } });
    expect(r.next.blocks[at + 1]?.type).toBe("paragraph");
  });

  it("shows the cache-hit path separately with graph.patch", () => {
    const r = run([
      { op: "graph.patch", target: "b5", lines: ["redis -> web: cache hit: cached data"] },
    ]);
    expect(
      graphOf(r.next).edges.some(
        (e) => e.from === "redis" && e.to === "web" && e.label === "cache hit: cached data",
      ),
    ).toBe(true);
    expect(graphOf(r.next).nodes).toHaveLength(6);
  });
});

describe("the kind a name gives away (Kafka is a queue, CloudFront a CDN)", () => {
  const kindsOf = (d: LucidDoc) => Object.fromEntries(graphOf(d).nodes.map((n) => [n.id, n.kind]));

  it("a node a patch adds as a plain service is drawn as what it is; the ones already there are left alone", () => {
    const r = run([
      {
        op: "graph.patch",
        target: "b5",
        lines: [
          "kafka [service]: Kafka",
          "consumer [service]: Kafka consumer",
          "web -> kafka: publish order",
          "kafka -> consumer: deliver",
        ],
      },
    ]);
    expect(kindsOf(r.next)).toMatchObject({
      kafka: "queue",
      consumer: "service",
      web: "service",
      redis: "cache",
      pg: "datastore",
    });
  });

  it("a node with no kind is guessed from its name", () => {
    const r = run([{ op: "graph.patch", target: "b5", lines: ["s3 -> web: files", "s3: S3"] }]);
    expect(kindsOf(r.next)["s3"]).toBe("storage");
  });

  it("a kind that was chosen stays", () => {
    const r = run([
      { op: "graph.patch", target: "b5", lines: ["kafka [datastore]: Kafka", "web -> kafka"] },
    ]);
    expect(kindsOf(r.next)["kafka"]).toBe("datastore");
  });

  it("insert_between refines the new node too", () => {
    const r = run([
      {
        op: "graph.insert_between",
        target: "b5",
        from: "client",
        to: "web",
        node: "lb [service]: Load Balancer",
        labels: null,
      },
    ]);
    expect(kindsOf(r.next)["lb"]).toBe("loadbalancer");
  });
});

describe("blocks and text", () => {
  it("inserts notes after a block, before one, at a section's start and end, and at the end", () => {
    const at = (pos: Extract<Op, { op: "insert" }>["at"]) =>
      run([{ op: "insert", at: pos, lmd: "New note" }]).next.blocks.map((b) => b.id);
    const after = at({ after: "b4" });
    expect(after[after.indexOf("p1") + 1]).toBe("n1");
    const before = at({ before: "b4" });
    expect(before[before.indexOf("p1") - 1]).toBe("n1");
    expect(at({ start_of_section: "b2" }).slice(0, 3)).toEqual(["h1", "h2", "n1"]);
    expect(at({ end_of_section: "b2" }).at(-1)).toBe("n1");
    expect(at({ end: true }).at(-1)).toBe("n1");
  });

  it("inserts new list items after a list item", () => {
    const r = run([{ op: "insert", at: { after: "b3.2" }, lmd: "- Rate limiting" }]);
    const items = r.next.blocks.slice(2, 6).map(text);
    expect(items).toEqual([
      "100M new URLs per day",
      "Reads far outnumber writes",
      "Rate limiting",
      "Custom aliases",
    ]);
  });

  it("deletes a block, a list item and a whole list", () => {
    expect(run([{ op: "delete", target: "b4" }]).next.blocks.some((b) => b.id === "p1")).toBe(
      false,
    );
    expect(
      run([{ op: "delete", target: "b3.1" }]).next.blocks.filter((b) => b.type === "bulletListItem")
        .length,
    ).toBe(5);
    expect(
      run([{ op: "delete", target: "b3" }])
        .next.blocks.slice(0, 3)
        .map((b) => b.id),
    ).toEqual(["h1", "h2", "p1"]);
  });

  it("moves a block, and a whole list", () => {
    const r = run([{ op: "move", target: "b5", to: { before: "b4" } }]);
    const order = r.next.blocks.map((b) => b.id);
    expect(order.indexOf("fx-diagram-1")).toBe(order.indexOf("p1") - 1);
    const list = run([{ op: "move", target: "b3", to: { after: "b4" } }]).next.blocks.map(
      (b) => b.id,
    );
    expect(list.slice(2, 3)).toEqual(["p1"]);
    expect(
      run([{ op: "move", target: "b4", to: { after: "b4" } }].slice(0, 0) as Op[]).next,
    ).toBeDefined();
    expect(() => run([{ op: "move", target: "b4", to: { after: "b4" } }])).toThrow(
      /next to itself/,
    );
  });

  it("archives a block under an Archive section it creates", () => {
    const r = run([{ op: "archive", target: "b4" }]);
    const order = r.next.blocks;
    const archive = order.findIndex((b) => b.type === "heading" && text(b) === "Archive");
    expect(archive).toBeGreaterThan(0);
    expect(order[archive + 1]?.id).toBe("p1");
    // A second archive goes into the same section.
    const again = compileOps(r.next, [{ op: "archive", target: "b2" }], {
      ids: createSequentialIds("m"),
    });
    expect(
      again.next.blocks.filter((b) => b.type === "heading" && text(b) === "Archive"),
    ).toHaveLength(1);
  });

  it("changes a block's type, keeping its words", () => {
    const h = run([{ op: "set_type", target: "b4", type: "h2" }]).next.blocks.find(
      (b) => b.id === "p1",
    );
    expect(h).toMatchObject({ type: "heading", props: { level: 2 } });
    expect(text(h as Block)).toContain("Redis stores");
    const bullet = run([{ op: "set_type", target: "b2", type: "bullet" }]).next.blocks[1];
    expect(bullet?.type).toBe("bulletListItem");
    const callout = run([
      { op: "set_type", target: "b4", type: "callout_warning" },
    ]).next.blocks.find((b) => b.id === "p1");
    expect(callout).toMatchObject({
      type: "callout",
      props: {
        kind: "warning",
        title: "Redis stores hot keys so most reads never reach PostgreSQL.",
      },
    });
    const all = run([{ op: "set_type", target: "b3", type: "numbered" }]).next.blocks.slice(2, 5);
    expect(all.map((b) => b.type)).toEqual([
      "numberedListItem",
      "numberedListItem",
      "numberedListItem",
    ]);
    expect(() => run([{ op: "set_type", target: "b5", type: "paragraph" }])).toThrow(
      /cannot be turned/,
    );
  });

  it("marks a phrase, aliases included, and refuses a phrase that is not there", () => {
    const r = run([{ op: "mark", target: "b4", match: "Postgres", mark: "strike", on: true }]);
    const runs = byId(r.next, "p1").content ?? [];
    expect(
      runs.map((x) => (x.type === "text" ? [x.text, x.styles.strike === true] : null)),
    ).toEqual([
      ["Redis stores hot keys so most reads never reach ", false],
      ["PostgreSQL", true],
      [".", false],
    ]);
    const off = compileOps(r.next, [
      { op: "mark", target: "b4", match: "PostgreSQL", mark: "strike", on: false },
    ]);
    expect(byId(off.next, "p1").content).toHaveLength(1);
    expect(() =>
      run([{ op: "mark", target: "b4", match: "Cassandra", mark: "bold", on: true }]),
    ).toThrow(/was not found in b4/);
    expect(() => run([{ op: "mark", target: "b5", match: null, mark: "bold", on: true }])).toThrow(
      /only apply to text/,
    );
    const whole = run([{ op: "mark", target: "b4", match: null, mark: "bold", on: true }]);
    expect(
      byId(whole.next, "p1").content?.every((x) => x.type === "text" && x.styles.bold === true),
    ).toBe(true);
  });

  it("converts a list into a table, keeping the first block's id", () => {
    const lmd =
      "Table: Options\n| Option | Verdict |\n| --- | --- |\n| PostgreSQL | no |\n| DynamoDB | yes |";
    const r = run([{ op: "convert", targets: ["b8"], to: "table", lmd }]);
    const table = r.next.blocks.find((b) => b.id === "o1");
    expect(table?.type).toBe("table");
    expect(r.next.blocks.some((b) => b.id === "o2" || b.id === "o3")).toBe(false);
    expect(() =>
      run([{ op: "convert", targets: ["b8"], to: "table", lmd: "just a paragraph" }]),
    ).toThrow(/must produce table/);
  });

  it("rejects notes that are not valid LMD, in words", () => {
    expect(() => run([{ op: "insert", at: { end: true }, lmd: "```graph\nweb ->\n```" }])).toThrow(
      /insert: line/,
    );
  });
});

describe("status on blocks", () => {
  it("treats normal as no status, so setting it on a normal block changes nothing", () => {
    expect(
      run([{ op: "set_status", target: "b8.2", in: null, status: "normal" }]).patch.steps,
    ).toEqual([]);
    const struck = run([{ op: "set_status", target: "b8.2", in: null, status: "struck" }]).next;
    const back = compileOps(struck, [
      { op: "set_status", target: "b8.2", in: null, status: "normal" },
    ]).next;
    expect(byId(back, "o2").props).toEqual({});
  });
});

describe("status on rows, columns, nodes and edges", () => {
  it("finds the owner by id, or by `in`", () => {
    const row = run([{ op: "set_status", target: "r3", in: null, status: "struck" }]);
    expect(tableOf(row.next).rows.find((r) => r.id === "r3")?.status).toBe("struck");
    const node = run([{ op: "set_status", target: "pg", in: "b5", status: "struck" }]);
    expect(graphOf(node.next).nodes.find((n) => n.id === "pg")?.status).toBe("struck");
    const edge = run([{ op: "set_status", target: "e5", in: null, status: "chosen" }]);
    expect(graphOf(edge.next).edges.find((e) => e.id === "e5")?.status).toBe("chosen");
    const col = run([{ op: "set_status", target: "c3", in: "b6", status: "struck" }]);
    expect(tableOf(col.next).columns.find((c) => c.id === "c3")?.status).toBe("struck");
  });

  it("says when an id is nowhere, or in two places", () => {
    expect(() => run([{ op: "set_status", target: "nope", in: null, status: "struck" }])).toThrow(
      /no block, row, column, node or edge called nope/,
    );
    const second: Block = { ...fx("table", "fx-table-1"), id: "t2" };
    expect(() =>
      run([{ op: "set_status", target: "r1", in: null, status: "struck" }], {
        blocks: [...sample().blocks, second],
      }),
    ).toThrow(/more than one place/);
  });
});

describe("diagram ops", () => {
  it("renames, reverses, removes, groups, ungroups and sets meta", () => {
    expect(
      graphOf(
        run([{ op: "graph.rename", target: "b5", node: "web", label: "API Gateway" }]).next,
      ).nodes.find((n) => n.id === "web")?.label,
    ).toBe("API Gateway");
    const rev = graphOf(run([{ op: "graph.reverse", target: "b5", edge: "e5" }]).next).edges.find(
      (e) => e.id === "e5",
    );
    expect(rev).toMatchObject({ from: "redis", to: "web" });
    const removed = graphOf(
      run([{ op: "graph.remove", target: "b5", nodes: ["dns"], edges: [] }]).next,
    );
    expect(removed.nodes.some((n) => n.id === "dns")).toBe(false);
    expect(removed.edges.every((e) => e.from !== "dns" && e.to !== "dns")).toBe(true);
    const grouped = graphOf(
      run([{ op: "graph.group", target: "b5", group: "group edge: Edge { client, dns }" }]).next,
    );
    expect(grouped.groups.some((g) => g.id === "edge")).toBe(true);
    const ungrouped = graphOf(run([{ op: "graph.ungroup", target: "b5", group: "app" }]).next);
    expect(ungrouped.groups.some((g) => g.id === "app")).toBe(false);
    const meta = graphOf(
      run([{ op: "graph.set", target: "b5", direction: "TB", title: "Flow", type: null }]).next,
    );
    expect(meta).toMatchObject({ direction: "TB", title: "Flow", type: "flowchart" });
  });

  it("reports problems the model can fix", () => {
    expect(() => run([{ op: "graph.rename", target: "b5", node: "ghost", label: "x" }])).toThrow(
      /ghost/,
    );
    expect(() =>
      run([
        {
          op: "graph.insert_between",
          target: "b5",
          from: "user",
          to: "pg",
          node: "cdn [cdn]: CDN",
          labels: null,
        },
      ]),
    ).toThrow(OpError);
    expect(() =>
      run([
        {
          op: "graph.insert_between",
          target: "b5",
          from: "client",
          to: "web",
          node: "not a node",
          labels: null,
        },
      ]),
    ).toThrow(/node declaration/);
    expect(() => run([{ op: "graph.patch", target: "b5", lines: ["web ->"] }])).toThrow(/line 1/);
    expect(() => run([{ op: "graph.patch", target: "b4", lines: ["a -> b"] }])).toThrow(
      /is a paragraph, not a diagram/,
    );
  });
});

describe("table ops", () => {
  it("covers the whole table op set", () => {
    const cells = run([
      {
        op: "table.set_cells",
        target: "b6",
        row: "r1",
        cells: [{ col: "c2", text: "Fixed schema" }],
      },
    ]);
    expect(tableOf(cells.next).rows[0]?.cells[1]).toBe("Fixed schema");
    const col = tableOf(
      run([
        {
          op: "table.add_column",
          target: "b6",
          name: "Graph DB",
          after: "end",
          cells: ["Flexible", "Edges", "Scale up", "Traversals"],
        },
      ]).next,
    );
    expect(col.columns.map((c) => c.name)).toEqual(["Property", "SQL", "NoSQL", "Graph DB"]);
    expect(
      tableOf(
        run([{ op: "table.rename_column", target: "b6", col: "c2", name: "Relational" }]).next,
      ).columns[1]?.name,
    ).toBe("Relational");
    expect(
      tableOf(run([{ op: "table.remove_column", target: "b6", col: "c3" }]).next).columns,
    ).toHaveLength(2);
    expect(
      tableOf(run([{ op: "table.move_column", target: "b6", col: "c3", after: "start" }]).next)
        .columns[0]?.id,
    ).toBe("c3");
    expect(
      tableOf(run([{ op: "table.remove_row", target: "b6", row: "r2" }]).next).rows,
    ).toHaveLength(3);
    expect(
      tableOf(run([{ op: "table.move_row", target: "b6", row: "r4", after: "start" }]).next).rows[0]
        ?.id,
    ).toBe("r4");
    expect(
      byId(
        run([{ op: "table.set_caption", target: "b6", caption: "Comparison" }]).next,
        "fx-table-1",
      ).props["caption"],
    ).toBe("Comparison");
  });

  it("explains table problems", () => {
    expect(() =>
      run([{ op: "table.add_row", target: "b6", after: "r9", cells: ["a", "b", "c"] }]),
    ).toThrow(/r9/);
    expect(() =>
      run([{ op: "table.add_row", target: "b6", after: "end", cells: ["a", "b", "c", "d"] }]),
    ).toThrow(OpError);
    expect(() => run([{ op: "table.remove_row", target: "b5", row: "r1" }])).toThrow(
      /is a diagram, not a table/,
    );
  });
});

describe("references", () => {
  it("rejects references that do not exist, and ones an earlier step removed", () => {
    expect(() => run([{ op: "delete", target: "b99" }])).toThrow(/There is no block b99/);
    expect(() =>
      run([
        { op: "delete", target: "b4" },
        { op: "mark", target: "b4", match: null, mark: "bold", on: true },
      ]),
    ).toThrow(/Step 2 .*already removed/);
    expect(() =>
      run([
        { op: "set_status", target: "b3", in: null, status: "struck" },
        { op: "mark", target: "b3", match: "x", mark: "bold", on: true },
      ]),
    ).toThrow(OpError);
  });

  it("asks for a single item when a list is given where one block is needed", () => {
    expect(() => run([{ op: "graph.patch", target: "b3", lines: ["a"] }])).toThrow(
      /list of 3 items/,
    );
  });

  it("resolves every reference against the document the model was shown, even after earlier steps", () => {
    const r = run([
      { op: "delete", target: "b4" },
      { op: "table.add_row", target: "b6", after: "end", cells: ["x", "y", "z"] },
      { op: "set_status", target: "b8.1", in: null, status: "struck" },
    ]);
    expect(tableOf(r.next).rows).toHaveLength(5);
    expect(byId(r.next, "o1").props["status"]).toBe("struck");
  });
});

describe("guarantees", () => {
  const scenarios: Op[][] = [
    [{ op: "set_status", target: "b8.2", in: null, status: "struck" }],
    [
      { op: "table.add_row", target: "b6", after: "r2", cells: ["a", "b", "c"] },
      { op: "delete", target: "b7" },
    ],
    [
      {
        op: "graph.insert_between",
        target: "b5",
        from: "client",
        to: "web",
        node: "cdn [cdn]: CDN",
        labels: null,
      },
      { op: "move", target: "b5", to: { after: "b2" } },
    ],
    [
      { op: "insert", at: { after: "b3.1" }, lmd: "- x\n- y" },
      { op: "replace", target: "b4", lmd: "## New\nBody" },
    ],
  ];
  it.each(scenarios.map((ops, i) => [i, ops] as const))(
    "scenario %i leaves unrelated blocks alone, applies as a patch, and keeps ids unique",
    (_i, ops) => {
      const d = sample();
      const r = compileOps(d, ops, { ids: createSequentialIds("n") });
      // The patch reproduces the result.
      expect(applyPatch(d, r.patch)).toEqual(r.next);
      expect(findDuplicateIds(r.next)).toEqual([]);
      // Blocks the ops did not touch are unchanged.
      const touched = new Set(r.affected);
      const removed = new Set(r.patch.steps.flatMap((s) => (s.kind === "remove" ? [s.id] : [])));
      for (const b of d.blocks) {
        if (touched.has(b.id) || removed.has(b.id)) continue;
        expect(r.next.blocks.find((x) => x.id === b.id)).toEqual(b);
      }
      // The input document is untouched.
      expect(d).toEqual(sample());
      expect(buildRefMap(d).refs.length).toBeGreaterThan(8);
    },
  );
});

describe("random op sequences (property)", () => {
  const ref = fc.constantFrom(
    "b1",
    "b2",
    "b3",
    "b3.1",
    "b3.3",
    "b4",
    "b5",
    "b6",
    "b7",
    "b7.1",
    "b8",
    "b8.2",
    "b9",
    "b3.9",
  );
  const slug = fc.constantFrom("user", "client", "dns", "web", "redis", "pg", "ghost");
  const anchor = fc.constantFrom("start", "end", "r1", "r2", "r4", "r9", "c1", "c2", "c3", "c9");
  const pos = fc.oneof(
    ref.map((r) => ({ after: r })),
    ref.map((r) => ({ before: r })),
    ref.map((r) => ({ start_of_section: r })),
    ref.map((r) => ({ end_of_section: r })),
    fc.constant({ end: true as const }),
  );
  const lmd = fc.constantFrom(
    "Hello",
    "- a\n- b",
    "## Head\nBody",
    "1. one",
    "$$\nx^2\n$$",
    "Table: T\n| A | B |\n| --- | --- |\n| 1 | 2 |",
  );
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ op: fc.constant("insert" as const), at: pos, lmd }),
    fc.record({ op: fc.constant("replace" as const), target: ref, lmd }),
    fc.record({ op: fc.constant("delete" as const), target: ref }),
    fc.record({ op: fc.constant("move" as const), target: ref, to: pos }),
    fc.record({ op: fc.constant("archive" as const), target: ref }),
    fc.record({
      op: fc.constant("set_type" as const),
      target: ref,
      type: fc.constantFrom("h2", "paragraph", "bullet", "callout_key", "checklist"),
    }),
    fc.record({
      op: fc.constant("mark" as const),
      target: ref,
      match: fc.constantFrom(null, "Redis", "URLs", "nothing"),
      mark: fc.constantFrom("bold", "strike", "code"),
      on: fc.boolean(),
    }),
    fc.record({
      op: fc.constant("set_status" as const),
      target: fc.oneof(ref, slug, anchor),
      in: fc.constantFrom(null, "b5", "b6"),
      status: fc.constantFrom("normal", "struck", "chosen"),
    }),
    fc.record({
      op: fc.constant("graph.rename" as const),
      target: ref,
      node: slug,
      label: fc.constantFrom("API", "Cache"),
    }),
    fc.record({
      op: fc.constant("graph.reverse" as const),
      target: ref,
      edge: fc.constantFrom("e1", "e5", "e99"),
    }),
    fc.record({
      op: fc.constant("graph.remove" as const),
      target: ref,
      nodes: fc.array(slug, { maxLength: 2 }),
      edges: fc.array(fc.constantFrom("e1", "e2", "e99"), { maxLength: 2 }),
    }),
    fc.record({
      op: fc.constant("graph.patch" as const),
      target: ref,
      lines: fc.array(
        fc.constantFrom(
          "web -> redis: hit",
          "cdn [cdn]: CDN",
          "client -> cdn",
          "redis {struck}",
          "a ->",
        ),
        { minLength: 1, maxLength: 3 },
      ),
    }),
    fc.record({
      op: fc.constant("table.add_row" as const),
      target: ref,
      after: anchor,
      cells: fc.array(fc.constantFrom("a", "b"), { minLength: 1, maxLength: 4 }),
    }),
    fc.record({ op: fc.constant("table.remove_row" as const), target: ref, row: anchor }),
    fc.record({
      op: fc.constant("table.move_row" as const),
      target: ref,
      row: anchor,
      after: anchor,
    }),
    fc.record({ op: fc.constant("table.remove_column" as const), target: ref, col: anchor }),
    fc.record({
      op: fc.constant("table.add_column" as const),
      target: ref,
      name: fc.constantFrom("X", "Y"),
      after: anchor,
      cells: fc.array(fc.constantFrom("a", ""), { maxLength: 5 }),
    }),
  );

  it("either explains the problem as an OpError, or produces a valid, consistent result", () => {
    let succeeded = 0;
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 5 }), (ops) => {
        const d = sample();
        const before = JSON.stringify(d);
        try {
          const r = compileOps(d, ops, { ids: createSequentialIds("n") });
          succeeded += 1;
          expect(applyPatch(d, r.patch)).toEqual(r.next);
          expect(findDuplicateIds(r.next)).toEqual([]);
          for (const b of r.next.blocks) {
            if (b.type === "diagram") GraphSchema.parse(b.props["graph"]);
            if (b.type === "table") TableSchema.parse(b.props["table"]);
          }
        } catch (error) {
          expect(error).toBeInstanceOf(OpError);
        }
        expect(JSON.stringify(d)).toBe(before);
      }),
      { numRuns: 3000 },
    );
    // Not vacuous: a good share of the random sequences really compile.
    expect(succeeded).toBeGreaterThan(100);
  });
});
