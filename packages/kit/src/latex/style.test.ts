import { describe, expect, it } from "vitest";
import { registry } from "../defaultRegistry";
import { renderDocument } from "./document";
import {
  ACCENTS,
  DEFAULT_PDF_STYLE,
  FONTS,
  PdfStyleSchema,
  paperForCountry,
  resolveStyle,
  textSize,
} from "./style";

const doc = {
  blocks: [
    registry.validateBlock({
      id: "h",
      type: "heading",
      props: { level: 1 },
      content: [{ type: "text", text: "Caching", styles: {} }],
    }),
  ],
};
const tex = (style?: Parameters<typeof renderDocument>[0]["style"]): string =>
  renderDocument({ title: "Notes", doc, style }).tex;

describe("the PDF style choices", () => {
  it("default to the house style", () => {
    expect(DEFAULT_PDF_STYLE).toEqual({
      paper: "auto",
      fontSize: 10,
      font: "latin-modern",
      margins: "normal",
      accent: "none",
      numberedHeadings: true,
      showDate: true,
    });
  });

  it("refuse values that are not offered, and unknown choices", () => {
    expect(PdfStyleSchema.safeParse({ fontSize: 14 }).success).toBe(false);
    expect(PdfStyleSchema.safeParse({ font: "comic-sans" }).success).toBe(false);
    expect(PdfStyleSchema.safeParse({ colour: "red" }).success).toBe(false);
  });

  it("give Letter in North America and A4 everywhere else", () => {
    expect(paperForCountry("US")).toBe("letter");
    expect(paperForCountry("ca")).toBe("letter");
    expect(paperForCountry("IN")).toBe("a4");
    expect(paperForCountry("DE")).toBe("a4");
    expect(paperForCountry(undefined)).toBe("a4");
    expect(resolveStyle({}, "IN").paper).toBe("a4");
    expect(resolveStyle({ paper: "letter" }, "IN").paper).toBe("letter");
  });
});

describe("a document with a style", () => {
  it("is exactly what it always was when no style is given", () => {
    const text = tex();
    expect(text).toContain("\\documentclass{article}\n\\usepackage{lucid}\n\\renewcommand");
    expect(text).toContain("\\date{\\today}");
    expect(text).not.toContain("geometry");
    expect(text).not.toContain("lucidaccent");
  });

  it("with the defaults changes only the paper, which it names", () => {
    const text = tex({});
    expect(text).toContain(
      "\\documentclass[letterpaper]{article}\n\\usepackage{lucid}\n\\renewcommand",
    );
    expect(text).toContain("\\date{\\today}");
  });

  it("sets the paper and the text size", () => {
    expect(tex({ paper: "a4", fontSize: 11 })).toContain("\\documentclass[a4paper,11pt]{article}");
    expect(tex({ fontSize: 12 })).toContain("\\documentclass[letterpaper,12pt]{article}");
  });

  it("sets the margins with geometry", () => {
    expect(tex({ margins: "narrow" })).toContain("\\usepackage[margin=1in]{geometry}");
    expect(tex({ margins: "wide" })).toContain("\\usepackage[margin=2.2in]{geometry}");
    expect(tex({ margins: "normal" })).not.toContain("geometry");
  });

  it("sets the typeface after the house style has set its own", () => {
    expect(tex({ font: "latin-modern" })).not.toContain("\\setmainfont");
    const palatino = tex({ font: "palatino" });
    expect(palatino).toContain("\\setmainfont{texgyrepagella}[Extension=.otf");
    expect(palatino.indexOf("\\usepackage{lucid}")).toBeLessThan(palatino.indexOf("\\setmainfont"));
    expect(tex({ font: "times" })).toContain("\\setmainfont{texgyretermes}");
    const sans = tex({ font: "helvetica" });
    expect(sans).toContain("\\setmainfont{texgyreheros}");
    expect(sans).toContain("\\setsansfont{texgyreheros}");
  });

  it("colours the title and the headings with the accent", () => {
    const text = tex({ accent: "navy" });
    expect(text).toContain("\\definecolor{lucidaccent}{HTML}{1F3A68}");
    expect(text).toContain("\\allsectionsfont{\\color{lucidaccent}}");
    expect(text).toContain("\\title{\\textcolor{lucidaccent}{\\underline{Notes}}}");
    expect(tex({ accent: "none" })).toContain("\\title{\\underline{Notes}}");
    for (const accent of ACCENTS) expect(() => tex({ accent })).not.toThrow();
  });

  it("can leave out the heading numbers and the date", () => {
    const text = tex({ numberedHeadings: false, showDate: false });
    expect(text).toContain("\\setcounter{secnumdepth}{0}");
    expect(text).toContain("\\date{}");
    expect(text).not.toContain("\\date{\\today}");
  });

  it("offers a typeface for every name in the list", () => {
    for (const font of FONTS) expect(tex({ font })).toContain("\\begin{document}");
  });
});

describe("the size of the text area", () => {
  it("is the house style's on Letter paper at 10 pt", () => {
    expect(textSize(resolveStyle({ paper: "letter" }))).toEqual({ width: 345, height: 592 });
  });
  it("grows with the text size, and with narrow margins", () => {
    expect(textSize(resolveStyle({ paper: "letter", fontSize: 12 })).width).toBe(390);
    expect(textSize(resolveStyle({ paper: "letter", margins: "narrow" }))).toEqual({
      width: 468,
      height: 648,
    });
  });
  it("is taller on A4", () => {
    expect(textSize(resolveStyle({ paper: "a4" })).height).toBeGreaterThan(592);
  });
});
