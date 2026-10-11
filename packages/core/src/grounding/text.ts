import type { Block, Inline } from "../model/doc";
import type { Chart } from "../model/chart";
import type { Graph } from "../model/graph";
import type { Table } from "../model/table";

const inlineText = (inlines: readonly Inline[] | undefined): string =>
  (inlines ?? [])
    .map((i) =>
      i.type === "text"
        ? i.text
        : i.type === "link"
          ? i.content.map((c) => c.text).join("")
          : i.latex,
    )
    .join("");

/** Everything a reader could read in the blocks, as one string: used to check the model's output against the speaker's words. */
export function plainTextOfBlocks(blocks: readonly Block[]): string {
  const parts: string[] = [];
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      parts.push(inlineText(b.content));
      const p = b.props;
      if (typeof p["title"] === "string") parts.push(p["title"]);
      if (typeof p["caption"] === "string") parts.push(p["caption"]);
      if (typeof p["code"] === "string") parts.push(p["code"]);
      if (typeof p["latex"] === "string") parts.push(p["latex"]);
      const graph = p["graph"] as Graph | undefined;
      if (graph) {
        parts.push(
          ...graph.nodes.map((n) => n.label),
          ...graph.groups.map((g) => g.label),
          ...graph.edges.map((e) => e.label ?? ""),
        );
      }
      const table = p["table"] as Table | undefined;
      if (table)
        parts.push(...table.columns.map((c) => c.name), ...table.rows.flatMap((r) => r.cells));
      const chart = p["chart"] as Chart | undefined;
      if (chart) {
        parts.push(chart.title, chart.xLabel, chart.yLabel, ...chart.categories);
        for (const s of chart.series) parts.push(s.name, ...s.values.map(String));
      }
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return parts.filter((s) => s.length > 0).join("\n");
}

/** Labels of the diagram nodes in the blocks, with the block id they came from. */
export function diagramLabels(blocks: readonly Block[]): { blockId: string; label: string }[] {
  const out: { blockId: string; label: string }[] = [];
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      const graph = b.props["graph"] as Graph | undefined;
      if (b.type === "diagram" && graph)
        for (const n of graph.nodes) out.push({ blockId: b.id, label: n.label });
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}
