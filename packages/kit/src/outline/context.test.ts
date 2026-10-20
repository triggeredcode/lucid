import type { Block, LucidDoc } from "@lucid/core";
import { doc, h1, h2, p } from "@lucid/core/testing";
import { describe, expect, it } from "vitest";
import { registry } from "../defaultRegistry";
import { buildDocumentContext } from "./context";
import { buildOutline } from "./outline";

const fixture = (type: Block["type"], fixtureId: string, id = fixtureId): Block => {
  const found = registry.get(type).fixtures.find((candidate) => candidate.id === fixtureId);
  if (!found) throw new Error(`no fixture ${fixtureId}`);
  return { ...found, id };
};

const sectioned = (): LucidDoc =>
  doc(
    h1("System design", { id: "title" }),
    h2("Requirements", { id: "requirements" }),
    p("Handle one hundred million new URLs per day.", { id: "r1" }),
    p("Reads far outnumber writes.", { id: "r2" }),
    h2("Database options", { id: "database" }),
    p("PostgreSQL supports relational transactions.", { id: "postgres" }),
    p("MongoDB offers a flexible document model.", { id: "mongo" }),
    h2("Caching", { id: "caching" }),
    p("Redis stores hot keys.", { id: "redis" }),
  );

describe("targeted document context", () => {
  it("keeps a compact overview but expands only the cursor's relevant section", () => {
    const blocks = [h1("Large design", { id: "title" })];
    for (let section = 0; section < 8; section++) {
      blocks.push(h2(`Section ${String(section)}`, { id: `h${String(section)}` }));
      for (let item = 0; item < 10; item++)
        blocks.push(
          p(`Section ${String(section)} paragraph ${String(item)} ${"detail ".repeat(30)}`, {
            id: `p${String(section)}-${String(item)}`,
          }),
        );
    }
    const source = doc(...blocks);
    const bundle = buildDocumentContext({
      doc: source,
      utterance: "Make this paragraph more concise",
      cursorBlockId: "p4-5",
      title: "Large",
    });
    const broad = buildOutline(source, { title: "Large" }).text;

    expect(bundle.selection.scope).toBe("targeted");
    expect(bundle.selection.selectedBlockIds).toContain("p4-5");
    expect(bundle.selection.selectedBlockIds).toContain("p4-0");
    expect(bundle.selection.selectedBlockIds).not.toContain("p2-5");
    expect(bundle.text).toContain("Section 2"); // compact overview
    expect(bundle.text).not.toContain("Section 2 paragraph 5"); // unrelated body omitted
    expect(bundle.text.length).toBeLessThan(broad.length * 0.6);
  });

  it("uses explicit refs, named headings, lexical block names, and recent touches", () => {
    const source = sectioned();
    const named = buildDocumentContext({
      doc: source,
      utterance: "In Database options, cross out MongoDB",
      recentTouched: ["redis"],
    });
    expect(named.selection.selectedBlockIds).toEqual(
      expect.arrayContaining(["database", "postgres", "mongo", "redis"]),
    );
    expect(named.selection.fullBlockIds).toContain("mongo");
    expect(named.text).toContain("RECENT_TOUCHED: [b9]");

    const explicit = buildDocumentContext({ doc: source, utterance: "Replace b3" });
    expect(explicit.selection.fullBlockIds).toContain("r1");
    const spoken = buildDocumentContext({ doc: source, utterance: "Replace block 3" });
    expect(spoken.selection.fullBlockIds).toContain("r1");
  });

  it("includes referenced component details and required diagram relationships", () => {
    const source = doc(
      h1("Architecture", { id: "heading" }),
      fixture("diagram", "fx-diagram-1", "diagram"),
      fixture("table", "fx-table-1", "table"),
    );
    const bundle = buildDocumentContext({
      doc: source,
      utterance: "Add a cache to the diagram",
      cursorBlockId: "diagram",
    });

    expect(bundle.selection.fullBlockIds).toContain("diagram");
    expect(bundle.text).toContain("CONTEXT: targeted");
    expect(bundle.text).toMatch(/nodes:/);
    expect(bundle.text).toMatch(/edges:/);
    expect(bundle.text).not.toContain("Fixed, predefined");

    const edge = buildDocumentContext({ doc: source, utterance: "Rename edge e5" });
    expect(edge.selection.fullBlockIds).toContain("diagram");
  });

  it("marks multiple unfocused components and missing refs for clarification", () => {
    const source = doc(
      h1("Comparisons", { id: "heading" }),
      fixture("table", "fx-table-1", "table-a"),
      fixture("table", "fx-table-1", "table-b"),
    );
    const ambiguous = buildDocumentContext({
      doc: source,
      utterance: "Add a row to the table",
    });
    expect(ambiguous.selection.ambiguities).toEqual([
      { kind: "table", blockIds: ["table-a", "table-b"] },
    ]);
    expect(ambiguous.selection.fullBlockIds).toEqual([]);
    expect(ambiguous.text).toMatch(/TARGET_STATUS: ambiguous table: \[b2\] or \[b3\]/);

    const missing = buildDocumentContext({ doc: source, utterance: "Delete b99" });
    expect(missing.selection.missingRefs).toEqual(["b99"]);
    expect(missing.selection.fullBlockIds).toEqual([]);
    expect(missing.text).toContain("TARGET_STATUS: missing b99");
  });

  it("expands an explicitly ordered component without treating it as ambiguous", () => {
    const source = doc(
      fixture("table", "fx-table-1", "table-a"),
      fixture("table", "fx-table-1", "table-b"),
      fixture("table", "fx-table-1", "table-c"),
    );

    for (const [utterance, expected] of [
      ["Change a cell in the first table", "table-a"],
      ["Change a cell in the second table", "table-b"],
      ["Change a cell in the last table", "table-c"],
    ] as const) {
      const bundle = buildDocumentContext({ doc: source, utterance });
      expect(bundle.selection.fullBlockIds).toEqual([expected]);
      expect(bundle.selection.ambiguities).toEqual([]);
    }

    const ambiguous = buildDocumentContext({ doc: source, utterance: "Change the table" });
    expect(ambiguous.selection.fullBlockIds).toEqual([]);
    expect(ambiguous.selection.ambiguities).toEqual([
      { kind: "table", blockIds: ["table-a", "table-b", "table-c"] },
    ]);
  });

  it("expands document-wide requests and remains deterministic", () => {
    const source = sectioned();
    const request = { doc: source, utterance: "Review the entire document" };
    const first = buildDocumentContext(request);
    const second = buildDocumentContext(request);

    expect(first.selection.scope).toBe("document");
    expect(first.selection.selectedBlockIds).toHaveLength(source.blocks.length);
    expect(first.text).toContain("CONTEXT: whole document");
    expect(second.text).toBe(first.text);
    expect(second.selection).toEqual(first.selection);

    const allTables = buildDocumentContext({
      doc: doc(fixture("table", "fx-table-1", "one"), fixture("table", "fx-table-1", "two")),
      utterance: "Add a note under every table",
    });
    expect(allTables.selection.scope).toBe("document");
    expect(allTables.selection.ambiguities).toEqual([]);
  });
});
