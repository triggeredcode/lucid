import {
  ChartSchema,
  GraphSchema,
  TableSchema,
  compileChart,
  compileMermaid,
  type Block,
  type Inline,
} from "@lucid/core";
import { latexProblems } from "../blocks/math";
import { parseInline } from "../lmd/inline";
import { escapeLatex } from "./escape";
import { inlineToLatex } from "./inline";

export interface LatexContext {
  /** Block id to the figure file (relative to main.tex) for diagrams and charts. */
  figures: Readonly<Record<string, string>>;
  /**
   * Heading levels to take off, so the shallowest heading in the page is a numbered section: a page whose headings
   * are all level 2 must not start at "0.1". Computed once for the document.
   */
  headingOffset?: number;
  /** Display formulas are numbered (a note format says so). */
  equationNumbers?: boolean;
  /** Diagrams are set this wide, as a share of the text width (default: all of it). */
  diagramWidth?: number;
  /**
   * The natural width of each figure in points, by block id. With it a big diagram is set at its own size, up to a
   * little wider than the text (into the margins), instead of being squeezed into the text width.
   */
  figureWidths?: Readonly<Record<string, number>>;
  /** The natural height of each figure in points, by block id: with it a small figure is not enlarged into a tall one. */
  figureHeights?: Readonly<Record<string, number>>;
}

/** How far the shallowest heading in the blocks is below level 1 (0 when there is a level 1 or no heading). */
export function headingOffsetOf(blocks: readonly Block[]): number {
  let min = Infinity;
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      if (b.type === "heading") {
        const level = b.props["level"] === 2 || b.props["level"] === 3 ? b.props["level"] : 1;
        min = Math.min(min, level);
      }
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return Number.isFinite(min) ? min - 1 : 0;
}

export interface Figure {
  blockId: string;
  /** File the PDF figure is written to, relative to main.tex. */
  file: string;
  kind: "diagram" | "chart";
  /** Mermaid text to render. */
  mermaid: string;
}

const LIST_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);
const CALLOUT_COLORS: Record<string, string> = {
  note: "gray",
  key: "blue",
  decision: "green!50!black",
  tradeoff: "orange",
  warning: "red",
  question: "violet",
};
const LISTINGS_LANGUAGES: Record<string, string> = {
  python: "Python",
  sql: "SQL",
  java: "Java",
  c: "C",
  cpp: "C++",
  "c++": "C++",
  bash: "bash",
  sh: "bash",
  javascript: "JavaScript",
  js: "JavaScript",
  typescript: "JavaScript",
  ts: "JavaScript",
  html: "HTML",
  xml: "XML",
};

const str = (b: Block, key: string): string =>
  typeof b.props[key] === "string" ? b.props[key] : "";
const status = (b: Block): "normal" | "struck" | "chosen" => {
  const s = b.props["status"];
  return s === "struck" || s === "chosen" ? s : "normal";
};
const wrap = (latex: string, s: "normal" | "struck" | "chosen"): string =>
  latex.length === 0 || s === "normal"
    ? latex
    : s === "struck"
      ? `\\lucidstruck{${latex}}`
      : `\\lucidchosen{${latex}}`;
const textOf = (inlines: readonly Inline[] | undefined): string => inlineToLatex(inlines);
const figureName = (id: string): string => `figures/${id.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;

/** Diagrams and charts that need a rendered PDF figure before the document can be compiled. */
export function collectFigures(blocks: readonly Block[]): Figure[] {
  const out: Figure[] = [];
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      if (b.type === "diagram") {
        const g = GraphSchema.safeParse(b.props["graph"]);
        if (g.success && g.data.nodes.length > 0) {
          out.push({
            blockId: b.id,
            file: figureName(b.id),
            kind: "diagram",
            mermaid: compileMermaid(g.data),
          });
        }
      } else if (b.type === "chart") {
        const c = ChartSchema.safeParse(b.props["chart"]);
        if (c.success && c.data.series.length > 0) {
          out.push({
            blockId: b.id,
            file: figureName(b.id),
            kind: "chart",
            mermaid: compileChart(c.data),
          });
        }
      }
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

function listEnv(run: Block[], ctx: LatexContext): string {
  const first = run[0];
  const env = first?.type === "numberedListItem" ? "enumerate" : "itemize";
  const items = run.map((item) => {
    const label =
      item.type === "checkListItem"
        ? `[${item.props["checked"] === true ? "$\\boxtimes$" : "$\\square$"}] `
        : " ";
    const head = wrap(textOf(item.content), status(item));
    const nested =
      item.children && item.children.length > 0 ? `\n${blocksToLatex(item.children, ctx)}` : "";
    return `\\item${label}${head}${nested}`;
  });
  return `\\begin{${env}}\n${items.join("\n")}\n\\end{${env}}`;
}

function table(block: Block): string {
  const parsed = TableSchema.safeParse(block.props["table"]);
  if (!parsed.success) return "";
  const t = parsed.data;
  const n = t.columns.length;
  const spec =
    t.headerColumn && n > 1 ? `@{}l*{${String(n - 1)}}{Y}@{}` : `@{}*{${String(n)}}{Y}@{}`;
  const cell = (
    text: string,
    s: "normal" | "struck" | "chosen",
    bold = false,
    first = false,
  ): string => {
    const inner = textOf(parseInline(text));
    if (inner.length === 0) return "";
    if (s === "struck") return `\\lucidstruck{${inner}}`;
    if (s === "chosen") return first ? `\\lucidchosen{${inner}}` : `\\textbf{${inner}}`;
    return bold ? `\\textbf{${inner}}` : inner;
  };
  const head = t.columns.map((c) => cell(c.name, c.status, true)).join(" & ");
  const rows = t.rows.map((r) =>
    r.cells.map((c, i) => cell(c, r.status, false, i === 0)).join(" & "),
  );
  const caption = str(block, "caption");
  return [
    "\\begin{table}[H]\\centering\\small\\renewcommand{\\arraystretch}{1.25}",
    `\\begin{tabularx}{\\linewidth}{${spec}}`,
    "\\toprule",
    `${head} \\\\`,
    "\\midrule",
    ...rows.map((r) => `${r} \\\\`),
    "\\bottomrule",
    "\\end{tabularx}",
    ...(caption ? [`\\caption{${escapeLatex(caption)}}`] : []),
    "\\end{table}",
  ].join("\n");
}

/** The width at which a figure of this size would be 45% of the text high (a length, written for TeX). */
const tallLimit = (width: number, height: number): string =>
  `\\dimexpr0.45\\textheight*${String(Math.round((width / height) * 1000))}/1000\\relax`;

function figure(block: Block, ctx: LatexContext): string {
  const file = ctx.figures[block.id];
  if (!file) return `\\begin{lucidcallout}{gray}{Figure}Not available yet.\\end{lucidcallout}`;
  const g = GraphSchema.safeParse(block.props["graph"]);
  const c = ChartSchema.safeParse(block.props["chart"]);
  const caption =
    str(block, "caption") || (g.success ? (g.data.title ?? "") : c.success ? c.data.title : "");
  const share = ctx.diagramWidth === undefined ? "" : String(ctx.diagramWidth);
  const natural = ctx.figureWidths?.[block.id];
  const naturalHeight = ctx.figureHeights?.[block.id];
  // Without the figure's own size: as wide as the format says. With it: its own size, but at least as wide as the format
  // says (a small diagram is set up to that, though never more than one and a half times its own size: a narrow tall diagram
  // would be a page tall) and at most 1.3 times the text (a big one reaches into the margins), centred.
  const include =
    natural === undefined
      ? `\\includegraphics[width=${share}\\linewidth,height=0.65\\textheight,keepaspectratio]{${file}}`
      : [
          `\\setlength{\\lucidfigw}{${natural.toFixed(1)}pt}%`,
          `\\ifdim\\lucidfigw<${share === "" ? "1" : share}\\linewidth\\setlength{\\lucidfigw}{${share === "" ? "1" : share}\\linewidth}\\fi%`,
          `\\ifdim\\lucidfigw>${(natural * 1.5).toFixed(1)}pt\\setlength{\\lucidfigw}{${(natural * 1.5).toFixed(1)}pt}\\fi%`,
          // Enlarged, it is not taller than 45% of the text (a tall diagram stays as it is), and it is never made smaller here.
          ...(naturalHeight !== undefined && naturalHeight > 0
            ? [
                `\\ifdim\\lucidfigw>${tallLimit(natural, naturalHeight)}\\setlength{\\lucidfigw}{${tallLimit(natural, naturalHeight)}}\\fi%`,
                `\\ifdim\\lucidfigw<${natural.toFixed(1)}pt\\setlength{\\lucidfigw}{${natural.toFixed(1)}pt}\\fi%`,
              ]
            : []),
          "\\ifdim\\lucidfigw>1.3\\linewidth\\setlength{\\lucidfigw}{1.3\\linewidth}\\fi%",
          `\\makebox[\\linewidth][c]{\\includegraphics[width=\\lucidfigw,height=0.65\\textheight,keepaspectratio]{${file}}}`,
        ].join("\n");
  // A big one (wider than the text, about 345 pt, or taller than 40% of the 592 pt text height) cannot always sit exactly here:
  // it may float to the top of the next page, and the text that follows fills the page it leaves, instead of a page that
  // holds only a heading and a gap.
  const big = (natural !== undefined && natural > 340) || (naturalHeight ?? 0) > 237;
  const place = big ? "htbp" : "H";
  return [
    `\\begin{figure}[${place}]\\centering`,
    include,
    ...(caption ? [`\\caption{${escapeLatex(caption)}}`] : []),
    "\\end{figure}",
  ].join("\n");
}

function one(block: Block, ctx: LatexContext): string {
  switch (block.type) {
    case "heading": {
      const raw =
        block.props["level"] === 2 || block.props["level"] === 3 ? block.props["level"] : 1;
      const level = Math.max(1, raw - (ctx.headingOffset ?? 0));
      const cmd = level === 1 ? "section" : level === 2 ? "subsection" : "subsubsection";
      return `\\${cmd}{${wrap(textOf(block.content), status(block))}}`;
    }
    case "paragraph":
      return wrap(textOf(block.content), status(block));
    case "callout": {
      const kind = str(block, "kind") || "note";
      const title = str(block, "title");
      const label = kind.charAt(0).toUpperCase() + kind.slice(1);
      const heading = escapeLatex(title ? `${label}: ${title}` : label);
      const body = blocksToLatex(block.children ?? [], ctx);
      return `\\begin{lucidcallout}{${CALLOUT_COLORS[kind] ?? "gray"}}{${heading}}\n${body}\n\\end{lucidcallout}`;
    }
    case "math": {
      const latex = str(block, "latex");
      if (latexProblems(latex).length > 0)
        return `\\begin{lstlisting}\n${latex.replace(/\\end\s*\{lstlisting\}/g, "")}\n\\end{lstlisting}`;
      return ctx.equationNumbers === true && !/\\\\|&/.test(latex)
        ? `\\begin{equation}\n${latex}\n\\end{equation}`
        : `\\[\n${latex}\n\\]`;
    }
    case "code": {
      const language = LISTINGS_LANGUAGES[str(block, "language").toLowerCase()];
      const code = str(block, "code").replace(/\\end\s*\{lstlisting\}/g, "\\end {lstlisting}");
      return `\\begin{lstlisting}${language ? `[language=${language}]` : ""}\n${code}\n\\end{lstlisting}`;
    }
    case "table":
      return table(block);
    case "diagram":
    case "chart":
      return figure(block, ctx);
    case "bulletListItem":
    case "numberedListItem":
    case "checkListItem":
      return listEnv([block], ctx);
  }
}

/** LaTeX for a sequence of blocks. Consecutive list items of one kind become one list environment. */
export function blocksToLatex(blocks: readonly Block[], ctx: LatexContext): string {
  const parts: string[] = [];
  let run: Block[] = [];
  const flush = () => {
    if (run.length > 0) parts.push(listEnv(run, ctx));
    run = [];
  };
  for (const block of blocks) {
    if (LIST_TYPES.has(block.type)) {
      if (run.length > 0 && run[0]?.type !== block.type) flush();
      run.push(block);
    } else {
      flush();
      parts.push(one(block, ctx));
    }
  }
  flush();
  return parts.filter((p) => p.length > 0).join("\n\n");
}
