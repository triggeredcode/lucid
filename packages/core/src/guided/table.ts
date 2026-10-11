import { TableInvariantError, type Table } from "../model/table";
import {
  TableOpError,
  addColumn,
  addRow,
  createTable,
  moveColumn,
  moveRow,
  removeColumn,
  removeRow,
  renameColumn,
  setCells,
  setHeaderColumn,
} from "../model/tableOps";
import { sharedCommand, type Step } from "./step";
import { parseNumber, titleCase } from "./words";

/**
 * Guided table capture: the person says the columns, then the rows (a whole row per phrase, cell by cell, or
 * a whole column at a time), then fixes by number. Like the diagram engine, everything here is a pure function of
 * (draft, what was said). Rows and columns are numbered by their place in the table (what the person sees), so after a
 * delete the numbers close up, unlike diagram components whose numbers are never reused.
 */
export type TablePhase = "columns" | "rows" | "edit" | "think";

export const MAX_COLUMNS = 8;
const MAX_CELL = 160;
const MAX_COLUMN_NAME = 60;

export interface TableCursor {
  row: number;
  col: number;
}

export interface TableDraft {
  /** May have no columns yet; only a table with at least one column can be inserted. */
  table: Table;
  phase: TablePhase;
  /** The next empty cell a single phrase fills; undefined means a single phrase starts a new row. */
  cursor: TableCursor | undefined;
  /** How many columns the person said there would be ("three columns"). */
  wanted: number | undefined;
  /** Notes to self (Think). */
  scratch: string[];
  /** Cells the last step changed (row -1 is the header), for the screen to point at. */
  fresh: TableCursor[];
}

export type TableStep = Step<TableDraft>;

// ----------------------------------------------------------------------------------------------- drafts

export function newTableDraft(phase: TablePhase = "columns"): TableDraft {
  return {
    table: { columns: [], rows: [], headerColumn: true },
    phase,
    cursor: undefined,
    wanted: undefined,
    scratch: [],
    fresh: [],
  };
}

/** A draft for a table that is already in the page. */
export function draftFromTable(table: Table): TableDraft {
  return { ...newTableDraft("edit"), table, wanted: table.columns.length };
}

export interface TableLegend {
  columns: { no: number; id: string; name: string }[];
  rows: { no: number; id: string; cells: string[] }[];
  cursor: TableCursor | undefined;
  emptyCells: number;
  wanted: number | undefined;
}

export function tableLegend(d: TableDraft): TableLegend {
  const t = d.table;
  return {
    columns: t.columns.map((c, i) => ({ no: i + 1, id: c.id, name: c.name })),
    rows: t.rows.map((r, i) => ({ no: i + 1, id: r.id, cells: r.cells })),
    cursor: d.cursor,
    emptyCells: t.rows.reduce((n, r) => n + r.cells.filter((c) => c.length === 0).length, 0),
    wanted: d.wanted,
  };
}

/** Adopts a table the model produced (a fix, or a table made from notes) as the draft's table. */
export function adoptTable(d: TableDraft, table: Table, phase: TablePhase = d.phase): TableDraft {
  return { ...d, table, phase, cursor: undefined, fresh: [], wanted: table.columns.length };
}

/** What the model is told about the numbers the person is using ("row 2", "column 3"). */
export function tableHint(d: TableDraft): string {
  const l = tableLegend(d);
  const cols = l.columns.map((c) => `${String(c.no)} = ${c.id} (${c.name})`).join("; ");
  const rows = l.rows.map((r) => `${String(r.no)} = ${r.id} (${r.cells[0] ?? ""})`).join("; ");
  return [
    "The user is building this table step by step and refers to rows and columns by their place: rows from the top, columns from the left.",
    `Columns: ${cols || "none yet"}.`,
    `Rows: ${rows || "none yet"}.`,
  ].join("\n");
}

/** What a model's fix really changed, in plain words ("2 cells: row 1 DynamoDB, row 3 DynamoDB"); empty when nothing. */
export function tableChange(before: Table, after: Table): string {
  const parts: string[] = [];
  const had = new Set(before.columns.map((c) => c.id));
  const has = new Set(after.columns.map((c) => c.id));
  const addedCols = after.columns.filter((c) => !had.has(c.id));
  const removedCols = before.columns.filter((c) => !has.has(c.id));
  if (addedCols.length > 0) parts.push(`added column ${addedCols.map((c) => c.name).join(", ")}`);
  if (removedCols.length > 0)
    parts.push(`removed column ${removedCols.map((c) => c.name).join(", ")}`);
  const renamed = after.columns.filter((c) => {
    const old = before.columns.find((o) => o.id === c.id);
    return old !== undefined && old.name !== c.name;
  });
  if (renamed.length > 0) parts.push(`renamed ${renamed.map((c) => c.name).join(", ")}`);

  const rowsBefore = new Map(before.rows.map((r) => [r.id, r]));
  const rowIds = new Set(after.rows.map((r) => r.id));
  const addedRows = after.rows.filter((r) => !rowsBefore.has(r.id)).length;
  const removedRows = before.rows.filter((r) => !rowIds.has(r.id)).length;
  if (addedRows > 0) parts.push(`added ${String(addedRows)} row${addedRows === 1 ? "" : "s"}`);
  if (removedRows > 0)
    parts.push(`removed ${String(removedRows)} row${removedRows === 1 ? "" : "s"}`);

  const changed: string[] = [];
  after.rows.forEach((row, ri) => {
    const old = rowsBefore.get(row.id);
    if (!old) return;
    after.columns.forEach((col, ci) => {
      const oi = before.columns.findIndex((c) => c.id === col.id);
      if (oi >= 0 && (old.cells[oi] ?? "") !== (row.cells[ci] ?? ""))
        changed.push(`row ${String(ri + 1)} ${col.name}`);
    });
  });
  if (changed.length > 0) {
    const shown = changed.slice(0, 4).join(", ");
    parts.push(
      `${String(changed.length)} cell${changed.length === 1 ? "" : "s"}: ${shown}${changed.length > 4 ? ", …" : ""}`,
    );
  }
  return parts.join("; ");
}

// ----------------------------------------------------------------------------------------------- reading text

/** One spoken cell as it should be written: no quotes or end punctuation, a capital letter where it is plain words. */
export function cellText(raw: string): string {
  let t = raw
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:um+|uh+|er+|so)\s+/i, "")
    .replace(/[.!?;:]+$/, "")
    .trim();
  const first = t.split(" ")[0] ?? "";
  if (/^[a-z]/.test(t) && !/[A-Z]/.test(first)) t = `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
  return t.length > MAX_CELL ? `${t.slice(0, MAX_CELL - 1)}…` : t;
}

/** Cells of a whole-row phrase: commas (not inside 1,000), semicolons, " | " and line breaks separate them. */
function splitCells(text: string): string[] {
  return text
    .split(/\s*(?:,(?!\d{3}(?:\D|$))|;|\n|\s\|\s)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Names of columns: as cells, and "and" / "then" separate too ("SQL and NoSQL"). */
function splitNames(text: string): string[] {
  return splitCells(text)
    .flatMap((part) => part.split(/\s+(?:and|then)\s+/i))
    .map((s) => s.replace(/^(?:and|then)\s+/i, "").trim())
    .filter((s) => s.length > 0);
}

const columnName = (raw: string): string => {
  const name = titleCase(
    raw
      .replace(/[“”"]/g, "")
      .replace(/[.!?;:]+$/, "")
      .trim(),
  );
  return name.length > MAX_COLUMN_NAME ? name.slice(0, MAX_COLUMN_NAME) : name;
};

type Col = { kind: "col"; index: number } | { kind: "many"; names: string[] } | undefined;

/** Which column does this text name? A number, the exact name, or one word of the name when that is unambiguous. */
function findColumn(d: TableDraft, text: string, strict = false): Col {
  const cols = d.table.columns;
  const t = text
    .trim()
    .replace(/^(?:the|a)\s+/i, "")
    .replace(/\s+column$/i, "")
    .trim();
  if (t.length === 0) return undefined;
  const n = parseNumber(t);
  if (n !== undefined)
    return n >= 1 && n <= cols.length ? { kind: "col", index: n - 1 } : undefined;
  if (/^last$/i.test(t) && cols.length > 0) return { kind: "col", index: cols.length - 1 };
  const wanted = new Set([t.toLowerCase(), titleCase(t).toLowerCase()]);
  const exact = cols.findIndex((c) => wanted.has(c.name.toLowerCase()));
  if (exact >= 0) return { kind: "col", index: exact };
  if (strict) return undefined;
  const hits = cols
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => {
      const low = c.name.toLowerCase();
      return low.split(/\s+/).includes(t.toLowerCase()) || low.startsWith(t.toLowerCase());
    });
  if (hits.length === 1 && hits[0]) return { kind: "col", index: hits[0].i };
  if (hits.length > 1) return { kind: "many", names: hits.map((h) => h.c.name) };
  return undefined;
}

/** A row by its number ("2", "second", "last"). */
function findRow(d: TableDraft, text: string): number | undefined {
  const rows = d.table.rows;
  const t = text
    .trim()
    .replace(/^(?:the|a)\s+/i, "")
    .replace(/\s+row$/i, "")
    .trim();
  if (/^last$/i.test(t)) return rows.length > 0 ? rows.length - 1 : undefined;
  const n = parseNumber(t);
  return n !== undefined && n >= 1 && n <= rows.length ? n - 1 : undefined;
}

const rowName = (d: TableDraft, i: number): string => {
  const first = d.table.rows[i]?.cells[0] ?? "";
  return first.length > 0 ? `${String(i + 1)} (${first})` : String(i + 1);
};
const colName = (d: TableDraft, i: number): string =>
  `${String(i + 1)} (${d.table.columns[i]?.name ?? ""})`;

const NO_COLUMNS = "Name the columns first: say “columns”, then their names.";

// ----------------------------------------------------------------------------------------------- the steps

const PHASE_NAME: Record<TablePhase, string> = {
  columns: "Columns: say their names, like “property, SQL, NoSQL”",
  rows: "Rows: say a whole row (“schema, fixed, flexible”) or one cell at a time",
  edit: "Edit: fix by number: “cell 2 3 is …”, “delete row 2”, “add column …”",
  think: "Think: say it any way you like, then “draw it”",
};

const applied = (d: TableDraft, echo: string[]): TableStep => ({ kind: "applied", draft: d, echo });
const nothing = (echo: string): TableStep => ({ kind: "nothing", echo: [echo] });

function withTable(
  d: TableDraft,
  table: Table,
  fresh: TableCursor[],
  cursor?: TableCursor,
): TableDraft {
  return { ...d, table, fresh, cursor };
}

/** Adds columns after `after` (a column id, "start" or "end"), keeping the order said. */
function appendColumns(
  table: Table,
  names: readonly string[],
  after: string,
): { table: Table; added: string[]; skipped: string[] } {
  const added: string[] = [];
  const skipped: string[] = [];
  let t = table;
  let at = after;
  for (const raw of names) {
    const name = columnName(raw);
    if (name.length === 0) continue;
    if (t.columns.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      skipped.push(name);
      continue;
    }
    if (t.columns.length >= MAX_COLUMNS) {
      skipped.push(name);
      continue;
    }
    if (t.columns.length === 0) t = createTable([name], true);
    else t = addColumn(t, { name, after: at });
    const index = t.columns.findIndex((c) => c.name === name);
    at = t.columns[index]?.id ?? at;
    added.push(name);
  }
  return { table: t, added, skipped };
}

function columnsAdded(d: TableDraft, names: readonly string[], after = "end"): TableStep {
  const { table, added, skipped } = appendColumns(d.table, names, after);
  const echo: string[] = [];
  if (added.length > 0)
    echo.push(
      `Added ${String(added.length)} column${added.length === 1 ? "" : "s"}: ${added.join(", ")}`,
    );
  const full = skipped.filter(() => table.columns.length >= MAX_COLUMNS);
  if (full.length > 0) echo.push(`A table can have up to ${String(MAX_COLUMNS)} columns.`);
  else if (skipped.length > 0) echo.push(`Already there: ${skipped.join(", ")}`);
  if (added.length === 0) return { kind: "nothing", echo };
  const fresh = added.map((name) => ({
    row: -1,
    col: table.columns.findIndex((c) => c.name === name),
  }));
  return applied(withTable(d, table, fresh, d.cursor), echo);
}

/** A whole row said in one breath: the cells go from the first column on; a short row waits for the rest. */
function rowAdded(d: TableDraft, cells: readonly string[], after = "end"): TableStep {
  const cols = d.table.columns.length;
  if (cols === 0) return nothing(NO_COLUMNS);
  if (cells.length > cols)
    return nothing(
      `That is ${String(cells.length)} cells but there are ${String(cols)} columns. Say “add column …”, or say fewer.`,
    );
  const clean = cells.map(cellText);
  const table = addRow(d.table, { cells: clean, after });
  const at = table.rows.findIndex((r) => !d.table.rows.some((o) => o.id === r.id));
  const fresh = clean.map((_, col) => ({ row: at, col }));
  const cursor = clean.length < cols ? { row: at, col: clean.length } : undefined;
  const shown = clean.length > 0 ? clean.join(" · ") : "(blank)";
  return applied(withTable(d, table, fresh, cursor), [`Row ${String(at + 1)}: ${shown}`]);
}

/** Puts one cell at the cursor, or starts a row with it when no row is open. */
function oneCell(d: TableDraft, text: string): TableStep {
  const cols = d.table.columns.length;
  if (cols === 0) return nothing(NO_COLUMNS);
  const value = cellText(text);
  const open = d.cursor && d.table.rows[d.cursor.row] ? d.cursor : undefined;
  if (!open) {
    const table = addRow(d.table, { cells: [value] });
    const row = table.rows.length - 1;
    const cursor = cols > 1 ? { row, col: 1 } : undefined;
    return applied(withTable(d, table, [{ row, col: 0 }], cursor), [
      `Row ${String(row + 1)}: ${value}`,
    ]);
  }
  const rowId = d.table.rows[open.row]?.id ?? "";
  const colId = d.table.columns[open.col]?.id ?? "";
  const table = setCells(d.table, rowId, [{ col: colId, text: value }]);
  const next = open.col + 1 < cols ? { row: open.row, col: open.col + 1 } : undefined;
  return applied(withTable(d, table, [{ row: open.row, col: open.col }], next), [
    `Row ${String(open.row + 1)}, ${d.table.columns[open.col]?.name ?? ""}: ${value}`,
  ]);
}

function readColumns(d: TableDraft, raw: string): TableStep {
  const body = raw
    .replace(
      /^(?:add\s+)?(?:the\s+)?(?:column names?|columns?|headers?|headings?)\s*[:,-]?\s+/i,
      "",
    )
    .trim();
  const names = splitNames(body);
  if (names.length === 0) return { kind: "nothing", echo: [] };
  if (names.some((n) => n.split(/\s+/).length > 6)) return { kind: "unknown", text: raw };
  return columnsAdded(d, names);
}

function readRows(d: TableDraft, raw: string): TableStep {
  if (d.table.columns.length === 0) return nothing(NO_COLUMNS);
  const parts = splitCells(raw);
  if (parts.length === 0) return { kind: "nothing", echo: [] };
  if (parts.length >= 2) return rowAdded(d, parts);
  return oneCell(d, parts[0] ?? raw);
}

const INSTRUCTION =
  /^(?:make|change|swap|sort|merge|split|replace|fill|copy|duplicate|put|set|insert|remove|delete|clear|add|rename|move|reverse|switch|combine|shorten|expand|translate|highlight|cross|strike|mark)\b/i;

/** "Make the second column wider": a sentence about the table, not a cell, so the model reads it. */
const looksLikeInstruction = (raw: string): boolean =>
  INSTRUCTION.test(raw) && !raw.includes(",") && raw.split(/\s+/).length >= 3;

const NUMBER_WORD = "(?:\\d{1,3}|[a-z]+)";

function command(d: TableDraft, raw: string): TableStep | undefined {
  const t = raw.trim().replace(/[.!?]+$/g, "");
  const low = t.toLowerCase();
  let m: RegExpExecArray | null;

  const shared = sharedCommand(low);
  if (shared === "undo") return { kind: "undo" };
  if (shared === "done") return { kind: "done" };
  if (shared === "cancel") return { kind: "cancel" };
  if (d.phase === "think" && /^draw(?: it| this| that)?(?: now)?$/.test(low))
    return { kind: "draw", text: d.scratch.join("\n") };

  // Rows phase: "new row" ends the open row; "skip" leaves a cell empty.
  if (d.phase === "rows" && /^(?:new|next|another) row$/.test(low))
    return applied({ ...d, cursor: undefined, fresh: [] }, ["New row: say its cells"]);
  if (
    d.cursor &&
    /^(?:skip(?: it| this| that)?|next cell|blank|empty|leave (?:it )?(?:blank|empty)|nothing)$/.test(
      low,
    )
  ) {
    const { row, col } = d.cursor;
    const next = col + 1 < d.table.columns.length ? { row, col: col + 1 } : undefined;
    return applied({ ...d, cursor: next, fresh: [] }, [
      `Left ${d.table.columns[col]?.name ?? "the cell"} empty`,
    ]);
  }

  // Phase words.
  const phaseWord =
    /^(?:(?:go to|switch to|now|next)\s+)?(?:the\s+)?(?:(columns?)|(rows?)|(edit|fine[- ]?tun(?:e|ing)|fix(?:es|ing)?)|(think(?:ing)?|brainstorm|scratch ?pad))(?:\s+(?:phase|mode|step))?$/.exec(
      low,
    );
  if (phaseWord) {
    const phase: TablePhase = phaseWord[1]
      ? "columns"
      : phaseWord[2]
        ? "rows"
        : phaseWord[3]
          ? "edit"
          : "think";
    return applied({ ...d, phase, fresh: [] }, [PHASE_NAME[phase]]);
  }
  // In Think only the words above act; everything else is a note to self.
  if (d.phase === "think") return undefined;

  // "three columns" or "three columns: property, SQL, NoSQL".
  m =
    /^(?:there (?:are|is)\s+|we have\s+|it has\s+|i (?:need|want)\s+|make (?:it\s+)?)?([a-z0-9]+)\s+columns?(?:\s+(?:here|in (?:this|the) table))?\s*(?:[:.,-]\s*|\s+)?(.*)$/i.exec(
      t,
    );
  if (m?.[1] && (d.table.columns.length === 0 || d.phase === "columns")) {
    const count = parseNumber(m[1]);
    if (count !== undefined && count >= 1 && count <= MAX_COLUMNS) {
      const next = { ...d, phase: "columns" as const, wanted: count, fresh: [] };
      const names = m[2] ? splitNames(m[2]) : [];
      if (names.length === 0) return applied(next, [`${String(count)} columns: say their names`]);
      const r = columnsAdded(next, names);
      return r;
    }
  }

  // The first column as the row header.
  m = /^(?:(no|without|remove|turn off)\s+)?(?:the\s+)?(?:row\s+)?header column$/i.exec(t);
  if (m && d.table.columns.length === 0) return nothing(NO_COLUMNS);
  if (m) {
    const on = !m[1];
    return applied({ ...d, table: setHeaderColumn(d.table, on), fresh: [] }, [
      on ? "The first column is the row header" : "No header column",
    ]);
  }
  m =
    /^(?:the\s+)?first column\s+(?:is|as)\s+(?:(not|no)\s+)?(?:a\s+|the\s+)?(?:row\s+)?header$/i.exec(
      t,
    );
  if (m)
    return applied({ ...d, table: setHeaderColumn(d.table, !m[1]), fresh: [] }, [
      m[1] ? "No header column" : "The first column is the row header",
    ]);

  // Delete a row or a column.
  m = /^(?:delete|remove|drop|get rid of)\s+(?:the\s+)?(?:(row|column)\s+)?(.+)$/i.exec(t);
  if (m?.[2]) return deleteWhat(d, m[1]?.toLowerCase(), m[2]);

  // Put a value in one cell, or empty it.
  m = new RegExp(
    `^(?:(?:set|put|make|change)\\s+)?(?:the\\s+)?cell\\s+(?:row\\s+)?(${NUMBER_WORD})\\s*(?:,|and)?\\s*(?:column\\s+)?(.+?)\\s+(?:is|to|as|=|says|should be|equals)\\s+(.+)$`,
    "i",
  ).exec(t);
  const byRowColumn =
    m ??
    new RegExp(
      `^(?:(?:set|put|make|change)\\s+)?(?:the\\s+)?row\\s+(${NUMBER_WORD})\\s*(?:,|and)?\\s*(?:the\\s+)?column\\s+(.+?)\\s+(?:is|to|as|=|says|should be|equals)\\s+(.+)$`,
      "i",
    ).exec(t);
  if (byRowColumn?.[1] && byRowColumn[2] && byRowColumn[3])
    return setCell(d, byRowColumn[1], byRowColumn[2], byRowColumn[3]);
  m = new RegExp(
    `^(?:clear|empty|blank)\\s+(?:the\\s+)?cell\\s+(?:row\\s+)?(${NUMBER_WORD})\\s*(?:,|and)?\\s*(?:column\\s+)?(.+)$`,
    "i",
  ).exec(t);
  if (m?.[1] && m[2]) return setCell(d, m[1], m[2], "");

  // Rename a column.
  m = /^(?:rename|call|change)\s+(?:the\s+)?(column\s+)?(.+?)\s+(?:to|as)\s+(.+)$/i.exec(t);
  if (m?.[2] && m[3]) {
    const f = findColumn(d, m[2]);
    if (f?.kind === "col") {
      const name = columnName(m[3]);
      const table = renameColumn(d.table, d.table.columns[f.index]?.id ?? "", name);
      return applied(withTable(d, table, [{ row: -1, col: f.index }]), [
        `Column ${String(f.index + 1)} is now ${name}`,
      ]);
    }
    if (f?.kind === "many")
      return nothing(`More than one column matches: ${f.names.join(", ")}. Say its number.`);
    if (m[1]) return nothing(`There is no column ${m[2]}.`);
  }

  // Add a column, or a row.
  m =
    /^(?:add|insert|new|create)\s+(?:a\s+|another\s+)?(?:new\s+)?columns?\s*(?:called|named|for)?\s*:?\s*(.*)$/i.exec(
      t,
    );
  if (m) return addColumns(d, m[1] ?? "");
  m =
    /^(?:add|insert|new|create)\s+(?:a\s+|another\s+)?(?:new\s+)?(?:(?:blank|empty)\s+)?row\b\s*(?:(after|before)\s+(?:the\s+)?(?:row\s+)?([a-z0-9]+))?\s*(?::\s*(.*))?$/i.exec(
      t,
    );
  if (m) return addRows(d, m[1]?.toLowerCase(), m[2], m[3]);

  // Move a row or a column.
  m = /^move\s+(?:the\s+)?(row|column)\s+([a-z0-9]+)\s+(.+)$/i.exec(t);
  if (m?.[1] && m[2] && m[3])
    return moveWhat(d, m[1].toLowerCase() as "row" | "column", m[2], m[3]);

  // "row 2: fixed, flexible" fills row 2 (or adds it when it is the next one); "row relationships: joins, ..." is a new row.
  m = /^row\s+(.+?)\s*(?::|\bis\b)\s*(.+)$/i.exec(t);
  if (m?.[1] && m[2] && d.table.columns.length > 0) {
    const n = parseNumber(m[1]);
    const parts = splitCells(m[2]);
    if (n === undefined) {
      if (/\bcolumn\b/i.test(m[1])) return undefined;
      return rowAdded(d, [m[1], ...parts]);
    }
    if (n === d.table.rows.length + 1) return rowAdded(d, parts);
    return fillRow(d, n, parts);
  }

  // "SQL column: fixed, joins, vertical" fills a whole column downwards.
  m =
    /^(?:the\s+)?column\s+(.+?)\s*:\s*(.+)$/i.exec(t) ??
    /^column\s+([a-z0-9]+)\s+(.+)$/i.exec(t) ??
    /^(?:the\s+)?(.+?)\s+column\s*:?\s+(.+)$/i.exec(t);
  if (m?.[1] && m[2] && (t.includes(":") || m[2].includes(","))) {
    const f = findColumn(d, m[1], true);
    if (f?.kind === "col") return fillColumn(d, f.index, splitCells(m[2]));
  }
  return undefined;
}

function deleteWhat(d: TableDraft, kind: string | undefined, what: string): TableStep | undefined {
  const dropRow = (i: number): TableStep => {
    const label = rowName(d, i);
    const table = removeRow(d.table, d.table.rows[i]?.id ?? "");
    return applied(withTable(d, table, []), [`Deleted row ${label}`]);
  };
  const dropColumn = (i: number): TableStep => {
    const label = colName(d, i);
    const table = removeColumn(d.table, d.table.columns[i]?.id ?? "");
    return applied(withTable(d, table, []), [`Deleted column ${label}`]);
  };
  if (kind === "row") {
    const i = findRow(d, what);
    return i === undefined ? nothing(`There is no row ${what}.`) : dropRow(i);
  }
  if (kind === "column") {
    const f = findColumn(d, what);
    if (f?.kind === "col") return dropColumn(f.index);
    if (f?.kind === "many")
      return nothing(`More than one column matches: ${f.names.join(", ")}. Say its number.`);
    return nothing(`There is no column ${what}.`);
  }
  const n = parseNumber(what);
  if (n !== undefined) {
    const row = n >= 1 && n <= d.table.rows.length;
    const col = n >= 1 && n <= d.table.columns.length;
    if (row && col)
      return {
        kind: "ask",
        question: `Delete row ${String(n)} or column ${String(n)}?`,
        options: [
          {
            label: `Row ${rowName(d, n - 1)}`,
            draft: withTable(d, removeRow(d.table, d.table.rows[n - 1]?.id ?? ""), []),
            echo: [`Deleted row ${rowName(d, n - 1)}`],
          },
          {
            label: `Column ${colName(d, n - 1)}`,
            draft: withTable(d, removeColumn(d.table, d.table.columns[n - 1]?.id ?? ""), []),
            echo: [`Deleted column ${colName(d, n - 1)}`],
          },
        ],
      };
    if (row) return dropRow(n - 1);
    if (col) return dropColumn(n - 1);
    return nothing(`There is no row or column ${String(n)}.`);
  }
  const f = findColumn(d, what, true);
  return f?.kind === "col" ? dropColumn(f.index) : undefined;
}

function setCell(d: TableDraft, rowText: string, colText: string, text: string): TableStep {
  const r = findRow(d, rowText);
  if (r === undefined)
    return nothing(`There is no row ${rowText} (the table has ${String(d.table.rows.length)}).`);
  const f = findColumn(d, colText);
  if (f?.kind === "many")
    return nothing(`More than one column matches: ${f.names.join(", ")}. Say its number.`);
  if (f?.kind !== "col") return nothing(`There is no column ${colText}.`);
  const value = cellText(text);
  const table = setCells(d.table, d.table.rows[r]?.id ?? "", [
    { col: d.table.columns[f.index]?.id ?? "", text: value },
  ]);
  return applied(withTable(d, table, [{ row: r, col: f.index }]), [
    value.length > 0
      ? `Row ${String(r + 1)}, ${d.table.columns[f.index]?.name ?? ""}: ${value}`
      : `Cleared row ${String(r + 1)}, ${d.table.columns[f.index]?.name ?? ""}`,
  ]);
}

function fillRow(d: TableDraft, n: number, parts: readonly string[]): TableStep {
  const row = d.table.rows[n - 1];
  if (!row)
    return nothing(`There is no row ${String(n)} (the table has ${String(d.table.rows.length)}).`);
  if (parts.length > d.table.columns.length)
    return nothing(
      `That is ${String(parts.length)} cells but there are ${String(d.table.columns.length)} columns.`,
    );
  const clean = parts.map(cellText);
  const table = setCells(
    d.table,
    row.id,
    clean.map((text, i) => ({ col: d.table.columns[i]?.id ?? "", text })),
  );
  return applied(
    withTable(
      d,
      table,
      clean.map((_, col) => ({ row: n - 1, col })),
    ),
    [`Row ${String(n)}: ${clean.join(" · ")}`],
  );
}

function fillColumn(d: TableDraft, index: number, parts: readonly string[]): TableStep {
  const colId = d.table.columns[index]?.id ?? "";
  let table = d.table;
  const clean = parts.map(cellText);
  clean.forEach((text, i) => {
    if (!table.rows[i]) table = addRow(table, {});
    table = setCells(table, table.rows[i]?.id ?? "", [{ col: colId, text }]);
  });
  return applied(
    withTable(
      d,
      table,
      clean.map((_, row) => ({ row, col: index })),
    ),
    [`Column ${colName(d, index)}: ${clean.join(" · ")}`],
  );
}

function addColumns(d: TableDraft, rest: string): TableStep {
  let names = rest.trim();
  let after = "end";
  const at = /\s*\bat the (start|beginning|front|end)\b\s*$/i.exec(names);
  if (at) {
    after = /end/i.test(at[1] ?? "") ? "end" : "start";
    names = names.slice(0, at.index);
  }
  const pos = /\s+(after|before)\s+(?:the\s+)?(?:column\s+)?(.+)$/i.exec(names);
  if (pos?.[1] && pos[2]) {
    const f = findColumn(d, pos[2]);
    if (f?.kind !== "col") return nothing(`There is no column ${pos[2]}.`);
    if (pos[1].toLowerCase() === "after") after = d.table.columns[f.index]?.id ?? "end";
    else after = f.index === 0 ? "start" : (d.table.columns[f.index - 1]?.id ?? "start");
    names = names.slice(0, pos.index);
  }
  const list = splitNames(names);
  if (list.length === 0) return nothing("Say the name: “add column consistency”.");
  return columnsAdded(d, list, after);
}

function addRows(
  d: TableDraft,
  where: string | undefined,
  ref: string | undefined,
  cells: string | undefined,
): TableStep {
  if (d.table.columns.length === 0) return nothing(NO_COLUMNS);
  let after = "end";
  if (where && ref) {
    const i = findRow(d, ref);
    if (i === undefined) return nothing(`There is no row ${ref}.`);
    after =
      where === "after"
        ? (d.table.rows[i]?.id ?? "end")
        : i === 0
          ? "start"
          : (d.table.rows[i - 1]?.id ?? "start");
  }
  return rowAdded(d, cells ? splitCells(cells) : [], after);
}

function moveWhat(d: TableDraft, kind: "row" | "column", which: string, where: string): TableStep {
  const items = kind === "row" ? d.table.rows : d.table.columns;
  const i =
    kind === "row"
      ? findRow(d, which)
      : (() => {
          const f = findColumn(d, which);
          return f?.kind === "col" ? f.index : undefined;
        })();
  if (i === undefined) return nothing(`There is no ${kind} ${which}.`);
  const ids = items.map((x) => x.id);
  const w = where.toLowerCase().trim();
  let after: string | undefined;
  if (/^(?:up|left|earlier|back)$/.test(w))
    after = i === 0 ? undefined : i === 1 ? "start" : ids[i - 2];
  else if (/^(?:down|right|later|forward)$/.test(w))
    after = i >= ids.length - 1 ? undefined : ids[i + 1];
  else if (/^to the (?:top|start|beginning|front|left)$|^(?:to )?(?:first|top)$/.test(w))
    after = i === 0 ? undefined : "start";
  else if (/^to the (?:bottom|end|right)$|^(?:to )?(?:last|bottom)$/.test(w))
    after = i === ids.length - 1 ? undefined : "end";
  else {
    const rel = /^(after|before)\s+(?:the\s+)?(?:row\s+|column\s+)?(.+)$/.exec(w);
    if (!rel?.[1] || !rel[2]) return { kind: "unknown", text: `move ${kind} ${which} ${where}` };
    const refText = rel[2];
    const refColumn = findColumn(d, refText);
    const j =
      kind === "row"
        ? findRow(d, refText)
        : refColumn?.kind === "col"
          ? refColumn.index
          : undefined;
    if (j === undefined) return nothing(`There is no ${kind} ${rel[2]}.`);
    if (j === i) return nothing(`That is the same ${kind}.`);
    after = rel[1] === "after" ? ids[j] : j === 0 ? "start" : ids[j - 1];
    if (after === ids[i])
      return nothing(`${kind === "row" ? "Row" : "Column"} ${String(i + 1)} is already there.`);
  }
  if (after === undefined)
    return nothing(`${kind === "row" ? "Row" : "Column"} ${String(i + 1)} is already there.`);
  const id = ids[i] ?? "";
  const table = kind === "row" ? moveRow(d.table, id, after) : moveColumn(d.table, id, after);
  const now = (kind === "row" ? table.rows : table.columns).findIndex((x) => x.id === id);
  const fresh = kind === "row" ? [{ row: now, col: 0 }] : [{ row: -1, col: now }];
  return applied(withTable(d, table, fresh), [
    `${kind === "row" ? "Row" : "Column"} ${String(i + 1)} is now ${String(now + 1)}`,
  ]);
}

// ----------------------------------------------------------------------------------------------- the entry point

/** Reads one utterance against a draft. Never throws: a failed step comes back as `nothing` with a reason. */
export function stepTable(draft: TableDraft, utterance: string): TableStep {
  const raw = utterance.trim();
  if (raw.length === 0) return { kind: "nothing", echo: [] };
  try {
    const cmd = command(draft, raw);
    if (cmd) return cmd;
    if (draft.phase === "think")
      return applied({ ...draft, scratch: [...draft.scratch, raw], fresh: [] }, [
        `Noted: ${raw.length > 70 ? `${raw.slice(0, 69)}…` : raw}`,
      ]);
    if (looksLikeInstruction(raw)) return { kind: "unknown", text: raw };
    if (draft.phase === "columns") return readColumns(draft, raw);
    if (draft.phase === "rows") return readRows(draft, raw);
    return { kind: "unknown", text: raw };
  } catch (error) {
    if (error instanceof TableOpError || error instanceof TableInvariantError)
      return { kind: "nothing", echo: [error.message] };
    throw error;
  }
}
