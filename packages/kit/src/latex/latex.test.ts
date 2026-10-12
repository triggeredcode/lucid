import { describe, expect, it } from "vitest";
import { registry } from "../defaultRegistry";
import { getFormat, type Format } from "../formats";
import {
  blocksToLatex,
  collectFigures,
  escapeLatex,
  inlineToLatex,
  renderDocument,
  withoutEmptySections,
} from "./index";
import { headingOffsetOf } from "./blocks";
import type { Block } from "@lucid/core";

const fx = (type: Block["type"], id: string): Block => {
  const found = registry.get(type).fixtures.find((f) => f.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};
const latex = (blocks: Block[], figures: Record<string, string> = {}) =>
  blocksToLatex(blocks, { figures });

describe("escapeLatex", () => {
  it("escapes every LaTeX special character", () => {
    expect(escapeLatex("a_b & 5% #1 $x$ {y} ~ ^ \\")).toBe(
      "a\\_b \\& 5\\% \\#1 \\$x\\$ \\{y\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}",
    );
    expect(escapeLatex("a < b | c > d")).toBe("a \\textless{} b \\textbar{} c \\textgreater{} d");
  });

  it("writes common symbols as math and typesets straight quotes", () => {
    expect(escapeLatex("a → b ≈ c × d")).toBe("a $\\rightarrow$ b $\\approx$ c $\\times$ d");
    expect(escapeLatex('He said "hi" (and "bye")')).toBe("He said ``hi'' (and ``bye'')");
    expect(escapeLatex("done ✓")).toBe("done \\ding{51}");
  });

  it("turns newlines into spaces and drops control characters", () => {
    expect(escapeLatex("a\nb\r\nc\td\u0000e")).toBe("a b c de");
  });

  it("leaves ordinary Unicode text alone", () => {
    expect(escapeLatex("café naïve résumé")).toBe("café naïve résumé");
  });
});

describe("inlineToLatex", () => {
  const t = (text: string, styles: Record<string, boolean> = {}) => ({
    type: "text" as const,
    text,
    styles,
  });
  it("writes styles, code, math and links", () => {
    expect(
      inlineToLatex([
        t("Use "),
        t("Redis", { bold: true }),
        t(" and "),
        t("MongoDB", { strike: true, italic: true }),
        t(" "),
        t("x_1", { code: true }),
        { type: "mathInline", latex: "O(n)" },
        { type: "link", href: "https://x.io/a#b", content: [t("docs")] },
      ]),
    ).toBe(
      "Use \\textbf{Redis} and \\textit{\\sout{MongoDB}} \\texttt{x\\_1}\\(O(n)\\)\\href{https://x.io/a\\#b}{docs}",
    );
  });

  it("shows unsafe inline math as escaped text instead of running it", () => {
    expect(inlineToLatex([{ type: "mathInline", latex: String.raw`\input{x}` }])).toBe(
      String.raw`\$\textbackslash{}input\{x\}\$`,
    );
  });
});

describe("blocksToLatex", () => {
  it("writes headings by level, with status", () => {
    expect(
      latex([
        fx("heading", "fx-heading-1"),
        fx("heading", "fx-heading-2"),
        fx("heading", "fx-heading-3"),
      ]),
    ).toBe(
      "\\section{Designing a URL shortener}\n\n\\subsection{Requirements}\n\n\\subsubsection{\\lucidstruck{Approach we dropped}}",
    );
  });

  it("groups consecutive list items into one environment and nests children", () => {
    const text = latex([
      fx("bulletListItem", "fx-bullet-1"),
      fx("bulletListItem", "fx-bullet-2"),
      fx("bulletListItem", "fx-bullet-3"),
      fx("bulletListItem", "fx-bullet-4"),
    ]);
    expect(text).toBe(
      [
        "\\begin{itemize}",
        "\\item PostgreSQL",
        "\\item \\lucidstruck{MongoDB}",
        "\\item \\lucidchosen{DynamoDB}",
        "\\item Caching layers",
        "\\begin{itemize}",
        "\\item CDN",
        "\\item Redis",
        "\\end{itemize}",
        "\\end{itemize}",
      ].join("\n"),
    );
  });

  it("writes numbered lists and checklists", () => {
    expect(
      latex([fx("numberedListItem", "fx-numbered-1"), fx("numberedListItem", "fx-numbered-2")]),
    ).toBe(
      "\\begin{enumerate}\n\\item Resolve the domain with DNS\n\\item Send the request to the web server\n\\end{enumerate}",
    );
    expect(latex([fx("checkListItem", "fx-check-1"), fx("checkListItem", "fx-check-2")])).toBe(
      "\\begin{itemize}\n\\item[$\\square$] Benchmark with a longer context\n\\item[$\\boxtimes$] Read the vLLM paper\n\\end{itemize}",
    );
  });

  it("starts a new list when the list kind changes", () => {
    const text = latex([
      fx("bulletListItem", "fx-bullet-1"),
      fx("numberedListItem", "fx-numbered-1"),
    ]);
    expect(text.match(/\\begin\{/g)).toHaveLength(2);
  });

  it("writes callouts with a colour by kind and the title", () => {
    expect(latex([fx("callout", "fx-callout-1")])).toBe(
      "\\begin{lucidcallout}{green!50!black}{Decision: Database choice}\nDynamoDB for key-value access at scale.\n\\end{lucidcallout}",
    );
    expect(latex([fx("callout", "fx-callout-2")])).toContain("{lucidcallout}{red}{Warning}");
  });

  it("writes display math and code", () => {
    expect(latex([fx("math", "fx-math-1")])).toBe(
      "\\[\nM_{KV} = 2 \\cdot L \\cdot H \\cdot d_{head} \\cdot b \\cdot T\n\\]",
    );
    expect(latex([fx("code", "fx-code-1")])).toBe(
      "\\begin{lstlisting}[language=SQL]\nSELECT * FROM urls WHERE short_code = $1;\n\\end{lstlisting}",
    );
    expect(latex([fx("code", "fx-code-2")])).toBe(
      "\\begin{lstlisting}\nGET /api/v1/short/abc\nHost: example.com\n\\end{lstlisting}",
    );
  });

  it("cannot be broken out of a listing, and unsafe math becomes a listing", () => {
    const evil: Block = {
      id: "c",
      type: "code",
      props: { language: "", code: "x \\end{lstlisting} \\input{evil}" },
    };
    expect(latex([evil])).not.toMatch(/\\end\{lstlisting\}\s*\\input/);
    const bad: Block = { id: "m", type: "math", props: { latex: "\\input{evil}" } };
    expect(latex([bad]).startsWith("\\begin{lstlisting}")).toBe(true);
  });

  it("writes tables with booktabs, a header column and row status", () => {
    const text = latex([fx("table", "fx-table-2")]);
    expect(text).toBe(
      [
        "\\begin{table}[H]\\centering\\small",
        "\\begin{tabularx}{\\linewidth}{@{}*{2}{X}@{}}",
        "\\toprule",
        "\\textbf{Option} & \\textbf{Verdict} \\\\",
        "\\midrule",
        "\\lucidstruck{PostgreSQL} & \\lucidstruck{Joins are not needed} \\\\",
        "\\lucidchosen{DynamoDB} & \\textbf{Key-value access at scale} \\\\",
        "\\bottomrule",
        "\\end{tabularx}",
        "\\end{table}",
      ].join("\n"),
    );
    const wide = latex([fx("table", "fx-table-1")]);
    expect(wide).toContain("{@{}l*{2}{X}@{}}");
    expect(wide).toContain("\\caption{SQL vs NoSQL}");
  });

  it("escapes and formats cell text", () => {
    const base = fx("table", "fx-table-2");
    const t = base.props["table"] as { rows: { id: string; cells: string[]; status: string }[] };
    const block: Block = {
      ...base,
      props: {
        ...base.props,
        table: { ...t, rows: [{ id: "r1", cells: ["**a** & b_c", "50% $x$"], status: "normal" }] },
      },
    };
    expect(latex([block])).toContain("\\textbf{a} \\& b\\_c & 50\\% \\(x\\)");
  });

  it("writes a figure for a diagram when it was rendered, a placeholder otherwise", () => {
    const d = fx("diagram", "fx-diagram-1");
    expect(latex([d], { [d.id]: "figures/fx-diagram-1.pdf" })).toBe(
      "\\begin{figure}[H]\\centering\n\\includegraphics[width=\\linewidth,height=0.65\\textheight,keepaspectratio]{figures/fx-diagram-1.pdf}\n\\caption{Request flow}\n\\end{figure}",
    );
    expect(latex([d])).toContain("Not available yet");
  });

  it("never enlarges a small figure beyond one and a half times its own size, so a narrow tall diagram is not set a page tall", () => {
    const d = fx("diagram", "fx-diagram-1");
    const narrow = blocksToLatex([d], {
      figures: { [d.id]: "figures/fx-diagram-1.pdf" },
      diagramWidth: 0.85,
      figureWidths: { [d.id]: 150 },
    });
    expect(narrow).toContain("\\setlength{\\lucidfigw}{150.0pt}%");
    expect(narrow).toContain("\\ifdim\\lucidfigw>225.0pt\\setlength{\\lucidfigw}{225.0pt}\\fi%");
    // The width rules come in this order: the format's width, then the limit on enlarging, then the margins.
    expect(narrow.indexOf("<0.85\\linewidth")).toBeLessThan(narrow.indexOf(">225.0pt"));
    expect(narrow.indexOf(">225.0pt")).toBeLessThan(narrow.indexOf(">1.3\\linewidth"));
  });

  it("keeps an enlarged small figure from becoming taller than 45% of the text, but never shrinks it below its own size", () => {
    const d = fx("diagram", "fx-diagram-1");
    const tall = blocksToLatex([d], {
      figures: { [d.id]: "figures/fx-diagram-1.pdf" },
      diagramWidth: 0.85,
      figureWidths: { [d.id]: 150 },
      figureHeights: { [d.id]: 225 },
    });
    // The width at which the figure would be 45% of the text high: 0.45 \\textheight times width / height (150 / 225).
    const limit = "\\dimexpr0.45\\textheight*667/1000\\relax";
    expect(tall).toContain(`\\ifdim\\lucidfigw>${limit}\\setlength{\\lucidfigw}{${limit}}\\fi%`);
    expect(tall).toContain("\\ifdim\\lucidfigw<150.0pt\\setlength{\\lucidfigw}{150.0pt}\\fi%");
    expect(tall.indexOf(">225.0pt")).toBeLessThan(tall.indexOf(limit));
    expect(tall.indexOf(limit)).toBeLessThan(tall.indexOf("<150.0pt"));
    expect(tall.indexOf("<150.0pt")).toBeLessThan(tall.indexOf(">1.3\\linewidth"));
    // Without the height there is no such rule.
    const noHeight = blocksToLatex([d], {
      figures: { [d.id]: "figures/fx-diagram-1.pdf" },
      diagramWidth: 0.85,
      figureWidths: { [d.id]: 150 },
    });
    expect(noHeight).not.toContain("textheight*");
  });

  it("sets a figure with a known size at that size, between the format's width and 1.3 times the text, centred", () => {
    const d = fx("diagram", "fx-diagram-1");
    const out = blocksToLatex([d], {
      figures: { [d.id]: "figures/fx-diagram-1.pdf" },
      diagramWidth: 0.85,
      figureWidths: { [d.id]: 612.5 },
    });
    expect(out).toContain("\\setlength{\\lucidfigw}{612.5pt}%");
    expect(out).toContain(
      "\\ifdim\\lucidfigw<0.85\\linewidth\\setlength{\\lucidfigw}{0.85\\linewidth}\\fi%",
    );
    expect(out).toContain(
      "\\ifdim\\lucidfigw>1.3\\linewidth\\setlength{\\lucidfigw}{1.3\\linewidth}\\fi%",
    );
    expect(out).toContain(
      "\\makebox[\\linewidth][c]{\\includegraphics[width=\\lucidfigw,height=0.65\\textheight,keepaspectratio]{figures/fx-diagram-1.pdf}}",
    );
    // A big one may float (the text after it then fills the page); a small one stays exactly where it is written.
    expect(out).toContain("\\begin{figure}[htbp]\\centering");
    const small = blocksToLatex([d], {
      figures: { [d.id]: "figures/fx-diagram-1.pdf" },
      figureWidths: { [d.id]: 200 },
    });
    expect(small).toContain("\\begin{figure}[H]\\centering");
    // Another figure without a size keeps the old way.
    const other = blocksToLatex([{ ...d, id: "other" }], {
      figures: { other: "figures/other.pdf" },
      figureWidths: { [d.id]: 612.5 },
    });
    expect(other).not.toContain("lucidfigw");
  });
});

describe("collectFigures", () => {
  it("lists diagrams and charts with their Mermaid text and file names, including inside callouts", () => {
    const callout: Block = {
      id: "c1",
      type: "callout",
      props: { kind: "note", title: "" },
      children: [fx("chart", "fx-chart-1")],
    };
    const figures = collectFigures([fx("diagram", "fx-diagram-1"), callout]);
    expect(figures.map((f) => [f.blockId, f.kind, f.file])).toEqual([
      ["fx-diagram-1", "diagram", "figures/fx-diagram-1.pdf"],
      ["fx-chart-1", "chart", "figures/fx-chart-1.pdf"],
    ]);
    expect(figures[0]?.mermaid.startsWith("flowchart LR")).toBe(true);
    expect(figures[1]?.mermaid.startsWith("xychart-beta")).toBe(true);
  });

  it("skips empty diagrams", () => {
    const empty: Block = {
      id: "e",
      type: "diagram",
      props: {
        graph: {
          type: "flowchart",
          direction: "LR",
          nodes: [],
          edges: [],
          groups: [],
          fragments: [],
        },
      },
    };
    expect(collectFigures([empty])).toEqual([]);
  });
});

describe("renderDocument", () => {
  it("builds main.tex in the house style, with title, author and footer", () => {
    const { tex, figures } = renderDocument({
      title: "KV cache & sizing",
      author: "Asha",
      footerRight: "Footer text",
      doc: { blocks: [fx("heading", "fx-heading-2"), fx("paragraph", "fx-paragraph-1")] },
    });
    expect(figures).toEqual([]);
    expect(tex).toBe(
      [
        "\\documentclass{article}",
        "\\usepackage{lucid}",
        "\\renewcommand{\\lucidfooterright}{Footer text}",
        "\\title{\\underline{KV cache \\& sizing}}",
        "\\author{Asha}",
        "\\date{\\today}",
        "\\begin{document}",
        "\\maketitle",
        "\\section{Requirements}\n\nA load balancer spreads incoming traffic across several application servers.",
        "\\end{document}",
        "",
      ].join("\n"),
    );
  });

  it("skips a first heading that repeats the title", () => {
    const { tex } = renderDocument({
      title: "Designing a URL shortener",
      doc: { blocks: [fx("heading", "fx-heading-1"), fx("heading", "fx-heading-2")] },
    });
    expect(tex).not.toContain("\\section{Designing");
    // With the title heading gone, the shallowest remaining heading is the first numbered section.
    expect(tex).toContain("\\section{Requirements}");
  });

  it("uses a default title and returns figures still to render", () => {
    const { tex, figures } = renderDocument({
      title: "  ",
      doc: { blocks: [fx("diagram", "fx-diagram-1")] },
    });
    expect(tex).toContain("\\title{\\underline{Untitled}}");
    expect(figures).toHaveLength(1);
    expect(tex).toContain("Not available yet");
  });

  it("includes figures that were already rendered", () => {
    const { tex } = renderDocument(
      { title: "T", doc: { blocks: [fx("diagram", "fx-diagram-1")] } },
      { "fx-diagram-1": "x" },
    );
    expect(tex).toContain("\\includegraphics");
  });
});

describe("heading levels", () => {
  const heading = (id: string, level: number, text: string): Block => ({
    id,
    type: "heading",
    props: { level },
    content: [{ type: "text", text, styles: {} }],
  });

  it("makes the shallowest heading a numbered section, however it was written", () => {
    const blocks = [
      heading("a", 2, "Load balancer"),
      heading("b", 3, "Health checks"),
      heading("c", 2, "Caching"),
    ];
    expect(headingOffsetOf(blocks)).toBe(1);
    const { tex } = renderDocument({ title: "T", doc: { blocks } }, {});
    expect(tex).toContain("\\section{Load balancer}");
    expect(tex).toContain("\\subsection{Health checks}");
    expect(tex).toContain("\\section{Caching}");
    expect(tex).not.toContain("subsubsection");
  });

  it("leaves a page that already starts at level 1 alone", () => {
    const blocks = [heading("a", 1, "One"), heading("b", 2, "Two")];
    expect(headingOffsetOf(blocks)).toBe(0);
    const { tex } = renderDocument({ title: "T", doc: { blocks } }, {});
    expect(tex).toContain("\\section{One}");
    expect(tex).toContain("\\subsection{Two}");
  });

  it("looks inside callouts and list items too", () => {
    const callout: Block = {
      id: "c",
      type: "callout",
      props: { kind: "note", title: "" },
      children: [heading("h", 3, "Deep")],
    };
    expect(headingOffsetOf([callout])).toBe(2);
    expect(headingOffsetOf([])).toBe(0);
  });
});

describe("note formats in the export", () => {
  const blocks = (): Block[] => [
    {
      id: "h1",
      type: "heading",
      props: { level: 2 },
      content: [{ type: "text", text: "Context", styles: {} }],
    },
    {
      id: "p1",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "Why.", styles: {} }],
    },
    {
      id: "h2",
      type: "heading",
      props: { level: 2 },
      content: [{ type: "text", text: "Options", styles: {} }],
    },
    {
      id: "h3",
      type: "heading",
      props: { level: 2 },
      content: [{ type: "text", text: "Decision", styles: {} }],
    },
    { id: "m1", type: "math", props: { latex: "E = mc^2", display: true } },
  ];
  const bench = getFormat("benchmark") as Format;
  const math = getFormat("inference-math") as Format;

  it("leaves out sections with nothing in them", () => {
    const { tex } = renderDocument({ title: "T", doc: { blocks: blocks() }, format: bench });
    expect(tex).toContain("{Context}");
    expect(tex).not.toContain("{Options}");
    expect(tex).toContain("{Decision}");
    // Without a format every heading prints, as before.
    expect(renderDocument({ title: "T", doc: { blocks: blocks() } }).tex).toContain("{Options}");
  });

  it("a heading with only an empty sub-heading is empty too, one with content below is not", () => {
    const sub: Block[] = [
      {
        id: "a",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "A", styles: {} }],
      },
      {
        id: "b",
        type: "heading",
        props: { level: 3 },
        content: [{ type: "text", text: "B", styles: {} }],
      },
      {
        id: "c",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "C", styles: {} }],
      },
      {
        id: "d",
        type: "heading",
        props: { level: 3 },
        content: [{ type: "text", text: "D", styles: {} }],
      },
      {
        id: "e",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "Text.", styles: {} }],
      },
    ];
    expect(withoutEmptySections(sub).map((b) => b.id)).toEqual(["c", "d", "e"]);
  });

  it("shows the format's meta lines under the title, escaped, in the format's order and only those filled in", () => {
    const { tex } = renderDocument({
      title: "T",
      doc: { blocks: [] },
      format: bench,
      info: {
        hardware: "M4 Max, 48 GB & fan",
        date: "2026-10-11",
        source: "ignored: not a benchmark field",
      },
    });
    const lines = tex.split("\n").filter((l) => l.startsWith("\\lucidmeta"));
    expect(lines).toEqual([
      "\\lucidmeta{Date}{2026-10-11}",
      "\\lucidmeta{Hardware}{M4 Max, 48 GB \\& fan}",
    ]);
  });

  it("numbers display formulas only in a format that asks for it", () => {
    const doc = { blocks: blocks().slice(4) };
    expect(renderDocument({ title: "T", doc, format: math }).tex).toContain("\\begin{equation}");
    expect(renderDocument({ title: "T", doc, format: bench }).tex).not.toContain(
      "\\begin{equation}",
    );
    expect(renderDocument({ title: "T", doc }).tex).toContain("\\[");
    const multiline = {
      blocks: [{ id: "m", type: "math" as const, props: { latex: "a &= b \\\\ c &= d" } }],
    };
    expect(renderDocument({ title: "T", doc: multiline, format: math }).tex).not.toContain(
      "\\begin{equation}",
    );
  });

  it("sets diagrams as wide as the format says", () => {
    const diagram = fx("diagram", "fx-diagram-1");
    const doc = { blocks: [diagram] };
    const rendered = { [diagram.id]: "figures/d.pdf" };
    expect(renderDocument({ title: "T", doc, format: math }, rendered).tex).toContain(
      "width=0.85\\linewidth",
    );
    expect(
      renderDocument({ title: "T", doc, format: getFormat("system-design") }, rendered).tex,
    ).toContain("width=1\\linewidth");
    // No format: the whole text width, as before.
    expect(renderDocument({ title: "T", doc }, rendered).tex).toContain("[width=\\linewidth,");
  });
});
