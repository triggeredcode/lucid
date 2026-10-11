// @vitest-environment jsdom
import mermaid from "mermaid";
import { describe, expect, it } from "vitest";
import { ChartSchema, checkChart, type Chart } from "../model/chart";
import { compileChart, niceCeil } from "./index";

const chart = (over: Partial<Chart> = {}): Chart => ({
  kind: "bar",
  title: "Decode speed",
  xLabel: "Model",
  yLabel: "Decode",
  unit: "tok/s",
  categories: ["Qwen 27B", "Gemma 26B"],
  series: [{ name: "tok/s", values: [15.1, 17.7] }],
  ...over,
});
const valid = async (text: string) => {
  expect(await mermaid.parse(text)).toBeTruthy();
};

describe("chart model", () => {
  it("accepts a valid chart and reports every violation", () => {
    expect(ChartSchema.parse(chart())).toEqual(chart());
    expect(checkChart(chart())).toEqual([]);
    expect(checkChart(chart({ categories: [], series: [] })).map((v) => v.rule)).toEqual([
      "C1",
      "C1",
    ]);
    const bad = chart({ series: [{ name: "x", values: [1] }] });
    expect(checkChart(bad)).toEqual([
      { rule: "C2", message: 'series "x" has 1 values but there are 2 categories' },
    ]);
  });

  it("rejects non-finite numbers, empty names and multi-line text", () => {
    expect(() =>
      ChartSchema.parse(chart({ series: [{ name: "x", values: [1, Number.NaN] }] })),
    ).toThrow();
    expect(() => ChartSchema.parse(chart({ series: [{ name: "", values: [1, 2] }] }))).toThrow();
    expect(() => ChartSchema.parse(chart({ title: "a\nb" }))).toThrow();
    expect(() => ChartSchema.parse({ ...chart(), extra: 1 })).toThrow();
  });
});

describe("niceCeil", () => {
  it.each([
    [0.4, 0.5],
    [1, 1],
    [1.1, 2],
    [17.7, 20],
    [20, 20],
    [21, 50],
    [51, 100],
    [9.7, 10],
    [0, 1],
  ])("niceCeil(%s) = %s", (input, expected) => {
    expect(niceCeil(input)).toBe(expected);
  });
});

describe("compileChart", () => {
  it("compiles a bar chart with a nice y range and the unit in the axis title", async () => {
    const text = compileChart(chart());
    expect(text).toBe(
      [
        "xychart-beta",
        '  title "Decode speed"',
        '  x-axis "Model" ["Qwen 27B", "Gemma 26B"]',
        '  y-axis "Decode (tok/s)" 0 --> 20',
        "  bar [15.1, 17.7]",
      ].join("\n"),
    );
    await valid(text);
  });

  it("draws line charts and several series, and omits the title when empty", async () => {
    const text = compileChart(
      chart({
        kind: "line",
        title: "",
        unit: undefined,
        series: [
          { name: "a", values: [1, 2] },
          { name: "b", values: [3, 4] },
        ],
      }),
    );
    expect(text).not.toContain("title");
    expect(text).toContain('y-axis "Decode" 0 --> 5');
    expect(text).toContain("  line [1, 2]\n  line [3, 4]");
    await valid(text);
  });

  it("handles negative values by extending the axis below zero", async () => {
    const text = compileChart(chart({ series: [{ name: "x", values: [-3, 4] }] }));
    expect(text).toContain("-5 --> 5");
    await valid(text);
  });

  it("escapes quotes in labels and never prints floating point noise", async () => {
    const text = compileChart(
      chart({ categories: ['a "b"', "c"], series: [{ name: "x", values: [0.1 + 0.2, 1] }] }),
    );
    expect(text).toContain('["a #quot;b#quot;", "c"]');
    expect(text).toContain("bar [0.3, 1]");
    await valid(text);
  });
});
