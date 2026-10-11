import type { Block } from "@lucid/core";
import { z } from "zod";
import { clip, inlineToMarkdown, inlineToPlain } from "../../text";
import type { BlockSpec, MarkdownContext } from "../../spec";
import { markStatus, statusOf, statusSuffix, t, withStatus } from "../common";

const indent = (ctx: MarkdownContext) => "  ".repeat(ctx.depth);

function item(block: Block, ctx: MarkdownContext, marker: string): string {
  const line = `${indent(ctx)}${marker} ${markStatus(inlineToMarkdown(block.content), statusOf(block))}`;
  const nested =
    block.children && block.children.length > 0
      ? ctx.renderChildren(block.children, ctx.depth + 1)
      : "";
  return nested.length > 0 ? `${line}\n${nested}` : line;
}

const textOf = (block: Block, detail: "full" | "summary") =>
  clip(inlineToPlain(block.content), detail === "full" ? 300 : 80);

export const bulletListItemBlock: BlockSpec = {
  type: "bulletListItem",
  kind: "text",
  propsSchema: withStatus({}),
  describe: [
    "One bullet. Each bullet is its own block with its own id and status, so 'cross out MongoDB' strikes exactly one item.",
    "Consecutive bullets form a list; nest sub-points as children.",
    "LMD: `- **Health checks** keep traffic away from unhealthy servers.`  Status: `- MongoDB {struck}`",
  ].join("\n"),
  fixtures: [
    { id: "fx-bullet-1", type: "bulletListItem", props: {}, content: [t("PostgreSQL")] },
    {
      id: "fx-bullet-2",
      type: "bulletListItem",
      props: { status: "struck" },
      content: [t("MongoDB")],
    },
    {
      id: "fx-bullet-3",
      type: "bulletListItem",
      props: { status: "chosen" },
      content: [t("DynamoDB")],
    },
    {
      id: "fx-bullet-4",
      type: "bulletListItem",
      props: {},
      content: [t("Caching layers")],
      children: [
        { id: "fx-bullet-4a", type: "bulletListItem", props: {}, content: [t("CDN")] },
        { id: "fx-bullet-4b", type: "bulletListItem", props: {}, content: [t("Redis")] },
      ],
    },
  ],
  outline: (block, detail) => `bullet "${textOf(block, detail)}"${statusSuffix(block)}`,
  toMarkdown: (block, ctx) => item(block, ctx, "-"),
};

export const numberedListItemBlock: BlockSpec = {
  type: "numberedListItem",
  kind: "text",
  propsSchema: withStatus({}),
  describe: [
    "One numbered step, for ordered sequences such as a request path or a procedure.",
    "LMD: `1. The client resolves the domain.`",
  ].join("\n"),
  fixtures: [
    {
      id: "fx-numbered-1",
      type: "numberedListItem",
      props: {},
      content: [t("Resolve the domain with DNS")],
    },
    {
      id: "fx-numbered-2",
      type: "numberedListItem",
      props: {},
      content: [t("Send the request to the web server")],
    },
  ],
  outline: (block, detail) => `numbered "${textOf(block, detail)}"${statusSuffix(block)}`,
  toMarkdown: (block, ctx) => item(block, ctx, `${String(ctx.index)}.`),
};

export const checkListItemBlock: BlockSpec = {
  type: "checkListItem",
  kind: "text",
  propsSchema: withStatus({ checked: z.boolean().default(false) }),
  describe: [
    "A checklist item: open questions, things to revisit, next experiments.",
    "LMD: `- [ ] Benchmark with a longer context`  Done: `- [x] Read the paper`",
  ].join("\n"),
  fixtures: [
    {
      id: "fx-check-1",
      type: "checkListItem",
      props: {},
      content: [t("Benchmark with a longer context")],
    },
    {
      id: "fx-check-2",
      type: "checkListItem",
      props: { checked: true },
      content: [t("Read the vLLM paper")],
    },
  ],
  outline: (block, detail) =>
    `check [${block.props["checked"] === true ? "x" : " "}] "${textOf(block, detail)}"${statusSuffix(block)}`,
  toMarkdown: (block, ctx) =>
    item(block, ctx, `- [${block.props["checked"] === true ? "x" : " "}]`),
};
