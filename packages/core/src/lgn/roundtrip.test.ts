import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkGraph, type Graph } from "../model/graph";
import { GraphOpError, removeEdges } from "../model/graphOps";
import { applyCmd, cmdArb, seedGraph } from "../testing/graphCommands";
import { parseLgn } from "./apply";
import { printLgn } from "./print";

// Property P4: parseLgn(printLgn(g)) equals g, ignoring edge ids.

/**
 * Edge ids are re-assigned e1..en on parse and fragment ids f1..fn in the order the blocks close, so neither is
 * compared; sequence edges are compared in message order and fragments outermost-first.
 */
function normalise(g: Graph): unknown {
  const edges =
    g.type === "sequence" ? [...g.edges].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)) : g.edges;
  return {
    ...g,
    edges: edges.map((e, i) => ({ ...e, id: `e${String(i + 1)}` })),
    groups: g.groups.map((grp) => ({ ...grp, members: [...grp.members] })),
    fragments: g.fragments
      .map(({ id: _id, ...rest }) => rest)
      .sort((a, b) => {
        const span = (f: typeof a) =>
          [
            Math.min(...f.branches.map((x) => x.fromSeq)),
            Math.max(...f.branches.map((x) => x.toSeq)),
          ] as const;
        const [a1, a2] = span(a);
        const [b1, b2] = span(b);
        return a1 - b1 || b2 - a2 || a.kind.localeCompare(b.kind);
      }),
  };
}

/**
 * Reading LGN merges an edge line into an existing compatible edge (the patch semantics), so
 * graphs holding two edges that would merge cannot round-trip. Drop the later of any such pair.
 */
function dropMergeableEdges(g: Graph): Graph {
  if (g.type === "sequence") return g;
  const kept: Graph["edges"] = [];
  const drop: string[] = [];
  for (const e of g.edges) {
    const compatible = (a: (typeof g.edges)[number]) =>
      e.label === undefined || a.label === undefined || a.label === e.label;
    const merges = kept.some(
      (k) =>
        (k.from === e.from && k.to === e.to && compatible(k)) ||
        (e.arrow === "bidirectional" && k.from === e.to && k.to === e.from && compatible(k)),
    );
    if (merges) drop.push(e.id);
    else kept.push(e);
  }
  return drop.length === 0 ? g : removeEdges(g, drop);
}

describe("LGN round trip (property)", () => {
  it.each(["flowchart", "sequence", "er"] as const)(
    "parse(print(g)) equals g for random %s graphs",
    (type) => {
      let checked = 0;
      let withGroups = 0;
      let withFragments = 0;
      let withManyEdges = 0;
      fc.assert(
        fc.property(
          fc.array(cmdArb, { minLength: 15, maxLength: 70 }),
          // Extra fragments for sequence runs (applyCmd only adds one when it keeps the graph valid).
          fc.array(fc.tuple(fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 12 })), {
            maxLength: 5,
          }),
          (cmds, fragmentRanges) => {
            let g = seedGraph(type);
            for (const cmd of cmds) {
              try {
                g = applyCmd(g, cmd);
              } catch (error) {
                expect(error).toBeInstanceOf(GraphOpError);
              }
            }
            for (const [from, to] of fragmentRanges) {
              try {
                // Fold the random numbers into 0..edges-1 so most ranges fall inside the diagram.
                const n = Math.max(1, g.edges.length);
                g = applyCmd(g, { k: "fragment", from: from % n, to: to % n });
              } catch (error) {
                expect(error).toBeInstanceOf(GraphOpError);
              }
            }
            // The command interpreter can switch the graph type; the round trip is checked for the final type.
            g = dropMergeableEdges(g);
            expect(checkGraph(g)).toEqual([]);
            const result = parseLgn(printLgn(g), { type: g.type, direction: g.direction });
            expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true);
            if (result.ok) expect(normalise(result.graph)).toEqual(normalise(g));
            checked++;
            if (g.groups.length > 0) withGroups++;
            if (g.fragments.length > 0) withFragments++;
            if (g.edges.length >= 4) withManyEdges++;
          },
        ),
        { numRuns: 1000 },
      );
      expect(checked).toBe(1000);
      // Not vacuous: plenty of the graphs have several edges and groups, and sequence ones have fragments. The limits
      // are far below what random graphs give (about 250 of 1000 have four edges or more), so chance cannot fail them.
      expect(withManyEdges).toBeGreaterThan(100);
      expect(withGroups).toBeGreaterThan(100);
      if (type === "sequence") expect(withFragments).toBeGreaterThan(100);
    },
  );
});
