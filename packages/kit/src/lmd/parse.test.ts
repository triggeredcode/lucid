import { createSequentialIds, type Block } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { parseLmd } from "./parse";

const ok = (source: string): Block[] => {
  const result = parseLmd(source, { ids: createSequentialIds("n") });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.blocks;
};
const errors = (source: string) => {
  const result = parseLmd(source, { ids: createSequentialIds("n") });
  return result.ok ? [] : result.errors;
};
const plain = (b: Block | undefined): string =>
  (b?.content ?? [])
    .map((r) =>
      r.type === "text"
        ? r.text
        : r.type === "mathInline"
          ? `$${r.latex}$`
          : r.content.map((c) => c.text).join(""),
    )
    .join("");

describe("parseLmd: the load balancer example", () => {
  it("parses a heading, a paragraph and bullets with bold terms", () => {
    const blocks = ok(`## Load Balancer
A load balancer sits in front of multiple application servers and distributes incoming traffic across them.
- **Health checks** keep traffic away from unhealthy servers.
- The **database** can become the bottleneck as app servers scale out.`);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "bulletListItem",
      "bulletListItem",
    ]);
    expect(blocks[0]?.props).toEqual({ level: 2, status: "normal" });
    expect(plain(blocks[0])).toBe("Load Balancer");
    expect(blocks[2]?.content?.[0]).toEqual({
      type: "text",
      text: "Health checks",
      styles: { bold: true },
    });
    expect(blocks.map((b) => b.id)).toEqual(["n1", "n2", "n3", "n4"]);
  });
});

describe("parseLmd: text blocks", () => {
  it("parses the three heading levels and rejects deeper ones", () => {
    expect(ok("# A\n## B\n### C").map((b) => b.props["level"])).toEqual([1, 2, 3]);
    expect(errors("#### too deep")[0]).toEqual({
      line: 1,
      message: "headings go up to ### (level 3)",
    });
  });

  it("joins soft-wrapped paragraph lines and splits on blank lines", () => {
    const blocks = ok("first line\nsecond line\n\nnext paragraph");
    expect(blocks.map(plain)).toEqual(["first line second line", "next paragraph"]);
  });

  it("reads a trailing status on headings and paragraphs", () => {
    expect(ok("## Old plan {struck}")[0]?.props).toEqual({ level: 2, status: "struck" });
    expect(ok("We chose Dynamo {chosen}")[0]?.props["status"]).toBe("chosen");
    expect(plain(ok("literal \\{struck\\}")[0])).toBe("literal {struck}");
  });

  it("skips horizontal rules and blank input", () => {
    expect(ok("---\n\n\n")).toEqual([]);
    expect(ok("a\n\n---\n\nb")).toHaveLength(2);
  });
});

describe("parseLmd: lists", () => {
  it("parses bullets, numbered items and checkboxes with item status", () => {
    const blocks = ok(
      "- PostgreSQL\n- MongoDB {struck}\n- DynamoDB {chosen}\n1. step one\n2) step two\n- [ ] open\n- [x] done",
    );
    expect(blocks.map((b) => [b.type, b.props["status"], b.props["checked"]])).toEqual([
      ["bulletListItem", "normal", undefined],
      ["bulletListItem", "struck", undefined],
      ["bulletListItem", "chosen", undefined],
      ["numberedListItem", "normal", undefined],
      ["numberedListItem", "normal", undefined],
      ["checkListItem", "normal", false],
      ["checkListItem", "normal", true],
    ]);
  });

  it("nests by indentation", () => {
    const blocks = ok("- Caching\n  - CDN\n  - Redis\n    - cluster mode\n- Queues");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.children?.map(plain)).toEqual(["CDN", "Redis"]);
    expect(blocks[0]?.children?.[1]?.children?.map(plain)).toEqual(["cluster mode"]);
    expect(plain(blocks[1])).toBe("Queues");
  });

  it("accepts * and + markers and tab indentation", () => {
    const blocks = ok("* a\n\t+ b");
    expect(blocks[0]?.children).toHaveLength(1);
  });

  it("ends a list at a blank line or a non-list line", () => {
    expect(ok("- a\n\n- b").length).toBe(2);
    expect(ok("- a\ntext").map((b) => b.type)).toEqual(["bulletListItem", "paragraph"]);
  });
});

describe("parseLmd: callouts and quotes", () => {
  it("parses a decision callout with a title and body", () => {
    const [callout] = ok(
      "> [!decision] Database choice\n> DynamoDB for key-value access at scale.\n> - fast\n> - cheap",
    );
    expect(callout?.type).toBe("callout");
    expect(callout?.props).toEqual({
      kind: "decision",
      title: "Database choice",
      status: "normal",
    });
    expect(callout?.children?.map((c) => c.type)).toEqual([
      "paragraph",
      "bulletListItem",
      "bulletListItem",
    ]);
  });

  it("turns a plain quote into a note callout and supports a status on the header", () => {
    expect(ok("> just a remark")[0]?.props).toEqual({ kind: "note", title: "", status: "normal" });
    expect(ok("> [!warning] Careful {struck}")[0]?.props).toEqual({
      kind: "warning",
      title: "Careful",
      status: "struck",
    });
  });

  it("rejects unknown callout kinds with a line number", () => {
    expect(errors("text\n\n> [!tip] Hint")[0]).toMatchObject({ line: 3 });
    expect(errors("> [!tip] Hint")[0]?.message).toContain("unknown callout kind");
  });

  it("nests blocks inside callouts, with ids in document order", () => {
    const [callout] = ok("> [!key] Idea\n> ## Inner heading\n> text");
    expect(callout?.children?.map((c) => c.type)).toEqual(["heading", "paragraph"]);
    expect(callout?.id).toBe("n3");
  });
});

describe("parseLmd: math and code", () => {
  it("parses a math block over several lines and on one line", () => {
    expect(ok("$$\nM = 2 \\cdot L\n$$")[0]?.props["latex"]).toBe("M = 2 \\cdot L");
    expect(ok("$$ x^2 + y^2 $$")[0]?.props["latex"]).toBe("x^2 + y^2");
    expect(ok("$$ {chosen}\nx\n$$")[0]?.props["status"]).toBe("chosen");
  });

  it("rejects an unclosed math block and unsafe LaTeX", () => {
    expect(errors("$$\nx")[0]?.message).toContain("never closed");
    expect(errors("$$\n\\input{x}\n$$")[0]?.message).toContain("\\input");
  });

  it("parses fenced code with a language, keeping its content verbatim", () => {
    const [code] = ok("```sql\nSELECT *\n  FROM t;\n```");
    expect(code?.props).toEqual({ language: "sql", code: "SELECT *\n  FROM t;", status: "normal" });
    expect(ok("```\nplain\n```")[0]?.props["language"]).toBe("");
  });

  it("supports longer fences containing shorter ones, and reports unclosed fences", () => {
    expect(ok("````\na ``` b\n````")[0]?.props["code"]).toBe("a ``` b");
    expect(errors("text\n```sql\nSELECT 1")[0]).toEqual({
      line: 2,
      message: "code fence is never closed",
    });
  });
});

describe("parseLmd: tables", () => {
  const SQL = `Table: SQL vs NoSQL
| Property | SQL | NoSQL |
| --- | --- | --- |
| Schema | Fixed | Flexible |
| Scaling | Vertical | Horizontal | {struck}
| Use cases | Transactions | Reads |`;

  it("parses a caption, header, rows and row status", () => {
    const [table] = ok(SQL);
    expect(table?.type).toBe("table");
    expect(table?.props["caption"]).toBe("SQL vs NoSQL");
    const t = table?.props["table"] as {
      columns: { id: string; name: string }[];
      rows: { id: string; cells: string[]; status: string }[];
      headerColumn: boolean;
    };
    expect(t.columns.map((c) => [c.id, c.name])).toEqual([
      ["c1", "Property"],
      ["c2", "SQL"],
      ["c3", "NoSQL"],
    ]);
    expect(t.rows.map((r) => [r.id, r.cells[0], r.status])).toEqual([
      ["r1", "Schema", "normal"],
      ["r2", "Scaling", "struck"],
      ["r3", "Use cases", "normal"],
    ]);
    expect(t.headerColumn).toBe(true);
  });

  it("parses a table without a caption, without edge pipes, and unescapes \\|", () => {
    const [table] = ok("A | B\n--- | ---\nx \\| y | z");
    const t = table?.props["table"] as { rows: { cells: string[] }[] };
    expect(t.rows[0]?.cells).toEqual(["x | y", "z"]);
  });

  it("reports rows with the wrong number of cells, with their line number", () => {
    expect(errors("| a | b |\n| --- | --- |\n| 1 | 2 |\n| only one |")[0]).toEqual({
      line: 4,
      message: "row has 1 cells, header has 2",
    });
  });

  it("treats a Table: line without a table as a paragraph", () => {
    expect(ok("Table: not followed by a table")[0]?.type).toBe("paragraph");
  });

  it("does not mistake a table inside a paragraph run", () => {
    expect(ok("intro text\n| a | b |\n| --- | --- |\n| 1 | 2 |").map((b) => b.type)).toEqual([
      "paragraph",
      "table",
    ]);
  });
});

describe("parseLmd: diagrams", () => {
  const FLOW = `\`\`\`graph type=flowchart dir=LR title="Request flow"
user [actor]: User
web [service]: Web Server
user -> web: request
\`\`\``;

  it("parses a graph fence through the LGN parser", () => {
    const [diagram] = ok(FLOW);
    expect(diagram?.type).toBe("diagram");
    const g = diagram?.props["graph"] as {
      type: string;
      direction: string;
      title: string;
      nodes: unknown[];
      edges: unknown[];
    };
    expect(g).toMatchObject({ type: "flowchart", direction: "LR", title: "Request flow" });
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
  });

  it("defaults to a left-to-right flowchart, supports sequence and caption attributes", () => {
    const [d] = ok('```graph type=sequence caption="Cache lookup"\na\nb\na -> b: x\n```');
    expect(d?.props["caption"]).toBe("Cache lookup");
    expect((d?.props["graph"] as { type: string }).type).toBe("sequence");
    expect(
      (ok("```graph\na -> b\n```")[0]?.props["graph"] as { direction: string }).direction,
    ).toBe("LR");
  });

  it("maps LGN errors to the line inside the fence", () => {
    const e = errors("intro\n\n```graph\na -> b\nc => d\n```");
    expect(e).toEqual([expect.objectContaining({ line: 5 })]);
    expect(e[0]?.message).toContain("unknown arrow");
  });

  it("rejects bad attributes", () => {
    expect(errors("```graph type=pie\na\n```")[0]?.message).toContain("flowchart, sequence or er");
    expect(errors("```graph dir=XX\na\n```")[0]?.message).toContain("LR or TB");
    expect(errors("```graph what\na\n```")[0]?.message).toContain("could not read");
  });
});

describe("parseLmd: charts", () => {
  it("parses categories, series and attributes", () => {
    const [chart] = ok(
      '```chart kind=bar title="Decode speed" x="Model" y="Decode" unit="tok/s"\ncategories: Qwen 27B, Gemma 26B\nseries tok/s: 15.1, 17.7\n```',
    );
    expect(chart?.type).toBe("chart");
    expect(chart?.props["chart"]).toEqual({
      kind: "bar",
      title: "Decode speed",
      xLabel: "Model",
      yLabel: "Decode",
      unit: "tok/s",
      categories: ["Qwen 27B", "Gemma 26B"],
      series: [{ name: "tok/s", values: [15.1, 17.7] }],
    });
  });

  it("reports non-numeric values, unknown lines and series length mismatches", () => {
    expect(errors("```chart\ncategories: a, b\nseries x: 1, two\n```")[0]?.message).toContain(
      "not a number",
    );
    expect(errors("```chart\ncategories: a\nwhat is this\n```")[0]).toMatchObject({ line: 3 });
    expect(errors("```chart\ncategories: a, b\nseries x: 1\n```")[0]?.message).toContain("C2");
    expect(errors("```chart kind=pie\ncategories: a\nseries x: 1\n```")[0]?.message).toContain(
      "bar or line",
    );
  });

  it("allows escaped commas in categories", () => {
    const [c] = ok("```chart\ncategories: a\\, b, c\nseries s: 1, 2\n```");
    expect((c?.props["chart"] as { categories: string[] }).categories).toEqual(["a, b", "c"]);
  });
});

describe("parseLmd: ids and errors", () => {
  it("assigns random UUIDs by default and sequential ids when given a generator", () => {
    const result = parseLmd("# A\n\nB");
    expect(result.ok && result.blocks.every((b) => /^[0-9a-f-]{36}$/.test(b.id))).toBe(true);
  });

  it("collects every error, sorted by line, and returns no blocks", () => {
    const result = parseLmd("#### x\n\n> [!tip] y\n\n```sql\nnever closed");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.line)).toEqual([1, 3, 5]);
  });
});

describe("parseLmd: placement directives", () => {
  const place = (source: string) => {
    const r = parseLmd(source, { ids: createSequentialIds("n") });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r;
  };

  it("defaults to the cursor", () => {
    expect(place("text").placement).toEqual({ kind: "cursor" });
  });

  it("reads after, before and append_to with a reference", () => {
    expect(place("@@ after b7\ntext").placement).toEqual({ kind: "after", ref: "b7" });
    expect(place("@@ before b7.2\ntext").placement).toEqual({ kind: "before", ref: "b7.2" });
    expect(place("@@ append_to b9\n- item").placement).toEqual({ kind: "append_to", ref: "b9" });
  });

  it("reads end and section (quoted or bare)", () => {
    expect(place("@@ end\ntext").placement).toEqual({ kind: "end" });
    expect(place('@@ section "Trade-offs"\n- x').placement).toEqual({
      kind: "section",
      heading: "Trade-offs",
    });
    expect(place("@@ section Requirements\n- x").placement).toEqual({
      kind: "section",
      heading: "Requirements",
    });
    expect(place('@@ section "say \\"hi\\""\nx').placement).toEqual({
      kind: "section",
      heading: 'say "hi"',
    });
  });

  it("allows leading blank lines before the directive and does not parse it as content", () => {
    const r = place("\n\n@@ end\n# Title");
    expect(r.blocks.map((b) => b.type)).toEqual(["heading"]);
    expect(r.placement).toEqual({ kind: "end" });
  });

  it("recognises @@ command as a request to treat the utterance as a command", () => {
    const r = place("@@ command");
    expect(r.command).toBe(true);
    expect(r.blocks).toEqual([]);
  });

  it("reports bad directives with their line", () => {
    expect(errors("@@ after")[0]).toEqual({
      line: 1,
      message: '"@@ after" needs a block reference such as b7',
    });
    expect(errors("\n@@ middle b1\ntext")[0]).toEqual({
      line: 2,
      message:
        'unknown placement "@@ middle"; use after, before, append_to, end, section or command',
    });
    expect(errors("@@ end now")[0]?.message).toContain("takes no argument");
    expect(errors("@@ section")[0]?.message).toContain("needs a heading");
    expect(errors("@@")[0]?.message).toContain("expected");
  });

  it("rejects a directive that is not on the first line", () => {
    expect(errors("text\n@@ end")[0]).toEqual({
      line: 2,
      message: "a placement directive (@@ ...) must be the first line",
    });
  });

  it("keeps real line numbers after a directive", () => {
    expect(errors("@@ end\n\n#### deep")[0]?.line).toBe(3);
  });
});
