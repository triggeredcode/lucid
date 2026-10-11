import { describe, expect, it } from "vitest";
import { block, bullets, callout, doc, h1, p } from "../testing";
import { applyPatch, patchedIds, PatchError, type BlockPatch } from "./patch";

const base = () =>
  doc(
    h1("Title", { id: "h" }),
    p("one", { id: "a" }),
    p("two", { id: "b" }),
    callout("note", "N", p("inner", { id: "c" })),
  );
const para = (id: string, text: string) => ({
  id,
  type: "paragraph" as const,
  props: {},
  content: [{ type: "text" as const, text, styles: {} }],
});

describe("applyPatch", () => {
  it("inserts after a block, at the start, and inside a container", () => {
    const d = base();
    const out = applyPatch(d, {
      steps: [
        { kind: "insert", parentId: null, afterId: "a", blocks: [para("n1", "x")] },
        { kind: "insert", parentId: null, afterId: null, blocks: [para("n2", "y")] },
      ],
    });
    expect(out.blocks.map((b) => b.id).slice(0, 5)).toEqual(["n2", "h", "a", "n1", "b"]);

    const inner = applyPatch(d, {
      steps: [
        {
          kind: "insert",
          parentId: out.blocks.at(-1)?.id ?? "",
          afterId: "c",
          blocks: [para("n3", "z")],
        },
      ],
    });
    expect(inner.blocks.at(-1)?.children?.map((b) => b.id)).toEqual(["c", "n3"]);
  });

  it("updates, removes and moves", () => {
    const d = base();
    const out = applyPatch(d, {
      steps: [
        { kind: "update", id: "a", block: para("a", "changed") },
        { kind: "remove", id: "b" },
        { kind: "move", id: "h", parentId: null, afterId: "a" },
      ],
    });
    expect(out.blocks.slice(0, 2).map((b) => b.id)).toEqual(["a", "h"]);
    expect(out.blocks[0]?.content).toEqual([{ type: "text", text: "changed", styles: {} }]);
    expect(out.blocks.some((b) => b.id === "b")).toBe(false);
  });

  it("moves a block into a container and out of it", () => {
    const d = base();
    const calloutId = d.blocks.at(-1)?.id ?? "";
    const into = applyPatch(d, {
      steps: [{ kind: "move", id: "a", parentId: calloutId, afterId: null }],
    });
    expect(into.blocks.at(-1)?.children?.map((b) => b.id)).toEqual(["a", "c"]);
    const out = applyPatch(into, {
      steps: [{ kind: "move", id: "c", parentId: null, afterId: "h" }],
    });
    expect(out.blocks.map((b) => b.id).slice(0, 2)).toEqual(["h", "c"]);
  });

  it("does not change its input", () => {
    const d = base();
    const before = JSON.stringify(d);
    applyPatch(d, {
      steps: [
        { kind: "remove", id: "a" },
        { kind: "update", id: "b", block: para("b", "zzz") },
      ],
    });
    expect(JSON.stringify(d)).toBe(before);
  });

  it.each<[string, BlockPatch]>([
    ["a vanished target", { steps: [{ kind: "remove", id: "gone" }] }],
    [
      "a vanished anchor",
      { steps: [{ kind: "insert", parentId: null, afterId: "gone", blocks: [para("x", "x")] }] },
    ],
    [
      "a vanished parent",
      { steps: [{ kind: "insert", parentId: "gone", afterId: null, blocks: [para("x", "x")] }] },
    ],
  ])("refuses %s with StaleTarget", (_name, patch) => {
    expect(() => applyPatch(base(), patch)).toThrow(
      expect.objectContaining({ code: "StaleTarget" }) as Error,
    );
  });

  it("refuses duplicate ids, id-changing updates and self-relative moves", () => {
    expect(() =>
      applyPatch(base(), {
        steps: [{ kind: "insert", parentId: null, afterId: null, blocks: [para("a", "dup")] }],
      }),
    ).toThrow(PatchError);
    expect(() =>
      applyPatch(base(), { steps: [{ kind: "update", id: "a", block: para("zz", "x") }] }),
    ).toThrow(/cannot change/);
    expect(() =>
      applyPatch(base(), { steps: [{ kind: "move", id: "a", parentId: null, afterId: "a" }] }),
    ).toThrow(/itself/);
  });

  it("lets later steps see earlier ones", () => {
    const out = applyPatch(base(), {
      steps: [
        { kind: "insert", parentId: null, afterId: "a", blocks: [para("n", "x")] },
        { kind: "insert", parentId: null, afterId: "n", blocks: [para("m", "y")] },
        { kind: "remove", id: "n" },
      ],
    });
    expect(out.blocks.map((b) => b.id).slice(0, 4)).toEqual(["h", "a", "m", "b"]);
  });
});

describe("patchedIds", () => {
  it("lists created, updated, moved and removed blocks once", () => {
    expect(
      patchedIds({
        steps: [
          { kind: "insert", parentId: null, afterId: null, blocks: [para("n", "x")] },
          { kind: "update", id: "a", block: para("a", "x") },
          { kind: "move", id: "a", parentId: null, afterId: null },
          { kind: "remove", id: "b" },
        ],
      }),
    ).toEqual(["n", "a", "b"]);
  });
});

it("builders produce list items as separate blocks", () => {
  expect(doc(bullets("x", "y")).blocks).toHaveLength(2);
  expect(block("paragraph").type).toBe("paragraph");
});
