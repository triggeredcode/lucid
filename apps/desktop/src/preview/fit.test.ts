import { describe, expect, it } from "vitest";
import {
  GOOD_SCALE,
  MIN_SCALE,
  chooseLayout,
  fitScale,
  flipDirection,
  minWidthFor,
  pdfBox,
  svgSize,
  type Layout,
} from "./fit";

const svg = (w: number, h: number) =>
  `<svg id="x" width="100%" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(w)} ${String(h)}" style="max-width: ${String(w)}px;"><g/></svg>`;

describe("the size of a drawing", () => {
  it("is read from the viewBox", () => {
    expect(svgSize(svg(1843.5, 402))).toEqual({ width: 1843.5, height: 402 });
    expect(svgSize('<svg viewBox="-8 -8 320.5 140">')).toEqual({ width: 320.5, height: 140 });
  });
  it("is unknown when there is none", () => {
    expect(svgSize("<svg><g/></svg>")).toBeUndefined();
    expect(svgSize("not an svg")).toBeUndefined();
  });
});

describe("how much a drawing is shrunk", () => {
  it("never enlarges, and is limited by the width and, when there is one, the height", () => {
    expect(fitScale({ width: 400, height: 300 }, { width: 1000 })).toBe(1);
    expect(fitScale({ width: 2000, height: 400 }, { width: 1000 })).toBe(0.5);
    expect(fitScale({ width: 800, height: 1600 }, { width: 1000, height: 800 })).toBe(0.5);
    expect(fitScale({ width: 800, height: 1600 }, { width: 1000 })).toBe(1);
  });
  it("is a sensible ladder: comfortable above 85%, readable down to 70%", () => {
    expect(GOOD_SCALE).toBeGreaterThan(MIN_SCALE);
    expect(minWidthFor({ width: 1000, height: 10 })).toBe(700);
  });
});

describe("the other direction", () => {
  it("swaps left to right and top to bottom, and leaves the rest of the text alone", () => {
    expect(flipDirection('flowchart LR\n  a["A"] --> b["B"]')).toBe(
      'flowchart TB\n  a["A"] --> b["B"]',
    );
    expect(flipDirection("flowchart TB\n  a --> b")).toBe("flowchart LR\n  a --> b");
    expect(flipDirection("flowchart TD\n  a --> b")).toBe("flowchart LR\n  a --> b");
  });
  it("is not offered for sequence or ER diagrams", () => {
    expect(flipDirection("sequenceDiagram\n  a->>b: hi")).toBeUndefined();
    expect(flipDirection("erDiagram\n  A ||--o{ B : has")).toBeUndefined();
  });
});

describe("choosing between the two", () => {
  const layout = (scale: number, flipped: boolean): Layout => ({
    svg: flipped ? "flipped" : "stored",
    scale,
    size: { width: 100, height: 100 },
    flipped,
  });
  it("keeps the stored direction unless the other is clearly less shrunk", () => {
    expect(chooseLayout(layout(0.3, false), layout(0.31, true)).svg).toBe("stored");
    expect(chooseLayout(layout(0.3, false), layout(0.5, true)).svg).toBe("flipped");
    expect(chooseLayout(layout(0.9, false), undefined).svg).toBe("stored");
    expect(chooseLayout(layout(0.5, false), layout(0.4, true)).svg).toBe("stored");
  });
});

describe("the space on a PDF page", () => {
  it("is 1.3 times the text width and 0.85 of the text height, in the drawing's pixels", () => {
    expect(pdfBox()).toEqual({ width: 598, height: 671 });
  });
});
