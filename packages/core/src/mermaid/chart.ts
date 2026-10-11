import type { Chart } from "../model/chart";
import { quote } from "./common";

/** Smallest "nice" number (1, 2, 5 times a power of ten) that is at least `value`. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * power >= value) return step * power;
  }
  return 10 * power;
}

/** Mermaid has no number formatting, so print plain decimals without trailing noise. */
const num = (n: number): string => String(Math.round(n * 1e6) / 1e6);

/**
 * `xychart-beta` text. The y axis starts at 0 (or the lowest value if negative) and ends at a nice number above the
 * highest value, so bars are never truncated. Mermaid draws no legend: with several series, name them in the title.
 */
export function compileChart(chart: Chart): string {
  const all = chart.series.flatMap((s) => s.values);
  const max = all.length === 0 ? 1 : Math.max(...all);
  const min = all.length === 0 ? 0 : Math.min(...all);
  const lo = min < 0 ? -niceCeil(-min) : 0;
  const hi = max <= 0 ? 1 : niceCeil(max);
  const yTitle = chart.unit ? `${chart.yLabel} (${chart.unit})` : chart.yLabel;
  const lines = ["xychart-beta"];
  if (chart.title) lines.push(`  title ${quote(chart.title)}`);
  lines.push(`  x-axis ${quote(chart.xLabel)} [${chart.categories.map(quote).join(", ")}]`);
  lines.push(`  y-axis ${quote(yTitle)} ${num(lo)} --> ${num(hi)}`);
  for (const s of chart.series) lines.push(`  ${chart.kind} [${s.values.map(num).join(", ")}]`);
  return lines.join("\n");
}
