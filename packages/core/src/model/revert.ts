import type { Block, LucidDoc } from "./doc";
import { applyPatch, patchedIds, type BlockPatch, type PatchStep } from "./patch";

/**
 * Taking back one change among several (Revert in the History): the inverse of a patch, and a record of what the touched
 * blocks looked like right after the change, so the way back is offered only while they still look like that.
 */

/** Blocks are plain JSON, so a JSON round trip is a faithful deep copy. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface Place {
  list: Block[];
  index: number;
  parentId: string | null;
}

function find(blocks: Block[], id: string, parentId: string | null = null): Place | undefined {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (!block) continue;
    if (block.id === id) return { list: blocks, index, parentId };
    if (block.children) {
      const inner = find(block.children, id, block.id);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** Where a block is, as a patch says it: its parent and the block before it. */
const position = (place: Place): { parentId: string | null; afterId: string | null } => ({
  parentId: place.parentId,
  afterId: place.list[place.index - 1]?.id ?? null,
});

/**
 * The patch that undoes `patch` when it is applied to the document the patch produced. Computed step by step on a copy
 * of `before` (each step's inverse needs the state just before that step), then put in the reverse order.
 */
export function invertPatch(before: LucidDoc, patch: BlockPatch): BlockPatch {
  const work: LucidDoc = clone(before);
  const inverse: PatchStep[] = [];
  for (const step of patch.steps) {
    switch (step.kind) {
      case "insert":
        inverse.push(...step.blocks.map((b): PatchStep => ({ kind: "remove", id: b.id })));
        break;
      case "update": {
        const place = find(work.blocks, step.id);
        const old = place?.list[place.index];
        if (old) inverse.push({ kind: "update", id: step.id, block: clone(old) });
        break;
      }
      case "remove": {
        const place = find(work.blocks, step.id);
        const old = place?.list[place.index];
        if (place && old)
          inverse.push({ kind: "insert", ...position(place), blocks: [clone(old)] });
        break;
      }
      case "move": {
        const place = find(work.blocks, step.id);
        if (place) inverse.push({ kind: "move", id: step.id, ...position(place) });
        break;
      }
    }
    // Move on to the state after this step (a step that cannot apply here makes the whole patch invalid anyway).
    work.blocks = applyPatch(work, { steps: [step] }).blocks;
  }
  return { steps: inverse.reverse() };
}

/** What the blocks a change touched look like in a document: the block, or null when it is not there. */
function snapshot(doc: LucidDoc, ids: readonly string[]): Record<string, Block | null> {
  const out: Record<string, Block | null> = {};
  for (const id of ids) {
    const place = find(doc.blocks, id);
    out[id] = place ? clone(place.list[place.index] ?? null) : null;
  }
  return out;
}

export interface Revert {
  /** Applied to the document as it is, it takes this change back (and nothing else). */
  undo: BlockPatch;
  /** The blocks the change touched, as the change left them (null: removed). */
  expect: Record<string, Block | null>;
}

/** The way back for a change: what `patch` did to `before`, which gave `after`. */
export function makeRevert(before: LucidDoc, patch: BlockPatch, after: LucidDoc): Revert {
  return { undo: invertPatch(before, patch), expect: snapshot(after, patchedIds(patch)) };
}

/** A block the way the editor may write it or not: no empty `children`, no `undefined`, keys in a fixed order. */
function normal(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normal);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      if (key === "children" && Array.isArray(v) && v.length === 0) continue;
      out[key] = normal(v);
    }
    return out;
  }
  return value;
}
const same = (a: Block | null, b: Block | null): boolean =>
  JSON.stringify(normal(a)) === JSON.stringify(normal(b));

export type CanRevert = { ok: true } | { ok: false; changed: string[] };

/** Whether the change can still be taken back: its blocks are as it left them (the others may have changed since). */
export function canRevert(doc: LucidDoc, revert: Revert): CanRevert {
  const now = snapshot(doc, Object.keys(revert.expect));
  const changed = Object.keys(revert.expect).filter(
    (id) => !same(now[id] ?? null, revert.expect[id] ?? null),
  );
  return changed.length === 0 ? { ok: true } : { ok: false, changed };
}

/** Keeps the way back for the newest `keep` entries and drops it from older ones, so a page file does not grow without end. */
export function withinRevertWindow<T extends { revert?: Revert | undefined }>(
  entries: readonly T[],
  keep = 25,
): T[] {
  const cut = Math.max(0, entries.length - keep);
  return entries.map((e, i) => {
    if (i >= cut || e.revert === undefined) return e;
    const { revert: _dropped, ...rest } = e;
    return rest as T;
  });
}
