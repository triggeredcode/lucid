import type { Block, LucidDoc } from "@lucid/core";

/**
 * A small page with a heading, a paragraph, a diagram, a table and a list: the page the prompts' examples are about,
 * and a ready-made page for tests (refs: b1 title, b2 paragraph, b3 diagram, b4 table, b5 heading, b6 list).
 */
const t = (text: string) => [{ type: "text" as const, text, styles: {} }];
const para = (id: string, text: string): Block => ({
  id,
  type: "paragraph",
  props: {},
  content: t(text),
});
const head = (id: string, level: number, text: string): Block => ({
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

const node = (id: string, kind: string, label: string) => ({ id, kind, label, status: "normal" });
const edge = (n: number, from: string, to: string, label: string, style = "solid") => ({
  id: `e${String(n)}`,
  from,
  to,
  label,
  arrow: "directed",
  style,
  status: "normal",
});

const flow: Block = {
  id: "d1",
  type: "diagram",
  props: {
    caption: "",
    graph: {
      type: "flowchart",
      direction: "TB",
      title: "Request flow",
      nodes: [
        node("client", "client", "Client"),
        node("web", "service", "Web Server"),
        node("redis", "cache", "Redis"),
        node("pg", "datastore", "PostgreSQL"),
      ],
      edges: [
        edge(1, "client", "web", "HTTP request"),
        edge(2, "web", "redis", "check cache"),
        edge(3, "web", "pg", "cache miss: query", "dashed"),
        edge(4, "pg", "web", "data", "dashed"),
        edge(5, "web", "client", "JSON response"),
      ],
      groups: [],
      fragments: [],
    },
  },
};

const compare: Block = {
  id: "t1",
  type: "table",
  props: {
    caption: "SQL vs NoSQL",
    table: {
      columns: [
        { id: "c1", name: "Property", status: "normal" },
        { id: "c2", name: "SQL", status: "normal" },
        { id: "c3", name: "NoSQL", status: "normal" },
      ],
      rows: [
        { id: "r1", cells: ["Schema", "Fixed", "Flexible"], status: "normal" },
        { id: "r2", cells: ["Relationships", "Joins", "Denormalised"], status: "normal" },
        { id: "r3", cells: ["Scaling", "Vertical", "Horizontal"], status: "normal" },
      ],
      headerColumn: true,
    },
  },
};

export const SAMPLE_DOC: LucidDoc = {
  blocks: [
    head("h1", 1, "Request flow and databases"),
    para(
      "p1",
      "Caching reduces database load. Redis stores hot keys so most reads never reach PostgreSQL.",
    ),
    flow,
    compare,
    head("h2", 2, "Database options"),
    bullet("o1", "PostgreSQL"),
    bullet("o2", "MongoDB"),
    bullet("o3", "DynamoDB"),
  ],
};
