import type { Graph } from "../model/graph";
import { compileEr } from "./er";
import { compileFlowchart } from "./flowchart";
import { compileSequence } from "./sequence";

/** Graph JSON -> Mermaid text. Deterministic: the same graph always gives the same text. */
export function compileMermaid(graph: Graph): string {
  switch (graph.type) {
    case "flowchart":
      return compileFlowchart(graph);
    case "sequence":
      return compileSequence(graph);
    case "er":
      return compileEr(graph);
  }
}

export { strikeThrough } from "./common";
export { compileChart, niceCeil } from "./chart";
