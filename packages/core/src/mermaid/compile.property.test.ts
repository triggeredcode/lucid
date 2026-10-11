// @vitest-environment jsdom
import fc from "fast-check";
import mermaid from "mermaid";
import { describe, expect, it } from "vitest";
import { GraphOpError } from "../model/graphOps";
import { applyCmd, cmdArb, seedGraph } from "../testing/graphCommands";
import { compileMermaid } from "./index";

// Property P7: the compiled Mermaid text always passes mermaid.parse, and compiling is deterministic.
describe("compileMermaid (property)", () => {
  it.each(["flowchart", "sequence", "er"] as const)(
    "random %s graphs always compile to parseable Mermaid",
    async (type) => {
      let withEdges = 0;
      await fc.assert(
        fc.asyncProperty(
          fc.array(cmdArb, { minLength: 10, maxLength: 60 }),
          fc.array(fc.tuple(fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 12 })), {
            maxLength: 4,
          }),
          async (cmds, ranges) => {
            let g = seedGraph(type);
            for (const cmd of cmds) {
              try {
                g = applyCmd(g, cmd);
              } catch (error) {
                expect(error).toBeInstanceOf(GraphOpError);
              }
            }
            for (const [from, to] of ranges) {
              const n = Math.max(1, g.edges.length);
              g = applyCmd(g, { k: "fragment", from: from % n, to: to % n });
            }
            const text = compileMermaid(g);
            expect(compileMermaid(JSON.parse(JSON.stringify(g)) as typeof g)).toBe(text);
            await mermaid.parse(text);
            if (g.edges.length > 0) withEdges++;
          },
        ),
        { numRuns: 150 },
      );
      expect(withEdges).toBeGreaterThan(100);
    },
    120_000,
  );
});
