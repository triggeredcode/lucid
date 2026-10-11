import { describe, expect, it } from "vitest";
import { svgSize } from "./svgSize";

describe("svgSize", () => {
  it("is the size in the viewBox, whatever else the drawing says", () => {
    expect(
      svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="4 4 559.4 434.38">'),
    ).toEqual({ width: 559.4, height: 434.38 });
    expect(svgSize('<svg viewBox="0,0,200,60">')).toEqual({ width: 200, height: 60 });
    expect(svgSize('<svg id="x" viewBox="-10 -10 30.5 20">')).toEqual({ width: 30.5, height: 20 });
  });

  it("has a default size for a drawing without a usable viewBox", () => {
    for (const svg of [
      "<svg>",
      '<svg viewBox="0 0 0 0">',
      '<svg viewBox="a b c d">',
      "not a drawing",
    ])
      expect(svgSize(svg), svg).toEqual({ width: 800, height: 600 });
  });
});
