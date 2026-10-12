import { describe, expect, it } from "vitest";
import { barHeight, trafficLightPosition } from "./chrome";

describe("the top row of the window on a Mac", () => {
  it("is as high as the page's top bar: 32 px plus 1.6% of the width, between 56 and 72", () => {
    expect(barHeight(820)).toBe(56); // 45.1, held up to the least
    expect(barHeight(1500)).toBeCloseTo(56, 5);
    expect(barHeight(2000)).toBe(64);
    expect(barHeight(3000)).toBe(72); // 80, held down to the most
  });

  it("puts the three buttons in the middle of it, with room to their left", () => {
    expect(trafficLightPosition(1280)).toEqual({ x: 20, y: 22 });
    expect(trafficLightPosition(2000)).toEqual({ x: 20, y: 26 });
    expect(trafficLightPosition(3456)).toEqual({ x: 20, y: 30 });
  });
});
