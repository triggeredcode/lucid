import type { Block } from "@lucid/core";
import { doc, h1, h2, p } from "@lucid/core/testing";
import { registry } from "@lucid/kit";
import { describe, expect, it } from "vitest";
import { buildCommandMessages } from "./command";
import { buildInputMessages } from "./input";

const last = (messages: ReturnType<typeof buildCommandMessages>["messages"]): string =>
  messages.at(-1)?.content ?? "";

const table = (id: string): Block => {
  const found = registry.get("table").fixtures.find((fixture) => fixture.id === "fx-table-1");
  if (!found) throw new Error("missing table fixture");
  return { ...found, id };
};

describe("prompt context selection", () => {
  it("targets the cursor section in live Command and Input requests", () => {
    const source = doc(
      h1("Design", { id: "title" }),
      h2("Requirements", { id: "requirements" }),
      p("This requirement body must stay out of caching context.", { id: "requirement-body" }),
      h2("Caching", { id: "caching" }),
      p("Redis stores hot keys.", { id: "redis" }),
      p("A cache miss reads from the database.", { id: "miss" }),
    );
    const command = last(
      buildCommandMessages({
        doc: source,
        utterance: "Make this sentence shorter",
        cursorBlockId: "redis",
      }).messages,
    );
    const input = last(
      buildInputMessages({
        doc: source,
        utterance: "Redis entries expire after thirty days",
        cursorBlockId: "redis",
      }).messages,
    );

    for (const prompt of [command, input]) {
      expect(prompt).toContain("CONTEXT: targeted");
      expect(prompt).toContain("Redis stores hot keys");
      expect(prompt).not.toContain("requirement body must stay out");
    }
  });

  it("tells Command to clarify ambiguous components and missing refs", () => {
    const source = doc(h1("Tables", { id: "heading" }), table("one"), table("two"));
    const ambiguous = last(
      buildCommandMessages({ doc: source, utterance: "Add a row to the table" }).messages,
    );
    const missing = last(buildCommandMessages({ doc: source, utterance: "Remove b80" }).messages);

    expect(ambiguous).toContain("TARGET_STATUS: ambiguous table");
    expect(ambiguous).toContain("Ask which one; do not guess.");
    expect(missing).toContain("TARGET_STATUS: missing b80");
    expect(missing).toContain("do not guess");
  });

  it("expands explicit whole-document requests", () => {
    const source = doc(
      h1("Design", { id: "heading" }),
      p("First body", { id: "first" }),
      p("Second body", { id: "second" }),
    );
    const prompt = last(
      buildCommandMessages({ doc: source, utterance: "Review the entire document" }).messages,
    );
    expect(prompt).toContain("CONTEXT: whole document");
    expect(prompt).toContain("First body");
    expect(prompt).toContain("Second body");
  });
});
