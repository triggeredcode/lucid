import type { GEdge, Graph } from "../model/graph";
import { label, mid, visibleNodes } from "./common";

const ARROWS: Record<GEdge["arrow"], Record<GEdge["style"], string>> = {
  directed: { solid: "->>", dashed: "-->>", dotted: "-->>" },
  undirected: { solid: "->", dashed: "-->", dotted: "-->" },
  bidirectional: { solid: "<<->>", dashed: "<<-->>", dotted: "<<-->>" },
};

/**
 * Sequence diagram text: participants in node order, messages in seq order, fragments as alt/else, opt, loop and
 * par/and blocks. Messages have no linkStyle, so struck messages are marked only by the strike overlay on the label.
 */
export function compileSequence(g: Graph): string {
  const lines = ["sequenceDiagram"];
  for (const n of visibleNodes(g)) {
    const keyword = n.kind === "actor" ? "actor" : "participant";
    lines.push(`  ${keyword} ${mid(n.id)} as ${label(n.label, n.status === "struck")}`);
  }

  const messages = [...g.edges].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const opens = new Map<number, { size: number; text: string }[]>();
  const closes = new Map<number, { size: number }[]>();
  for (const f of g.fragments) {
    const lo = Math.min(...f.branches.map((b) => b.fromSeq));
    const hi = Math.max(...f.branches.map((b) => b.toSeq));
    const size = hi - lo;
    f.branches.forEach((b, i) => {
      const joiner = f.kind === "par" ? "and" : "else";
      const text = `${i === 0 ? f.kind : joiner}${b.label.length > 0 ? ` ${b.label}` : ""}`;
      const list = opens.get(b.fromSeq) ?? [];
      list.push({ size: i === 0 ? size : Number.POSITIVE_INFINITY, text });
      opens.set(b.fromSeq, list);
    });
    const list = closes.get(hi) ?? [];
    list.push({ size });
    closes.set(hi, list);
  }

  const indent = (depth: number) => "  ".repeat(depth + 1);
  let depth = 0;
  for (const m of messages) {
    const seq = m.seq ?? 0;
    // A continuation (else/and) has Infinity and sorts first; then outer fragments before inner ones.
    const here = [...(opens.get(seq) ?? [])].sort((a, b) =>
      a.size === b.size
        ? 0
        : a.size === Number.POSITIVE_INFINITY
          ? -1
          : b.size === Number.POSITIVE_INFINITY
            ? 1
            : b.size - a.size,
    );
    for (const o of here) {
      if (o.size === Number.POSITIVE_INFINITY) depth -= 1;
      lines.push(`${indent(depth)}${o.text}`);
      depth += 1;
    }
    const text = m.label === undefined ? "" : `: ${label(m.label, m.status === "struck")}`;
    lines.push(
      `${indent(depth)}${mid(m.from)}${ARROWS[m.arrow][m.style]}${mid(m.to)}${text || ": "}`,
    );
    for (let i = 0; i < (closes.get(seq)?.length ?? 0); i++) {
      depth -= 1;
      lines.push(`${indent(depth)}end`);
    }
  }
  return lines.join("\n");
}
