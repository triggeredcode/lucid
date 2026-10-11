import type { BlockType } from "@lucid/core";

/** The kinds of behaviour the cases probe. */
export const CATEGORIES = [
  "input_structure",
  "input_diagram",
  "input_table",
  "input_math",
  "input_placement",
  "diagram_edit",
  "table_edit",
  "reference_resolution",
  "block_reference",
  "non_destructive",
  "ambiguity_clarify",
  "mode_separation",
  "destructive_confirm",
  "stt_noise",
  "conversion",
  "grounding_adversarial",
  "benchmark_numbers",
  "format_pick",
  "format_placement",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Per-category pass rate needed: higher where a mistake loses the user's work or words. */
export const CATEGORY_THRESHOLD: Partial<Record<Category, number>> = {
  non_destructive: 0.95,
  mode_separation: 0.95,
};
export const DEFAULT_CATEGORY_THRESHOLD = 0.8;
export const OVERALL_THRESHOLD = 0.9;

export type Mode = "input" | "command" | "advisor";

/** Pages the cases start from (see fixtures.ts). */
export const FIXTURES = [
  "empty",
  "request-flow",
  "request-flow-no-cache",
  "db-options",
  "two-tables",
  "two-sectioned-tables",
  "sql-nosql-skeleton",
  "dictated-notes",
  "lb-points",
  "format-comparison",
  "format-benchmark",
] as const;
export type FixtureName = (typeof FIXTURES)[number];

/** Picks one block of a page: by kind, or by kind and position, or a heading by its text. */
export type Sel =
  | "diagram"
  | "table"
  | "list"
  | "heading"
  | "paragraph"
  | { type: BlockType | "list"; nth?: number | "last"; text?: string };

export interface Count {
  eq?: number;
  min?: number;
  max?: number;
}

export interface Edge {
  /** Labels (fuzzy) or ids. */
  from: string;
  to: string;
  /** Also accept the opposite direction. */
  either?: boolean;
  /** The edge's label contains this. */
  labelHas?: string;
}

export interface GraphExpect {
  on?: Sel;
  hasNodes?: string[];
  lacksNodes?: string[];
  hasEdges?: Edge[];
  lacksEdges?: Edge[];
  nodeCount?: Count;
  edgeCount?: Count;
  kinds?: { label: string; kind: string }[];
  statuses?: { label: string; status: "struck" | "chosen" | "normal" }[];
  /** Every node the answer added is in what the person said or already on the page. */
  noUngroundedNodes?: boolean;
  dashed?: Edge[];
}

export interface TableExpect {
  on?: Sel;
  /** Exactly these columns, in this order (fuzzy). */
  columns?: string[];
  rowCount?: Count;
  /** In this order, the first cells of the rows (fuzzy); the table may have more rows. */
  rowHeaders?: string[];
  /** A row whose first cell is `header`: these columns (by name) are not empty, or contain the text. */
  rows?: { header: string; filled?: string[]; contains?: Record<string, string> }[];
  rowStatuses?: { header: string; status: "struck" | "chosen" | "normal" }[];
  cellsContain?: string[];
}

export interface DocExpect {
  hasHeading?: { level?: number; text: string }[];
  /** Words or phrases the notes must have (stems are compared). */
  contains?: string[];
  lacks?: string[];
  /** Each of these is (part of) a list item. */
  listItems?: string[];
  blockCounts?: Partial<Record<BlockType, Count>>;
  itemStatuses?: { text: string; status: "struck" | "chosen" | "normal" }[];
  /** Under the section with this heading (until the next heading of the same level), these terms are found. */
  underHeading?: { heading: string; contains: string[] }[];
  /** How many list items there are in total. */
  listItemCount?: Count;
  /** Numbers in the answer are all in what was said or already on the page. */
  noInventedNumbers?: boolean;
  /** A formula block (or inline math) is there. */
  hasMath?: boolean;
  mathContains?: string[];
}

export interface Expect {
  /** What the pipeline should come to. Input: applied (default) or command. Command: edit (default), proposal, clarify or none. */
  outcome?: "applied" | "command" | "edit" | "proposal" | "clarify" | "none" | "advice";
  /** Advisor: the format that should be chosen. */
  formatId?: string;
  clarifyOptionsMin?: number;
  /** Command none: it must be the "this was content" kind of none. */
  noneIsContent?: boolean;
  /** Everything except these blocks is exactly as before. */
  touchedOnly?: Sel[];
  graph?: GraphExpect;
  table?: TableExpect;
  doc?: DocExpect;
  maxOutputTokens?: number;
}

export interface Case {
  id: string;
  category: Category;
  mode: Mode;
  doc: FixtureName;
  /** The block the cursor is in. */
  focus?: Sel;
  utterance: string;
  /** Other ways of saying it (lower-case as speech recognition writes, with fillers...); each is a trial of its own. */
  variants?: string[];
  recent?: { mode: "input" | "command"; text: string }[];
  /** Blocks the model changed last, newest first (what "that" refers to right after dictating). */
  touched?: Sel[];
  /** The page's note format (a kit format id); the model is told its sections. */
  format?: string;
  expect: Expect;
  /** Why this case is here, in a sentence (shown with a failure). */
  why?: string;
}
