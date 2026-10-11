import { ChartSchema, checkChart, compileChart, type Block, type Chart } from "@lucid/core";
import { z } from "zod";
import type { BlockSpec } from "../../spec";
import { statusSuffix, str, withStatus } from "../common";

function chartOf(block: Block): Chart | undefined {
  const parsed = ChartSchema.safeParse(block.props["chart"]);
  return parsed.success ? parsed.data : undefined;
}

const decode: Chart = {
  kind: "bar",
  title: "Decode speed",
  xLabel: "Model",
  yLabel: "Decode",
  unit: "tok/s",
  categories: ["Qwen3.8 27B", "Gemma 4 26B-A4B"],
  series: [{ name: "tok/s", values: [15.1, 17.7] }],
};

export const chartBlock: BlockSpec = {
  type: "chart",
  kind: "atom",
  propsSchema: withStatus({
    chart: ChartSchema,
    caption: z
      .string()
      .regex(/^[^\r\n]*$/, "must be a single line")
      .default(""),
  }),
  describe: [
    "A bar or line chart of numbers the user dictated (benchmark results, latency per model). Use only the numbers they said.",
    "One value per category per series. Put the unit in `unit`, not in the numbers.",
    'LMD: ```chart kind=bar title="Decode speed" y="tok/s" then `categories: Qwen 27B, Gemma 26B` and `series Decode: 15.1, 17.7`',
  ].join("\n"),
  fixtures: [
    { id: "fx-chart-1", type: "chart", props: { chart: decode, caption: "Decode speed by model" } },
    {
      id: "fx-chart-2",
      type: "chart",
      props: {
        chart: {
          kind: "line",
          title: "p95 latency vs batch size",
          xLabel: "Batch size",
          yLabel: "Latency",
          unit: "ms",
          categories: ["1", "4", "16"],
          series: [{ name: "p95", values: [120, 180, 410] }],
        },
        caption: "",
      },
    },
  ],
  check: (props) => {
    const parsed = ChartSchema.safeParse(props["chart"]);
    return parsed.success ? checkChart(parsed.data).map((v) => `${v.rule}: ${v.message}`) : [];
  },
  outline: (block, detail) => {
    const c = chartOf(block);
    const caption = str(block, "caption") || c?.title || "";
    const head = `chart ${c?.kind ?? "?"}${caption ? ` "${caption}"` : ""}${statusSuffix(block)}`;
    if (!c) return head;
    const cats = `categories: ${c.categories.join(", ")}`;
    if (detail === "summary") return `${head} ${cats}`;
    const unit = c.unit ? ` ${c.unit}` : "";
    return [
      head,
      `  ${cats}`,
      ...c.series.map((s) => `  series ${s.name}: ${s.values.join(", ")}${unit}`),
    ].join("\n");
  },
  toMarkdown: (block) => {
    const c = chartOf(block);
    if (!c) return "";
    const caption = str(block, "caption");
    return ["```mermaid", compileChart(c), "```", ...(caption ? ["", `*${caption}*`] : [])].join(
      "\n",
    );
  },
};
