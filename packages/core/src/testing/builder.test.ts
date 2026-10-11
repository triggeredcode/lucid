import { describe, expect, it } from "vitest";
import { LucidDocSchema, findDuplicateIds } from "../model/doc";
import { bullets, callout, checklist, code, doc, h1, h2, math, numbered, p, t } from "./builder";

describe("test builder", () => {
  it("assigns sequential ids in document order, depth first", () => {
    const d = doc(h1("Title"), p("Intro"), callout("decision", "DB", p("Use DynamoDB")), p("End"));
    expect(d.blocks.map((b) => b.id)).toEqual(["b1", "b2", "b3", "b5"]);
    expect(d.blocks[2]?.children?.map((b) => b.id)).toEqual(["b4"]);
  });

  it("keeps explicit ids and does not consume sequence numbers for them", () => {
    const d = doc(h2("A", { id: "intro" }), p("B"));
    expect(d.blocks.map((b) => b.id)).toEqual(["intro", "b1"]);
  });

  it("builds headings, math, code and callouts with the expected props", () => {
    const d = doc(h2("H"), math("O(n)"), code("ts", "const a = 1"), callout("warning", "Careful"));
    expect(d.blocks.map((b) => [b.type, b.props])).toEqual([
      ["heading", { level: 2 }],
      ["math", { latex: "O(n)" }],
      ["code", { language: "ts", code: "const a = 1" }],
      ["callout", { kind: "warning", title: "Careful" }],
    ]);
  });

  it("flattens lists into one block per item, with status and nesting", () => {
    const d = doc(
      bullets(
        "PostgreSQL",
        { text: "MongoDB", status: "struck" },
        { text: "Dynamo", children: ["GSI"] },
      ),
      numbered("one", "two"),
      checklist("todo", { text: "done", checked: true }),
    );
    expect(d.blocks.map((b) => b.type)).toEqual([
      "bulletListItem",
      "bulletListItem",
      "bulletListItem",
      "numberedListItem",
      "numberedListItem",
      "checkListItem",
      "checkListItem",
    ]);
    expect(d.blocks[1]?.props).toEqual({ status: "struck" });
    expect(d.blocks[2]?.children?.map((b) => b.type)).toEqual(["bulletListItem"]);
    expect(d.blocks[6]?.props).toEqual({ checked: true });
  });

  it("accepts styled inline runs", () => {
    const d = doc(p([t("Use "), t("Redis", { bold: true })]));
    expect(d.blocks[0]?.content).toEqual([
      { type: "text", text: "Use ", styles: {} },
      { type: "text", text: "Redis", styles: { bold: true } },
    ]);
  });

  it("always produces a schema-valid document with unique ids", () => {
    const d = doc(h1("T"), bullets("a", "b"), callout("note", "N", p("x"), bullets("y")));
    expect(LucidDocSchema.parse(d)).toEqual(d);
    expect(findDuplicateIds(d)).toEqual([]);
  });

  it("throws when an explicit id collides", () => {
    expect(() => doc(p("a", { id: "x" }), p("b", { id: "x" }))).toThrow(/duplicate/i);
  });

  it("supports a custom id generator", () => {
    let n = 100;
    const d = doc.with({ ids: () => `k${String(n++)}` })(p("a"), p("b"));
    expect(d.blocks.map((b) => b.id)).toEqual(["k100", "k101"]);
  });
});
