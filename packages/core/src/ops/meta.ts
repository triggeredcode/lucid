/**
 * Voice meta-commands: short whole-utterance phrases that Lucid handles itself, without the model.
 * Matching is exact after normalising, so a longer sentence that merely contains these words is never hijacked.
 */
export type Meta =
  | { intent: "mode"; mode: "input" | "command" | "edit" }
  /** Start the guided builder for a diagram or a table, or reopen the one in the page. */
  | { intent: "build"; what: "diagram" | "table"; existing: boolean }
  | { intent: "undo" }
  | { intent: "redo" }
  | { intent: "accept" }
  | { intent: "reject" }
  | { intent: "choose"; n: 1 | 2 | 3 | 4 }
  | { intent: "stop" }
  | { intent: "export_pdf" }
  | { intent: "export_markdown" };

export interface MetaState {
  /** A proposal waits for a yes or no. */
  proposal: boolean;
  /** A question with options waits for an answer. */
  clarify: boolean;
  /** A job is running. */
  running: boolean;
}

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:hey |okay |ok )?(?:lucid )/, "")
    .trim();

const COMMAND_MODE = new Set([
  "command mode",
  "switch to command mode",
  "commands",
  "go to command mode",
]);
const EDIT_MODE = new Set([
  "edit mode",
  "switch to edit mode",
  "manual mode",
  "manual edit",
  "edit by hand",
  "let me edit",
  "go to edit mode",
]);
const INPUT_MODE = new Set([
  "input mode",
  "switch to input mode",
  "back to notes",
  "dictation mode",
  "note mode",
  "notes mode",
  "go to input mode",
]);
const BUILD_DIAGRAM = new Set([
  "diagram mode",
  "diagramming mode",
  "enter diagram mode",
  "enter diagramming mode",
  "go to diagram mode",
  "new diagram",
  "start a diagram",
  "create a diagram",
  "build a diagram",
  "draw a diagram",
  "make a diagram",
]);
const BUILD_TABLE = new Set([
  "table mode",
  "enter table mode",
  "go to table mode",
  "new table",
  "start a table",
  "create a table",
  "build a table",
  "make a table",
]);
const EDIT_DIAGRAM = new Set([
  "edit this diagram",
  "edit the diagram",
  "edit diagram",
  "fix this diagram",
  "change this diagram",
]);
const EDIT_TABLE = new Set([
  "edit this table",
  "edit the table",
  "edit table",
  "fix this table",
  "change this table",
]);
const UNDO = new Set([
  "undo",
  "undo that",
  "undo the last change",
  "scratch that",
  "revert that",
  "undo last change",
]);
const REDO = new Set(["redo", "redo that"]);
const ACCEPT = new Set([
  "yes",
  "apply",
  "apply it",
  "accept",
  "confirm",
  "do it",
  "looks good",
  "yes please",
  "go ahead",
]);
const REJECT = new Set([
  "no",
  "cancel",
  "reject",
  "don't",
  "dont",
  "never mind",
  "nevermind",
  "no thanks",
]);
const STOP = new Set(["stop", "cancel that", "stop that", "abort"]);
const EXPORT = new Set(["export pdf", "export to pdf", "export as pdf"]);
const EXPORT_MARKDOWN = new Set([
  "export markdown",
  "export to markdown",
  "export as markdown",
  "download markdown",
  "save as markdown",
]);

const ORDINALS: Record<string, 1 | 2 | 3 | 4> = {
  first: 1,
  "the first one": 1,
  "option one": 1,
  "number one": 1,
  one: 1,
  second: 2,
  "the second one": 2,
  "option two": 2,
  "number two": 2,
  two: 2,
  third: 3,
  "the third one": 3,
  "option three": 3,
  "number three": 3,
  three: 3,
  fourth: 4,
  "the fourth one": 4,
  "option four": 4,
  "number four": 4,
  four: 4,
};

/** The meta-command an utterance is, if it is one. Context-dependent phrases only count while they make sense. */
export function parseMeta(utterance: string, state: MetaState): Meta | undefined {
  const text = normalise(utterance);
  if (text.length === 0 || text.split(" ").length > 6) return undefined;
  if (COMMAND_MODE.has(text)) return { intent: "mode", mode: "command" };
  if (BUILD_DIAGRAM.has(text)) return { intent: "build", what: "diagram", existing: false };
  if (BUILD_TABLE.has(text)) return { intent: "build", what: "table", existing: false };
  if (EDIT_DIAGRAM.has(text)) return { intent: "build", what: "diagram", existing: true };
  if (EDIT_TABLE.has(text)) return { intent: "build", what: "table", existing: true };
  if (EDIT_MODE.has(text)) return { intent: "mode", mode: "edit" };
  if (INPUT_MODE.has(text)) return { intent: "mode", mode: "input" };
  if (UNDO.has(text)) return { intent: "undo" };
  if (REDO.has(text)) return { intent: "redo" };
  if (EXPORT.has(text)) return { intent: "export_pdf" };
  if (EXPORT_MARKDOWN.has(text)) return { intent: "export_markdown" };
  if (state.clarify) {
    const n = ORDINALS[text];
    if (n) return { intent: "choose", n };
  }
  if (state.proposal || state.clarify) {
    if (ACCEPT.has(text) && state.proposal) return { intent: "accept" };
    if (REJECT.has(text)) return { intent: "reject" };
  }
  if (state.running && STOP.has(text)) return { intent: "stop" };
  return undefined;
}
