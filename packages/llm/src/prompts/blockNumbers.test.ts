import { describe, expect, it } from "vitest";
import { COMMAND_DOC, buildCommandMessages, commandSystemPrompt } from "./command";

const lastMessage = (utterance: string): string =>
  buildCommandMessages({ doc: COMMAND_DOC, utterance }).messages.at(-1)?.content ?? "";

describe("block numbers in a Command request", () => {
  it("says which reference a number is, after the hints and before what was said", () => {
    const text = lastMessage("In block 6, cross out the second item");
    expect(text).toContain("BLOCK NUMBERS");
    expect(text).toMatch(/"block 6" → \[b6\] list/);
    expect(text.indexOf("HINTS:")).toBeLessThan(text.indexOf("BLOCK NUMBERS"));
    expect(text.indexOf("BLOCK NUMBERS")).toBeLessThan(text.indexOf("UTTERANCE:"));
  });

  it("says nothing about blocks when the person named none", () => {
    expect(lastMessage("Cross out MongoDB")).not.toContain("BLOCK NUMBERS");
  });

  it("says when there is no such block, so the model asks", () => {
    expect(lastMessage("In block 40, add a note")).toMatch(
      /there is no block 40: the page has \d+ blocks/,
    );
  });

  it("does not change the part of the prompt the model server keeps", () => {
    const system = commandSystemPrompt();
    expect(system).not.toContain("BLOCK NUMBERS");
    expect(
      buildCommandMessages({ doc: COMMAND_DOC, utterance: "In block 6, x" }).messages[0]?.content,
    ).toBe(
      buildCommandMessages({ doc: COMMAND_DOC, utterance: "Cross out MongoDB" }).messages[0]
        ?.content,
    );
  });
});
