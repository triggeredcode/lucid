import type { Inline, TextInline } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { escapeInline, inlineToMarkdown } from "../text";
import { parseInline } from "./inline";

const text = (t: string, styles: TextInline["styles"] = {}): TextInline => ({
  type: "text",
  text: t,
  styles,
});

describe("parseInline", () => {
  it("parses plain text, and nothing yields no runs", () => {
    expect(parseInline("hello world")).toEqual([text("hello world")]);
    expect(parseInline("")).toEqual([]);
  });

  it("parses each style", () => {
    expect(parseInline("**b**")).toEqual([text("b", { bold: true })]);
    expect(parseInline("*i*")).toEqual([text("i", { italic: true })]);
    expect(parseInline("__u__")).toEqual([text("u", { underline: true })]);
    expect(parseInline("~~s~~")).toEqual([text("s", { strike: true })]);
    expect(parseInline("==h==")).toEqual([text("h", { highlight: true })]);
    expect(parseInline("`c`")).toEqual([text("c", { code: true })]);
  });

  it("parses styles in the middle of text and merges neighbouring plain runs", () => {
    expect(parseInline("Use **Redis** or *Memcached* here")).toEqual([
      text("Use "),
      text("Redis", { bold: true }),
      text(" or "),
      text("Memcached", { italic: true }),
      text(" here"),
    ]);
  });

  it("nests styles", () => {
    expect(parseInline("**bold *and italic* text**")).toEqual([
      text("bold ", { bold: true }),
      text("and italic", { bold: true, italic: true }),
      text(" text", { bold: true }),
    ]);
    expect(parseInline("***both***")).toEqual([text("both", { bold: true, italic: true })]);
    expect(parseInline("~~==x==~~")).toEqual([text("x", { strike: true, highlight: true })]);
  });

  it("keeps code spans verbatim, including markers", () => {
    expect(parseInline("`a*b*c` and **d**")).toEqual([
      text("a*b*c", { code: true }),
      text(" and "),
      text("d", { bold: true }),
    ]);
  });

  it("parses inline math and keeps markers inside it literal", () => {
    expect(parseInline("cost $2 \\cdot L * H$ total")).toEqual([
      text("cost "),
      { type: "mathInline", latex: "2 \\cdot L * H" },
      text(" total"),
    ]);
  });

  it("parses links, with styled text inside", () => {
    expect(parseInline("see [the **docs**](https://redis.io) now")).toEqual([
      text("see "),
      {
        type: "link",
        href: "https://redis.io",
        content: [text("the "), text("docs", { bold: true })],
      },
      text(" now"),
    ]);
  });

  it("treats unmatched markers as literal text", () => {
    expect(parseInline("a * b")).toEqual([text("a * b")]);
    expect(parseInline("**never closed")).toEqual([text("**never closed")]);
    expect(parseInline("price $5 and more")).toEqual([text("price $5 and more")]);
    expect(parseInline("[not a link]")).toEqual([text("[not a link]")]);
    expect(parseInline("[x](")).toEqual([text("[x](")]);
  });

  it("honours backslash escapes before any punctuation", () => {
    expect(parseInline("\\*not italic\\*")).toEqual([text("*not italic*")]);
    expect(parseInline("a\\_b\\_c")).toEqual([text("a_b_c")]);
    expect(parseInline("\\=\\=x\\=\\=")).toEqual([text("==x==")]);
    expect(parseInline("back\\\\slash")).toEqual([text("back\\slash")]);
    expect(parseInline("trailing\\")).toEqual([text("trailing\\")]);
    expect(parseInline("\\q")).toEqual([text("\\q")]);
  });

  it("does not let an escaped closing marker close a style", () => {
    expect(parseInline("**a\\*\\*b**")).toEqual([text("a**b", { bold: true })]);
  });
});

describe("escapeInline + inlineToMarkdown round trip", () => {
  const samples = [
    "plain text",
    "web_server and a*b and ~tilde~",
    "cost is $5 or $6",
    "see [1] and `ticks` and ==eq==",
    "back\\slash",
    "{struck}",
  ];
  it.each(samples)("parseInline(escapeInline(%j)) gives the text back", (sample) => {
    expect(parseInline(escapeInline(sample))).toEqual(sample === "" ? [] : [text(sample)]);
  });

  it("round-trips rich runs through inlineToMarkdown", () => {
    const runs: Inline[] = [
      text("Use "),
      text("Redis", { bold: true }),
      text(" and "),
      text("MongoDB", { strike: true }),
      text(" "),
      text("both", { bold: true, italic: true }),
      { type: "link", href: "https://x.io", content: [text("link")] },
      { type: "mathInline", latex: "O(n)" },
      text(" "),
      text("code", { code: true }),
    ];
    expect(parseInline(inlineToMarkdown(runs))).toEqual(runs);
  });
});

describe("emphasis resolution", () => {
  it("closes italic then bold in one run, and reopens after adjacent styled runs", () => {
    expect(parseInline("**a*b***")).toEqual([
      text("a", { bold: true }),
      text("b", { bold: true, italic: true }),
    ]);
    expect(parseInline("**a*****b***")).toEqual([
      text("a", { bold: true }),
      text("b", { bold: true, italic: true }),
    ]);
    expect(parseInline("*a****b***")).toEqual([
      text("a", { italic: true }),
      text("b", { bold: true, italic: true }),
    ]);
  });

  it("requires markers to hug text: a marker next to whitespace is literal", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([text("2 * 3 * 4")]);
    expect(parseInline("a ** b ** c")).toEqual([text("a ** b ** c")]);
    expect(parseInline("== not highlight ==")).toEqual([text("== not highlight ==")]);
  });

  it("leaves an opener without a closer literal while keeping later pairs", () => {
    expect(parseInline("*one **two** three")).toEqual([
      text("*one "),
      text("two", { bold: true }),
      text(" three"),
    ]);
  });
});

describe("inlineToMarkdown nesting and whitespace", () => {
  it("nests styles instead of wrapping each run", () => {
    const runs: Inline[] = [
      text("bold with ", { bold: true }),
      text("italic", { bold: true, italic: true }),
      text(" end", { bold: true }),
    ];
    expect(inlineToMarkdown(runs)).toBe("**bold with *italic* end**");
  });

  it("keeps whitespace outside the markers", () => {
    expect(inlineToMarkdown([text("a ", { bold: true }), text("b")])).toBe("**a** b");
    expect(inlineToMarkdown([text("x"), text(" b", { italic: true })])).toBe("x *b*");
  });

  it("round-trips runs whose styles change at every boundary", () => {
    const runs: Inline[] = [
      text("a", { bold: true }),
      text("b", { bold: true, italic: true }),
      text("c", { italic: true }),
      text("d", { strike: true }),
      text("e", { strike: true, highlight: true }),
      text("f"),
      text("g", { underline: true, bold: true, italic: true }),
    ];
    expect(parseInline(inlineToMarkdown(runs))).toEqual(runs);
  });
});
