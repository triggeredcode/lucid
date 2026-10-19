import { buildRefMap, type LucidDoc, type Op } from "@lucid/core";

export interface DeterministicCommand {
  ops: Op[];
  summary: string;
}

const exact = (utterance: string): string =>
  utterance
    .trim()
    .replace(/[.!?]$/, "")
    .toLowerCase();

/**
 * Commands that are safe to interpret without a model. The grammar is intentionally tiny: anything
 * outside these exact forms falls through to the normal checked model pipeline.
 */
export function deterministicCommand(
  doc: LucidDoc,
  utterance: string,
  cursorBlockId?: string,
): DeterministicCommand | undefined {
  const words = exact(utterance);
  const selected = cursorBlockId ? doc.blocks.findIndex((block) => block.id === cursorBlockId) : -1;
  const refs = buildRefMap(doc);
  const target = selected >= 0 && cursorBlockId ? refs.refOf(cursorBlockId) : undefined;

  if (words === "delete this block") {
    return target
      ? { ops: [{ op: "delete", target }], summary: "Deleted selected block" }
      : undefined;
  }

  if (words === "move this block up") {
    if (!target || selected <= 0) return undefined;
    const before = refs.refOf(doc.blocks[selected - 1]?.id ?? "");
    return before
      ? { ops: [{ op: "move", target, to: { before } }], summary: "Moved selected block up" }
      : undefined;
  }

  if (words === "move this block down") {
    if (!target || selected < 0 || selected >= doc.blocks.length - 1) return undefined;
    const after = refs.refOf(doc.blocks[selected + 1]?.id ?? "");
    return after
      ? { ops: [{ op: "move", target, to: { after } }], summary: "Moved selected block down" }
      : undefined;
  }

  const section = /^create an empty section named "([^"]{1,80})"[.!?]?$/iu.exec(utterance.trim());
  const title = section?.[1];
  if (
    title &&
    title.trim() === title &&
    /^[\p{L}\p{N}][\p{L}\p{N} &'’()+,./:-]{0,79}$/u.test(title)
  ) {
    return {
      ops: [{ op: "insert", at: { end: true }, lmd: `## ${title}` }],
      summary: `Created empty section “${title}”`,
    };
  }

  return undefined;
}
