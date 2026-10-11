import { describe, expect, it } from "vitest";
import { checkGraph, emptyGraph, type Graph } from "./graph";
import {
  GraphOpError,
  addEdge,
  addNode,
  groupNodes,
  insertBetween,
  removeEdges,
  removeNodes,
  renameNode,
  reverseEdge,
  setEdgeLabel,
  setEdgeStatus,
  setMeta,
  setNodeStatus,
  titleCase,
  ungroup,
  upsertEdge,
  upsertNode,
} from "./graphOps";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** The request flow, built with the ops themselves: nodes plus edges e1..e9. */
function requestFlow(): Graph {
  let g = emptyGraph("flowchart", "LR");
  const nodes = [
    ["user", "User", "actor"],
    ["client", "Client", "client"],
    ["dns", "DNS", "external"],
    ["web", "Web Server", "service"],
    ["redis", "Redis", "cache"],
    ["pg", "PostgreSQL", "datastore"],
  ] as const;
  for (const [id, label, kind] of nodes) g = addNode(g, { id, label, kind });
  const edges = [
    ["user", "client", "enters domain"],
    ["client", "dns", "resolve domain"],
    ["dns", "client", "IP address"],
    ["client", "web", "HTTP request"],
    ["web", "redis", "check cache"],
    ["web", "pg", "cache miss: query", "dashed"],
    ["pg", "web", "data", "dashed"],
    ["web", "redis", "store result", "dashed"],
    ["web", "client", "JSON response"],
  ] as const;
  for (const [from, to, label, style] of edges) {
    g = addEdge(g, { from, to, label, ...(style ? { style } : {}) });
  }
  return g;
}

const sequence = (): Graph => {
  let g = emptyGraph("sequence");
  for (const [id, kind] of [
    ["c", "client"],
    ["w", "service"],
    ["r", "cache"],
    ["d", "datastore"],
  ] as const) {
    g = addNode(g, { id, label: id.toUpperCase(), kind });
  }
  return g;
};
const msgs = (g: Graph) =>
  [...g.edges]
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .map((e) => `${e.from}>${e.to}:${String(e.seq)}`);

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return error instanceof GraphOpError ? error.code : `other:${String(error)}`;
  }
  return undefined;
};

describe("titleCase", () => {
  it("turns slugs into labels", () => {
    expect(titleCase("web_server")).toBe("Web Server");
    expect(titleCase("pg")).toBe("Pg");
    expect(titleCase("a__b")).toBe("A B");
  });
});

describe("nodes", () => {
  it("addNode defaults kind to process and rejects duplicates and bad slugs", () => {
    const g = addNode(emptyGraph(), { id: "web", label: "Web" });
    expect(g.nodes[0]).toEqual({ id: "web", label: "Web", kind: "process", status: "normal" });
    expect(code(() => addNode(g, { id: "web", label: "Again" }))).toBe("duplicate_id");
    expect(code(() => addNode(g, { id: "Web Server", label: "x" }))).toBe("invalid");
  });

  it("addNode refuses an id that is already a group id", () => {
    let g = addNode(emptyGraph(), { id: "a", label: "A" });
    g = groupNodes(g, { id: "boundary", label: "Boundary", members: ["a"] });
    expect(code(() => addNode(g, { id: "boundary", label: "x" }))).toBe("duplicate_id");
  });

  it("upsertNode updates only the given fields and creates unknown nodes with defaults", () => {
    const g = requestFlow();
    const updated = upsertNode(g, { id: "redis", status: "struck" });
    expect(updated.nodes.find((n) => n.id === "redis")).toEqual({
      id: "redis",
      label: "Redis",
      kind: "cache",
      status: "struck",
    });
    const created = upsertNode(g, { id: "api_gateway" });
    expect(created.nodes.at(-1)).toEqual({
      id: "api_gateway",
      label: "Api Gateway",
      kind: "process",
      status: "normal",
    });
  });

  it("renameNode and setNodeStatus need an existing node", () => {
    const g = requestFlow();
    expect(renameNode(g, "web", "API Gateway").nodes.find((n) => n.id === "web")?.label).toBe(
      "API Gateway",
    );
    expect(setNodeStatus(g, "pg", "chosen").nodes.find((n) => n.id === "pg")?.status).toBe(
      "chosen",
    );
    expect(code(() => renameNode(g, "ghost", "x"))).toBe("unknown_node");
    expect(code(() => setNodeStatus(g, "ghost", "struck"))).toBe("unknown_node");
  });
});

describe("edges", () => {
  it("addEdge assigns e1, e2, ... and rejects unknown endpoints", () => {
    const g = requestFlow();
    expect(g.edges.map((e) => e.id)).toEqual([
      "e1",
      "e2",
      "e3",
      "e4",
      "e5",
      "e6",
      "e7",
      "e8",
      "e9",
    ]);
    expect(code(() => addEdge(g, { from: "web", to: "ghost" }))).toBe("unknown_node");
  });

  it("never reuses the id of a deleted edge while a higher id exists", () => {
    const g = removeEdges(requestFlow(), ["e2"]);
    expect(addEdge(g, { from: "web", to: "pg" }).edges.at(-1)?.id).toBe("e10");
  });

  it("upsertEdge updates a matching edge in place", () => {
    const g = upsertEdge(requestFlow(), {
      from: "client",
      to: "web",
      label: "HTTP request",
      style: "dashed",
    });
    expect(g.edges).toHaveLength(9);
    expect(g.edges.find((e) => e.id === "e4")?.style).toBe("dashed");
  });

  it("upsertEdge without a label updates the only a->b edge instead of duplicating it", () => {
    const g = upsertEdge(requestFlow(), { from: "user", to: "client", status: "struck" });
    expect(g.edges).toHaveLength(9);
    expect(g.edges.find((e) => e.id === "e1")?.status).toBe("struck");
  });

  it("upsertEdge keeps parallel edges whose labels differ (check cache vs store result)", () => {
    const g = upsertEdge(requestFlow(), {
      from: "web",
      to: "redis",
      label: "evict key",
      style: "dashed",
    });
    expect(g.edges).toHaveLength(10);
    expect(g.edges.filter((e) => e.from === "web" && e.to === "redis").map((e) => e.label)).toEqual(
      ["check cache", "store result", "evict key"],
    );
  });

  it("upsertEdge upgrades a reverse edge to bidirectional", () => {
    let g = addNode(addNode(emptyGraph(), { id: "a", label: "A" }), { id: "b", label: "B" });
    g = addEdge(g, { from: "b", to: "a", label: "sync" });
    g = upsertEdge(g, { from: "a", to: "b", arrow: "bidirectional" });
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ id: "e1", from: "b", to: "a", arrow: "bidirectional" });
  });

  it("setEdgeStatus, setEdgeLabel and reverseEdge address edges by id", () => {
    const g = requestFlow();
    expect(setEdgeStatus(g, "e3", "hidden").edges[2]?.status).toBe("hidden");
    expect(setEdgeLabel(g, "e3", "A record").edges[2]?.label).toBe("A record");
    expect(setEdgeLabel(g, "e3", null).edges[2]).not.toHaveProperty("label");
    expect(reverseEdge(g, "e1").edges[0]).toMatchObject({ from: "client", to: "user" });
    expect(code(() => reverseEdge(g, "e99"))).toBe("unknown_edge");
    expect(code(() => setEdgeStatus(g, "e99", "struck"))).toBe("unknown_edge");
  });
});

describe("removal", () => {
  it("removeNodes drops incident edges, group membership and groups that become empty", () => {
    let g = groupNodes(requestFlow(), {
      id: "app",
      label: "Application",
      members: ["web", "redis"],
    });
    g = groupNodes(g, { id: "data", label: "Data", members: ["pg"] });
    const out = removeNodes(g, ["web", "pg"]);
    expect(out.nodes.map((n) => n.id)).toEqual(["user", "client", "dns", "redis"]);
    expect(out.edges.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(out.groups).toEqual([
      { id: "app", label: "Application", members: ["redis"], status: "normal" },
    ]);
  });

  it("removeNodes and removeEdges reject unknown ids without changing anything", () => {
    const g = requestFlow();
    expect(code(() => removeNodes(g, ["web", "ghost"]))).toBe("unknown_node");
    expect(code(() => removeEdges(g, ["e1", "e77"]))).toBe("unknown_edge");
  });

  it("removing messages renumbers a sequence diagram and keeps fragments around survivors", () => {
    let g = sequence();
    for (const [f, t] of [
      ["c", "w"],
      ["w", "r"],
      ["r", "w"],
      ["w", "d"],
      ["d", "w"],
      ["w", "c"],
    ] as const) {
      g = addEdge(g, { from: f, to: t });
    }
    g = {
      ...g,
      fragments: [
        {
          id: "f1",
          kind: "alt",
          branches: [
            { label: "hit", fromSeq: 2, toSeq: 3 },
            { label: "miss", fromSeq: 4, toSeq: 5 },
          ],
        },
      ],
    };
    // Drop message 3 (r>w) and message 4 (w>d): the "hit" branch keeps only message 2, "miss" keeps message 5.
    const out = removeEdges(g, ["e3", "e4"]);
    expect(msgs(out)).toEqual(["c>w:1", "w>r:2", "d>w:3", "w>c:4"]);
    expect(out.fragments[0]?.branches).toEqual([
      { label: "hit", fromSeq: 2, toSeq: 2 },
      { label: "miss", fromSeq: 3, toSeq: 3 },
    ]);
    expect(checkGraph(out)).toEqual([]);
  });

  it("drops fragment branches and fragments whose messages are all removed", () => {
    let g = sequence();
    for (const [f, t] of [
      ["c", "w"],
      ["w", "r"],
      ["r", "w"],
      ["w", "c"],
    ] as const)
      g = addEdge(g, { from: f, to: t });
    g = {
      ...g,
      fragments: [{ id: "f1", kind: "opt", branches: [{ label: "x", fromSeq: 2, toSeq: 3 }] }],
    };
    const out = removeEdges(g, ["e2", "e3"]);
    expect(out.fragments).toEqual([]);
    expect(msgs(out)).toEqual(["c>w:1", "w>c:2"]);
  });
});

describe("sequence numbering on insert", () => {
  it("appends by default and inserts at an explicit position, shifting later messages and fragments", () => {
    let g = sequence();
    for (const [f, t] of [
      ["c", "w"],
      ["w", "r"],
      ["w", "c"],
    ] as const)
      g = addEdge(g, { from: f, to: t });
    g = {
      ...g,
      fragments: [{ id: "f1", kind: "alt", branches: [{ label: "a", fromSeq: 2, toSeq: 3 }] }],
    };
    const out = addEdge(g, { from: "r", to: "w", seq: 3 });
    expect(msgs(out)).toEqual(["c>w:1", "w>r:2", "r>w:3", "w>c:4"]);
    // The new message at 3 lies inside the fragment, so the fragment grows to cover 2..4.
    expect(out.fragments[0]?.branches[0]).toEqual({ label: "a", fromSeq: 2, toSeq: 4 });
    expect(code(() => addEdge(g, { from: "r", to: "w", seq: 9 }))).toBe("invalid");
  });
});

describe("insertBetween", () => {
  it("add a CDN in front of the web server: the canonical example", () => {
    const before = requestFlow();
    const out = insertBetween(before, "client", "web", { id: "cdn", label: "CDN", kind: "cdn" });
    expect(out.nodes.find((n) => n.id === "cdn")).toEqual({
      id: "cdn",
      label: "CDN",
      kind: "cdn",
      status: "normal",
    });
    const toCdn = out.edges.find((e) => e.from === "client" && e.to === "cdn");
    const fromCdn = out.edges.find((e) => e.from === "cdn" && e.to === "web");
    expect(toCdn).toMatchObject({ id: "e10", label: "HTTP request" });
    expect(fromCdn).toMatchObject({ id: "e11" });
    expect(fromCdn).not.toHaveProperty("label");
    expect(out.edges.some((e) => e.from === "client" && e.to === "web")).toBe(false);
    // The other eight edges are unchanged.
    for (const id of ["e1", "e2", "e3", "e5", "e6", "e7", "e8", "e9"]) {
      expect(out.edges.find((e) => e.id === id)).toEqual(before.edges.find((e) => e.id === id));
    }
    // The new edges sit where the original was, so layout order is stable.
    expect(out.edges.map((e) => e.id).slice(0, 5)).toEqual(["e1", "e2", "e3", "e10", "e11"]);
  });

  it("uses custom labels, and carries style and status over", () => {
    let g = requestFlow();
    g = setEdgeStatus(g, "e6", "struck");
    const out = insertBetween(g, "web", "pg", { id: "pool", label: "Pool", kind: "service" }, [
      "via pool",
      "query",
    ]);
    expect(out.edges.find((e) => e.from === "web" && e.to === "pool")).toMatchObject({
      label: "via pool",
      style: "dashed",
      status: "struck",
    });
    expect(out.edges.find((e) => e.from === "pool" && e.to === "pg")).toMatchObject({
      label: "query",
      style: "dashed",
      status: "struck",
    });
  });

  it("fails cleanly when there is no edge, the node exists, or an endpoint is unknown", () => {
    const g = requestFlow();
    expect(code(() => insertBetween(g, "dns", "pg", { id: "x", label: "X" }))).toBe("no_such_edge");
    expect(code(() => insertBetween(g, "client", "web", { id: "dns", label: "X" }))).toBe(
      "duplicate_id",
    );
    expect(code(() => insertBetween(g, "client", "ghost", { id: "x", label: "X" }))).toBe(
      "unknown_node",
    );
  });

  it("replaces all parallel edges (web>redis twice)", () => {
    const out = insertBetween(requestFlow(), "web", "redis", {
      id: "proxy",
      label: "Proxy",
      kind: "gateway",
    });
    expect(out.edges.filter((e) => e.from === "web" && e.to === "proxy")).toHaveLength(2);
    expect(out.edges.filter((e) => e.from === "proxy" && e.to === "redis")).toHaveLength(2);
    expect(out.edges.some((e) => e.from === "web" && e.to === "redis")).toBe(false);
  });

  it("matches undirected edges in either orientation", () => {
    let g = addNode(addNode(emptyGraph(), { id: "a", label: "A" }), { id: "b", label: "B" });
    g = addEdge(g, { from: "b", to: "a", arrow: "undirected" });
    const out = insertBetween(g, "a", "b", { id: "m", label: "M" });
    expect(out.edges.map((e) => `${e.from}-${e.to}:${e.arrow}`)).toEqual([
      "a-m:undirected",
      "m-b:undirected",
    ]);
  });

  it("puts the new node into the group that holds both ends", () => {
    const g = groupNodes(requestFlow(), {
      id: "app",
      label: "Application",
      members: ["web", "redis"],
    });
    const out = insertBetween(g, "web", "redis", { id: "proxy", label: "Proxy" });
    expect(out.groups[0]?.members).toEqual(["web", "redis", "proxy"]);
    const other = insertBetween(g, "client", "web", { id: "cdn", label: "CDN" });
    expect(other.groups[0]?.members).toEqual(["web", "redis"]);
  });

  it("in a sequence diagram, inserts a hop at the right position and grows enclosing fragments", () => {
    let g = sequence();
    for (const [f, t] of [
      ["c", "w"],
      ["w", "d"],
      ["d", "w"],
      ["w", "c"],
    ] as const)
      g = addEdge(g, { from: f, to: t });
    g = {
      ...g,
      fragments: [{ id: "f1", kind: "alt", branches: [{ label: "x", fromSeq: 2, toSeq: 3 }] }],
    };
    const out = insertBetween(g, "w", "d", { id: "redis", label: "Redis", kind: "cache" }, [
      "GET",
      "miss",
    ]);
    expect(msgs(out)).toEqual(["c>w:1", "w>redis:2", "redis>d:3", "d>w:4", "w>c:5"]);
    expect(out.fragments[0]?.branches[0]).toEqual({ label: "x", fromSeq: 2, toSeq: 4 });
    expect(checkGraph(out)).toEqual([]);
  });

  it("handles several matching messages in a sequence diagram", () => {
    let g = sequence();
    for (const [f, t] of [
      ["w", "d"],
      ["d", "w"],
      ["w", "d"],
    ] as const)
      g = addEdge(g, { from: f, to: t });
    const out = insertBetween(g, "w", "d", { id: "redis", label: "R" });
    expect(msgs(out)).toEqual(["w>redis:1", "redis>d:2", "d>w:3", "w>redis:4", "redis>d:5"]);
  });
});

describe("groups", () => {
  it("groupNodes creates a group, replaces membership of an existing one, and moves nodes between groups", () => {
    let g = groupNodes(requestFlow(), {
      id: "app",
      label: "Application",
      members: ["web", "redis"],
    });
    expect(g.groups).toEqual([
      { id: "app", label: "Application", members: ["web", "redis"], status: "normal" },
    ]);
    g = groupNodes(g, { id: "data", label: "Data", members: ["redis", "pg"] });
    expect(g.groups).toEqual([
      { id: "app", label: "Application", members: ["web"], status: "normal" },
      { id: "data", label: "Data", members: ["redis", "pg"], status: "normal" },
    ]);
    g = groupNodes(g, { id: "app", label: "App tier", members: ["web", "dns"] });
    expect(g.groups.find((x) => x.id === "app")?.members).toEqual(["web", "dns"]);
    expect(checkGraph(g)).toEqual([]);
  });

  it("deduplicates members, removes groups emptied by a move, and validates ids", () => {
    let g = groupNodes(requestFlow(), { id: "a", label: "A", members: ["web"] });
    g = groupNodes(g, { id: "b", label: "B", members: ["web", "web"] });
    expect(g.groups).toEqual([{ id: "b", label: "B", members: ["web"], status: "normal" }]);
    expect(code(() => groupNodes(g, { id: "web", label: "x", members: ["pg"] }))).toBe(
      "duplicate_id",
    );
    expect(code(() => groupNodes(g, { id: "c", label: "x", members: ["ghost"] }))).toBe(
      "unknown_node",
    );
    expect(code(() => groupNodes(g, { id: "C C", label: "x", members: ["pg"] }))).toBe("invalid");
    expect(code(() => groupNodes(g, { id: "empty", label: "Empty", members: [] }))).toBe("invalid");
  });

  it("ungroup removes the group but keeps its nodes", () => {
    const g = groupNodes(requestFlow(), { id: "app", label: "Application", members: ["web"] });
    const out = ungroup(g, "app");
    expect(out.groups).toEqual([]);
    expect(out.nodes).toHaveLength(6);
    expect(code(() => ungroup(g, "nope"))).toBe("unknown_group");
  });
});

describe("setMeta", () => {
  it("sets direction and title, and clears the title with null", () => {
    const g = setMeta(requestFlow(), { direction: "TB", title: "Request flow" });
    expect(g).toMatchObject({ direction: "TB", title: "Request flow" });
    expect(setMeta(g, { title: null })).not.toHaveProperty("title");
  });

  it("converts to a sequence diagram (numbering edges in order) and back (dropping seq and fragments)", () => {
    const seq = setMeta(requestFlow(), { type: "sequence" });
    expect(seq.edges.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(checkGraph(seq)).toEqual([]);
    const withFragment: Graph = {
      ...seq,
      fragments: [{ id: "f", kind: "alt", branches: [{ label: "x", fromSeq: 5, toSeq: 6 }] }],
    };
    const back = setMeta(withFragment, { type: "flowchart" });
    expect(back.fragments).toEqual([]);
    expect(back.edges.every((e) => !("seq" in e))).toBe(true);
  });
});

describe("immutability", () => {
  it("no operation mutates its input", () => {
    const g = deepFreeze(requestFlow());
    const grouped = deepFreeze(groupNodes(g, { id: "app", label: "App", members: ["web"] }));
    expect(() => {
      addNode(g, { id: "q", label: "Q" });
      upsertNode(g, { id: "web", label: "W" });
      addEdge(g, { from: "web", to: "pg" });
      upsertEdge(g, { from: "web", to: "pg", label: "x" });
      insertBetween(g, "client", "web", { id: "cdn", label: "CDN" });
      removeNodes(grouped, ["web"]);
      removeEdges(g, ["e1"]);
      reverseEdge(g, "e1");
      setMeta(g, { type: "sequence", direction: "TB", title: "t" });
      ungroup(grouped, "app");
    }).not.toThrow();
  });
});
