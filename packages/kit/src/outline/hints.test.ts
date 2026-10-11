import type { Block, LucidDoc } from "@lucid/core";
import { bullets, doc, h1, h2, p } from "@lucid/core/testing";
import { describe, expect, it } from "vitest";
import { registry } from "../index";
import { buildHints } from "./hints";

const fx = (type: Block["type"], id: string): Block => {
  const found = registry.get(type).fixtures.find((f) => f.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

/** b1 h1, b2 h2, b3 p, b4 diagram, b5 table, b6 bullets (options) */
const sample = (): LucidDoc => ({
  blocks: [
    ...doc(
      h1("Notes", { id: "h1" }),
      h2("Requirements", { id: "h2" }),
      p("Redis stores hot keys.", { id: "p1" }),
    ).blocks,
    fx("diagram", "fx-diagram-1"),
    fx("table", "fx-table-1"),
    ...doc(
      ...bullets(
        { text: "PostgreSQL", id: "o1" },
        { text: "MongoDB", id: "o2" },
        { text: "DynamoDB", id: "o3" },
      ),
    ).blocks,
  ],
});

describe("buildHints", () => {
  it("points demonstratives at the only block of a kind", () => {
    const text = buildHints({ doc: sample() });
    expect(text).toContain("FOCUS: none");
    expect(text).toContain(
      '- "this diagram" / "that diagram" / "the diagram" → [b4] "Request flow"',
    );
    expect(text).toContain('- "this table" / "that table" / "the table" → [b5] "SQL vs NoSQL"');
    expect(text).toContain('- "this list" / "that list" / "the list" → [b6] "PostgreSQL"');
  });

  it("uses the cursor and what was changed last to choose between several", () => {
    const d = sample();
    const second: Block = { ...fx("table", "fx-table-1"), id: "t2" };
    const two: LucidDoc = { blocks: [...d.blocks.slice(0, 5), second, ...d.blocks.slice(5)] };
    const ambiguous = buildHints({ doc: two });
    expect(ambiguous).toContain(
      '"this table" / "that table" / "the table" → ambiguous: [b5] or [b6]',
    );
    expect(ambiguous).toContain('"the last table" → [b6]');
    expect(ambiguous).toContain('"the first table" → [b5]; "the second table" → [b6]');

    const byCursor = buildHints({ doc: two, cursorBlockId: "t2" });
    expect(byCursor).toContain("FOCUS: cursor in [b6]");
    expect(byCursor).toContain('"the table" → [b6]');
    // Said outright, because the model sometimes asks "which one?" although the cursor is in one.
    expect(byCursor).toContain(
      '"the table" → [b6] "SQL vs NoSQL" (the cursor is in it: do not ask which one)',
    );
    // With only one of its kind there is nothing to ask about.
    expect(buildHints({ doc: sample(), cursorBlockId: "fx-table-1" })).not.toContain(
      "do not ask which one",
    );

    const byTouch = buildHints({
      doc: two,
      touched: [{ blockId: "fx-table-1", note: "added row r5" }],
    });
    expect(byTouch).toContain('"the table" → [b5]');
    expect(byTouch).toContain("LAST_TOUCHED: table=[b5]");
    expect(byTouch).toContain("RECENT_AI_CHANGES: [b5] (added row r5)");
  });

  it("takes 'that' and 'it', without a noun, to be what changed last (an item as itself)", () => {
    expect(buildHints({ doc: sample() })).not.toContain("with no noun");
    const table = buildHints({
      doc: sample(),
      touched: [{ blockId: "fx-table-1", note: "added row r5" }],
    });
    expect(table).toContain(
      '- "that" or "it" with no noun ("make that a heading") means [b5], the last thing changed: do not ask which one',
    );
    // The first of the HINTS, so it is read before the per-kind lines.
    expect(table.split("HINTS:\n")[1]?.startsWith('- "that" or "it" with no noun')).toBe(true);
    const item = buildHints({
      doc: sample(),
      touched: [{ blockId: "o3", note: "added a bullet" }],
    });
    expect(item).toContain('with no noun ("make that a heading") means [b6.3]');
  });

  it("says that a name that is both a list option and a part of the diagram means the option when choosing", () => {
    const text = buildHints({ doc: sample(), nameCollisions: true });
    // Off unless asked for: the cached examples of the prompt do not carry it.
    expect(buildHints({ doc: sample() })).not.toContain("is both an option");
    expect(text).toContain(
      '"PostgreSQL" is both an option in the list [b6.1] and a part of the diagram [b4]',
    );
    expect(text).toContain("means the option [b6.1]");
    // MongoDB is only in the list: nothing to say about it.
    expect(text).not.toContain('"MongoDB" is both');
    // Without a diagram there is nothing to be confused with.
    const noDiagram = { blocks: sample().blocks.filter((b) => b.type !== "diagram") };
    expect(buildHints({ doc: noDiagram, nameCollisions: true })).not.toContain("is both an option");
  });

  it("maps 'the second <thing>' to an item of the list in focus", () => {
    const text = buildHints({ doc: sample() });
    expect(text).toContain(
      '- "the first/second/third <thing>" (an item of the list [b6]) → first [b6.1], second [b6.2], third [b6.3]',
    );
  });

  it("looks inside containers for the cursor", () => {
    const callout: Block = {
      id: "c",
      type: "callout",
      props: { kind: "note", title: "T" },
      children: [
        {
          id: "in",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "x", styles: {} }],
        },
      ],
    };
    const d: LucidDoc = { blocks: [callout, ...sample().blocks] };
    expect(buildHints({ doc: d, cursorBlockId: "in" })).toContain("FOCUS: cursor in [b1]");
  });

  it("says nothing about kinds that are not there", () => {
    const text = buildHints({ doc: doc(p("only text", { id: "x" })) });
    expect(text).not.toContain("diagram");
    expect(text).not.toContain("table");
    expect(text).toContain('"the paragraph" → [b1]');
  });

  it("handles an empty document", () => {
    expect(buildHints({ doc: { blocks: [] } })).toBe("FOCUS: none");
  });
});
