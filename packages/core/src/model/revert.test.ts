import { describe, expect, it } from "vitest";
import { callout, doc, h1, p } from "../testing";
import { applyPatch, type BlockPatch } from "./patch";
import { canRevert, invertPatch, makeRevert, withinRevertWindow, type Revert } from "./revert";

const base = () =>
  doc(
    h1("Title", { id: "h" }),
    p("one", { id: "a" }),
    p("two", { id: "b" }),
    p("three", { id: "c" }),
    callout("note", "N", p("inner", { id: "i" })),
  );
const para = (id: string, text: string) => ({
  id,
  type: "paragraph" as const,
  props: {},
  content: [{ type: "text" as const, text, styles: {} }],
});

/** Whatever the patch does, applying its inverse to the result gives the document back. */
function roundTrips(patch: BlockPatch, d = base()) {
  const after = applyPatch(d, patch);
  const back = applyPatch(after, invertPatch(d, patch));
  expect(back).toEqual(d);
  return { after, back };
}

describe("invertPatch", () => {
  it("undoes an insert, at the start, after a block and inside a container", () => {
    roundTrips({
      steps: [
        {
          kind: "insert",
          parentId: null,
          afterId: "a",
          blocks: [para("n1", "x"), para("n2", "y")],
        },
      ],
    });
    roundTrips({
      steps: [{ kind: "insert", parentId: null, afterId: null, blocks: [para("n1", "x")] }],
    });
    const d = base();
    const container = d.blocks.at(-1)?.id ?? "";
    roundTrips(
      { steps: [{ kind: "insert", parentId: container, afterId: "i", blocks: [para("n1", "x")] }] },
      d,
    );
  });

  it("undoes an update, a removal at the start, in the middle, at the end and inside a container", () => {
    roundTrips({ steps: [{ kind: "update", id: "b", block: para("b", "TWO") }] });
    for (const id of ["h", "b", "i"]) roundTrips({ steps: [{ kind: "remove", id }] });
    const last = base().blocks.at(-1)?.id ?? "";
    roundTrips({ steps: [{ kind: "remove", id: last }] });
  });

  it("undoes a move, also to another parent", () => {
    roundTrips({ steps: [{ kind: "move", id: "c", parentId: null, afterId: "h" }] });
    roundTrips({ steps: [{ kind: "move", id: "a", parentId: null, afterId: null }] });
    const container = base().blocks.at(-1)?.id ?? "";
    roundTrips({ steps: [{ kind: "move", id: "a", parentId: container, afterId: "i" }] });
  });

  it("undoes several steps that depend on one another, in the reverse order", () => {
    roundTrips({
      steps: [
        { kind: "insert", parentId: null, afterId: "a", blocks: [para("n1", "x")] },
        { kind: "update", id: "n1", block: para("n1", "X") },
        { kind: "move", id: "b", parentId: null, afterId: "n1" },
        { kind: "remove", id: "a" },
        { kind: "update", id: "c", block: para("c", "THREE") },
      ],
    });
  });

  it("leaves the document it was computed from untouched", () => {
    const d = base();
    const copy = JSON.stringify(d);
    invertPatch(d, {
      steps: [
        { kind: "remove", id: "a" },
        { kind: "update", id: "b", block: para("b", "z") },
      ],
    });
    expect(JSON.stringify(d)).toBe(copy);
  });
});

describe("makeRevert and canRevert", () => {
  const strike: BlockPatch = {
    steps: [
      { kind: "update", id: "b", block: { ...para("b", "two"), props: { status: "struck" } } },
    ],
  };

  it("can be undone while the blocks it touched are as it left them, whatever happened to other blocks", () => {
    const before = base();
    const after = applyPatch(before, strike);
    const revert = makeRevert(before, strike, after);
    expect(canRevert(after, revert)).toEqual({ ok: true });
    // Another block changed later: no problem.
    const later = applyPatch(after, {
      steps: [{ kind: "update", id: "a", block: para("a", "ONE") }],
    });
    expect(canRevert(later, revert)).toEqual({ ok: true });
    expect(applyPatch(later, revert.undo).blocks.find((b) => b.id === "b")).toEqual(
      before.blocks.find((b) => b.id === "b"),
    );
    // ...and the later change to the other block is kept.
    expect(applyPatch(later, revert.undo).blocks.find((b) => b.id === "a")).toEqual(
      para("a", "ONE"),
    );
  });

  it("cannot be undone when a block it touched was changed since, and says which", () => {
    const before = base();
    const after = applyPatch(before, strike);
    const revert = makeRevert(before, strike, after);
    const edited = applyPatch(after, {
      steps: [{ kind: "update", id: "b", block: para("b", "two, edited by hand") }],
    });
    expect(canRevert(edited, revert)).toEqual({ ok: false, changed: ["b"] });
    const gone = applyPatch(after, { steps: [{ kind: "remove", id: "b" }] });
    expect(canRevert(gone, revert)).toEqual({ ok: false, changed: ["b"] });
  });

  it("covers inserted and removed blocks: an inserted one must still be there as inserted, a removed one must still be gone", () => {
    const before = base();
    const patch: BlockPatch = {
      steps: [
        { kind: "insert", parentId: null, afterId: "a", blocks: [para("n1", "x")] },
        { kind: "remove", id: "c" },
      ],
    };
    const after = applyPatch(before, patch);
    const revert = makeRevert(before, patch, after);
    expect(canRevert(after, revert)).toEqual({ ok: true });
    expect(applyPatch(after, revert.undo)).toEqual(before);
    // The removed block was put back by hand: the removal cannot be undone any more.
    const putBack = applyPatch(after, {
      steps: [{ kind: "insert", parentId: null, afterId: "b", blocks: [para("c", "three")] }],
    });
    expect(canRevert(putBack, revert)).toEqual({ ok: false, changed: ["c"] });
  });

  it("does not mind how the editor writes a block (an empty list of children, a missing prop)", () => {
    const before = base();
    const after = applyPatch(before, strike);
    const revert = makeRevert(before, strike, after);
    const written = {
      blocks: after.blocks.map((b) => (b.id === "b" ? { ...b, children: [] } : b)),
    };
    expect(canRevert(written, revert)).toEqual({ ok: true });
  });
});

describe("withinRevertWindow", () => {
  it("keeps the way back for the newest entries only, so a page file does not grow without end", () => {
    const entries: { id: string; revert?: Revert }[] = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      revert: { undo: { steps: [] }, expect: {} },
    }));
    const kept = withinRevertWindow(entries, 25);
    expect(kept.filter((e) => e.revert !== undefined).map((e) => e.id)).toEqual(
      entries.slice(5).map((e) => e.id),
    );
    expect(kept).toHaveLength(30);
    expect(withinRevertWindow(entries.slice(0, 3), 25)).toEqual(entries.slice(0, 3));
  });
});
