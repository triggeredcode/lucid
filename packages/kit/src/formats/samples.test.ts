/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLmd } from "../lmd";
import { FORMATS } from "./index";

// The sample notes behind the pictures in docs/format-samples (scripts/format-samples.mjs makes the pictures from them).
// A sample is only a good picture of its format when every section is filled and the content is what the format is for.
const dir = join(__dirname, "../../../../docs/format-samples");
const meta = JSON.parse(readFileSync(join(dir, "samples.json"), "utf8")) as Record<
  string,
  { title: string; info: Record<string, string> }
>;

describe("the sample note of each format", () => {
  for (const format of FORMATS) {
    describe(format.name, () => {
      const parsed = parseLmd(readFileSync(join(dir, `${format.id}.lmd`), "utf8"));
      const blocks = parsed.ok ? parsed.blocks : [];

      it("is valid Lucid Markdown", () => {
        expect(parsed.ok).toBe(true);
      });

      it("has every section of the format, in order, with something under each", () => {
        const headings = blocks.flatMap((b, i) => (b.type === "heading" ? [i] : []));
        const names = headings.map((i) => {
          const content = blocks[i]?.content;
          return Array.isArray(content)
            ? content.map((c) => ("text" in c ? c.text : "")).join("")
            : "";
        });
        expect(names).toEqual(format.sections.map((s) => s.heading));
        headings.forEach((from, n) => {
          const to = headings[n + 1] ?? blocks.length;
          expect(to - from, `${names[n] ?? "?"} is empty`).toBeGreaterThan(1);
        });
      });

      it("uses what the format prefers somewhere: a diagram, a table, math or a callout where it asks for one", () => {
        const used = new Set(blocks.map((b) => b.type));
        for (const section of format.sections)
          if (section.prefer.some((t) => ["diagram", "table", "math", "chart"].includes(t)))
            expect(
              section.prefer.some((t) => used.has(t)),
              `${section.heading} prefers ${section.prefer.join(" or ")}`,
            ).toBe(true);
      });

      it("has a title and a value for each field the format shows under it", () => {
        const sample = meta[format.id];
        expect(sample?.title).toBeTruthy();
        for (const field of format.meta) expect(sample?.info[field], field).toBeTruthy();
      });

      it("has its picture", () => {
        expect(existsSync(join(dir, `format-${format.id}.png`))).toBe(true);
      });
    });
  }
});
