import { buildRefMap, type Block, type LucidDoc } from "@lucid/core";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${String(n)} ${many}`);

/** "a heading, a paragraph and 3 bullets": what a set of new blocks is, in plain words for the toast. */
export function describeBlocks(blocks: readonly Block[]): string {
  const count = new Map<string, number>();
  for (const b of blocks) count.set(b.type, (count.get(b.type) ?? 0) + 1);
  const parts: string[] = [];
  const add = (type: string, one: string, many: string) => {
    const n = count.get(type) ?? 0;
    if (n > 0) parts.push(plural(n, one, many));
  };
  add("heading", "a heading", "headings");
  add("paragraph", "a paragraph", "paragraphs");
  add("bulletListItem", "a bullet", "bullets");
  add("numberedListItem", "a numbered step", "numbered steps");
  add("checkListItem", "a checklist item", "checklist items");
  add("callout", "a callout", "callouts");
  add("diagram", "a diagram", "diagrams");
  add("table", "a table", "tables");
  add("chart", "a chart", "charts");
  add("math", "a formula", "formulas");
  add("code", "a code block", "code blocks");
  if (parts.length === 0) return "nothing";
  if (parts.length === 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

const TYPE_NAME: Record<string, string> = {
  heading: "the heading",
  paragraph: "the paragraph",
  bulletListItem: "the bullet",
  numberedListItem: "the numbered step",
  checkListItem: "the checklist item",
  callout: "the callout",
  table: "the table",
  diagram: "the diagram",
  chart: "the chart",
  math: "the formula",
  code: "the code block",
};

function labelOf(block: Block): string {
  const p = block.props;
  const title = typeof p["title"] === "string" ? p["title"] : "";
  const caption = typeof p["caption"] === "string" ? p["caption"] : "";
  const graph = p["graph"] as { title?: string } | undefined;
  const chart = p["chart"] as { title?: string } | undefined;
  const text = (block.content ?? [])
    .map((i) =>
      i.type === "text"
        ? i.text
        : i.type === "link"
          ? i.content.map((c) => c.text).join("")
          : i.latex,
    )
    .join("");
  const label = title || caption || graph?.title || chart?.title || text;
  return label.length > 32 ? `${label.slice(0, 31)}…` : label;
}

/** "delete b4" becomes "delete the table “SQL vs NoSQL”": references mean nothing to the person who said the words. */
export function humanizeRefs(text: string, doc: LucidDoc): string {
  const map = buildRefMap(doc);
  const all = new Map<string, Block>();
  const walk = (blocks: readonly Block[]) => {
    for (const b of blocks) {
      all.set(b.id, b);
      if (b.children) walk(b.children);
    }
  };
  walk(doc.blocks);
  return text.replace(/\bb\d+(?:\.\d+)*\b/g, (ref) => {
    const r = map.resolve(ref);
    if (!r) return ref;
    const first = all.get(r.kind === "list" ? (r.ids[0] ?? "") : r.id);
    if (!first) return ref;
    const name = r.kind === "list" ? "the list" : (TYPE_NAME[first.type] ?? "the block");
    const label = labelOf(first);
    return label.length > 0 ? `${name} “${label}”` : name;
  });
}
