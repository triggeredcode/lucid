import { buildRefMap, isListItem, type Block, type LucidDoc, type RefMap } from "@lucid/core";
import { registry as defaultRegistry } from "../defaultRegistry";
import type { Registry } from "../registry";
import { clip, inlineToPlain } from "../text";

/**
 * The compact view of a document the model sees: one line or a few per block, each with a short
 * reference like `[b5]`. The model never sees block JSON or real ids.
 */
export interface OutlineOptions {
  title?: string | undefined;
  format?: string | undefined;
  /** Block ids shown in full detail (the cursor block, last-touched blocks, blocks the utterance mentions). */
  full?: Iterable<string> | undefined;
  /** Size budget in characters (about 4 per token). Default 24000, i.e. roughly 6000 tokens. */
  maxChars?: number | undefined;
  registry?: Registry | undefined;
}

export interface Outline {
  text: string;
  refMap: RefMap;
}

const LIST_LABEL: Record<string, string> = {
  bulletListItem: "bullets",
  numberedListItem: "numbered",
  checkListItem: "checklist",
};

interface Entry {
  /** Reference of the first block of the entry (a list group is one entry). */
  ref: string;
  blockIds: string[];
  heading: boolean;
  full: string;
  summary: string;
}

function itemText(block: Block, max: number): string {
  const checked =
    block.type === "checkListItem" ? (block.props["checked"] === true ? "[x] " : "[ ] ") : "";
  const raw = block.props["status"];
  const status = raw === "struck" || raw === "chosen" ? ` {${raw}}` : "";
  return `${checked}${clip(inlineToPlain(block.content), max)}${status}`;
}

function itemWithChildren(refMap: RefMap, block: Block, max: number): string {
  const ref = refMap.refOf(block.id) ?? "?";
  const kids = (block.children ?? []).map((c) => itemWithChildren(refMap, c, max));
  return `[${ref}] ${itemText(block, max)}${kids.length > 0 ? ` (sub: ${kids.join(" | ")})` : ""}`;
}

export function buildOutline(doc: LucidDoc, options: OutlineOptions = {}): Outline {
  const registry = options.registry ?? defaultRegistry;
  const refMap = buildRefMap(doc);
  const fullIds = new Set(options.full ?? []);
  const maxChars = options.maxChars ?? 24_000;

  const entries: Entry[] = [];
  const top = doc.blocks;
  for (let i = 0; i < top.length;) {
    const block = top[i];
    if (!block) break;
    const ref = refMap.refOf(block.id) ?? "";
    if (isListItem(block)) {
      let end = i;
      while (top[end + 1]?.type === block.type) end += 1;
      const run = top.slice(i, end + 1);
      const groupRef = ref.split(".")[0] ?? ref;
      const label = LIST_LABEL[block.type] ?? "list";
      const render = (max: number) =>
        `[${groupRef}] ${label}: ${run.map((b) => itemWithChildren(refMap, b, max)).join(" | ")}`;
      entries.push({
        ref: groupRef,
        blockIds: run.map((b) => b.id),
        heading: false,
        full: render(300),
        summary: render(80),
      });
      i = end + 1;
    } else {
      const spec = registry.get(block.type);
      entries.push({
        ref,
        blockIds: [block.id],
        heading: block.type === "heading",
        full: `[${ref}] ${spec.outline(block, "full")}`,
        summary: `[${ref}] ${spec.outline(block, "summary")}`,
      });
      i += 1;
    }
  }

  const isFull = (e: Entry) => e.blockIds.some((id) => fullIds.has(id));
  const header = `DOCUMENT "${options.title ?? "Untitled"}"${options.format ? ` (format: ${options.format})` : ""}`;
  const chosen = entries.map((e) => (isFull(e) ? e.full : e.summary));
  const size = () => header.length + chosen.reduce((n, line) => n + line.length + 1, 0);

  // Over budget: collapse the blocks farthest from the focus first. Headings always stay.
  const collapsed = new Set<number>();
  if (size() > maxChars) {
    const anchors = entries.flatMap((e, i) => (isFull(e) ? [i] : []));
    if (anchors.length === 0) anchors.push(entries.length - 1);
    const distance = (i: number) => Math.min(...anchors.map((a) => Math.abs(a - i)));
    const order = entries
      .map((_, i) => i)
      .filter((i) => !entries[i]?.heading && !isFull(entries[i] as Entry))
      .sort((a, b) => distance(b) - distance(a));
    let saved = 0;
    for (const i of order) {
      if (size() - saved <= maxChars) break;
      collapsed.add(i);
      saved += (chosen[i]?.length ?? 0) + 1 - 12;
    }
  }

  const lines: string[] = [header];
  for (let i = 0; i < entries.length; i++) {
    if (!collapsed.has(i)) {
      lines.push(chosen[i] ?? "");
      continue;
    }
    let j = i;
    while (collapsed.has(j + 1)) j += 1;
    const first = entries[i]?.ref ?? "";
    const last = entries[j]?.ref ?? "";
    lines.push(`[${first}–${last}] ${String(j - i + 1)} blocks (collapsed)`);
    i = j;
  }
  return { text: lines.join("\n"), refMap };
}
