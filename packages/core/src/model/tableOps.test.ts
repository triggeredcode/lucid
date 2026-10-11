import { describe, expect, it } from "vitest";
import { checkTable, type Table } from "./table";
import {
  TableOpError,
  addColumn,
  addRow,
  createTable,
  moveColumn,
  moveRow,
  nextColumnId,
  nextRowId,
  removeColumn,
  removeRow,
  renameColumn,
  setCells,
  setColumnStatus,
  setHeaderColumn,
  setRowStatus,
} from "./tableOps";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Property | SQL | NoSQL with rows Schema, Relationships, Scaling, Use cases. */
function sqlNosql(): Table {
  let t = createTable(["Property", "SQL", "NoSQL"]);
  const rows = [
    ["Schema", "Fixed, predefined", "Flexible"],
    ["Relationships", "Joins, foreign keys", "Denormalised / embedded"],
    ["Scaling", "Vertical", "Horizontal"],
    ["Use cases", "Transactions", "Large-scale reads"],
  ];
  for (const cells of rows) t = addRow(t, { cells });
  return t;
}
const column = (t: Table, i: number) => t.rows.map((r) => r.cells[i]);
const names = (t: Table) => t.columns.map((c) => c.name);
const ids = (items: { id: string }[]) => items.map((i) => i.id);
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return error instanceof TableOpError ? error.code : `other:${String(error)}`;
  }
  return undefined;
};

describe("createTable", () => {
  it("numbers columns c1..cn and turns on the header column from 3 columns up", () => {
    const t = createTable(["Property", "SQL", "NoSQL"]);
    expect(ids(t.columns)).toEqual(["c1", "c2", "c3"]);
    expect(t.headerColumn).toBe(true);
    expect(createTable(["A", "B"]).headerColumn).toBe(false);
    expect(createTable(["A", "B"], true).headerColumn).toBe(true);
    expect(code(() => createTable([]))).toBe("invalid");
    expect(code(() => createTable(["A", " "]))).toBe("invalid");
  });
});

describe("rows", () => {
  it("addRow appends by default and assigns r1, r2, ...", () => {
    const t = sqlNosql();
    expect(ids(t.rows)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(nextRowId(t)).toBe("r5");
  });

  it("add a Consistency row after r3: the canonical example", () => {
    const t = addRow(sqlNosql(), {
      after: "r3",
      cells: ["Consistency", "Strong (ACID)", "Eventual, tunable"],
    });
    expect(t.rows).toHaveLength(5);
    expect(t.rows[3]).toEqual({
      id: "r5",
      cells: ["Consistency", "Strong (ACID)", "Eventual, tunable"],
      status: "normal",
    });
    expect(column(t, 0)).toEqual([
      "Schema",
      "Relationships",
      "Scaling",
      "Consistency",
      "Use cases",
    ]);
  });

  it("supports start, end, unknown anchors, padding and too many cells", () => {
    const t = sqlNosql();
    expect(addRow(t, { after: "start", cells: ["First"] }).rows[0]).toEqual({
      id: "r5",
      cells: ["First", "", ""],
      status: "normal",
    });
    expect(addRow(t, { after: "end" }).rows.at(-1)?.cells).toEqual(["", "", ""]);
    expect(code(() => addRow(t, { after: "r99" }))).toBe("unknown_row");
    expect(code(() => addRow(t, { cells: ["a", "b", "c", "d"] }))).toBe("invalid");
  });

  it("never reuses the id of a removed row while a higher id exists", () => {
    const t = removeRow(sqlNosql(), "r2");
    expect(ids(t.rows)).toEqual(["r1", "r3", "r4"]);
    expect(nextRowId(t)).toBe("r5");
  });

  it("setCells updates only the named cells, by column id", () => {
    const t = setCells(sqlNosql(), "r2", [
      { col: "c3", text: "**Embedded** documents" },
      { col: "c2", text: "Joins" },
    ]);
    expect(t.rows[1]?.cells).toEqual(["Relationships", "Joins", "**Embedded** documents"]);
    expect(t.rows[0]?.cells).toEqual(["Schema", "Fixed, predefined", "Flexible"]);
    expect(code(() => setCells(t, "r99", [{ col: "c1", text: "x" }]))).toBe("unknown_row");
    expect(code(() => setCells(t, "r1", [{ col: "c9", text: "x" }]))).toBe("unknown_column");
  });

  it("removeRow and setRowStatus (strike a row, mark one chosen)", () => {
    const t = sqlNosql();
    expect(ids(removeRow(t, "r1").rows)).toEqual(["r2", "r3", "r4"]);
    expect(setRowStatus(t, "r3", "struck").rows[2]?.status).toBe("struck");
    expect(setRowStatus(t, "r3", "chosen").rows[2]?.status).toBe("chosen");
    expect(code(() => removeRow(t, "r99"))).toBe("unknown_row");
    expect(code(() => setRowStatus(t, "r99", "struck"))).toBe("unknown_row");
  });

  it("moveRow reorders, supports start, and is a no-op onto itself", () => {
    const t = sqlNosql();
    expect(ids(moveRow(t, "r4", "r1").rows)).toEqual(["r1", "r4", "r2", "r3"]);
    expect(ids(moveRow(t, "r3", "start").rows)).toEqual(["r3", "r1", "r2", "r4"]);
    expect(moveRow(t, "r2", "r2")).toBe(t);
    expect(code(() => moveRow(t, "r2", "r99"))).toBe("unknown_row");
    expect(code(() => moveRow(t, "r99", "start"))).toBe("unknown_row");
  });
});

describe("text validation", () => {
  it("rejects multi-line cells and blank or multi-line column names before touching the table", () => {
    const t = sqlNosql();
    expect(code(() => addRow(t, { cells: ["a\nb"] }))).toBe("invalid");
    expect(code(() => setCells(t, "r1", [{ col: "c1", text: "x\ry" }]))).toBe("invalid");
    expect(code(() => addColumn(t, { name: "" }))).toBe("invalid");
    expect(code(() => addColumn(t, { name: "ok", cells: ["a\nb"] }))).toBe("invalid");
  });
});

describe("columns", () => {
  it("addColumn inserts a column and one cell per existing row, padding with empty cells", () => {
    const t = addColumn(sqlNosql(), { name: "Cost", after: "c2", cells: ["Low", "Medium"] });
    expect(names(t)).toEqual(["Property", "SQL", "Cost", "NoSQL"]);
    expect(ids(t.columns)).toEqual(["c1", "c2", "c4", "c3"]);
    expect(column(t, 2)).toEqual(["Low", "Medium", "", ""]);
    expect(column(t, 3)).toEqual([
      "Flexible",
      "Denormalised / embedded",
      "Horizontal",
      "Large-scale reads",
    ]);
    expect(nextColumnId(t)).toBe("c5");
  });

  it("addColumn supports start/end and rejects too many cells or an unknown anchor", () => {
    const t = sqlNosql();
    expect(names(addColumn(t, { name: "Z", after: "start" }))).toEqual([
      "Z",
      "Property",
      "SQL",
      "NoSQL",
    ]);
    expect(names(addColumn(t, { name: "Z" }))).toEqual(["Property", "SQL", "NoSQL", "Z"]);
    expect(code(() => addColumn(t, { name: "Z", cells: ["1", "2", "3", "4", "5"] }))).toBe(
      "invalid",
    );
    expect(code(() => addColumn(t, { name: "Z", after: "c99" }))).toBe("unknown_column");
  });

  it("addColumn works on a table with no rows", () => {
    const t = addColumn(createTable(["A"]), { name: "B" });
    expect(names(t)).toEqual(["A", "B"]);
    expect(t.rows).toEqual([]);
  });

  it("renameColumn and setColumnStatus", () => {
    const t = sqlNosql();
    expect(names(renameColumn(t, "c3", "Document DB"))).toEqual(["Property", "SQL", "Document DB"]);
    expect(setColumnStatus(t, "c2", "struck").columns[1]?.status).toBe("struck");
    expect(code(() => renameColumn(t, "c9", "x"))).toBe("unknown_column");
    expect(code(() => setColumnStatus(t, "c9", "struck"))).toBe("unknown_column");
    expect(code(() => renameColumn(t, "c1", ""))).toBe("invalid");
    expect(code(() => renameColumn(t, "c1", "a\nb"))).toBe("invalid");
  });

  it("removeColumn drops the column and its cells, but never the last column", () => {
    const t = removeColumn(sqlNosql(), "c2");
    expect(names(t)).toEqual(["Property", "NoSQL"]);
    expect(t.rows[0]?.cells).toEqual(["Schema", "Flexible"]);
    const single = createTable(["Only"]);
    expect(code(() => removeColumn(single, "c1"))).toBe("invalid");
    expect(code(() => removeColumn(t, "c99"))).toBe("unknown_column");
  });

  it("moveColumn moves the cells along with the column", () => {
    const t = moveColumn(sqlNosql(), "c3", "c1");
    expect(names(t)).toEqual(["Property", "NoSQL", "SQL"]);
    expect(t.rows[0]?.cells).toEqual(["Schema", "Flexible", "Fixed, predefined"]);
    const first = moveColumn(sqlNosql(), "c3", "start");
    expect(names(first)).toEqual(["NoSQL", "Property", "SQL"]);
    expect(first.rows[3]?.cells).toEqual(["Large-scale reads", "Use cases", "Transactions"]);
    const back = moveColumn(sqlNosql(), "c1", "c3");
    expect(names(back)).toEqual(["SQL", "NoSQL", "Property"]);
    expect(back.rows[0]?.cells).toEqual(["Fixed, predefined", "Flexible", "Schema"]);
    expect(moveColumn(sqlNosql(), "c2", "c2").columns).toHaveLength(3);
    expect(code(() => moveColumn(sqlNosql(), "c2", "c99"))).toBe("unknown_column");
  });

  it("setHeaderColumn toggles the flag", () => {
    expect(setHeaderColumn(sqlNosql(), false).headerColumn).toBe(false);
  });
});

describe("invariants and immutability", () => {
  it("every result satisfies T1-T4", () => {
    let t = sqlNosql();
    t = addColumn(t, { name: "Cost", cells: ["$", "$$"] });
    t = moveColumn(t, "c4", "start");
    t = addRow(t, { after: "r2", cells: ["Backups"] });
    t = removeRow(t, "r1");
    t = removeColumn(t, "c2");
    expect(checkTable(t)).toEqual([]);
  });

  it("no operation mutates its input", () => {
    const t = deepFreeze(sqlNosql());
    expect(() => {
      addRow(t, { after: "r1", cells: ["x"] });
      setCells(t, "r1", [{ col: "c1", text: "y" }]);
      removeRow(t, "r1");
      moveRow(t, "r1", "r3");
      setRowStatus(t, "r1", "struck");
      addColumn(t, { name: "X" });
      renameColumn(t, "c1", "P");
      removeColumn(t, "c3");
      moveColumn(t, "c1", "c3");
      setColumnStatus(t, "c1", "chosen");
      setHeaderColumn(t, false);
    }).not.toThrow();
  });
});
