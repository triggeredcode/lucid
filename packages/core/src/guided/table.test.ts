import { describe, expect, it } from "vitest";
import { checkTable } from "../model/table";
import {
  adoptTable,
  cellText,
  draftFromTable,
  newTableDraft,
  stepTable,
  tableChange,
  tableHint,
  tableLegend,
  type TableDraft,
  type TableStep,
} from "./table";

/** Runs a script of utterances, applying each; returns the final draft, every echo and every result. */
function run(
  lines: string[],
  start: TableDraft = newTableDraft(),
): { draft: TableDraft; echo: string[][]; results: TableStep[] } {
  let draft = start;
  const echo: string[][] = [];
  const results: TableStep[] = [];
  for (const line of lines) {
    const r = stepTable(draft, line);
    results.push(r);
    if (r.kind === "applied") {
      draft = r.draft;
      echo.push(r.echo);
    } else if (r.kind === "nothing") echo.push(r.echo);
    else echo.push([r.kind]);
  }
  return { draft, echo, results };
}

const cols = (d: TableDraft) => d.table.columns.map((c) => c.name);
const rows = (d: TableDraft) => d.table.rows.map((r) => r.cells);

/** Three columns and three rows, ready to edit. */
const sql = () =>
  run([
    "three columns: property, SQL, NoSQL",
    "rows",
    "schema, fixed, flexible",
    "relationships, joins, denormalised",
    "scaling, vertical, horizontal",
  ]).draft;

describe("columns", () => {
  it("reads 'three columns: property, SQL, NoSQL' and remembers how many were promised", () => {
    const { draft, echo } = run(["three columns: property, SQL, NoSQL"]);
    expect(cols(draft)).toEqual(["Property", "SQL", "NoSQL"]);
    expect(draft.wanted).toBe(3);
    expect(draft.phase).toBe("columns");
    expect(echo[0]).toEqual(["Added 3 columns: Property, SQL, NoSQL"]);
    expect(draft.table.headerColumn).toBe(true);
  });

  it("accepts the count first, then the names", () => {
    const { draft, echo } = run(["there are three columns here", "property, SQL and NoSQL"]);
    expect(echo[0]).toEqual(["3 columns: say their names"]);
    expect(cols(draft)).toEqual(["Property", "SQL", "NoSQL"]);
  });

  it("reads plain names with spoken lead-ins and Wispr's punctuation", () => {
    const { draft } = run(["Columns: option, time complexity, notes."]);
    expect(cols(draft)).toEqual(["Option", "Time Complexity", "Notes"]);
  });

  it("does not add a column twice and stops at eight", () => {
    const { draft, echo } = run(["a, b, c", "B, d"]);
    expect(cols(draft)).toEqual(["A", "B", "C", "D"]);
    expect(echo[1]?.join(" ")).toContain("Already there: B");
    const many = run(["a, b, c, d, e, f, g, h, i"]);
    expect(many.draft.table.columns).toHaveLength(8);
    expect(many.echo[0]?.join(" ")).toContain("up to 8 columns");
  });

  it("hands a long sentence to the model instead of making a column of it", () => {
    const r = stepTable(
      newTableDraft(),
      "I want to compare the two kinds of databases for the exam",
    );
    expect(r.kind).toBe("unknown");
  });
});

describe("rows", () => {
  it("takes a whole row per phrase, in the order the columns were said", () => {
    const d = sql();
    expect(rows(d)).toEqual([
      ["Schema", "Fixed", "Flexible"],
      ["Relationships", "Joins", "Denormalised"],
      ["Scaling", "Vertical", "Horizontal"],
    ]);
  });

  it("fills one cell per phrase, row after row, when a phrase has no commas", () => {
    const start = run(["property, SQL, NoSQL", "rows"]).draft;
    const { draft, echo } = run(
      ["schema", "fixed", "flexible", "scaling", "vertical", "horizontal"],
      start,
    );
    expect(rows(draft)).toEqual([
      ["Schema", "Fixed", "Flexible"],
      ["Scaling", "Vertical", "Horizontal"],
    ]);
    expect(draft.cursor).toBeUndefined();
    expect(echo[1]).toEqual(["Row 1, SQL: Fixed"]);
  });

  it("lets 'skip' leave a cell empty and 'new row' end a short row", () => {
    const start = run(["property, SQL, NoSQL", "rows"]).draft;
    const { draft } = run(
      ["schema", "skip", "flexible", "scaling", "vertical", "new row", "use"],
      start,
    );
    expect(rows(draft)).toEqual([
      ["Schema", "", "Flexible"],
      ["Scaling", "Vertical", ""],
      ["Use", "", ""],
    ]);
  });

  it("finishes a short row with single phrases", () => {
    const start = run(["property, SQL, NoSQL", "rows"]).draft;
    const { draft } = run(["schema, fixed", "flexible"], start);
    expect(rows(draft)).toEqual([["Schema", "Fixed", "Flexible"]]);
  });

  it("refuses a row with more cells than columns, without changing anything", () => {
    const start = run(["a, b", "rows"]).draft;
    const { draft, results } = run(["x, y, z"], start);
    expect(results[0]?.kind).toBe("nothing");
    expect(draft.table.rows).toHaveLength(0);
  });

  it("names the row in the phrase: 'row relationships: joins, denormalised'", () => {
    const start = run(["property, SQL, NoSQL", "rows"]).draft;
    const { draft } = run(["row relationships: joins, denormalised"], start);
    expect(rows(draft)).toEqual([["Relationships", "Joins", "Denormalised"]]);
  });

  it("fills a whole column downwards: 'SQL column: fixed, joins, vertical'", () => {
    const start = run(["property, SQL, NoSQL", "rows"]).draft;
    const { draft } = run(
      ["SQL column: fixed, joins, vertical", "column 3: flexible, embedded"],
      start,
    );
    expect(rows(draft)).toEqual([
      ["", "Fixed", "Flexible"],
      ["", "Joins", "Embedded"],
      ["", "Vertical", ""],
    ]);
  });

  it("keeps thousands together and tidies each cell", () => {
    const start = run(["metric, value", "rows"]).draft;
    const { draft } = run(["throughput, 1,000 requests per second."], start);
    expect(rows(draft)).toEqual([["Throughput", "1,000 requests per second"]]);
    expect(cellText("vLLM")).toBe("vLLM");
    expect(cellText('"fixed schema".')).toBe("Fixed schema");
  });

  it("asks for the columns first when there are none", () => {
    const { results } = run(["schema, fixed"], newTableDraft("rows"));
    expect(results[0]).toMatchObject({ kind: "nothing" });
  });
});

describe("edit", () => {
  it("sets and clears a cell by number or by column name", () => {
    const { draft } = run(
      ["edit", "cell 2 3 is embedded", "row 3 column SQL is vertical scaling", "clear cell 1 2"],
      sql(),
    );
    expect(rows(draft)).toEqual([
      ["Schema", "", "Flexible"],
      ["Relationships", "Joins", "Embedded"],
      ["Scaling", "Vertical scaling", "Horizontal"],
    ]);
  });

  it("deletes, renames, adds and moves", () => {
    const { draft } = run(
      [
        "edit",
        "delete row 1",
        "rename column 2 to relational",
        "add column consistency",
        "add column cost after column 1",
        "move column 5 to the start",
        "move row 2 up",
        "add row",
      ],
      sql(),
    );
    expect(cols(draft)).toEqual(["Consistency", "Property", "Cost", "Relational", "NoSQL"]);
    expect(rows(draft)[0]).toEqual(["", "Scaling", "", "Vertical", "Horizontal"]);
    expect(rows(draft)).toHaveLength(3);
    expect(draft.cursor).toEqual({ row: 2, col: 0 });
  });

  it("asks when a bare number could be a row or a column, then follows the answer", () => {
    const r = stepTable({ ...sql(), phase: "edit" }, "delete 2");
    expect(r.kind).toBe("ask");
    if (r.kind === "ask") {
      expect(r.question).toBe("Delete row 2 or column 2?");
      expect(r.options[0]?.draft.table.rows).toHaveLength(2);
      expect(r.options[1]?.draft.table.columns).toHaveLength(2);
    }
  });

  it("deletes the only possible one without asking, and refuses to delete the last column", () => {
    const one = run(["a", "edit", "delete column 1"]);
    expect(one.results[2]).toMatchObject({ kind: "nothing" });
    expect(cols(one.draft)).toEqual(["A"]);
    const two = run(["a, b", "rows", "x, y", "edit", "delete 2"]);
    expect(cols(two.draft)).toEqual(["A"]);
  });

  it("numbers rows and columns by their place, so the numbers close up after a delete", () => {
    const { draft } = run(["delete row 1", "cell 1 2 is changed"], { ...sql(), phase: "edit" });
    expect(rows(draft)[0]).toEqual(["Relationships", "Changed", "Denormalised"]);
  });

  it("says what it could not find instead of changing something else", () => {
    const { draft, echo } = run(
      ["cell 9 1 is x", "delete column cost", "rename column 7 to y", "move row 1 up"],
      { ...sql(), phase: "edit" },
    );
    expect(rows(draft)).toEqual(rows(sql()));
    expect(echo.map((e) => e[0])).toEqual([
      "There is no row 9 (the table has 3).",
      "There is no column cost.",
      "There is no column 7.",
      "Row 1 is already there.",
    ]);
  });

  it("turns the header column off and on", () => {
    const off = run(["no header column"], sql());
    expect(off.draft.table.headerColumn).toBe(false);
    expect(run(["header column"], off.draft).draft.table.headerColumn).toBe(true);
  });

  it("hands what it cannot read to the model, in Edit and for instructions anywhere", () => {
    expect(stepTable({ ...sql(), phase: "edit" }, "swap the order of the first two").kind).toBe(
      "unknown",
    );
    expect(stepTable(sql(), "make the second column wider please").kind).toBe("unknown");
    // ...but a row that merely starts with such a word is still a row.
    const { draft } = run(["clear cache, evict, expire"], { ...sql(), phase: "rows" });
    expect(rows(draft).at(-1)).toEqual(["Clear cache", "Evict", "Expire"]);
  });
});

describe("think, undo and the controls", () => {
  it("collects notes in Think without running them, and 'draw it' asks for the drawing", () => {
    const { draft, results } = run(
      ["think", "delete row 1", "actually three columns", "draw it"],
      sql(),
    );
    expect(draft.scratch).toEqual(["delete row 1", "actually three columns"]);
    expect(draft.table.rows).toHaveLength(3);
    expect(results.at(-1)).toEqual({ kind: "draw", text: "delete row 1\nactually three columns" });
  });

  it("leaves undo, done and cancel to the caller", () => {
    expect(stepTable(sql(), "undo").kind).toBe("undo");
    expect(stepTable(sql(), "scratch that").kind).toBe("undo");
    expect(stepTable(sql(), "insert the table").kind).toBe("done");
    expect(stepTable(sql(), "cancel").kind).toBe("cancel");
  });

  it("switches phase by name at any time", () => {
    const { draft } = run(["rows", "columns", "edit", "think"], sql());
    expect(draft.phase).toBe("think");
  });
});

describe("working with the model", () => {
  it("tells the model which number means what", () => {
    const hint = tableHint(sql());
    expect(hint).toContain("1 = c1 (Property)");
    expect(hint).toContain("3 = r3 (Scaling)");
  });

  it("adopts the model's table and forgets the open row", () => {
    const d = { ...sql(), cursor: { row: 1, col: 1 } };
    const t = { ...d.table, rows: d.table.rows.slice(0, 1) };
    const adopted = adoptTable(d, t);
    expect(adopted.table.rows).toHaveLength(1);
    expect(adopted.cursor).toBeUndefined();
    expect(adopted.phase).toBe(d.phase);
  });

  it("opens an existing table for editing, with a legend of what is empty", () => {
    const d = draftFromTable(run(["a, b", "rows", "x"]).draft.table);
    expect(d.phase).toBe("edit");
    expect(tableLegend(d)).toMatchObject({ emptyCells: 1, wanted: 2 });
  });
});

describe("saying what a model fix changed", () => {
  it("lists changed cells, added and removed rows and columns, and says nothing when nothing changed", () => {
    const d = sql();
    expect(tableChange(d.table, d.table)).toBe("");
    const after = run(
      [
        "cell 1 3 is bendy",
        "cell 3 3 is wide",
        "delete row 2",
        "add column cost",
        "rename column 2 to relational",
      ],
      { ...d, phase: "edit" },
    ).draft.table;
    expect(tableChange(d.table, after)).toBe(
      "added column Cost; renamed Relational; removed 1 row; 2 cells: row 1 NoSQL, row 2 NoSQL",
    );
  });
});

describe("robustness", () => {
  it("never throws and always leaves a valid table, whatever is said", () => {
    const pieces = [
      "name",
      "price",
      "three columns",
      "rows",
      "columns",
      "edit",
      "delete",
      "row",
      "column",
      "1",
      "2",
      "7",
      "cell",
      "is",
      "to",
      "move",
      "up",
      "left",
      "add",
      "rename",
      "clear",
      "skip",
      "new row",
      "undo",
      "done",
      ",",
      ":",
      "after",
      "before",
      "the",
      "think",
      "header column",
      "last",
    ];
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let round = 0; round < 400; round++) {
      let d = round % 2 === 0 ? newTableDraft() : { ...sql(), phase: "edit" as const };
      for (let turn = 0; turn < 8; turn++) {
        const n = 1 + Math.floor(rnd() * 6);
        const text = Array.from(
          { length: n },
          () => pieces[Math.floor(rnd() * pieces.length)],
        ).join(" ");
        const r = stepTable(d, text);
        if (r.kind === "applied") d = r.draft;
        if (r.kind === "ask" && r.options[0]) d = r.options[0].draft;
        if (d.table.columns.length > 0) expect(checkTable(d.table)).toEqual([]);
        if (d.cursor) {
          expect(d.table.rows[d.cursor.row]).toBeDefined();
          expect(d.cursor.col).toBeLessThan(d.table.columns.length);
        }
      }
    }
  });
});
