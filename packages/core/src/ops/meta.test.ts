import { describe, expect, it } from "vitest";
import { parseMeta, type MetaState } from "./meta";

const idle: MetaState = { proposal: false, clarify: false, running: false };

describe("parseMeta", () => {
  it.each([
    ["Command mode.", { intent: "mode", mode: "command" }],
    ["switch to command mode", { intent: "mode", mode: "command" }],
    ["Lucid, command mode", { intent: "mode", mode: "command" }],
    ["back to notes", { intent: "mode", mode: "input" }],
    ["Input mode!", { intent: "mode", mode: "input" }],
    ["Edit mode", { intent: "mode", mode: "edit" }],
    ["Enter diagramming mode.", { intent: "build", what: "diagram", existing: false }],
    ["diagram mode", { intent: "build", what: "diagram", existing: false }],
    ["Lucid, new diagram", { intent: "build", what: "diagram", existing: false }],
    ["table mode", { intent: "build", what: "table", existing: false }],
    ["edit this diagram", { intent: "build", what: "diagram", existing: true }],
    ["edit the table", { intent: "build", what: "table", existing: true }],
    ["let me edit", { intent: "mode", mode: "edit" }],
    ["manual mode.", { intent: "mode", mode: "edit" }],
    ["Undo", { intent: "undo" }],
    ["undo that.", { intent: "undo" }],
    ["scratch that", { intent: "undo" }],
    ["hey lucid undo the last change", { intent: "undo" }],
    ["redo", { intent: "redo" }],
    ["export to PDF", { intent: "export_pdf" }],
    ["export as Markdown", { intent: "export_markdown" }],
    ["Save as markdown.", { intent: "export_markdown" }],
  ])("%s", (text, expected) => {
    expect(parseMeta(text, idle)).toEqual(expected);
  });

  it("is never triggered by a longer sentence that contains these words", () => {
    for (const text of [
      "we should undo the last migration before deploying",
      "command mode is how the editor takes instructions",
      "yes and the cache also needs warming up",
      "undo that and then redo the whole table",
      "",
      "  ",
    ]) {
      expect(parseMeta(text, { proposal: true, clarify: true, running: true })).toBeUndefined();
    }
  });

  it("answers a proposal only while one is open", () => {
    expect(parseMeta("yes", idle)).toBeUndefined();
    expect(parseMeta("yes", { ...idle, proposal: true })).toEqual({ intent: "accept" });
    expect(parseMeta("looks good", { ...idle, proposal: true })).toEqual({ intent: "accept" });
    expect(parseMeta("never mind", { ...idle, proposal: true })).toEqual({ intent: "reject" });
    expect(parseMeta("no", idle)).toBeUndefined();
  });

  it("picks an option only while a question is open", () => {
    expect(parseMeta("the second one", idle)).toBeUndefined();
    expect(parseMeta("the second one", { ...idle, clarify: true })).toEqual({
      intent: "choose",
      n: 2,
    });
    expect(parseMeta("option four", { ...idle, clarify: true })).toEqual({
      intent: "choose",
      n: 4,
    });
    expect(parseMeta("cancel", { ...idle, clarify: true })).toEqual({ intent: "reject" });
    expect(parseMeta("yes", { ...idle, clarify: true })).toBeUndefined();
  });

  it("stops a job only while one runs", () => {
    expect(parseMeta("stop", idle)).toBeUndefined();
    expect(parseMeta("stop", { ...idle, running: true })).toEqual({ intent: "stop" });
    expect(parseMeta("cancel that", { ...idle, running: true })).toEqual({ intent: "stop" });
  });
});
