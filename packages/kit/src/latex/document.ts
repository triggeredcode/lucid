import type { Block, LucidDoc } from "@lucid/core";
import { blocksToLatex, collectFigures, headingOffsetOf, type Figure } from "./blocks";
import { escapeLatex } from "./escape";
import { inlineToLatex } from "./inline";
import { inlineToPlain } from "../text";
import { META_LABEL, type Format } from "../formats/types";
import {
  classOptions,
  preambleLines,
  resolveStyle,
  textSize,
  type ResolvedPdfStyle,
} from "./style";

export interface DocumentInput {
  title: string;
  doc: LucidDoc;
  author?: string;
  /** Right-hand footer text (optional; the page number is on the left). */
  footerRight?: string;
  /** The note format: its meta lines, formula numbering and diagram width, and empty sections are left out. */
  format?: Format | undefined;
  /** Values for the format's meta lines (source, book, chapter, date, hardware). */
  info?: Readonly<Record<string, string>> | undefined;
  /** The natural width in points of each figure that was rendered, by block id (see LatexContext.figureWidths). */
  figureWidths?: Readonly<Record<string, number>> | undefined;
  /** The natural height in points of each figure that was rendered, by block id. */
  figureHeights?: Readonly<Record<string, number>> | undefined;
  /** How the PDF looks (paper, text size, typeface, margins, accent, numbering, date); the house style when absent. */
  style?: Partial<ResolvedPdfStyle> | undefined;
}

export interface RenderedDocument {
  /** The contents of main.tex. */
  tex: string;
  /** Diagrams and charts to render as PDF figures into the file named in each entry. */
  figures: Figure[];
}

/** Drop a leading H1 that repeats the page title: the title already comes from \maketitle. */
function withoutTitleHeading(blocks: readonly Block[], title: string): Block[] {
  const first = blocks[0];
  if (
    first?.type === "heading" &&
    first.props["level"] === 1 &&
    inlineToPlain(first.content).trim() === title.trim()
  ) {
    return blocks.slice(1);
  }
  return [...blocks];
}

/**
 * Headings with nothing under them (a new page of a format starts as a row of empty section headings) do not print.
 * A heading is empty when no block other than headings comes before the next heading of the same or a higher level.
 */
export function withoutEmptySections(blocks: readonly Block[]): Block[] {
  const level = (b: Block): number =>
    b.props["level"] === 2 || b.props["level"] === 3 ? b.props["level"] : 1;
  const drop = new Set<number>();
  blocks.forEach((b, i) => {
    if (b.type !== "heading") return;
    let hasContent = false;
    for (let j = i + 1; j < blocks.length; j++) {
      const next = blocks[j];
      if (!next) break;
      if (next.type === "heading") {
        if (level(next) <= level(b)) break;
        continue;
      }
      hasContent = true;
      break;
    }
    if (!hasContent) drop.add(i);
  });
  return blocks.filter((_, i) => !drop.has(i));
}

/**
 * main.tex for a page in the Lucid house style. Figures that were already rendered are passed in
 * `rendered` (block id to relative file); the others are listed in the result so the caller can render them.
 */
export function renderDocument(
  input: DocumentInput,
  rendered: Readonly<Record<string, string>> = {},
): RenderedDocument {
  const style = input.style ? { ...resolveStyle({}, "US"), ...input.style } : undefined;
  const size = style ? textSize(style) : undefined;
  const kept = withoutTitleHeading(input.doc.blocks, input.title);
  const blocks = input.format ? withoutEmptySections(kept) : kept;
  const figures = collectFigures(blocks);
  const known: Record<string, string> = {};
  for (const f of figures) if (rendered[f.blockId]) known[f.blockId] = f.file;
  const body = blocksToLatex(blocks, {
    figures: known,
    ...(input.figureWidths ? { figureWidths: input.figureWidths } : {}),
    ...(input.figureHeights ? { figureHeights: input.figureHeights } : {}),
    ...(size ? { textWidth: size.width, textHeight: size.height } : {}),
    headingOffset: headingOffsetOf(blocks),
    ...(input.format
      ? {
          equationNumbers: input.format.latex.equationNumbers,
          diagramWidth: input.format.latex.diagramWidth,
        }
      : {}),
  });
  const meta = (input.format?.meta ?? [])
    .map((field) => ({ field, value: (input.info?.[field] ?? "").trim() }))
    .filter((m) => m.value.length > 0)
    .map((m) => `\\lucidmeta{${META_LABEL[m.field]}}{${escapeLatex(m.value)}}`);
  const titleText = `\\underline{${escapeLatex(input.title.trim() || "Untitled")}}`;
  const tex = [
    style ? `\\documentclass[${classOptions(style)}]{article}` : "\\documentclass{article}",
    "\\usepackage{lucid}",
    ...(style ? preambleLines(style) : []),
    `\\renewcommand{\\lucidfooterright}{${escapeLatex(input.footerRight ?? "")}}`,
    `\\title{${style && style.accent !== "none" ? `\\textcolor{lucidaccent}{${titleText}}` : titleText}}`,
    `\\author{${escapeLatex(input.author ?? "")}}`,
    style && !style.showDate ? "\\date{}" : "\\date{\\today}",
    "\\begin{document}",
    "\\maketitle",
    ...meta,
    body,
    "\\end{document}",
    "",
  ].join("\n");
  return { tex, figures };
}

export { inlineToLatex };
