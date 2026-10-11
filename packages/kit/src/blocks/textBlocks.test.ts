import type { Block } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { registry } from "../index";
import type { MarkdownContext } from "../spec";

const md = (block: Block, depth = 0, index = 1): string => {
  const ctx: MarkdownContext = {
    depth,
    index,
    renderChildren: (blocks, d) => blocks.map((b, i) => md(b, d, i + 1)).join("\n"),
  };
  return registry.get(block.type).toMarkdown(block, ctx);
};
const outline = (block: Block, detail: "full" | "summary" = "full") =>
  registry.get(block.type).outline(block, detail);
const fx = (type: Block["type"], id: string): Block => {
  const found = registry.get(type).fixtures.find((f) => f.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

describe("heading", () => {
  it("outlines with its level and status and writes # marks", () => {
    expect(outline(fx("heading", "fx-heading-1"))).toBe("h1 Designing a URL shortener");
    expect(outline(fx("heading", "fx-heading-3"))).toBe("h3 Approach we dropped {struck}");
    expect(md(fx("heading", "fx-heading-2"))).toBe("## Requirements");
    expect(md(fx("heading", "fx-heading-3"))).toBe("### ~~Approach we dropped~~");
  });

  it("only accepts levels 1 to 3", () => {
    const spec = registry.get("heading");
    expect(spec.propsSchema.safeParse({ level: 2 }).success).toBe(true);
    expect(spec.propsSchema.safeParse({ level: 4 }).success).toBe(false);
    expect(spec.propsSchema.safeParse({}).success).toBe(false);
    expect(spec.propsSchema.safeParse({ level: 1, extra: true }).success).toBe(false);
  });
});

describe("paragraph", () => {
  it("clips long text differently for full and summary detail and reports the length", () => {
    const long: Block = {
      id: "p",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "word ".repeat(200).trim(), styles: {} }],
    };
    expect(outline(long, "summary")).toMatch(/^p "(word ){15}word… \(999 chars\)"$/);
    expect(outline(long, "full").length).toBeGreaterThan(outline(long, "summary").length);
  });

  it("keeps short text whole, flags unprocessed dictation and writes inline markup", () => {
    expect(outline(fx("paragraph", "fx-paragraph-1"), "summary")).toBe(
      'p "A load balancer spreads incoming traffic across several application servers."',
    );
    expect(outline(fx("paragraph", "fx-paragraph-3"))).toContain("[unprocessed]");
    expect(md(fx("paragraph", "fx-paragraph-2"))).toBe(
      "Redis keeps hot keys in memory, so most reads never reach **PostgreSQL**. The hit rate is $h = \\frac{hits}{hits + misses}$.",
    );
  });

  it("defaults unprocessed to false", () => {
    const parsed = registry.validateBlock({ id: "x", type: "paragraph", props: {}, content: [] });
    expect(parsed.props).toEqual({ unprocessed: false, status: "normal" });
  });
});

describe("list items", () => {
  it("outline with their status", () => {
    expect(outline(fx("bulletListItem", "fx-bullet-2"))).toBe('bullet "MongoDB" {struck}');
    expect(outline(fx("bulletListItem", "fx-bullet-3"))).toBe('bullet "DynamoDB" {chosen}');
    expect(outline(fx("checkListItem", "fx-check-2"))).toBe('check [x] "Read the vLLM paper"');
    expect(outline(fx("numberedListItem", "fx-numbered-1"))).toBe(
      'numbered "Resolve the domain with DNS"',
    );
  });

  it("write Markdown with status, numbering, checkboxes and nesting", () => {
    expect(md(fx("bulletListItem", "fx-bullet-1"))).toBe("- PostgreSQL");
    expect(md(fx("bulletListItem", "fx-bullet-2"))).toBe("- ~~MongoDB~~");
    expect(md(fx("bulletListItem", "fx-bullet-3"))).toBe("- DynamoDB ✓");
    expect(md(fx("bulletListItem", "fx-bullet-4"))).toBe("- Caching layers\n  - CDN\n  - Redis");
    expect(md(fx("numberedListItem", "fx-numbered-2"), 0, 2)).toBe(
      "2. Send the request to the web server",
    );
    expect(md(fx("checkListItem", "fx-check-1"))).toBe("- [ ] Benchmark with a longer context");
    expect(md(fx("checkListItem", "fx-check-2"))).toBe("- [x] Read the vLLM paper");
  });

  it("indent by depth", () => {
    expect(md(fx("bulletListItem", "fx-bullet-1"), 2)).toBe("    - PostgreSQL");
  });

  it("reject a status other than normal, struck or chosen", () => {
    expect(registry.get("bulletListItem").propsSchema.safeParse({ status: "hidden" }).success).toBe(
      false,
    );
  });
});
