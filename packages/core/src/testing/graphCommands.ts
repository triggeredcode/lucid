import fc from "fast-check";
import {
  ARROWS,
  EDGE_STYLES,
  NODE_KINDS,
  checkGraph,
  emptyGraph,
  type Graph,
  type GraphType,
} from "../model/graph";
import {
  addEdge,
  addNode,
  groupNodes,
  insertBetween,
  removeEdges,
  removeNodes,
  renameNode,
  reverseEdge,
  setEdgeLabel,
  setEdgeStatus,
  setMeta,
  setNodeStatus,
  ungroup,
  upsertEdge,
  upsertNode,
} from "../model/graphOps";

/**
 * Shared generator for graph tests: random commands over the graph ops, an interpreter that applies one, and
 * a seeded starting graph. Used by the op property tests and the LGN round-trip property.
 */

const IDS = ["a", "b", "c", "d", "e", "f", "g"] as const;
const LABELS = ["Alpha", "Beta", "check cache", "store result", "x".repeat(60)] as const;
const STATUSES = ["normal", "struck", "chosen", "hidden"] as const;

export type Cmd =
  | { k: "addNode"; id: number; kind: number }
  | { k: "upsertNode"; id: number; status: number; label: number }
  | { k: "rename"; at: number; label: number }
  | { k: "nodeStatus"; at: number; status: number }
  | { k: "addEdge"; a: number; b: number; style: number; arrow: number; label: number; seq: number }
  | { k: "upsertEdge"; a: number; b: number; style: number; arrow: number; label: number }
  | { k: "edgeStatus"; at: number; status: number }
  | { k: "edgeLabel"; at: number; label: number }
  | { k: "reverse"; at: number }
  | { k: "removeEdge"; at: number }
  | { k: "removeNode"; at: number }
  | { k: "insertBetween"; a: number; b: number; id: number; l1: number; l2: number }
  | { k: "group"; id: number; members: number[] }
  | { k: "ungroup"; at: number }
  | { k: "meta"; type: number; direction: number }
  | { k: "fragment"; from: number; to: number };

export const ALL_KINDS = [
  "addEdge",
  "addNode",
  "edgeLabel",
  "edgeStatus",
  "fragment",
  "group",
  "insertBetween",
  "meta",
  "nodeStatus",
  "removeEdge",
  "removeNode",
  "rename",
  "reverse",
  "ungroup",
  "upsertEdge",
  "upsertNode",
];

const n = (max: number) => fc.integer({ min: 0, max });
export const cmdArb: fc.Arbitrary<Cmd> = fc.oneof(
  fc.record({ k: fc.constant("addNode" as const), id: n(6), kind: n(NODE_KINDS.length - 1) }),
  fc.record({ k: fc.constant("upsertNode" as const), id: n(6), status: n(3), label: n(4) }),
  fc.record({ k: fc.constant("rename" as const), at: n(9), label: n(4) }),
  fc.record({ k: fc.constant("nodeStatus" as const), at: n(9), status: n(3) }),
  fc.record({
    k: fc.constant("addEdge" as const),
    a: n(9),
    b: n(9),
    style: n(2),
    arrow: n(2),
    label: n(5),
    seq: n(12),
  }),
  fc.record({
    k: fc.constant("upsertEdge" as const),
    a: n(9),
    b: n(9),
    style: n(2),
    arrow: n(2),
    label: n(5),
  }),
  fc.record({ k: fc.constant("edgeStatus" as const), at: n(14), status: n(3) }),
  fc.record({ k: fc.constant("edgeLabel" as const), at: n(14), label: n(5) }),
  fc.record({ k: fc.constant("reverse" as const), at: n(14) }),
  fc.record({ k: fc.constant("removeEdge" as const), at: n(14) }),
  fc.record({ k: fc.constant("removeNode" as const), at: n(9) }),
  fc.record({
    k: fc.constant("insertBetween" as const),
    a: n(9),
    b: n(9),
    id: n(6),
    l1: n(5),
    l2: n(5),
  }),
  fc.record({
    k: fc.constant("group" as const),
    id: n(6),
    members: fc.array(n(9), { maxLength: 4 }),
  }),
  fc.record({ k: fc.constant("ungroup" as const), at: n(4) }),
  fc.record({ k: fc.constant("meta" as const), type: n(2), direction: n(1) }),
  fc.record({ k: fc.constant("fragment" as const), from: n(12), to: n(12) }),
);

const pick = <T>(items: readonly T[], i: number): T | undefined =>
  items.length === 0 ? undefined : items[i % items.length];
/** Existing node id when there is one, otherwise a made-up id (so errors are exercised too). */
const nodeId = (g: Graph, i: number): string => pick(g.nodes, i)?.id ?? "ghost";
const edgeId = (g: Graph, i: number): string => pick(g.edges, i)?.id ?? "e99";
const optionalLabel = (i: number): string | undefined =>
  i >= LABELS.length ? undefined : LABELS[i];

export function applyCmd(g: Graph, cmd: Cmd): Graph {
  switch (cmd.k) {
    case "addNode":
      return addNode(g, {
        id: IDS[cmd.id] ?? "a",
        label: "Node",
        kind: NODE_KINDS[cmd.kind] ?? "process",
      });
    case "upsertNode":
      return upsertNode(g, {
        id: IDS[cmd.id] ?? "a",
        status: STATUSES[cmd.status] ?? "normal",
        label: LABELS[cmd.label] ?? "L",
      });
    case "rename":
      return renameNode(g, nodeId(g, cmd.at), LABELS[cmd.label] ?? "L");
    case "nodeStatus":
      return setNodeStatus(g, nodeId(g, cmd.at), STATUSES[cmd.status] ?? "normal");
    case "addEdge": {
      const label = optionalLabel(cmd.label);
      return addEdge(g, {
        from: nodeId(g, cmd.a),
        to: nodeId(g, cmd.b),
        style: EDGE_STYLES[cmd.style] ?? "solid",
        arrow: ARROWS[cmd.arrow] ?? "directed",
        ...(label === undefined ? {} : { label }),
        ...(cmd.seq > 0 && g.type === "sequence" ? { seq: cmd.seq } : {}),
      });
    }
    case "upsertEdge": {
      const label = optionalLabel(cmd.label);
      return upsertEdge(g, {
        from: nodeId(g, cmd.a),
        to: nodeId(g, cmd.b),
        style: EDGE_STYLES[cmd.style] ?? "solid",
        arrow: ARROWS[cmd.arrow] ?? "directed",
        ...(label === undefined ? {} : { label }),
      });
    }
    case "edgeStatus":
      return setEdgeStatus(g, edgeId(g, cmd.at), STATUSES[cmd.status] ?? "normal");
    case "edgeLabel": {
      const label = optionalLabel(cmd.label);
      return setEdgeLabel(g, edgeId(g, cmd.at), label ?? null);
    }
    case "reverse":
      return reverseEdge(g, edgeId(g, cmd.at));
    case "removeEdge":
      return removeEdges(g, [edgeId(g, cmd.at)]);
    case "removeNode":
      return removeNodes(g, [nodeId(g, cmd.at)]);
    case "insertBetween":
      return insertBetween(
        g,
        nodeId(g, cmd.a),
        nodeId(g, cmd.b),
        { id: IDS[cmd.id] ?? "a", label: "Inserted" },
        [optionalLabel(cmd.l1), optionalLabel(cmd.l2)],
      );
    case "group":
      return groupNodes(g, {
        id: IDS[cmd.id] ?? "a",
        label: "Group",
        members: cmd.members.map((m) => nodeId(g, m)),
      });
    case "ungroup":
      return ungroup(g, pick(g.groups, cmd.at)?.id ?? "nope");
    case "meta": {
      const type: GraphType = (["flowchart", "sequence", "er"] as const)[cmd.type] ?? "flowchart";
      return setMeta(g, { type, direction: cmd.direction === 0 ? "LR" : "TB" });
    }
    case "fragment": {
      // Harness helper (there is no fragment op yet): add a fragment when it keeps the graph valid.
      if (g.type !== "sequence") return g;
      const lo = Math.min(cmd.from, cmd.to) + 1;
      const hi = Math.max(cmd.from, cmd.to) + 1;
      const candidate: Graph = {
        ...g,
        fragments: [
          ...g.fragments,
          {
            id: `f${String(g.fragments.length + 1)}`,
            kind: "alt",
            branches: [{ label: "x", fromSeq: lo, toSeq: hi }],
          },
        ],
      };
      return checkGraph(candidate).length === 0 ? candidate : g;
    }
  }
}

/** A small starting graph so most random commands have something to act on. */
export function seedGraph(type: GraphType): Graph {
  let g = emptyGraph(type);
  for (const id of ["a", "b", "c", "d"]) g = addNode(g, { id, label: id.toUpperCase() });
  for (const [from, to] of [
    ["a", "b"],
    ["b", "c"],
    ["c", "d"],
  ] as const)
    g = addEdge(g, { from, to });
  return g;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
