import {
  addRow,
  buildRefMap,
  newId,
  type Block,
  type BlockPatch,
  type IdGenerator,
  type LucidDoc,
  type PatchStep,
  type RefMap,
  type Table,
  TableOpError,
} from "@lucid/core";
import type { Placement } from "../lmd/parse";
import { inlineToPlain } from "../text";

export class PlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlacementError";
  }
}

export interface PlaceOptions {
  /** The block the cursor is in (top level or nested). Used when the model gave no placement. */
  cursorBlockId?: string | undefined;
  ids?: IdGenerator | undefined;
  /** Existing refMap for the document, if the caller already has one. */
  refMap?: RefMap | undefined;
}

interface Located {
  parentId: string | null;
  siblings: Block[];
  index: number;
}

function locate(blocks: Block[], id: string, parentId: string | null = null): Located | undefined {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (!block) continue;
    if (block.id === id) return { parentId, siblings: blocks, index };
    if (block.children) {
      const inner = locate(block.children, id, block.id);
      if (inner) return inner;
    }
  }
  return undefined;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return 1;
  if (x.length === 0 || y.length === 0) return 0;
  // Levenshtein ratio.
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = row[j] ?? 0;
      row[j] = Math.min(
        (row[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        prev + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return 1 - (row[y.length] ?? 0) / Math.max(x.length, y.length);
}

const headingLevel = (b: Block): number =>
  typeof b.props["level"] === "number" ? b.props["level"] : 1;

/**
 * Turns "these new blocks, here" (the model's placement directive) into a BlockPatch.
 * Throws PlacementError with a plain message the repair round can show the model.
 */
export function placeBlocks(
  doc: LucidDoc,
  blocks: Block[],
  placement: Placement,
  options: PlaceOptions = {},
): BlockPatch {
  const refMap = options.refMap ?? buildRefMap(doc);
  const top = doc.blocks;
  const insert = (
    parentId: string | null,
    afterId: string | null,
    list: Block[] = blocks,
  ): PatchStep => ({
    kind: "insert",
    parentId,
    afterId,
    blocks: list,
  });
  const lastTop = top.at(-1)?.id ?? null;

  const needBlock = (ref: string): Located => {
    const resolved = refMap.resolve(ref);
    if (!resolved)
      throw new PlacementError(
        `There is no block ${ref}. Use one of the references shown in the outline.`,
      );
    const id = resolved.kind === "list" ? (resolved.ids[0] ?? "") : resolved.id;
    const at = locate(top, id);
    if (!at) throw new PlacementError(`Block ${ref} is not in the document.`);
    return at;
  };

  switch (placement.kind) {
    case "end":
      return { steps: [insert(null, lastTop)] };

    case "cursor": {
      if (!options.cursorBlockId) return { steps: [insert(null, lastTop)] };
      const at = locate(top, options.cursorBlockId);
      if (!at) return { steps: [insert(null, lastTop)] };
      // After the top-level block that contains the cursor, so a new paragraph never lands inside a callout body.
      const topIndex = top.findIndex(
        (b) =>
          b.id === options.cursorBlockId ||
          locate(b.children ?? [], options.cursorBlockId ?? "") !== undefined,
      );
      const anchor = top[topIndex]?.id ?? lastTop;
      // Keep new list items in the same list when the cursor is on a list item and the text is a list.
      return { steps: [insert(null, anchor)] };
    }

    case "after":
    case "before": {
      const resolved = refMap.resolve(placement.ref);
      if (!resolved)
        throw new PlacementError(
          `There is no block ${placement.ref}. Use one of the references shown in the outline.`,
        );
      if (resolved.kind === "list") {
        const ids = resolved.ids;
        const first = ids[0] ?? "";
        if (placement.kind === "after") return { steps: [insert(null, ids.at(-1) ?? first)] };
        const at = locate(top, first);
        const before = at ? (at.siblings[at.index - 1]?.id ?? null) : null;
        return { steps: [insert(null, before)] };
      }
      const at = needBlock(placement.ref);
      if (placement.kind === "after")
        return { steps: [insert(at.parentId, at.siblings[at.index]?.id ?? null)] };
      return { steps: [insert(at.parentId, at.siblings[at.index - 1]?.id ?? null)] };
    }

    case "append_to": {
      const resolved = refMap.resolve(placement.ref);
      if (!resolved)
        throw new PlacementError(
          `There is no block ${placement.ref}. Use one of the references shown in the outline.`,
        );
      if (resolved.kind === "list") {
        const sameType = top.find((b) => b.id === resolved.ids[0])?.type;
        const wrong = blocks.find((b) => b.type !== sameType);
        if (wrong)
          throw new PlacementError(
            `${placement.ref} is a list of ${sameType ?? "items"}; append only list items of that kind.`,
          );
        return { steps: [insert(null, resolved.ids.at(-1) ?? null)] };
      }
      const target = locate(top, resolved.kind === "block" ? resolved.id : resolved.id);
      const targetBlock = target?.siblings[target.index];
      if (targetBlock?.type === "table") {
        const incoming = blocks.find((b) => b.type === "table");
        if (!incoming)
          throw new PlacementError(
            `${placement.ref} is a table; append table rows, not other content.`,
          );
        const from = incoming.props["table"] as Table;
        let table = targetBlock.props["table"] as Table;
        if (from.columns.length !== table.columns.length)
          throw new PlacementError(
            `Cannot append those rows to ${placement.ref}: it has ${String(table.columns.length)} columns but the rows have ${String(from.columns.length)}.`,
          );
        try {
          for (const row of from.rows)
            table = addRow(table, { after: "end", cells: row.cells, status: row.status });
        } catch (error) {
          if (error instanceof TableOpError)
            throw new PlacementError(
              `Cannot append those rows to ${placement.ref}: ${error.message}`,
            );
          throw error;
        }
        return {
          steps: [
            {
              kind: "update",
              id: targetBlock.id,
              block: { ...targetBlock, props: { ...targetBlock.props, table } },
            },
          ],
        };
      }
      throw new PlacementError(
        `${placement.ref} is neither a list nor a table, so nothing can be appended to it.`,
      );
    }

    case "section": {
      const headings = top.filter((b) => b.type === "heading");
      let best: { block: Block; score: number } | undefined;
      for (const h of headings) {
        const score = similarity(inlineToPlain(h.content), placement.heading);
        if (score >= 0.85 && (!best || score > best.score)) best = { block: h, score };
      }
      if (!best) {
        const heading: Block = {
          id: (options.ids ?? newId)(),
          type: "heading",
          props: { level: 2 },
          content: [{ type: "text", text: placement.heading, styles: {} }],
        };
        return { steps: [insert(null, lastTop, [heading, ...blocks])] };
      }
      const start = top.findIndex((b) => b.id === best.block.id);
      const level = headingLevel(best.block);
      let end = top.length;
      for (let i = start + 1; i < top.length; i++) {
        const b = top[i];
        if (b?.type === "heading" && headingLevel(b) <= level) {
          end = i;
          break;
        }
      }
      return { steps: [insert(null, top[end - 1]?.id ?? null)] };
    }
  }
}
