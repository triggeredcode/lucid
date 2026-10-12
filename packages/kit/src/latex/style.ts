import { z } from "zod";

/**
 * How a PDF looks, beyond what a note format decides: the few choices a person makes about their own pages. Everything
 * defaults to the house style, and a page made with the defaults is byte for byte what it was before there were choices.
 * The choices are written into the preamble of main.tex (after `\usepackage{lucid}`), so `lucid.sty` stays one fixed file.
 */
export const PAPERS = ["auto", "a4", "letter"] as const;
export const FONT_SIZES = [10, 11, 12] as const;
export const FONTS = ["latin-modern", "palatino", "times", "helvetica"] as const;
export const MARGINS = ["normal", "narrow", "wide"] as const;
export const ACCENTS = ["none", "navy", "teal", "crimson", "forest", "plum"] as const;

export const PdfStyleSchema = z.strictObject({
  /** The paper; "auto" is chosen by the caller from where the computer is (Letter in North America, A4 elsewhere). */
  paper: z.enum(PAPERS).default("auto"),
  /** The size of the text in points. */
  fontSize: z.union([z.literal(10), z.literal(11), z.literal(12)]).default(10),
  /** The typeface: Latin Modern (the house style), or one of the TeX Gyre faces that come with the PDF engine. */
  font: z.enum(FONTS).default("latin-modern"),
  /** The space round the text. */
  margins: z.enum(MARGINS).default("normal"),
  /** The colour of the title and the headings (none: black). */
  accent: z.enum(ACCENTS).default("none"),
  /** Headings are numbered (1, 1.1). */
  numberedHeadings: z.boolean().default(true),
  /** Today's date under the title. */
  showDate: z.boolean().default(true),
});
export type PdfStyle = z.infer<typeof PdfStyleSchema>;
/** A style with the paper decided. */
export type ResolvedPdfStyle = Omit<PdfStyle, "paper"> & { paper: "a4" | "letter" };

export const DEFAULT_PDF_STYLE: PdfStyle = PdfStyleSchema.parse({});

export const FONT_NAMES: Record<PdfStyle["font"], string> = {
  "latin-modern": "Latin Modern",
  palatino: "Palatino",
  times: "Times",
  helvetica: "Helvetica",
};

/** The colours (hex, no #) of the accents: dark enough to read as text on white. */
export const ACCENT_COLORS: Record<Exclude<PdfStyle["accent"], "none">, string> = {
  navy: "1F3A68",
  teal: "0F6B6B",
  crimson: "9B1C31",
  forest: "2F6B3A",
  plum: "6B2F6B",
};

/** Paper from a country code: Letter in the countries that use it, A4 everywhere else. */
export function paperForCountry(country: string | undefined): "a4" | "letter" {
  const letter = new Set([
    "US",
    "CA",
    "MX",
    "CL",
    "CO",
    "VE",
    "PH",
    "CR",
    "PA",
    "DO",
    "GT",
    "SV",
    "NI",
    "HN",
    "PR",
  ]);
  return letter.has((country ?? "").toUpperCase()) ? "letter" : "a4";
}

export function resolveStyle(style: Partial<PdfStyle>, country?: string): ResolvedPdfStyle {
  const full = PdfStyleSchema.parse(style);
  return { ...full, paper: full.paper === "auto" ? paperForCountry(country) : full.paper };
}

const GYRE = (file: string): string =>
  `{${file}}[Extension=.otf,UprightFont=*-regular,BoldFont=*-bold,ItalicFont=*-italic,BoldItalicFont=*-bolditalic]`;

/** The options of `\documentclass`: none for the house style on Letter paper at 10 pt, as it always was. */
export function classOptions(style: ResolvedPdfStyle): string {
  const options = [style.paper === "a4" ? "a4paper" : "letterpaper"];
  if (style.fontSize !== 10) options.push(`${String(style.fontSize)}pt`);
  return options.join(",");
}

/** The lines of the preamble (after `\usepackage{lucid}`) that carry the style; empty for the house style. */
export function preambleLines(style: ResolvedPdfStyle): string[] {
  const lines: string[] = [];
  if (style.margins === "narrow") lines.push("\\usepackage[margin=1in]{geometry}");
  if (style.margins === "wide") lines.push("\\usepackage[margin=2.2in]{geometry}");
  if (style.font === "palatino") lines.push(`\\setmainfont${GYRE("texgyrepagella")}`);
  if (style.font === "times") lines.push(`\\setmainfont${GYRE("texgyretermes")}`);
  if (style.font === "helvetica")
    lines.push(`\\setmainfont${GYRE("texgyreheros")}`, `\\setsansfont${GYRE("texgyreheros")}`);
  if (style.accent !== "none") {
    lines.push(
      `\\definecolor{lucidaccent}{HTML}{${ACCENT_COLORS[style.accent]}}`,
      "\\usepackage{sectsty}",
      "\\allsectionsfont{\\color{lucidaccent}}",
    );
  }
  if (!style.numberedHeadings) lines.push("\\setcounter{secnumdepth}{0}");
  return lines;
}

/**
 * About how big the text area is, in points: what figures are fitted to. Close, not exact (the exact size is TeX's to decide,
 * and every figure is also limited in the LaTeX by fractions of the real size).
 */
export function textSize(style: ResolvedPdfStyle): { width: number; height: number } {
  const page = style.paper === "a4" ? { w: 595, h: 842 } : { w: 612, h: 792 };
  const normalWidth = { 10: 345, 11: 360, 12: 390 }[style.fontSize];
  const width =
    style.margins === "narrow"
      ? page.w - 144
      : style.margins === "wide"
        ? page.w - 2 * 158.4
        : normalWidth;
  const height =
    style.margins === "narrow"
      ? page.h - 144
      : style.margins === "wide"
        ? page.h - 144
        : Math.round(page.h * 0.7475);
  return { width: Math.round(width), height: Math.round(height) };
}
