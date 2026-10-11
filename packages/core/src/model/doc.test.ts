import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  BlockSchema,
  InlineSchema,
  LucidDocSchema,
  findDuplicateIds,
  iterBlocks,
  type Block,
  type LucidDoc,
} from "./doc";

const text = (t: string) => ({ type: "text" as const, text: t, styles: {} });

const heading: Block = { id: "b1", type: "heading", props: { level: 2 }, content: [text("Intro")] };

describe("LucidDocSchema", () => {
  it("accepts a document with nested blocks and rich inline content", () => {
    const doc: LucidDoc = {
      blocks: [
        heading,
        {
          id: "b2",
          type: "callout",
          props: { kind: "decision", title: "DB" },
          children: [
            {
              id: "b3",
              type: "paragraph",
              props: {},
              content: [
                text("Use "),
                { type: "text", text: "DynamoDB", styles: { bold: true } },
                { type: "link", href: "https://example.com", content: [text("docs")] },
                { type: "mathInline", latex: "O(n)" },
              ],
            },
          ],
        },
      ],
    };
    expect(LucidDocSchema.parse(doc)).toEqual(doc);
  });

  it("accepts an empty document", () => {
    expect(LucidDocSchema.parse({ blocks: [] })).toEqual({ blocks: [] });
  });

  it("rejects an unknown block type", () => {
    expect(() => BlockSchema.parse({ id: "x", type: "banner", props: {} })).toThrow();
  });

  it.each([
    ["an empty id", { id: "", type: "paragraph", props: {} }],
    ["a missing id", { type: "paragraph", props: {} }],
    ["missing props", { id: "x", type: "paragraph" }],
    ["array props", { id: "x", type: "paragraph", props: [] }],
    ["unknown keys", { id: "x", type: "paragraph", props: {}, extra: 1 }],
  ])("rejects %s", (_name, block) => {
    expect(() => BlockSchema.parse(block)).toThrow();
  });

  it("knows every block type", () => {
    expect([...BLOCK_TYPES].sort()).toEqual(
      [
        "bulletListItem",
        "callout",
        "chart",
        "checkListItem",
        "code",
        "diagram",
        "heading",
        "math",
        "numberedListItem",
        "paragraph",
        "table",
      ].sort(),
    );
  });
});

describe("InlineSchema", () => {
  it("rejects unknown style keys", () => {
    expect(() =>
      InlineSchema.parse({ type: "text", text: "x", styles: { sparkle: true } }),
    ).toThrow();
  });

  it("requires link content to be plain text runs", () => {
    expect(() =>
      InlineSchema.parse({
        type: "link",
        href: "https://example.com",
        content: [{ type: "mathInline", latex: "x" }],
      }),
    ).toThrow();
  });

  it("rejects a link with an empty href", () => {
    expect(() => InlineSchema.parse({ type: "link", href: "", content: [] })).toThrow();
  });
});

describe("iterBlocks and findDuplicateIds", () => {
  const nested: LucidDoc = {
    blocks: [
      heading,
      {
        id: "b2",
        type: "callout",
        props: {},
        children: [
          { id: "b3", type: "paragraph", props: {} },
          {
            id: "b4",
            type: "bulletListItem",
            props: {},
            children: [{ id: "b5", type: "bulletListItem", props: {} }],
          },
        ],
      },
      { id: "b6", type: "paragraph", props: {} },
    ],
  };

  it("walks blocks in document order, depth first", () => {
    expect([...iterBlocks(nested.blocks)].map((b) => b.id)).toEqual([
      "b1",
      "b2",
      "b3",
      "b4",
      "b5",
      "b6",
    ]);
  });

  it("finds no duplicates in a valid document", () => {
    expect(findDuplicateIds(nested)).toEqual([]);
  });

  it("reports ids used more than once, including inside children", () => {
    const dup: LucidDoc = {
      blocks: [
        { id: "a", type: "paragraph", props: {} },
        {
          id: "b",
          type: "callout",
          props: {},
          children: [{ id: "a", type: "paragraph", props: {} }],
        },
        { id: "b", type: "paragraph", props: {} },
      ],
    };
    expect(findDuplicateIds(dup)).toEqual(["a", "b"]);
  });
});
