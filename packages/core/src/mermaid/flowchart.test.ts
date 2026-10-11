// @vitest-environment jsdom
import mermaid from "mermaid";
import { describe, expect, it } from "vitest";
import { parseLgnOrThrow } from "../lgn";
import { compileMermaid, strikeThrough } from "./index";

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

const flow = (src: string, direction: "LR" | "TB" = "LR") => parseLgnOrThrow(src, { direction });
const valid = async (text: string) => {
  expect(await mermaid.parse(text)).toBeTruthy();
};

describe("compile flowchart", () => {
  it("compiles the request flow: shapes, groups, labelled and dashed edges", async () => {
    const text = compileMermaid(flow(REQUEST_FLOW));
    expect(text).toBe(
      [
        "flowchart LR",
        '  subgraph app["Application boundary"]',
        '    web["Web Server"]',
        '    redis[("Redis")]:::cache',
        "  end",
        '  user(["User"])',
        '  client("Client")',
        '  dns>"DNS"]',
        '  pg[("PostgreSQL")]',
        '  user -->|"enters domain"| client',
        '  client -->|"resolve domain"| dns',
        '  dns -->|"IP address"| client',
        '  client -->|"HTTP request"| web',
        '  web -->|"check cache"| redis',
        '  web -.->|"cache miss: query"| pg',
        '  pg -.->|"data"| web',
        '  web -.->|"store result"| redis',
        '  web -->|"JSON response"| client',
        "  classDef cache fill:#FEF3C7,stroke:#B7791F,stroke-dasharray:5 3",
      ].join("\n"),
    );
    await valid(text);
  });

  it("is deterministic", () => {
    const g = flow(REQUEST_FLOW);
    expect(compileMermaid(g)).toBe(compileMermaid(JSON.parse(JSON.stringify(g)) as typeof g));
  });

  it("uses the graph direction", () => {
    expect(compileMermaid(flow("a -> b", "TB")).split("\n")[0]).toBe("flowchart TB");
  });

  it.each([
    ["actor", '(["X"])'],
    ["client", '("X")'],
    ["service", '["X"]'],
    ["gateway", '[["X"]]'],
    ["loadbalancer", '{{"X"}}'],
    ["datastore", '[("X")]'],
    ["cache", '[("X")]:::cache'],
    ["storage", '@{ shape: lin-cyl, label: "X" }'],
    ["queue", '@{ shape: h-cyl, label: "X" }'],
    ["cdn", '@{ shape: cloud, label: "X" }'],
    ["external", '>"X"]'],
    ["decision", '{"X"}'],
    ["process", '["X"]'],
    ["note", '[/"X"/]'],
  ])("draws a %s node as %s", async (kind, shape) => {
    const text = compileMermaid(flow(`n [${kind}]: X`));
    expect(text).toContain(`  n${shape}`);
    await valid(text);
  });

  it("draws every kind its own way, so an architecture reads at a glance (a service and a process look alike on purpose)", () => {
    const kinds = [
      "actor",
      "client",
      "service",
      "gateway",
      "loadbalancer",
      "datastore",
      "cache",
      "storage",
      "queue",
      "cdn",
      "external",
      "decision",
      "note",
    ] as const;
    const drawn = kinds.map((k) => {
      const line = compileMermaid(flow(`n [${k}]: X`)).split("\n")[1] ?? "";
      return line.replace(/^\s*n/, "");
    });
    expect(new Set(drawn).size).toBe(kinds.length);
  });

  it("marks a struck or chosen node of the newer shapes with a class statement (they take none on the line)", async () => {
    const text = compileMermaid(flow("q [queue]: Kafka {struck}\nc [cdn]: CDN {chosen}\nq -> c"));
    expect(text).toContain('  q@{ shape: h-cyl, label: "');
    expect(text).not.toContain(":::");
    expect(text).toContain("  class q struck");
    expect(text).toContain("  class c chosen");
    await valid(text);
  });

  it("draws every arrow and style", async () => {
    const text = compileMermaid(
      flow("a -> b\nb -- c\nc <-> d\nd -.-> e\ne -.- f\nf <-.-> g\ng ..> h\nh ... i\ni <..> a"),
    );
    expect(text).toContain("  a --> b");
    expect(text).toContain("  b --- c");
    expect(text).toContain("  c <--> d");
    expect(text).toContain("  d -.-> e");
    expect(text).toContain("  e -.- f");
    expect(text).toContain("  f <-.-> g");
    expect(text).toContain("  g -.-> h");
    expect(text).toContain("  linkStyle 6 stroke-dasharray:2 4");
    await valid(text);
  });

  it("marks struck and chosen nodes and edges, and strikes the label text", async () => {
    const text = compileMermaid(
      flow(
        "pg [datastore]: Postgres {struck}\ndyn [datastore]: Dynamo {chosen}\napp -> pg: old {struck}\napp -> dyn: new {chosen}",
      ),
    );
    expect(text).toContain(`pg[("${strikeThrough("Postgres")}")]:::struck`);
    expect(text).toContain('dyn[("Dynamo")]:::chosen');
    expect(text).toContain(`app -->|"${strikeThrough("old")}"| pg`);
    expect(text).toContain("  linkStyle 0 stroke-dasharray:4 3,opacity:0.45");
    expect(text).toContain("  linkStyle 1 stroke-width:3px,stroke:#2F855A");
    expect(text).toContain("  classDef struck stroke-dasharray:4 3,opacity:0.5");
    expect(text).toContain("  classDef chosen stroke-width:3px,stroke:#2F855A");
    await valid(text);
  });

  it("omits hidden nodes and every edge touching them", () => {
    const text = compileMermaid(
      flow("a -> b\nb -> secret\nsecret {hidden}\na -> b: shown\nb -> a {hidden}"),
    );
    expect(text).not.toContain("secret");
    expect(text).not.toContain("b --> a");
    expect(text).toContain('a -->|"shown"| b');
  });

  it("omits groups whose members are all hidden, and struck groups get a struck label", async () => {
    const text = compileMermaid(
      flow("a\nb\nc {hidden}\ngroup g: Gone {c}\ngroup h: Old {a, b} {struck}"),
    );
    expect(text).not.toContain("subgraph g");
    expect(text).toContain(`subgraph h["${strikeThrough("Old")}"]`);
    await valid(text);
  });

  it("escapes quotes and keeps labels with special characters valid", async () => {
    const text = compileMermaid(
      flow('a [service]: "say \\"hi\\" (now) [x] {y}"\nb\na -> b: "a | b: c"'),
    );
    expect(text).toContain('a["say #quot;hi#quot; (now) [x] {y}"]');
    await valid(text);
  });

  it("renames ids that are Mermaid keywords", async () => {
    const text = compileMermaid(flow("start [process]: Start\nx_end\nclass_ -> x_end"));
    expect(text).toContain("class_");
    const kw = compileMermaid(flow("default [process]: Default\ndefault -> other"));
    expect(kw).toContain("default_[");
    expect(kw).toContain("default_ --> other");
    await valid(text);
    await valid(kw);
  });

  it("compiles an empty graph and a node-only graph", async () => {
    expect(compileMermaid(flow(""))).toBe("flowchart LR");
    await valid(compileMermaid(flow("a [service]: A")));
  });
});

describe("strikeThrough", () => {
  it("adds a combining stroke after every non-space character", () => {
    expect(strikeThrough("a b")).toBe("a̶ b̶");
    expect(strikeThrough("")).toBe("");
  });
});
