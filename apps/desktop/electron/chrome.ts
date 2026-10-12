/**
 * The top of the window on a Mac. The window has no title bar of its own (no title text, no grey strip): the page's top row
 * takes its place and the three round buttons sit in it, in the middle of the row's height. The row is as high as the top bar
 * of the page, which grows with the window (`--bar-h` in styles.css: 32 px plus 1.6% of the width, between 56 and 72 px), so
 * the same rule is here.
 */
export const BAR_MIN = 56;
export const BAR_MAX = 72;
/** The height of the three buttons. */
const BUTTON = 12;
/** The space to the left of them. */
const LEFT = 20;

export function barHeight(contentWidth: number): number {
  return Math.min(BAR_MAX, Math.max(BAR_MIN, 32 + 0.016 * contentWidth));
}

/** Where the buttons go for a window of this width: a little in from the corner, in the middle of the top row. */
export function trafficLightPosition(contentWidth: number): { x: number; y: number } {
  return { x: LEFT, y: Math.round((barHeight(contentWidth) - BUTTON) / 2) };
}
