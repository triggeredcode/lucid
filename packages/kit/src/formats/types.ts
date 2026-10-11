import type { BlockType } from "@lucid/core";
import { z } from "zod";

/** The fields a note format may show under the title. */
export const META_FIELDS = ["source", "book", "chapter", "date", "hardware"] as const;
export type MetaField = (typeof META_FIELDS)[number];

export const META_LABEL: Record<MetaField, string> = {
  source: "Source",
  book: "Book",
  chapter: "Chapter",
  date: "Date",
  hardware: "Hardware",
};

const BLOCK_TYPES_FOR_SECTIONS = [
  "paragraph",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "callout",
  "table",
  "diagram",
  "chart",
  "math",
  "code",
] as const satisfies readonly BlockType[];

/**
 * A kind of note: the sections it usually has, which blocks suit each, and how its PDF is set. The model
 * only fills the sections; the typography stays in the house style.
 */
export const FormatSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1).max(40),
  /** Shown to the model when it picks a format, so it stays short. */
  description: z.string().min(1).max(200),
  /** For the fallback picker when the model cannot choose. */
  keywords: z.array(z.string().min(1)).min(3),
  meta: z.array(z.enum(META_FIELDS)),
  sections: z
    .array(
      z.strictObject({
        key: z.string().regex(/^[a-z][a-z-]*$/),
        heading: z.string().min(1).max(60),
        /** What belongs here: shown to the model when placing notes. */
        hint: z.string().min(1).max(160),
        prefer: z.array(z.enum(BLOCK_TYPES_FOR_SECTIONS)),
      }),
    )
    .min(1),
  latex: z.strictObject({
    /** Display formulas get numbers. */
    equationNumbers: z.boolean(),
    /** How wide diagrams are set, as a share of the text width. */
    diagramWidth: z.number().min(0.5).max(1),
  }),
});
export type Format = z.infer<typeof FormatSchema>;
export type FormatSection = Format["sections"][number];
