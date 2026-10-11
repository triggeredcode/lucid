import { describe, expect, it } from "vitest";
import { TableInvariantError, TableSchema, assertTable, checkTable, type Table } from "./table";

const table = (over: Partial<Table> = {}): Table => ({
  columns: [
    { id: "c1", name: "Property", status: "normal" },
    { id: "c2", name: "SQL", status: "normal" },
    { id: "c3", name: "NoSQL", status: "normal" },
  ],
  rows: [
    { id: "r1", cells: ["Schema", "Fixed", "Flexible"], status: "normal" },
    { id: "r2", cells: ["Scaling", "Vertical", "Horizontal"], status: "normal" },
  ],
  headerColumn: true,
  ...over,
});
const rules = (t: Table) => checkTable(t).map((v) => v.rule);

describe("TableSchema", () => {
  it("accepts a valid table and rejects unknown keys and malformed ids", () => {
    expect(TableSchema.parse(table())).toEqual(table());
    expect(() => TableSchema.parse({ ...table(), extra: 1 })).toThrow();
    const badColumn = table({ columns: [{ id: "col1", name: "A", status: "normal" }], rows: [] });
    expect(() => TableSchema.parse(badColumn)).toThrow();
    const badRow = table({ rows: [{ id: "row1", cells: ["a", "b", "c"], status: "normal" }] });
    expect(() => TableSchema.parse(badRow)).toThrow();
  });

  it("rejects a hidden status (only graphs have it) and an empty column name", () => {
    expect(() =>
      TableSchema.parse(
        table({ columns: [{ id: "c1", name: "A", status: "hidden" as "normal" }], rows: [] }),
      ),
    ).toThrow();
    expect(() =>
      TableSchema.parse(table({ columns: [{ id: "c1", name: "", status: "normal" }], rows: [] })),
    ).toThrow();
  });
});

describe("checkTable", () => {
  it("accepts valid tables, including one with no rows", () => {
    expect(checkTable(table())).toEqual([]);
    expect(checkTable(table({ rows: [] }))).toEqual([]);
    expect(() => {
      assertTable(table());
    }).not.toThrow();
  });

  it("T1: every row needs one cell per column", () => {
    const short = table({ rows: [{ id: "r1", cells: ["a", "b"], status: "normal" }] });
    const long = table({ rows: [{ id: "r1", cells: ["a", "b", "c", "d"], status: "normal" }] });
    expect(rules(short)).toEqual(["T1"]);
    expect(rules(long)).toEqual(["T1"]);
  });

  it("T2: ids are unique and look like c<n> / r<n>", () => {
    const dupRows = table({
      rows: [
        { id: "r1", cells: ["a", "b", "c"], status: "normal" },
        { id: "r1", cells: ["d", "e", "f"], status: "normal" },
      ],
    });
    expect(rules(dupRows)).toEqual(["T2"]);
    const dupCols = table({
      columns: [
        { id: "c1", name: "A", status: "normal" },
        { id: "c1", name: "B", status: "normal" },
      ],
      rows: [],
    });
    expect(rules(dupCols)).toEqual(["T2"]);
    expect(
      rules(table({ rows: [{ id: "x9", cells: ["a", "b", "c"], status: "normal" }] })),
    ).toEqual(["T2"]);
    expect(
      rules(table({ columns: [{ id: "colA", name: "A", status: "normal" }], rows: [] })),
    ).toEqual(["T2"]);
  });

  it("T3: at least one column", () => {
    expect(rules(table({ columns: [], rows: [] }))).toEqual(["T3"]);
  });

  it("T4: names are not blank and nothing contains a line break", () => {
    expect(
      rules(table({ columns: [{ id: "c1", name: "  ", status: "normal" }], rows: [] })),
    ).toEqual(["T4"]);
    expect(
      rules(table({ columns: [{ id: "c1", name: "a\nb", status: "normal" }], rows: [] })),
    ).toEqual(["T4"]);
    expect(
      rules(table({ rows: [{ id: "r1", cells: ["a", "b\nc", "d"], status: "normal" }] })),
    ).toEqual(["T4"]);
  });

  it("reports every violation, not just the first", () => {
    const t = table({
      columns: [],
      rows: [{ id: "bad", cells: ["x"], status: "normal" }],
    });
    expect(new Set(rules(t))).toEqual(new Set(["T1", "T2", "T3"]));
    try {
      assertTable(t);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TableInvariantError);
      expect((error as TableInvariantError).violations.length).toBeGreaterThanOrEqual(3);
    }
  });
});
