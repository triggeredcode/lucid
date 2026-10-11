import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The side panels (the pages and the History) must stand out from the page, and their text must be readable, in both themes.
 * The colours are read from the style sheet itself, so a change to a token that makes the panels fade back into the page, or
 * their small text hard to read, fails here.
 */
const css = readFileSync(join(__dirname, "../src/styles.css"), "utf8");

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi))
    out[m[1] ?? ""] = m[2] ?? "";
  return out;
}

const channel = (v: number): number => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}
/** WCAG contrast ratio, from 1 (the same) to 21 (black on white). */
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe.each([
  ["light", ":root"],
  ["dark", ':root[data-theme="dark"]'],
])("the %s theme", (_name, selector) => {
  const t = tokens(selector);
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
