import { z } from "zod";
import { STATUSES } from "../model/status";

/**
 * The op language: what Command Mode may ask for, as JSON the model writes and the compiler checks.
 * Refs (`b3`, `b9.2`) come from the outline; table rows and columns (`r2`, `c1`), edges (`e4`) and node slugs are the
 * ids inside their own block. Anything else is rejected by the compiler with a message the model can act on.
 */
const Ref = z.string().min(1).max(40);
const Slug = z.string().min(1).max(40);
/** A table anchor: a row or column id, or "start" / "end". */
const Anchor = z.string().min(1).max(40);
const Lmd = z.string().min(1).max(4000);

export const PosSchema = z.union([
  z.strictObject({ after: Ref }),
  z.strictObject({ before: Ref }),
  z.strictObject({ start_of_section: Ref }),
  z.strictObject({ end_of_section: Ref }),
  z.strictObject({ end: z.literal(true) }),
]);
export type Pos = z.infer<typeof PosSchema>;

export const SET_TYPES = [
  "h1",
  "h2",
  "h3",
  "paragraph",
  "bullet",
  "numbered",
  "checklist",
  "quote",
  "callout_note",
  "callout_key",
  "callout_decision",
  "callout_tradeoff",
  "callout_warning",
  "callout_question",
] as const;
export const MARKS = ["bold", "italic", "underline", "strike", "highlight", "code"] as const;
export const CONVERT_TO = [
  "table",
  "diagram",
  "bullets",
  "checklist",
  "chart",
  "paragraph",
] as const;

export const OpSchema = z.discriminatedUnion("op", [
  // ---- blocks and text ----
  z.strictObject({ op: z.literal("insert"), at: PosSchema, lmd: Lmd }),
  z.strictObject({ op: z.literal("replace"), target: Ref, lmd: Lmd }),
  z.strictObject({ op: z.literal("delete"), target: Ref }),
  z.strictObject({ op: z.literal("move"), target: Ref, to: PosSchema }),
  z.strictObject({ op: z.literal("archive"), target: Ref }),
  z.strictObject({ op: z.literal("set_type"), target: Ref, type: z.enum(SET_TYPES) }),
  z.strictObject({
    op: z.literal("mark"),
    target: Ref,
    match: z.string().max(200).nullable(),
    mark: z.enum(MARKS),
    on: z.boolean(),
  }),
  z.strictObject({
    op: z.literal("set_status"),
    target: Ref,
    /** The table or diagram holding `target`, when `target` is a row, column, node or edge id. */
    in: Ref.nullable(),
    status: z.enum(STATUSES),
  }),
  z.strictObject({
    op: z.literal("convert"),
    targets: z.array(Ref).min(1).max(20),
    to: z.enum(CONVERT_TO),
    lmd: Lmd,
  }),
  // ---- diagram ----
  z.strictObject({
    op: z.literal("graph.patch"),
    target: Ref,
    lines: z.array(z.string().max(200)).min(1).max(40),
  }),
  z.strictObject({
    op: z.literal("graph.remove"),
    target: Ref,
    nodes: z.array(Slug).max(20),
    edges: z.array(Slug).max(20),
  }),
  z.strictObject({
    op: z.literal("graph.rename"),
    target: Ref,
    node: Slug,
    label: z.string().min(1).max(60),
  }),
  z.strictObject({ op: z.literal("graph.reverse"), target: Ref, edge: Slug }),
  z.strictObject({
    op: z.literal("graph.insert_between"),
    target: Ref,
    from: Slug,
    to: Slug,
    /** An LGN node declaration, e.g. `cdn [cdn]: CDN`. */
    node: z.string().min(1).max(100),
    labels: z.tuple([z.string().max(60), z.string().max(60)]).nullable(),
  }),
  z.strictObject({ op: z.literal("graph.group"), target: Ref, group: z.string().min(1).max(200) }),
  z.strictObject({ op: z.literal("graph.ungroup"), target: Ref, group: Slug }),
  z.strictObject({
    op: z.literal("graph.set"),
    target: Ref,
    direction: z.enum(["LR", "TB"]).nullable(),
    title: z.string().max(80).nullable(),
    type: z.enum(["flowchart", "sequence", "er"]).nullable(),
  }),
  // ---- table ----
  z.strictObject({
    op: z.literal("table.add_row"),
    target: Ref,
    after: Anchor,
    cells: z.array(z.string().max(200)).min(1).max(12),
  }),
  z.strictObject({
    op: z.literal("table.set_cells"),
    target: Ref,
    row: Anchor,
    cells: z
      .array(z.strictObject({ col: Anchor, text: z.string().max(200) }))
      .min(1)
      .max(12),
  }),
  z.strictObject({ op: z.literal("table.remove_row"), target: Ref, row: Anchor }),
  z.strictObject({ op: z.literal("table.move_row"), target: Ref, row: Anchor, after: Anchor }),
  z.strictObject({
    op: z.literal("table.add_column"),
    target: Ref,
    name: z.string().min(1).max(60),
    after: Anchor,
    cells: z.array(z.string().max(200)).max(40),
  }),
  z.strictObject({
    op: z.literal("table.rename_column"),
    target: Ref,
    col: Anchor,
    name: z.string().min(1).max(60),
  }),
  z.strictObject({ op: z.literal("table.remove_column"), target: Ref, col: Anchor }),
  z.strictObject({ op: z.literal("table.move_column"), target: Ref, col: Anchor, after: Anchor }),
  z.strictObject({ op: z.literal("table.set_caption"), target: Ref, caption: z.string().max(120) }),
]);
export type Op = z.infer<typeof OpSchema>;
export type OpName = Op["op"];

export const CLARIFY_OPTIONS = { min: 2, max: 4 } as const;
export const MAX_OPS = 20;

/**
 * What goes over the wire: one flat object with a `kind`, because constrained decoding follows a flat grammar more
 * reliably than a union at the root. `parseCommandResponse` turns it into the typed `CommandResponse`.
 */
export const CommandWireSchema = z.strictObject({
  kind: z.enum(["edit", "clarify", "none"]),
  /** edit: what changed, past tense, at most 120 characters. */
  summary: z.string().max(120).nullable(),
  ops: z.array(OpSchema).max(MAX_OPS).nullable(),
  /** clarify */
  question: z.string().max(200).nullable(),
  options: z
    .array(z.strictObject({ label: z.string().min(1).max(100), ref: Ref.nullable() }))
    .max(CLARIFY_OPTIONS.max)
    .nullable(),
  /** none: why nothing was done. "content" means the utterance was notes, not an instruction. */
  reason: z.string().max(200).nullable(),
});
export type CommandWire = z.infer<typeof CommandWireSchema>;

export type CommandResponse =
  | { kind: "edit"; summary: string; ops: Op[] }
  | { kind: "clarify"; question: string; options: { label: string; ref: string | null }[] }
  | { kind: "none"; reason: string };

export type CommandParse = { ok: true; value: CommandResponse } | { ok: false; errors: string[] };

const issuePath = (path: PropertyKey[]): string => path.map(String).join(".");

/** Reads the model's JSON. Errors are written for the repair round: short, and naming the field. */
export function parseCommandResponse(text: string): CommandParse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["The answer is not valid JSON."] };
  }
  const wire = CommandWireSchema.safeParse(json);
  if (!wire.success) {
    return {
      ok: false,
      errors: wire.error.issues
        .slice(0, 6)
        .map((i) => `${issuePath(i.path) || "answer"}: ${i.message}`),
    };
  }
  const w = wire.data;
  switch (w.kind) {
    case "edit":
      if (!w.ops || w.ops.length === 0)
        return { ok: false, errors: ['kind "edit" needs at least one op.'] };
      return {
        ok: true,
        value: { kind: "edit", summary: w.summary?.trim() || "Edited the notes", ops: w.ops },
      };
    case "clarify":
      if (!w.question || !w.options || w.options.length < CLARIFY_OPTIONS.min)
        return { ok: false, errors: ['kind "clarify" needs a question and 2 to 4 options.'] };
      return {
        ok: true,
        value: {
          kind: "clarify",
          question: w.question,
          options: w.options.map((o) => ({ label: o.label, ref: o.ref })),
        },
      };
    case "none":
      // The model sometimes asks its question under "none": a question with options is a clarify.
      if (w.question && w.options && w.options.length >= CLARIFY_OPTIONS.min) {
        return {
          ok: true,
          value: {
            kind: "clarify",
            question: w.question,
            options: w.options.map((o) => ({ label: o.label, ref: o.ref })),
          },
        };
      }
      return {
        ok: true,
        value: { kind: "none", reason: w.reason?.trim() || "Nothing to change." },
      };
  }
}

/**
 * The JSON Schema sent to LM Studio for strict structured output. With `allowClarify: false` the model cannot answer
 * "clarify": used when the person has just answered its question, so it must act on the answer.
 */
export function commandJsonSchema(options: { allowClarify?: boolean } = {}): object {
  const { $schema: _unused, ...schema } = z.toJSONSchema(CommandWireSchema) as Record<
    string,
    unknown
  >;
  if (options.allowClarify !== false) return schema;
  const properties = schema["properties"] as Record<string, { enum?: string[] }>;
  const kind = properties["kind"];
  if (kind?.enum) kind.enum = kind.enum.filter((k) => k !== "clarify");
  return schema;
}
