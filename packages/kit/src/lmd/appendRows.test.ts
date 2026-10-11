import type { LucidDoc } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { parseLmd } from "./parse";
import { completeAppendedRows } from "./appendRows";
import { registry } from "../defaultRegistry";

const tableFixture = registry.get("table").fixtures[0];
const doc: LucidDoc = {
  blocks: [
    {
      id: "p",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "Intro", styles: {} }],
    },
    ...(tableFixture ? [tableFixture] : []),
    {
      id: "l",
      type: "bulletListItem",
      props: {},
      content: [{ type: "text", text: "One", styles: {} }],
    },
  ],
};
// b1 is the paragraph, b2 the table (Property | SQL | NoSQL), b3 the list.

describe("completeAppendedRows", () => {
  it("puts the table's columns on top of bare rows so they read as rows of that table", () => {
    const out = completeAppendedRows("@@ append_to b2\n| Cost | Per node | Per request |", doc);
    expect(out).toBe(
      "@@ append_to b2\n| Property | SQL | NoSQL |\n| --- | --- | --- |\n| Cost | Per node | Per request |",
    );
    const parsed = parseLmd(out);
    expect(parsed.ok && parsed.blocks[0]?.type).toBe("table");
    expect(parsed.ok && parsed.placement).toEqual({ kind: "append_to", ref: "b2" });
  });

  it("handles several rows, blank lines and a leading blank line", () => {
    const out = completeAppendedRows("\n@@ append_to b2\n| A | 1 | 2 |\n\n| B | 3 | 4 |\n", doc);
    expect(out.split("\n").filter((l) => l.startsWith("|"))).toHaveLength(4);
  });

  it("leaves a full table, other content, other references and other directives alone", () => {
    const full = "@@ append_to b2\n| Property | SQL | NoSQL |\n|---|---|---|\n| Cost | a | b |";
    expect(completeAppendedRows(full, doc)).toBe(full);
    const text = "@@ append_to b2\nJust a sentence.";
    expect(completeAppendedRows(text, doc)).toBe(text);
    const list = "@@ append_to b3\n| x | y |";
    expect(completeAppendedRows(list, doc)).toBe(list);
    const para = "@@ append_to b1\n| x | y |";
    expect(completeAppendedRows(para, doc)).toBe(para);
    const nowhere = "@@ append_to b9\n| x | y |";
    expect(completeAppendedRows(nowhere, doc)).toBe(nowhere);
    const after = "@@ after b2\n| x | y |";
    expect(completeAppendedRows(after, doc)).toBe(after);
    const plain = "| x | y |";
    expect(completeAppendedRows(plain, doc)).toBe(plain);
  });
});
