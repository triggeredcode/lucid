import {
  ChartSchema,
  GraphSchema,
  TableSchema,
  printLgn,
  type Block,
  type Chart,
} from "@lucid/core";
import { inlineToMarkdown, inlineToPlain } from "../text";
import type { Placement } from "./parse";

/**
 * Blocks -> LMD (the inverse of parseLmd). parseLmd(blocksToLmd(blocks)) gives the same blocks
 * (ids aside) for everything LMD can express. Not representable and therefore dropped: table column status, graph node
 * notes, non-list children of list items (written as plain bullets), and soft line breaks (written as spaces).
 * Adjacent styled runs with different styles but no plain text between them can be ambiguous (`**a***b*`); runs the
 * editor produces are merged, so this does not occur in practice.
 */

const statusOf = (b: Block): string => {
  const s = b.props["status"];
  return s === "struck" || s === "chosen" ? ` {${s}}` : "";
};
const str = (b: Block, key: string): string =>
  typeof b.props[key] === "string" ? b.props[key] : "";

/** Backslash the first character of a line when it would otherwise start another block. */
export function guardLineStart(line: string): string {
  if (/^[#>+\-@|]/.test(line)) return `\\${line}`;
  const numbered = /^(\d+)([.)])/.exec(line);
  if (numbered) return `${numbered[1] ?? ""}\\${line.slice((numbered[1] ?? "").length)}`;
  if (/^Table:/.test(line)) return `Table\\:${line.slice("Table:".length)}`;
  return line;
}

const inline = (b: Block): string => inlineToMarkdown(b.content).replace(/[\r\n]+/g, " ");

const quoteAttr = (value: string): string => `"${value.replace(/(["\\])/g, "\\$1")}"`;
const attrs = (pairs: [string, string | undefined][]): string =>
  pairs
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${quoteAttr(v ?? "")}`)
    .join(" ");

/** A fence one backtick longer than any backtick run in the body. */
const fenceFor = (body: string): string =>
  "`".repeat(Math.max(2, ...(body.match(/`+/g) ?? []).map((r) => r.length)) + 1);

const cellEscape = (s: string): string => s.replace(/(?<!\\)\|/g, "\\|").replace(/[\r\n]+/g, " ");
const listTypes = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);

function listItem(block: Block, depth: number, index: number): string[] {
  const marker =
    block.type === "numberedListItem"
      ? `${String(index)}.`
      : block.type === "checkListItem"
        ? `- [${block.props["checked"] === true ? "x" : " "}]`
        : "-";
  const text = inline(block);
  const lines = [`${"  ".repeat(depth)}${marker} ${text}${statusOf(block)}`];
  let n = 0;
  for (const child of block.children ?? []) {
    n = child.type === block.type ? n + 1 : 1;
    if (listTypes.has(child.type)) lines.push(...listItem(child, depth + 1, n));
    else lines.push(`${"  ".repeat(depth + 1)}- ${inlineToPlain(child.content) || child.type}`);
  }
  return lines;
}

function chartBody(chart: Chart): string[] {
  return [
    `categories: ${chart.categories.map((c) => c.replace(/,/g, "\\,")).join(", ")}`,
    // "series name:" ends at the first colon, so a colon inside a series name is written as the ratio sign.
    ...chart.series.map((s) => `series ${s.name.replace(/:/g, "\u2236")}: ${s.values.join(", ")}`),
  ];
}

function one(block: Block): string {
  switch (block.type) {
    case "heading": {
      const level =
        block.props["level"] === 1 || block.props["level"] === 3 ? block.props["level"] : 2;
      return `${"#".repeat(level)} ${inline(block)}${statusOf(block)}`;
    }
    case "paragraph":
      return `${guardLineStart(inline(block))}${statusOf(block)}`;
    case "callout": {
      const title = str(block, "title");
      const header = `> [!${str(block, "kind") || "note"}]${title ? ` ${title}` : ""}${statusOf(block)}`;
      const body = blocksToLmd(block.children ?? []);
      const quoted =
        body.length === 0 ? [] : body.split("\n").map((l) => (l.length > 0 ? `> ${l}` : ">"));
      return [header, ...quoted].join("\n");
    }
    case "math":
      return `$$${statusOf(block)}\n${str(block, "latex")}\n$$`;
    case "code": {
      const code = str(block, "code");
      const fence = fenceFor(code);
      return `${fence}${str(block, "language")}${statusOf(block)}\n${code}\n${fence}`;
    }
    case "table": {
      const t = TableSchema.parse(block.props["table"]);
      const caption = str(block, "caption");
      return [
        ...(caption ? [`Table: ${caption}`] : []),
        `| ${t.columns.map((c) => cellEscape(c.name)).join(" | ")} |`,
        `| ${t.columns.map(() => "---").join(" | ")} |`,
        ...t.rows.map(
          (r) =>
            `| ${r.cells.map(cellEscape).join(" | ")} |${r.status === "normal" ? "" : ` {${r.status}}`}`,
        ),
      ].join("\n");
    }
    case "diagram": {
      const g = GraphSchema.parse(block.props["graph"]);
      const body = printLgn(g);
      const fence = fenceFor(body);
      const head = attrs([
        ["title", g.title],
        ["caption", str(block, "caption")],
      ]);
      return `${fence}graph type=${g.type} dir=${g.direction}${head ? ` ${head}` : ""}${statusOf(block)}\n${body}\n${fence}`;
    }
    case "chart": {
      const c = ChartSchema.parse(block.props["chart"]);
      const head = attrs([
        ["title", c.title],
        ["x", c.xLabel],
        ["y", c.yLabel],
        ["unit", c.unit],
        ["caption", str(block, "caption")],
      ]);
      return `\`\`\`chart kind=${c.kind}${head ? ` ${head}` : ""}${statusOf(block)}\n${chartBody(c).join("\n")}\n\`\`\``;
    }
    case "bulletListItem":
    case "numberedListItem":
    case "checkListItem":
      return listItem(block, 0, 1).join("\n");
  }
}

/** LMD for a sequence of top-level blocks. Consecutive list items form one list; other blocks are separated by a blank line. */
export function blocksToLmd(blocks: readonly Block[]): string {
  const parts: string[] = [];
  let run: string[] = [];
  let runType: string | undefined;
  let index = 0;
  const flush = () => {
    if (run.length > 0) parts.push(run.join("\n"));
    run = [];
    runType = undefined;
  };
  for (const block of blocks) {
    if (listTypes.has(block.type)) {
      index = runType === block.type ? index + 1 : 1;
      run.push(...listItem(block, 0, index));
      runType = block.type;
    } else {
      flush();
      parts.push(one(block));
      index = 0;
    }
  }
  flush();
  return parts.join("\n\n");
}

/** The `@@ ...` first line for a placement (nothing for the cursor default). */
export function printPlacement(p: Placement): string {
  switch (p.kind) {
    case "cursor":
      return "";
    case "end":
      return "@@ end";
    case "section":
      return `@@ section ${quoteAttr(p.heading)}`;
    default:
      return `@@ ${p.kind} ${p.ref}`;
  }
}
