import { z } from "zod";
import { StatusSchema } from "./status";

/**
 * Diagram model. Pure data: Mermaid text is compiled from it, never stored.
 * Node and group ids are slugs chosen by the model or user; edge ids (`e1`, `e2`, ...) are assigned by
 * the model layer (`nextNumberedId`), never by the LLM (rule G6).
 */

export const GRAPH_TYPES = ["flowchart", "sequence", "er"] as const;
export const GraphTypeSchema = z.enum(GRAPH_TYPES);
export type GraphType = z.infer<typeof GraphTypeSchema>;

export const DIRECTIONS = ["LR", "TB"] as const;
export const DirectionSchema = z.enum(DIRECTIONS);
export type Direction = z.infer<typeof DirectionSchema>;

export const NODE_KINDS = [
  "actor",
  "client",
  "service",
  "gateway",
  "loadbalancer",
  "datastore",
  "cache",
  "queue",
  "cdn",
  "external",
  "decision",
  "process",
  "storage",
  "note",
] as const;
export const NodeKindSchema = z.enum(NODE_KINDS);
export type NodeKind = z.infer<typeof NodeKindSchema>;

/** Nodes and edges may additionally be hidden; groups may only be struck. */
export const GraphStatusSchema = z.enum([...StatusSchema.options, "hidden"]);
export type GraphStatus = z.infer<typeof GraphStatusSchema>;
export const GroupStatusSchema = z.enum(["normal", "struck"]);

export const ARROWS = ["directed", "undirected", "bidirectional"] as const;
export const ArrowSchema = z.enum(ARROWS);
export type Arrow = z.infer<typeof ArrowSchema>;

/** dashed = conditional or asynchronous, dotted = optional. */
export const EDGE_STYLES = ["solid", "dashed", "dotted"] as const;
export const EdgeStyleSchema = z.enum(EDGE_STYLES);
export type EdgeStyle = z.infer<typeof EdgeStyleSchema>;

export const SLUG_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
export const SlugSchema = z.string().regex(SLUG_PATTERN, "must match [a-z][a-z0-9_]{0,31}");
export const EDGE_ID_PATTERN = /^e\d+$/;

export const MAX_LABEL_LENGTH = 60;
/** G5: non-empty, single line, at most 60 characters (longer text belongs in `note`). */
export const LabelSchema = z
  .string()
  .min(1)
  .max(MAX_LABEL_LENGTH)
  .regex(/^[^\r\n]*$/, "must be a single line");

export const GNodeSchema = z.strictObject({
  id: SlugSchema,
  label: LabelSchema,
  kind: NodeKindSchema,
  status: GraphStatusSchema,
  note: z.string().optional(),
});
export type GNode = z.infer<typeof GNodeSchema>;

export const GEdgeSchema = z.strictObject({
  id: z.string().regex(EDGE_ID_PATTERN, "must look like e1, e2, ..."),
  from: SlugSchema,
  to: SlugSchema,
  label: LabelSchema.optional(),
  arrow: ArrowSchema,
  style: EdgeStyleSchema,
  status: GraphStatusSchema,
  /** Sequence diagrams only: 1-based message order. */
  seq: z.number().int().min(1).optional(),
});
export type GEdge = z.infer<typeof GEdgeSchema>;

export const GGroupSchema = z.strictObject({
  id: SlugSchema,
  label: LabelSchema,
  members: z.array(SlugSchema),
  status: GroupStatusSchema,
});
export type GGroup = z.infer<typeof GGroupSchema>;

export const FRAGMENT_KINDS = ["alt", "opt", "loop", "par"] as const;
export const SeqFragmentSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(FRAGMENT_KINDS),
  branches: z
    .array(
      z.strictObject({
        label: z.string(),
        fromSeq: z.number().int().min(1),
        toSeq: z.number().int().min(1),
      }),
    )
    .min(1),
});
export type SeqFragment = z.infer<typeof SeqFragmentSchema>;

export const GraphSchema = z.strictObject({
  type: GraphTypeSchema,
  direction: DirectionSchema,
  title: z.string().optional(),
  nodes: z.array(GNodeSchema),
  edges: z.array(GEdgeSchema),
  groups: z.array(GGroupSchema),
  fragments: z.array(SeqFragmentSchema),
});
export type Graph = z.infer<typeof GraphSchema>;

export function emptyGraph(type: GraphType = "flowchart", direction: Direction = "LR"): Graph {
  return { type, direction, nodes: [], edges: [], groups: [], fragments: [] };
}

export type GraphRule = "G1" | "G2" | "G3" | "G4" | "G5" | "G6";
export interface Violation {
  rule: GraphRule;
  message: string;
}

export class GraphInvariantError extends Error {
  readonly violations: Violation[];
  constructor(violations: Violation[]) {
    super(
      `Graph invariants violated: ${violations.map((v) => `${v.rule} ${v.message}`).join("; ")}`,
    );
    this.name = "GraphInvariantError";
    this.violations = violations;
  }
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes].sort();
}

const labelProblem = (label: string): string | null => {
  if (label.length === 0) return "is empty";
  if (/[\r\n]/.test(label)) return "contains a line break";
  if (label.length > MAX_LABEL_LENGTH)
    return `is longer than ${String(MAX_LABEL_LENGTH)} characters`;
  return null;
};

/** The sequence range a fragment covers: from its first branch start to its last branch end. */
function fragmentRange(f: SeqFragment): [number, number] {
  const starts = f.branches.map((b) => b.fromSeq);
  const ends = f.branches.map((b) => b.toSeq);
  return [Math.min(...starts), Math.max(...ends)];
}

/** Checks invariants G1-G6. Returns every violation; an empty array means valid. */
export function checkGraph(graph: Graph): Violation[] {
  const out: Violation[] = [];
  const add = (rule: GraphRule, message: string) => out.push({ rule, message });

  const nodeIds = graph.nodes.map((n) => n.id);
  const nodeSet = new Set(nodeIds);

  // G1: unique ids.
  for (const id of duplicates(nodeIds)) add("G1", `duplicate node id "${id}"`);
  for (const id of duplicates(graph.edges.map((e) => e.id))) add("G1", `duplicate edge id "${id}"`);
  for (const id of duplicates(graph.groups.map((g) => g.id)))
    add("G1", `duplicate group id "${id}"`);
  for (const g of graph.groups) {
    if (nodeSet.has(g.id)) add("G1", `group id "${g.id}" collides with a node id`);
  }

  // G2: edge endpoints exist.
  for (const e of graph.edges) {
    if (!nodeSet.has(e.from)) add("G2", `edge ${e.id} starts at unknown node "${e.from}"`);
    if (!nodeSet.has(e.to)) add("G2", `edge ${e.id} ends at unknown node "${e.to}"`);
  }

  // G3: group members exist, and a node is in at most one group.
  const owner = new Map<string, string>();
  for (const g of graph.groups) {
    for (const m of g.members) {
      if (!nodeSet.has(m)) add("G3", `group "${g.id}" has unknown member "${m}"`);
      const previous = owner.get(m);
      if (previous !== undefined && previous !== g.id) {
        add("G3", `node "${m}" is in both group "${previous}" and group "${g.id}"`);
      }
      owner.set(m, g.id);
    }
  }

  // G4: sequence diagrams have contiguous 1..n message numbers and properly nested fragments.
  if (graph.type === "sequence") {
    const seqs = graph.edges.map((e) => e.seq);
    const n = graph.edges.length;
    if (seqs.some((s) => s === undefined)) {
      add("G4", "every sequence message needs a seq number");
    } else {
      const sorted = [...(seqs as number[])].sort((a, b) => a - b);
      if (sorted.some((s, i) => s !== i + 1))
        add("G4", `seq numbers must be exactly 1..${String(n)}`);
    }
    const ranges: [number, number, string][] = [];
    for (const f of graph.fragments) {
      let previousEnd = 0;
      for (const b of f.branches) {
        if (b.fromSeq > b.toSeq) add("G4", `fragment ${f.id} has a branch with fromSeq > toSeq`);
        if (b.fromSeq < 1 || b.toSeq > n)
          add("G4", `fragment ${f.id} range is outside 1..${String(n)}`);
        if (b.fromSeq <= previousEnd)
          add("G4", `fragment ${f.id} has overlapping or unordered branches`);
        previousEnd = Math.max(previousEnd, b.toSeq);
      }
      const [lo, hi] = fragmentRange(f);
      ranges.push([lo, hi, f.id]);
    }
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const [a1, a2, aid] = ranges[i] as [number, number, string];
        const [b1, b2, bid] = ranges[j] as [number, number, string];
        const disjoint = a2 < b1 || b2 < a1;
        const aInB = b1 <= a1 && a2 <= b2;
        const bInA = a1 <= b1 && b2 <= a2;
        if (!disjoint && !aInB && !bInA)
          add("G4", `fragments ${aid} and ${bid} overlap without nesting`);
      }
    }
  } else if (graph.fragments.length > 0) {
    add("G4", "only sequence diagrams may have fragments");
  }

  // G5: labels are non-empty, single-line and short.
  const checkLabel = (what: string, label: string | undefined) => {
    if (label === undefined) return;
    const problem = labelProblem(label);
    if (problem) add("G5", `${what} label ${problem}`);
  };
  for (const n of graph.nodes) checkLabel(`node "${n.id}"`, n.label);
  for (const g of graph.groups) checkLabel(`group "${g.id}"`, g.label);
  for (const e of graph.edges) checkLabel(`edge ${e.id}`, e.label);

  // G6: edge ids come from the model layer and look like e<number>.
  for (const e of graph.edges) {
    if (!EDGE_ID_PATTERN.test(e.id)) add("G6", `edge id "${e.id}" is not of the form e<number>`);
  }

  return out;
}

/** Throws GraphInvariantError when any of G1-G6 is violated. */
export function assertGraph(graph: Graph): void {
  const violations = checkGraph(graph);
  if (violations.length > 0) throw new GraphInvariantError(violations);
}
