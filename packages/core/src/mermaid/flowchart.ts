import type { GEdge, GNode, Graph, NodeKind } from "../model/graph";
import { label, mid, quote, visibleEdges, visibleNodes } from "./common";

/**
 * Shape per node kind: every kind has its own, so an architecture reads at a glance, also in black and white. The newer
 * Mermaid shapes (`id@{ shape: ... }`) give a pipe for a queue, a cloud for a CDN and a lined cylinder for storage; a cache
 * is a cylinder with a dashed outline (it is the copy that can be thrown away).
 */
function shape(kind: NodeKind, text: string): (id: string) => string {
  const t = quote(text);
  const named = (name: string) => (id: string) => `${id}@{ shape: ${name}, label: ${t} }`;
  switch (kind) {
    case "actor":
      return (id) => `${id}([${t}])`;
    case "client":
      return (id) => `${id}(${t})`;
    case "gateway":
      return (id) => `${id}[[${t}]]`;
    case "loadbalancer":
      return (id) => `${id}{{${t}}}`;
    case "datastore":
    case "cache":
      return (id) => `${id}[(${t})]`;
    case "storage":
      return named("lin-cyl");
    case "queue":
      return named("h-cyl");
    case "cdn":
      return named("cloud");
    case "external":
      return (id) => `${id}>${t}]`;
    case "decision":
      return (id) => `${id}{${t}}`;
    case "note":
      return (id) => `${id}[/${t}/]`;
    case "service":
    case "process":
      return (id) => `${id}[${t}]`;
  }
}

/**
 * The line that declares a node, and the class it wears (struck, chosen, cache). The older shapes take the class on the
 * line (`id[("X")]:::cache`); the newer `id@{ shape: ... }` ones do not allow that, so theirs is a `class` statement.
 */
function nodeLine(n: GNode): { line: string; after?: string } {
  const line = shape(n.kind, label(n.label, n.status === "struck"))(mid(n.id));
  const cls =
    n.status === "struck"
      ? "struck"
      : n.status === "chosen"
        ? "chosen"
        : n.kind === "cache"
          ? "cache"
          : undefined;
  if (cls === undefined) return { line };
  return line.includes("@{")
    ? { line, after: `  class ${mid(n.id)} ${cls}` }
    : { line: `${line}:::${cls}` };
}

const ARROWS: Record<GEdge["arrow"], Record<GEdge["style"], string>> = {
  directed: { solid: "-->", dashed: "-.->", dotted: "-.->" },
  undirected: { solid: "---", dashed: "-.-", dotted: "-.-" },
  bidirectional: { solid: "<-->", dashed: "<-.->", dotted: "<-.->" },
};

/** Flowchart text for a flowchart or ER-less graph. Renderer config (layout, theme, htmlLabels) is separate. */
export function compileFlowchart(g: Graph): string {
  const lines: string[] = [`flowchart ${g.direction}`];
  const nodes = visibleNodes(g);
  const grouped = new Set<string>();
  const used = { struck: false, chosen: false, cache: false };
  const classes: string[] = [];
  const emit = (n: GNode, indent: string) => {
    const declared = nodeLine(n);
    lines.push(`${indent}${declared.line}`);
    if (declared.after !== undefined) classes.push(declared.after);
    if (n.status === "struck") used.struck = true;
    if (n.status === "chosen") used.chosen = true;
    if (n.status !== "struck" && n.status !== "chosen" && n.kind === "cache") used.cache = true;
  };

  for (const group of g.groups) {
    const members = nodes.filter((n) => group.members.includes(n.id));
    if (members.length === 0) continue;
    lines.push(
      `  subgraph ${mid(group.id)}[${quote(label(group.label, group.status === "struck"))}]`,
    );
    for (const n of members) {
      grouped.add(n.id);
      emit(n, "    ");
    }
    lines.push("  end");
  }
  for (const n of nodes) if (!grouped.has(n.id)) emit(n, "  ");

  const linkStyles: string[] = [];
  visibleEdges(g).forEach((e, index) => {
    const arrow = ARROWS[e.arrow][e.style];
    const text = e.label === undefined ? "" : `|${quote(label(e.label, e.status === "struck"))}|`;
    lines.push(`  ${mid(e.from)} ${arrow}${text} ${mid(e.to)}`);
    if (e.status === "struck")
      linkStyles.push(`  linkStyle ${String(index)} stroke-dasharray:4 3,opacity:0.45`);
    else if (e.status === "chosen")
      linkStyles.push(`  linkStyle ${String(index)} stroke-width:3px,stroke:#2F855A`);
    else if (e.style === "dotted")
      linkStyles.push(`  linkStyle ${String(index)} stroke-dasharray:2 4`);
  });
  lines.push(...linkStyles, ...classes);

  if (used.struck) lines.push("  classDef struck stroke-dasharray:4 3,opacity:0.5");
  if (used.chosen) lines.push("  classDef chosen stroke-width:3px,stroke:#2F855A");
  if (used.cache) lines.push("  classDef cache fill:#FEF3C7,stroke:#B7791F,stroke-dasharray:5 3");
  return lines.join("\n");
}
