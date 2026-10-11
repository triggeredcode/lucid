import type { Graph, GEdge, SeqFragment } from "../model/graph";
import { ARROW_TOKENS, writeLabel } from "./parse";

/**
 * Graph -> LGN text (the inverse of parseLgn). Lossless for everything LGN can express: node
 * kind, label and status, edge arrow/style/label/status, groups, sequence order and fragments. Not written:
 * edge ids (re-assigned e1..en on parse), node notes, and the graph's type/direction/title (those live in the
 * fence header).
 */

const statusSuffix = (status: string): string => (status === "normal" ? "" : ` {${status}}`);

function arrowToken(e: GEdge): string {
  const found = ARROW_TOKENS.find((t) => t.arrow === e.arrow && t.style === e.style);
  if (!found) throw new Error(`no LGN arrow for ${e.arrow}/${e.style}`);
  return found.token;
}

function nodeLine(g: Graph, index: number): string {
  const n = g.nodes[index];
  if (!n) return "";
  return `${n.id} [${n.kind}]: ${writeLabel(n.label)}${statusSuffix(n.status)}`;
}

function edgeLine(e: GEdge): string {
  const label = e.label === undefined ? "" : `: ${writeLabel(e.label)}`;
  return `${e.from} ${arrowToken(e)} ${e.to}${label}${statusSuffix(e.status)}`;
}

/** Fragment lines to emit before (`open`, `else`) and after (`end`) the message with each seq number. */
function fragmentMarkers(fragments: readonly SeqFragment[]) {
  const before = new Map<number, { order: number; line: string }[]>();
  const after = new Map<number, { order: number; line: string }[]>();
  const push = (
    m: Map<number, { order: number; line: string }[]>,
    seq: number,
    order: number,
    line: string,
  ) => {
    const list = m.get(seq) ?? [];
    list.push({ order, line });
    m.set(seq, list);
  };
  for (const f of fragments) {
    const starts = f.branches.map((b) => b.fromSeq);
    const ends = f.branches.map((b) => b.toSeq);
    const size = Math.max(...ends) - Math.min(...starts);
    f.branches.forEach((b, i) => {
      const keyword = i === 0 ? f.kind : "else";
      const text = b.label.length > 0 ? ` ${writeLabel(b.label)}` : "";
      // An else always comes first at its position (it continues an already-open fragment), then fragments
      // that open there, outer ones (larger size) before inner ones.
      push(before, b.fromSeq, i === 0 ? -size : Number.NEGATIVE_INFINITY, `${keyword}${text}`);
    });
    // Inner fragments close first (smaller size sorts first).
    push(after, Math.max(...ends), size, "end");
  }
  return { before, after };
}

/** LGN text for the graph: nodes, then edges (messages with fragments for sequence diagrams), then groups. */
export function printLgn(graph: Graph): string {
  const lines: string[] = graph.nodes.map((_, i) => nodeLine(graph, i));

  if (graph.type === "sequence") {
    const { before, after } = fragmentMarkers(graph.fragments);
    const ordered = [...graph.edges].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    for (const e of ordered) {
      const seq = e.seq ?? 0;
      for (const m of [...(before.get(seq) ?? [])].sort((a, b) => a.order - b.order))
        lines.push(m.line);
      lines.push(edgeLine(e));
      for (const m of [...(after.get(seq) ?? [])].sort((a, b) => a.order - b.order))
        lines.push(m.line);
    }
  } else {
    for (const e of graph.edges) lines.push(edgeLine(e));
  }

  for (const g of graph.groups) {
    const status = g.status === "struck" ? " {struck}" : "";
    lines.push(`group ${g.id}: ${writeLabel(g.label)} {${g.members.join(", ")}}${status}`);
  }
  return lines.join("\n");
}
