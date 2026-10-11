import { tableLegend, type TablePhase } from "@lucid/core";
import { isTableDraft, type BuilderState } from "./useBuilder";
import { WorkbenchFrame, type PhaseTab } from "./WorkbenchFrame";

interface Props {
  state: BuilderState;
  onPhase: (phase: TablePhase) => void;
  onUndo: () => void;
  onCancel: () => void;
  onDone: () => void;
  onChoose: (n: number) => void;
  onDismissAsk: () => void;
}

const PHASES: PhaseTab<TablePhase>[] = [
  {
    phase: "columns",
    label: "1 Columns",
    hint: "Say the columns, like “property, SQL, NoSQL”, or “three columns: …”. Say “rows” when you are ready.",
  },
  {
    phase: "rows",
    label: "2 Rows",
    hint: "Say a whole row (“schema, fixed, flexible”), or one cell at a time and it fills the next one. “skip” leaves a cell empty, “new row” starts the next. “SQL column: fixed, joins” fills a column.",
  },
  {
    phase: "edit",
    label: "3 Edit",
    hint: "Fix things by number: “cell 2 3 is embedded”, “delete row 2”, “add column cost”, “rename column 2 to Relational”, “move row 3 up”.",
  },
  {
    phase: "think",
    label: "Think",
    hint: "Think out loud. Nothing is made until you say “draw it”. Later statements win over earlier ones.",
  },
];

/** The one place where a table is built: the grid with its numbers, filling up as you speak. */
export function TableWorkbench({
  state,
  onPhase,
  onUndo,
  onCancel,
  onDone,
  onChoose,
  onDismissAsk,
}: Props) {
  const draft = state.draft;
  if (!isTableDraft(draft)) return null;
  const l = tableLegend(draft);
  const fresh = (row: number, col: number) =>
    draft.fresh.some((f) => f.row === row && f.col === col);
  const missing = l.wanted !== undefined && l.columns.length > 0 ? l.wanted - l.columns.length : 0;
  const bits: string[] = [];
  if (missing > 0) bits.push(`${String(missing)} more column${missing === 1 ? "" : "s"} to name`);
  if (l.cursor) {
    const c = l.columns[l.cursor.col];
    bits.push(`next cell: row ${String(l.cursor.row + 1)}, ${c?.name ?? ""}`);
  }
  if (l.emptyCells > 0)
    bits.push(`${String(l.emptyCells)} empty cell${l.emptyCells === 1 ? "" : "s"}`);
  return (
    <WorkbenchFrame
      state={state}
      title={state.blockId ? "Edit table" : "New table"}
      phases={PHASES}
      phase={draft.phase}
      onPhase={onPhase}
      onUndo={onUndo}
      onCancel={onCancel}
      onDone={onDone}
      onChoose={onChoose}
      onDismissAsk={onDismissAsk}
      doneLabel={state.blockId ? "Done" : "Insert table"}
      canDone={l.columns.length > 0}
      checklist={bits.length > 0 ? bits.join(" · ") : undefined}
      single
    >
      <div className="wb-canvas wb-tablecanvas">
        {l.columns.length === 0 ? (
          <div className="wb-empty">
            <p>The table appears here as you speak.</p>
            <p className="wb-sub">Start with the columns: “property, SQL, NoSQL”.</p>
          </div>
        ) : (
          <table className="wb-grid" aria-label="Table being built">
            <thead>
              <tr>
                <th className="wb-corner" aria-hidden="true" />
                {l.columns.map((c) => (
                  <th key={c.id} scope="col" data-fresh={fresh(-1, c.no - 1)}>
                    <b>{c.no}</b> {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {l.rows.length === 0 && (
                <tr className="wb-norows">
                  <td colSpan={l.columns.length + 1}>No rows yet. Say “rows”, then a row.</td>
                </tr>
              )}
              {l.rows.map((r, ri) => (
                <tr key={r.id}>
                  <th scope="row">{r.no}</th>
                  {l.columns.map((c, ci) => (
                    <td
                      key={c.id}
                      data-fresh={fresh(ri, ci)}
                      data-cursor={l.cursor?.row === ri && l.cursor.col === ci}
                      data-empty={(r.cells[ci] ?? "").length === 0}
                    >
                      {r.cells[ci]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </WorkbenchFrame>
  );
}
