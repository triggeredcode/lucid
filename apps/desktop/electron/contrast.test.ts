import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colourTokens, contrastRatio as ratio } from "./wcag";

/**
 * The side panels (the pages and the History) must stand out from the page, and their text must be readable, in both themes.
 * The colours are read from the style sheet itself, so a change to a token that makes the panels fade back into the page, or
 * their small text hard to read, fails here.
 */
const css = readFileSync(join(__dirname, "../src/styles.css"), "utf8");

describe.each([
  ["light", ":root"],
  ["dark", ':root[data-theme="dark"]'],
])("the %s theme", (_name, selector) => {
  const t = colourTokens(css, selector);
  const get = (k: string): string => {
    const v = t[k];
    expect(v, k).toBeDefined();
    return v ?? "#000000";
  };

  it("sets the side panels clearly apart from the page", () => {
    expect(ratio(get("--panel"), get("--bg"))).toBeGreaterThanOrEqual(1.1);
    expect(ratio(get("--panel-line"), get("--panel"))).toBeGreaterThanOrEqual(1.2);
    expect(ratio(get("--panel-2"), get("--panel"))).toBeGreaterThanOrEqual(1.05);
  });

  it("keeps the text on the panels readable: names, labels and small print", () => {
    expect(ratio(get("--ink"), get("--panel"))).toBeGreaterThanOrEqual(7);
    expect(ratio(get("--ink-2"), get("--panel"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(get("--ink-3"), get("--panel"))).toBeGreaterThanOrEqual(3);
  });

  it("keeps the secondary text on the page readable too", () => {
    expect(ratio(get("--ink-2"), get("--bg"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(get("--ink-3"), get("--bg"))).toBeGreaterThanOrEqual(3);
  });
});
