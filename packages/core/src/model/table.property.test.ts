import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkTable, type Table } from "./table";
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
  setColumnStatus,
  setHeaderColumn,
  setRowStatus,
} from "./tableOps";

// Property P-table (rules T1-T4): after ANY sequence of table ops every success satisfies the invariants,
// every failure is a TableOpError that changes nothing, and no op mutates its input.

const TEXT = ["", "x", "**bold**", "a | b", "a very long cell with `code` and $x^2$"] as const;
const STATUSES = ["normal", "struck", "chosen"] as const;
const n = (max: number) => fc.integer({ min: 0, max });

type Cmd =
  | { k: "addRow"; after: number; cells: number[] }
  | { k: "setCells"; row: number; col: number; text: number }
  | { k: "removeRow"; row: number }
  | { k: "moveRow"; row: number; after: number }
  | { k: "rowStatus"; row: number; status: number }
  | { k: "addColumn"; after: number; cells: number[] }
  | { k: "renameColumn"; col: number; name: number }
  | { k: "removeColumn"; col: number }
  | { k: "moveColumn"; col: number; after: number }
  | { k: "columnStatus"; col: number; status: number }
  | { k: "header"; on: boolean };

const ALL_KINDS = [
  "addColumn",
  "addRow",
  "columnStatus",
  "header",
  "moveColumn",
  "moveRow",
  "removeColumn",
  "removeRow",
  "renameColumn",
  "rowStatus",
  "setCells",
];

const cmdArb: fc.Arbitrary<Cmd> = fc.oneof(
  fc.record({
    k: fc.constant("addRow" as const),
    after: n(8),
    cells: fc.array(n(4), { maxLength: 5 }),
  }),
  fc.record({ k: fc.constant("setCells" as const), row: n(8), col: n(6), text: n(4) }),
  fc.record({ k: fc.constant("removeRow" as const), row: n(8) }),
  fc.record({ k: fc.constant("moveRow" as const), row: n(8), after: n(8) }),
  fc.record({ k: fc.constant("rowStatus" as const), row: n(8), status: n(2) }),
  fc.record({
    k: fc.constant("addColumn" as const),
    after: n(8),
    cells: fc.array(n(4), { maxLength: 6 }),
  }),
  fc.record({ k: fc.constant("renameColumn" as const), col: n(6), name: n(4) }),
  fc.record({ k: fc.constant("removeColumn" as const), col: n(6) }),
  fc.record({ k: fc.constant("moveColumn" as const), col: n(6), after: n(8) }),
  fc.record({ k: fc.constant("columnStatus" as const), col: n(6), status: n(2) }),
  fc.record({ k: fc.constant("header" as const), on: fc.boolean() }),
);

const text = (i: number) => TEXT[i] ?? "x";
/** An existing id most of the time, a made-up one sometimes so error paths are exercised. */
const rowId = (t: Table, i: number) =>
  t.rows.length === 0 ? "r99" : (t.rows[i % t.rows.length]?.id ?? "r99");
const colId = (t: Table, i: number) =>
  t.columns.length === 0 ? "c99" : (t.columns[i % t.columns.length]?.id ?? "c99");
/** "start", "end", or an existing/made-up id. */
const anchor = (items: { id: string }[], i: number, prefix: string) =>
  i === 7 ? "start" : i === 8 ? "end" : (items[i % Math.max(1, items.length)]?.id ?? `${prefix}99`);

function apply(t: Table, cmd: Cmd): Table {
  switch (cmd.k) {
    case "addRow":
      return addRow(t, { after: anchor(t.rows, cmd.after, "r"), cells: cmd.cells.map(text) });
    case "setCells":
      return setCells(t, rowId(t, cmd.row), [{ col: colId(t, cmd.col), text: text(cmd.text) }]);
    case "removeRow":
      return removeRow(t, rowId(t, cmd.row));
    case "moveRow": {
      const a = anchor(t.rows, cmd.after, "r");
      return moveRow(t, rowId(t, cmd.row), a === "end" ? "start" : a);
    }
    case "rowStatus":
      return setRowStatus(t, rowId(t, cmd.row), STATUSES[cmd.status] ?? "normal");
    case "addColumn":
      return addColumn(t, {
        name: "New",
        after: anchor(t.columns, cmd.after, "c"),
        cells: cmd.cells.map(text),
      });
    case "renameColumn":
      return renameColumn(t, colId(t, cmd.col), text(cmd.name));
    case "removeColumn":
      return removeColumn(t, colId(t, cmd.col));
    case "moveColumn": {
      const a = anchor(t.columns, cmd.after, "c");
      return moveColumn(t, colId(t, cmd.col), a === "end" ? "start" : a);
    }
    case "columnStatus":
      return setColumnStatus(t, colId(t, cmd.col), STATUSES[cmd.status] ?? "normal");
    case "header":
      return setHeaderColumn(t, cmd.on);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function seed(): Table {
  let t = createTable(["Property", "SQL", "NoSQL"]);
  t = addRow(t, { cells: ["Schema", "Fixed", "Flexible"] });
  t = addRow(t, { cells: ["Scaling", "Vertical", "Horizontal"] });
  return t;
}

describe("table ops (property tests)", () => {
  it("any op sequence keeps T1-T4, failed ops are TableOpErrors that change nothing, inputs are never mutated", () => {
    let applied = 0;
    const succeeded = new Set<string>();
    fc.assert(
      fc.property(fc.array(cmdArb, { maxLength: 40 }), (cmds) => {
        let t = deepFreeze(seed());
        for (const cmd of cmds) {
          const before = JSON.stringify(t);
          try {
            t = deepFreeze(apply(t, cmd));
            applied++;
            succeeded.add(cmd.k);
            expect(checkTable(t)).toEqual([]);
          } catch (error) {
            // The only acceptable failure is a deliberate TableOpError (unknown id, bad text, ...).
            expect(error).toBeInstanceOf(TableOpError);
            expect(JSON.stringify(t)).toBe(before);
          }
        }
      }),
      { numRuns: 1000 },
    );
    expect(applied).toBeGreaterThan(2500);
    expect([...succeeded].sort()).toEqual(ALL_KINDS);
  });
});
