import type { Block, Inline, TextInline } from "@lucid/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { registry } from "../defaultRegistry";
import { parseLmd } from "./parse";
import { blocksToLmd } from "./serialize";

// Property P5: parseLmd(blocksToLmd(blocks)) equals blocks (ids aside) for random documents whose
// text deliberately contains every character LMD treats as syntax.

const WORDS = [
  "web",
  "snake_case",
  "a*b",
  "~tilde~",
  "5$",
  "[x]",
  "{y}",
  "==",
  "|",
  "#",
  ">",
  "-",
  "+",
  "1.",
  "@@",
  "Table:",
  "\\",
  "`",
  "**",
  "x",
  "Redis",
  "_",
  "*",
  "$",
  "(a)",
  "<b>",
  "{struck}",
  "{chosen}",
];
const word = fc.constantFrom(...WORDS);
/** Words joined by single spaces, never starting or ending with whitespace. */
const phrase = fc.array(word, { minLength: 1, maxLength: 4 }).map((w) => w.join(" "));
const codeWord = fc.constantFrom("a*b", "x", "snake_case", "$5", "[1]", "{z}", "a|b", "~~", "**");
const mathText = fc.constantFrom("x^2", "O(n)", "\\frac{a}{b}", "a*b", "n_{i}", "a + b");

const styleKeys = ["bold", "italic", "underline", "strike", "highlight"] as const;
const stylesArb = fc
  .subarray([...styleKeys], { minLength: 0, maxLength: 3 })
  .map((keys) => Object.fromEntries(keys.map((k) => [k, true])) as TextInline["styles"]);

/** One run: plain text (may hold spaces) or a styled word group (no outer whitespace), code, math or link. */
const runArb: fc.Arbitrary<Inline> = fc.oneof(
  fc.tuple(phrase, stylesArb).map(([text, styles]): Inline => ({ type: "text", text, styles })),
  phrase.map((text): Inline => ({ type: "text", text: ` ${text} `, styles: {} })),
  fc
    .tuple(codeWord, stylesArb)
    .map(([text, styles]): Inline => ({ type: "text", text, styles: { ...styles, code: true } })),
  mathText.map((latex): Inline => ({ type: "mathInline", latex })),
  fc
    .tuple(
      phrase.filter((p) => !p.includes("\\")),
      fc.constantFrom("https://x.io/a", "https://redis.io"),
    )
    .map(([text, href]): Inline => ({
      type: "link",
      href,
      content: [{ type: "text", text, styles: {} }],
    })),
);

/** Merge neighbouring text runs with equal styles, the way the parser does, and trim the ends of the whole line. */
function normaliseRuns(runs: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const r of runs) {
    const last = out.at(-1);
    if (
      r.type === "text" &&
      last?.type === "text" &&
      JSON.stringify(last.styles) === JSON.stringify(r.styles)
    ) {
      out[out.length - 1] = { ...last, text: last.text + r.text };
    } else out.push(r);
  }
  const first = out[0];
  if (first?.type === "text" && !first.styles.code)
    out[0] = { ...first, text: first.text.trimStart() };
  const last = out.at(-1);
  if (last?.type === "text" && !last.styles.code)
    out[out.length - 1] = { ...last, text: last.text.trimEnd() };
  return out.filter((r) => r.type !== "text" || r.text.length > 0);
}
const content = fc
  .array(runArb, { minLength: 1, maxLength: 5 })
  .map(normaliseRuns)
  .filter((runs) => runs.length > 0);

let counter = 0;
const id = () => `g${String(++counter)}`;
const status = fc.constantFrom("normal", "normal", "struck", "chosen");
const title = fc.constantFrom("", "Database choice", "Hot partitions", "Why not x");

const heading = fc.tuple(fc.constantFrom(1, 2, 3), content, status).map(([level, c, s]): Block => ({
  id: id(),
  type: "heading",
  props: { level, status: s },
  content: c,
}));
const paragraph = fc.tuple(content, status).map(([c, s]): Block => ({
  id: id(),
  type: "paragraph",
  props: { status: s, unprocessed: false },
  content: c,
}));

type ItemKind = "bulletListItem" | "numberedListItem" | "checkListItem";
const item = (depth: number): fc.Arbitrary<Block> =>
  fc
    .tuple(
      fc.constantFrom<ItemKind>("bulletListItem", "numberedListItem", "checkListItem"),
      content,
      status,
      fc.boolean(),
      depth < 2
        ? fc.array(
            fc.constantFrom<ItemKind>("bulletListItem", "numberedListItem", "checkListItem"),
            { maxLength: 2 },
          )
        : fc.constant([] as ItemKind[]),
    )
    .chain(([type, c, s, checked, kids]) =>
      fc.tuple(...kids.map(() => fc.constant(0))).map(() => ({ type, c, s, checked, kids })),
    )
    .chain(({ type, c, s, checked, kids }) =>
      (kids.length === 0
        ? fc.constant([] as Block[])
        : fc.array(item(depth + 1), { minLength: kids.length, maxLength: kids.length })
      ).map((children): Block => ({
        id: id(),
        type,
        props: { status: s, ...(type === "checkListItem" ? { checked } : {}) },
        content: c,
        ...(children.length > 0 ? { children } : {}),
      })),
    );
const list = fc.array(item(0), { minLength: 1, maxLength: 3 });

const calloutBody = fc
  .array(
    fc.oneof(
      paragraph.map((b) => [b]),
      list,
    ),
    { maxLength: 2 },
  )
  .map((parts) => parts.flat());
const callout = fc
  .tuple(
    fc.constantFrom("note", "key", "decision", "tradeoff", "warning", "question"),
    title,
    status,
    calloutBody,
  )
  .map(([kind, t, s, children]): Block => ({
    id: id(),
    type: "callout",
    props: { kind, title: t, status: s },
    children,
  }));

const docArb = fc
  .array(
    fc.oneof(
      heading.map((b) => [b]),
      paragraph.map((b) => [b]),
      list,
      callout.map((b) => [b]),
    ),
    { minLength: 1, maxLength: 6 },
  )
  .map((parts) => parts.flat());

/** Ids never matter; children are compared as the parser returns them (omitted when empty). */
function strip(blocks: readonly Block[]): unknown {
  return blocks.map((b) => ({
    type: b.type,
    props: b.props,
    ...(b.content === undefined ? {} : { content: b.content }),
    ...((b.children ?? []).length === 0 ? {} : { children: strip(b.children ?? []) }),
  }));
}

describe("LMD round trip (property)", () => {
  it("parse(serialize(blocks)) equals blocks for random documents full of syntax characters", () => {
    let checked = 0;
    let withEmphasis = 0;
    let withBraces = 0;
    fc.assert(
      fc.property(docArb, (blocks) => {
        const valid = blocks.map((b) => registry.validateBlock(b));
        const lmd = blocksToLmd(valid);
        const parsed = parseLmd(lmd);
        expect(parsed.ok, `${lmd}\n${JSON.stringify(!parsed.ok && parsed.errors)}`).toBe(true);
        if (parsed.ok) expect(strip(parsed.blocks), lmd).toEqual(strip(valid));
        checked++;
        if (/(\*\*|__|~~|==)/.test(lmd)) withEmphasis++;
        if (/\\\{(struck|chosen)\\\}/.test(lmd)) withBraces++;
      }),
      { numRuns: 1000 },
    );
    expect(checked).toBe(1000);
    expect(withEmphasis).toBeGreaterThan(300);
    expect(withBraces).toBeGreaterThan(50);
  });
});
