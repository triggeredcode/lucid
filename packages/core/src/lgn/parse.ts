import {
  ARROWS,
  EDGE_STYLES,
  FRAGMENT_KINDS,
  NODE_KINDS,
  SLUG_PATTERN,
  type Arrow,
  type EdgeStyle,
  type GraphStatus,
  type NodeKind,
} from "../model/graph";

/**
 * Lucid Graph Notation (LGN): one statement per line, used inside ```graph fences (Input Mode)
 * and in graph.patch ops (Command Mode).
 *
 *   node      id [kind]: Label {status}
 *   edge      from ARROW to: Label {status}
 *   group     group id: Label {a, b, c} {struck}
 *   fragment  alt|opt|loop|par Label ... else Label ... end        (sequence diagrams only)
 *
 * Arrows: ->  --  <->   (solid)    -.->  -.-  <-.->   (dashed)    ..>  ...  <..>   (dotted)
 * Comments are whole lines starting with #. Labels may contain colons; the first colon after the id (and
 * optional [kind]) starts the label. A label may be "quoted" to protect leading/trailing spaces or a
 * trailing {status}-looking text; inside quotes use \" and \\.
 */

export interface LgnError {
  line: number;
  message: string;
}

export type Statement =
  | {
      type: "node";
      line: number;
      id: string;
      kind?: NodeKind;
      label?: string;
      status?: GraphStatus;
    }
  | {
      type: "edge";
      line: number;
      from: string;
      to: string;
      arrow: Arrow;
      style: EdgeStyle;
      label?: string;
      status?: GraphStatus;
    }
  | { type: "group"; line: number; id: string; label: string; members: string[]; status?: "struck" }
  | { type: "fragment-open"; line: number; kind: (typeof FRAGMENT_KINDS)[number]; label: string }
  | { type: "fragment-else"; line: number; label: string }
  | { type: "fragment-end"; line: number };

export const RESERVED_WORDS = ["group", "alt", "opt", "loop", "par", "else", "end"] as const;

interface ArrowToken {
  token: string;
  arrow: Arrow;
  style: EdgeStyle;
}

/** Longest tokens first so `<-.->` is not read as `<-` + `.->`. */
export const ARROW_TOKENS: readonly ArrowToken[] = [
  { token: "<-.->", arrow: "bidirectional", style: "dashed" },
  { token: "<..>", arrow: "bidirectional", style: "dotted" },
  { token: "-.->", arrow: "directed", style: "dashed" },
  { token: "<->", arrow: "bidirectional", style: "solid" },
  { token: "-.-", arrow: "undirected", style: "dashed" },
  { token: "..>", arrow: "directed", style: "dotted" },
  { token: "...", arrow: "undirected", style: "dotted" },
  { token: "->", arrow: "directed", style: "solid" },
  { token: "--", arrow: "undirected", style: "solid" },
];

// Every arrow and style combination must be writable, so the printer can round-trip any graph.
for (const arrow of ARROWS) {
  for (const style of EDGE_STYLES) {
    if (!ARROW_TOKENS.some((t) => t.arrow === arrow && t.style === style)) {
      throw new Error(`LGN has no arrow token for ${arrow}/${style}`);
    }
  }
}

const ID = "[a-z][a-z0-9_]*";
const STATUS_SUFFIX = /\s*\{(struck|chosen|hidden)\}\s*$/;
const NODE_LINE = new RegExp(`^(${ID})(?:\\s*\\[([a-z]+)\\])?(?:\\s*:\\s*(.*))?$`);
const ARROW_ALTERNATION = ARROW_TOKENS.map((t) => t.token.replace(/[.\-<>]/g, "\\$&")).join("|");
const EDGE_LINE = new RegExp(`^(${ID})\\s*(${ARROW_ALTERNATION})\\s*(${ID})(?:\\s*:\\s*(.*))?$`);
const GROUP_LINE = /^group\s+([a-z][a-z0-9_]*)\s*:\s*(.*?)\s*\{\s*([^{}]*?)\s*\}$/;
const FRAGMENT_LINE = /^(alt|opt|loop|par|else)(?:\s+(.*))?$/;

/** Reads a label, honouring "quoted" labels. Returns undefined for an empty label. */
export function readLabel(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const text = raw.trim();
  if (text.length === 0) return undefined;
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return text;
}

/** Quote a label only when reading it back unquoted would change it. */
export function writeLabel(label: string): string {
  const needsQuotes =
    label !== label.trim() ||
    label.startsWith('"') ||
    STATUS_SUFFIX.test(label) ||
    label.length === 0;
  return needsQuotes ? `"${label.replace(/(["\\])/g, "\\$1")}"` : label;
}

function splitStatus(rest: string): { body: string; status?: GraphStatus } {
  const match = STATUS_SUFFIX.exec(rest);
  if (!match) return { body: rest };
  return { body: rest.slice(0, match.index), status: match[1] as GraphStatus };
}

const KIND_LIST = NODE_KINDS.join(", ");
/** Documentation order (solid, dashed, dotted), not the longest-first matching order. */
const ARROW_LIST = "-> -- <-> -.-> -.- <-.-> ..> ... <..>";

export interface ParsedLgn {
  statements: Statement[];
  errors: LgnError[];
}

/** Parses statements only; building or patching a graph from them happens in apply.ts. */
export function parseStatements(source: string): ParsedLgn {
  const statements: Statement[] = [];
  const errors: LgnError[] = [];
  const lines = source.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = index + 1;
    const text = rawLine.trim();
    if (text.length === 0 || text.startsWith("#")) return;
    const fail = (message: string) => errors.push({ line, message });

    // fragments (sequence diagrams)
    if (text === "end") {
      statements.push({ type: "fragment-end", line });
      return;
    }
    const fragment = FRAGMENT_LINE.exec(text);
    if (fragment) {
      const word = fragment[1] as "alt" | "opt" | "loop" | "par" | "else";
      const label = readLabel(fragment[2]) ?? "";
      statements.push(
        word === "else"
          ? { type: "fragment-else", line, label }
          : { type: "fragment-open", line, kind: word, label },
      );
      return;
    }

    // group
    if (text.startsWith("group ") || text === "group") {
      const { body, status } = splitStatus(text);
      if (status !== undefined && status !== "struck") {
        fail(`a group can only be {struck}, not {${status}}`);
        return;
      }
      const match = GROUP_LINE.exec(body);
      if (!match) {
        fail('invalid group; expected "group id: Label {member1, member2}"');
        return;
      }
      const members = (match[3] ?? "")
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m.length > 0);
      const label = readLabel(match[2]);
      if (members.length === 0) {
        fail("a group needs at least one member");
        return;
      }
      const badMember = members.find((m) => !SLUG_PATTERN.test(m));
      if (badMember !== undefined) {
        fail(
          `"${badMember}" is not a valid node id (lowercase letters, digits and _, e.g. web_server)`,
        );
        return;
      }
      if (label === undefined) {
        fail("a group needs a label");
        return;
      }
      statements.push({
        type: "group",
        line,
        id: match[1] ?? "",
        label,
        members,
        ...(status === "struck" ? { status: "struck" as const } : {}),
      });
      return;
    }

    const { body, status } = splitStatus(text);

    // edge
    const edge = EDGE_LINE.exec(body);
    if (edge) {
      const token = ARROW_TOKENS.find((t) => t.token === edge[2]);
      const from = edge[1] ?? "";
      const to = edge[3] ?? "";
      const reserved = [from, to].find((id) => (RESERVED_WORDS as readonly string[]).includes(id));
      if (reserved !== undefined) {
        fail(`"${reserved}" is a reserved word and cannot be a node id; pick another id`);
        return;
      }
      const label = readLabel(edge[4]);
      statements.push({
        type: "edge",
        line,
        from,
        to,
        arrow: token?.arrow ?? "directed",
        style: token?.style ?? "solid",
        ...(label === undefined ? {} : { label }),
        ...(status === undefined ? {} : { status }),
      });
      return;
    }

    // node
    const node = NODE_LINE.exec(body);
    if (node) {
      const id = node[1] ?? "";
      if ((RESERVED_WORDS as readonly string[]).includes(id)) {
        fail(`"${id}" is a reserved word and cannot be a node id; pick another id`);
        return;
      }
      let kind: NodeKind | undefined;
      if (node[2] !== undefined) {
        if (!(NODE_KINDS as readonly string[]).includes(node[2])) {
          fail(`unknown node kind "${node[2]}"; valid kinds: ${KIND_LIST}`);
          return;
        }
        kind = node[2] as NodeKind;
      }
      const label = readLabel(node[3]);
      statements.push({
        type: "node",
        line,
        id,
        ...(kind === undefined ? {} : { kind }),
        ...(label === undefined ? {} : { label }),
        ...(status === undefined ? {} : { status }),
      });
      return;
    }

    // Helpful diagnostics for the common mistakes a model makes.
    const looseArrow = /(=>|-->|==>|—>|→|<-)/.exec(body);
    if (looseArrow) {
      fail(`unknown arrow "${looseArrow[1] ?? ""}"; use one of: ${ARROW_LIST}`);
      return;
    }
    const firstWord = /^\S+/.exec(body)?.[0] ?? body;
    if (!SLUG_PATTERN.test(firstWord)) {
      fail(
        `"${firstWord}" is not a valid node id; use lowercase letters, digits and _ starting with a letter (e.g. web_server)`,
      );
      return;
    }
    fail(
      'could not understand this line; expected "id [kind]: Label", "from -> to: label" or "group id: Label {a, b}"',
    );
  });

  return { statements, errors };
}
