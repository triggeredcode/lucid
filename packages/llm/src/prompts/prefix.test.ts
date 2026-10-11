import { describe, expect, it } from "vitest";
import { COMMAND_DOC, buildCommandMessages } from "./command";
import { CHECKPOINT, STATIC_PREFIX } from "./prefix";

const staticPart = (doc: Parameters<typeof buildCommandMessages>[0]["doc"], say: string) =>
  buildCommandMessages({ doc, utterance: say }).messages.slice(0, -1);

describe("the static part of the Command prompt", () => {
  it("does not depend on the page or the words, so the server can reuse its work on it", () => {
    expect(staticPart({ blocks: [] }, "x")).toEqual(staticPart(COMMAND_DOC, "Add a CDN."));
  });

  it("is the text that was measured against the real model", () => {
    const chars = staticPart({ blocks: [] }, "x").reduce((n, m) => n + m.content.length, 0);
    // If this fails the prompt changed: measure again (see prefix.ts) and update STATIC_PREFIX.
    expect(chars).toBe(STATIC_PREFIX.command.chars);
  });

  it("ends just after a checkpoint of the model server's prompt cache", () => {
    const { tokens } = STATIC_PREFIX.command;
    expect(tokens).toBeGreaterThan(CHECKPOINT);
    // Close above a multiple of 2048: at most ~256 static tokens are computed again on every request.
    expect(tokens % CHECKPOINT).toBeLessThanOrEqual(256);
  });
});
