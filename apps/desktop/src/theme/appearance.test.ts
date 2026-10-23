import { describe, expect, it } from "vitest";
import { parseFont, parsePageLook, parseTheme, resolvePageLook, resolveTheme } from "./appearance";

describe("resolveTheme", () => {
  it("follows the system only when asked to", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("a saved appearance", () => {
  it("is used when it is one of ours", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseFont("serif")).toBe("serif");
    expect(parseFont("sans")).toBe("sans");
  });

  it("falls back to the system's theme and the mono type when there is none or it is unknown", () => {
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("purple")).toBe("system");
    expect(parseFont(null)).toBe("mono");
    expect(parseFont("comic")).toBe("mono");
  });
});

describe("the look of the page, apart from the app's", () => {
  it("is the app's own unless the person chose light or dark for the page", () => {
    expect(resolvePageLook("auto", "dark")).toBe("dark");
    expect(resolvePageLook("auto", "light")).toBe("light");
    // A light page in a dark app (paper), and a dark page in a light app.
    expect(resolvePageLook("light", "dark")).toBe("light");
    expect(resolvePageLook("dark", "light")).toBe("dark");
  });

  it("is read from what was saved, and falls back to the app's when there is nothing or something else", () => {
    expect(parsePageLook("light")).toBe("light");
    expect(parsePageLook("dark")).toBe("dark");
    expect(parsePageLook("auto")).toBe("auto");
    expect(parsePageLook(null)).toBe("auto");
    expect(parsePageLook("sepia")).toBe("auto");
  });
});
