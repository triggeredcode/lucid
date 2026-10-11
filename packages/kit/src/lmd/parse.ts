import {
  addRow,
  createTable,
  newId,
  parseLgn,
  refineNewNodeKinds,
  TableOpError,
  type Block,
  type Chart,
  type Direction,
  type GraphType,
  type IdGenerator,
  type Status,
} from "@lucid/core";
import { registry as defaultRegistry } from "../defaultRegistry";
import { BlockValidationError, type Registry } from "../registry";
import { parseInline } from "./inline";

/**
 * Lucid Markdown (LMD): the constrained Markdown dialect the model writes in Input Mode.
 *
 *   # / ## / ###  heading          - item / 1. item / - [ ] item   lists (nest by 2-space indent)
 *   item {struck} | {chosen}        status at the end of a line
 *   > [!decision] Title             callout (the following `>` lines are its body); a plain `>` is a note callout
 *   $$ ... $$                       math block          ```lang ... ```   code
 *   Table: caption + pipe table     rows may end with {struck} / {chosen}
 *   ```graph type=flowchart dir=LR title="..."   LGN body       ```chart kind=bar title="..." y="tok/s"
 */

export interface LmdError {
  line: number;
  message: string;
}

export type Placement =
  | { kind: "cursor" }
  | { kind: "end" }
  | { kind: "after" | "before" | "append_to"; ref: string }
  | { kind: "section"; heading: string };

export type LmdResult =
  | { ok: true; blocks: Block[]; placement: Placement; command: boolean }
  | { ok: false; errors: LmdError[] };

export interface LmdOptions {
  /** Id generator for the new blocks (default: random UUIDs). Tests pass a sequential one. */
  ids?: IdGenerator;
  registry?: Registry;
}

interface Line {
  text: string;
  /** 1-based line number in the original source. */
  no: number;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const FENCE = /^(`{3,})\s*(.*?)\s*$/;
const MATH_OPEN = /^\$\$\s*(?:\{(struck|chosen)\})?\s*$/;
const MATH_ONE = /^\$\$(.+?)\$\$\s*(?:\{(struck|chosen)\})?\s*$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const CHECK = /^\[( |x|X)\]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const TABLE_CAPTION = /^Table:\s*(.+?)\s*$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const STATUS = /\s*\{(struck|chosen)\}\s*$/;

function splitStatus(text: string): { text: string; status: Status } {
  const m = STATUS.exec(text);
  if (!m) return { text, status: "normal" };
  return { text: text.slice(0, m.index), status: m[1] as Status };
}

const indentOf = (s: string): number =>
  s.replace(/\t/g, "    ").length - s.replace(/\t/g, "    ").trimStart().length;
const splitCells = (text: string): string[] => {
  let s = text.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
};
/** A header line with pipes, followed by a separator row with the same number of columns (edge pipes optional, as in GFM). */
const isTableStart = (lines: Line[], i: number): boolean => {
  const head = lines[i]?.text ?? "";
  const sep = lines[i + 1]?.text ?? "";
  return (
    head.includes("|") && TABLE_SEP.test(sep) && splitCells(sep).length === splitCells(head).length
  );
};
const isTableRow = (text: string): boolean => text.trim().length > 0 && text.includes("|");

/** key=value / key="quoted value" pairs from a fence info string. */
function parseAttrs(text: string, fail: (m: string) => void): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\s*([a-z_]+)=(?:"((?:[^"\\]|\\.)*)"|(\S+))/gy;
  let pos = 0;
  while (pos < text.trim().length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) {
      fail(`could not read "${text.slice(pos).trim()}"; use key=value or key="quoted value"`);
      break;
    }
    out[m[1] ?? ""] = (m[2] ?? m[3] ?? "").replace(/\\(["\\])/g, "$1");
    pos = re.lastIndex;
  }
  return out;
}

const splitList = (s: string): string[] =>
  s
    .split(/(?<!\\),/)
    .map((x) => x.trim().replace(/\\,/g, ","))
    .filter((x) => x.length > 0);

class Parser {
  readonly errors: LmdError[] = [];
  readonly lineOf = new Map<string, number>();
  constructor(
    private readonly ids: IdGenerator,
    private readonly depth = 0,
  ) {}

  private err(line: number, message: string): void {
    this.errors.push({ line, message });
  }

  private make(
    type: Block["type"],
    props: Record<string, unknown>,
    line: number,
    extra: { content?: Block["content"]; children?: Block[] } = {},
  ): Block {
    const id = this.ids();
    this.lineOf.set(id, line);
    return {
      id,
      type,
      props,
      ...(extra.content === undefined ? {} : { content: extra.content }),
      ...(extra.children === undefined ? {} : { children: extra.children }),
    };
  }

  parse(lines: Line[]): Block[] {
    const out: Block[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line) break;
      const t = line.text;
      if (t.trim().length === 0 || RULE.test(t.trim())) {
        i++;
        continue;
      }
      const fence = FENCE.exec(t.trim());
      if (fence) {
        i = this.fence(lines, i, fence, out);
        continue;
      }
      const math = MATH_OPEN.exec(t.trim());
      const mathOne = MATH_ONE.exec(t.trim());
      if (mathOne) {
        out.push(
          this.make(
            "math",
            { latex: (mathOne[1] ?? "").trim(), ...(mathOne[2] ? { status: mathOne[2] } : {}) },
            line.no,
          ),
        );
        i++;
        continue;
      }
      if (math) {
        i = this.math(lines, i, math[1], out);
        continue;
      }
      const heading = HEADING.exec(t);
      if (heading) {
        const level = (heading[1] ?? "").length;
        if (level > 3) this.err(line.no, "headings go up to ### (level 3)");
        const { text, status } = splitStatus(heading[2] ?? "");
        out.push(
          this.make(
            "heading",
            { level: Math.min(level, 3), ...(status === "normal" ? {} : { status }) },
            line.no,
            { content: parseInline(text) },
          ),
        );
        i++;
        continue;
      }
      if (QUOTE.test(t)) {
        i = this.callout(lines, i, out);
        continue;
      }
      if (LIST.test(t)) {
        i = this.list(lines, i, out);
        continue;
      }
      const caption = TABLE_CAPTION.exec(t.trim());
      if (caption && isTableStart(lines, i + 1)) {
        i = this.table(lines, i + 1, caption[1] ?? "", out);
        continue;
      }
      if (isTableStart(lines, i)) {
        i = this.table(lines, i, "", out);
        continue;
      }
      i = this.paragraph(lines, i, out);
    }
    return out;
  }

  private startsBlock(lines: Line[], i: number): boolean {
    const t = lines[i]?.text ?? "";
    const s = t.trim();
    return (
      s.length === 0 ||
      FENCE.test(s) ||
      MATH_OPEN.test(s) ||
      MATH_ONE.test(s) ||
      HEADING.test(t) ||
      QUOTE.test(t) ||
      LIST.test(t) ||
      RULE.test(s) ||
      isTableStart(lines, i) ||
      (TABLE_CAPTION.test(s) && isTableStart(lines, i + 1))
    );
  }

  private paragraph(lines: Line[], start: number, out: Block[]): number {
    let i = start;
    const parts: string[] = [];
    while (i < lines.length && (i === start || !this.startsBlock(lines, i))) {
      parts.push((lines[i]?.text ?? "").trim());
      i++;
    }
    const { text, status } = splitStatus(parts.join(" "));
    out.push(
      this.make("paragraph", status === "normal" ? {} : { status }, lines[start]?.no ?? 0, {
        content: parseInline(text),
      }),
    );
    return i;
  }

  private list(lines: Line[], start: number, out: Block[]): number {
    const stack: { indent: number; block: Block }[] = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      const m = line ? LIST.exec(line.text) : null;
      if (!line || !m) break;
      const indent = indentOf(m[1] ?? "");
      const marker = m[2] ?? "-";
      let body = m[3] ?? "";
      const numbered = /^\d/.test(marker);
      let checked: boolean | undefined;
      const check = !numbered ? CHECK.exec(body) : null;
      if (check) {
        checked = check[1] !== " ";
        body = check[2] ?? "";
      }
      const { text, status } = splitStatus(body);
      const props: Record<string, unknown> = {
        ...(checked === undefined ? {} : { checked }),
        ...(status === "normal" ? {} : { status }),
      };
      const type = numbered
        ? "numberedListItem"
        : checked === undefined
          ? "bulletListItem"
          : "checkListItem";
      const block = this.make(type, props, line.no, { content: parseInline(text) });
      while (stack.length > 0 && (stack.at(-1)?.indent ?? 0) >= indent) stack.pop();
      const parent = stack.at(-1)?.block;
      if (parent) parent.children = [...(parent.children ?? []), block];
      else out.push(block);
      stack.push({ indent, block });
      i++;
    }
    return i;
  }

  private callout(lines: Line[], start: number, out: Block[]): number {
    const body: Line[] = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      const m = line ? QUOTE.exec(line.text) : null;
      if (!line || !m) break;
      body.push({ text: m[1] ?? "", no: line.no });
      i++;
    }
    let kind = "note";
    let title = "";
    let status: Status = "normal";
    const header = /^\[!([A-Za-z]+)\]\s*(.*)$/.exec(body[0]?.text ?? "");
    let content = body;
    if (header) {
      kind = (header[1] ?? "note").toLowerCase();
      const split = splitStatus(header[2] ?? "");
      title = split.text.trim();
      status = split.status;
      content = body.slice(1);
      if (!["note", "key", "decision", "tradeoff", "warning", "question"].includes(kind)) {
        this.err(
          lines[start]?.no ?? 0,
          `unknown callout kind "${kind}"; use note, key, decision, tradeoff, warning or question`,
        );
        kind = "note";
      }
    }
    const nested = new Parser(this.ids, this.depth + 1);
    const children = nested.parse(content);
    this.errors.push(...nested.errors);
    for (const [id, no] of nested.lineOf) this.lineOf.set(id, no);
    out.push(
      this.make(
        "callout",
        { kind, title, ...(status === "normal" ? {} : { status }) },
        lines[start]?.no ?? 0,
        { children },
      ),
    );
    return i;
  }

  private math(lines: Line[], start: number, status: string | undefined, out: Block[]): number {
    const body: string[] = [];
    let i = start + 1;
    while (i < lines.length && !/^\$\$\s*$/.test((lines[i]?.text ?? "").trim())) {
      body.push(lines[i]?.text ?? "");
      i++;
    }
    if (i >= lines.length) {
      this.err(
        lines[start]?.no ?? 0,
        "math block opened with $$ is never closed with a line containing only $$",
      );
      return i;
    }
    out.push(
      this.make(
        "math",
        { latex: body.join("\n").trim(), ...(status ? { status } : {}) },
        lines[start]?.no ?? 0,
      ),
    );
    return i + 1;
  }

  private table(lines: Line[], start: number, caption: string, out: Block[]): number {
    const startNo = lines[start]?.no ?? 0;
    const cells = splitCells;
    const header = cells(lines[start]?.text ?? "");
    try {
      let table = createTable(header);
      let i = start + 2;
      while (i < lines.length && isTableRow(lines[i]?.text ?? "")) {
        const row = lines[i];
        const { text, status } = splitStatus(row?.text ?? "");
        const rowCells = cells(text);
        if (rowCells.length !== header.length) {
          this.err(
            row?.no ?? 0,
            `row has ${String(rowCells.length)} cells, header has ${String(header.length)}`,
          );
        } else {
          table = addRow(table, { cells: rowCells, status });
        }
        i++;
      }
      out.push(this.make("table", { table, caption }, startNo));
      return i;
    } catch (error) {
      if (!(error instanceof TableOpError)) throw error;
      this.err(startNo, error.message);
      let i = start + 2;
      while (i < lines.length && isTableRow(lines[i]?.text ?? "")) i++;
      return i;
    }
  }

  private fence(lines: Line[], start: number, m: RegExpExecArray, out: Block[]): number {
    const ticks = m[1] ?? "```";
    const open = lines[start];
    const info = splitStatus(m[2] ?? "");
    const lang = /^\S*/.exec(info.text.trim())?.[0] ?? "";
    const rest = info.text.trim().slice(lang.length);
    const body: Line[] = [];
    let i = start + 1;
    let closed = false;
    while (i < lines.length) {
      const t = (lines[i]?.text ?? "").trim();
      if (t.startsWith(ticks) && /^`+$/.test(t)) {
        closed = true;
        break;
      }
      body.push(lines[i] as Line);
      i++;
    }
    const openNo = open?.no ?? 0;
    if (!closed) {
      this.err(openNo, "code fence is never closed");
      return lines.length;
    }
    const status = info.status === "normal" ? {} : { status: info.status };
    const fail = (message: string) => {
      this.err(openNo, message);
    };

    if (lang === "graph") {
      const a = parseAttrs(rest, fail);
      const type = (a["type"] ?? "flowchart") as GraphType;
      const direction = (a["dir"] ?? a["direction"] ?? "LR") as Direction;
      if (!["flowchart", "sequence", "er"].includes(type))
        fail(`graph type must be flowchart, sequence or er, not "${type}"`);
      if (!["LR", "TB"].includes(direction)) fail(`dir must be LR or TB, not "${direction}"`);
      const result = parseLgn(body.map((l) => l.text).join("\n"), {
        type,
        direction,
        ...(a["title"] === undefined ? {} : { title: a["title"] }),
      });
      if (result.ok) {
        out.push(
          this.make(
            "diagram",
            {
              // A node written as a plain service that is really a queue or a CDN is drawn as one.
              graph: refineNewNodeKinds(undefined, result.graph),
              caption: a["caption"] ?? "",
              ...status,
            },
            openNo,
          ),
        );
      } else {
        for (const e of result.errors) this.err(body[e.line - 1]?.no ?? openNo, e.message);
      }
    } else if (lang === "chart") {
      const a = parseAttrs(rest, fail);
      const kind = a["kind"] ?? "bar";
      if (kind !== "bar" && kind !== "line") fail(`chart kind must be bar or line, not "${kind}"`);
      let categories: string[] = [];
      const series: Chart["series"] = [];
      const before = this.errors.length;
      for (const l of body) {
        const t = l.text.trim();
        if (t.length === 0) continue;
        const cat = /^categories:\s*(.*)$/.exec(t);
        const ser = /^series\s+([^:]+):\s*(.*)$/.exec(t);
        if (cat) categories = splitList(cat[1] ?? "");
        else if (ser) {
          const values = splitList(ser[2] ?? "").map(Number);
          if (values.some((v) => !Number.isFinite(v)))
            this.err(l.no, `series "${(ser[1] ?? "").trim()}" has a value that is not a number`);
          series.push({ name: (ser[1] ?? "").trim(), values });
        } else this.err(l.no, 'expected "categories: a, b" or "series Name: 1, 2"');
      }
      if (this.errors.length > before) return i + 1;
      out.push(
        this.make(
          "chart",
          {
            chart: {
              kind: kind === "line" ? "line" : "bar",
              title: a["title"] ?? "",
              xLabel: a["x"] ?? "",
              yLabel: a["y"] ?? "",
              ...(a["unit"] === undefined ? {} : { unit: a["unit"] }),
              categories,
              series,
            },
            caption: a["caption"] ?? "",
            ...status,
          },
          openNo,
        ),
      );
    } else {
      out.push(
        this.make(
          "code",
          { language: lang, code: body.map((l) => l.text).join("\n"), ...status },
          openNo,
        ),
      );
    }
    return i + 1;
  }
}

const REF = /^[A-Za-z0-9_.-]+$/;

/** `@@ after b7`, `@@ before b7`, `@@ append_to b9`, `@@ end`, `@@ section "Trade-offs"` or `@@ command`. */
function parseDirective(text: string): { placement: Placement; command: boolean } | string {
  const m = /^@@\s*(\S+)\s*(.*?)\s*$/.exec(text.trim());
  if (!m)
    return 'expected "@@ after <ref>", "@@ before <ref>", "@@ append_to <ref>", "@@ end", "@@ section \\"Heading\\"" or "@@ command"';
  const word = m[1] ?? "";
  const arg = m[2] ?? "";
  if (word === "command") return { placement: { kind: "cursor" }, command: true };
  if (word === "end")
    return arg === ""
      ? { placement: { kind: "end" }, command: false }
      : '"@@ end" takes no argument';
  if (word === "after" || word === "before" || word === "append_to") {
    return REF.test(arg)
      ? { placement: { kind: word, ref: arg }, command: false }
      : `"@@ ${word}" needs a block reference such as b7`;
  }
  if (word === "section") {
    const heading =
      /^"((?:[^"\\]|\\.)+)"$/.exec(arg)?.[1]?.replace(/\\(["\\])/g, "$1") ??
      (arg.length > 0 && !arg.startsWith('"') ? arg : "");
    return heading.length > 0
      ? { placement: { kind: "section", heading }, command: false }
      : '"@@ section" needs a heading in quotes';
  }
  return `unknown placement "@@ ${word}"; use after, before, append_to, end, section or command`;
}

/** Parse LMD into blocks (validated and normalised by the block registry). Nothing is returned on error. */
export function parseLmd(source: string, options: LmdOptions = {}): LmdResult {
  const reg = options.registry ?? defaultRegistry;
  const all: Line[] = source.split(/\r?\n/).map((text, i) => ({ text, no: i + 1 }));

  // An optional placement directive must be the first non-blank line.
  const firstIndex = all.findIndex((l) => l.text.trim().length > 0);
  let placement: Placement = { kind: "cursor" };
  let lines = all;
  const directiveErrors: LmdError[] = [];
  const first = all[firstIndex];
  if (first && first.text.trim().startsWith("@@")) {
    const parsed = parseDirective(first.text);
    if (typeof parsed === "string") directiveErrors.push({ line: first.no, message: parsed });
    else {
      placement = parsed.placement;
      if (parsed.command) return { ok: true, blocks: [], placement, command: true };
    }
    lines = all.slice(firstIndex + 1);
  }
  for (const l of lines) {
    if (l.text.trim().startsWith("@@")) {
      directiveErrors.push({
        line: l.no,
        message: "a placement directive (@@ ...) must be the first line",
      });
    }
  }
  if (directiveErrors.length > 0) return { ok: false, errors: directiveErrors };
  const parser = new Parser(options.ids ?? newId);
  const blocks = parser.parse(lines);
  const errors = [...parser.errors];

  const validated: Block[] = [];
  for (const block of blocks) {
    try {
      validated.push(reg.validateBlock(block));
    } catch (error) {
      if (!(error instanceof BlockValidationError)) throw error;
      for (const issue of error.issues)
        errors.push({ line: parser.lineOf.get(issue.blockId) ?? 0, message: issue.message });
    }
  }
  if (errors.length > 0) return { ok: false, errors: errors.sort((a, b) => a.line - b.line) };
  return { ok: true, blocks: validated, placement, command: false };
}
