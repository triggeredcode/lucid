export { blocksToLatex, collectFigures, type Figure, type LatexContext } from "./blocks";
export {
  renderDocument,
  withoutEmptySections,
  type DocumentInput,
  type RenderedDocument,
} from "./document";
export { escapeLatex } from "./escape";
export { inlineToLatex } from "./inline";
export { LUCID_STY } from "./lucidSty";
export {
  ACCENTS,
  ACCENT_COLORS,
  DEFAULT_PDF_STYLE,
  FONTS,
  FONT_NAMES,
  FONT_SIZES,
  MARGINS,
  PAPERS,
  PdfStyleSchema,
  paperForCountry,
  resolveStyle,
  textSize,
  type PdfStyle,
  type ResolvedPdfStyle,
} from "./style";
