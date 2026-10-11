import { z } from "zod";
import { StatusSchema } from "./status";

/**
 * Table model. Rows and columns have stable ids (`r1`, `c2`) assigned by the model layer, never
 * by the LLM, so "add a row after r3" keeps working after reorders. Cells hold inline LMD (`**b**`, `*i*`,
 * `~~s~~`, `` `c` ``, `$m$`) as plain strings.
 */

export const COLUMN_ID_PATTERN = /^c\d+$/;
export const ROW_ID_PATTERN = /^r\d+$/;

const singleLine = z.string().regex(/^[^\r\n]*$/, "must be a single line");

export const TableColumnSchema = z.strictObject({
  id: z.string().regex(COLUMN_ID_PATTERN, "must look like c1, c2, ..."),
  name: singleLine.min(1),
  status: StatusSchema,
});
export type TableColumn = z.infer<typeof TableColumnSchema>;

export const TableRowSchema = z.strictObject({
  id: z.string().regex(ROW_ID_PATTERN, "must look like r1, r2, ..."),
  cells: z.array(singleLine),
  status: StatusSchema,
});
export type TableRow = z.infer<typeof TableRowSchema>;

export const TableSchema = z.strictObject({
  columns: z.array(TableColumnSchema),
  rows: z.array(TableRowSchema),
  /** The first column is a row header (comparison tables). Default true when there are 3 or more columns. */
  headerColumn: z.boolean(),
});
export type Table = z.infer<typeof TableSchema>;

export type TableRule = "T1" | "T2" | "T3" | "T4";
export interface TableViolation {
  rule: TableRule;
  message: string;
}

export class TableInvariantError extends Error {
  readonly violations: TableViolation[];
  constructor(violations: TableViolation[]) {
    super(
      `Table invariants violated: ${violations.map((v) => `${v.rule} ${v.message}`).join("; ")}`,
    );
    this.name = "TableInvariantError";
    this.violations = violations;
  }
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes].sort();
}

/**
 * T1 every row has exactly one cell per column. T2 ids are unique and look like c<n> / r<n>.
 * T3 there is at least one column. T4 column names and cells are single-line strings (a name is not blank).
 */
export function checkTable(table: Table): TableViolation[] {
  const out: TableViolation[] = [];
  const add = (rule: TableRule, message: string) => out.push({ rule, message });

  if (table.columns.length === 0) add("T3", "a table needs at least one column");

  for (const r of table.rows) {
    if (r.cells.length !== table.columns.length) {
      add(
        "T1",
        `row ${r.id} has ${String(r.cells.length)} cells but the table has ${String(table.columns.length)} columns`,
      );
    }
  }

  for (const id of duplicates(table.columns.map((c) => c.id)))
    add("T2", `duplicate column id "${id}"`);
  for (const id of duplicates(table.rows.map((r) => r.id))) add("T2", `duplicate row id "${id}"`);
  for (const c of table.columns) {
    if (!COLUMN_ID_PATTERN.test(c.id))
      add("T2", `column id "${c.id}" is not of the form c<number>`);
  }
  for (const r of table.rows) {
    if (!ROW_ID_PATTERN.test(r.id)) add("T2", `row id "${r.id}" is not of the form r<number>`);
  }

  for (const c of table.columns) {
    if (c.name.trim().length === 0) add("T4", `column ${c.id} has an empty name`);
    if (/[\r\n]/.test(c.name)) add("T4", `column ${c.id} name contains a line break`);
  }
  for (const r of table.rows) {
    r.cells.forEach((cell, i) => {
      if (/[\r\n]/.test(cell)) add("T4", `row ${r.id} cell ${String(i + 1)} contains a line break`);
    });
  }
  return out;
}

export function assertTable(table: Table): void {
  const violations = checkTable(table);
  if (violations.length > 0) throw new TableInvariantError(violations);
}
