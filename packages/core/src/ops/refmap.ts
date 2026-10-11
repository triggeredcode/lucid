import { type Block, type LucidDoc } from "../model/doc";

/**
 * Short, readable references to blocks, so the model never sees (or invents) real ids.
 *
 * Top level: each block is `b1`, `b2`, ...; a run of consecutive list items of the same type is ONE group
 * (`b3`) whose items are `b3.1`, `b3.2`. Children of any block are `parent.1`, `parent.2`, ...
 * Table rows and columns (`r1`, `c2`), edges (`e4`) and node slugs are real ids inside their own block and are
 * not part of this map.
 */
export type Resolved =
  { kind: "block"; id: string } | { kind: "list"; ids: string[] } | { kind: "item"; id: string };

export interface RefMap {
  /** What a reference points at, or undefined if there is no such reference. */
  resolve(ref: string): Resolved | undefined;
  /** The reference of a block (or of the list group, for a top-level list item is its item ref). */
  refOf(blockId: string): string | undefined;
  /** All references in document order (groups before their items). */
  readonly refs: readonly string[];
}

const LIST_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);
export const isListItem = (block: Block): boolean => LIST_TYPES.has(block.type);

export function buildRefMap(doc: LucidDoc): RefMap {
  const byRef = new Map<string, Resolved>();
  const byId = new Map<string, string>();
  const refs: string[] = [];

  const add = (ref: string, target: Resolved, ownerId?: string) => {
    byRef.set(ref, target);
    refs.push(ref);
    if (ownerId !== undefined) byId.set(ownerId, ref);
  };

  const children = (parentRef: string, blocks: readonly Block[]) => {
    blocks.forEach((child, i) => {
      const ref = `${parentRef}.${String(i + 1)}`;
      add(ref, { kind: "item", id: child.id }, child.id);
      if (child.children) children(ref, child.children);
    });
  };

  let n = 0;
  const top = doc.blocks;
  for (let i = 0; i < top.length;) {
    const block = top[i];
    if (!block) break;
    n += 1;
    const ref = `b${String(n)}`;
    if (isListItem(block)) {
      let end = i;
      while (top[end + 1]?.type === block.type) end += 1;
      const run = top.slice(i, end + 1);
      add(ref, { kind: "list", ids: run.map((b) => b.id) });
      run.forEach((item, k) => {
        const itemRef = `${ref}.${String(k + 1)}`;
        add(itemRef, { kind: "item", id: item.id }, item.id);
        if (item.children) children(itemRef, item.children);
      });
      i = end + 1;
    } else {
      add(ref, { kind: "block", id: block.id }, block.id);
      if (block.children) children(ref, block.children);
      i += 1;
    }
  }

  return {
    resolve: (ref) => byRef.get(ref.trim().replace(/^\[|\]$/g, "")),
    refOf: (id) => byId.get(id),
    refs,
  };
}
