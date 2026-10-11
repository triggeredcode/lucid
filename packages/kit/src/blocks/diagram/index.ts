import {
  ARROW_TOKENS,
  GraphSchema,
  checkGraph,
  compileMermaid,
  parseLgnOrThrow,
  type Block,
  type GEdge,
  type Graph,
} from "@lucid/core";
import { z } from "zod";
import type { BlockSpec } from "../../spec";
import { statusSuffix, str, withStatus } from "../common";

function graphOf(block: Block): Graph | undefined {
  const parsed = GraphSchema.safeParse(block.props["graph"]);
  return parsed.success ? parsed.data : undefined;
}

const tag = (status: string): string => (status === "normal" ? "" : ` {${status}}`);
const arrow = (e: GEdge): string =>
  ARROW_TOKENS.find((t) => t.arrow === e.arrow && t.style === e.style)?.token ?? "->";

const fixtureGraph = (source: string, type: Graph["type"], title: string): Graph =>
  parseLgnOrThrow(source, { type, ...(title === "" ? {} : { title }) });

const REQUEST_FLOW = `user [actor]: User
client [client]: Client
dns [external]: DNS
web [service]: Web Server
redis [cache]: Redis
pg [datastore]: PostgreSQL
user -> client: enters domain
client -> dns: resolve domain
dns -> client: IP address
client -> web: HTTP request
web -> redis: check cache
web -.-> pg: cache miss: query
pg -.-> web: data
web -.-> redis: store result
web -> client: JSON response
group app: Application boundary {web, redis}`;

export const diagramBlock: BlockSpec = {
  type: "diagram",
  kind: "atom",
  propsSchema: withStatus({
    graph: GraphSchema,
    caption: z
      .string()
      .regex(/^[^\r\n]*$/, "must be a single line")
      .default(""),
  }),
  describe: [
    "A diagram of components and how they connect: architecture, request or data flow, sequence, entities. Use it only when",
    "relationships are actually described. Nodes and edges have stable ids; edit by id, never redraw. Written as LGN.",
    'LMD: a ```graph type=flowchart dir=TB title="Request flow" fence with lines like `web [service]: Web Server` and `web -> redis: check cache`',
  ].join("\n"),
  fixtures: [
    {
      id: "fx-diagram-1",
      type: "diagram",
      props: {
        graph: fixtureGraph(REQUEST_FLOW, "flowchart", "Request flow"),
        caption: "Request flow",
      },
    },
    {
      id: "fx-diagram-2",
      type: "diagram",
      props: {
        graph: fixtureGraph(
          "client [client]: Client\nweb [service]: Web\nredis [cache]: Redis\nclient -> web: GET\nalt hit\nweb -> redis: lookup\nelse miss\nweb -> redis: set\nend",
          "sequence",
          "Cache",
        ),
        caption: "",
      },
    },
    {
      id: "fx-diagram-3",
      type: "diagram",
      props: {
        graph: fixtureGraph(
          "pg [datastore]: PostgreSQL {struck}\ndynamo [datastore]: DynamoDB {chosen}\napp [service]: App\napp -> pg {struck}\napp -> dynamo {chosen}",
          "flowchart",
          "",
        ),
        caption: "Database options",
      },
    },
  ],
  check: (props) => {
    const parsed = GraphSchema.safeParse(props["graph"]);
    return parsed.success ? checkGraph(parsed.data).map((v) => `${v.rule}: ${v.message}`) : [];
  },
  outline: (block, detail) => {
    const g = graphOf(block);
    const caption = str(block, "caption") || g?.title || "";
    const head =
      `diagram ${g?.type ?? "?"} ${g?.direction ?? ""}${caption ? ` "${caption}"` : ""}${statusSuffix(block)}`.replace(
        "  ",
        " ",
      );
    if (!g) return head;
    const nodes = g.nodes.map((n) =>
      detail === "full"
        ? `${n.id}[${n.kind}] "${n.label}"${tag(n.status)}`
        : `${n.id} "${n.label}"${tag(n.status)}`,
    );
    const lines = [head, `  nodes: ${nodes.join("; ")}`];
    if (detail === "full") {
      const edges = [...g.edges]
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
        .map(
          (e) =>
            `${e.id} ${e.from}${arrow(e)}${e.to}${e.label ? ` "${e.label}"` : ""}${tag(e.status)}`,
        );
      if (edges.length > 0) lines.push(`  edges: ${edges.join("; ")}`);
      if (g.groups.length > 0) {
        lines.push(
          `  groups: ${g.groups.map((x) => `${x.id} "${x.label}" {${x.members.join(", ")}}${tag(x.status)}`).join("; ")}`,
        );
      }
    }
    return lines.join("\n");
  },
  toMarkdown: (block) => {
    const g = graphOf(block);
    if (!g) return "";
    // The JSON rides in a comment so the Markdown file round-trips; "--" is escaped so it can never end the comment.
    const json = JSON.stringify(g).replace(/--/g, "\\u002d-");
    const caption = str(block, "caption");
    return [
      `<!-- lucid:graph ${json} -->`,
      "```mermaid",
      compileMermaid(g),
      "```",
      ...(caption ? ["", `*${caption}*`] : []),
    ].join("\n");
  },
};
