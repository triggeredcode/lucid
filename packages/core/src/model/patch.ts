import { findDuplicateIds, type Block, type LucidDoc } from "./doc";

/**
 * One AI change to a document as plain data. Everything that changes the document
 * (Input Mode, Command Mode, agents) compiles to a BlockPatch; the editor applies it in one transaction,
 * which makes it one undo step. `applyPatch` is the pure reference implementation used by tests.
 *
 * `parentId: null` means the top level; `afterId: null` means the start of that parent's children.
 */
export type PatchStep =
  | { kind: "insert"; parentId: string | null; afterId: string | null; blocks: Block[] }
  | { kind: "update"; id: string; block: Block }
  | { kind: "remove"; id: string }
  | { kind: "move"; id: string; parentId: string | null; afterId: string | null };

export interface BlockPatch {
  steps: PatchStep[];
}

export type PatchErrorCode = "StaleTarget" | "DuplicateId" | "BadStep";

export class PatchError extends Error {
  readonly code: PatchErrorCode;
  constructor(code: PatchErrorCode, message: string) {
    super(message);
    this.name = "PatchError";
    this.code = code;
  }
}

export const emptyPatch = (): BlockPatch => ({ steps: [] });
export const isEmptyPatch = (patch: BlockPatch): boolean => patch.steps.length === 0;

/** Blocks are plain JSON, so a JSON round trip is a faithful deep copy. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface Place {
  list: Block[];
  index: number;
  parent: Block | null;
}

function find(blocks: Block[], id: string, parent: Block | null = null): Place | undefined {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (!block) continue;
    if (block.id === id) return { list: blocks, index, parent };
    if (block.children) {
      const inner = find(block.children, id, block);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** The sibling list a step writes into, and where in it (index after `afterId`, or 0). */
function slot(
  root: Block[],
  parentId: string | null,
  afterId: string | null,
): { list: Block[]; at: number } {
  let list: Block[];
  if (parentId === null) list = root;
  else {
    const parent = find(root, parentId)?.list[find(root, parentId)?.index ?? 0];
    if (!parent)
      throw new PatchError("StaleTarget", `Block ${parentId} is no longer in the document.`);
    parent.children ??= [];
    list = parent.children;
  }
  if (afterId === null) return { list, at: 0 };
  const index = list.findIndex((b) => b.id === afterId);
  if (index < 0) throw new PatchError("StaleTarget", `Block ${afterId} is no longer where it was.`);
  return { list, at: index + 1 };
}

/** Applies a patch to a copy of the document. Throws PatchError if a target has vanished or ids would clash. */
export function applyPatch(doc: LucidDoc, patch: BlockPatch): LucidDoc {
  const root = clone(doc.blocks);
  for (const step of patch.steps) {
    switch (step.kind) {
      case "insert": {
        const { list, at } = slot(root, step.parentId, step.afterId);
        list.splice(at, 0, ...clone(step.blocks));
        break;
      }
      case "update": {
        const place = find(root, step.id);
        if (!place)
          throw new PatchError("StaleTarget", `Block ${step.id} is no longer in the document.`);
        if (step.block.id !== step.id)
          throw new PatchError("BadStep", "An update cannot change a block's id.");
        place.list[place.index] = clone(step.block);
        break;
      }
      case "remove": {
        const place = find(root, step.id);
        if (!place)
          throw new PatchError("StaleTarget", `Block ${step.id} is no longer in the document.`);
        place.list.splice(place.index, 1);
        break;
      }
      case "move": {
        const place = find(root, step.id);
        if (!place)
          throw new PatchError("StaleTarget", `Block ${step.id} is no longer in the document.`);
        if (step.afterId === step.id || step.parentId === step.id)
          throw new PatchError("BadStep", "A block cannot be moved relative to itself.");
        const [moved] = place.list.splice(place.index, 1);
        if (!moved) break;
        const { list, at } = slot(root, step.parentId, step.afterId);
        list.splice(at, 0, moved);
        break;
      }
    }
  }
  const next: LucidDoc = { blocks: root };
  const duplicates = findDuplicateIds(next);
  if (duplicates.length > 0)
    throw new PatchError("DuplicateId", `Duplicate block ids: ${duplicates.join(", ")}`);
  return next;
}

/** Ids a patch creates, changes, moves or removes (not their descendants). */
export function patchedIds(patch: BlockPatch): string[] {
  const ids = new Set<string>();
  for (const step of patch.steps) {
    if (step.kind === "insert") for (const b of step.blocks) ids.add(b.id);
    else ids.add(step.kind === "update" ? step.block.id : step.id);
  }
  return [...ids];
}
