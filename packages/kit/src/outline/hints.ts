import {
  GraphSchema,
  buildRefMap,
  isListItem,
  type Block,
  type LucidDoc,
  type RefMap,
} from "@lucid/core";
import { inlineToPlain } from "../text";

/**
 * Deterministic help with "this table", "the second database" and friends: which block does each
 * demonstrative most likely mean, given the cursor and what changed last? Printed after the outline. When two
 * blocks are equally likely the hint says "ambiguous", and the prompt tells the model to ask.
 */
export interface HintInput {
  doc: LucidDoc;
  refMap?: RefMap | undefined;
  cursorBlockId?: string | undefined;
  /** Also say which names are both a list option and a part of a diagram (off by default; a real request asks for it). */
  nameCollisions?: boolean | undefined;
  /** What the model changed most recently, newest first. */
  touched?: readonly { blockId: string; note: string }[] | undefined;
}

interface Class {
  key: string;
  nouns: string;
  matches: (b: Block) => boolean;
}

const CLASSES: readonly Class[] = [
  { key: "diagram", nouns: "diagram", matches: (b) => b.type === "diagram" },
  { key: "chart", nouns: "chart", matches: (b) => b.type === "chart" },
  { key: "table", nouns: "table", matches: (b) => b.type === "table" },
  { key: "list", nouns: "list", matches: isListItem },
  { key: "section", nouns: "section", matches: (b) => b.type === "heading" },
  { key: "paragraph", nouns: "paragraph", matches: (b) => b.type === "paragraph" },
  { key: "callout", nouns: "callout", matches: (b) => b.type === "callout" },
  { key: "code", nouns: "code block", matches: (b) => b.type === "code" },
  { key: "formula", nouns: "formula", matches: (b) => b.type === "math" },
];

const ORDINAL_WORDS = ["first", "second", "third", "fourth"] as const;

interface Candidate {
  ref: string;
  /** Ids of the top-level blocks the candidate covers (a list is several). */
  ids: string[];
  label: string;
}

const quote = (s: string) => `"${s}"`;

function candidates(doc: LucidDoc, refMap: RefMap, cls: Class): Candidate[] {
  const out: Candidate[] = [];
  const top = doc.blocks;
  for (let i = 0; i < top.length;) {
    const block = top[i];
    if (!block) break;
    if (!cls.matches(block)) {
      i += 1;
      continue;
    }
    if (isListItem(block)) {
      let end = i;
      while (top[end + 1]?.type === block.type) end += 1;
      const run = top.slice(i, end + 1);
      const ref = (refMap.refOf(block.id) ?? "").split(".")[0] ?? "";
      out.push({ ref, ids: run.map((b) => b.id), label: inlineToPlain(block.content) });
      i = end + 1;
    } else {
      out.push({ ref: refMap.refOf(block.id) ?? "", ids: [block.id], label: textLabel(block) });
      i += 1;
    }
  }
  return out;
}

function textLabel(block: Block): string {
  const p = block.props;
  if (typeof p["title"] === "string" && p["title"].length > 0) return p["title"];
  if (typeof p["caption"] === "string" && p["caption"].length > 0) return p["caption"];
  const graph = p["graph"] as { title?: string } | undefined;
  if (graph?.title) return graph.title;
  const chart = p["chart"] as { title?: string } | undefined;
  if (chart?.title) return chart.title;
  return inlineToPlain(block.content);
}

/**
 * A name that is both an option in a list and a part of a diagram ("PostgreSQL"): choosing, picking or crossing out
 * "PostgreSQL" is about the alternatives, so the list item is what is meant (a diagram is changed by naming it as one).
 */
function nameCollisions(doc: LucidDoc, refMap: RefMap): string[] {
  const labels = new Map<string, string>();
  for (const block of doc.blocks) {
    if (block.type !== "diagram") continue;
    const graph = GraphSchema.safeParse(block.props["graph"]);
    if (!graph.success) continue;
    const ref = refMap.refOf(block.id) ?? "";
    for (const node of graph.data.nodes) labels.set(node.label.trim().toLowerCase(), ref);
  }
  const out: string[] = [];
  for (const block of doc.blocks) {
    if (!isListItem(block)) continue;
    const text = inlineToPlain(block.content).trim();
    const diagram = labels.get(text.toLowerCase());
    const itemRef = refMap.refOf(block.id);
    if (diagram && itemRef && text.length > 0 && text.length <= 40)
      out.push(
        `- "${text}" is both an option in the list [${itemRef}] and a part of the diagram [${diagram}]: choosing, picking or crossing out "${text}" means the option [${itemRef}] (a part of the diagram is changed only when the user says so)`,
      );
  }
  return out;
}

export function buildHints(input: HintInput): string {
  const { doc } = input;
  const refMap = input.refMap ?? buildRefMap(doc);
  const touched = input.touched ?? [];

  const topOf = (id: string | undefined): string | undefined => {
    if (!id) return undefined;
    return doc.blocks.find(
      (b) => b.id === id || JSON.stringify(b.children ?? []).includes(`"id":"${id}"`),
    )?.id;
  };
  const cursorTop = topOf(input.cursorBlockId);
  const cursorRef = cursorTop ? refMap.refOf(cursorTop)?.split(".")[0] : undefined;

  const lines: string[] = [];
  lines.push(`FOCUS: ${cursorRef ? `cursor in [${cursorRef}]` : "none"}`);

  const lastTouched: string[] = [];
  const hints: string[] = [];
  let focusList: Candidate | undefined;

  for (const cls of CLASSES) {
    const list = candidates(doc, refMap, cls);
    if (list.length === 0) continue;
    const byCursor = cursorTop ? list.find((c) => c.ids.includes(cursorTop)) : undefined;
    const touchedHit = touched
      .map((t) => list.find((c) => c.ids.includes(topOf(t.blockId) ?? "")))
      .find((c) => c !== undefined);
    const preferred = byCursor ?? touchedHit ?? (list.length === 1 ? list[0] : undefined);
    if (touchedHit) lastTouched.push(`${cls.key}=[${touchedHit.ref}]`);
    if (cls.key === "list") focusList = preferred ?? list.at(-1);

    const n = cls.nouns;
    const lead = `${quote(`this ${n}`)} / ${quote(`that ${n}`)} / ${quote(`the ${n}`)}`;
    if (preferred)
      hints.push(
        `- ${lead} → [${preferred.ref}]${preferred.label ? ` ${quote(preferred.label.slice(0, 40))}` : ""}${
          // Among several, the one the cursor is in is meant: said outright, because the model sometimes asks anyway.
          byCursor && list.length >= 2 ? " (the cursor is in it: do not ask which one)" : ""
        }`,
      );
    else
      hints.push(
        `- ${lead} → ambiguous: ${list
          .slice(-4)
          .map((c) => `[${c.ref}]`)
          .join(" or ")}`,
      );
    if (list.length >= 2) {
      const last = list.at(-1) as Candidate;
      hints.push(`- ${quote(`the last ${n}`)} → [${last.ref}]`);
      const ordinals = list
        .slice(0, 4)
        .map((c, i) => `${quote(`the ${ORDINAL_WORDS[i] ?? ""} ${n}`)} → [${c.ref}]`);
      hints.push(`- ${ordinals.join("; ")}`);
    }
  }

  // "the second database": an ordinal with any noun means an item of the list the user is working on.
  const fl = focusList;
  if (fl && fl.ids.length >= 2) {
    const items = fl.ids
      .slice(0, 4)
      .map((_, i) => `${ORDINAL_WORDS[i] ?? ""} [${fl.ref}.${String(i + 1)}]`);
    hints.push(
      `- "the first/second/third <thing>" (an item of the list [${fl.ref}]) → ${items.join(", ")}`,
    );
  }

  // "Make that a heading", right after something was added or changed: with no noun to go by, "that" is what changed last.
  const lastChanged = touched[0];
  const lastRef = lastChanged
    ? (refMap.refOf(lastChanged.blockId) ?? refMap.refOf(topOf(lastChanged.blockId) ?? ""))
    : undefined;
  if (lastRef)
    hints.unshift(
      `- ${quote("that")} or ${quote("it")} with no noun (${quote("make that a heading")}) means [${lastRef}], the last thing changed: do not ask which one`,
    );

  if (input.nameCollisions) hints.push(...nameCollisions(doc, refMap));

  if (lastTouched.length > 0) lines.push(`LAST_TOUCHED: ${lastTouched.join(" ")}`);
  const recent = touched
    .slice(0, 3)
    .map((t) => {
      const top = topOf(t.blockId);
      const ref = top ? refMap.refOf(top)?.split(".")[0] : undefined;
      return ref ? `[${ref}] (${t.note})` : undefined;
    })
    .filter((x): x is string => x !== undefined);
  if (recent.length > 0) lines.push(`RECENT_AI_CHANGES: ${recent.join(", ")}`);
  if (hints.length > 0) lines.push("HINTS:", ...hints);
  return lines.join("\n");
}
