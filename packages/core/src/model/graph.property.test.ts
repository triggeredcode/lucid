import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkGraph } from "./graph";
import { GraphOpError } from "./graphOps";
import { ALL_KINDS, applyCmd, cmdArb, deepFreeze, seedGraph } from "../testing/graphCommands";

// Property P-graph: after ANY sequence of graph ops, every successful result
// satisfies the invariants, a failed op is a GraphOpError and changes nothing, and no op mutates its input.

describe("graph ops (property tests)", () => {
  it.each(["flowchart", "sequence"] as const)(
    "any op sequence keeps G1-G6 on a %s, failed ops are GraphOpErrors, and inputs are never mutated",
    (type) => {
      let applied = 0;
      const succeeded = new Set<string>();
      fc.assert(
        fc.property(fc.array(cmdArb, { maxLength: 40 }), (cmds) => {
          let g = deepFreeze(seedGraph(type));
          for (const cmd of cmds) {
            const before = JSON.stringify(g);
            try {
              g = deepFreeze(applyCmd(g, cmd));
              applied++;
              succeeded.add(cmd.k);
              expect(checkGraph(g)).toEqual([]);
            } catch (error) {
              // The only acceptable failure is a deliberate GraphOpError (bad id, unknown node, ...).
              expect(error).toBeInstanceOf(GraphOpError);
              expect(JSON.stringify(g)).toBe(before);
            }
          }
        }),
        { numRuns: 1000 },
      );
      // Guard against a vacuous test: many ops must succeed, and every kind of op must succeed at least once.
      expect(applied).toBeGreaterThan(2500);
      expect([...succeeded].sort()).toEqual(ALL_KINDS);
    },
  );
});
