import { describe, expect, it } from "vitest";
import { ANSWERED_NOTE, COMMAND_DOC, buildCommandMessages, endsWithAnswer } from "./command";

const lastMessage = (utterance: string, extra?: string): string =>
  buildCommandMessages({ doc: COMMAND_DOC, utterance, extra }).messages.at(-1)?.content ?? "";

describe("the person's answer to a question the model asked", () => {
  it("is recognised only at the end of what was said", () => {
    expect(endsWithAnswer("Add a row (I mean: Add a new row for consistency guarantees)")).toBe(
      true,
    );
    expect(endsWithAnswer("Remove it (I mean: Web Server to Client, e5)\n")).toBe(true);
    // The label may hold brackets of its own.
    expect(endsWithAnswer("Fill it (I mean: Fill in the existing row (r4))")).toBe(true);
    expect(endsWithAnswer("Add a row")).toBe(false);
    expect(endsWithAnswer("I mean: add a row")).toBe(false);
    expect(endsWithAnswer("Add a row (I mean: this one) and then rename it")).toBe(false);
  });

  it("is explained to the model once, in the request, before what was said", () => {
    const text = lastMessage("Add a row (I mean: Add a new row)");
    expect(text).toContain(ANSWERED_NOTE);
    expect(text.indexOf(ANSWERED_NOTE)).toBeLessThan(text.indexOf("UTTERANCE:"));
    expect(text.endsWith("UTTERANCE:\nAdd a row (I mean: Add a new row)")).toBe(true);
  });

  it("is not mentioned for an ordinary request, and sits after a caller's own lines", () => {
    expect(lastMessage("Add a row")).not.toContain(ANSWERED_NOTE);
    const both = lastMessage("Add a row (I mean: x)", "Numbers: 1 = Client");
    expect(both.indexOf("Numbers: 1 = Client")).toBeLessThan(both.indexOf(ANSWERED_NOTE));
  });
});
