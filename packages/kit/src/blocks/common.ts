import { StatusSchema, type Block, type Status } from "@lucid/core";
import { z } from "zod";

/** Every block carries a status; `normal` unless the user crossed it out or chose it. */
export const statusProp = StatusSchema.default("normal");

/** Prop-schema helper: strict object with the shared status property. */
export const withStatus = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject({ ...shape, status: statusProp });

export const statusOf = (block: Block): Status => {
  const value = block.props["status"];
  return value === "struck" || value === "chosen" ? value : "normal";
};

/** ` {struck}` / ` {chosen}` suffix for outline lines; empty for normal blocks. */
export const statusSuffix = (block: Block): string => {
  const status = statusOf(block);
  return status === "normal" ? "" : ` {${status}}`;
};

/** Markdown for a text line given its status: struck blocks are wrapped in ~~, chosen ones get a check mark. */
export function markStatus(markdown: string, status: Status): string {
  if (status === "struck") return `~~${markdown}~~`;
  if (status === "chosen") return `${markdown} ✓`;
  return markdown;
}

/** Fixture helper: a plain text run list. */
export const t = (text: string, styles: Record<string, boolean> = {}) =>
  ({ type: "text" as const, text, styles }) satisfies Block["content"] extends
    (infer I)[] | undefined
    ? I
    : never;

/** A string prop, or "" when missing or not a string. */
export const str = (block: Block, key: string): string => {
  const value = block.props[key];
  return typeof value === "string" ? value : "";
};
