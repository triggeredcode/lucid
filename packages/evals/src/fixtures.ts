import { getFormat, skeleton } from "@lucid/kit";
import { COMMAND_DOC } from "@lucid/llm";
import type { Block, LucidDoc } from "@lucid/core";
import type { FixtureName } from "./types";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const t = (text: string) => [{ type: "text" as const, text, styles: {} }];
const heading = (id: string, level: number, text: string): Block => ({
  id,
  type: "heading",
  props: { level },
  content: t(text),
});
const bullet = (id: string, text: string): Block => ({
  id,
  type: "bulletListItem",
  props: {},
  content: t(text),
});

const table = (id: string, caption: string, columns: string[], rows: string[][]): Block => ({
  id,
  type: "table",
  props: {
    caption,
    table: {
      columns: columns.map((name, i) => ({ id: `c${String(i + 1)}`, name, status: "normal" })),
      rows: rows.map((cells, i) => ({ id: `r${String(i + 1)}`, cells, status: "normal" })),
      headerColumn: true,
    },
  },
});

const sample = (): LucidDoc => clone(COMMAND_DOC);

/** The request flow without the cache: the page the spec's "add Redis and a cache-miss path" starts from (acceptance C). */
function requestFlowNoCache(): LucidDoc {
  const doc = sample();
  const flow = doc.blocks.find((b) => b.type === "diagram");
  const graph = flow?.props["graph"] as
    { nodes: { id: string }[]; edges: { from: string; to: string }[] } | undefined;
  if (graph) {
    graph.nodes = graph.nodes.filter((n) => n.id !== "redis");
    graph.edges = graph.edges.filter((e) => e.from !== "redis" && e.to !== "redis");
    graph.edges.forEach((e, i) => {
      (e as { id?: string }).id = `e${String(i + 1)}`;
    });
  }
  return { blocks: doc.blocks.filter((b) => b.type !== "table") };
}

/** A new page of a note format: its section headings, with stable ids. */
const formatPage = (id: string): LucidDoc => {
  const format = getFormat(id);
  if (!format) throw new Error(`no format ${id}`);
  let n = 0;
  return { blocks: skeleton(format, () => `s${String(++n)}`) };
};

const FIXTURE_BUILDERS: Record<FixtureName, () => LucidDoc> = {
  "format-comparison": () => formatPage("comparison"),
  "format-system-design": () => formatPage("system-design"),
  empty: () => ({ blocks: [] }),
  "request-flow": sample,
  "request-flow-no-cache": requestFlowNoCache,
  "db-options": () => ({
    blocks: [
      heading("h1", 2, "Database options"),
      bullet("o1", "PostgreSQL"),
      bullet("o2", "MongoDB"),
      bullet("o3", "DynamoDB"),
    ],
  }),
  /** The table a person gets from "columns: property, SQL, NoSQL. Rows: schema, ... consistency, use cases": no cells yet. */
  "sql-nosql-skeleton": () => ({
    blocks: [
      heading("h1", 2, "SQL vs NoSQL"),
      table(
        "t1",
        "",
        ["Property", "SQL", "NoSQL"],
        ["Schema", "Relationships", "Scaling", "Consistency", "Use cases"].map((r) => [r, "", ""]),
      ),
    ],
  }),
  /** Two tables, each under its own heading: the page of the acceptance scenario F (the cursor is in the second one). */
  "two-sectioned-tables": () => ({
    blocks: [
      heading("h1", 2, "Storage engines"),
      table(
        "t1",
        "Engines",
        ["Property", "Option A", "Option B"],
        [
          ["Writes", "Fast", "Slow"],
          ["Reads", "Slow", "Fast"],
        ],
      ),
      heading("h2", 2, "Queues"),
      table(
        "t2",
        "Queues",
        ["Property", "Option A", "Option B"],
        [
          ["Ordering", "Per partition", "None"],
          ["Replay", "Yes", "No"],
        ],
      ),
    ],
  }),
  "two-tables": () => ({
    blocks: [
      heading("h1", 2, "Comparisons"),
      table(
        "t1",
        "SQL vs NoSQL",
        ["Property", "SQL", "NoSQL"],
        [
          ["Schema", "Fixed", "Flexible"],
          ["Scaling", "Vertical", "Horizontal"],
        ],
      ),
      table(
        "t2",
        "Kafka vs SQS",
        ["Property", "Kafka", "SQS"],
        [
          ["Ordering", "Per partition", "Best effort (FIFO optional)"],
          ["Hosting", "Self-managed", "Managed"],
        ],
      ),
    ],
  }),
  /** Notes as they are after dictating: a few points, and the sentence that was just added at the end. */
  "dictated-notes": () => ({
    blocks: [
      heading("h1", 2, "Load balancer"),
      {
        id: "p1",
        type: "paragraph",
        props: {},
        content: t("A load balancer distributes incoming traffic across application servers."),
      },
      bullet("b1", "Health checks keep traffic away from unhealthy servers."),
      bullet("b2", "The database can become the bottleneck."),
      bullet("b3", "Delete old cache entries after thirty days"),
    ],
  }),
  "lb-points": () => ({
    blocks: [
      heading("h1", 2, "Load balancer"),
      bullet("b1", "Clients talk to the load balancer"),
      bullet("b2", "It forwards requests to application servers"),
      bullet("b3", "Servers read from the database"),
    ],
  }),
};

/** A fresh copy of the starting page (cases never share state). */
export const fixture = (name: FixtureName): LucidDoc => FIXTURE_BUILDERS[name]();
