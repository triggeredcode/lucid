import {
  TableSchema,
  addRow,
  checkTable,
  createTable,
  setRowStatus,
  type Block,
  type Table,
} from "@lucid/core";
import { z } from "zod";
import { clip } from "../../text";
import type { BlockSpec } from "../../spec";
import { statusSuffix, str, withStatus } from "../common";

function tableOf(block: Block): Table | undefined {
  const parsed = TableSchema.safeParse(block.props["table"]);
  return parsed.success ? parsed.data : undefined;
}

const cell = (text: string, max: number): string => clip(text, max);
const tag = (status: string): string => (status === "normal" ? "" : ` {${status}}`);

function sqlNosql(): Table {
  let t = createTable(["Property", "SQL", "NoSQL"]);
  for (const cells of [
    ["Schema", "Fixed, predefined", "Flexible"],
    ["Relationships", "Joins, foreign keys", "Denormalised / embedded"],
    ["Scaling", "Vertical", "Horizontal"],
    ["Use cases", "Transactions", "Large-scale reads"],
  ]) {
    t = addRow(t, { cells });
  }
  return t;
}

function options(): Table {
  let t = createTable(["Option", "Verdict"]);
  t = addRow(t, { cells: ["PostgreSQL", "Joins are not needed"] });
  t = addRow(t, { cells: ["DynamoDB", "Key-value access at scale"] });
  return setRowStatus(setRowStatus(t, "r1", "struck"), "r2", "chosen");
}

export const tableBlock: BlockSpec = {
  type: "table",
  kind: "atom",
  propsSchema: withStatus({
    table: TableSchema,
    caption: z
      .string()
      .regex(/^[^\r\n]*$/, "must be a single line")
      .default(""),
  }),
  describe: [
    "A table for an explicit comparison across attributes: property rows by option columns. Cells are short phrases.",
    "Rows and columns have stable ids (r1, c2); edit them by id. Not for ordinary lists.",
    "LMD: `Table: SQL vs NoSQL` then a pipe table; a row status goes after the last pipe: `| MongoDB | ... | {struck}`",
  ].join("\n"),
  fixtures: [
    { id: "fx-table-1", type: "table", props: { table: sqlNosql(), caption: "SQL vs NoSQL" } },
    { id: "fx-table-2", type: "table", props: { table: options(), caption: "" } },
  ],
  check: (props) => {
    const parsed = TableSchema.safeParse(props["table"]);
    return parsed.success ? checkTable(parsed.data).map((v) => `${v.rule}: ${v.message}`) : [];
  },
  outline: (block, detail) => {
    const t = tableOf(block);
    const caption = str(block, "caption");
    const head = `table${caption ? ` "${caption}"` : ""}${statusSuffix(block)}`;
    if (!t) return head;
    const cols = `cols: ${t.columns.map((c) => `${c.id} ${c.name}${tag(c.status)}`).join(" | ")}`;
    if (detail === "summary") {
      return `${head} ${cols}\n  rows: ${t.rows.map((r) => `${r.id} ${cell(r.cells[0] ?? "", 30)}${tag(r.status)}`).join("; ")}`;
    }
    const rows = t.rows.map(
      (r) => `  ${r.id} ${r.cells.map((c) => cell(c, 60)).join(" | ")}${tag(r.status)}`,
    );
    return [`${head} ${cols}`, ...rows].join("\n");
  },
  toMarkdown: (block) => {
    const t = tableOf(block);
    if (!t) return "";
    const esc = (s: string) => s.replace(/\|/g, "\\|");
    const wrap = (s: string, status: string) =>
      status === "struck" ? `~~${esc(s)}~~` : status === "chosen" ? `**${esc(s)}**` : esc(s);
    const head = `| ${t.columns.map((c) => wrap(c.name, c.status)).join(" | ")} |`;
    const rule = `| ${t.columns.map(() => "---").join(" | ")} |`;
    const rows = t.rows.map(
      (r) =>
        `| ${r.cells.map((c, i) => (i === 0 && r.status === "chosen" ? `${esc(c)} ✓` : wrap(c, r.status))).join(" | ")} |`,
    );
    const caption = str(block, "caption");
    return [...(caption ? [`Table: ${caption}`, ""] : []), head, rule, ...rows].join("\n");
  },
};
