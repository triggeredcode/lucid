import type { Block } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { registry } from "../index";
import type { MarkdownContext } from "../spec";
import { latexProblems } from "./math";

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

describe("callout", () => {
  it("outlines kind, title and (in full detail) its body", () => {
    expect(outline(fx("callout", "fx-callout-1"))).toBe(
      'callout decision "Database choice": "DynamoDB for key-value access at scale."',
    );
    expect(outline(fx("callout", "fx-callout-1"), "summary")).toBe(
      'callout decision "Database choice"',
    );
    expect(outline(fx("callout", "fx-callout-2"))).toBe(
      'callout warning: "Hot partitions throttle writes. / Spread keys with a suffix"',
    );
    expect(outline(fx("callout", "fx-callout-3"))).toBe('callout question "Open" {struck}');
  });

  it("writes a quoted [!kind] block with its children", () => {
    expect(md(fx("callout", "fx-callout-1"))).toBe(
      "> [!decision] Database choice\n> DynamoDB for key-value access at scale.",
    );
    expect(md(fx("callout", "fx-callout-2"))).toBe(
      "> [!warning]\n> Hot partitions throttle writes.\n> - Spread keys with a suffix",
    );
    expect(md(fx("callout", "fx-callout-3"))).toBe("> [!question] Open");
  });

  it("defaults to a note and rejects unknown kinds and multi-line titles", () => {
    const spec = registry.get("callout");
    expect(spec.propsSchema.parse({})).toEqual({ kind: "note", title: "", status: "normal" });
    expect(spec.propsSchema.safeParse({ kind: "tip" }).success).toBe(false);
    expect(spec.propsSchema.safeParse({ title: "a\nb" }).success).toBe(false);
  });
});

describe("math", () => {
  it("outlines and writes display math", () => {
    expect(outline(fx("math", "fx-math-2"))).toBe(
      'math "\\text{hit rate} = \\frac{hits}{hits + misses}" {chosen}',
    );
    expect(md(fx("math", "fx-math-1"))).toBe(
      "$$\nM_{KV} = 2 \\cdot L \\cdot H \\cdot d_{head} \\cdot b \\cdot T\n$$",
    );
  });

  it("rejects dangerous or malformed LaTeX through the semantic check", () => {
    const bad = (latex: string): string[] => latexProblems(latex);
    expect(bad("x^2")).toEqual([]);
    expect(bad("\\input{/etc/passwd}")).toEqual(["LaTeX command \\input is not allowed"]);
    expect(bad("\\immediate\\write18{ls}").length).toBe(2);
    expect(bad("\\defeq")).toEqual([]);
    expect(bad("a $$ b")).toEqual(["math must not contain $$"]);
    expect(bad("\\frac{a}{b")).toEqual(["math has unbalanced braces"]);
    expect(bad("}{")).toEqual(["math has unbalanced braces"]);
    expect(bad("\\{ \\}")).toEqual([]);
    expect(() =>
      registry.validateBlock({ id: "m", type: "math", props: { latex: "\\catcode`a=12" } }),
    ).toThrow(/catcode/);
    expect(() => registry.validateBlock({ id: "m", type: "math", props: { latex: "" } })).toThrow();
  });
});

describe("code", () => {
  it("outlines language and line count and writes fenced Markdown", () => {
    expect(outline(fx("code", "fx-code-1"), "summary")).toBe("code sql (1 line)");
    expect(outline(fx("code", "fx-code-2"))).toBe("code (2 lines): GET /api/v1/short/abc");
    expect(md(fx("code", "fx-code-1"))).toBe(
      "```sql\nSELECT * FROM urls WHERE short_code = $1;\n```",
    );
  });

  it("uses a longer fence when the code contains backticks", () => {
    const block: Block = { id: "c", type: "code", props: { code: "a ``` b" } };
    expect(md(block)).toBe("````\na ``` b\n````");
  });

  it("restricts the language name", () => {
    const spec = registry.get("code");
    expect(spec.propsSchema.safeParse({ code: "x", language: "c++" }).success).toBe(true);
    expect(spec.propsSchema.safeParse({ code: "x", language: "Python 3" }).success).toBe(false);
    expect(spec.propsSchema.safeParse({}).success).toBe(false);
  });
});
