import { createSequentialIds, type Block } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { registry } from "../defaultRegistry";
import { guardLineStart, blocksToLmd, printPlacement } from "./serialize";
import { parseLmd } from "./parse";

const fx = (type: Block["type"], id: string): Block => {
  const found = registry.get(type).fixtures.find((f) => f.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

describe("blocksToLmd: exact output", () => {
  it("writes the load balancer example", () => {
    const text = `## Load Balancer
A load balancer sits in front of multiple application servers.
- **Health checks** keep traffic away from unhealthy servers.
- The **database** can become the bottleneck.`;
    const parsed = parseLmd(text);
    expect(parsed.ok && blocksToLmd(parsed.blocks)).toBe(
      "## Load Balancer\n\nA load balancer sits in front of multiple application servers.\n\n- **Health checks** keep traffic away from unhealthy servers.\n- The **database** can become the bottleneck.",
    );
  });

  it("writes lists with status, numbering, checkboxes and nesting", () => {
    expect(
      blocksToLmd([
        fx("bulletListItem", "fx-bullet-1"),
        fx("bulletListItem", "fx-bullet-2"),
        fx("bulletListItem", "fx-bullet-3"),
        fx("bulletListItem", "fx-bullet-4"),
      ]),
    ).toBe(
      "- PostgreSQL\n- MongoDB {struck}\n- DynamoDB {chosen}\n- Caching layers\n  - CDN\n  - Redis",
    );
    expect(
      blocksToLmd([
        fx("numberedListItem", "fx-numbered-1"),
        fx("numberedListItem", "fx-numbered-2"),
        fx("checkListItem", "fx-check-1"),
        fx("checkListItem", "fx-check-2"),
      ]),
    ).toBe(
      "1. Resolve the domain with DNS\n2. Send the request to the web server\n- [ ] Benchmark with a longer context\n- [x] Read the vLLM paper",
    );
  });

  it("writes headings with status, callouts, math and code", () => {
    expect(blocksToLmd([fx("heading", "fx-heading-3")])).toBe("### Approach we dropped {struck}");
    expect(blocksToLmd([fx("callout", "fx-callout-1")])).toBe(
      "> [!decision] Database choice\n> DynamoDB for key-value access at scale.",
    );
    expect(blocksToLmd([fx("callout", "fx-callout-2")])).toBe(
      "> [!warning]\n> Hot partitions throttle writes.\n>\n> - Spread keys with a suffix",
    );
    expect(blocksToLmd([fx("math", "fx-math-2")])).toBe(
      "$$ {chosen}\n\\text{hit rate} = \\frac{hits}{hits + misses}\n$$",
    );
    expect(blocksToLmd([fx("code", "fx-code-1")])).toBe(
      "```sql\nSELECT * FROM urls WHERE short_code = $1;\n```",
    );
  });

  it("writes tables with caption and row status", () => {
    expect(blocksToLmd([fx("table", "fx-table-2")])).toBe(
      "| Option | Verdict |\n| --- | --- |\n| PostgreSQL | Joins are not needed | {struck}\n| DynamoDB | Key-value access at scale | {chosen}",
    );
    expect(
      blocksToLmd([fx("table", "fx-table-1")])
        .split("\n")
        .slice(0, 3),
    ).toEqual(["Table: SQL vs NoSQL", "| Property | SQL | NoSQL |", "| --- | --- | --- |"]);
  });

  it("writes graph and chart fences", () => {
    const flow = blocksToLmd([fx("diagram", "fx-diagram-1")]).split("\n");
    expect(flow[0]).toBe(
      '```graph type=flowchart dir=LR title="Request flow" caption="Request flow"',
    );
    expect(flow).toContain("web -.-> pg: cache miss: query");
    expect(flow.at(-1)).toBe("```");
    expect(blocksToLmd([fx("chart", "fx-chart-1")])).toBe(
      '```chart kind=bar title="Decode speed" x="Model" y="Decode" unit="tok/s" caption="Decode speed by model"\ncategories: Qwen3.8 27B, Gemma 4 26B-A4B\nseries tok/s: 15.1, 17.7\n```',
    );
  });

  it("uses a longer fence when the body contains backticks", () => {
    const block: Block = { id: "c", type: "code", props: { language: "", code: "a ``` b" } };
    expect(blocksToLmd([block])).toBe("````\na ``` b\n````");
  });

  it("separates blocks with blank lines but keeps list items together", () => {
    const text = blocksToLmd([
      fx("heading", "fx-heading-2"),
      fx("paragraph", "fx-paragraph-1"),
      fx("bulletListItem", "fx-bullet-1"),
      fx("paragraph", "fx-paragraph-1"),
    ]);
    expect(text.split("\n\n")).toHaveLength(4);
  });

  it("returns an empty string for no blocks", () => {
    expect(blocksToLmd([])).toBe("");
  });
});

describe("guardLineStart", () => {
  it.each([
    ["# not a heading", "\\# not a heading"],
    ["> not a quote", "\\> not a quote"],
    ["- not a bullet", "\\- not a bullet"],
    ["+ plus", "\\+ plus"],
    ["1. not a list", "1\\. not a list"],
    ["12) also not", "12\\) also not"],
    ["Table: x", "Table\\: x"],
    ["@@ end", "\\@@ end"],
    ["| pipe", "\\| pipe"],
    ["plain text", "plain text"],
    ["2024 was a year", "2024 was a year"],
  ])("%j -> %j", (input, expected) => {
    expect(guardLineStart(input)).toBe(expected);
  });

  it("makes guarded paragraphs parse back as paragraphs", () => {
    for (const text of ["# x", "> x", "- x", "+ x", "1. x", "Table: x", "@@ end", "| a | b |"]) {
      const block: Block = {
        id: "p",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text, styles: {} }],
      };
      const result = parseLmd(blocksToLmd([block]), { ids: createSequentialIds("n") });
      expect(result.ok && result.blocks.map((b) => b.type), text).toEqual(["paragraph"]);
      expect(result.ok && result.blocks[0]?.content, text).toEqual(block.content);
    }
  });
});

describe("printPlacement", () => {
  it("writes each placement as a directive, and nothing for the cursor", () => {
    expect(printPlacement({ kind: "cursor" })).toBe("");
    expect(printPlacement({ kind: "end" })).toBe("@@ end");
    expect(printPlacement({ kind: "after", ref: "b7" })).toBe("@@ after b7");
    expect(printPlacement({ kind: "append_to", ref: "b9" })).toBe("@@ append_to b9");
    expect(printPlacement({ kind: "section", heading: 'Trade-offs "v2"' })).toBe(
      '@@ section "Trade-offs \\"v2\\""',
    );
    const parsed = parseLmd(
      `${printPlacement({ kind: "section", heading: 'Trade-offs "v2"' })}\nx`,
    );
    expect(parsed.ok && parsed.placement).toEqual({ kind: "section", heading: 'Trade-offs "v2"' });
  });
});
