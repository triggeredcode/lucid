import { z } from "zod";
import { BlockSchema, LucidDocSchema, type LucidDoc } from "../model/doc";
import { newId } from "../model/ids";

/**
 * The saved form of a page: one JSON file per page. The format is versioned; `parseLucidFile`
 * migrates older versions and rejects files it cannot understand without ever touching them.
 */

export const CURRENT_VERSION = 1;

export const TranscriptEntrySchema = z.strictObject({
  id: z.string().min(1),
  text: z.string(),
  source: z.enum(["wispr", "whisper", "typed"]),
  mode: z.enum(["input", "command"]),
  createdAt: z.string(),
  status: z.enum(["applied", "meta", "failed", "unprocessed", "rejected"]),
});
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

const PatchStepSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("insert"),
    parentId: z.string().nullable(),
    afterId: z.string().nullable(),
    blocks: z.array(BlockSchema),
  }),
  z.strictObject({ kind: z.literal("update"), id: z.string(), block: BlockSchema }),
  z.strictObject({ kind: z.literal("remove"), id: z.string() }),
  z.strictObject({
    kind: z.literal("move"),
    id: z.string(),
    parentId: z.string().nullable(),
    afterId: z.string().nullable(),
  }),
]);

/** The way back for a change (see `model/revert.ts`): the patch that takes it back, and what its blocks looked like after. */
export const RevertSchema = z.strictObject({
  undo: z.strictObject({ steps: z.array(PatchStepSchema) }),
  expect: z.record(z.string(), BlockSchema.nullable()),
});

export const ChangeEntrySchema = z.strictObject({
  id: z.string().min(1),
  at: z.string(),
  summary: z.string(),
  source: z.string(),
  affected: z.array(z.string()),
  /** The change was taken back (by Revert in the History). */
  reverted: z.boolean().default(false),
  /** How to take it back, kept for the newest entries only. */
  revert: RevertSchema.optional(),
});
export type ChangeEntry = z.infer<typeof ChangeEntrySchema>;

export const LucidFileSchema = z.strictObject({
  format: z.literal("lucid"),
  version: z.literal(CURRENT_VERSION),
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  doc: LucidDocSchema,
  transcripts: z.array(TranscriptEntrySchema).default([]),
  changeLog: z.array(ChangeEntrySchema).default([]),
  meta: z
    .strictObject({
      author: z.string().optional(),
      vocabulary: z.array(z.string()).default([]),
      /** The note format (a `@lucid/kit` format id), or none for a blank page. */
      format: z.string().optional(),
      /** Fields shown under the title in the PDF (the format says which: source, book, chapter, date, hardware). */
      info: z.record(z.string(), z.string()).default({}),
    })
    .default({ vocabulary: [], info: {} }),
});
export type LucidFile = z.infer<typeof LucidFileSchema>;

export class LucidFileError extends Error {
  constructor(
    readonly code: "not_json_object" | "not_lucid" | "newer_version" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "LucidFileError";
  }
}

/** Upgrade older file versions step by step. Version 1 is the first, so there is nothing to upgrade yet. */
const MIGRATIONS: Record<number, (file: Record<string, unknown>) => Record<string, unknown>> = {};

export function parseLucidFile(input: unknown): LucidFile {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new LucidFileError("not_json_object", "This file is not a Lucid page.");
  }
  let file = { ...(input as Record<string, unknown>) };
  if (file["format"] !== "lucid")
    throw new LucidFileError("not_lucid", "This file is not a Lucid page.");
  let version = typeof file["version"] === "number" ? file["version"] : 0;
  if (version > CURRENT_VERSION) {
    throw new LucidFileError(
      "newer_version",
      `This page was saved by a newer version of Lucid (format ${String(version)}).`,
    );
  }
  while (version < CURRENT_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate)
      throw new LucidFileError("invalid", `Cannot upgrade page format ${String(version)}.`);
    file = { ...migrate(file), version: version + 1 };
    version += 1;
  }
  const parsed = LucidFileSchema.safeParse(file);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new LucidFileError(
      "invalid",
      `This page is damaged: ${first?.path.join(".") ?? ""} ${first?.message ?? ""}`.trim(),
    );
  }
  return parsed.data;
}

export interface NewFileOptions {
  title?: string;
  doc?: LucidDoc;
  author?: string;
  /** A kit format id for the new page. */
  format?: string;
  now?: () => Date;
  id?: () => string;
}

export function createLucidFile(options: NewFileOptions = {}): LucidFile {
  const now = (options.now ?? (() => new Date()))().toISOString();
  return {
    format: "lucid",
    version: CURRENT_VERSION,
    id: (options.id ?? newId)(),
    title: options.title ?? "Untitled",
    createdAt: now,
    updatedAt: now,
    doc: options.doc ?? { blocks: [] },
    transcripts: [],
    changeLog: [],
    meta: {
      vocabulary: [],
      info: {},
      ...(options.author === undefined ? {} : { author: options.author }),
      ...(options.format === undefined ? {} : { format: options.format }),
    },
  };
}

/** `Designing a URL shortener!` becomes `designing-a-url-shortener`; never empty, at most 60 characters. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "untitled";
}

/** File name for a page: `<slug>--<first 8 characters of the id>.lucid`. */
export function fileNameFor(file: Pick<LucidFile, "title" | "id">): string {
  return `${slugify(file.title)}--${file.id
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toLowerCase()}.lucid`;
}
