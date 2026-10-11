import { aliasKey } from "../grounding/aliases";
import {
  MAX_LABEL_LENGTH,
  emptyGraph,
  type Arrow,
  type Direction,
  type EdgeStyle,
  type GEdge,
  type Graph,
  type NodeKind,
} from "../model/graph";
import {
  GraphOpError,
  addNode,
  groupNodes,
  removeEdges,
  removeNodes,
  renameNode,
  reverseEdge,
  setEdgeLabel,
  setMeta,
  ungroup,
  upsertEdge,
  upsertNode,
} from "../model/graphOps";
import { sharedCommand, type AskOption as GAskOption, type Step } from "./step";
import { inferKind, kindFromWord, parseNumber, slugFor, titleCase, words } from "./words";

/**
 * Guided diagram capture: the person says components, then connections, then fixes, and sees the drawing grow.
 * Everything here is a pure function of (draft, what was said), so it is instant, undoable by the caller keeping the
 * previous draft, and testable. What it cannot read is handed back as `unknown` for the model.
 */
export type Phase = "components" | "connections" | "edit" | "think";

export interface DiagramDraft {
  graph: Graph;
  /** The number of each component, in the order they were added. Numbers are never reused. */
  nodeNo: Record<string, number>;
  nextNo: number;
  phase: Phase;
  /** Notes to self (Think). */
  scratch: string[];
  /** Components the last step created, for the screen to point at. */
  fresh: string[];
}

export type AskOption = GAskOption<DiagramDraft>;
export type StepResult = Step<DiagramDraft>;

// ----------------------------------------------------------------------------------------------- drafts

export function newDraft(phase: Phase = "components"): DiagramDraft {
  return {
    graph: { ...emptyGraph("flowchart", "TB") },
    nodeNo: {},
    nextNo: 1,
    phase,
    scratch: [],
    fresh: [],
  };
}

/** A draft for an existing diagram: its components are numbered in the order they appear. */
export function draftFromGraph(graph: Graph): DiagramDraft {
  const nodeNo: Record<string, number> = {};
  graph.nodes.forEach((n, i) => {
    nodeNo[n.id] = i + 1;
  });
  return { graph, nodeNo, nextNo: graph.nodes.length + 1, phase: "edit", scratch: [], fresh: [] };
}

export const edgeNumber = (e: GEdge): number => Number(e.id.slice(1));

export interface Legend {
  nodes: { no: number; id: string; label: string; kind: NodeKind; connections: number }[];
  edges: {
    no: number;
    id: string;
    from: string;
    to: string;
    label: string | undefined;
    style: EdgeStyle;
    arrow: Arrow;
  }[];
  /** Components with no connection yet. */
  loose: string[];
}

export function legend(draft: DiagramDraft): Legend {
  const g = draft.graph;
  const label = (id: string) => g.nodes.find((n) => n.id === id)?.label ?? id;
  const degree = new Map<string, number>();
  for (const e of g.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const nodes = g.nodes
    .map((n) => ({
      no: draft.nodeNo[n.id] ?? 0,
      id: n.id,
      label: n.label,
      kind: n.kind,
      connections: degree.get(n.id) ?? 0,
    }))
    .sort((a, b) => a.no - b.no);
  return {
    nodes,
    edges: g.edges.map((e) => ({
      no: edgeNumber(e),
      id: e.id,
      from: label(e.from),
      to: label(e.to),
      label: e.label,
      style: e.style,
      arrow: e.arrow,
    })),
    loose: nodes.filter((n) => n.connections === 0).map((n) => n.label),
  };
}

const clip = (s: string) =>
  s.length > MAX_LABEL_LENGTH ? `${s.slice(0, MAX_LABEL_LENGTH - 1)}…` : s;

/** The graph as drawn while building: components carry their number, connections theirs ("#3 returns HTML"). */
export function displayGraph(draft: DiagramDraft): Graph {
  return {
    ...draft.graph,
    nodes: draft.graph.nodes.map((n) => ({
      ...n,
      label: clip(`${String(draft.nodeNo[n.id] ?? "?")} · ${n.label}`),
    })),
    edges: draft.graph.edges.map((e) => ({
      ...e,
      label: clip(`#${String(edgeNumber(e))}${e.label ? ` ${e.label}` : ""}`),
    })),
  };
}

// ----------------------------------------------------------------------------------------------- finding components

const ARTICLES = new Set(["the", "a", "an", "my", "our", "this", "that"]);
const stripArticles = (ws: readonly string[]): string[] => {
  let i = 0;
  while (i < ws.length && ARTICLES.has((ws[i] ?? "").toLowerCase())) i++;
  return ws.slice(i);
};
const stopWord = (w: string) =>
  ARTICLES.has(w.toLowerCase()) || ["of", "and", "or"].includes(w.toLowerCase());

type Found = { kind: "node"; slug: string } | { kind: "many"; slugs: string[] } | undefined;

function byNumber(d: DiagramDraft, n: number): string | undefined {
  return Object.entries(d.nodeNo).find(
    ([slug, no]) => no === n && d.graph.nodes.some((x) => x.id === slug),
  )?.[0];
}

/** Which component does this text name? A number, the exact name (or an alias), or a word of the name if that is unambiguous. */
export function findNode(d: DiagramDraft, text: string, strict = false): Found {
  const ws = stripArticles(words(text)).filter(
    (w) => !/^(?:node|component|box|number|no)$/i.test(w) || words(text).length === 1,
  );
  const q = ws.join(" ");
  if (q.length === 0) return undefined;
  const num =
    parseNumber(ws.join(" ")) ??
    (ws.length === 2 && /^(?:node|component|box|number)$/i.test(words(text)[0] ?? "")
      ? parseNumber(ws[1] ?? "")
      : undefined);
  if (num !== undefined && ws.length <= 2) {
    const slug = byNumber(d, num);
    if (slug) return { kind: "node", slug };
  }
  const key = aliasKey(q);
  const exact = d.graph.nodes.filter((n) => aliasKey(n.label) === key);
  if (exact.length === 1 && exact[0]) return { kind: "node", slug: exact[0].id };
  if (exact.length > 1) return { kind: "many", slugs: exact.map((n) => n.id) };
  // A word of the name ("server" for "Web Server"), if only one component has it.
  const qw = ws.filter((w) => !stopWord(w)).map((w) => w.toLowerCase());
  if (qw.length > 0) {
    const contained = d.graph.nodes.filter((n) => {
      const lw = words(n.label).map((w) => w.toLowerCase());
      return qw.every((w) => lw.includes(w));
    });
    if (contained.length === 1 && contained[0]) return { kind: "node", slug: contained[0].id };
    if (contained.length > 1) return { kind: "many", slugs: contained.map((n) => n.id) };
    // The name contains the component ("the web server box" for "Web Server"): only when asked about a whole name, never
    // while scanning a sentence for components, or the label words after a name would be swallowed.
    const inside = strict
      ? []
      : d.graph.nodes.filter((n) => {
          const lw = words(n.label).map((w) => w.toLowerCase());
          return lw.length > 0 && lw.every((w) => qw.includes(w));
        });
    if (inside.length === 1 && inside[0]) return { kind: "node", slug: inside[0].id };
  }
  if (!strict && q.length >= 5) {
    const near = d.graph.nodes.filter(
      (n) => levenshtein(q.toLowerCase(), n.label.toLowerCase()) <= 1,
    );
    if (near.length === 1 && near[0]) return { kind: "node", slug: near[0].id };
  }
  return undefined;
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j] ?? 0;
      row[j] = Math.min(
        (row[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[b.length] ?? 0;
}

/** The longest run of words that names a known component, preferring the start of the segment. */
function scanKnown(
  d: DiagramDraft,
  tokens: readonly string[],
):
  | { slug: string; start: number; end: number }
  | { many: string[]; start: number; end: number }
  | undefined {
  for (let len = Math.min(4, tokens.length); len >= 1; len--) {
    for (let start = 0; start + len <= tokens.length; start++) {
      const span = tokens.slice(start, start + len);
      if (span.every(stopWord)) continue;
      const hit = findNode(d, span.join(" "), true);
      if (hit?.kind === "node") return { slug: hit.slug, start, end: start + len };
      if (hit?.kind === "many") return { many: hit.slugs, start, end: start + len };
    }
  }
  return undefined;
}

// ----------------------------------------------------------------------------------------------- a working copy of a draft

class Work {
  graph: Graph;
  nodeNo: Record<string, number>;
  nextNo: number;
  fresh: string[] = [];
  echo: string[] = [];
  changed = false;

  constructor(readonly d: DiagramDraft) {
    this.graph = d.graph;
    this.nodeNo = { ...d.nodeNo };
    this.nextNo = d.nextNo;
  }

  label(slug: string): string {
    return this.graph.nodes.find((n) => n.id === slug)?.label ?? slug;
  }

  addComponent(name: string, kind?: NodeKind): string {
    const slug = slugFor(name, new Set(this.graph.nodes.map((n) => n.id)));
    this.graph = addNode(this.graph, {
      id: slug,
      label: clip(name),
      kind: kind ?? inferKind(name),
    });
    this.nodeNo[slug] = this.nextNo++;
    this.fresh.push(slug);
    this.changed = true;
    return slug;
  }

  finish(phase?: Phase): DiagramDraft {
    return {
      graph: this.graph,
      nodeNo: this.nodeNo,
      nextNo: this.nextNo,
      phase: phase ?? this.d.phase,
      scratch: this.d.scratch,
      fresh: this.fresh,
    };
  }
}

const arrow = (d: Direction) => d;

// ----------------------------------------------------------------------------------------------- components phase

const LEAD_IN =
  /^\s*(?:(?:please\s+)?(?:add|adding|create|new|put)\s+)?(?:(?:the\s+)?(?:keywords?|nodes?|components?|boxes|items|things)\s*:?\s*)?/i;

function readComponents(d: DiagramDraft, raw: string): StepResult {
  const body = raw.replace(LEAD_IN, "");
  const pieces = body
    .split(/[,;\n]|\s+and then\s+|\s+then\s+|\s+next\s+|\s+and\s+|\s+also\s+/i)
    .map((p) => stripArticles(words(p)).join(" "))
    .filter((p) => p.length > 0);
  if (pieces.length === 0) return { kind: "unknown", text: raw };
  if (pieces.every((p) => p.split(" ").length > 5)) return { kind: "unknown", text: raw };
  const w = new Work(d);
  const added: string[] = [];
  const same: string[] = [];
  for (const piece of pieces) {
    if (piece.split(" ").length > 5) continue;
    const name = /[A-Z]/.test(piece.slice(1)) ? piece : titleCase(piece);
    const have = d.graph.nodes
      .concat(w.graph.nodes)
      .find((n) => aliasKey(n.label) === aliasKey(name));
    if (have) {
      same.push(have.label);
      continue;
    }
    w.addComponent(name);
    added.push(name);
  }
  const echo: string[] = [];
  if (added.length > 0)
    echo.push(
      `Added ${added.length === 1 ? "component" : `${String(added.length)} components`}: ${added.join(", ")}`,
    );
  if (same.length > 0) echo.push(`Already there: ${same.join(", ")}`);
  if (!w.changed) return { kind: "nothing", echo };
  return { kind: "applied", draft: w.finish("components"), echo };
}

// ----------------------------------------------------------------------------------------------- connections

const STYLE_DASHED =
  /\b(?:dashed|optional(?:ly)?|async(?:hronous(?:ly)?)?|conditional(?:ly)?|on (?:a )?miss|if (?:it )?misses|fallback)\b/i;
const STYLE_DOTTED = /\bdotted\b/i;
const BIDIRECTIONAL =
  /\b(?:both ways|two[- ]way|bidirectional|back and forth|each other|and back)\b/i;
const CONNECTOR = new Set(["to", "towards", "toward", "into", "onto", "from"]);
const VERB_CONNECTOR = new Set(["calls", "queries", "uses", "invokes", "hits", "pings"]);
const CONNECTOR_ONLY_VERBS = new Set([
  "talks",
  "talk",
  "goes",
  "go",
  "connects",
  "connect",
  "points",
  "sends",
  "send",
  "links",
  "link",
  "flows",
  "flow",
  "reaches",
  "communicates",
  "is",
  "are",
  "then",
  "will",
]);
const LABEL_MARKERS = new Set([
  "returns",
  "returning",
  "returned",
  "with",
  "via",
  "using",
  "over",
  "labelled",
  "labeled",
  "called",
  "named",
  "saying",
  "containing",
  "responds",
  "replies",
  "resolves",
  "requests",
  "fetches",
  "reads",
  "writes",
  "queries",
  "stores",
  "checks",
  "forwards",
  "sends",
  "send",
  "carrying",
]);

interface Mention {
  ref: { slug: string } | { name: string } | { many: string[] };
  post: string[];
}

function readMention(d: DiagramDraft, tokens: readonly string[]): Mention | undefined {
  const t = stripArticles(
    tokens.filter(
      (w) => !/^(?:connect|connection|link|add|then|from)$/i.test(w) || tokens.length === 1,
    ),
  );
  if (t.length === 0) return undefined;
  const known = scanKnown(d, t);
  if (known) {
    const post = t.slice(known.end);
    return { ref: "slug" in known ? { slug: known.slug } : { many: known.many }, post };
  }
  const marker = t.findIndex((w, i) => i > 0 && LABEL_MARKERS.has(w.toLowerCase()));
  const nameTokens = marker > 0 ? t.slice(0, marker) : t;
  const name = nameTokens.filter((w) => !CONNECTOR_ONLY_VERBS.has(w.toLowerCase()));
  if (name.length === 0 || name.length > 4) return undefined;
  return { ref: { name: titleCase(name.join(" ")) }, post: marker > 0 ? t.slice(marker) : [] };
}

function labelOf(post: readonly string[], verb?: string): string | undefined {
  let ws = [...post];
  // "talks", "goes", "connects" alone say nothing; "sends request" is a label.
  if (ws.every((w) => CONNECTOR_ONLY_VERBS.has(w.toLowerCase()))) ws = [];
  while (
    ws.length > 0 &&
    /^(?:is|are|will|then|labell?ed|called|named|saying|label)$/i.test(ws[0] ?? "")
  )
    ws = ws.slice(1);
  const text = ws.join(" ").trim();
  const out = text.length > 0 ? text : verb;
  return out ? clip(out) : undefined;
}

interface EdgeIntent {
  from: Mention["ref"];
  to: Mention["ref"];
  label: string | undefined;
}

function splitMentions(d: DiagramDraft, tokens: readonly string[]): Mention[] | undefined {
  const parts: string[][] = [[]];
  for (const t of tokens) {
    if (t.toLowerCase() === "and") parts.push([]);
    else parts.at(-1)?.push(t);
  }
  const out: Mention[] = [];
  for (const p of parts) {
    if (p.length === 0) continue;
    const m = readMention(d, p);
    if (!m) return undefined;
    out.push(m);
  }
  return out.length > 0 ? out : undefined;
}

function readClause(
  d: DiagramDraft,
  clause: string,
): { edges: EdgeIntent[]; arrow?: Arrow; style?: EdgeStyle } | undefined {
  const arrowKind: Arrow | undefined = BIDIRECTIONAL.test(clause) ? "bidirectional" : undefined;
  const style: EdgeStyle | undefined = STYLE_DOTTED.test(clause)
    ? "dotted"
    : STYLE_DASHED.test(clause)
      ? "dashed"
      : undefined;
  const cleaned = clause
    .replace(BIDIRECTIONAL, " ")
    .replace(STYLE_DASHED, " ")
    .replace(STYLE_DOTTED, " ");
  let tokens = words(cleaned);
  if (arrowKind === "bidirectional") {
    while (
      tokens.length > 0 &&
      /^(?:to|with|talk|talks|talking|communicate|communicates|connected|connect|connects)$/i.test(
        tokens.at(-1) ?? "",
      )
    )
      tokens = tokens.slice(0, -1);
  }
  if (tokens.length === 0) return undefined;
  if ((tokens[0] ?? "").toLowerCase() === "from") tokens = tokens.slice(1);

  // Split at connectors; a verb such as "calls" is a connector that also names the connection.
  const segments: string[][] = [[]];
  const verbs: (string | undefined)[] = [];
  tokens.forEach((t, i) => {
    const low = t.toLowerCase();
    const isSplit = i > 0 && (CONNECTOR.has(low) || VERB_CONNECTOR.has(low));
    if (isSplit) {
      segments.push([]);
      verbs.push(VERB_CONNECTOR.has(low) ? low : undefined);
    } else segments.at(-1)?.push(t);
  });

  if (segments.length === 1) {
    // "client and server talk to each other" (the connector was consumed above), or nothing we can read.
    if (arrowKind === "bidirectional") {
      const ms = splitMentions(d, segments[0] ?? []);
      if (ms && ms.length === 2 && ms[0] && ms[1])
        return {
          edges: [{ from: ms[0].ref, to: ms[1].ref, label: undefined }],
          arrow: "bidirectional",
          ...(style ? { style } : {}),
        };
    }
    return undefined;
  }

  const groups = segments.map((s) => splitMentions(d, s));
  if (groups.some((g) => g === undefined)) return undefined;
  const mentions = groups as Mention[][];
  const edges: EdgeIntent[] = [];
  for (let k = 0; k + 1 < mentions.length; k++) {
    const from = mentions[k] ?? [];
    const to = mentions[k + 1] ?? [];
    const outgoing = labelOf(from.at(-1)?.post ?? [], verbs[k]);
    const incoming = k + 2 === mentions.length ? labelOf(to.at(-1)?.post ?? []) : undefined;
    for (const f of from)
      for (const t of to) edges.push({ from: f.ref, to: t.ref, label: incoming ?? outgoing });
  }
  return { edges, ...(arrowKind ? { arrow: arrowKind } : {}), ...(style ? { style } : {}) };
}

function readConnections(d: DiagramDraft, raw: string): StepResult {
  const clauses = raw
    .split(/[;\n]|,\s*(?=\S)|\s+then\s+|\s+and then\s+|(?<=[a-z0-9])\.\s+/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const parsed = clauses.map((c) => readClause(d, c));
  if (parsed.length === 0 || parsed.every((p) => p === undefined))
    return { kind: "unknown", text: raw };
  const w = new Work(d);

  const resolve = (ref: Mention["ref"]): { slug: string } | { ask: string[] } => {
    if ("slug" in ref) return { slug: ref.slug };
    if ("many" in ref) return { ask: ref.many };
    const found = findNode({ ...d, graph: w.graph, nodeNo: w.nodeNo }, ref.name, true);
    if (found?.kind === "node") return { slug: found.slug };
    return { slug: w.addComponent(ref.name) };
  };

  for (const clause of parsed) {
    if (!clause) continue;
    for (const e of clause.edges) {
      const a = resolve(e.from);
      const b = resolve(e.to);
      if ("ask" in a || "ask" in b) {
        const ids = "ask" in a ? a.ask : "ask" in b ? b.ask : [];
        const name = ids.map((id) => w.label(id));
        const side = "ask" in a ? "from" : "to";
        const options: AskOption[] = ids.map((id) => {
          const pick = new Work(d);
          const other = "ask" in a ? b : a;
          const slug = "slug" in other ? other.slug : undefined;
          if (slug === undefined) return { label: w.label(id), draft: d, echo: [] };
          const from = side === "from" ? id : slug;
          const to = side === "from" ? slug : id;
          pick.graph = upsertEdge(pick.graph, { from, to, ...(e.label ? { label: e.label } : {}) });
          return {
            label: w.label(id),
            draft: pick.finish("connections"),
            echo: [`${pick.label(from)} → ${pick.label(to)}`],
          };
        });
        return { kind: "ask", question: `Which one do you mean: ${name.join(" or ")}?`, options };
      }
      if (a.slug === b.slug) {
        w.echo.push(`Skipped: ${w.label(a.slug)} to itself`);
        continue;
      }
      const before = w.graph.edges.length;
      const beforeEdges = w.graph.edges;
      w.graph = upsertEdge(w.graph, {
        from: a.slug,
        to: b.slug,
        ...(e.label ? { label: e.label } : {}),
        ...(clause.arrow ? { arrow: clause.arrow } : {}),
        ...(clause.style ? { style: clause.style } : {}),
      });
      const added = w.graph.edges.length > before;
      const touched = w.graph.edges.find((x) => {
        const was = beforeEdges.find((y) => y.id === x.id);
        return was === undefined || JSON.stringify(was) !== JSON.stringify(x);
      });
      if (!touched) {
        w.echo.push(`Already connected: ${w.label(a.slug)} → ${w.label(b.slug)}`);
        continue;
      }
      w.changed = true;
      const arrowText = touched.arrow === "bidirectional" ? "↔" : "→";
      w.echo.push(
        `${added ? "Connection" : "Updated connection"} ${String(edgeNumber(touched))}: ${w.label(a.slug)} ${arrowText} ${w.label(b.slug)}${touched.label ? ` “${touched.label}”` : ""}`,
      );
    }
  }
  const fresh = w.fresh.map((slug) => w.label(slug));
  if (fresh.length > 0)
    w.echo.unshift(`New component${fresh.length > 1 ? "s" : ""}: ${fresh.join(", ")}`);
  if (!w.changed) return { kind: "nothing", echo: w.echo };
  return { kind: "applied", draft: w.finish("connections"), echo: w.echo };
}

// ----------------------------------------------------------------------------------------------- commands (any phase)

const NODE_NOUN = /^(?:node|component|box|keyword)s?$/i;
const EDGE_NOUN = /^(?:connection|edge|arrow|link|line)s?$/i;

function refsFrom(
  d: DiagramDraft,
  text: string,
  prefer?: "node" | "edge",
): { nodes: string[]; edges: string[]; ambiguous: number[]; unknown: string[] } {
  const out = {
    nodes: [] as string[],
    edges: [] as string[],
    ambiguous: [] as number[],
    unknown: [] as string[],
  };
  const ws = words(text);
  // "node 3 and 4", "connections 2, 5", "3", "redis".
  let kind: "node" | "edge" | undefined;
  const pieces = ws.join(" ").split(/\s*(?:,|\band\b)\s*/i);
  for (const piece of pieces) {
    const toks = piece.split(" ").filter(Boolean);
    let rest = toks;
    if (toks[0] && NODE_NOUN.test(toks[0])) {
      kind = "node";
      rest = toks.slice(1);
    } else if (toks[0] && EDGE_NOUN.test(toks[0])) {
      kind = "edge";
      rest = toks.slice(1);
    }
    if (rest.length === 0) continue;
    const text2 = rest.join(" ");
    const n = parseNumber(text2);
    if (n !== undefined) {
      const slug = byNumber(d, n);
      const edge = d.graph.edges.find((e) => edgeNumber(e) === n);
      if (kind === "node") {
        if (slug) out.nodes.push(slug);
        else out.unknown.push(text2);
      } else if (kind === "edge") {
        if (edge) out.edges.push(edge.id);
        else out.unknown.push(text2);
      } else if (slug && edge && prefer === undefined) out.ambiguous.push(n);
      else if (slug && prefer !== "edge") out.nodes.push(slug);
      else if (edge && prefer !== "node") out.edges.push(edge.id);
      else if (slug) out.nodes.push(slug);
      else if (edge) out.edges.push(edge.id);
      else out.unknown.push(text2);
      continue;
    }
    const f = findNode(d, text2);
    if (f?.kind === "node") out.nodes.push(f.slug);
    else out.unknown.push(text2);
  }
  return out;
}

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

function command(d: DiagramDraft, raw: string): StepResult | undefined {
  const t = raw.trim().replace(/[.!?]+$/g, "");
  const low = t.toLowerCase();
  let m: RegExpExecArray | null;

  const shared = sharedCommand(low);
  if (shared === "undo") return { kind: "undo" };
  if (shared === "done") return { kind: "done" };
  if (shared === "cancel") return { kind: "cancel" };
  if (d.phase === "think" && /^draw(?: it| this| that)?(?: now)?$/.test(low))
    return { kind: "draw", text: d.scratch.join("\n") };

  // Phase words.
  const phaseWord =
    /^(?:(?:go to|switch to|now|next)\s+)?(?:the\s+)?(?:(components?|nodes?|keywords?|boxes)|(connections?|links?|edges?|arrows?)|(edit|fine[- ]?tun(?:e|ing)|fix(?:es|ing)?)|(think(?:ing)?|brainstorm|scratch ?pad))(?:\s+(?:phase|mode|step))?$/.exec(
      low,
    );
  if (phaseWord) {
    const phase: Phase = phaseWord[1]
      ? "components"
      : phaseWord[2]
        ? "connections"
        : phaseWord[3]
          ? "edit"
          : "think";
    return { kind: "applied", draft: { ...d, phase, fresh: [] }, echo: [PHASE_NAME[phase]] };
  }

  // Direction and title.
  m =
    /^(?:(?:set|make)\s+(?:it\s+)?|the\s+)?(?:direction|layout|flow)(?:\s+(?:to|is))?\s+(.+)$/i.exec(
      t,
    ) ?? /^(top (?:to|down to) bottom|left to right|vertical|horizontal)$/i.exec(t);
  if (m?.[1]) {
    const dir = /top|vertical|down/i.test(m[1])
      ? "TB"
      : /left|horizontal|right/i.test(m[1])
        ? "LR"
        : undefined;
    if (dir)
      return {
        kind: "applied",
        draft: { ...d, graph: setMeta(d.graph, { direction: arrow(dir) }), fresh: [] },
        echo: [dir === "TB" ? "Drawn top to bottom" : "Drawn left to right"],
      };
  }
  m = /^(?:set\s+)?(?:the\s+)?title(?:\s+(?:to|is))?\s+(.+)$/i.exec(t);
  if (m?.[1])
    return {
      kind: "applied",
      draft: { ...d, graph: setMeta(d.graph, { title: clip(m[1].trim()) }), fresh: [] },
      echo: [`Title: ${m[1].trim()}`],
    };

  // Reverse.
  m =
    /^(?:reverse|flip|turn around)\s+(?:the\s+)?(?:(?:connection|edge|arrow|link|line)\s+)?(.+)$/i.exec(
      t,
    );
  if (m?.[1]) {
    const n = parseNumber(m[1]);
    const edge = n === undefined ? undefined : d.graph.edges.find((e) => edgeNumber(e) === n);
    if (edge) {
      const g = reverseEdge(d.graph, edge.id);
      const e2 = g.edges.find((e) => e.id === edge.id);
      const name = (id: string) => g.nodes.find((n) => n.id === id)?.label ?? id;
      return {
        kind: "applied",
        draft: { ...d, graph: g, fresh: [] },
        echo: [`Connection ${String(n)} now: ${name(e2?.from ?? "")} → ${name(e2?.to ?? "")}`],
      };
    }
    return { kind: "nothing", echo: [`There is no connection ${m[1]}.`] };
  }

  // A connection by number: label, style, reassign.
  m =
    /^(?:(?:label|name|call)\s+)?(?:the\s+)?(?:connection|edge|arrow|link|line)\s+(\w+)\s+(?:is|as|to|should be|reads)\s+(?:called\s+|labell?ed\s+)?(.+)$/i.exec(
      t,
    );
  if (m?.[1] && m[2]) {
    const n = parseNumber(m[1]);
    const edge = n === undefined ? undefined : d.graph.edges.find((e) => edgeNumber(e) === n);
    if (!edge) return { kind: "nothing", echo: [`There is no connection ${m[1]}.`] };
    const what = m[2].trim();
    if (/^(?:dashed|dotted|solid)$/i.test(what))
      return setStyle(d, edge, what.toLowerCase() as EdgeStyle);
    const goes = /^(?:going\s+)?from\s+(.+?)\s+to\s+(.+)$/i.exec(what);
    if (goes?.[1] && goes[2]) return reassign(d, edge, goes[1], goes[2]);
    if (/^(?:unlabell?ed|nothing|empty|blank)$/i.test(what))
      return {
        kind: "applied",
        draft: { ...d, graph: setEdgeLabel(d.graph, edge.id, null), fresh: [] },
        echo: [`Connection ${String(n)}: label removed`],
      };
    return {
      kind: "applied",
      draft: { ...d, graph: setEdgeLabel(d.graph, edge.id, clip(what)), fresh: [] },
      echo: [`Connection ${String(n)}: “${clip(what)}”`],
    };
  }
  m =
    /^(?:connection|edge|arrow|link|line)\s+(\w+)\s+(?:goes\s+|should go\s+)?from\s+(.+?)\s+to\s+(.+)$/i.exec(
      t,
    );
  if (m?.[1] && m[2] && m[3]) {
    const n = parseNumber(m[1]);
    const edge = n === undefined ? undefined : d.graph.edges.find((e) => edgeNumber(e) === n);
    return edge
      ? reassign(d, edge, m[2], m[3])
      : { kind: "nothing", echo: [`There is no connection ${m[1]}.`] };
  }
  m =
    /^(?:make|set)\s+(?:the\s+)?(?:(?:connection|edge|arrow|link|line)\s+)?(\w+)\s+(?:to be\s+)?(dashed|dotted|solid)$/i.exec(
      t,
    ) ??
    /^(?:the\s+)?(?:(?:connection|edge|arrow|link|line)\s+)?(\w+)\s+(?:is|should be)\s+(dashed|dotted|solid)$/i.exec(
      t,
    );
  if (m?.[1] && m[2]) {
    const n = parseNumber(m[1]);
    const edge = n === undefined ? undefined : d.graph.edges.find((e) => edgeNumber(e) === n);
    if (edge) return setStyle(d, edge, m[2].toLowerCase() as EdgeStyle);
  }

  // A component's kind: "3 is a database".
  m =
    /^(?:(?:node|component|box)\s+)?(.+?)\s+is\s+(?:a|an|the)\s+(client|user|actor|server|service|database|db|datastore|cache|queue|cdn|gateway|load ?balancer|external|storage|decision|process|note)$/i.exec(
      t,
    );
  if (m?.[1] && m[2]) {
    const f = findNode(d, m[1]);
    const kind = kindFromWord(m[2].replace("loadbalancer", "load balancer").replace(/\s+/g, " "));
    if (f?.kind === "node" && kind) {
      if (d.graph.nodes.find((n) => n.id === f.slug)?.kind === kind) {
        return {
          kind: "nothing",
          echo: [`${label(d, f.slug)} already is a ${m[2].toLowerCase()}`],
        };
      }
      return {
        kind: "applied",
        draft: { ...d, graph: upsertNode(d.graph, { id: f.slug, kind }), fresh: [] },
        echo: [`${label(d, f.slug)} is a ${m[2].toLowerCase()}`],
      };
    }
  }

  // Rename a component.
  m = /^(?:rename|call|change)\s+(?:(?:node|component|box)\s+)?(.+?)\s+(?:to|as)\s+(.+)$/i.exec(t);
  if (m?.[1] && m[2] && !/^(?:connection|edge|arrow|link|line)\b/i.test(m[1])) {
    const f = findNode(d, m[1]);
    if (f?.kind === "node") {
      const name = /[A-Z]/.test(m[2].slice(1)) ? m[2].trim() : titleCase(m[2].trim());
      return {
        kind: "applied",
        draft: { ...d, graph: renameNode(d.graph, f.slug, clip(name)), fresh: [] },
        echo: [`${label(d, f.slug)} is now ${name}`],
      };
    }
    if (f?.kind === "many")
      return ask(
        d,
        `Which one: ${f.slugs.map((s) => label(d, s)).join(" or ")}?`,
        f.slugs.map((s) => ({ s, text: label(d, s) })),
        (s) => renameNode(d.graph, s, clip(titleCase(m?.[2] ?? ""))),
      );
    return { kind: "nothing", echo: [`I don't have a component called ${m[1]}.`] };
  }

  // Delete.
  m = /^(?:delete|remove|drop|erase|get rid of)\s+(?:the\s+)?(.+)$/i.exec(t);
  if (m?.[1]) {
    const r = refsFrom(d, m[1]);
    if (r.ambiguous.length > 0) {
      const n = r.ambiguous[0] ?? 0;
      const slug = byNumber(d, n) ?? "";
      const edge = d.graph.edges.find((e) => edgeNumber(e) === n);
      const lg = legend(d).edges.find((e) => e.no === n);
      return {
        kind: "ask",
        question: `Delete component ${String(n)} or connection ${String(n)}?`,
        options: [
          {
            label: `Component ${String(n)}: ${label(d, slug)}`,
            draft: { ...d, graph: removeNodes(d.graph, [slug]), fresh: [] },
            echo: [`Deleted ${label(d, slug)}`],
          },
          {
            label: `Connection ${String(n)}: ${lg?.from ?? ""} → ${lg?.to ?? ""}`,
            draft: { ...d, graph: removeEdges(d.graph, edge ? [edge.id] : []), fresh: [] },
            echo: [`Deleted connection ${String(n)}`],
          },
        ],
      };
    }
    if (r.nodes.length === 0 && r.edges.length === 0)
      return { kind: "nothing", echo: [`Nothing called ${m[1]}.`] };
    let g = d.graph;
    const names = unique(r.nodes).map((s) => label(d, s));
    g = removeEdges(g, unique(r.edges));
    g = removeNodes(g, unique(r.nodes));
    const echo: string[] = [];
    if (names.length > 0) echo.push(`Deleted ${names.join(", ")} (and its connections)`);
    if (r.edges.length > 0)
      echo.push(
        `Deleted connection${r.edges.length > 1 ? "s" : ""} ${r.edges.map((e) => e.slice(1)).join(", ")}`,
      );
    return { kind: "applied", draft: { ...d, graph: g, fresh: [] }, echo };
  }

  // Group and ungroup.
  m = /^group\s+(.+?)\s+(?:as|called|into|named)\s+(.+)$/i.exec(t);
  if (m?.[1] && m[2]) {
    const r = refsFrom(d, m[1], "node");
    const name = m[2].trim();
    if (r.nodes.length < 2)
      return { kind: "nothing", echo: ["Name at least two components to group."] };
    const id = slugFor(name, new Set(d.graph.groups.map((g) => g.id)));
    return {
      kind: "applied",
      draft: {
        ...d,
        graph: groupNodes(d.graph, { id, label: clip(titleCase(name)), members: unique(r.nodes) }),
        fresh: [],
      },
      echo: [
        `Grouped ${unique(r.nodes)
          .map((s) => label(d, s))
          .join(", ")} as ${titleCase(name)}`,
      ],
    };
  }
  m = /^ungroup\s+(.+)$/i.exec(t);
  if (m?.[1]) {
    const target = m[1];
    const g = d.graph.groups.find((x) => aliasKey(x.label) === aliasKey(target));
    if (g)
      return {
        kind: "applied",
        draft: { ...d, graph: ungroup(d.graph, g.id), fresh: [] },
        echo: [`Ungrouped ${g.label}`],
      };
    return { kind: "nothing", echo: [`No group called ${m[1]}.`] };
  }
  return undefined;
}

const PHASE_NAME: Record<Phase, string> = {
  components: "Components: say the names of the parts",
  connections: "Connections: say how they connect, like “client to server”",
  edit: "Edit: fix, rename, reverse, delete, group",
  think: "Think: say it any way you like, then “draw it”",
};

const label = (d: DiagramDraft, slug: string): string =>
  d.graph.nodes.find((n) => n.id === slug)?.label ?? slug;

function setStyle(d: DiagramDraft, edge: GEdge, style: EdgeStyle): StepResult {
  const graph = {
    ...d.graph,
    edges: d.graph.edges.map((e) => (e.id === edge.id ? { ...e, style } : e)),
  };
  return {
    kind: "applied",
    draft: { ...d, graph, fresh: [] },
    echo: [`Connection ${String(edgeNumber(edge))} is ${style}`],
  };
}

function reassign(d: DiagramDraft, edge: GEdge, fromText: string, toText: string): StepResult {
  const a = findNode(d, fromText);
  const b = findNode(d, toText);
  if (a?.kind !== "node" || b?.kind !== "node")
    return { kind: "nothing", echo: [`I couldn't find both ends: ${fromText}, ${toText}.`] };
  if (a.slug === b.slug)
    return { kind: "nothing", echo: ["A connection cannot go from a component to itself."] };
  const graph = {
    ...d.graph,
    edges: d.graph.edges.map((e) => (e.id === edge.id ? { ...e, from: a.slug, to: b.slug } : e)),
  };
  return {
    kind: "applied",
    draft: { ...d, graph, fresh: [] },
    echo: [`Connection ${String(edgeNumber(edge))}: ${label(d, a.slug)} → ${label(d, b.slug)}`],
  };
}

function ask(
  d: DiagramDraft,
  question: string,
  choices: { s: string; text: string }[],
  apply: (slug: string) => Graph,
): StepResult {
  return {
    kind: "ask",
    question,
    options: choices.map((c) => ({
      label: c.text,
      draft: { ...d, graph: apply(c.s), fresh: [] },
      echo: [c.text],
    })),
  };
}

// ----------------------------------------------------------------------------------------------- the entry point

/** Reads one utterance against a draft. Never throws: a failed step comes back as `nothing` with a reason. */
export function step(draft: DiagramDraft, utterance: string): StepResult {
  const raw = utterance.trim();
  if (raw.length === 0) return { kind: "nothing", echo: [] };
  try {
    const cmd = command(draft, raw);
    if (cmd) return cmd;
    if (draft.phase === "think") {
      return {
        kind: "applied",
        draft: { ...draft, scratch: [...draft.scratch, raw], fresh: [] },
        echo: [`Noted: ${raw.length > 70 ? `${raw.slice(0, 69)}…` : raw}`],
      };
    }
    if (draft.phase === "components") return readComponents(draft, raw);
    const connected = readConnections(draft, raw);
    if (connected.kind !== "unknown") return connected;
    // In Edit, a plain list of names still adds components when it cannot be a connection.
    return connected;
  } catch (error) {
    if (error instanceof GraphOpError) return { kind: "nothing", echo: [error.message] };
    throw error;
  }
}

/**
 * Takes a graph the model produced (a fix, or a drawing made from notes) as the new state of the draft: components it
 * already knew keep their numbers, new ones are numbered after them.
 */
export function adoptGraph(
  draft: DiagramDraft,
  graph: Graph,
  phase: Phase = draft.phase,
): DiagramDraft {
  const nodeNo: Record<string, number> = {};
  let next = draft.nextNo;
  const fresh: string[] = [];
  for (const n of graph.nodes) {
    const known = draft.nodeNo[n.id];
    if (known !== undefined) nodeNo[n.id] = known;
    else {
      nodeNo[n.id] = next++;
      fresh.push(n.id);
    }
  }
  return { graph, nodeNo, nextNo: next, phase, scratch: draft.scratch, fresh };
}

/** What a model's fix really changed, in plain words ("added Cache; 2 connections changed"); empty when nothing. */
export function graphChange(before: Graph, after: Graph): string {
  const parts: string[] = [];
  const nodesBefore = new Map(before.nodes.map((n) => [n.id, n]));
  const nodesAfter = new Set(after.nodes.map((n) => n.id));
  const added = after.nodes.filter((n) => !nodesBefore.has(n.id)).map((n) => n.label);
  const removed = before.nodes.filter((n) => !nodesAfter.has(n.id)).map((n) => n.label);
  if (added.length > 0) parts.push(`added ${added.join(", ")}`);
  if (removed.length > 0) parts.push(`removed ${removed.join(", ")}`);
  const renamed = after.nodes.filter((n) => {
    const old = nodesBefore.get(n.id);
    return old !== undefined && old.label !== n.label;
  });
  if (renamed.length > 0) parts.push(`renamed ${renamed.map((n) => n.label).join(", ")}`);
  const edgesBefore = new Map(before.edges.map((e) => [e.id, e]));
  const edgesAfter = new Set(after.edges.map((e) => e.id));
  const newEdges = after.edges.filter((e) => !edgesBefore.has(e.id)).length;
  const goneEdges = before.edges.filter((e) => !edgesAfter.has(e.id)).length;
  const alteredEdges = after.edges.filter((e) => {
    const old = edgesBefore.get(e.id);
    return (
      old !== undefined &&
      (old.from !== e.from ||
        old.to !== e.to ||
        old.label !== e.label ||
        old.style !== e.style ||
        old.arrow !== e.arrow)
    );
  }).length;
  const plural = (n: number) => `${String(n)} connection${n === 1 ? "" : "s"}`;
  if (newEdges > 0) parts.push(`added ${plural(newEdges)}`);
  if (goneEdges > 0) parts.push(`removed ${plural(goneEdges)}`);
  if (alteredEdges > 0) parts.push(`changed ${plural(alteredEdges)}`);
  return parts.join("; ");
}

/** What the model is told about the numbers the person is using ("node 2", "connection 3"). */
export function numberingHint(draft: DiagramDraft): string {
  const l = legend(draft);
  const nodes = l.nodes.map((n) => `${String(n.no)} = ${n.id} (${n.label})`).join("; ");
  const edges = l.edges
    .map(
      (e) =>
        `connection ${String(e.no)} = ${e.id} (${e.from} to ${e.to}${e.label ? `, "${e.label}"` : ""})`,
    )
    .join("; ");
  return [
    "The user is building this diagram step by step and refers to parts by number.",
    `Components: ${nodes || "none yet"}.`,
    `Connections: ${edges || "none yet"}.`,
  ].join("\n");
}
