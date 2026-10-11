import type { Block } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { registry } from "../index";
import type { MarkdownContext } from "../spec";

const ctx: MarkdownContext = { depth: 0, index: 1, renderChildren: () => "" };
const md = (b: Block) => registry.get(b.type).toMarkdown(b, ctx);
const outline = (b: Block, d: "full" | "summary" = "full") => registry.get(b.type).outline(b, d);
const fx = (type: Block["type"], id: string): Block => {
  const found = registry.get(type).fixtures.find((f) => f.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

describe("table", () => {
  it("outlines columns and rows with stable ids", () => {
    expect(outline(fx("table", "fx-table-1"))).toBe(
      [
        'table "SQL vs NoSQL" cols: c1 Property | c2 SQL | c3 NoSQL',
        "  r1 Schema | Fixed, predefined | Flexible",
        "  r2 Relationships | Joins, foreign keys | Denormalised / embedded",
        "  r3 Scaling | Vertical | Horizontal",
        "  r4 Use cases | Transactions | Large-scale reads",
      ].join("\n"),
    );
  });

  it("summarises with column names and row headers only, and shows statuses", () => {
    expect(outline(fx("table", "fx-table-1"), "summary")).toBe(
      'table "SQL vs NoSQL" cols: c1 Property | c2 SQL | c3 NoSQL\n  rows: r1 Schema; r2 Relationships; r3 Scaling; r4 Use cases',
    );
    expect(outline(fx("table", "fx-table-2"))).toBe(
      "table cols: c1 Option | c2 Verdict\n  r1 PostgreSQL | Joins are not needed {struck}\n  r2 DynamoDB | Key-value access at scale {chosen}",
    );
  });

  it("writes a GFM pipe table with the caption, struck rows and a chosen mark", () => {
    expect(md(fx("table", "fx-table-1"))).toBe(
      [
        "Table: SQL vs NoSQL",
        "",
        "| Property | SQL | NoSQL |",
        "| --- | --- | --- |",
        "| Schema | Fixed, predefined | Flexible |",
        "| Relationships | Joins, foreign keys | Denormalised / embedded |",
        "| Scaling | Vertical | Horizontal |",
        "| Use cases | Transactions | Large-scale reads |",
      ].join("\n"),
    );
    expect(md(fx("table", "fx-table-2"))).toBe(
      "| Option | Verdict |\n| --- | --- |\n| ~~PostgreSQL~~ | ~~Joins are not needed~~ |\n| DynamoDB ✓ | **Key-value access at scale** |",
    );
  });

  it("escapes pipes in cells", () => {
    const base = fx("table", "fx-table-2");
    const table = base.props["table"] as { rows: { cells: string[] }[] };
    const edited: Block = {
      ...base,
      props: {
        ...base.props,
        table: {
          ...table,
          rows: [{ ...table.rows[0], id: "r1", status: "normal", cells: ["a | b", "c"] }],
        },
      },
    };
    expect(md(edited)).toContain("| a \\| b | c |");
  });

  it("reports table invariant violations through the semantic check", () => {
    const base = fx("table", "fx-table-1");
    const table = base.props["table"] as {
      rows: { id: string; cells: string[]; status: string }[];
    };
    const broken: Block = {
      ...base,
      props: {
        ...base.props,
        table: { ...table, rows: [{ id: "r1", cells: ["only one"], status: "normal" }] },
      },
    };
    expect(() => registry.validateBlock(broken)).toThrow(/T1/);
    expect(() => registry.validateBlock({ ...base, props: { caption: "x" } })).toThrow(
      /props\.table/,
    );
  });
});

describe("diagram", () => {
  it("outlines nodes, edges and groups with ids in full detail", () => {
    const text = outline(fx("diagram", "fx-diagram-1"));
    expect(text.split("\n")[0]).toBe('diagram flowchart LR "Request flow"');
    expect(text).toContain(
      'nodes: user[actor] "User"; client[client] "Client"; dns[external] "DNS"; web[service] "Web Server"; redis[cache] "Redis"; pg[datastore] "PostgreSQL"',
    );
    expect(text).toContain('e1 user->client "enters domain"; e2 client->dns "resolve domain"');
    expect(text).toContain('e6 web-.->pg "cache miss: query"');
    expect(text).toContain('groups: app "Application boundary" {web, redis}');
  });

  it("summarises with node labels only", () => {
    expect(outline(fx("diagram", "fx-diagram-1"), "summary")).toBe(
      'diagram flowchart LR "Request flow"\n  nodes: user "User"; client "Client"; dns "DNS"; web "Web Server"; redis "Redis"; pg "PostgreSQL"',
    );
  });

  it("orders sequence messages by seq and shows statuses", () => {
    expect(outline(fx("diagram", "fx-diagram-2"))).toContain(
      'edges: e1 client->web "GET"; e2 web->redis "lookup"; e3 web->redis "set"',
    );
    expect(outline(fx("diagram", "fx-diagram-3"))).toContain(
      'pg[datastore] "PostgreSQL" {struck}; dynamo[datastore] "DynamoDB" {chosen}',
    );
    expect(outline(fx("diagram", "fx-diagram-3"))).toContain("e1 app->pg {struck}");
  });

  it("writes Markdown as a mermaid fence plus a lossless graph comment", () => {
    const text = md(fx("diagram", "fx-diagram-1"));
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^<!-- lucid:graph \{.*\} -->$/);
    expect(lines[1]).toBe("```mermaid");
    expect(lines[2]).toBe("flowchart LR");
    expect(text).toContain("```\n\n*Request flow*");
    const json = /^<!-- lucid:graph (.*) -->$/.exec(lines[0] ?? "")?.[1] ?? "";
    expect(JSON.parse(json)).toEqual(fx("diagram", "fx-diagram-1").props["graph"]);
  });

  it("never lets graph text end the HTML comment early", () => {
    const base = fx("diagram", "fx-diagram-3");
    const graph = base.props["graph"] as { nodes: { label: string }[] };
    const sneaky: Block = {
      ...base,
      props: {
        ...base.props,
        graph: {
          ...graph,
          nodes: [{ ...graph.nodes[0], label: "a --> b" }, ...graph.nodes.slice(1)],
        },
      },
    };
    const first = md(sneaky).split("\n")[0] ?? "";
    expect(first.slice(0, -4)).not.toContain("-->");
    const json = /^<!-- lucid:graph (.*) -->$/.exec(first)?.[1] ?? "";
    expect((JSON.parse(json) as { nodes: { label: string }[] }).nodes[0]?.label).toBe("a --> b");
  });

  it("rejects a graph that breaks an invariant", () => {
    const base = fx("diagram", "fx-diagram-1");
    const graph = base.props["graph"] as { edges: { to: string }[] };
    const broken: Block = {
      ...base,
      props: { ...base.props, graph: { ...graph, edges: [{ ...graph.edges[0], to: "ghost" }] } },
    };
    expect(() => registry.validateBlock(broken)).toThrow(/G2/);
  });
});

describe("chart", () => {
  it("outlines categories and series, with the unit in full detail", () => {
    expect(outline(fx("chart", "fx-chart-1"))).toBe(
      'chart bar "Decode speed by model"\n  categories: Qwen3.8 27B, Gemma 4 26B-A4B\n  series tok/s: 15.1, 17.7 tok/s',
    );
    expect(outline(fx("chart", "fx-chart-1"), "summary")).toBe(
      'chart bar "Decode speed by model" categories: Qwen3.8 27B, Gemma 4 26B-A4B',
    );
    expect(outline(fx("chart", "fx-chart-2")).split("\n")[0]).toBe(
      'chart line "p95 latency vs batch size"',
    );
  });

  it("writes a mermaid xychart fence with the caption", () => {
    expect(md(fx("chart", "fx-chart-1"))).toBe(
      [
        "```mermaid",
        "xychart-beta",
        '  title "Decode speed"',
        '  x-axis "Model" ["Qwen3.8 27B", "Gemma 4 26B-A4B"]',
        '  y-axis "Decode (tok/s)" 0 --> 20',
        "  bar [15.1, 17.7]",
        "```",
        "",
        "*Decode speed by model*",
      ].join("\n"),
    );
  });

  it("rejects a series with the wrong number of values", () => {
    const base = fx("chart", "fx-chart-1");
    const chart = base.props["chart"] as { series: { name: string; values: number[] }[] };
    const broken: Block = {
      ...base,
      props: { ...base.props, chart: { ...chart, series: [{ name: "x", values: [1] }] } },
    };
    expect(() => registry.validateBlock(broken)).toThrow(/C2/);
  });
});
