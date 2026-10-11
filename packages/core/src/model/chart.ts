import { z } from "zod";

/**
 * Chart model: a bar or line chart of one or more series over shared categories, e.g. decode
 * tok/s per model. Rendered with Mermaid `xychart-beta`.
 */

const singleLine = z.string().regex(/^[^\r\n]*$/, "must be a single line");

export const ChartSeriesSchema = z.strictObject({
  name: singleLine.min(1),
  values: z.array(z.number()),
});
export type ChartSeries = z.infer<typeof ChartSeriesSchema>;

export const ChartSchema = z.strictObject({
  kind: z.enum(["bar", "line"]),
  title: singleLine,
  xLabel: singleLine,
  yLabel: singleLine,
  unit: singleLine.optional(),
  categories: z.array(singleLine.min(1)),
  series: z.array(ChartSeriesSchema),
});
export type Chart = z.infer<typeof ChartSchema>;

export type ChartRule = "C1" | "C2";
export interface ChartViolation {
  rule: ChartRule;
  message: string;
}

/** C1: at least one category and one series. C2: every series has exactly one value per category. */
export function checkChart(chart: Chart): ChartViolation[] {
  const out: ChartViolation[] = [];
  if (chart.categories.length === 0)
    out.push({ rule: "C1", message: "a chart needs at least one category" });
  if (chart.series.length === 0)
    out.push({ rule: "C1", message: "a chart needs at least one series" });
  for (const s of chart.series) {
    if (s.values.length !== chart.categories.length) {
      out.push({
        rule: "C2",
        message: `series "${s.name}" has ${String(s.values.length)} values but there are ${String(chart.categories.length)} categories`,
      });
    }
  }
  return out;
}
