import type { Block } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { blocksToLmd, parseLmd, registry } from "./index";

/**
 * The Block Kit contract. It runs for every registered block and every fixture, so adding a block
 * folder is enough to get it tested.
 */
describe("block kit contract", () => {
  for (const [type, spec] of registry.specs) {
    describe(type, () => {
      it("has a short prompt description", () => {
        const lines = spec.describe.trim().split("\n");
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.length).toBeLessThanOrEqual(6);
      });

      it("has fixtures of its own type with unique ids", () => {
        expect(spec.fixtures.length).toBeGreaterThan(0);
        expect(spec.fixtures.every((f) => f.type === type)).toBe(true);
        const ids = spec.fixtures.map((f) => f.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      for (const fixture of spec.fixtures) {
        describe(`fixture ${fixture.id}`, () => {
          it("is valid, and validation is idempotent", () => {
            const once = registry.validateBlock(fixture);
            expect(registry.validateBlock(once)).toEqual(once);
          });

          it("has a non-empty outline in both detail levels, and summary is not longer than full", () => {
            const full = spec.outline(fixture, "full");
            const summary = spec.outline(fixture, "summary");
            expect(full.trim().length).toBeGreaterThan(0);
            expect(summary.trim().length).toBeGreaterThan(0);
            expect(summary.length).toBeLessThanOrEqual(full.length);
            expect(full).not.toMatch(/\s+$/m);
          });

          it("renders Markdown", () => {
            const md = spec.toMarkdown(fixture, {
              depth: 0,
              index: 1,
              renderChildren: (blocks) =>
                blocks
                  .map((b) =>
                    registry
                      .get(b.type)
                      .toMarkdown(b, { depth: 1, index: 1, renderChildren: () => "" }),
                  )
                  .join("\n"),
            });
            expect(md.trim().length).toBeGreaterThan(0);
          });
        });
      }
    });
  }
});

describe("block kit coverage", () => {
  it("registers a spec for every block type in the document model", () => {
    expect(registry.missing()).toEqual([]);
  });

  it("every block type's fixtures together form a valid document", () => {
    const blocks = [...registry.specs.values()].flatMap((s) => s.fixtures);
    // Fixture ids are unique across the whole kit, not just per block type.
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
    expect(registry.validateDoc({ blocks }).blocks).toHaveLength(blocks.length);
  });
});

describe("LMD round trip (contract)", () => {
  /**
   * Compare blocks ignoring ids, an empty `children` array (the parser gives containers one) and the paragraph
   * `unprocessed` flag, which is app state for raw dictation and has no LMD syntax.
   */
  const normalise = (blocks: readonly Block[]): unknown => {
    let n = 0;
    const walk = (b: Block): Block => {
      const { unprocessed: _u, ...props } = b.props;
      const children = (b.children ?? []).map(walk);
      return {
        id: `n${String(++n)}`,
        type: b.type,
        props: b.type === "paragraph" ? props : b.props,
        ...(b.content === undefined ? {} : { content: b.content }),
        ...(children.length === 0 ? {} : { children }),
      };
    };
    return blocks.map(walk);
  };

  for (const [type, spec] of registry.specs) {
    for (const fixture of spec.fixtures) {
      it(`${type} fixture ${fixture.id} survives blocksToLmd -> parseLmd`, () => {
        const valid = registry.validateBlock(fixture);
        const lmd = blocksToLmd([valid]);
        const parsed = parseLmd(lmd);
        expect(parsed.ok, lmd).toBe(true);
        if (parsed.ok) expect(normalise(parsed.blocks)).toEqual(normalise([valid]));
      });
    }
  }

  it("all fixtures together survive a round trip as one document", () => {
    const blocks = [...registry.specs.values()]
      .flatMap((s) => s.fixtures)
      .map((b) => registry.validateBlock(b));
    const parsed = parseLmd(blocksToLmd(blocks));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(normalise(parsed.blocks)).toEqual(normalise(blocks));
  });
});
