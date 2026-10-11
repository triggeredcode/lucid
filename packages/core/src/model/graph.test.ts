import { describe, expect, it } from "vitest";
import {
  GraphInvariantError,
  GraphSchema,
  assertGraph,
  checkGraph,
  emptyGraph,
  type GEdge,
  type GNode,
  type Graph,
} from "./graph";

const node = (id: string, kind: GNode["kind"] = "service", label = id.toUpperCase()): GNode => ({
  id,
  label,
  kind,
  status: "normal",
});
const edge = (id: string, from: string, to: string, extra: Partial<GEdge> = {}): GEdge => ({
  id,
  from,
  to,
  arrow: "directed",
  style: "solid",
  status: "normal",
  ...extra,
});
const flow = (over: Partial<Graph> = {}): Graph => ({
  ...emptyGraph(),
  nodes: [node("web"), node("redis", "cache"), node("pg", "datastore")],
  edges: [edge("e1", "web", "redis"), edge("e2", "web", "pg")],
  ...over,
});
const rules = (g: Graph) => checkGraph(g).map((v) => v.rule);
/** The default flow() with the "web" node's label replaced. */
const withWebLabel = (label: string): Graph =>
  flow({ nodes: [node("web", "service", label), node("redis", "cache"), node("pg", "datastore")] });

describe("emptyGraph", () => {
  it("defaults to a left-to-right flowchart with nothing in it", () => {
    expect(emptyGraph()).toEqual({
      type: "flowchart",
      direction: "LR",
      nodes: [],
      edges: [],
      groups: [],
      fragments: [],
    });
    expect(checkGraph(emptyGraph("sequence", "TB"))).toEqual([]);
  });
});

describe("GraphSchema", () => {
  it("accepts a valid graph and rejects unknown keys, kinds and slugs", () => {
    expect(GraphSchema.parse(flow())).toEqual(flow());
    expect(() => GraphSchema.parse({ ...flow(), extra: 1 })).toThrow();
    expect(() =>
      GraphSchema.parse(flow({ nodes: [node("web", "database" as GNode["kind"])] })),
    ).toThrow();
    expect(() => GraphSchema.parse(flow({ nodes: [node("Web Server")] }))).toThrow();
    expect(() => GraphSchema.parse(flow({ nodes: [node("1abc")] }))).toThrow();
  });

  it("accepts hidden for nodes and edges but only normal or struck for groups", () => {
    const hidden = flow({ nodes: [{ ...node("web"), status: "hidden" }] });
    expect(GraphSchema.parse(hidden).nodes[0]?.status).toBe("hidden");
    expect(() =>
      GraphSchema.parse(
        flow({ groups: [{ id: "g", label: "G", members: [], status: "chosen" as "normal" }] }),
      ),
    ).toThrow();
  });
});

describe("checkGraph", () => {
  it("accepts a valid flowchart", () => {
    expect(checkGraph(flow())).toEqual([]);
    expect(() => {
      assertGraph(flow());
    }).not.toThrow();
  });

  it("G1: duplicate node, edge and group ids, and group/node id collisions", () => {
    expect(rules(flow({ nodes: [node("web"), node("web")], edges: [] }))).toEqual(["G1"]);
    expect(rules(flow({ edges: [edge("e1", "web", "redis"), edge("e1", "web", "pg")] }))).toEqual([
      "G1",
    ]);
    const g = { id: "g", label: "G", members: [], status: "normal" as const };
    expect(rules(flow({ groups: [g, g] }))).toEqual(["G1"]);
    expect(rules(flow({ groups: [{ ...g, id: "web" }] }))).toEqual(["G1"]);
  });

  it("G2: edges must connect existing nodes", () => {
    const v = checkGraph(
      flow({ edges: [edge("e1", "web", "ghost"), edge("e2", "phantom", "pg")] }),
    );
    expect(v.map((x) => x.rule)).toEqual(["G2", "G2"]);
    expect(v[0]?.message).toContain("ghost");
  });

  it("G3: group members must exist and belong to one group only", () => {
    const group = (id: string, members: string[]) => ({
      id,
      label: id,
      members,
      status: "normal" as const,
    });
    expect(rules(flow({ groups: [group("app", ["web", "nope"])] }))).toEqual(["G3"]);
    expect(rules(flow({ groups: [group("a", ["web"]), group("b", ["web", "pg"])] }))).toEqual([
      "G3",
    ]);
    expect(rules(flow({ groups: [group("a", ["web", "redis"]), group("b", ["pg"])] }))).toEqual([]);
  });

  describe("G4: sequence numbering and fragments", () => {
    const seq = (edges: GEdge[], fragments: Graph["fragments"] = []): Graph => ({
      ...emptyGraph("sequence"),
      nodes: [node("c", "client"), node("s")],
      edges,
      fragments,
    });
    const m = (id: string, s: number | undefined) =>
      edge(id, "c", "s", s === undefined ? {} : { seq: s });

    it("accepts contiguous 1..n numbers in any array order", () => {
      expect(checkGraph(seq([m("e2", 2), m("e1", 1), m("e3", 3)]))).toEqual([]);
    });

    it("rejects missing, gapped, duplicated or zero-based numbers", () => {
      expect(rules(seq([m("e1", undefined)]))).toEqual(["G4"]);
      expect(rules(seq([m("e1", 1), m("e2", 3)]))).toEqual(["G4"]);
      expect(rules(seq([m("e1", 1), m("e2", 1)]))).toEqual(["G4"]);
      expect(rules(seq([m("e1", 0), m("e2", 1)]))).toContain("G4");
    });

    it("accepts nested fragments and rejects partial overlaps and out-of-range branches", () => {
      const edges = [m("e1", 1), m("e2", 2), m("e3", 3), m("e4", 4)];
      const frag = (id: string, from: number, to: number) => ({
        id,
        kind: "alt" as const,
        branches: [{ label: "x", fromSeq: from, toSeq: to }],
      });
      expect(checkGraph(seq(edges, [frag("f1", 1, 4), frag("f2", 2, 3)]))).toEqual([]);
      expect(rules(seq(edges, [frag("f1", 1, 3), frag("f2", 2, 4)]))).toEqual(["G4"]);
      expect(rules(seq(edges, [frag("f1", 3, 5)]))).toEqual(["G4"]);
      expect(rules(seq(edges, [frag("f1", 3, 2)]))).toContain("G4");
    });

    it("rejects overlapping branches inside one fragment", () => {
      const edges = [m("e1", 1), m("e2", 2), m("e3", 3)];
      const f = {
        id: "f",
        kind: "alt" as const,
        branches: [
          { label: "hit", fromSeq: 1, toSeq: 2 },
          { label: "miss", fromSeq: 2, toSeq: 3 },
        ],
      };
      expect(rules(seq(edges, [f]))).toEqual(["G4"]);
    });

    it("does not require seq numbers on flowcharts, but forbids fragments there", () => {
      expect(checkGraph(flow())).toEqual([]);
      const f = { id: "f", kind: "opt" as const, branches: [{ label: "", fromSeq: 1, toSeq: 1 }] };
      expect(rules(flow({ fragments: [f] }))).toEqual(["G4"]);
    });
  });

  it("G5: labels must be non-empty, single-line and at most 60 characters", () => {
    expect(rules(withWebLabel(""))).toEqual(["G5"]);
    expect(rules(withWebLabel("a\nb"))).toEqual(["G5"]);
    expect(rules(withWebLabel("x".repeat(61)))).toEqual(["G5"]);
    expect(checkGraph(withWebLabel("x".repeat(60)))).toEqual([]);
    expect(rules(flow({ edges: [edge("e1", "web", "pg", { label: "" })] }))).toEqual(["G5"]);
  });

  it("G6: edge ids must look like e<number>", () => {
    expect(rules(flow({ edges: [edge("link1", "web", "pg")] }))).toEqual(["G6"]);
    expect(rules(flow({ edges: [edge("e", "web", "pg")] }))).toEqual(["G6"]);
  });
});

describe("assertGraph", () => {
  it("throws a GraphInvariantError carrying every violation", () => {
    const bad = flow({ edges: [edge("x", "web", "ghost")] });
    try {
      assertGraph(bad);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GraphInvariantError);
      expect((error as GraphInvariantError).violations.map((v) => v.rule).sort()).toEqual([
        "G2",
        "G6",
      ]);
    }
  });
});
