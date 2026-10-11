import type { LucidDoc } from "@lucid/core";
import { block, bullets, callout, doc, h1, p, t } from "@lucid/core/testing";
import { registry } from "@lucid/kit";
import { describe, expect, it } from "vitest";
import { fromBn, toBn, type BnBlock } from "./adapter";

const roundTrip = (d: LucidDoc): LucidDoc => fromBn(toBn(d).blocks, d);

describe("every block kit fixture survives the editor", () => {
  for (const spec of registry.specs.values()) {
    for (const fixture of spec.fixtures) {
      it(`${spec.type} ${fixture.id}`, () => {
        const d: LucidDoc = { blocks: [fixture] };
        expect(roundTrip(d)).toEqual(d);
      });
    }
  }
});

describe("text", () => {
  it("keeps inline styles, links and inline math", () => {
    const d = doc(
      p([
        t("plain "),
        t("bold", { bold: true }),
        t(" "),
        t("both", { bold: true, italic: true }),
        t(" "),
        t("mark", { highlight: true }),
        { type: "mathInline", latex: "x^2" },
        {
          type: "link",
          href: "https://example.com",
          content: [{ type: "text", text: "site", styles: { bold: true } }],
        },
      ]),
    );
    expect(roundTrip(d)).toEqual(d);
  });

  it("turns $...$ typed in the editor into inline math", () => {
    const blocks: BnBlock[] = [
      {
        id: "a",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "energy is $E=mc^2$ here", styles: {} }],
        children: [],
      },
    ];
    expect(fromBn(blocks).blocks[0]?.content).toEqual([
      t("energy is "),
      { type: "mathInline", latex: "E=mc^2" },
      t(" here"),
    ]);
  });

  it("leaves dollar amounts and unsafe LaTeX as text", () => {
    const text = "costs $5 and $10, or $\\input{x}$";
    const blocks: BnBlock[] = [
      {
        id: "a",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text, styles: {} }],
        children: [],
      },
    ];
    expect(fromBn(blocks).blocks[0]?.content).toEqual([t(text)]);
  });

  it("does not turn $ inside code spans into math", () => {
    const blocks: BnBlock[] = [
      {
        id: "a",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "$a$", styles: { code: true } }],
        children: [],
      },
    ];
    expect(fromBn(blocks).blocks[0]?.content).toEqual([t("$a$", { code: true })]);
  });

  it("drops the empty paragraph the editor keeps at the end", () => {
    const blocks: BnBlock[] = [
      {
        id: "a",
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: "Title", styles: {} }],
        children: [],
      },
      { id: "b", type: "paragraph", props: {}, content: [], children: [] },
    ];
    expect(fromBn(blocks).blocks.map((b) => b.id)).toEqual(["a"]);
  });

  it("clamps heading levels to 1-3", () => {
    const blocks: BnBlock[] = [
      {
        id: "a",
        type: "heading",
        props: { level: 5 },
        content: [{ type: "text", text: "Deep", styles: {} }],
        children: [],
      },
    ];
    expect(fromBn(blocks).blocks[0]?.props["level"]).toBe(3);
  });
});

describe("structure", () => {
  it("lifts children of headings and paragraphs to siblings", () => {
    const text = (s: string) => [{ type: "text" as const, text: s, styles: {} }];
    const blocks: BnBlock[] = [
      {
        id: "h",
        type: "heading",
        props: { level: 2 },
        content: text("H"),
        children: [{ id: "c", type: "paragraph", props: {}, content: text("child"), children: [] }],
      },
    ];
    expect(fromBn(blocks).blocks.map((b) => b.id)).toEqual(["h", "c"]);
  });

  it("keeps nested list items as children", () => {
    const d = doc(bullets({ text: "a", children: ["b", "c"] }));
    expect(roundTrip(d)).toEqual(d);
  });

  it("keeps callout contents", () => {
    const d = doc(callout("key", "Remember", p("one"), bullets("x", "y")));
    expect(roundTrip(d)).toEqual(d);
  });

  it("keeps the text of block types Lucid does not have", () => {
    const blocks: BnBlock[] = [
      {
        id: "q",
        type: "quote",
        props: {},
        content: [{ type: "text", text: "said", styles: {} }],
        children: [],
      },
      { id: "d", type: "divider", props: {}, children: [] },
    ];
    const out = fromBn(blocks);
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0]).toMatchObject({ id: "q", type: "paragraph" });
  });
});

describe("what the editor cannot hold", () => {
  it("holds struck and chosen in the editor's own document, so undo and redo see them", () => {
    const d = doc(
      ...bullets(
        { text: "dropped", status: "struck", id: "x" },
        { text: "picked", status: "chosen", id: "y" },
        { text: "plain", id: "z" },
      ),
    );
    const { blocks } = toBn(d);
    expect(blocks.map((b) => b.props["textColor"])).toEqual(["gray", "green", "default"]);
    expect(fromBn(blocks)).toEqual(d);
    expect(fromBn(blocks, d)).toEqual(d);
    // Changing the colour in the editor changes the status in the document.
    const edited = blocks.map((b) =>
      b.id === "z" ? { ...b, props: { ...b.props, textColor: "gray" } } : b,
    );
    expect(fromBn(edited, d).blocks.map((b) => b.props["status"])).toEqual([
      "struck",
      "chosen",
      "struck",
    ]);
  });

  it("does the same for Lucid's own blocks, through their status prop", () => {
    const fixture = registry.get("table").fixtures.find((f) => f.id === "fx-table-1");
    if (!fixture) throw new Error("fixture");
    const d: LucidDoc = { blocks: [{ ...fixture, props: { ...fixture.props, status: "struck" } }] };
    const { blocks } = toBn(d);
    expect(blocks[0]?.props["status"]).toBe("struck");
    expect(fromBn(blocks)).toEqual(d);
    const cleared = blocks.map((b) => ({ ...b, props: { ...b.props, status: "normal" } }));
    expect(fromBn(cleared, d).blocks[0]?.props["status"]).toBeUndefined();
  });

  it("restores flags the editor cannot hold from the previous document", () => {
    const d: LucidDoc = {
      blocks: [
        {
          id: "u",
          type: "paragraph",
          props: { unprocessed: true },
          content: [{ type: "text", text: "raw words", styles: {} }],
        },
      ],
    };
    expect(fromBn(toBn(d).blocks, d)).toEqual(d);
  });

  it("does not keep the props of the old type when a block has become another type (undo of 'make that a heading')", () => {
    const heading: LucidDoc = {
      blocks: [
        {
          id: "x",
          type: "heading",
          props: { level: 2 },
          content: [{ type: "text", text: "Delete old entries", styles: {} }],
        },
      ],
    };
    // Undo turns the heading back into the bullet it was: the editor says bullet, the previous document says heading.
    const asBullet: BnBlock[] = [
      {
        id: "x",
        type: "bulletListItem",
        props: {},
        content: [{ type: "text", text: "Delete old entries", styles: {} }],
        children: [],
      },
    ];
    const back = fromBn(asBullet, heading).blocks[0];
    expect(back?.type).toBe("bulletListItem");
    expect(back?.props).toEqual({});

    // And the other way round: a bullet that became a heading has the level the editor gives it and nothing else.
    const bullet: LucidDoc = {
      blocks: [
        {
          id: "x",
          type: "bulletListItem",
          props: {},
          content: [{ type: "text", text: "Delete old entries", styles: {} }],
        },
      ],
    };
    const asHeading: BnBlock[] = [
      {
        id: "x",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Delete old entries", styles: {} }],
        children: [],
      },
    ];
    expect(fromBn(asHeading, bullet).blocks[0]).toMatchObject({
      type: "heading",
      props: { level: 2 },
    });
  });

  it("still carries the flags of a block whose type did not change, also for code and tables", () => {
    const d: LucidDoc = {
      blocks: [
        {
          id: "c",
          type: "code",
          props: { language: "ts", code: "a", note: "kept" },
        },
      ],
    };
    expect(fromBn(toBn(d).blocks, d).blocks[0]?.props["note"]).toBe("kept");
  });

  it("keeps the old structured data when its JSON is damaged", () => {
    const [fixture] = registry.get("diagram").fixtures;
    if (!fixture) throw new Error("diagram has no fixture");
    const d: LucidDoc = { blocks: [fixture] };
    const damaged = toBn(d).blocks.map((b) => ({
      ...b,
      props: { ...b.props, graphJson: "{not json" },
    }));
    expect(fromBn(damaged, d)).toEqual(d);
  });

  it("drops a structured block whose data is damaged and has no previous version", () => {
    const blocks: BnBlock[] = [
      { id: "g", type: "diagram", props: { graphJson: "oops", caption: "" }, children: [] },
    ];
    expect(fromBn(blocks).blocks).toEqual([]);
  });

  it("is stable: editing then converting twice gives the same document", () => {
    const d = doc(h1("Title"), p("body"), block("math", { latex: "a+b" }));
    const once = roundTrip(d);
    expect(roundTrip(once)).toEqual(once);
  });
});
