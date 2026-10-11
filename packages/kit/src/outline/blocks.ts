import { GraphSchema, TableSchema, isListItem, type Block, type LucidDoc } from "@lucid/core";
import { inlineToPlain } from "../text";

/**
 * The blocks of a page as a person counts them, in the margin: block 1, block 2, ... A list is one block, a table is one, a
 * diagram is one; inside a block there are parts (the items of a list, the rows and columns of a table, the parts and
 * connections of a diagram). The numbers are the model's own references (`b3`, `b3.2`), so what is shown in the margin, what
 * is said ("in block 3, item 2") and what the model is told are the same thing.
 */

export interface PartItem {
  /** Its number inside the block, as it is said ("row 2"). */
  n: number;
  /** The model's reference, for list items (`b3.2`). */
  ref?: string;
  /** The block's own id for it: a row (`r2`), a column (`c3`), a part of a diagram, a connection (`e1`). */
  id?: string;
  label: string;
}
export interface PartGroup {
  title: string;
  items: PartItem[];
}
export interface BlockInfo {
  /** 1-based place on the page, as shown in the margin. */
  n: number;
  /** `b3`. */
  ref: string;
  /** "heading", "paragraph", "list", "table", "diagram", ... */
  kind: string;
  /** A few words saying which one it is. */
  label: string;
  /** The top-level block ids it covers (a list has one per item). */
  ids: string[];
  groups: PartGroup[];
}

/** At most `max` characters, cut at a word. */
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function short(text: string, max = 44): string {
  const plain = text.replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`;

function itemGroups(run: readonly Block[], ref: string): PartGroup[] {
  const items: PartItem[] = run.map((b, i) => ({
    n: i + 1,
    ref: `${ref}.${String(i + 1)}`,
    label: short(inlineToPlain(b.content), 60),
  }));
  const groups: PartGroup[] = [{ title: "Items", items }];
  const nested: PartItem[] = [];
  const walk = (blocks: readonly Block[], parentRef: string) => {
    blocks.forEach((b, i) => {
      const childRef = `${parentRef}.${String(i + 1)}`;
      nested.push({
        n: nested.length + 1,
        ref: childRef,
        label: short(inlineToPlain(b.content), 60),
      });
      if (b.children) walk(b.children, childRef);
    });
  };
  run.forEach((b, i) => {
    if (b.children) walk(b.children, `${ref}.${String(i + 1)}`);
  });
  if (nested.length > 0) groups.push({ title: "Sub-items", items: nested });
  return groups;
}

function tableInfo(block: Block): { label: string; groups: PartGroup[] } {
  const table = TableSchema.safeParse(block.props["table"]);
  const caption = typeof block.props["caption"] === "string" ? block.props["caption"].trim() : "";
  if (!table.success) return { label: caption || "table", groups: [] };
  const { columns, rows } = table.data;
  return {
    label: caption || `${String(rows.length)} × ${String(columns.length)}`,
    groups: [
      {
        title: "Columns",
        items: columns.map((c, i) => ({ n: i + 1, id: c.id, label: short(c.name, 40) })),
      },
      {
        title: "Rows",
        items: rows.map((r, i) => ({
          n: i + 1,
          id: r.id,
          label: short(r.cells[0] ?? "", 40) || `Row ${String(i + 1)}`,
        })),
      },
    ],
  };
}

function diagramInfo(block: Block): { label: string; groups: PartGroup[] } {
  const graph = GraphSchema.safeParse(block.props["graph"]);
  const caption = typeof block.props["caption"] === "string" ? block.props["caption"].trim() : "";
  if (!graph.success) return { label: caption || "diagram", groups: [] };
  const { nodes, edges, title } = graph.data;
  const name = new Map(nodes.map((n) => [n.id, n.label]));
  return {
    label: title?.trim() || caption || plural(nodes.length, "part"),
    groups: [
      { title: "Parts", items: nodes.map((n, i) => ({ n: i + 1, id: n.id, label: n.label })) },
      {
        title: "Connections",
        items: edges.map((e, i) => ({
          n: i + 1,
          id: e.id,
          label: `${name.get(e.from) ?? e.from} → ${name.get(e.to) ?? e.to}${e.label ? `: ${e.label}` : ""}`,
        })),
      },
    ],
  };
}

function single(block: Block, n: number): BlockInfo {
  const base = { n, ref: `b${String(n)}`, kind: block.type, ids: [block.id] };
  switch (block.type) {
    case "table":
      return { ...base, ...tableInfo(block) };
    case "diagram":
      return { ...base, ...diagramInfo(block) };
    case "chart": {
      const chart = block.props["chart"] as { title?: unknown } | undefined;
      const title = typeof chart?.title === "string" ? chart.title : "";
      return { ...base, label: short(title) || "chart", groups: [] };
    }
    case "math":
      return {
        ...base,
        label: short(str(block.props["latex"]), 30) || "formula",
        groups: [],
      };
    case "code":
      return { ...base, label: str(block.props["language"]) || "code", groups: [] };
    default:
      return { ...base, label: short(inlineToPlain(block.content)), groups: [] };
  }
}

/** Every block of the page, in order, numbered as the margin shows them (and as the model's outline does). */
export function describeBlocks(doc: LucidDoc): BlockInfo[] {
  const out: BlockInfo[] = [];
  const top = doc.blocks;
  for (let i = 0; i < top.length;) {
    const block = top[i];
    if (!block) break;
    const n = out.length + 1;
    if (isListItem(block)) {
      let end = i;
      while (top[end + 1]?.type === block.type) end += 1;
      const run = top.slice(i, end + 1);
      const ref = `b${String(n)}`;
      out.push({
        n,
        ref,
        kind: "list",
        label: plural(run.length, "item"),
        ids: run.map((b) => b.id),
        groups: itemGroups(run, ref),
      });
      i = end + 1;
    } else {
      out.push(single(block, n));
      i += 1;
    }
  }
  return out;
}

// ---- what a person says: "in block 3", "item 2 of block 3", "row 2 of the fourth block" ----

export type PartKind = "item" | "row" | "column" | "node" | "connection";
export interface BlockMention {
  /** The block's number, or "last". */
  block: number | "last";
  part?: { kind: PartKind; n: number };
  /** Where it was said, for ordering. */
  at: number;
}

const WORDS: Record<string, number> = Object.fromEntries(
  [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
  ].map((w, i) => [w, i + 1]),
);
const ORDINALS: Record<string, number> = Object.fromEntries(
  [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "eleventh",
    "twelfth",
    "thirteenth",
    "fourteenth",
    "fifteenth",
    "sixteenth",
    "seventeenth",
    "eighteenth",
    "nineteenth",
    "twentieth",
  ].map((w, i) => [w, i + 1]),
);
const PARTS: Record<string, PartKind> = {
  item: "item",
  items: "item",
  bullet: "item",
  point: "item",
  step: "item",
  entry: "item",
  row: "row",
  column: "column",
  col: "column",
  node: "node",
  component: "node",
  part: "node",
  connection: "connection",
  edge: "connection",
  arrow: "connection",
  link: "connection",
};

const NUM = `(\\d{1,3}|${Object.keys(WORDS).join("|")})`;
const ORD = `(${Object.keys(ORDINALS).join("|")})`;
const PART = `(${Object.keys(PARTS).join("|")})`;
const NO = "(?:number |no )?";
// "block 3", "the third block" or "the last block", as a regular expression source with three groups (number, ordinal, last).
const BLOCK_REF = `(?:block ${NO}${NUM}|(?:the )?${ORD} block|(?:the )?(last) block)(?! (?:diagram|chart|quote))`;

const toNumber = (word: string | undefined): number | undefined =>
  word === undefined ? undefined : /^\d+$/.test(word) ? Number(word) : WORDS[word];

function blockOf(num?: string, ord?: string, last?: string): number | "last" | undefined {
  if (last) return "last";
  if (ord) return ORDINALS[ord];
  return toNumber(num);
}

/**
 * The blocks and parts a person names in what they said. "block 3", "B3", "the third block", "the last block", "blocks 2 and 3",
 * "item 2 of block 3", "block 3 item 2", "row two in the fourth block", "node 2 of block 5". Plain words like "block diagram" or
 * "building blocks" are not mentions: a number or an ordinal is needed.
 */
export function parseBlockMentions(utterance: string): BlockMention[] {
  const text = utterance
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\bb(\d{1,3})\b/g, "block $1")
    .replace(/\s+/g, " ")
    .trim();
  const found: BlockMention[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  const add = (start: number, end: number, mention: Omit<BlockMention, "at">) => {
    if (!free(start, end)) return;
    taken.push([start, end]);
    found.push({ ...mention, at: start });
  };

  // "item 2 of block 3", "row two in the fourth block"
  const partOf = new RegExp(`\\b${PART} ${NO}${NUM} (?:of|in|from|on|at|inside) ${BLOCK_REF}`, "g");
  for (const m of text.matchAll(partOf)) {
    const kind = PARTS[m[1] ?? ""];
    const n = toNumber(m[2]);
    const block = blockOf(m[3], m[4], m[5]);
    if (kind && n && block !== undefined)
      add(m.index, m.index + m[0].length, { block, part: { kind, n } });
  }
  // "block 3 item 2"
  const blockPart = new RegExp(`\\bblock ${NO}${NUM} (?:and )?${PART} ${NO}${NUM}\\b`, "g");
  for (const m of text.matchAll(blockPart)) {
    const block = toNumber(m[1]);
    const kind = PARTS[m[2] ?? ""];
    const n = toNumber(m[3]);
    if (block && kind && n) add(m.index, m.index + m[0].length, { block, part: { kind, n } });
  }
  // "blocks 2 and 3"
  for (const m of text.matchAll(new RegExp(`\\bblocks ${NUM}(?: (?:and|or|to) ${NUM})?\\b`, "g"))) {
    for (const word of [m[1], m[2]]) {
      const block = toNumber(word);
      if (block) found.push({ block, at: m.index });
    }
    taken.push([m.index, m.index + m[0].length]);
  }
  // "block 3", "the third block", "the last block"
  for (const m of text.matchAll(new RegExp(`\\b${BLOCK_REF}`, "g"))) {
    const block = blockOf(m[1], m[2], m[3]);
    if (block !== undefined) add(m.index, m.index + m[0].length, { block });
  }
  return found.sort((a, b) => a.at - b.at);
}

const KIND_WORD: Record<string, string> = {
  list: "list",
  heading: "heading",
  paragraph: "paragraph",
  callout: "callout",
  table: "table",
  diagram: "diagram",
  chart: "chart",
  math: "formula",
  code: "code block",
};
const kindWord = (info: BlockInfo): string => KIND_WORD[info.kind] ?? info.kind;
const WANTED: Record<PartKind, { kind: string; word: string }> = {
  item: { kind: "list", word: "list" },
  row: { kind: "table", word: "table" },
  column: { kind: "table", word: "table" },
  node: { kind: "diagram", word: "diagram" },
  connection: { kind: "diagram", word: "diagram" },
};
const PART_WORD: Record<PartKind, string> = {
  item: "item",
  row: "row",
  column: "column",
  node: "part",
  connection: "connection",
};
const GROUP_OF: Record<PartKind, string> = {
  item: "Items",
  row: "Rows",
  column: "Columns",
  node: "Parts",
  connection: "Connections",
};
const COUNT_WORD: Record<PartKind, [string, string]> = {
  item: ["item", "items"],
  row: ["row", "rows"],
  column: ["column", "columns"],
  node: ["part", "parts"],
  connection: ["connection", "connections"],
};

function describeOne(info: BlockInfo): string {
  const word = kindWord(info);
  if (info.kind === "list") return `list (${info.label})`;
  return info.label ? `${word} "${info.label}"` : word;
}

/**
 * Lines for the model when the person numbered blocks ("in block 3, add a row"): which reference each number is, what is in it,
 * and, when there is no such block or part, that there is none (so the model asks instead of guessing). Empty when no block was
 * named. They go after the hints, so the long part of the prompt that the model server keeps is not changed.
 */
export function blockMentionNotes(doc: LucidDoc, utterance: string): string[] {
  const mentions = parseBlockMentions(utterance);
  if (mentions.length === 0) return [];
  const infos = describeBlocks(doc);
  const lines: string[] = [
    "BLOCK NUMBERS: the person counts the blocks as the page margin shows them (a list is one block, a table is one, a diagram is one): block N is [bN] in the outline.",
  ];
  for (const m of mentions) {
    const number = m.block === "last" ? infos.length : m.block;
    const said = m.block === "last" ? "the last block" : `block ${String(m.block)}`;
    const quoted = m.part ? `${PART_WORD[m.part.kind]} ${String(m.part.n)} of ${said}` : said;
    const info = infos[number - 1];
    if (!info) {
      lines.push(
        infos.length === 0
          ? `- "${quoted}": there is no ${said}: the page has no blocks`
          : `- "${quoted}": there is no ${said}: the page has ${plural(infos.length, "block")} (b1 to b${String(infos.length)}). If they mean another one, ask which`,
      );
      continue;
    }
    if (!m.part) {
      lines.push(`- "${quoted}" → [${info.ref}] ${describeOne(info)}`);
      continue;
    }
    const want = WANTED[m.part.kind];
    if (info.kind !== want.kind) {
      lines.push(
        `- "${quoted}": ${said === "the last block" ? "the last block" : `block ${String(number)}`} is a ${kindWord(info)}, not a ${want.word}`,
      );
      continue;
    }
    const group = info.groups.find((g) => g.title === GROUP_OF[m.part?.kind ?? "item"]);
    const part = group?.items[m.part.n - 1];
    if (!part) {
      const [one, many] = COUNT_WORD[m.part.kind];
      const count = group?.items.length ?? 0;
      lines.push(
        `- "${quoted}": the ${want.word} has ${count === 1 ? `1 ${one}` : `${String(count)} ${many}`}`,
      );
      continue;
    }
    switch (m.part.kind) {
      case "item":
        lines.push(`- "${quoted}" → [${part.ref ?? info.ref}] "${part.label}"`);
        break;
      case "row":
        lines.push(
          `- "${quoted}" → row ${part.id ?? ""} ("${part.label}") of the table [${info.ref}]`,
        );
        break;
      case "column":
        lines.push(
          `- "${quoted}" → column ${part.id ?? ""} ("${part.label}") of the table [${info.ref}]`,
        );
        break;
      case "node":
        lines.push(
          `- "${quoted}" → part "${part.id ?? ""}" ("${part.label}") of the diagram [${info.ref}]`,
        );
        break;
      case "connection":
        lines.push(
          `- "${quoted}" → connection ${part.id ?? ""} (${part.label}) of the diagram [${info.ref}]`,
        );
        break;
    }
  }
  return lines;
}
