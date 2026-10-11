import { describe, expect, it } from "vitest";
import { boundsToOpen, parseWindowState } from "./windowState";

const screen = { x: 0, y: 0, width: 1728, height: 1051 };
const saved = { x: 100, y: 80, width: 1200, height: 800, maximized: false };

describe("parseWindowState", () => {
  it("reads a saved state", () => {
    expect(parseWindowState(JSON.stringify(saved))).toEqual(saved);
    expect(parseWindowState(JSON.stringify({ ...saved, maximized: true }))?.maximized).toBe(true);
  });

  it("never makes the window smaller than the app can be used at", () => {
    expect(parseWindowState(JSON.stringify({ ...saved, width: 10, height: 10 }))).toMatchObject({
      width: 820,
      height: 560,
    });
  });

  it("is nothing for a missing, damaged or incomplete file", () => {
    for (const text of [
      "",
      "{ nope",
      "[]",
      "null",
      JSON.stringify({ x: 1, y: 2 }),
      JSON.stringify({ ...saved, x: "a" }),
    ])
      expect(parseWindowState(text), text).toBeUndefined();
  });
});

describe("boundsToOpen", () => {
  const fallback = { width: 1280, height: 800 };

  it("opens where it was left", () => {
    expect(boundsToOpen(saved, [screen], fallback)).toEqual({
      x: 100,
      y: 80,
      width: 1200,
      height: 800,
    });
  });

  it("opens with the saved size but lets the system place it when its screen is gone", () => {
    expect(boundsToOpen({ ...saved, x: 4000 }, [screen], fallback)).toEqual({
      width: 1200,
      height: 800,
    });
    expect(boundsToOpen({ ...saved, x: 1700, y: 1040 }, [screen], fallback)).toEqual({
      width: 1200,
      height: 800,
    });
  });

  it("uses the default size the first time", () => {
    expect(boundsToOpen(undefined, [screen], fallback)).toEqual(fallback);
  });

  it("finds it on a second screen", () => {
    const second = { x: 1728, y: 0, width: 1920, height: 1080 };
    expect(boundsToOpen({ ...saved, x: 2000 }, [screen, second], fallback)).toMatchObject({
      x: 2000,
    });
  });
});
