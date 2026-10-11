import { z } from "zod";

/**
 * LucidDoc: the canonical, editor-agnostic document model.
 *
 * This file defines the envelope only. Each block type's `props` are validated by its Block Kit
 * schema (`packages/kit/src/blocks/<type>/schema.ts`); the graph, table and chart payloads live in
 * `model/graph.ts`, `model/table.ts` and `model/chart.ts`.
 */

export const BLOCK_TYPES = [
  "heading",
  "paragraph",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "callout",
  "table",
  "diagram",
  "math",
  "chart",
  "code",
] as const;

export const BlockTypeSchema = z.enum(BLOCK_TYPES);
export type BlockType = z.infer<typeof BlockTypeSchema>;

/** Block ids are opaque non-empty strings (the editor assigns them; do not rely on their format). */
export const BlockIdSchema = z.string().min(1).max(128);

export const InlineStylesSchema = z.strictObject({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  highlight: z.boolean().optional(),
  code: z.boolean().optional(),
});
export type InlineStyles = z.infer<typeof InlineStylesSchema>;

export const TextInlineSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string(),
  styles: InlineStylesSchema,
});
export type TextInline = z.infer<typeof TextInlineSchema>;

export const LinkInlineSchema = z.strictObject({
  type: z.literal("link"),
  href: z.string().min(1),
  content: z.array(TextInlineSchema),
});
export type LinkInline = z.infer<typeof LinkInlineSchema>;

export const MathInlineSchema = z.strictObject({
  type: z.literal("mathInline"),
  latex: z.string(),
});
export type MathInline = z.infer<typeof MathInlineSchema>;

export const InlineSchema = z.discriminatedUnion("type", [
  TextInlineSchema,
  LinkInlineSchema,
  MathInlineSchema,
]);
export type Inline = z.infer<typeof InlineSchema>;

export interface Block {
  id: string;
  type: BlockType;
  props: Record<string, unknown>;
  /** Text blocks only (heading, paragraph, list items). */
  content?: Inline[] | undefined;
  /** Nesting: sub-bullets, callout bodies. */
  children?: Block[] | undefined;
}

export const BlockSchema: z.ZodType<Block> = z.lazy(() =>
  z.strictObject({
    id: BlockIdSchema,
    type: BlockTypeSchema,
    props: z.record(z.string(), z.unknown()),
    content: z.array(InlineSchema).optional(),
    children: z.array(BlockSchema).optional(),
  }),
);

export const LucidDocSchema = z.strictObject({ blocks: z.array(BlockSchema) });
export type LucidDoc = z.infer<typeof LucidDocSchema>;

/** Depth-first, document-order walk over blocks and their children. */
export function* iterBlocks(blocks: readonly Block[]): Generator<Block> {
  for (const block of blocks) {
    yield block;
    if (block.children) yield* iterBlocks(block.children);
  }
}

/** Ids used by more than one block anywhere in the document, sorted. Valid documents return []. */
export function findDuplicateIds(doc: LucidDoc): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const block of iterBlocks(doc.blocks)) {
    if (seen.has(block.id)) duplicates.add(block.id);
    seen.add(block.id);
  }
  return [...duplicates].sort();
}
