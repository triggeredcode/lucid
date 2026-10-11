import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colourTokens, contrastRatio } from "./wcag";

/**
 * The GitHub Pages site (site/, with the pictures from docs/images and the guide, assembled by scripts/build-site.mjs): its
 * links work, nothing is loaded from a third party, the page is built the way a page should be, and its colours keep their
 * contrast in both themes.
 */
const root = join(__dirname, "../../..");
const html = readFileSync(join(root, "site/index.html"), "utf8");
const css = readFileSync(join(root, "site/style.css"), "utf8");
const js = readFileSync(join(root, "site/main.js"), "utf8");

/** Where a path in the page ends up: the site folder, the pictures, or the guide (see scripts/build-site.mjs). */
function source(path: string): string {
  if (path.startsWith("images/")) return join(root, "docs", path);
  if (path === "guide.html") return join(root, "docs/guide.html");
  return join(root, "site", path);
}
const attr = (name: string): string[] =>
  [...html.matchAll(new RegExp(`\\s${name}="([^"]+)"`, "g"))].map((m) => m[1] ?? "");

describe("site/index.html", () => {
  it("is one page with one h1, a title, a description and a language", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toMatch(/<title>[^<]{10,}<\/title>/);
    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]{60,}"/);
    expect(html).toContain('property="og:image"');
  });

  it("links only to files that exist, and to anchors that exist", () => {
    const local = [...attr("src"), ...attr("href")].filter((v) => !/^(https?:|#|mailto:)/.test(v));
    expect(local.length).toBeGreaterThan(10);
    for (const path of new Set(local)) expect(existsSync(source(path)), path).toBe(true);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const a of attr("href").filter((v) => v.startsWith("#") && v.length > 1))
      expect(ids.has(a.slice(1)), a).toBe(true);
  });

  it("loads nothing from the internet, and links out only to the project and LM Studio", () => {
    expect(html).not.toMatch(/\ssrc="https?:/);
    expect(html).not.toMatch(/<link[^>]*rel="stylesheet"[^>]*href="https?:/);
    expect(css).not.toMatch(/url\(\s*["']?https?:/);
    expect(css).not.toContain("@import");
    const out = attr("href").filter((v) => /^https?:/.test(v) && !v.includes("rel=canonical"));
    const allowed = [
      "https://github.com/triggeredcode/lucid",
      "https://lmstudio.ai",
      "https://triggeredcode.github.io/lucid/",
    ];
    expect(
      out.filter(
        (u) => !allowed.some((a) => u === a || u.startsWith(`${a}/`) || u.startsWith(`${a}?`)),
      ),
    ).toEqual([]);
  });

  it("asks the network for one thing only: the latest release of the project", () => {
    const hosts = [...js.matchAll(/https?:\/\/[^"'\s)]+/g)].map((m) => m[0]);
    expect(hosts.filter((h) => !h.startsWith("https://api.github.com/repos/"))).toEqual([]);
    expect(js).toContain('REPO = "triggeredcode/lucid"');
  });

  it("describes every picture, and gives it a size so the page does not jump", () => {
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThan(6);
    for (const tag of imgs) {
      expect(tag, tag).toMatch(/\salt="/);
      expect(tag, tag).toMatch(/\swidth="\d+"/);
      expect(tag, tag).toMatch(/\sheight="\d+"/);
    }
  });

  it("points every download at the releases page until the release is known", () => {
    const downloads = [...html.matchAll(/<a\b[^>]*data-dl="[^"]+"[^>]*>/g)].map((m) => m[0]);
    expect(downloads.length).toBeGreaterThanOrEqual(4);
    for (const tag of downloads)
      expect(tag).toContain('href="https://github.com/triggeredcode/lucid/releases/latest"');
  });

  it("keeps every command and its Copy button side by side, with the command written exactly as shown", () => {
    // The commands are in <pre>: any space or line break the formatter adds inside shows on the page, and a Copy button placed over
    // the text hides it. So each box is a <pre><code> that starts at its first character, then the button, never over it.
    const boxes = [...html.matchAll(/<div class="code">([\s\S]*?)<\/div>/g)].map((m) => m[1] ?? "");
    expect(boxes.length).toBeGreaterThanOrEqual(4);
    for (const box of boxes) {
      expect(box, box.slice(0, 60)).toMatch(
        /^\s*<pre><code>[^\s<][\s\S]*?[^\s]<\/code><\/pre>\s*<button\b[^>]*\bdata-copy="[^"]+"[^>]*>\s*Copy\s*<\/button>\s*$/,
      );
    }
    expect(html.match(/\bdata-copy="/g)?.length).toBe(boxes.length);
    const rule = (selector: string): string => {
      const start = css.search(
        new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`),
      );
      expect(start, selector).toBeGreaterThanOrEqual(0);
      return css.slice(start, css.indexOf("}", start));
    };
    expect(rule(".code")).toContain("display: flex");
    expect(rule(".code button")).not.toContain("position: absolute");
    expect(rule(".code pre")).toContain("flex: 1");
  });

  it("serves its typeface from the site", () => {
    for (const m of css.matchAll(/url\("([^"]+)"\)/g))
      expect(existsSync(source(m[1] ?? "")), m[1]).toBe(true);
    expect(existsSync(join(root, "site/fonts/LICENSE-iA-Writer-Mono.txt"))).toBe(true);
  });
});

describe.each([
  ["light", ":root"],
  ["dark", ':root[data-theme="dark"]'],
])("the site's %s colours", (_name, selector) => {
  const t = colourTokens(css, selector);
  const get = (k: string): string => {
    expect(t[k], k).toBeDefined();
    return t[k] ?? "#000000";
  };
  it("keep body text at 4.5:1 and small grey text at 3:1, on the page and on the tinted sections", () => {
    for (const surface of ["--bg", "--panel"]) {
      expect(contrastRatio(get("--ink"), get(surface)), `ink on ${surface}`).toBeGreaterThanOrEqual(
        7,
      );
      expect(
        contrastRatio(get("--ink-2"), get(surface)),
        `ink-2 on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(get("--ink-3"), get(surface)),
        `ink-3 on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
  it("show the button text clearly", () => {
    expect(contrastRatio(get("--inverse-ink"), get("--inverse-bg"))).toBeGreaterThanOrEqual(7);
  });
});
