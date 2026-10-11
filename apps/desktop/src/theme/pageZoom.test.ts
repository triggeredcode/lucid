import { describe, expect, it } from "vitest";
import { ZOOM_STEPS, clampZoom, parseZoom, stepZoom, wheelZoom } from "./pageZoom";

describe("page zoom", () => {
  it("steps up and down through the sizes and stops at the ends", () => {
    expect(stepZoom(1, "in")).toBe(1.1);
    expect(stepZoom(1, "out")).toBe(0.9);
    expect(stepZoom(3, "in")).toBe(3);
    expect(stepZoom(0.5, "out")).toBe(0.5);
    let z = 1;
    for (let i = 0; i < 30; i++) z = stepZoom(z, "in");
    expect(z).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  });

  it("goes to the next step from a size between two (after a pinch)", () => {
    expect(stepZoom(1.18, "in")).toBe(1.25);
    expect(stepZoom(1.18, "out")).toBe(1.1);
  });

  it("keeps a saved zoom in range and ignores rubbish", () => {
    expect(parseZoom("1.5")).toBe(1.5);
    expect(parseZoom("9")).toBe(3);
    expect(parseZoom("0.1")).toBe(0.5);
    for (const bad of [null, "", "abc", "NaN"]) expect(parseZoom(bad), String(bad)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("zooms with a pinch or Ctrl+scroll: apart is bigger, together is smaller, a notch is not a jump", () => {
    expect(wheelZoom(1, -10)).toBeGreaterThan(1);
    expect(wheelZoom(1, 10)).toBeLessThan(1);
    expect(wheelZoom(1, -100)).toBeLessThan(1.3);
    expect(wheelZoom(2.9, -25)).toBe(3);
    expect(wheelZoom(0.52, 25)).toBe(0.5);
  });
});
