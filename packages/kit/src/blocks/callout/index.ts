import type { Block } from "@lucid/core";
import { z } from "zod";
import { clip, inlineToPlain } from "../../text";
import type { BlockSpec } from "../../spec";
import { statusSuffix, t, withStatus } from "../common";

export const CALLOUT_KINDS = [
  "note",
  "key",
  "decision",
  "tradeoff",
  "warning",
  "question",
] as const;

const kind = (b: Block): string => (typeof b.props["kind"] === "string" ? b.props["kind"] : "note");
const title = (b: Block): string => (typeof b.props["title"] === "string" ? b.props["title"] : "");

/** Plain text of a callout's body: each child's text joined with " / ". */
function bodyText(block: Block): string {
  return (block.children ?? [])
    .map(
      (c) =>
        inlineToPlain(c.content) ||
        (c.children ?? []).map((g) => inlineToPlain(g.content)).join("; "),
    )
    .filter((s) => s.length > 0)
    .join(" / ");
}

export const calloutBlock: BlockSpec = {
  type: "callout",
  kind: "container",
  propsSchema: withStatus({
    kind: z.enum(CALLOUT_KINDS).default("note"),
    title: z
      .string()
      .regex(/^[^\r\n]*$/, "must be a single line")
      .default(""),
  }),
  describe: [
    "A highlighted box. kind: key = the takeaway, decision = what was chosen and why, tradeoff = a cost of the choice,",
    "warning = a pitfall, question = something still open, note = an aside. Put the content inside as child blocks.",
    "LMD: `> [!decision] Database choice` then `> DynamoDB for key-value access at scale.`",
  ].join("\n"),
  fixtures: [
    {
      id: "fx-callout-1",
      type: "callout",
      props: { kind: "decision", title: "Database choice" },
      children: [
        {
          id: "fx-callout-1a",
          type: "paragraph",
          props: {},
          content: [t("DynamoDB for key-value access at scale.")],
        },
      ],
    },
    {
      id: "fx-callout-2",
      type: "callout",
      props: { kind: "warning", title: "" },
      children: [
        {
          id: "fx-callout-2a",
          type: "paragraph",
          props: {},
          content: [t("Hot partitions throttle writes.")],
        },
        {
          id: "fx-callout-2b",
          type: "bulletListItem",
          props: {},
          content: [t("Spread keys with a suffix")],
        },
      ],
    },
    {
      id: "fx-callout-3",
      type: "callout",
      props: { kind: "question", title: "Open", status: "struck" },
    },
  ],
  outline: (block, detail) => {
    const head = `callout ${kind(block)}${title(block) ? ` "${title(block)}"` : ""}${statusSuffix(block)}`;
    const body = bodyText(block);
    if (body.length === 0) return head;
    return detail === "full" ? `${head}: "${clip(body, 400)}"` : head;
  },
  toMarkdown: (block, ctx) => {
    const header = `> [!${kind(block)}]${title(block) ? ` ${title(block)}` : ""}`;
    const inner =
      (block.children ?? []).length > 0 ? ctx.renderChildren(block.children ?? [], 0) : "";
    const quoted =
      inner.length > 0
        ? inner
            .split("\n")
            .map((l) => (l.length > 0 ? `> ${l}` : ">"))
            .join("\n")
        : "";
    return quoted.length > 0 ? `${header}\n${quoted}` : header;
  },
};
