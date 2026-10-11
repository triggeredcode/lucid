import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { block, bullets, callout, doc, h1, p } from "../testing";
import type { Block, LucidDoc } from "./doc";
import { diffDocs } from "./diff";
import { applyPatch } from "./patch";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const roundTrip = (before: LucidDoc, after: LucidDoc) =>
  applyPatch(before, diffDocs(before, after));
const base = () =>
  doc(h1("T", { id: "h" }), p("one", { id: "a" }), p("two", { id: "b" }), p("three", { id: "c" }));
const ids = (d: LucidDoc) => d.blocks.map((b) => b.id);

describe("diffDocs", () => {
  it("is empty when nothing changed", () => {
    const d = base();
    expect(diffDocs(d, clone(d)).steps).toEqual([]);
  });

  it("describes a text change as one update", () => {
    const before = base();
    const after = clone(before);
    after.blocks[1] = {
      ...after.blocks[1],
      content: [{ type: "text", text: "changed", styles: {} }],
    } as Block;
    expect(diffDocs(before, after).steps).toEqual([
      { kind: "update", id: "a", block: after.blocks[1] },
    ]);
  });

  it("uses the fewest moves when blocks are reordered", () => {
    const before = base();
    const after: LucidDoc = {
      blocks: [before.blocks[3], before.blocks[0], before.blocks[1], before.blocks[2]] as Block[],
    };
    const patch = diffDocs(before, after);
    expect(patch.steps).toEqual([{ kind: "move", id: "c", parentId: null, afterId: null }]);
    expect(ids(applyPatch(before, patch))).toEqual(["c", "h", "a", "b"]);
  });

  it("handles inserts, removes and moves together", () => {
    const before = base();
    const fresh = p("new", { id: "n" });
    const after: LucidDoc = {
      blocks: [before.blocks[2], fresh, before.blocks[0], before.blocks[3]] as Block[],
    };
    expect(roundTrip(before, after)).toEqual(after);
  });

  it("treats a block moved into a container, and out of it, correctly", () => {
    const before = doc(
      p("a", { id: "a" }),
      callout("note", "Box", p("inner", { id: "in" }), { ...p("x", { id: "x" }) }),
      p("z", { id: "z" }),
    );
    const calloutId = before.blocks[1]?.id ?? "";
    const into = clone(before);
    const moved = into.blocks.shift() as Block;
    (into.blocks[0] as Block).children = [moved, ...((into.blocks[0] as Block).children ?? [])];
    expect(roundTrip(before, into)).toEqual(into);

    const out = clone(before);
    const inner = (out.blocks[1] as Block).children?.shift() as Block;
    out.blocks.splice(1, 0, inner);
    expect(roundTrip(before, out)).toEqual(out);
    expect(calloutId).not.toBe("");
  });

  it("carries a whole subtree when a nested block changes", () => {
    const before = doc(bullets({ text: "a", id: "a", children: ["x", "y"] }));
    const after = clone(before);
    (after.blocks[0] as Block).children?.pop();
    const patch = diffDocs(before, after);
    expect(patch.steps).toHaveLength(1);
    expect(patch.steps[0]).toMatchObject({ kind: "update", id: "a" });
    expect(roundTrip(before, after)).toEqual(after);
  });

  it("round-trips random edits of random documents (property)", () => {
    const text = fc.string({ minLength: 0, maxLength: 6 });
    const leaf = (id: string) =>
      fc.record({
        id: fc.constant(id),
        type: fc.constantFrom("paragraph", "bulletListItem"),
        text,
      });
    const docArb = fc
      .array(fc.integer({ min: 0, max: 3 }), { minLength: 0, maxLength: 9 })
      .chain((shape) =>
        fc
          .tuple(
            ...shape
              .map((kids, i) =>
                fc.tuple(leaf(`t${String(i)}`), fc.array(fc.nat(99), { maxLength: kids })),
              )
              .map((x) => x),
          )
          .map((parts) =>
            parts.map(([top, childSeeds], i): Block => ({
              id: top.id,
              type: top.type,
              props: {},
              content: [{ type: "text", text: top.text, styles: {} }],
              ...(childSeeds.length > 0
                ? {
                    children: childSeeds.map((seed, k): Block => ({
                      id: `t${String(i)}c${String(k)}`,
                      type: "bulletListItem",
                      props: {},
                      content: [{ type: "text", text: String(seed), styles: {} }],
                    })),
                  }
                : {}),
            })),
          ),
      );
    const edits = fc.array(
      fc.tuple(
        fc.constantFrom("drop", "edit", "add", "swap", "nest", "unnest"),
        fc.nat(50),
        fc.nat(50),
      ),
      { maxLength: 8 },
    );
    fc.assert(
      fc.property(docArb, edits, (blocks, ops) => {
        const before: LucidDoc = { blocks };
        const after: LucidDoc = clone(before);
        let fresh = 0;
        for (const [kind, i, j] of ops) {
          const list = after.blocks;
          const a = i % Math.max(1, list.length);
          const b = j % Math.max(1, list.length);
          if (kind === "drop" && list.length > 0) list.splice(a, 1);
          else if (kind === "edit" && list[a])
            list[a] = {
              ...list[a],
              content: [{ type: "text", text: `e${String(i)}`, styles: {} }],
            };
          else if (kind === "add")
            list.splice(a, 0, {
              id: `new${String(fresh++)}`,
              type: "paragraph",
              props: {},
              content: [{ type: "text", text: "n", styles: {} }],
            });
          else if (kind === "swap" && list.length > 1)
            [list[a], list[b]] = [list[b] as Block, list[a] as Block];
          else if (kind === "nest" && list.length > 1 && a !== b) {
            const [moved] = list.splice(a, 1);
            const host = list[Math.min(b, list.length - 1)];
            if (moved && host) host.children = [moved, ...(host.children ?? [])];
          } else if (kind === "unnest") {
            const host = list.find((x) => (x.children?.length ?? 0) > 0);
            const child = host?.children?.shift();
            if (host && child) list.splice(list.indexOf(host) + 1, 0, child);
          }
        }
        expect(applyPatch(before, diffDocs(before, after))).toEqual(after);
      }),
      { numRuns: 400 },
    );
  });

  it("builders are available", () => {
    expect(block("paragraph").type).toBe("paragraph");
  });
});
