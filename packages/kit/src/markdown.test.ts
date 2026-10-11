import type { Block, LucidDoc } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { registry } from "./defaultRegistry";
import { docToMarkdown } from "./markdown";

const t = (text: string) => [{ type: "text" as const, text, styles: {} }];
const h = (id: string, level: number, text: string): Block => ({
  id,
  type: "heading",
  props: { level },
  content: t(text),
});
const p = (id: string, text: string): Block => ({
  id,
  type: "paragraph",
  props: {},
  content: t(text),
});
const li = (id: string, type: Block["type"], text: string, extra: Partial<Block> = {}): Block => ({
  id,
  type,
  props: {},
  content: t(text),
  ...extra,
});
const fixture = (id: string): Block => {
  for (const spec of registry.specs.values()) {
    const found = spec.fixtures.find((f) => f.id === id);
    if (found) return found;
  }
  throw new Error(`no fixture ${id}`);
};

describe("docToMarkdown", () => {
  it("writes the title, text, lists and nested items", () => {
    const doc: LucidDoc = {
      blocks: [
        h("h", 2, "Load balancing"),
        {
          id: "p",
          type: "paragraph",
          props: {},
          content: [
            { type: "text", text: "It spreads ", styles: {} },
            { type: "text", text: "traffic", styles: { bold: true } },
            { type: "text", text: ".", styles: {} },
          ],
        },
        li("a", "bulletListItem", "Health checks", {
          children: [li("a1", "bulletListItem", "Active")],
        }),
        li("b", "bulletListItem", "Algorithms"),
        li("n1", "numberedListItem", "Resolve"),
        li("n2", "numberedListItem", "Connect"),
        p("q", "Then:"),
        li("n3", "numberedListItem", "Again"),
      ],
    };
    expect(docToMarkdown(doc, { title: "Notes" })).toBe(
      [
        "# Notes",
        "",
        "## Load balancing",
        "",
        "It spreads **traffic**.",
        "",
        "- Health checks",
        "  - Active",
        "- Algorithms",
        "",
        "1. Resolve",
        "2. Connect",
        "",
        "Then:",
        "",
        "1. Again",
        "",
      ].join("\n"),
    );
  });

  it("drops a first heading that repeats the title", () => {
    const md = docToMarkdown({ blocks: [h("h", 1, "Notes"), p("p", "Body")] }, { title: "Notes" });
    expect(md).toBe("# Notes\n\nBody\n");
  });

  it("keeps struck and chosen items visible", () => {
    const doc: LucidDoc = {
      blocks: [
        li("a", "bulletListItem", "MongoDB", { props: { status: "struck" } }),
        li("b", "bulletListItem", "DynamoDB", { props: { status: "chosen" } }),
      ],
    };
    const md = docToMarkdown(doc);
    expect(md).toContain("~~MongoDB~~");
    expect(md).toContain("DynamoDB ✓");
  });

  it("writes every kind of block from the kit's fixtures without losing any", () => {
    const blocks = [...registry.specs.values()].flatMap((s) => s.fixtures);
    const md = docToMarkdown({ blocks });
    expect(md.endsWith("\n")).toBe(true);
    expect(md).not.toMatch(/\n{3,}/);
    expect(md).toContain("| ");
    expect(md).toContain("```mermaid");
    expect(md).toMatch(/> \[!/);
  });

  it("is empty but valid for an empty page", () => {
    expect(docToMarkdown({ blocks: [] })).toBe("\n");
    expect(docToMarkdown({ blocks: [] }, { title: "Empty" })).toBe("# Empty\n");
    expect(fixture("fx-table-1").type).toBe("table");
  });
});
