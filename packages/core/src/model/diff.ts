import type { Block, LucidDoc } from "./doc";
import type { BlockPatch, PatchStep } from "./patch";

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return (
    ka.length === kb.length &&
    ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

/** Indices of a longest strictly increasing subsequence of `values`. */
function longestIncreasing(values: readonly number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = new Array<number>(values.length).fill(-1);
  const at: number[] = [];
  values.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((values[tails[mid] ?? 0] ?? 0) < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = i;
    prev[i] = lo > 0 ? (tails[lo - 1] ?? -1) : -1;
    at[lo] = i;
  });
  const keep = new Set<number>();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = prev[i] ?? -1) keep.add(i);
  return keep;
}

/**
 * The patch that turns `before` into `after`: removes, then updates (a changed block carries its whole subtree),
 * then inserts and moves in document order. Blocks are matched by id at the top level; a block that moved into or
 * out of a container is a remove or insert plus an update of the container.
 * `applyPatch(before, diffDocs(before, after))` equals `after` (property-tested).
 */
export function diffDocs(before: LucidDoc, after: LucidDoc): BlockPatch {
  const old = before.blocks;
  const now = after.blocks;
  const nowIds = new Set(now.map((b) => b.id));
  const oldById = new Map(old.map((b) => [b.id, b] as const));
  const steps: PatchStep[] = [];

  for (const b of old) if (!nowIds.has(b.id)) steps.push({ kind: "remove", id: b.id });
  for (const b of now) {
    const was = oldById.get(b.id);
    if (was && !deepEqual(was, b)) steps.push({ kind: "update", id: b.id, block: b });
  }

  // Blocks that stayed: which of them are already in the right order relative to each other?
  const commonOld = old.filter((b) => nowIds.has(b.id)).map((b) => b.id);
  const rank = new Map(commonOld.map((id, i) => [id, i] as const));
  const commonNow = now.filter((b) => oldById.has(b.id));
  const kept = longestIncreasing(commonNow.map((b) => rank.get(b.id) ?? 0));
  const keptIds = new Set([...kept].map((i) => commonNow[i]?.id));

  let prev: string | null = null;
  let run: Block[] = [];
  const flush = () => {
    if (run.length === 0) return;
    steps.push({ kind: "insert", parentId: null, afterId: prev, blocks: run });
    prev = run.at(-1)?.id ?? prev;
    run = [];
  };
  for (const b of now) {
    if (!oldById.has(b.id)) {
      run.push(b);
      continue;
    }
    flush();
    if (!keptIds.has(b.id)) steps.push({ kind: "move", id: b.id, parentId: null, afterId: prev });
    prev = b.id;
  }
  flush();
  return { steps };
}
