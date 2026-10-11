import type { Block } from "@lucid/core";
import { z } from "zod";
import { inlineToMarkdown, inlineToPlain } from "../../text";
import type { BlockSpec } from "../../spec";
import { markStatus, statusOf, statusSuffix, t, withStatus } from "../common";

const level = (b: Block): number =>
  b.props["level"] === 1 || b.props["level"] === 3 ? b.props["level"] : 2;

const fixtures: Block[] = [
  {
    id: "fx-heading-1",
    type: "heading",
    props: { level: 1 },
    content: [t("Designing a URL shortener")],
  },
  { id: "fx-heading-2", type: "heading", props: { level: 2 }, content: [t("Requirements")] },
  {
    id: "fx-heading-3",
    type: "heading",
    props: { level: 3, status: "struck" },
    content: [t("Approach we dropped")],
  },
];

export const headingBlock: BlockSpec = {
  type: "heading",
  kind: "text",
  propsSchema: withStatus({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  describe: [
    "A section heading. Use one when the user starts a new topic; skip it when the thought continues the current section.",
    "Levels: # title (once per document), ## section, ### sub-section.",
    "LMD: `## Load balancing`",
  ].join("\n"),
  fixtures,
  outline: (block) =>
    `h${String(level(block))} ${inlineToPlain(block.content)}${statusSuffix(block)}`,
  toMarkdown: (block) =>
    `${"#".repeat(level(block))} ${markStatus(inlineToMarkdown(block.content), statusOf(block))}`,
};
