import { describe, expect, it } from "vitest";
import { parseFont, parseTheme, resolveTheme } from "./appearance";

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
