import { applyPatch, type Block, type LucidDoc } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { evaluate, findBlock, labelMatches, type Observed } from "./matchers";
import type { Expect } from "./types";

const observe = (before: LucidDoc, after: LucidDoc, over: Partial<Observed> = {}): Observed => ({
  before,
  after,
  outcome: "edit",
  utterance: "",
  ...over,
});

/** A copy of a page with one diagram node added and connected. */
function withCdn(): { before: LucidDoc; after: LucidDoc } {
  const before = fixture("request-flow");
  const after = JSON.parse(JSON.stringify(before)) as LucidDoc;
  const g = after.blocks.find((b) => b.type === "diagram")?.props["graph"] as {
    nodes: unknown[];
    edges: unknown[];
  };
  g.nodes.push({ id: "cdn", kind: "cdn", label: "CDN", status: "normal" });
  g.edges.push({
    id: "e6",
    from: "client",
    to: "cdn",
    arrow: "directed",
    style: "solid",
    status: "normal",
  });
  g.edges.push({
    id: "e7",
    from: "cdn",
    to: "web",
    label: "cache miss",
    arrow: "directed",
    style: "dashed",
    status: "normal",
  });
  return { before, after };
}

const run = (expectation: Expect, before: LucidDoc, after: LucidDoc, o: Partial<Observed> = {}) =>
  evaluate("command", expectation, observe(before, after, o));

describe("labels", () => {
  it("match through aliases and word forms, not on loose substrings", () => {
    expect(labelMatches("PostgreSQL", "Postgres")).toBe(true);
    expect(labelMatches("Web Servers", "web server")).toBe(true);
    expect(labelMatches("Web Server (Node)", "web server")).toBe(true);
    expect(labelMatches("Redis", "red is")).toBe(true);
    expect(labelMatches("Database", "Redis")).toBe(false);
    expect(labelMatches("Web", "web server")).toBe(false);
  });
});

describe("finding blocks", () => {
  it("picks by kind, position and text", () => {
    const doc = fixture("two-tables");
    expect(findBlock(doc, "table")?.id).toBe("t1");
    expect(findBlock(doc, { type: "table", nth: 1 })?.id).toBe("t2");
    expect(findBlock(doc, { type: "table", nth: "last" })?.id).toBe("t2");
    expect(findBlock(doc, "heading")?.id).toBe("h1");
    expect(findBlock(fixture("db-options"), "list")?.id).toBe("o1");
    expect(findBlock(doc, { type: "table", nth: 3 })).toBeUndefined();
  });
});

describe("outcome and structure", () => {
  it("fails when the pipeline came to something else, without looking further", () => {
    const d = fixture("request-flow");
    expect(run({ outcome: "edit" }, d, d, { outcome: "clarify" })).toEqual([
      'expected the outcome "edit", got "clarify"',
    ]);
    expect(
      run({ outcome: "clarify", clarifyOptionsMin: 2 }, d, d, {
        outcome: "clarify",
        clarifyOptions: 1,
      })[0],
    ).toContain("at least 2 options");
  });

  it("defaults to applied for input and edit for command", () => {
    const d = fixture("empty");
    expect(evaluate("input", {}, observe(d, d, { outcome: "applied" }))).toEqual([]);
    expect(evaluate("input", {}, observe(d, d, { outcome: "command" }))).not.toEqual([]);
    expect(evaluate("command", {}, observe(d, d, { outcome: "edit" }))).toEqual([]);
  });

  it("touchedOnly: everything else must be exactly as before", () => {
    const { before, after } = withCdn();
    expect(run({ touchedOnly: ["diagram"] }, before, after)).toEqual([]);
    const damaged = JSON.parse(JSON.stringify(after)) as LucidDoc;
    const para = damaged.blocks.find((b) => b.type === "paragraph");
    if (para?.content?.[0]) para.content[0] = { type: "text", text: "changed", styles: {} };
    expect(run({ touchedOnly: ["diagram"] }, before, damaged)[0]).toContain("untouched changed");
    const gone = { blocks: after.blocks.filter((b) => b.type !== "table") };
    expect(run({ touchedOnly: ["diagram"] }, before, gone)[0]).toContain("is gone");
  });
});

describe("touchedOnly with a list", () => {
  it("lets every item of the list change, but nothing else", () => {
    const before = fixture("db-options");
    const after = JSON.parse(JSON.stringify(before)) as LucidDoc;
    for (const b of after.blocks) if (b.type === "bulletListItem") b.props = { status: "struck" };
    expect(run({ touchedOnly: ["list"] }, before, after)).toEqual([]);
    const head = after.blocks[0];
    if (head?.content?.[0]) head.content[0] = { type: "text", text: "Changed", styles: {} };
    expect(run({ touchedOnly: ["list"] }, before, after)[0]).toContain("untouched changed");
  });
});

describe("graph matchers", () => {
  it("accepts a diagram with the new component and its connections", () => {
    const { before, after } = withCdn();
    const e: Expect = {
      graph: {
        hasNodes: ["CDN", "Web Server", "Postgres"],
        hasEdges: [
          { from: "client", to: "cdn" },
          { from: "CDN", to: "web server", labelHas: "miss" },
        ],
        dashed: [{ from: "cdn", to: "web" }],
        nodeCount: { eq: 5 },
        kinds: [{ label: "CDN", kind: "cdn" }],
      },
    };
    expect(run(e, before, after)).toEqual([]);
  });

  it("says what is missing, wrong or extra", () => {
    const { before, after } = withCdn();
    const failures = run(
      {
        graph: {
          hasNodes: ["Kafka"],
          lacksNodes: ["CDN"],
          hasEdges: [{ from: "web", to: "cdn" }],
          nodeCount: { eq: 3 },
          kinds: [{ label: "CDN", kind: "cache" }],
        },
      },
      before,
      after,
    );
    expect(failures.join("\n")).toContain('missing component "Kafka"');
    expect(failures.join("\n")).toContain('should not have component "CDN"');
    expect(failures.join("\n")).toContain("missing connection web → cdn");
    expect(failures.join("\n")).toContain("expected exactly 3 components, got 5");
    expect(failures.join("\n")).toContain('"CDN" should be a cache, is cdn');
  });

  it("treats a connection the other way round as missing, unless either is allowed", () => {
    const { before, after } = withCdn();
    expect(
      run({ graph: { hasEdges: [{ from: "cdn", to: "client" }] } }, before, after),
    ).not.toEqual([]);
    expect(
      run({ graph: { hasEdges: [{ from: "cdn", to: "client", either: true }] } }, before, after),
    ).toEqual([]);
  });

  it("finds components the person never mentioned", () => {
    const { before, after } = withCdn();
    expect(
      run({ graph: { noUngroundedNodes: true } }, before, after, {
        utterance: "add a CDN in front",
      }),
    ).toEqual([]);
    expect(
      run({ graph: { noUngroundedNodes: true } }, before, after, { utterance: "add a cache" })[0],
    ).toContain("invented components: CDN");
  });
});

describe("table matchers", () => {
  const two = fixture("two-tables");
  const added = (): LucidDoc => {
    const after = JSON.parse(JSON.stringify(two)) as LucidDoc;
    const t = after.blocks.find((b) => b.id === "t2")?.props["table"] as {
      rows: { id: string; cells: string[]; status: string }[];
    };
    t.rows.push({ id: "r3", cells: ["Cost", "Broker fees", "Per request"], status: "normal" });
    return after;
  };

  it("checks columns in order, rows, filled cells and which table", () => {
    const after = added();
    const e: Expect = {
      touchedOnly: [{ type: "table", nth: 1 }],
      table: {
        on: { type: "table", nth: 1 },
        columns: ["Property", "Kafka", "SQS"],
        rowCount: { eq: 3 },
        rowHeaders: ["Ordering", "Hosting", "Cost"],
        rows: [{ header: "cost", filled: ["Kafka", "SQS"], contains: { SQS: "per request" } }],
      },
    };
    expect(run(e, two, after)).toEqual([]);
  });

  it("notices the wrong table, wrong order and empty cells", () => {
    const after = added();
    expect(run({ touchedOnly: ["table"] }, two, after)[0]).toContain("untouched");
    expect(
      run(
        { table: { columns: ["Property", "SQS", "Kafka"], on: { type: "table", nth: 1 } } },
        two,
        after,
      )[0],
    ).toContain("columns should be");
    const t = after.blocks.find((b) => b.id === "t2")?.props["table"] as {
      rows: { cells: string[] }[];
    };
    if (t.rows[2]) t.rows[2].cells[2] = "";
    expect(
      run(
        { table: { on: { type: "table", nth: 1 }, rows: [{ header: "Cost", filled: ["SQS"] }] } },
        two,
        after,
      )[0],
    ).toContain("SQS is empty");
  });
});

describe("document matchers", () => {
  it("checks headings, terms, list items, counts and statuses", () => {
    const before = fixture("db-options");
    const after = applyPatch(before, {
      steps: [
        {
          kind: "update",
          id: "o2",
          block: { ...(before.blocks[2] as Block), props: { status: "struck" } },
        },
      ],
    });
    const e: Expect = {
      doc: {
        hasHeading: [{ level: 2, text: "database options" }],
        listItems: ["PostgreSQL", "DynamoDB"],
        itemStatuses: [
          { text: "MongoDB", status: "struck" },
          { text: "DynamoDB", status: "normal" },
        ],
        listItemCount: { eq: 3 },
        contains: ["postgres"],
        lacks: ["cassandra"],
        blockCounts: { diagram: { eq: 0 } },
      },
    };
    expect(run(e, before, after)).toEqual([]);
    const bad = run(
      { doc: { itemStatuses: [{ text: "MongoDB", status: "chosen" }], contains: ["kafka"] } },
      before,
      after,
    );
    expect(bad.join("\n")).toContain('"MongoDB" should be chosen, is struck');
    expect(bad.join("\n")).toContain('do not mention "kafka"');
  });

  it("does not find a filler word that has no content words in notes that lack it", () => {
    const before = fixture("empty");
    const after: LucidDoc = {
      blocks: [
        {
          id: "p",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "The load balancer sends traffic.", styles: {} }],
        },
      ],
    };
    expect(
      evaluate(
        "input",
        { doc: { lacks: ["uh", "um so"] } },
        observe(before, after, { outcome: "applied" }),
      ),
    ).toEqual([]);
    const withUh: LucidDoc = {
      blocks: [
        {
          id: "p",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "so, uh, it sends traffic", styles: {} }],
        },
      ],
    };
    expect(
      evaluate(
        "input",
        { doc: { lacks: ["uh"] } },
        observe(before, withUh, { outcome: "applied" }),
      )[0],
    ).toContain('should not mention "uh"');
  });

  it("catches invented numbers but not numbers that were said or already there", () => {
    const before = fixture("empty");
    const after: LucidDoc = {
      blocks: [
        {
          id: "p",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "It does 9.7 tok/s and 42 tok/s.", styles: {} }],
        },
      ],
    };
    const said = evaluate(
      "input",
      { doc: { noInventedNumbers: true } },
      observe(before, after, { outcome: "applied", utterance: "it does 9.7 tokens per second" }),
    );
    expect(said[0]).toContain("invented numbers: 42");
    const both = evaluate(
      "input",
      { doc: { noInventedNumbers: true } },
      observe(before, after, { outcome: "applied", utterance: "9.7 and 42" }),
    );
    expect(both).toEqual([]);
  });

  it("looks for formulas", () => {
    const before = fixture("empty");
    const after: LucidDoc = {
      blocks: [
        { id: "m", type: "math", props: { latex: "KV = 2 \\cdot L \\cdot H", display: true } },
      ],
    };
    expect(
      evaluate(
        "input",
        { doc: { hasMath: true, mathContains: ["cdot"] } },
        observe(before, after, { outcome: "applied" }),
      ),
    ).toEqual([]);
    expect(
      evaluate(
        "input",
        { doc: { hasMath: true } },
        observe(before, before, { outcome: "applied" }),
      ),
    ).toEqual(["there is no formula"]);
  });
});

describe("note format matchers", () => {
  const before = fixture("format-comparison");
  const withOptions = (): LucidDoc => {
    const after = JSON.parse(JSON.stringify(before)) as LucidDoc;
    const at = after.blocks.findIndex((b) => b.id === "s3");
    after.blocks.splice(at, 0, {
      id: "n1",
      type: "bulletListItem",
      props: {},
      content: [{ type: "text", text: "Kafka and SQS", styles: {} }],
    });
    return after;
  };

  it("finds the notes under the heading they were put under, and says when they are elsewhere", () => {
    const after = withOptions();
    const o = { before, after, outcome: "applied", utterance: "x" };
    expect(
      evaluate(
        "input",
        { doc: { underHeading: [{ heading: "Options", contains: ["kafka", "sqs"] }] } },
        o,
      ),
    ).toEqual([]);
    const wrong = evaluate(
      "input",
      { doc: { underHeading: [{ heading: "Decision", contains: ["kafka"] }] } },
      o,
    );
    expect(wrong[0]).toContain('section "Decision" does not have "kafka"');
    expect(
      evaluate("input", { doc: { underHeading: [{ heading: "Nope", contains: ["x"] }] } }, o)[0],
    ).toContain("there is no section");
  });

  it("checks the format an advisor chose", () => {
    const o = {
      before: fixture("empty"),
      after: fixture("empty"),
      outcome: "advice",
      utterance: "x",
      formatId: "system-design",
    };
    expect(evaluate("advisor", { formatId: "system-design" }, o)).toEqual([]);
    expect(evaluate("advisor", { formatId: "comparison" }, o)).toEqual([
      "expected the format comparison, got system-design",
    ]);
  });

  it("starts format pages with the section headings", () => {
    expect(before.blocks.map((b) => b.type)).toEqual(Array(5).fill("heading"));
    expect(findBlock(before, { type: "heading", text: "Options" })?.id).toBe("s2");
  });
});

describe("budget", () => {
  it("fails a trial that used too many output tokens", () => {
    const d = fixture("empty");
    expect(
      evaluate(
        "input",
        { maxOutputTokens: 100 },
        observe(d, d, { outcome: "applied", outputTokens: 150 }),
      )[0],
    ).toContain("150 output tokens");
  });
});
