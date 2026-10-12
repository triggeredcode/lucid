/**
 * Fitting a drawing to the space it is shown in without making its text unreadable. A flowchart with many parts, drawn
 * left to right, gets very wide; squeezed into the width of a page its boxes and words shrink until they cannot be read.
 * So the drawing is tried in the other direction too (top to bottom is usually narrower), and the one that has to be
 * shrunk least is used. If even that would be too small, the figure keeps a readable minimum size and scrolls on screen.
 *
 * Pure functions, so they can be tested without a browser.
 */

/** A drawing that has to be scaled below this is hard to read: on screen it scrolls instead of shrinking further. */
export const MIN_SCALE = 0.7;
/** At or above this a drawing is comfortable as it is: the other direction is not even tried. */
export const GOOD_SCALE = 0.85;
/** The other direction must be clearly better to be preferred (the stored direction is what the person asked for). */
const CLEARLY_BETTER = 1.08;

export interface Size {
  width: number;
  height: number;
}
export interface Box {
  width: number;
  /** Absent when the space has no height limit (a page that scrolls). */
  height?: number;
}

/** The natural size of an SVG, from its viewBox. */
export function svgSize(svg: string): Size | undefined {
  const m = /<svg\b[^>]*\bviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(
    svg,
  );
  const width = Number(m?.[1]);
  const height = Number(m?.[2]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : undefined;
}

/** How much a drawing of this size is scaled to fit the box (never enlarged). */
export function fitScale(size: Size, box: Box): number {
  const byWidth = box.width / size.width;
  const byHeight = box.height === undefined ? Number.POSITIVE_INFINITY : box.height / size.height;
  return Math.min(1, byWidth, byHeight);
}

/** The same flowchart drawn the other way round (left to right becomes top to bottom); undefined for anything else. */
export function flipDirection(source: string): string | undefined {
  const m = /^(\s*flowchart\s+)(LR|TB|RL|BT|TD)\b/.exec(source);
  if (!m?.[2]) return undefined;
  const flipped = m[2] === "LR" || m[2] === "RL" ? "TB" : "LR";
  return `${m[1] ?? ""}${flipped}${source.slice(m[0].length)}`;
}

export interface Layout {
  svg: string;
  scale: number;
  size: Size;
  /** True when this is the drawing in the other direction than the one stored. */
  flipped: boolean;
}

/** Of the stored direction and the flipped one, the one to show: the other only when it is clearly less shrunk. */
export function chooseLayout(stored: Layout, flipped: Layout | undefined): Layout {
  if (!flipped) return stored;
  return flipped.scale > stored.scale * CLEARLY_BETTER ? flipped : stored;
}

/** The width below which a drawing is not shrunk on screen: it scrolls inside its figure instead. */
export const minWidthFor = (size: Size): number => Math.round(size.width * MIN_SCALE);

/**
 * The most a figure can get on a PDF page, in the drawing's pixels (1 px is 0.75 pt): the text area of the house style is
 * about 345 pt wide and 592 pt high, a big figure may reach 1.3 times the text width (into the margins) and 0.85 of the
 * text height (a taller one could not be on a page with its caption). The same limits as in the LaTeX.
 */
export function pdfBox(): Box {
  const textWidthPx = 345 / 0.75;
  const textHeightPx = 592 / 0.75;
  return { width: Math.round(1.3 * textWidthPx), height: Math.round(0.85 * textHeightPx) };
}
