import { nextNumberedId } from "./ids";
import type { Status } from "./status";
import { assertTable, type Table, type TableColumn, type TableRow } from "./table";

/**
 * Pure table edits. Every function returns a new Table and never mutates its input.
 * Invalid requests throw a TableOpError and leave the caller's table untouched; every success satisfies
 * invariants T1-T4 (asserted before returning).
 */

export type TableOpErrorCode = "unknown_row" | "unknown_column" | "invalid";

export class TableOpError extends Error {
  readonly code: TableOpErrorCode;
  constructor(code: TableOpErrorCode, message: string) {
    super(message);
    this.name = "TableOpError";
    this.code = code;
  }
}

/**
 * Where to put a new or moved item: "start", "end", or the id of the item to go after. Ids look like r3 / c2,
 * so they can never collide with the two keywords.
 */
export type After = string;

/** User-supplied text must be a single line; column names must also not be blank. */
function requireText(what: string, value: string, opts: { nonBlank?: boolean } = {}): void {
  if (/[\r\n]/.test(value)) throw new TableOpError("invalid", `${what} must be a single line`);
  if (opts.nonBlank && value.trim().length === 0)
    throw new TableOpError("invalid", `${what} must not be blank`);
}

const finish = (table: Table): Table => {
  assertTable(table);
  return table;
};

/** Create a table from column names (ids c1..cn, no rows). Comparison tables get a header column. */
export function createTable(columnNames: readonly string[], headerColumn?: boolean): Table {
  if (columnNames.length === 0)
    throw new TableOpError("invalid", "a table needs at least one column");
  for (const name of columnNames) requireText("column name", name, { nonBlank: true });
  return finish({
    columns: columnNames.map((name, i) => ({
      id: `c${String(i + 1)}`,
      name,
      status: "normal" as const,
    })),
    rows: [],
    headerColumn: headerColumn ?? columnNames.length >= 3,
  });
}

export const nextRowId = (table: Table): string =>
  nextNumberedId(
    "r",
    table.rows.map((r) => r.id),
  );
export const nextColumnId = (table: Table): string =>
  nextNumberedId(
    "c",
    table.columns.map((c) => c.id),
  );

function row(table: Table, id: string): TableRow {
  const found = table.rows.find((r) => r.id === id);
  if (!found) throw new TableOpError("unknown_row", `unknown row "${id}"`);
  return found;
}

function column(table: Table, id: string): TableColumn {
  const found = table.columns.find((c) => c.id === id);
  if (!found) throw new TableOpError("unknown_column", `unknown column "${id}"`);
  return found;
}

/** Index at which to insert so the new item lands `after` the reference. */
function insertionIndex(
  items: readonly { id: string }[],
  after: After,
  missing: (id: string) => never,
): number {
  if (after === "start") return 0;
  if (after === "end") return items.length;
  const index = items.findIndex((item) => item.id === after);
  if (index < 0) return missing(after);
  return index + 1;
}

const noRow = (id: string): never => {
  throw new TableOpError("unknown_row", `unknown row "${id}"`);
};
const noColumn = (id: string): never => {
  throw new TableOpError("unknown_column", `unknown column "${id}"`);
};

/** Cells for a new row or column: fewer than needed are padded with "", more than needed is an error. */
function padded(cells: readonly string[], size: number, what: string): string[] {
  for (const cell of cells) requireText("cell", cell);
  if (cells.length > size) {
    throw new TableOpError(
      "invalid",
      `${what}: got ${String(cells.length)} cells but there are only ${String(size)}`,
    );
  }
  return [...cells, ...Array.from({ length: size - cells.length }, () => "")];
}

export function addRow(
  table: Table,
  spec: { after?: After; cells?: readonly string[]; status?: Status } = {},
): Table {
  const cells = padded(spec.cells ?? [], table.columns.length, "new row");
  const at = insertionIndex(table.rows, spec.after ?? "end", noRow);
  const created: TableRow = { id: nextRowId(table), cells, status: spec.status ?? "normal" };
  return finish({ ...table, rows: [...table.rows.slice(0, at), created, ...table.rows.slice(at)] });
}

/** Set individual cells of a row, addressed by column id. Other cells are left alone. */
export function setCells(
  table: Table,
  rowId: string,
  updates: readonly { col: string; text: string }[],
): Table {
  const target = row(table, rowId);
  const cells = [...target.cells];
  for (const u of updates) {
    requireText("cell", u.text);
    const index = table.columns.findIndex((c) => c.id === u.col);
    if (index < 0) noColumn(u.col);
    cells[index] = u.text;
  }
  return finish({ ...table, rows: table.rows.map((r) => (r.id === rowId ? { ...r, cells } : r)) });
}

export function removeRow(table: Table, rowId: string): Table {
  row(table, rowId);
  return finish({ ...table, rows: table.rows.filter((r) => r.id !== rowId) });
}

export function moveRow(table: Table, rowId: string, after: After): Table {
  const moving = row(table, rowId);
  if (after === rowId) return table;
  const rest = table.rows.filter((r) => r.id !== rowId);
  const at = insertionIndex(rest, after, noRow);
  return finish({ ...table, rows: [...rest.slice(0, at), moving, ...rest.slice(at)] });
}

export function setRowStatus(table: Table, rowId: string, status: Status): Table {
  row(table, rowId);
  return finish({ ...table, rows: table.rows.map((r) => (r.id === rowId ? { ...r, status } : r)) });
}

export function addColumn(
  table: Table,
  spec: { name: string; after?: After; cells?: readonly string[]; status?: Status },
): Table {
  requireText("column name", spec.name, { nonBlank: true });
  const values = padded(spec.cells ?? [], table.rows.length, `new column "${spec.name}"`);
  const at = insertionIndex(table.columns, spec.after ?? "end", noColumn);
  const created: TableColumn = {
    id: nextColumnId(table),
    name: spec.name,
    status: spec.status ?? "normal",
  };
  return finish({
    ...table,
    columns: [...table.columns.slice(0, at), created, ...table.columns.slice(at)],
    rows: table.rows.map((r, i) => ({
      ...r,
      cells: [...r.cells.slice(0, at), values[i] ?? "", ...r.cells.slice(at)],
    })),
  });
}

export function renameColumn(table: Table, columnId: string, name: string): Table {
  column(table, columnId);
  requireText("column name", name, { nonBlank: true });
  return finish({
    ...table,
    columns: table.columns.map((c) => (c.id === columnId ? { ...c, name } : c)),
  });
}

export function removeColumn(table: Table, columnId: string): Table {
  column(table, columnId);
  if (table.columns.length === 1) {
    throw new TableOpError(
      "invalid",
      "a table needs at least one column; remove the table instead",
    );
  }
  const index = table.columns.findIndex((c) => c.id === columnId);
  return finish({
    ...table,
    columns: table.columns.filter((c) => c.id !== columnId),
    rows: table.rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => i !== index) })),
  });
}

export function moveColumn(table: Table, columnId: string, after: After): Table {
  const moving = column(table, columnId);
  if (after === columnId) return table;
  const from = table.columns.findIndex((c) => c.id === columnId);
  const rest = table.columns.filter((c) => c.id !== columnId);
  const at = insertionIndex(rest, after, noColumn);
  return finish({
    ...table,
    columns: [...rest.slice(0, at), moving, ...rest.slice(at)],
    rows: table.rows.map((r) => {
      const cell = r.cells[from] ?? "";
      const others = r.cells.filter((_, i) => i !== from);
      return { ...r, cells: [...others.slice(0, at), cell, ...others.slice(at)] };
    }),
  });
}

export function setColumnStatus(table: Table, columnId: string, status: Status): Table {
  column(table, columnId);
  return finish({
    ...table,
    columns: table.columns.map((c) => (c.id === columnId ? { ...c, status } : c)),
  });
}

export function setHeaderColumn(table: Table, headerColumn: boolean): Table {
  return finish({ ...table, headerColumn });
}
