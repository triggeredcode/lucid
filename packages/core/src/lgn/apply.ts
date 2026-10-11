import { nextNumberedId } from "../model/ids";
import {
  GraphInvariantError,
  emptyGraph,
  type Direction,
  type Graph,
  type GraphType,
  type SeqFragment,
} from "../model/graph";
import { GraphOpError, groupNodes, upsertEdge, upsertNode } from "../model/graphOps";
import { parseStatements, type LgnError, type Statement } from "./parse";

export interface LgnOptions {
  type?: GraphType;
  direction?: Direction;
  title?: string;
}

export type LgnResult = { ok: true; graph: Graph } | { ok: false; errors: LgnError[] };

const FRAGMENT_ONLY_IN_SEQUENCE =
  "alt/opt/loop/par/else/end only work in sequence diagrams (use ```graph type=sequence)";

function messageOf(error: unknown): string {
  if (error instanceof GraphOpError) return error.message;
  if (error instanceof GraphInvariantError) {
    return error.violations.map((v) => v.message).join("; ");
  }
  throw error;
}

interface OpenFragment {
  line: number;
  kind: SeqFragment["kind"];
  branches: SeqFragment["branches"];
  label: string;
  from: number;
}

/**
 * Applies LGN statements to a graph with upsert semantics and returns a new graph.
 * Nothing is applied unless every line is valid, so a failed patch leaves the caller's graph intact.
 * - A node line updates only the parts it gives (`redis {struck}` changes the status alone) or creates it.
 * - An edge to an undeclared node auto-declares it (label from the id, kind `process`); a later node line
 *   can fill in the label and kind.
 * - Groups are applied last so their members may be declared anywhere in the text.
 * - Sequence diagrams: every edge line is a new message, in order; alt/opt/loop/par blocks become fragments
 *   covering the messages written inside them.
 */
export function applyLgn(graph: Graph, source: string): LgnResult {
  const parsed = parseStatements(source);
  if (parsed.errors.length > 0) return { ok: false, errors: parsed.errors };

  const errors: LgnError[] = [];
  let current = graph;
  const stack: OpenFragment[] = [];
  const groups: Extract<Statement, { type: "group" }>[] = [];

  const attempt = (line: number, run: () => void, prefix = "") => {
    try {
      run();
    } catch (error) {
      errors.push({ line, message: `${prefix}${messageOf(error)}` });
    }
  };

  const closeBranch = (open: OpenFragment, line: number) => {
    const to = current.edges.length;
    if (to < open.from) {
      errors.push({
        line,
        message: `the "${open.label || open.kind}" branch contains no messages`,
      });
      return;
    }
    open.branches.push({ label: open.label, fromSeq: open.from, toSeq: to });
  };

  for (const s of parsed.statements) {
    switch (s.type) {
      case "node":
        attempt(s.line, () => {
          current = upsertNode(current, {
            id: s.id,
            ...(s.label === undefined ? {} : { label: s.label }),
            ...(s.kind === undefined ? {} : { kind: s.kind }),
            ...(s.status === undefined ? {} : { status: s.status }),
          });
        });
        break;
      case "edge":
        attempt(s.line, () => {
          for (const id of [s.from, s.to]) {
            if (!current.nodes.some((n) => n.id === id)) current = upsertNode(current, { id });
          }
          current = upsertEdge(current, {
            from: s.from,
            to: s.to,
            arrow: s.arrow,
            style: s.style,
            ...(s.label === undefined ? {} : { label: s.label }),
            ...(s.status === undefined ? {} : { status: s.status }),
          });
        });
        break;
      case "group":
        groups.push(s);
        break;
      case "fragment-open":
        if (current.type !== "sequence") {
          errors.push({ line: s.line, message: FRAGMENT_ONLY_IN_SEQUENCE });
        } else {
          stack.push({
            line: s.line,
            kind: s.kind,
            branches: [],
            label: s.label,
            from: current.edges.length + 1,
          });
        }
        break;
      case "fragment-else": {
        const open = stack.at(-1);
        if (current.type !== "sequence") {
          errors.push({ line: s.line, message: FRAGMENT_ONLY_IN_SEQUENCE });
        } else if (!open) {
          errors.push({ line: s.line, message: '"else" without an open alt/opt/loop/par block' });
        } else {
          closeBranch(open, s.line);
          open.label = s.label;
          open.from = current.edges.length + 1;
        }
        break;
      }
      case "fragment-end": {
        const open = stack.pop();
        if (current.type !== "sequence") {
          errors.push({ line: s.line, message: FRAGMENT_ONLY_IN_SEQUENCE });
        } else if (!open) {
          errors.push({ line: s.line, message: '"end" without an open alt/opt/loop/par block' });
        } else {
          closeBranch(open, s.line);
          if (open.branches.length > 0) {
            const id = nextNumberedId(
              "f",
              current.fragments.map((f) => f.id),
            );
            current = {
              ...current,
              fragments: [...current.fragments, { id, kind: open.kind, branches: open.branches }],
            };
          }
        }
        break;
      }
    }
  }

  for (const open of stack) {
    errors.push({ line: open.line, message: `"${open.kind}" block is never closed with "end"` });
  }

  for (const g of groups) {
    attempt(
      g.line,
      () => {
        // Name the group in the message: "unknown node" alone does not say which line is meant.
        current = groupNodes(current, {
          id: g.id,
          label: g.label,
          members: g.members,
          ...(g.status === undefined ? {} : { status: g.status }),
        });
      },
      `group "${g.id}": `,
    );
  }

  return errors.length > 0
    ? { ok: false, errors: errors.sort((a, b) => a.line - b.line) }
    : { ok: true, graph: current };
}

/** Parse LGN (the body of a ```graph fence) into a new graph. */
export function parseLgn(source: string, options: LgnOptions = {}): LgnResult {
  const base = emptyGraph(options.type, options.direction);
  return applyLgn(options.title === undefined ? base : { ...base, title: options.title }, source);
}

export class LgnParseError extends Error {
  readonly errors: LgnError[];
  constructor(errors: LgnError[]) {
    super(errors.map((e) => `line ${String(e.line)}: ${e.message}`).join("\n"));
    this.name = "LgnParseError";
    this.errors = errors;
  }
}

/** Like parseLgn but throws LgnParseError (for callers that treat bad LGN as an exceptional case). */
export function parseLgnOrThrow(source: string, options: LgnOptions = {}): Graph {
  const result = parseLgn(source, options);
  if (!result.ok) throw new LgnParseError(result.errors);
  return result.graph;
}
