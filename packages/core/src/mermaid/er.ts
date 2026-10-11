import type { Graph } from "../model/graph";
import { label, mid, quote, visibleEdges, visibleNodes } from "./common";

/** Cardinality from words in the edge label: "one to many", "many to many", "one to one"; default many-to-many. */
export function cardinality(edgeLabel: string | undefined): string {
  const text = (edgeLabel ?? "").toLowerCase();
  if (/one[\s-]to[\s-]many/.test(text)) return "||--o{";
  if (/many[\s-]to[\s-]one/.test(text)) return "}o--||";
  if (/one[\s-]to[\s-]one/.test(text)) return "||--||";
  return "}o--o{";
}

/** Entity-relationship text. Nodes are entities, edges are relationships labelled with their text. */
export function compileEr(g: Graph): string {
  const lines = ["erDiagram"];
  for (const n of visibleNodes(g)) {
    lines.push(`  ${mid(n.id)}[${quote(label(n.label, n.status === "struck"))}]`);
  }
  for (const e of visibleEdges(g)) {
    const text = label(e.label ?? "relates to", e.status === "struck");
    lines.push(`  ${mid(e.from)} ${cardinality(e.label)} ${mid(e.to)} : ${quote(text)}`);
  }
  return lines.join("\n");
}
