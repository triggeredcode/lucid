import type { Graph, GEdge, GNode } from "../model/graph";

/** Combining long stroke overlay (U+0336) after each visible character: a strikethrough that survives PDF conversion. */
export function strikeThrough(text: string): string {
  return text.replace(/\S/gu, "$&\u0336");
}

/** Mermaid quoted-string escaping. Labels are single-line (invariant G5), so only quotes need care. */
export function quote(text: string): string {
  return `"${text.replace(/"/g, "#quot;")}"`;
}

/** Words Mermaid treats as keywords when used as an id. */
const RESERVED = new Set([
  "end",
  "graph",
  "flowchart",
  "subgraph",
  "default",
  "class",
  "classdef",
  "style",
  "linkstyle",
  "click",
  "direction",
  "call",
  "href",
  "participant",
  "actor",
  "alt",
  "else",
  "opt",
  "loop",
  "par",
  "and",
  "note",
  "title",
  "left",
  "right",
  "over",
  "autonumber",
  "activate",
  "deactivate",
  "box",
  "rect",
  "critical",
  "break",
]);

/** Slugs are already Mermaid-safe except for keywords, which get a trailing underscore. */
export function mid(id: string): string {
  return RESERVED.has(id.toLowerCase()) ? `${id}_` : id;
}

export const visibleNodes = (g: Graph): GNode[] => g.nodes.filter((n) => n.status !== "hidden");

/** Edges that are not hidden and whose endpoints are not hidden. */
export function visibleEdges(g: Graph): GEdge[] {
  const hidden = new Set(g.nodes.filter((n) => n.status === "hidden").map((n) => n.id));
  return g.edges.filter((e) => e.status !== "hidden" && !hidden.has(e.from) && !hidden.has(e.to));
}

export const label = (text: string, struck: boolean): string =>
  struck ? strikeThrough(text) : text;
