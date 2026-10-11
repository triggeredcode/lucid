import { describe, expect, it } from "vitest";
import { compare, comparisonToMarkdown, summarise, toMarkdown, type Results } from "./report";
import type { Trial } from "./run";
import type { Category } from "./types";

const trial = (
  id: string,
  category: Category,
  pass: boolean,
  over: Partial<Trial> = {},
): Trial => ({
  caseId: id,
  category,
  variant: 0,
  utterance: `say ${id}`,
  pass,
  failures: pass ? [] : ["missing component CDN"],
  outcome: pass ? "edit" : "edit",
  ms: 1000,
  promptTokens: 100,
  outputTokens: 50,
  raw: "{}",
  ...over,
});
const results = (label: string, trials: Trial[]): Results => ({
  meta: { model: "m", date: "2026-10-11", label, baseUrl: "http://x" },
  trials,
});

describe("summarise", () => {
  it("rates overall and per category against the thresholds, with the stricter ones where work could be lost", () => {
    const s = summarise(
      results("a", [
        ...Array.from({ length: 9 }, (_, i) => trial(`d${String(i)}`, "diagram_edit", true)),
        trial("d9", "diagram_edit", false),
        trial("m1", "mode_separation", true),
        trial("m2", "mode_separation", false),
      ]),
    );
    expect(s.overall).toMatchObject({ pass: 10, total: 12, ok: false });
    expect(s.categories.find((c) => c.category === "diagram_edit")).toMatchObject({
      rate: 0.9,
      threshold: 0.8,
      ok: true,
    });
    expect(s.categories.find((c) => c.category === "mode_separation")).toMatchObject({
      rate: 0.5,
      threshold: 0.95,
      ok: false,
    });
  });

  it("counts pipeline errors and leaves out categories that were not run", () => {
    const s = summarise(results("a", [trial("x", "stt_noise", false, { outcome: "error" })]));
    expect(s.errors).toBe(1);
    expect(s.categories.map((c) => c.category)).toEqual(["stt_noise"]);
  });
});

describe("toMarkdown", () => {
  it("shows the table and each failure with what was said, expected and written", () => {
    const md = toMarkdown(
      results("v1", [
        trial("a", "diagram_edit", true),
        trial("b", "diagram_edit", false, { variant: 1, raw: '{"kind":"edit"}' }),
      ]),
    );
    expect(md).toContain("# Eval report: v1");
    expect(md).toContain("| diagram_edit | 1/2 | 50% | 80% | **below** |");
    expect(md).toContain("### b (variant 1) · diagram_edit");
    expect(md).toContain("- missing component CDN");
    expect(md).toContain('{"kind":"edit"}');
  });
});

describe("compare", () => {
  const a = results("v1", [
    trial("x", "diagram_edit", true),
    trial("y", "diagram_edit", true),
    trial("z", "table_edit", false),
  ]);
  const b = results("v2", [
    trial("x", "diagram_edit", false),
    trial("y", "diagram_edit", true),
    trial("z", "table_edit", true),
  ]);

  it("lists regressions and fixes by trial, and the change per category", () => {
    const c = compare(a, b);
    expect(c.regressions).toEqual(["x#0"]);
    expect(c.fixes).toEqual(["z#0"]);
    expect(c.deltas).toEqual([
      { category: "diagram_edit", a: 1, b: 0.5, points: -50 },
      { category: "table_edit", a: 0, b: 1, points: 100 },
    ]);
  });

  it("asks for a written reason when a category loses more than five points", () => {
    expect(compare(a, b).needsJustification).toEqual(["diagram_edit"]);
    expect(comparisonToMarkdown(a, b)).toContain("Write the reason in the pull request");
    expect(compare(a, a).needsJustification).toEqual([]);
  });
});
