import { buildRefMap, TableSchema, type Block, type LucidDoc } from "@lucid/core";

const SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function findBlock(blocks: readonly Block[], id: string): Block | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    const inner = b.children ? findBlock(b.children, id) : undefined;
    if (inner) return inner;
  }
  return undefined;
}

/**
 * `@@ append_to b3` followed by bare table rows (`| Cost | a | b |`) is what a person means by "also a row for cost" and what
 * the model writes, but a pipe table needs its header and separator to be read as a table. When the reference is a table
 * of the page and the lines are only rows, this puts the table's own column names on top so they are read as rows of it.
 * Anything else comes back unchanged.
 */
export function completeAppendedRows(source: string, doc: LucidDoc): string {
  const lines = source.split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim().length > 0);
  const directive = /^@@\s*append_to\s+(\S+)\s*$/.exec(lines[first]?.trim() ?? "");
  if (!directive?.[1]) return source;
  const resolved = buildRefMap(doc).resolve(directive[1]);
  if (resolved?.kind !== "block") return source;
  const block = findBlock(doc.blocks, resolved.id);
  const table = block?.type === "table" ? TableSchema.safeParse(block.props["table"]) : undefined;
  if (!table?.success) return source;
  const body = lines.slice(first + 1).filter((l) => l.trim().length > 0);
  if (body.length === 0 || !body.every((l) => l.trim().startsWith("|"))) return source;
  if (body[1] !== undefined && SEPARATOR.test(body[1].trim())) return source;
  const names = table.data.columns.map((c) => c.name);
  return [
    ...lines.slice(0, first + 1),
    `| ${names.join(" | ")} |`,
    `| ${names.map(() => "---").join(" | ")} |`,
    ...body,
  ].join("\n");
}
