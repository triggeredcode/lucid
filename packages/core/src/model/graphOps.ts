import { nextNumberedId } from "./ids";
import {
  SLUG_PATTERN,
  assertGraph,
  type Arrow,
  type Direction,
  type EdgeStyle,
  type GEdge,
  type GGroup,
  type GNode,
  type GraphStatus,
  type Graph,
  type GraphType,
  type NodeKind,
  type SeqFragment,
} from "./graph";

/**
 * Pure graph edits. Every function returns a new Graph and never mutates its
 * input. Invalid requests throw a GraphOpError and leave the caller's graph untouched, so a failed op can
 * simply be discarded. The result of every successful op satisfies invariants G1-G6 (asserted before return).
 */

export type GraphOpErrorCode =
  "duplicate_id" | "unknown_node" | "unknown_edge" | "unknown_group" | "no_such_edge" | "invalid";

export class GraphOpError extends Error {
  readonly code: GraphOpErrorCode;
  constructor(code: GraphOpErrorCode, message: string) {
    super(message);
    this.name = "GraphOpError";
    this.code = code;
  }
}

export interface NodeSpec {
  id: string;
  label: string;
  kind?: NodeKind;
  status?: GraphStatus;
  note?: string;
}

export interface NodePatch {
  id: string;
  label?: string;
  kind?: NodeKind;
  status?: GraphStatus;
  note?: string;
}

export interface EdgeSpec {
  from: string;
  to: string;
  label?: string;
  arrow?: Arrow;
  style?: EdgeStyle;
  status?: GraphStatus;
  /** Sequence diagrams: insert at this message position (1-based). Default: append. */
  seq?: number;
}

export interface GroupSpec {
  id: string;
  label: string;
  members: string[];
  status?: GGroup["status"];
}

/** `web_server` becomes `Web Server`. Used when an edge mentions a node that was never declared. */
export function titleCase(id: string): string {
  return id
    .split("_")
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const finish = (graph: Graph): Graph => {
  assertGraph(graph);
  return graph;
};

function requireSlug(id: string): void {
  if (!SLUG_PATTERN.test(id)) {
    throw new GraphOpError(
      "invalid",
      `"${id}" is not a valid id (use lowercase letters, digits and _)`,
    );
  }
}

function requireNode(graph: Graph, id: string): GNode {
  const found = graph.nodes.find((n) => n.id === id);
  if (!found) throw new GraphOpError("unknown_node", `unknown node "${id}"`);
  return found;
}

function requireEdge(graph: Graph, id: string): GEdge {
  const found = graph.edges.find((e) => e.id === id);
  if (!found) throw new GraphOpError("unknown_edge", `unknown edge "${id}"`);
  return found;
}

const isSequence = (g: Graph): boolean => g.type === "sequence";

/** Edges in message order (sequence) or array order (everything else). */
function ordered(graph: Graph): GEdge[] {
  return isSequence(graph)
    ? [...graph.edges].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    : [...graph.edges];
}

/**
 * Room for one more message at `position` in a sequence diagram: later messages shift down and any
 * fragment containing or following the position grows or shifts with them.
 */
function makeRoomForMessage(graph: Graph, position: number): Graph {
  const shift = (n: number, strictlyAfter: boolean) =>
    strictlyAfter ? n > position : n >= position;
  return {
    ...graph,
    edges: graph.edges.map((e) =>
      e.seq !== undefined && e.seq >= position ? { ...e, seq: e.seq + 1 } : e,
    ),
    fragments: graph.fragments.map((f) => ({
      ...f,
      branches: f.branches.map((b) => ({
        ...b,
        fromSeq: shift(b.fromSeq, true) ? b.fromSeq + 1 : b.fromSeq,
        toSeq: shift(b.toSeq, false) ? b.toSeq + 1 : b.toSeq,
      })),
    })),
  };
}

/** After removing messages from a sequence diagram: renumber 1..n and keep fragments around survivors. */
function compactSequence(graph: Graph, removedIds: ReadonlySet<string>): Graph {
  if (!isSequence(graph)) return graph;
  const before = ordered(graph);
  const survivors = before.filter((e) => !removedIds.has(e.id));
  const newSeq = new Map<number, number>();
  survivors.forEach((e, i) => {
    if (e.seq !== undefined) newSeq.set(e.seq, i + 1);
  });
  const fragments: SeqFragment[] = [];
  for (const f of graph.fragments) {
    const branches = f.branches.flatMap((b) => {
      const inside = [...newSeq.entries()]
        .filter(([oldSeq]) => oldSeq >= b.fromSeq && oldSeq <= b.toSeq)
        .map(([, n]) => n);
      return inside.length === 0
        ? []
        : [{ ...b, fromSeq: Math.min(...inside), toSeq: Math.max(...inside) }];
    });
    if (branches.length > 0) fragments.push({ ...f, branches });
  }
  return {
    ...graph,
    edges: survivors.map((e, i) => ({ ...e, seq: i + 1 })),
    fragments,
  };
}

export function addNode(graph: Graph, spec: NodeSpec): Graph {
  requireSlug(spec.id);
  if (graph.nodes.some((n) => n.id === spec.id) || graph.groups.some((g) => g.id === spec.id)) {
    throw new GraphOpError("duplicate_id", `"${spec.id}" already exists`);
  }
  const node: GNode = {
    id: spec.id,
    label: spec.label,
    kind: spec.kind ?? "process",
    status: spec.status ?? "normal",
    ...(spec.note === undefined ? {} : { note: spec.note }),
  };
  return finish({ ...graph, nodes: [...graph.nodes, node] });
}

/** Update only the fields given when the node exists; create it (with sensible defaults) otherwise. */
export function upsertNode(graph: Graph, patch: NodePatch): Graph {
  const existing = graph.nodes.find((n) => n.id === patch.id);
  if (!existing) {
    return addNode(graph, {
      id: patch.id,
      label: patch.label ?? titleCase(patch.id),
      ...(patch.kind === undefined ? {} : { kind: patch.kind }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.note === undefined ? {} : { note: patch.note }),
    });
  }
  const updated: GNode = {
    ...existing,
    ...(patch.label === undefined ? {} : { label: patch.label }),
    ...(patch.kind === undefined ? {} : { kind: patch.kind }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
    ...(patch.note === undefined ? {} : { note: patch.note }),
  };
  return finish({ ...graph, nodes: graph.nodes.map((n) => (n.id === patch.id ? updated : n)) });
}

export function renameNode(graph: Graph, id: string, label: string): Graph {
  requireNode(graph, id);
  return upsertNode(graph, { id, label });
}

export function setNodeStatus(graph: Graph, id: string, status: GraphStatus): Graph {
  requireNode(graph, id);
  return upsertNode(graph, { id, status });
}

function buildEdge(graph: Graph, spec: EdgeSpec, id: string, seq: number | undefined): GEdge {
  return {
    id,
    from: spec.from,
    to: spec.to,
    ...(spec.label === undefined ? {} : { label: spec.label }),
    arrow: spec.arrow ?? "directed",
    style: spec.style ?? "solid",
    status: spec.status ?? "normal",
    ...(isSequence(graph) && seq !== undefined ? { seq } : {}),
  };
}

export function addEdge(graph: Graph, spec: EdgeSpec): Graph {
  requireNode(graph, spec.from);
  requireNode(graph, spec.to);
  const id = nextNumberedId(
    "e",
    graph.edges.map((e) => e.id),
  );
  if (!isSequence(graph)) {
    return finish({ ...graph, edges: [...graph.edges, buildEdge(graph, spec, id, undefined)] });
  }
  const count = graph.edges.length;
  const position = spec.seq ?? count + 1;
  if (position < 1 || position > count + 1) {
    throw new GraphOpError("invalid", `seq ${String(position)} is outside 1..${String(count + 1)}`);
  }
  const room = position <= count ? makeRoomForMessage(graph, position) : graph;
  return finish({ ...room, edges: [...room.edges, buildEdge(room, spec, id, position)] });
}

/**
 * `a -> b: label` semantics for graph.patch:
 * - If an a->b edge exists whose label is the same, or either side has no label, update it in place.
 * - Else if the new edge is bidirectional and a b->a edge exists, upgrade that edge to bidirectional.
 * - Else add a new edge. Two edges with different labels between the same pair are kept as parallel
 *   edges (e.g. "check cache" and "store result" from the web server to Redis).
 * Sequence diagrams always add: repeated messages between the same participants are normal.
 */
export function upsertEdge(graph: Graph, spec: EdgeSpec): Graph {
  requireNode(graph, spec.from);
  requireNode(graph, spec.to);
  if (isSequence(graph)) return addEdge(graph, spec);

  const compatible = (e: GEdge) =>
    spec.label === undefined || e.label === undefined || e.label === spec.label;
  const same = graph.edges.find((e) => e.from === spec.from && e.to === spec.to && compatible(e));
  const reverse =
    same === undefined && spec.arrow === "bidirectional"
      ? graph.edges.find((e) => e.from === spec.to && e.to === spec.from && compatible(e))
      : undefined;
  const target = same ?? reverse;
  if (!target) return addEdge(graph, spec);

  const updated: GEdge = {
    ...target,
    ...(spec.label === undefined ? {} : { label: spec.label }),
    ...(spec.arrow === undefined ? {} : { arrow: spec.arrow }),
    ...(spec.style === undefined ? {} : { style: spec.style }),
    ...(spec.status === undefined ? {} : { status: spec.status }),
  };
  return finish({ ...graph, edges: graph.edges.map((e) => (e.id === target.id ? updated : e)) });
}

export function setEdgeStatus(graph: Graph, id: string, status: GraphStatus): Graph {
  requireEdge(graph, id);
  return finish({ ...graph, edges: graph.edges.map((e) => (e.id === id ? { ...e, status } : e)) });
}

export function setEdgeLabel(graph: Graph, id: string, label: string | null): Graph {
  requireEdge(graph, id);
  return finish({
    ...graph,
    edges: graph.edges.map((e) => {
      if (e.id !== id) return e;
      const { label: _old, ...rest } = e;
      return label === null ? rest : { ...rest, label };
    }),
  });
}

export function reverseEdge(graph: Graph, id: string): Graph {
  requireEdge(graph, id);
  return finish({
    ...graph,
    edges: graph.edges.map((e) => (e.id === id ? { ...e, from: e.to, to: e.from } : e)),
  });
}

export function removeEdges(graph: Graph, ids: readonly string[]): Graph {
  for (const id of ids) requireEdge(graph, id);
  const gone = new Set(ids);
  return finish(
    isSequence(graph)
      ? compactSequence(graph, gone)
      : { ...graph, edges: graph.edges.filter((e) => !gone.has(e.id)) },
  );
}

/** Removes the nodes, every edge touching them, and their group memberships (empty groups disappear). */
export function removeNodes(graph: Graph, ids: readonly string[]): Graph {
  for (const id of ids) requireNode(graph, id);
  const gone = new Set(ids);
  const goneEdges = new Set(
    graph.edges.filter((e) => gone.has(e.from) || gone.has(e.to)).map((e) => e.id),
  );
  const withoutEdges = removeEdges(graph, [...goneEdges]);
  return finish({
    ...withoutEdges,
    nodes: withoutEdges.nodes.filter((n) => !gone.has(n.id)),
    groups: withoutEdges.groups
      .map((g) => ({ ...g, members: g.members.filter((m) => !gone.has(m)) }))
      .filter((g) => g.members.length > 0),
  });
}

/**
 * "Add a CDN between the client and the web server": replace every from->to edge by from->node and
 * node->to. Both new edges get fresh ids and sit where the original was. The first keeps the original's
 * label unless `labels[0]` is given, the second takes `labels[1]` (default: no label). Arrow, style and
 * status carry over. Undirected and bidirectional edges match in either orientation (they have none).
 * If from and to share a group, the new node joins it.
 */
export function insertBetween(
  graph: Graph,
  from: string,
  to: string,
  node: NodeSpec,
  labels: readonly [string | undefined, string | undefined] = [undefined, undefined],
): Graph {
  requireNode(graph, from);
  requireNode(graph, to);
  const matches = ordered(graph).filter(
    (e) =>
      (e.from === from && e.to === to) ||
      (e.arrow !== "directed" && e.from === to && e.to === from),
  );
  if (matches.length === 0) {
    throw new GraphOpError("no_such_edge", `there is no edge between "${from}" and "${to}"`);
  }
  let next = addNode(graph, node);
  const sharedGroup = next.groups.find((g) => g.members.includes(from) && g.members.includes(to));
  if (sharedGroup) {
    next = {
      ...next,
      groups: next.groups.map((g) =>
        g.id === sharedGroup.id ? { ...g, members: [...g.members, node.id] } : g,
      ),
    };
  }
  // Highest message number first, so earlier positions are not moved by later insertions.
  const work = isSequence(next) ? [...matches].reverse() : matches;
  for (const original of work) {
    const position = original.seq;
    // Sequence: open one extra slot at `position` (the original moves to position + 1, fragments follow).
    let g = isSequence(next) && position !== undefined ? makeRoomForMessage(next, position) : next;
    const index = g.edges.findIndex((e) => e.id === original.id);
    const rest = g.edges.filter((e) => e.id !== original.id);
    const firstLabel = labels[0] ?? original.label;
    const firstId = nextNumberedId(
      "e",
      rest.map((e) => e.id),
    );
    const secondId = nextNumberedId("e", [...rest.map((e) => e.id), firstId]);
    const shared = { arrow: original.arrow, style: original.style, status: original.status };
    const first = buildEdge(
      g,
      { from, to: node.id, ...(firstLabel === undefined ? {} : { label: firstLabel }), ...shared },
      firstId,
      position,
    );
    const second = buildEdge(
      g,
      { from: node.id, to, ...(labels[1] === undefined ? {} : { label: labels[1] }), ...shared },
      secondId,
      position === undefined ? undefined : position + 1,
    );
    g = { ...g, edges: [...rest.slice(0, index), first, second, ...rest.slice(index)] };
    next = g;
  }
  return finish(next);
}

/** Create or replace a group. Members are moved out of any other group; groups left empty disappear. */
export function groupNodes(graph: Graph, spec: GroupSpec): Graph {
  requireSlug(spec.id);
  if (graph.nodes.some((n) => n.id === spec.id)) {
    throw new GraphOpError("duplicate_id", `"${spec.id}" is already a node id`);
  }
  for (const m of spec.members) requireNode(graph, m);
  const members = [...new Set(spec.members)];
  if (members.length === 0) {
    throw new GraphOpError("invalid", "a group needs at least one member");
  }
  const moved = new Set(members);
  const others = graph.groups
    .filter((g) => g.id !== spec.id)
    .map((g) => ({ ...g, members: g.members.filter((m) => !moved.has(m)) }))
    .filter((g) => g.members.length > 0);
  const group: GGroup = {
    id: spec.id,
    label: spec.label,
    members,
    status: spec.status ?? "normal",
  };
  return finish({ ...graph, groups: [...others, group] });
}

export function ungroup(graph: Graph, id: string): Graph {
  if (!graph.groups.some((g) => g.id === id)) {
    throw new GraphOpError("unknown_group", `unknown group "${id}"`);
  }
  return finish({ ...graph, groups: graph.groups.filter((g) => g.id !== id) });
}

export interface MetaPatch {
  direction?: Direction;
  /** `null` clears the title. */
  title?: string | null;
  type?: GraphType;
}

export function setMeta(graph: Graph, patch: MetaPatch): Graph {
  let next: Graph = {
    ...graph,
    ...(patch.direction === undefined ? {} : { direction: patch.direction }),
  };
  if (patch.title !== undefined) {
    const { title: _old, ...rest } = next;
    next = patch.title === null ? rest : { ...rest, title: patch.title };
  }
  if (patch.type !== undefined && patch.type !== graph.type) {
    if (patch.type === "sequence") {
      next = {
        ...next,
        type: "sequence",
        edges: next.edges.map((e, i) => ({ ...e, seq: i + 1 })),
        fragments: [],
      };
    } else {
      next = {
        ...next,
        type: patch.type,
        edges: next.edges.map((e) => {
          const { seq: _seq, ...rest } = e;
          return rest;
        }),
        fragments: [],
      };
    }
  }
  return finish(next);
}
