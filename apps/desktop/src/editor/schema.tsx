import {
  BlockNoteSchema,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import {
  ChartSchema,
  GraphSchema,
  TableSchema,
  compileChart,
  compileMermaid,
  type Chart,
  type Graph,
  type Table,
} from "@lucid/core";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { minWidthFor, type Layout } from "../preview/fit";
import { renderFitted } from "../preview/mermaid";
import { useWidth } from "../preview/useWidth";
import { useResolvedTheme } from "../theme/appearance";

export const CALLOUT_KINDS = [
  "note",
  "key",
  "decision",
  "tradeoff",
  "warning",
  "question",
] as const;
export const CALLOUT_LABELS: Record<(typeof CALLOUT_KINDS)[number], string> = {
  note: "Note",
  key: "Key idea",
  decision: "Decision",
  tradeoff: "Trade-off",
  warning: "Warning",
  question: "Open question",
};

function parse<T>(
  text: string,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
): T | undefined {
  try {
    const r = schema.safeParse(JSON.parse(text));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

const calloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      kind: { default: "note", values: CALLOUT_KINDS },
      status: { default: "normal", values: ["normal", "struck", "chosen"] as const },
    },
    content: "inline",
  },
  {
    render: ({ block, editor, contentRef }) => (
      <div className="callout" data-kind={block.props.kind} data-status={block.props.status}>
        <span contentEditable={false}>
          <select
            className="callout-kind"
            aria-label="Callout type"
            value={block.props.kind}
            onChange={(e) => {
              editor.updateBlock(block, { props: { kind: e.target.value as never } });
            }}
          >
            {CALLOUT_KINDS.map((k) => (
              <option key={k} value={k}>
                {CALLOUT_LABELS[k]}
              </option>
            ))}
          </select>
        </span>
        <div className="callout-title" ref={contentRef} />
      </div>
    ),
  },
);

const mathBlock = createReactBlockSpec(
  {
    type: "math",
    propSchema: { status: { default: "normal", values: ["normal", "struck", "chosen"] as const } },
    content: "inline",
  },
  {
    meta: { code: true },
    render: ({ block, contentRef }) => (
      <div className="math-block" data-status={block.props.status}>
        <span className="math-tag" contentEditable={false}>
          Math (LaTeX)
        </span>
        <div className="math-source" ref={contentRef} />
      </div>
    ),
  },
);

function Figure({
  source,
  caption,
  status,
  onEdit,
}: {
  source: string | undefined;
  caption: string;
  status: string;
  /** Opens the guided builder on this drawing. */
  onEdit?: (() => void) | undefined;
}) {
  const [layout, setLayout] = useState<Layout | undefined>();
  const [failed, setFailed] = useState(false);
  const look = useResolvedTheme();
  const figure = useRef<HTMLElement>(null);
  const width = useWidth(figure);
  useEffect(() => {
    let live = true;
    setFailed(false);
    if (source === undefined || width === 0) return;
    // Drawn so that it can be read at this width: in the other direction when that is less squeezed.
    renderFitted(source, look, { width }).then(
      (l) => {
        if (live) setLayout(l);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [source, look, width]);
  const svg = layout?.svg;
  return (
    <figure ref={figure} className="figure" contentEditable={false} data-status={status}>
      {svg !== undefined && !failed ? (
        <div
          className="figure-svg"
          data-flipped={layout?.flipped}
          // Below this width the drawing scrolls inside its figure instead of shrinking further.
          style={
            {
              "--min-w": `${String(minWidthFor(layout?.size ?? { width: 0, height: 0 }))}px`,
            } as CSSProperties
          }
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="figure-wait">
          {failed || source === undefined ? "Could not draw this figure." : "Drawing…"}
        </div>
      )}
      {caption.length > 0 && <figcaption>{caption}</figcaption>}
      {onEdit && (
        <button type="button" className="figure-edit ghost small" onClick={onEdit}>
          Edit diagram
        </button>
      )}
    </figure>
  );
}

const diagramBlock = createReactBlockSpec(
  {
    type: "diagram",
    propSchema: {
      graphJson: { default: "{}" },
      caption: { default: "" },
      status: { default: "normal", values: ["normal", "struck", "chosen"] as const },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const graph: Graph | undefined = parse(block.props.graphJson, GraphSchema);
      return (
        <Figure
          source={graph ? compileMermaid(graph) : undefined}
          caption={block.props.caption}
          status={block.props.status}
          onEdit={() => {
            window.dispatchEvent(
              new CustomEvent("lucid:build", { detail: { kind: "diagram", blockId: block.id } }),
            );
          }}
        />
      );
    },
  },
);

const chartBlock = createReactBlockSpec(
  {
    type: "chart",
    propSchema: {
      chartJson: { default: "{}" },
      caption: { default: "" },
      status: { default: "normal", values: ["normal", "struck", "chosen"] as const },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const chart: Chart | undefined = parse(block.props.chartJson, ChartSchema);
      return (
        <Figure
          source={chart ? compileChart(chart) : undefined}
          caption={block.props.caption}
          status={block.props.status}
        />
      );
    },
  },
);

const tableBlock = createReactBlockSpec(
  {
    type: "lucidTable",
    propSchema: {
      tableJson: { default: "{}" },
      caption: { default: "" },
      status: { default: "normal", values: ["normal", "struck", "chosen"] as const },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const table: Table | undefined = parse(block.props.tableJson, TableSchema);
      return (
        <figure className="figure" contentEditable={false} data-status={block.props.status}>
          {table ? (
            <table className="lucid-table">
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c.id} data-status={c.status}>
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.id} data-status={r.status}>
                    {r.cells.map((cell, i) => (
                      <td key={table.columns[i]?.id ?? i}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="figure-wait">Could not show this table.</div>
          )}
          {block.props.caption.length > 0 && <figcaption>{block.props.caption}</figcaption>}
          {table && (
            <button
              type="button"
              className="figure-edit ghost small"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("lucid:build", { detail: { kind: "table", blockId: block.id } }),
                );
              }}
            >
              Edit table
            </button>
          )}
        </figure>
      );
    },
  },
);

/** The blocks and styles a Lucid page can hold. Everything else BlockNote offers (images, columns, colours) is left out. */
export const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: false }),
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    codeBlock: defaultBlockSpecs.codeBlock,
    callout: calloutBlock(),
    math: mathBlock(),
    diagram: diagramBlock(),
    chart: chartBlock(),
    lucidTable: tableBlock(),
  },
  styleSpecs: {
    bold: defaultStyleSpecs.bold,
    italic: defaultStyleSpecs.italic,
    underline: defaultStyleSpecs.underline,
    strike: defaultStyleSpecs.strike,
    code: defaultStyleSpecs.code,
    backgroundColor: defaultStyleSpecs.backgroundColor,
  },
});
export type LucidEditor = typeof schema.BlockNoteEditor;
