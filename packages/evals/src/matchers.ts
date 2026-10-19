import {
  aliasKey,
  contentWords,
  inventedNumbers,
  plainTextOfBlocks,
  stem,
  ungroundedTerms,
  type Block,
  type Graph,
  type LucidDoc,
  type Table,
} from "@lucid/core";
import { inlineToPlain } from "@lucid/kit";
import type { Count, DocExpect, Edge, Expect, GraphExpect, Sel, TableExpect } from "./types";

/** Everything a matcher may look at for one trial. */
export interface Observed {
  before: LucidDoc;
  after: LucidDoc;
  /** What the pipeline came to: applied / command / unprocessed (input) or edit / proposal / clarify / none / failed (command). */
  outcome: string;
  /** What was said (this variant). */
  utterance: string;
  /** For a clarify: how many options were offered. */
  clarifyOptions?: number;
  /** For none: whether the model said the words were content. */
  noneIsContent?: boolean;
  outputTokens?: number;
  /** Advisor: the format chosen. */
  formatId?: string;
}

// ----------------------------------------------------------------------------------------------- finding things

const normal = (s: string): string => aliasKey(s.replace(/[^\p{L}\p{N}]+/gu, " ").trim());
const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** A label matches when it is the same term (aliases included), or has all the words of the wanted one. */
export function labelMatches(actual: string, wanted: string): boolean {
  if (normal(actual) === normal(wanted)) return true;
  const have = new Set(tokens(actual).map(stem));
  const want = tokens(wanted).map(stem);
  return want.length > 0 && want.every((w) => have.has(w));
}

const textOf = (b: Block): string =>
  b.type === "heading" || b.type === "paragraph" || b.type.endsWith("ListItem")
    ? inlineToPlain(b.content)
    : plainTextOfBlocks([b]);

function flatten(blocks: readonly Block[]): Block[] {
  return blocks.flatMap((b) => [b, ...flatten(b.children ?? [])]);
}

const LIST_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);

/** The block a selector points at, or undefined. */
export function findBlock(doc: LucidDoc, sel: Sel): Block | undefined {
  const top = doc.blocks;
  const kind = typeof sel === "string" ? sel : sel.type;
  const nth = typeof sel === "string" ? 0 : (sel.nth ?? 0);
  const text = typeof sel === "string" ? undefined : sel.text;
  const type = kind === "list" ? undefined : kind;
  const matching = top.filter((b) =>
    kind === "list"
      ? LIST_TYPES.has(b.type)
      : b.type === (type === "heading" ? "heading" : type) &&
        (text ? labelMatches(textOf(b), text) : true),
  );
  const filtered =
    text && kind === "list" ? matching.filter((b) => labelMatches(textOf(b), text)) : matching;
  return nth === "last" ? filtered.at(-1) : filtered[nth];
}

const inCount = (n: number, c: Count): boolean =>
  (c.eq === undefined || n === c.eq) &&
  (c.min === undefined || n >= c.min) &&
  (c.max === undefined || n <= c.max);
const countText = (c: Count): string =>
  [
    c.eq !== undefined ? `exactly ${String(c.eq)}` : "",
    c.min !== undefined ? `at least ${String(c.min)}` : "",
    c.max !== undefined ? `at most ${String(c.max)}` : "",
  ]
    .filter(Boolean)
    .join(" and ");

// ----------------------------------------------------------------------------------------------- graph

function graphOf(b: Block | undefined): Graph | undefined {
  return b?.props["graph"] as Graph | undefined;
}

function nodeByName(g: Graph, name: string) {
  return g.nodes.find((n) => n.id === name || labelMatches(n.label, name));
}

function hasEdge(g: Graph, e: Edge): boolean {
  const from = nodeByName(g, e.from);
  const to = nodeByName(g, e.to);
  if (!from || !to) return false;
  return g.edges.some((x) => {
    const forward = x.from === from.id && x.to === to.id;
    const back = e.either === true && x.from === to.id && x.to === from.id;
    return (
      (forward || back) && (e.labelHas === undefined || labelMatches(x.label ?? "", e.labelHas))
    );
  });
}

function checkGraph(o: Observed, want: GraphExpect): string[] {
  const out: string[] = [];
  const block = findBlock(o.after, want.on ?? "diagram");
  const g = graphOf(block);
  if (!g) return [`there is no diagram${want.on ? "" : ""} to check`];
  const names = g.nodes.map((n) => n.label).join(", ");
  for (const n of want.hasNodes ?? [])
    if (!nodeByName(g, n)) out.push(`missing component "${n}" (has: ${names})`);
  for (const n of want.lacksNodes ?? [])
    if (nodeByName(g, n)) out.push(`should not have component "${n}"`);
  for (const e of want.hasEdges ?? [])
    if (!hasEdge(g, e))
      out.push(`missing connection ${e.from} → ${e.to}${e.labelHas ? ` ("${e.labelHas}")` : ""}`);
  for (const e of want.lacksEdges ?? [])
    if (hasEdge(g, e)) out.push(`should not have connection ${e.from} → ${e.to}`);
  if (want.nodeCount && !inCount(g.nodes.length, want.nodeCount))
    out.push(`expected ${countText(want.nodeCount)} components, got ${String(g.nodes.length)}`);
  if (want.edgeCount && !inCount(g.edges.length, want.edgeCount))
    out.push(`expected ${countText(want.edgeCount)} connections, got ${String(g.edges.length)}`);
  for (const k of want.kinds ?? []) {
    const n = nodeByName(g, k.label);
    if (n && n.kind !== k.kind) out.push(`"${k.label}" should be a ${k.kind}, is ${n.kind}`);
  }
  for (const s of want.statuses ?? []) {
    const n = nodeByName(g, s.label);
    if (!n) out.push(`missing component "${s.label}" (needed to check its status)`);
    else if (n.status !== s.status) out.push(`"${s.label}" should be ${s.status}, is ${n.status}`);
  }
  for (const e of want.dashed ?? []) {
    const from = nodeByName(g, e.from);
    const to = nodeByName(g, e.to);
    const edge = g.edges.find((x) => x.from === from?.id && x.to === to?.id);
    if (edge?.style === "solid") out.push(`${e.from} → ${e.to} should be dashed`);
  }
  if (want.noUngroundedNodes === true) {
    const before = new Set(
      (graphOf(findBlock(o.before, want.on ?? "diagram"))?.nodes ?? []).map((n) => n.id),
    );
    const added = g.nodes.filter((n) => !before.has(n.id)).map((n) => n.label);
    const bad = ungroundedTerms(added, [o.utterance, plainTextOfBlocks(o.before.blocks)]);
    if (bad.length > 0) out.push(`invented components: ${bad.join(", ")}`);
  }
  return out;
}

// ----------------------------------------------------------------------------------------------- table

function tableOf(b: Block | undefined): Table | undefined {
  return b?.props["table"] as Table | undefined;
}

function checkTable(o: Observed, want: TableExpect): string[] {
  const out: string[] = [];
  const t = tableOf(findBlock(o.after, want.on ?? "table"));
  if (!t) return ["there is no table to check"];
  if (want.columns) {
    const got = t.columns.map((c) => c.name);
    const ok =
      got.length === want.columns.length &&
      want.columns.every((c, i) => labelMatches(got[i] ?? "", c));
    if (!ok) out.push(`columns should be [${want.columns.join(", ")}], are [${got.join(", ")}]`);
  }
  if (want.rowCount && !inCount(t.rows.length, want.rowCount))
    out.push(`expected ${countText(want.rowCount)} rows, got ${String(t.rows.length)}`);
  if (want.rowHeaders) {
    const heads = t.rows.map((r) => r.cells[0] ?? "");
    let at = 0;
    for (const h of want.rowHeaders) {
      const i = heads.findIndex((x, idx) => idx >= at && labelMatches(x, h));
      if (i < 0) out.push(`row "${h}" is missing or out of order (rows: ${heads.join(", ")})`);
      else at = i + 1;
    }
  }
  const colIndex = (name: string) => t.columns.findIndex((c) => labelMatches(c.name, name));
  for (const r of want.rows ?? []) {
    const row = t.rows.find((x) => labelMatches(x.cells[0] ?? "", r.header));
    if (!row) {
      out.push(`there is no row "${r.header}"`);
      continue;
    }
    for (const col of r.filled ?? []) {
      const i = colIndex(col);
      if (i < 0) out.push(`there is no column "${col}"`);
      else if ((row.cells[i] ?? "").trim().length === 0)
        out.push(`row "${r.header}": ${col} is empty`);
    }
    for (const [col, text] of Object.entries(r.contains ?? {})) {
      const i = colIndex(col);
      if (
        i < 0 ||
        (!labelMatches(row.cells[i] ?? "", text) &&
          !(row.cells[i] ?? "").toLowerCase().includes(text.toLowerCase()))
      )
        out.push(`row "${r.header}", ${col}: expected "${text}", got "${row.cells[i] ?? ""}"`);
    }
  }
  for (const s of want.rowStatuses ?? []) {
    const row = t.rows.find((x) => labelMatches(x.cells[0] ?? "", s.header));
    if (!row) out.push(`there is no row "${s.header}"`);
    else if (row.status !== s.status)
      out.push(`row "${s.header}" should be ${s.status}, is ${row.status}`);
  }
  const all = [...t.columns.map((c) => c.name), ...t.rows.flatMap((r) => r.cells)]
    .join("\n")
    .toLowerCase();
  for (const c of want.cellsContain ?? [])
    if (!all.includes(c.toLowerCase())) out.push(`the table does not contain "${c}"`);
  return out;
}

// ----------------------------------------------------------------------------------------------- text and structure

function checkDoc(o: Observed, want: DocExpect): string[] {
  const out: string[] = [];
  const blocks = flatten(o.after.blocks);
  const added = blocks.filter((b) => !flatten(o.before.blocks).some((x) => x.id === b.id));
  const text = plainTextOfBlocks(o.after.blocks);
  const stems = new Set(contentWords(text));
  const has = (term: string): boolean => {
    if (text.toLowerCase().includes(term.toLowerCase())) return true;
    const words = contentWords(term);
    // A filler such as "uh" has no content words: it is only there if it is there as written.
    return words.length > 0 && words.every((w) => stems.has(w));
  };
  for (const h of want.hasHeading ?? []) {
    const found = blocks.some(
      (b) =>
        b.type === "heading" &&
        (h.level === undefined || b.props["level"] === h.level) &&
        (labelMatches(inlineToPlain(b.content), h.text) ||
          inlineToPlain(b.content).toLowerCase().includes(h.text.toLowerCase())),
    );
    if (!found)
      out.push(`no heading${h.level ? ` level ${String(h.level)}` : ""} like "${h.text}"`);
  }
  for (const c of want.contains ?? []) if (!has(c)) out.push(`the notes do not mention "${c}"`);
  for (const c of want.lacks ?? []) if (has(c)) out.push(`the notes should not mention "${c}"`);
  const items = blocks.filter((b) => LIST_TYPES.has(b.type)).map((b) => inlineToPlain(b.content));
  for (const i of want.listItems ?? [])
    if (!items.some((x) => x.toLowerCase().includes(i.toLowerCase()) || labelMatches(x, i)))
      out.push(`no list item with "${i}"`);
  for (const [type, c] of Object.entries(want.blockCounts ?? {})) {
    const n = blocks.filter((b) => b.type === type).length;
    if (!inCount(n, c)) out.push(`expected ${countText(c)} ${type} blocks, got ${String(n)}`);
  }
  for (const s of want.itemStatuses ?? []) {
    // The block that IS this text, before one that merely mentions it (a paragraph about PostgreSQL is not the option).
    const exact = blocks.find(
      (x) => textOf(x).trim().toLowerCase() === s.text.trim().toLowerCase(),
    );
    const b = exact ?? blocks.find((x) => labelMatches(textOf(x), s.text));
    if (!b) out.push(`item "${s.text}" is gone`);
    else if (((b.props["status"] as string | undefined) ?? "normal") !== s.status)
      out.push(
        `item "${s.text}" should be ${s.status}, is ${(b.props["status"] as string | undefined) ?? "normal"}`,
      );
  }
  if (want.listItemCount && !inCount(items.length, want.listItemCount))
    out.push(`expected ${countText(want.listItemCount)} list items, got ${String(items.length)}`);
  for (const s of want.underHeading ?? []) {
    const top = o.after.blocks;
    const at = top.findIndex(
      (b) => b.type === "heading" && labelMatches(inlineToPlain(b.content), s.heading),
    );
    if (at < 0) {
      out.push(`there is no section "${s.heading}"`);
      continue;
    }
    const level = (b: Block): number =>
      b.props["level"] === 2 || b.props["level"] === 3 ? b.props["level"] : 1;
    const heading = top[at] as Block;
    let end = top.length;
    for (let i = at + 1; i < top.length; i++) {
      const b = top[i];
      if (b?.type === "heading" && level(b) <= level(heading)) {
        end = i;
        break;
      }
    }
    const inside = plainTextOfBlocks(top.slice(at + 1, end)).toLowerCase();
    for (const term of s.contains)
      if (!inside.includes(term.toLowerCase()))
        out.push(`section "${s.heading}" does not have "${term}"`);
  }
  if (want.noInventedNumbers === true) {
    const invented = inventedNumbers(plainTextOfBlocks(added), [
      o.utterance,
      plainTextOfBlocks(o.before.blocks),
    ]);
    if (invented.length > 0) out.push(`invented numbers: ${invented.join(", ")}`);
  }
  if (want.hasMath === true || want.mathContains) {
    const math = blocks
      .filter((b) => b.type === "math")
      .map((b) => (typeof b.props["latex"] === "string" ? b.props["latex"] : ""))
      .concat(
        blocks.flatMap((b) =>
          (b.content ?? []).flatMap((i) => (i.type === "mathInline" ? [i.latex] : [])),
        ),
      );
    if (math.length === 0) out.push("there is no formula");
    for (const m of want.mathContains ?? [])
      if (!math.some((x) => x.toLowerCase().includes(m.toLowerCase())))
        out.push(`no formula has "${m}"`);
  }
  return out;
}

/** The ids a selector stands for: one block, or for "list" the whole run of list items it is in. */
function idsOf(doc: LucidDoc, sel: Sel): string[] {
  const found = findBlock(doc, sel);
  if (!found) return [];
  if ((typeof sel === "string" ? sel : sel.type) !== "list") return [found.id];
  const top = doc.blocks;
  const at = top.findIndex((b) => b.id === found.id);
  let from = at;
  let to = at;
  while (from > 0 && LIST_TYPES.has(top[from - 1]?.type ?? "")) from--;
  while (to < top.length - 1 && LIST_TYPES.has(top[to + 1]?.type ?? "")) to++;
  return top.slice(from, to + 1).map((b) => b.id);
}

/** Every block except the named ones is exactly as it was. */
export function unrelatedChangedCount(o: Observed, sels: readonly Sel[]): number {
  const allowed = new Set(sels.flatMap((s) => idsOf(o.before, s)));
  let count = 0;
  for (const b of o.before.blocks) {
    if (allowed.has(b.id)) continue;
    const now = o.after.blocks.find((x) => x.id === b.id);
    if (!now || JSON.stringify(now) !== JSON.stringify(b)) count += 1;
  }
  return count;
}

/** Every block except the named ones is exactly as it was. */
function checkTouchedOnly(o: Observed, sels: readonly Sel[]): string[] {
  const allowed = new Set(sels.flatMap((s) => idsOf(o.before, s)));
  const out: string[] = [];
  for (const b of o.before.blocks) {
    if (allowed.has(b.id)) continue;
    const now = o.after.blocks.find((x) => x.id === b.id);
    if (!now)
      out.push(`a block that should be untouched is gone: ${textOf(b).slice(0, 40) || b.type}`);
    else if (JSON.stringify(now) !== JSON.stringify(b))
      out.push(`a block that should be untouched changed: ${textOf(b).slice(0, 40) || b.type}`);
  }
  return out;
}

// ----------------------------------------------------------------------------------------------- entry point

const DEFAULT_OUTCOME: Record<"input" | "command" | "advisor", string> = {
  input: "applied",
  command: "edit",
  advisor: "advice",
};

/** Every way the trial missed what the case expects. Empty means it passed. */
export function evaluate(
  mode: "input" | "command" | "advisor",
  expect: Expect,
  o: Observed,
): string[] {
  const failures: string[] = [];
  const wanted = expect.outcome ?? DEFAULT_OUTCOME[mode];
  if (o.outcome !== wanted) {
    failures.push(`expected the outcome "${wanted}", got "${o.outcome}"`);
    return failures;
  }
  if (expect.formatId !== undefined && o.formatId !== expect.formatId)
    failures.push(`expected the format ${expect.formatId}, got ${o.formatId ?? "none"}`);
  if (expect.clarifyOptionsMin !== undefined && (o.clarifyOptions ?? 0) < expect.clarifyOptionsMin)
    failures.push(
      `expected at least ${String(expect.clarifyOptionsMin)} options, got ${String(o.clarifyOptions ?? 0)}`,
    );
  if (expect.noneIsContent !== undefined && o.noneIsContent !== expect.noneIsContent)
    failures.push(
      expect.noneIsContent
        ? "should have been treated as content"
        : "should not have been treated as content",
    );
  if (expect.touchedOnly) failures.push(...checkTouchedOnly(o, expect.touchedOnly));
  if (expect.graph) failures.push(...checkGraph(o, expect.graph));
  if (expect.table) failures.push(...checkTable(o, expect.table));
  if (expect.doc) failures.push(...checkDoc(o, expect.doc));
  if (expect.maxOutputTokens !== undefined && (o.outputTokens ?? 0) > expect.maxOutputTokens)
    failures.push(
      `used ${String(o.outputTokens)} output tokens (limit ${String(expect.maxOutputTokens)})`,
    );
  return failures;
}
