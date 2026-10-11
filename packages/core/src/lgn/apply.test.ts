import { describe, expect, it } from "vitest";
import { checkGraph, emptyGraph, type Graph } from "../model/graph";
import { LgnParseError, applyLgn, parseLgn, parseLgnOrThrow } from "./apply";

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
web -> client: JSON response`;

const ok = (source: string, opts?: Parameters<typeof parseLgn>[1]): Graph => {
  const result = parseLgn(source, opts);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.graph;
};
const errors = (source: string, opts?: Parameters<typeof parseLgn>[1]) => {
  const result = parseLgn(source, opts);
  return result.ok ? [] : result.errors;
};
const edgeSummary = (g: Graph) =>
  g.edges.map(
    (e) =>
      `${e.id} ${e.from}${e.arrow === "directed" ? ">" : e.arrow === "undirected" ? "-" : "<>"}${e.to}${e.style === "solid" ? "" : `(${e.style})`}${e.label ? `:${e.label}` : ""}`,
  );

describe("parseLgn: the request flow example", () => {
  const g = ok(REQUEST_FLOW, { type: "flowchart", direction: "LR", title: "Request flow" });

  it("creates the six components with the right kinds and labels", () => {
    expect(g.nodes.map((n) => [n.id, n.kind, n.label])).toEqual([
      ["user", "actor", "User"],
      ["client", "client", "Client"],
      ["dns", "external", "DNS"],
      ["web", "service", "Web Server"],
      ["redis", "cache", "Redis"],
      ["pg", "datastore", "PostgreSQL"],
    ]);
    expect(g).toMatchObject({ type: "flowchart", direction: "LR", title: "Request flow" });
  });

  it("creates the nine directed edges in order, with the cache path dashed", () => {
    expect(edgeSummary(g)).toEqual([
      "e1 user>client:enters domain",
      "e2 client>dns:resolve domain",
      "e3 dns>client:IP address",
      "e4 client>web:HTTP request",
      "e5 web>redis:check cache",
      "e6 web>pg(dashed):cache miss: query",
      "e7 pg>web(dashed):data",
      "e8 web>redis(dashed):store result",
      "e9 web>client:JSON response",
    ]);
    expect(checkGraph(g)).toEqual([]);
  });
});

describe("parseLgn: nodes and ordering", () => {
  it("auto-declares nodes mentioned only in edges, with a title-cased label", () => {
    const g = ok("web_server -> api_gateway");
    expect(g.nodes.map((n) => [n.id, n.label, n.kind])).toEqual([
      ["web_server", "Web Server", "process"],
      ["api_gateway", "Api Gateway", "process"],
    ]);
  });

  it("lets a later node line fill in an auto-declared node", () => {
    const g = ok("a -> redis\nredis [cache]: Redis");
    expect(g.nodes.find((n) => n.id === "redis")).toMatchObject({ kind: "cache", label: "Redis" });
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "redis"]);
  });

  it("keeps first-mention order of nodes", () => {
    expect(ok("c -> a\nb").nodes.map((n) => n.id)).toEqual(["c", "a", "b"]);
  });

  it("repeating a node line updates only the parts it gives", () => {
    const g = ok("redis [cache]: Redis\nredis {struck}\nredis: Redis cluster");
    expect(g.nodes[0]).toEqual({
      id: "redis",
      label: "Redis cluster",
      kind: "cache",
      status: "struck",
    });
  });

  it("keeps parallel edges with different labels and merges an identical one", () => {
    const g = ok(
      "web -> redis: check cache\nweb -.-> redis: store result\nweb -> redis: check cache",
    );
    expect(edgeSummary(g)).toEqual([
      "e1 web>redis:check cache",
      "e2 web>redis(dashed):store result",
    ]);
  });

  it("supports every arrow style and a trailing edge status", () => {
    const g = ok("a -- b\nb <-> c\nc ..> d\nd ... e\ne <..> f\nf <-.-> a\na -.- c: x {struck}");
    expect(g.edges.map((e) => `${e.arrow}/${e.style}/${e.status}`)).toEqual([
      "undirected/solid/normal",
      "bidirectional/solid/normal",
      "directed/dotted/normal",
      "undirected/dotted/normal",
      "bidirectional/dotted/normal",
      "bidirectional/dashed/normal",
      "undirected/dashed/struck",
    ]);
  });

  it("creates groups after all nodes, regardless of where the group line is", () => {
    const g = ok(
      "group app: Application boundary {web, redis}\nweb [service]: Web\nredis [cache]: Redis\nweb -> redis",
    );
    expect(g.groups).toEqual([
      { id: "app", label: "Application boundary", members: ["web", "redis"], status: "normal" },
    ]);
  });

  it("handles an empty or comment-only body", () => {
    expect(ok("")).toEqual(emptyGraph());
    expect(ok("# nothing here\n\n")).toEqual(emptyGraph());
  });
});

describe("applyLgn: patching an existing graph", () => {
  const base = ok(REQUEST_FLOW);

  it("crosses out a node with a status-only line and leaves everything else alone", () => {
    const g = applyLgn(base, "redis {struck}");
    expect(g.ok && g.graph.nodes.find((n) => n.id === "redis")?.status).toBe("struck");
    expect(g.ok && g.graph.edges).toEqual(base.edges);
  });

  it("adds the cache-hit path next to the existing edges", () => {
    const result = applyLgn(base, "redis -> web: cache hit: cached data");
    expect(result.ok && result.graph.edges).toHaveLength(10);
    expect(result.ok && result.graph.edges.at(-1)).toMatchObject({
      id: "e10",
      from: "redis",
      to: "web",
    });
  });

  it("does not modify the original graph, and applies nothing when any line fails", () => {
    const before = JSON.stringify(base);
    const bad = applyLgn(base, "cdn [cdn]: CDN\nweb => cdn");
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("parseLgn: sequence diagrams", () => {
  const SEQ = `client [client]: Client
web [service]: Web
redis [cache]: Redis
pg [datastore]: PostgreSQL
client -> web: GET /item
web -> redis: GET item
alt cache hit
redis -.-> web: value
else cache miss
redis -.-> web: nil
web -> pg: SELECT
pg -.-> web: row
web -> redis: SET item
end
web -.-> client: JSON`;

  it("numbers messages in order and builds a fragment with two branches", () => {
    const g = ok(SEQ, { type: "sequence" });
    expect(g.edges.map((e) => `${String(e.seq)}:${e.from}>${e.to}`)).toEqual([
      "1:client>web",
      "2:web>redis",
      "3:redis>web",
      "4:redis>web",
      "5:web>pg",
      "6:pg>web",
      "7:web>redis",
      "8:web>client",
    ]);
    expect(g.fragments).toEqual([
      {
        id: "f1",
        kind: "alt",
        branches: [
          { label: "cache hit", fromSeq: 3, toSeq: 3 },
          { label: "cache miss", fromSeq: 4, toSeq: 7 },
        ],
      },
    ]);
    expect(checkGraph(g)).toEqual([]);
  });

  it("supports nested fragments", () => {
    const g = ok("a\nb\nloop retry\nopt maybe\na -> b: x\nend\nb -> a: y\nend", {
      type: "sequence",
    });
    expect(
      g.fragments.map((f) => [f.id, f.kind, f.branches[0]?.fromSeq, f.branches[0]?.toSeq]),
    ).toEqual([
      ["f1", "opt", 1, 1],
      ["f2", "loop", 1, 2],
    ]);
    expect(checkGraph(g)).toEqual([]);
  });

  it("always adds repeated messages between the same participants", () => {
    const g = ok("a -> b: ping\na -> b: ping", { type: "sequence" });
    expect(g.edges).toHaveLength(2);
  });
});

describe("parseLgn: errors", () => {
  it("collects every error with its line number and applies nothing", () => {
    const e = errors("ok [service]: Fine\nbad => x\nalso [nope]: bad\nfine -> ok");
    expect(e.map((x) => x.line)).toEqual([2, 3]);
  });

  it("reports unknown group members at the group line", () => {
    const e = errors("a [service]: A\ngroup g: G {a, ghost}");
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ line: 2 });
    expect(e[0]?.message).toContain("ghost");
  });

  it("reports labels that break the graph rules (too long)", () => {
    const e = errors(`a [service]: ${"x".repeat(61)}`);
    expect(e[0]).toMatchObject({ line: 1 });
    expect(e[0]?.message).toContain("60");
  });

  it("rejects fragments in a flowchart", () => {
    const e = errors("a -> b\nalt x\nb -> a\nend");
    expect(e.map((x) => x.line)).toEqual([2, 4]);
    expect(e[0]?.message).toContain("sequence");
  });

  it("rejects unbalanced and empty fragments", () => {
    expect(errors("a -> b\nend", { type: "sequence" })[0]).toMatchObject({ line: 2 });
    expect(errors("a -> b\nelse x", { type: "sequence" })[0]).toMatchObject({ line: 2 });
    const unclosed = errors("a -> b\nalt x\nb -> a", { type: "sequence" });
    expect(unclosed[0]).toMatchObject({ line: 2 });
    expect(unclosed[0]?.message).toContain("never closed");
    const empty = errors("a -> b\nalt x\nend", { type: "sequence" });
    expect(empty[0]?.message).toContain("no messages");
  });

  it("exposes a throwing variant", () => {
    expect(() => parseLgnOrThrow("a => b")).toThrow(LgnParseError);
    expect(parseLgnOrThrow("a -> b").edges).toHaveLength(1);
    try {
      parseLgnOrThrow("a => b");
    } catch (error) {
      expect((error as LgnParseError).message).toMatch(/^line 1: /);
    }
  });
});
