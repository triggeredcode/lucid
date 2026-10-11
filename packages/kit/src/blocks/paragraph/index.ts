import type { Block } from "@lucid/core";
import { z } from "zod";
import { clip, inlineToMarkdown, inlineToPlain } from "../../text";
import type { BlockSpec } from "../../spec";
import { markStatus, statusOf, statusSuffix, t, withStatus } from "../common";

const fixtures: Block[] = [
  {
    id: "fx-paragraph-1",
    type: "paragraph",
    props: {},
    content: [t("A load balancer spreads incoming traffic across several application servers.")],
  },
  {
    id: "fx-paragraph-2",
    type: "paragraph",
    props: {},
    content: [
      t("Redis keeps hot keys in memory, so most reads never reach "),
      t("PostgreSQL", { bold: true }),
      t(". The hit rate is "),
      { type: "mathInline", latex: "h = \\frac{hits}{hits + misses}" },
      t("."),
    ],
  },
  {
    id: "fx-paragraph-3",
    type: "paragraph",
    props: { unprocessed: true },
    content: [t("um so the thing about kafka partitions is that ordering is only per partition")],
  },
];

export const paragraphBlock: BlockSpec = {
  type: "paragraph",
  kind: "text",
  propsSchema: withStatus({ unprocessed: z.boolean().default(false) }),
  describe: [
    "A paragraph of prose: an explanation or a definition. Bold the key term once.",
    "Prefer it to bullets when the user explains how or why. `unprocessed` marks raw dictation the model could not structure.",
    "LMD: `A **load balancer** distributes traffic.`",
  ].join("\n"),
  fixtures,
  outline: (block, detail) => {
    const text = inlineToPlain(block.content);
    const shown = clip(text, detail === "full" ? 600 : 80);
    const flag = block.props["unprocessed"] === true ? " [unprocessed]" : "";
    return `p "${shown}"${flag}${statusSuffix(block)}`;
  },
  toMarkdown: (block) => markStatus(inlineToMarkdown(block.content), statusOf(block)),
};
