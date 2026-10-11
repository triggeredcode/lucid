import type { Block, BlockType } from "@lucid/core";
import type { z } from "zod";

/** How much of a block the LLM outline shows: full for the focus area, summary elsewhere. */
export type OutlineDetail = "full" | "summary";

/** text: inline content (headings, paragraphs, list items). container: child blocks. atom: neither. */
export type BlockKind = "text" | "container" | "atom";

export interface MarkdownContext {
  /** Nesting depth (0 at top level); list items indent by 2 spaces per level. */
  depth: number;
  /** 1-based position among consecutive siblings of the same list type, for numbered items. */
  index: number;
  /** Render nested blocks (children) at the given depth. */
  renderChildren(blocks: readonly Block[], depth: number): string;
}

/**
 * Everything the app knows about one block type. Adding a block means adding one folder under
 * `blocks/` that exports a BlockSpec and registering it in `blocks/index.ts`; the contract test then checks it.
 */
export interface BlockSpec {
  readonly type: BlockType;
  readonly kind: BlockKind;
  /** Validates and normalises `props` (fills defaults such as `status: "normal"`). */
  readonly propsSchema: z.ZodType<Record<string, unknown>>;
  /** At most 6 lines, put into the model's prompt: what the block is for, when to use it, one LMD example. */
  readonly describe: string;
  /** Valid example blocks (ids are stable) used by tests, few-shots and golden files. */
  readonly fixtures: readonly Block[];
  /** Problems the schema cannot express (graph/table/chart invariants). Empty means valid. */
  check?(props: Record<string, unknown>): string[];
  /** The block as one or more lines of the LLM outline, without its `[bN]` ref. */
  outline(block: Block, detail: OutlineDetail): string;
  /** Markdown (GFM plus Lucid extensions) for export. */
  toMarkdown(block: Block, ctx: MarkdownContext): string;
}
