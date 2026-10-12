import { createHash } from "node:crypto";
import {
  OpSchema,
  destructiveOps,
  buildRefMap,
  type Block,
  type BlockPatch,
  type LucidDoc,
  type Op,
} from "@lucid/core";
import {
  BLOCK_SPECS,
  FORMATS,
  META_LABEL,
  getFormat,
  LMD_REFERENCE,
  OPS_REFERENCE,
  OpError,
  PlacementError,
  blocksToLmd,
  buildOutline,
  compileOps,
  inlineToPlain,
  parseLmd,
  placeBlocks,
  type Placement,
} from "@lucid/kit";
import { z } from "zod";
import type { Backend, PageState } from "./backend";

/** A short fingerprint of a document, so a tool can tell that the page changed since the agent last read it. */
export const revisionOf = (doc: LucidDoc): string =>
  createHash("sha1").update(JSON.stringify(doc)).digest("hex").slice(0, 8);

export interface ToolContext {
  backend: Backend;
  /** Who is asking: shown in the page's change history as `agent:<name>`. */
  agent: string;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  input: Record<string, z.ZodType>;
  /** Reads without changing anything. */
  readOnly: boolean;
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

const pageId = z
  .string()
  .optional()
  .describe("The page id from list_documents. Omit it for the page that is open in Lucid.");
const revision = z
  .string()
  .optional()
  .describe(
    "The revision from get_outline or read_document. If the page changed since, the call is refused so you do not edit a page you have not seen.",
  );

const fail = (text: string): ToolResult => ({ text, isError: true });

function stale(page: PageState, wanted: string | undefined): ToolResult | undefined {
  if (wanted === undefined || wanted === revisionOf(page.doc)) return undefined;
  return fail(
    `The page changed since you read it (now revision ${revisionOf(page.doc)}). Call get_outline again, then retry.`,
  );
}

const header = (page: PageState): string => {
  const f = getFormat(page.format);
  return `PAGE "${page.title}" (id ${page.id}${page.open ? ", open in Lucid" : ""}${f ? `, format ${f.id}` : ""}, revision ${revisionOf(page.doc)})`;
};

/** What a note format asks for, as lines an agent can read: where each kind of note goes. */
const sectionsOf = (id: string | undefined): string => {
  const f = getFormat(id);
  if (!f) return "";
  return [
    "",
    `SECTIONS of this ${f.name.toLowerCase()} (put notes in one with position "section:<heading>"):`,
    ...f.sections.map((s) => `- ${s.heading}: ${s.hint} Suits: ${s.prefer.join(", ")}.`),
  ].join("\n");
};

const plain = (b: Block): string => inlineToPlain(b.content);

export const TOOLS: ToolDef[] = [
  {
    name: "list_documents",
    title: "List pages",
    description: "List the pages in the Lucid library: id, title and when each was last changed.",
    input: {},
    readOnly: true,
    async run({ backend }) {
      const pages = await backend.listPages();
      if (pages.length === 0) return { text: "There are no pages yet." };
      return { text: pages.map((p) => `${p.id}  ${p.updatedAt}  ${p.title}`).join("\n") };
    },
  },
  {
    name: "get_outline",
    title: "Get the outline of a page",
    description:
      "The page as a compact outline: one line or a few per block, each with a short reference like [b5] (list items [b6.2]; table rows, columns, diagram nodes and edges use their own ids). " +
      "Use these references in apply_ops and in insert_notes positions. Diagrams and tables are shown in full.",
    input: {
      page_id: pageId,
      detail: z
        .enum(["full", "summary"])
        .optional()
        .describe("full (default) shows every block in detail; summary shortens long text."),
    },
    readOnly: true,
    async run({ backend }, args) {
      const page = await backend.getPage(args["page_id"] as string | undefined);
      const full = args["detail"] === "summary" ? [] : page.doc.blocks.map((b) => b.id);
      const outline = buildOutline(page.doc, { title: page.title, full, maxChars: 80_000 });
      return { text: `${header(page)}\n\n${outline.text}${sectionsOf(page.format)}` };
    },
  },
  {
    name: "read_document",
    title: "Read a page as Lucid Markdown",
    description:
      "The whole page as Lucid Markdown (LMD): the same language insert_notes accepts. Use it to read what the page says in full; use get_outline to address blocks.",
    input: { page_id: pageId },
    readOnly: true,
    async run({ backend }, args) {
      const page = await backend.getPage(args["page_id"] as string | undefined);
      return { text: `${header(page)}\n\n${blocksToLmd(page.doc.blocks)}` };
    },
  },
  {
    name: "insert_notes",
    title: "Add notes to a page",
    description:
      "Add notes written in Lucid Markdown (LMD, see describe_kit) to a page. They become typed blocks (headings, bullets, tables, diagrams...) and are one undo step for the person. " +
      "Where: position 'end' (default), 'after:b3', 'before:b3', 'append_to:b6' (more items in the list b6, or more rows in the table b6 written as a pipe table with the same columns) or 'section:Heading text'. " +
      "The first line of the notes may also be a directive such as '@@ after b3'.",
    input: {
      page_id: pageId,
      lmd: z.string().min(1).max(60_000).describe("The notes, in Lucid Markdown."),
      position: z
        .string()
        .optional()
        .describe("end | after:bN | before:bN | append_to:bN | section:Heading"),
      revision,
    },
    readOnly: false,
    async run({ backend, agent }, args) {
      const page = await backend.getPage(args["page_id"] as string | undefined);
      const old = stale(page, args["revision"] as string | undefined);
      if (old) return old;
      const parsed = parseLmd(args["lmd"] as string);
      if (!parsed.ok)
        return fail(
          `The notes could not be read:\n${parsed.errors.map((e) => `line ${String(e.line)}: ${e.message}`).join("\n")}`,
        );
      if (parsed.command)
        return fail("Directives like '@@ command' are not notes. Send the notes themselves.");
      if (parsed.blocks.length === 0) return fail("There was nothing to add.");
      const where = placementFrom(args["position"] as string | undefined, parsed.placement);
      if (typeof where === "string") return fail(where);
      let patch: BlockPatch;
      try {
        patch = placeBlocks(page.doc, parsed.blocks, where);
      } catch (error) {
        if (error instanceof PlacementError) return fail(error.message);
        throw error;
      }
      const result = await backend.applyPatch(page.id, patch, {
        summary: `Added ${count(parsed.blocks)}`,
        source: `agent:${agent}`,
        affected: parsed.blocks.map((b) => b.id),
      });
      return {
        text: `Added ${count(parsed.blocks)} to "${page.title}". New revision ${revisionOf(result.doc)}. Call get_outline for the new references.`,
      };
    },
  },
  {
    name: "apply_ops",
    title: "Edit a page with ops",
    description:
      "Make targeted edits with the op language (see describe_kit): graph.insert_between, table.add_row, set_status struck/chosen, replace, move... " +
      "References come from get_outline. All ops are applied together as one undo step, or none are. Ops that throw something away (deleting, or rewriting most of a block) are refused unless allow_destructive is true.",
    input: {
      page_id: pageId,
      ops: z.array(OpSchema).min(1).max(40).describe("The ops, in order."),
      summary: z
        .string()
        .max(120)
        .optional()
        .describe("What changed, in the past tense (shown in the page's history)."),
      allow_destructive: z
        .boolean()
        .optional()
        .describe("Allow ops that delete or mostly rewrite content."),
      revision,
    },
    readOnly: false,
    async run({ backend, agent }, args) {
      const page = await backend.getPage(args["page_id"] as string | undefined);
      const old = stale(page, args["revision"] as string | undefined);
      if (old) return old;
      const ops = args["ops"] as Op[];
      const refs = buildRefMap(page.doc);
      const textOf = (ref: string): string | undefined => {
        const r = refs.resolve(ref);
        if (!r) return undefined;
        const ids = r.kind === "list" ? r.ids : [r.id];
        const found = ids
          .map((id) => findBlock(page.doc.blocks, id))
          .filter((b): b is Block => b !== undefined);
        return found.length > 0 ? found.map(plain).join("\n") : undefined;
      };
      const destructive = destructiveOps(ops, { textOf });
      if (destructive.length > 0 && args["allow_destructive"] !== true)
        return fail(
          `These ops throw something away, so nothing was changed:\n${destructive
            .map((d) => `- op ${String(d.index + 1)} (${d.op.op}): ${d.reason}`)
            .join(
              "\n",
            )}\nTell the person, or retry with allow_destructive: true if that is what they asked for.`,
        );
      let compiled;
      try {
        compiled = compileOps(page.doc, ops);
      } catch (error) {
        if (error instanceof OpError) return fail(error.message);
        throw error;
      }
      if (compiled.patch.steps.length === 0) return { text: "Nothing changed." };
      const summary =
        (args["summary"] as string | undefined) ??
        `Applied ${String(ops.length)} edit${ops.length === 1 ? "" : "s"}`;
      const result = await backend.applyPatch(page.id, compiled.patch, {
        summary,
        source: `agent:${agent}`,
        affected: compiled.affected,
      });
      const warn = compiled.warnings.length > 0 ? ` Warnings: ${compiled.warnings.join("; ")}` : "";
      return { text: `${summary}. New revision ${revisionOf(result.doc)}.${warn}` };
    },
  },
  {
    name: "list_formats",
    title: "List the note formats",
    description:
      "The note formats a page can have (concept note, system design, comparison): what each is for, its sections with what belongs in each, and the fields shown under the title in the PDF. Use the id in create_document.",
    input: {},
    readOnly: true,
    run() {
      return Promise.resolve({
        text: FORMATS.map((f) =>
          [
            `${f.id}: ${f.name}. ${f.description}`,
            `  fields under the title: ${f.meta.map((m) => META_LABEL[m]).join(", ") || "none"}`,
            ...f.sections.map((s) => `  - ${s.heading}: ${s.hint} Suits: ${s.prefer.join(", ")}.`),
          ].join("\n"),
        ).join("\n\n"),
      });
    },
  },
  {
    name: "create_document",
    title: "Create a page",
    description:
      'Make a new page, blank or of a note format (see list_formats). A format page starts as its section headings; add notes under them with insert_notes (position "section:<heading>"). Empty sections are not printed in the PDF.',
    input: {
      title: z.string().min(1).max(120).describe("The page title."),
      format: z
        .string()
        .optional()
        .describe("A format id from list_formats. Omit for a blank page."),
    },
    readOnly: false,
    async run({ backend }, args) {
      const format = args["format"] as string | undefined;
      if (format !== undefined && !getFormat(format))
        return fail(
          `There is no format "${format}". Use one of: ${FORMATS.map((f) => f.id).join(", ")}.`,
        );
      const page = await backend.createPage(args["title"] as string, format);
      return {
        text: `Created "${page.title}" (id ${page.id}${format ? `, format ${format}` : ", blank"}). Call get_outline with page_id ${page.id} to see it.`,
      };
    },
  },
  {
    name: "export_pdf",
    title: "Make the PDF",
    description:
      "Typeset a page as a PDF in Lucid's house style (diagrams, tables and formulas included, in the page's format) and save it in the library's exports folder. Returns the file path. It takes a few seconds, up to a minute for a big page. The page is not changed.",
    input: { page_id: pageId },
    readOnly: false,
    async run({ backend }, args) {
      const made = await backend.exportPdf(args["page_id"] as string | undefined);
      const kb = Math.max(1, Math.round(made.bytes / 1024));
      const warnings = made.warnings.map((w) => `\nNote: ${w}`).join("");
      return { text: `Saved the PDF (${String(kb)} KB): ${made.path}${warnings}` };
    },
  },
  {
    name: "describe_kit",
    title: "What blocks and ops Lucid has",
    description:
      "The building blocks of a Lucid page (what each is for and how to write it), the Lucid Markdown language for insert_notes, and the op language for apply_ops. Read this once before writing.",
    input: {},
    readOnly: true,
    run() {
      const blocks = BLOCK_SPECS.map(
        (s) => `- ${s.type}: ${s.describe.replace(/\n/g, "\n  ")}`,
      ).join("\n");
      return Promise.resolve({
        text: `BLOCKS\n${blocks}\n\nLUCID MARKDOWN (insert_notes)\n${LMD_REFERENCE}\n\nOPS (apply_ops)\n${OPS_REFERENCE}`,
      });
    },
  },
];

function count(blocks: readonly Block[]): string {
  return `${String(blocks.length)} block${blocks.length === 1 ? "" : "s"}`;
}

function findBlock(blocks: readonly Block[], id: string): Block | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    const inner = b.children ? findBlock(b.children, id) : undefined;
    if (inner) return inner;
  }
  return undefined;
}

/** "end", "after:b3", "before:b3", "append_to:b6" or "section:Heading"; undefined keeps what the notes themselves say. */
function placementFrom(position: string | undefined, fromNotes: Placement): Placement | string {
  if (position === undefined || position.trim().length === 0)
    return fromNotes.kind === "cursor" ? { kind: "end" } : fromNotes;
  const p = position.trim();
  if (p === "end") return { kind: "end" };
  const m = /^(after|before|append_to|section)\s*[:\s]\s*(.+)$/i.exec(p);
  if (!m?.[1] || !m[2])
    return `Unknown position "${position}". Use end, after:bN, before:bN, append_to:bN or section:Heading.`;
  const kind = m[1].toLowerCase();
  if (kind === "section") return { kind: "section", heading: m[2].trim() };
  return { kind: kind as "after" | "before" | "append_to", ref: m[2].trim() };
}
