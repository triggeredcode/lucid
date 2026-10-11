import { applyPatch, createSequentialIds, type Block, type LucidDoc } from "@lucid/core";
import { bullets, callout, doc, h1, h2, p } from "@lucid/core/testing";
import { describe, expect, it } from "vitest";
import { parseLmd, registry } from "../index";
import { inlineToPlain } from "../text";
import { placeBlocks, PlacementError } from "./place";

const sample = (): LucidDoc => {
  const table = registry.get("table").fixtures.find((f) => f.id === "fx-table-1");
  if (!table) throw new Error("fixture");
  const base = doc(
    h1("Notes", { id: "h1" }),
    h2("Requirements", { id: "h2" }),
    bullets({ text: "one", id: "l1" }, { text: "two", id: "l2" }),
    p("body", { id: "p1" }),
    h2("Trade-offs", { id: "h3" }),
    p("end of tradeoffs", { id: "p2" }),
    callout("note", "Box", p("inside", { id: "in1" })),
  );
  return { blocks: [...base.blocks, table] };
};

const lmd = (source: string): { blocks: Block[]; placement: Parameters<typeof placeBlocks>[2] } => {
  const r = parseLmd(source, { ids: createSequentialIds("n") });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return { blocks: r.blocks, placement: r.placement };
};
const order = (d: LucidDoc) => d.blocks.map((b) => b.id);

describe("placeBlocks", () => {
  it("puts content at the end when told to, or when there is no cursor", () => {
    const d = sample();
    const { blocks } = lmd("New note");
    for (const placement of [{ kind: "end" as const }, { kind: "cursor" as const }]) {
      const out = applyPatch(d, placeBlocks(d, blocks, placement));
      expect(order(out).at(-1)).toBe("n1");
    }
  });

  it("puts content after the cursor's top-level block, even when the cursor is inside a callout", () => {
    const d = sample();
    const { blocks } = lmd("New note");
    const atP = applyPatch(d, placeBlocks(d, blocks, { kind: "cursor" }, { cursorBlockId: "p1" }));
    expect(order(atP).slice(0, 6)).toEqual(["h1", "h2", "l1", "l2", "p1", "n1"]);
    const inCallout = applyPatch(
      d,
      placeBlocks(d, blocks, { kind: "cursor" }, { cursorBlockId: "in1" }),
    );
    expect(inCallout.blocks.find((b) => b.type === "callout")?.children).toHaveLength(1);
    expect(order(inCallout)[order(inCallout).indexOf("n1") - 1]).toBe(d.blocks[7]?.id);
    const stale = applyPatch(
      d,
      placeBlocks(d, blocks, { kind: "cursor" }, { cursorBlockId: "gone" }),
    );
    expect(order(stale).at(-1)).toBe("n1");
  });

  it("places after and before a block, a list, or a list item", () => {
    const d = sample();
    const { blocks } = lmd("New note");
    expect(
      order(applyPatch(d, placeBlocks(d, blocks, { kind: "after", ref: "b2" }))).slice(0, 4),
    ).toEqual(["h1", "h2", "n1", "l1"]);
    expect(
      order(applyPatch(d, placeBlocks(d, blocks, { kind: "before", ref: "b2" }))).slice(0, 3),
    ).toEqual(["h1", "n1", "h2"]);
    expect(
      order(applyPatch(d, placeBlocks(d, blocks, { kind: "after", ref: "b3" }))).slice(2, 5),
    ).toEqual(["l1", "l2", "n1"]);
    expect(
      order(applyPatch(d, placeBlocks(d, blocks, { kind: "before", ref: "b3" }))).slice(1, 4),
    ).toEqual(["h2", "n1", "l1"]);
    expect(
      order(applyPatch(d, placeBlocks(d, blocks, { kind: "after", ref: "b3.1" }))).slice(2, 5),
    ).toEqual(["l1", "n1", "l2"]);
    const inner = applyPatch(d, placeBlocks(d, blocks, { kind: "after", ref: "b7.1" }));
    expect(inner.blocks[7]?.children?.map((b) => b.id)).toEqual(["in1", "n1"]);
  });

  it("appends list items to the end of an existing list, and refuses other content", () => {
    const d = sample();
    const items = lmd("- three\n- four").blocks;
    const out = applyPatch(d, placeBlocks(d, items, { kind: "append_to", ref: "b3" }));
    expect(order(out).slice(2, 6)).toEqual(["l1", "l2", "n1", "n2"]);
    expect(() =>
      placeBlocks(d, lmd("A paragraph").blocks, { kind: "append_to", ref: "b3" }),
    ).toThrow(/append only list items/);
    expect(() =>
      placeBlocks(d, lmd("1. numbered").blocks, { kind: "append_to", ref: "b3" }),
    ).toThrow(PlacementError);
  });

  it("appends rows to an existing table, and refuses a mismatch", () => {
    const d = sample();
    const rows = lmd(
      "| Property | SQL | NoSQL |\n| --- | --- | --- |\n| Consistency | Strong | Tunable |",
    ).blocks;
    const out = applyPatch(d, placeBlocks(d, rows, { kind: "append_to", ref: "b8" }));
    const table = out.blocks.at(-1)?.props["table"] as { rows: { cells: string[] }[] };
    expect(table.rows).toHaveLength(5);
    expect(table.rows.at(-1)?.cells).toEqual(["Consistency", "Strong", "Tunable"]);

    const narrow = lmd("| A | B |\n| --- | --- |\n| 1 | 2 |").blocks;
    expect(() => placeBlocks(d, narrow, { kind: "append_to", ref: "b8" })).toThrow(/Cannot append/);
    expect(() => placeBlocks(d, lmd("text").blocks, { kind: "append_to", ref: "b8" })).toThrow(
      /table rows/,
    );
    expect(() => placeBlocks(d, lmd("text").blocks, { kind: "append_to", ref: "b4" })).toThrow(
      /neither a list nor a table/,
    );
  });

  it("places into a section at its end, matching the heading loosely", () => {
    const d = sample();
    const { blocks } = lmd("New note");
    const req = applyPatch(d, placeBlocks(d, blocks, { kind: "section", heading: "requirements" }));
    expect(order(req).slice(1, 7)).toEqual(["h2", "l1", "l2", "p1", "n1", "h3"]);
    const trade = applyPatch(d, placeBlocks(d, blocks, { kind: "section", heading: "Tradeoffs" }));
    expect(order(trade).slice(5, 7)).toEqual(["h3", "p2"]);
    expect(order(trade).at(-1)).toBe("n1");
  });

  it("creates the section when no heading matches", () => {
    const d = sample();
    const { blocks } = lmd("New note");
    const out = applyPatch(
      d,
      placeBlocks(
        d,
        blocks,
        { kind: "section", heading: "Capacity estimates" },
        { ids: createSequentialIds("s") },
      ),
    );
    const tail = out.blocks.slice(-2);
    expect(tail[0]).toMatchObject({ id: "s1", type: "heading", props: { level: 2 } });
    expect(inlineToPlain(tail[0]?.content)).toBe("Capacity estimates");
    expect(tail[1]?.id).toBe("n1");
  });

  it("explains an unknown reference in words the model can act on", () => {
    const d = sample();
    const { blocks } = lmd("New note");
    for (const kind of ["after", "before", "append_to"] as const) {
      expect(() => placeBlocks(d, blocks, { kind, ref: "b99" })).toThrow(/There is no block b99/);
    }
  });
});
