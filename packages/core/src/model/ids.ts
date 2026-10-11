// @lucid/core has no DOM or Node typings (it must run anywhere), so declare the one Web Crypto call we use.
declare const crypto: { randomUUID(): string };

export type IdGenerator = () => string;

/** A fresh random id for a new block. UUID v4 via the Web Crypto API (Node 22 and browsers). */
export function newId(): string {
  return crypto.randomUUID();
}

/** Deterministic ids (`b1`, `b2`, ...) for tests and fixtures. Each call returns an independent counter. */
export function createSequentialIds(prefix: string): IdGenerator {
  let n = 0;
  return () => `${prefix}${String(++n)}`;
}

/**
 * Next stable short id for model-owned entities such as edges (`e4`), table rows (`r3`) and columns
 * (`c2`): the highest existing numeric suffix plus one. Never reuses the id of a deleted entity as
 * long as the highest id still exists, and is never produced by the LLM.
 */
export function nextNumberedId(prefix: string, existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    if (!id.startsWith(prefix)) continue;
    const suffix = id.slice(prefix.length);
    if (/^\d+$/.test(suffix)) max = Math.max(max, Number(suffix));
  }
  return `${prefix}${String(max + 1)}`;
}
