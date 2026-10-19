import { applyPatch, type Block, type LucidDoc } from "@lucid/core";
import { bullets, doc, h1, h2, numbered, p } from "@lucid/core/testing";
import { describe, expect, it } from "vitest";
import { registry } from "../index";
import { buildOutline } from "./outline";

const fixture = (type: Block["type"], id: string): Block => {
  const found = registry.get(type).fixtures.find((f) => f.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

const sample = (): LucidDoc => {
  const base = doc(
    h1("Designing a URL shortener", { id: "h1" }),
    h2("Requirements", { id: "h2" }),
    bullets("100M new URLs/day", "Reads far outnumber writes", "Custom aliases"),
    p(
      "Redis stores hot keys so most reads never reach PostgreSQL. It also takes load off the database during peaks.",
      { id: "p1" },
    ),
    h2("Database options", { id: "h3" }),
    bullets(
      "PostgreSQL",
      { text: "MongoDB", status: "struck" },
      { text: "DynamoDB", status: "chosen" },
    ),
    numbered("Resolve", "Request"),
  );
  return {
    blocks: [...base.blocks, fixture("table", "fx-table-1"), fixture("callout", "fx-callout-1")],
  };
};

describe("buildOutline", () => {
  it("prints the document with short references", () => {
    const { text } = buildOutline(sample(), { title: "URL shortener", format: "system-design" });
    expect(text).toBe(
      [
        'DOCUMENT "URL shortener" (format: system-design)',
        "[b1] h1 Designing a URL shortener",
        "[b2] h2 Requirements",
        "[b3] bullets: [b3.1] 100M new URLs/day | [b3.2] Reads far outnumber writes | [b3.3] Custom aliases",
        '[b4] p "Redis stores hot keys so most reads never reach PostgreSQL. It also takes load o… (109 chars)"',
        "[b5] h2 Database options",
        "[b6] bullets: [b6.1] PostgreSQL | [b6.2] MongoDB {struck} | [b6.3] DynamoDB {chosen}",
        "[b7] numbered: [b7.1] Resolve | [b7.2] Request",
        '[b8] table "SQL vs NoSQL" cols: c1 Property | c2 SQL | c3 NoSQL',
        "  rows: r1 Schema; r2 Relationships; r3 Scaling; r4 Use cases",
        '[b9] callout decision "Database choice"',
      ].join("\n"),
    );
  });

  it("shows blocks in full when asked to", () => {
    const d = sample();
    const { text } = buildOutline(d, { full: ["p1", "fx-table-1"] });
    expect(text).toContain(
      '[b4] p "Redis stores hot keys so most reads never reach PostgreSQL. It also takes load off the database during peaks."',
    );
    expect(text).toContain("  r1 Schema | Fixed, predefined | Flexible");
    expect(text).toContain("  r4 Use cases | Transactions | Large-scale reads");
    expect(text).toContain('[b9] callout decision "Database choice"');
  });

  it("returns a RefMap that matches the printed references", () => {
    const d = sample();
    const { text, refMap } = buildOutline(d);
    for (const ref of text.match(/\[b\d+(?:\.\d+)*\]/g) ?? [])
      expect(refMap.resolve(ref)).toBeDefined();
    expect(refMap.resolve("b8")).toEqual({ kind: "block", id: "fx-table-1" });
  });

  it("can render a selected entry without renumbering document references", () => {
    const d = sample();
    const { text, refMap } = buildOutline(d, { include: ["p1"], full: ["p1"] });
    expect(text).toContain('[b4] p "Redis stores hot keys');
    expect(text).not.toContain("Database options");
    expect(refMap.resolve("b8")).toEqual({ kind: "block", id: "fx-table-1" });
  });

  it("shows nested list items and checkbox state", () => {
    const d = doc(bullets({ text: "Caches", children: ["CDN", "Redis"] }), {
      id: "c1",
      type: "checkListItem",
      props: { checked: true },
      content: [{ type: "text", text: "done", styles: {} }],
    });
    const { text } = buildOutline(d);
    expect(text).toContain("[b1] bullets: [b1.1] Caches (sub: [b1.1.1] CDN | [b1.1.2] Redis)");
    expect(text).toContain("[b2] checklist: [b2.1] [x] done");
  });

  it("collapses the blocks farthest from the focus when over budget, and keeps headings", () => {
    const body = doc(
      ...Array.from({ length: 40 }, (_, i) => [
        h2(`Section ${String(i)}`, { id: `h${String(i)}` }),
        p(`Paragraph number ${String(i)} ${"word ".repeat(30)}`, { id: `p${String(i)}` }),
      ]).flat(),
    );
    const small = buildOutline(body, { full: ["p30"], maxChars: 2500 });
    expect(small.text.length).toBeLessThan(3000);
    expect(small.text).toMatch(/\[b\d+–b\d+\] \d+ blocks \(collapsed\)/);
    expect(small.text).toContain("Section 0");
    expect(small.text).toContain("Section 39");
    expect(small.text).toContain("Paragraph number 30");
  });

  it("describes an empty document", () => {
    expect(buildOutline({ blocks: [] }).text).toBe('DOCUMENT "Untitled"');
  });

  it("does not change the document", () => {
    const d = sample();
    const before = JSON.stringify(d);
    buildOutline(d, { full: ["p1"] });
    expect(JSON.stringify(d)).toBe(before);
    expect(applyPatch(d, { steps: [] })).toEqual(d);
  });
});
