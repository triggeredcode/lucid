import {
  LucidDocSchema,
  findDuplicateIds,
  type Block,
  type BlockType,
  type Inline,
  type InlineStyles,
  type LucidDoc,
} from "../model/doc";
import { createSequentialIds, type IdGenerator } from "../model/ids";
import type { Status } from "../model/status";

/**
 * Terse builders for tests and fixtures. Blocks are drafts without ids; `doc()` assigns ids in
 * document order (b1, b2, ...) and validates the envelope. Per-type props are NOT validated here
 * (the Block Kit schemas do that); this builder only guarantees a valid LucidDoc envelope.
 */

export interface Draft {
  id?: string | undefined;
  type: BlockType;
  props: Record<string, unknown>;
  content?: Inline[] | undefined;
  children?: Draft[] | undefined;
}

type Content = string | Inline[];
interface BlockOptions {
  id?: string;
}

export const t = (text: string, styles: InlineStyles = {}): Inline => ({
  type: "text",
  text,
  styles,
});

const inline = (content: Content): Inline[] =>
  typeof content === "string" ? [t(content)] : content;

/** Escape hatch for block types without a dedicated helper (table, diagram, chart). */
export function block(
  type: BlockType,
  props: Record<string, unknown> = {},
  extra: { content?: Content; children?: Draft[] } & BlockOptions = {},
): Draft {
  return {
    id: extra.id,
    type,
    props,
    content: extra.content === undefined ? undefined : inline(extra.content),
    children: extra.children,
  };
}

export const h1 = (text: Content, o: BlockOptions = {}) =>
  block("heading", { level: 1 }, { content: text, ...o });
export const h2 = (text: Content, o: BlockOptions = {}) =>
  block("heading", { level: 2 }, { content: text, ...o });
export const h3 = (text: Content, o: BlockOptions = {}) =>
  block("heading", { level: 3 }, { content: text, ...o });
export const p = (text: Content, o: BlockOptions = {}) =>
  block("paragraph", {}, { content: text, ...o });
export const math = (latex: string, o: BlockOptions = {}) => block("math", { latex }, o);
export const code = (language: string, source: string, o: BlockOptions = {}) =>
  block("code", { language, code: source }, o);

export type CalloutKind = "note" | "key" | "decision" | "tradeoff" | "warning" | "question";
export const callout = (kind: CalloutKind, title: string, ...children: (Draft | Draft[])[]) =>
  block("callout", { kind, title }, { children: children.flat() });

export interface ListItem {
  text: string;
  status?: Status;
  checked?: boolean;
  id?: string;
  children?: (string | ListItem)[];
}

function listItem(type: BlockType, item: string | ListItem): Draft {
  const o: ListItem = typeof item === "string" ? { text: item } : item;
  const props: Record<string, unknown> = {};
  if (o.status !== undefined) props["status"] = o.status;
  if (o.checked !== undefined) props["checked"] = o.checked;
  return block(type, props, {
    content: o.text,
    ...(o.id === undefined ? {} : { id: o.id }),
    ...(o.children === undefined ? {} : { children: o.children.map((c) => listItem(type, c)) }),
  });
}

/** One block per list item, so each item has its own id and status. */
export const bullets = (...items: (string | ListItem)[]): Draft[] =>
  items.map((i) => listItem("bulletListItem", i));
export const numbered = (...items: (string | ListItem)[]): Draft[] =>
  items.map((i) => listItem("numberedListItem", i));
export const checklist = (...items: (string | ListItem)[]): Draft[] =>
  items.map((i) => listItem("checkListItem", i));

type DraftInput = Draft | Draft[];

function build(drafts: DraftInput[], ids: IdGenerator): LucidDoc {
  const assign = (d: Draft): Block => ({
    id: d.id ?? ids(),
    type: d.type,
    props: d.props,
    ...(d.content === undefined ? {} : { content: d.content }),
    ...(d.children === undefined ? {} : { children: d.children.map(assign) }),
  });
  // Assign pre-order so a parent gets its number before its children.
  const blocks = drafts.flat().map(assign);
  const parsed = LucidDocSchema.parse({ blocks });
  const dupes = findDuplicateIds(parsed);
  if (dupes.length > 0)
    throw new Error(`Duplicate block ids in test document: ${dupes.join(", ")}`);
  return parsed;
}

interface DocBuilder {
  (...drafts: DraftInput[]): LucidDoc;
  with(options: { ids: IdGenerator }): (...drafts: DraftInput[]) => LucidDoc;
}

export const doc: DocBuilder = Object.assign(
  (...drafts: DraftInput[]) => build(drafts, createSequentialIds("b")),
  {
    with:
      (options: { ids: IdGenerator }) =>
      (...drafts: DraftInput[]) =>
        build(drafts, options.ids),
  },
);
