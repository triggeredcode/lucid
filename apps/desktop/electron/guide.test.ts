import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMeta } from "@lucid/core";
import { describe, expect, it } from "vitest";

/**
 * docs/guide.html explains how to use Lucid in one page. Its words are written by hand, so these checks keep it from
 * drifting: the voice phrases it lists are the ones the app really understands, the numbered markers on its pictures match
 * the lists under them, its links work, and it stays one file that needs no network.
 */
const html = readFileSync(join(__dirname, "../../../docs/guide.html"), "utf8");

const section = (id: string): string => {
  const start = html.indexOf(`<section id="${id}">`);
  expect(start, `section ${id}`).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf("</section>", start));
};
const codes = (fragment: string): string[] =>
  [...fragment.matchAll(/<code>([^<]+)<\/code>/g)].map((m) => m[1] ?? "");
const numbers = (fragment: string, pattern: RegExp): number[] =>
  [...fragment.matchAll(pattern)].map((m) => Number(m[1])).sort((a, b) => a - b);

describe("docs/guide.html", () => {
  it("lists only voice commands the app understands", () => {
    // Every phrase in the first column of the table, with a proposal, a question and a job waiting.
    const rows = section("commands")
      .split("<tr>")
      .slice(2)
      .map((row) => codes(row.split("</td>")[0] ?? ""));
    const phrases = rows.flat();
    expect(phrases.length).toBeGreaterThan(25);
    const unknown = phrases
      .filter((p) => !p.startsWith("Lucid,"))
      .filter((p) => parseMeta(p, { proposal: true, clarify: true, running: true }) === undefined);
    expect(unknown).toEqual([]);
  });

  it("names the three modes with phrases that switch to them", () => {
    const mode = (phrase: string) =>
      parseMeta(phrase, { proposal: false, clarify: false, running: false });
    for (const [phrase, expected] of [
      ["input mode", "input"],
      ["command mode", "command"],
      ["edit mode", "edit"],
    ] as const) {
      expect(codes(section("modes"))).toContain(phrase);
      expect(mode(phrase)).toEqual({ intent: "mode", mode: expected });
    }
  });

  it("numbers every marker on a picture in its list", () => {
    const figures = html.split('<figure class="shot">').slice(1);
    expect(figures.length).toBe(2);
    for (const figure of figures) {
      const pins = numbers(figure, /class="pin"[^>]*>(\d+)</g);
      const legend = numbers(figure.slice(figure.indexOf("</figure>")), /class="n">(\d+)</g);
      expect(pins.length).toBeGreaterThanOrEqual(5);
      expect(legend.slice(0, pins.length)).toEqual(pins);
      expect(pins).toEqual(pins.map((_, i) => i + 1));
    }
  });

  it("links the contents to sections that exist", () => {
    const targets = [...html.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1] ?? "");
    expect(targets.length).toBeGreaterThan(15);
    const missing = targets.filter((id) => !html.includes(`id="${id}"`));
    expect(missing).toEqual([]);
  });

  it("is one file that needs no network", () => {
    // Nothing is loaded from the internet; the only links out are to the project's own pages on GitHub.
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/<link[^>]*href="https?:/);
    const links = [...html.matchAll(/<a [^>]*href="(https?:[^"]+)"/g)].map((m) => m[1] ?? "");
    expect(links.filter((u) => !u.startsWith("https://github.com/triggeredcode/lucid/"))).toEqual(
      [],
    );
    expect(html).not.toMatch(/url\(\s*["']?https?:/);
    expect(html).not.toContain("@import");
    expect(html).not.toContain("@@");
    // Pictures are in the file, in a light and a dark version each.
    expect(html.match(/src="data:image\/jpeg;base64,/g)?.length).toBe(8);
  });
});
