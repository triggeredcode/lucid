import { bullets, doc, h1, numbered, p } from "@lucid/core/testing";
import { describe, expect, it } from "vitest";
import { describeBlocks } from "./describe";

describe("describeBlocks", () => {
  it("names what was added in plain words", () => {
    expect(describeBlocks(doc(h1("T"), p("x"), bullets("a", "b", "c")).blocks)).toBe(
      "a heading, a paragraph and 3 bullets",
    );
    expect(describeBlocks(doc(numbered("a", "b")).blocks)).toBe("2 numbered steps");
    expect(describeBlocks(doc(p("x")).blocks)).toBe("a paragraph");
    expect(describeBlocks([])).toBe("nothing");
  });
});

describe("humanizeRefs", () => {
  it("replaces references by what they point at", async () => {
    const { COMMAND_DOC } = await import("@lucid/llm");
    const { humanizeRefs } = await import("./describe");
    expect(humanizeRefs("delete b4", COMMAND_DOC)).toBe("delete the table “SQL vs NoSQL”");
    expect(humanizeRefs("delete b6 and rewrite b6.2", COMMAND_DOC)).toBe(
      "delete the list “PostgreSQL” and rewrite the bullet “MongoDB”",
    );
    expect(humanizeRefs("remove b3, b99 and r2", COMMAND_DOC)).toBe(
      "remove the diagram “Request flow”, b99 and r2",
    );
  });
});
