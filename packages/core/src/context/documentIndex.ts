import { ChartSchema, type Chart } from "../model/chart";
import { type Block, type BlockType, type Inline, type LucidDoc } from "../model/doc";
import { GraphSchema, type Graph } from "../model/graph";
import { TableSchema, type Table } from "../model/table";

export interface IndexedBlock {
  id: string;
  type: BlockType;
  parentId: string | null;
  sectionId: string | null;
  depth: number;
  order: number;
  summary: string;
}

export interface IndexedSection {
  /** The heading block id. */
  id: string;
  headingId: string;
  parentSectionId: string | null;
  level: number;
  title: string;
  start: number;
  endExclusive: number;
  blockIds: string[];
}

export type IndexedComponentKind = "table" | "chart" | "diagram";

export interface IndexedComponent {
  /** Stable while the source block exists: component blocks use their document block id. */
  id: string;
  blockId: string;
  kind: IndexedComponentKind;
  summary: string;
  /** Deterministic, namespaced references for addressable parts of the component. */
  partIds: string[];
}

export interface IndexedRelationship {
  id: string;
  diagramId: string;
  kind: "edge" | "group-member";
  fromId: string;
  toId: string;
  label: string;
}

export interface DocumentContextIndex {
  blocks: IndexedBlock[];
  sections: IndexedSection[];
  components: IndexedComponent[];
  relationships: IndexedRelationship[];
  /** Existing block ids only, newest first. */
  recentTouched: string[];
}

interface FlatBlock {
  block: Block;
  parentId: string | null;
  depth: number;
  order: number;
}

const MAX_SUMMARY = 160;
const MAX_RECENT = 20;

const clean = (value: string): string => value.replace(/\s+/g, " ").trim();
const clipped = (value: string): string => {
  const text = clean(value);
  return text.length <= MAX_SUMMARY ? text : `${text.slice(0, MAX_SUMMARY - 1).trimEnd()}…`;
};

const inlineText = (content: readonly Inline[] | undefined): string =>
  (content ?? [])
    .map((inline) =>
      inline.type === "text"
        ? inline.text
        : inline.type === "link"
          ? inline.content.map((part) => part.text).join("")
          : inline.latex,
    )
    .join("");

function flatten(doc: LucidDoc): FlatBlock[] {
  const out: FlatBlock[] = [];
  const visit = (blocks: readonly Block[], parentId: string | null, depth: number) => {
    blocks.forEach((block) => {
      out.push({ block, parentId, depth, order: out.length });
      if (block.children) visit(block.children, block.id, depth + 1);
    });
  };
  visit(doc.blocks, null, 0);
  return out;
}

function parsedTable(block: Block): Table | undefined {
  const parsed = TableSchema.safeParse(block.props["table"]);
  return parsed.success ? parsed.data : undefined;
}

function parsedChart(block: Block): Chart | undefined {
  const parsed = ChartSchema.safeParse(block.props["chart"]);
  return parsed.success ? parsed.data : undefined;
}

function parsedGraph(block: Block): Graph | undefined {
  const parsed = GraphSchema.safeParse(block.props["graph"]);
  return parsed.success ? parsed.data : undefined;
}

function blockSummary(block: Block): string {
  const text = inlineText(block.content);
  const title = typeof block.props["title"] === "string" ? block.props["title"] : "";
  const caption = typeof block.props["caption"] === "string" ? block.props["caption"] : "";
  const code = typeof block.props["code"] === "string" ? block.props["code"] : "";
  const latex = typeof block.props["latex"] === "string" ? block.props["latex"] : "";
  const table = parsedTable(block);
  const chart = parsedChart(block);
  const graph = parsedGraph(block);
  const structural = table
    ? [
        `${String(table.rows.length)} rows × ${String(table.columns.length)} columns`,
        ...table.columns.map((column) => column.name),
        ...table.rows.map((row) => row.cells[0] ?? ""),
      ]
        .filter(Boolean)
        .join("; ")
    : chart
      ? [chart.title, ...chart.series.map((series) => series.name)].filter(Boolean).join("; ")
      : graph
        ? [graph.title ?? "", ...graph.nodes.map((node) => node.label)].filter(Boolean).join("; ")
        : "";
  return clipped([text, title, caption, code, latex, structural].filter(Boolean).join(" — "));
}

function componentOf(block: Block): IndexedComponent | undefined {
  if (block.type === "table") {
    const table = parsedTable(block);
    if (!table) return undefined;
    return {
      id: block.id,
      blockId: block.id,
      kind: "table",
      summary: blockSummary(block),
      partIds: [
        ...table.columns.map((column) => `${block.id}:column:${column.id}`),
        ...table.rows.map((row) => `${block.id}:row:${row.id}`),
      ],
    };
  }
  if (block.type === "chart") {
    const chart = parsedChart(block);
    if (!chart) return undefined;
    return {
      id: block.id,
      blockId: block.id,
      kind: "chart",
      summary: blockSummary(block),
      partIds: [
        ...chart.categories.map((_, index) => `${block.id}:category:${String(index + 1)}`),
        ...chart.series.map((_, index) => `${block.id}:series:${String(index + 1)}`),
      ],
    };
  }
  if (block.type === "diagram") {
    const graph = parsedGraph(block);
    if (!graph) return undefined;
    return {
      id: block.id,
      blockId: block.id,
      kind: "diagram",
      summary: blockSummary(block),
      partIds: [
        ...graph.nodes.map((node) => `${block.id}:node:${node.id}`),
        ...graph.edges.map((edge) => `${block.id}:edge:${edge.id}`),
        ...graph.groups.map((group) => `${block.id}:group:${group.id}`),
      ],
    };
  }
  return undefined;
}

function relationshipsOf(block: Block): IndexedRelationship[] {
  const graph = block.type === "diagram" ? parsedGraph(block) : undefined;
  if (!graph) return [];
  const relationships: IndexedRelationship[] = graph.edges.map((edge) => ({
    id: `${block.id}:edge:${edge.id}`,
    diagramId: block.id,
    kind: "edge",
    fromId: `${block.id}:node:${edge.from}`,
    toId: `${block.id}:node:${edge.to}`,
    label: edge.label ?? "",
  }));
  for (const group of graph.groups) {
    for (const member of group.members) {
      relationships.push({
        id: `${block.id}:group:${group.id}:member:${member}`,
        diagramId: block.id,
        kind: "group-member",
        fromId: `${block.id}:group:${group.id}`,
        toId: `${block.id}:node:${member}`,
        label: group.label,
      });
    }
  }
  return relationships;
}

/** Build disposable context metadata directly from the canonical document. */
export function buildDocumentContextIndex(
  doc: LucidDoc,
  recentTouched: readonly string[] = [],
): DocumentContextIndex {
  const flat = flatten(doc);
  const existing = new Set(flat.map(({ block }) => block.id));
  const sections: IndexedSection[] = [];
  const active: IndexedSection[] = [];
  const blocks: IndexedBlock[] = [];
  const components: IndexedComponent[] = [];
  const relationships: IndexedRelationship[] = [];

  for (const entry of flat) {
    const { block } = entry;
    if (block.type === "heading") {
      const rawLevel = block.props["level"];
      const level = rawLevel === 2 || rawLevel === 3 ? rawLevel : 1;
      while ((active.at(-1)?.level ?? 0) >= level) active.pop();
      const section: IndexedSection = {
        id: block.id,
        headingId: block.id,
        parentSectionId: active.at(-1)?.id ?? null,
        level,
        title: clipped(inlineText(block.content)),
        start: entry.order,
        endExclusive: entry.order + 1,
        blockIds: [],
      };
      sections.push(section);
      active.push(section);
    }
    for (const section of active) {
      section.blockIds.push(block.id);
      section.endExclusive = entry.order + 1;
    }
    blocks.push({
      id: block.id,
      type: block.type,
      parentId: entry.parentId,
      sectionId: active.at(-1)?.id ?? null,
      depth: entry.depth,
      order: entry.order,
      summary: blockSummary(block),
    });
    const component = componentOf(block);
    if (component) components.push(component);
    relationships.push(...relationshipsOf(block));
  }

  const touched: string[] = [];
  for (const id of recentTouched) {
    if (existing.has(id) && !touched.includes(id)) touched.push(id);
    if (touched.length === MAX_RECENT) break;
  }
  return { blocks, sections, components, relationships, recentTouched: touched };
}

const stableValue = (value: unknown): string => {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableValue(object[key])}`)
    .join(",")}}`;
};

interface ComparableBlock {
  parentId: string | null;
  value: string;
}

const comparableBlocks = (doc: LucidDoc): Map<string, ComparableBlock> =>
  new Map(
    flatten(doc).map(({ block, parentId }) => [
      block.id,
      {
        parentId,
        value: stableValue({ ...block, children: undefined }),
      },
    ]),
  );

function childIdsByParent(doc: LucidDoc): Map<string | null, string[]> {
  const result = new Map<string | null, string[]>();
  const visit = (blocks: readonly Block[], parentId: string | null) => {
    result.set(
      parentId,
      blocks.map((block) => block.id),
    );
    for (const block of blocks) if (block.children) visit(block.children, block.id);
  };
  visit(doc.blocks, null);
  return result;
}

/** Ids in one sibling list that form a longest increasing subsequence of their old positions. */
function unchangedOrder(oldIds: readonly string[], newIds: readonly string[]): Set<string> {
  const oldPosition = new Map(oldIds.map((id, index) => [id, index]));
  const ids = newIds.filter((id) => oldPosition.has(id));
  const tails: number[] = [];
  const tailAt: number[] = [];
  const previous = ids.map(() => -1);
  ids.forEach((id, index) => {
    const position = oldPosition.get(id) as number;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((tails[middle] as number) < position) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tailAt[low - 1] as number;
    tails[low] = position;
    tailAt[low] = index;
  });
  const result = new Set<string>();
  let cursor = tailAt.at(-1) ?? -1;
  while (cursor >= 0) {
    result.add(ids[cursor] as string);
    cursor = previous[cursor] as number;
  }
  return result;
}

/** Existing ids whose content or position changed, plus inserted ids, in current document order. */
export function changedBlockIds(previous: LucidDoc, next: LucidDoc): string[] {
  const before = comparableBlocks(previous);
  const after = comparableBlocks(next);
  const changed = new Set<string>();
  for (const { block } of flatten(next)) {
    const old = before.get(block.id);
    const current = after.get(block.id);
    if (!old || !current || old.parentId !== current.parentId || old.value !== current.value)
      changed.add(block.id);
  }
  const oldChildren = childIdsByParent(previous);
  const newChildren = childIdsByParent(next);
  for (const [parentId, newIds] of newChildren) {
    const commonOld = (oldChildren.get(parentId) ?? []).filter(
      (id) => after.get(id)?.parentId === parentId,
    );
    const commonNew = newIds.filter((id) => before.get(id)?.parentId === parentId);
    const stable = unchangedOrder(commonOld, commonNew);
    for (const id of commonNew) if (!stable.has(id)) changed.add(id);
  }
  return flatten(next)
    .map(({ block }) => block.id)
    .filter((id) => changed.has(id));
}

/**
 * In-memory lifecycle wrapper. It never persists document data: every update rebuilds from LucidDoc,
 * which also guarantees that removed or otherwise stale ids disappear.
 */
export class DocumentContextIndexStore {
  private document: LucidDoc;
  private value: DocumentContextIndex;

  constructor(doc: LucidDoc) {
    this.document = doc;
    this.value = buildDocumentContextIndex(doc);
  }

  get current(): DocumentContextIndex {
    return this.value;
  }

  /** A newly loaded document starts with no touch history from the previous lifecycle. */
  load(doc: LucidDoc): DocumentContextIndex {
    this.document = doc;
    this.value = buildDocumentContextIndex(doc);
    return this.value;
  }

  update(doc: LucidDoc, touched: readonly string[] = []): DocumentContextIndex {
    const inferred = changedBlockIds(this.document, doc);
    this.value = buildDocumentContextIndex(doc, [
      ...touched,
      ...inferred,
      ...this.value.recentTouched,
    ]);
    this.document = doc;
    return this.value;
  }
}
