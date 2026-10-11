import { describe, expect, it } from "vitest";
import { clip, escapeInline, inlineToMarkdown, inlineToPlain, textRun } from "./text";
import type { Inline, TextInline } from "@lucid/core";

const run = (text: string, styles: TextInline["styles"] = {}): TextInline => ({
  type: "text",
  text,
  styles,
});

describe("inline text helpers", () => {
  const rich: Inline[] = [
    run("Use "),
    run("Redis", { bold: true }),
    run(" or "),
    run("Memcached", { italic: true, strike: true }),
    { type: "link", href: "https://redis.io", content: [run("docs")] },
    { type: "mathInline", latex: "O(n)" },
  ];

  it("extracts plain text, keeping link text and math source", () => {
    expect(inlineToPlain(rich)).toBe("Use Redis or Memcacheddocs" + "O(n)");
    expect(inlineToPlain(undefined)).toBe("");
  });

  it("writes Markdown with nested styles in a fixed order", () => {
    expect(inlineToMarkdown(rich)).toBe(
      "Use **Redis** or ~~*Memcached*~~[docs](https://redis.io)$O(n)$",
    );
    expect(inlineToMarkdown([run("x", { underline: true, highlight: true })])).toBe("__==x==__");
    expect(inlineToMarkdown([run("a*b", { code: true, bold: true })])).toBe("**`a*b`**");
  });

  it("escapes characters that would be read as syntax", () => {
    expect(escapeInline("a_b *c* ~d~ `e` $f$ [g] \\h")).toBe(
      "a\\_b \\*c\\* \\~d\\~ \\`e\\` \\$f\\$ \\[g\\] \\\\h",
    );
    expect(escapeInline("a==b")).toBe("a\\=\\=b");
    expect(inlineToMarkdown([run("web_server")])).toBe("web\\_server");
  });

  it("clip collapses whitespace and reports the original length when cutting", () => {
    expect(clip("a   b\n c", 20)).toBe("a b c");
    expect(clip("x".repeat(100), 10)).toBe(`${"x".repeat(10)}… (100 chars)`);
  });

  it("textRun makes a plain run", () => {
    expect(textRun("hi")).toEqual({ type: "text", text: "hi", styles: {} });
  });
});
