import { describe, expect, it } from "vitest";
import { OpSchema, commandJsonSchema, parseCommandResponse, type Op } from "./schema";

const wire = (over: Record<string, unknown>) =>
  JSON.stringify({
    kind: "edit",
    summary: "x",
    ops: null,
    question: null,
    options: null,
    reason: null,
    ...over,
  });

describe("parseCommandResponse", () => {
  it("reads an edit with ops", () => {
    const text = wire({
      summary: "Crossed out MongoDB",
      ops: [{ op: "set_status", target: "b9.2", in: null, status: "struck" }],
    });
    expect(parseCommandResponse(text)).toEqual({
      ok: true,
      value: {
        kind: "edit",
        summary: "Crossed out MongoDB",
        ops: [{ op: "set_status", target: "b9.2", in: null, status: "struck" }],
      },
    });
  });

  it("reads a clarify and a none", () => {
    const clarify = wire({
      kind: "clarify",
      summary: null,
      question: "Which one?",
      options: [
        { label: "Web Server to Redis", ref: "e5" },
        { label: "Web Server to Client", ref: null },
      ],
    });
    expect(parseCommandResponse(clarify)).toMatchObject({
      ok: true,
      value: { kind: "clarify", question: "Which one?" },
    });
    expect(parseCommandResponse(wire({ kind: "none", summary: null, reason: "content" }))).toEqual({
      ok: true,
      value: { kind: "none", reason: "content" },
    });
  });

  it("treats a question with options under kind none as a clarify (seen with the real model)", () => {
    const text = wire({
      kind: "none",
      summary: null,
      question: "Which do you want?",
      options: [
        { label: "Delete it", ref: "b4" },
        { label: "Tidy it", ref: "b4" },
      ],
    });
    expect(parseCommandResponse(text)).toMatchObject({
      ok: true,
      value: { kind: "clarify", question: "Which do you want?" },
    });
  });

  it("explains what is wrong, in a few short lines", () => {
    expect(parseCommandResponse("{not json")).toEqual({
      ok: false,
      errors: ["The answer is not valid JSON."],
    });
    const bad = parseCommandResponse(wire({ ops: [{ op: "explode", target: "b1" }] }));
    expect(bad.ok).toBe(false);
    const missing = parseCommandResponse(wire({ ops: [] }));
    expect(missing).toEqual({ ok: false, errors: ['kind "edit" needs at least one op.'] });
    expect(
      parseCommandResponse(
        wire({
          kind: "clarify",
          summary: null,
          question: "Q",
          options: [{ label: "a", ref: null }],
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(parseCommandResponse(JSON.stringify({ kind: "edit" }))).toMatchObject({ ok: false });
  });

  it("limits the number of ops and the length of the summary", () => {
    const many = Array.from({ length: 21 }, () => ({ op: "delete", target: "b1" }));
    expect(parseCommandResponse(wire({ ops: many })).ok).toBe(false);
    expect(
      parseCommandResponse(
        wire({ ops: [{ op: "delete", target: "b1" }], summary: "x".repeat(121) }),
      ).ok,
    ).toBe(false);
  });
});

describe("OpSchema", () => {
  const ok: Op[] = [
    { op: "insert", at: { after: "b3" }, lmd: "- x" },
    { op: "insert", at: { end: true }, lmd: "x" },
    { op: "move", target: "b5", to: { before: "b2" } },
    { op: "mark", target: "b4", match: "Redis", mark: "strike", on: true },
    {
      op: "graph.insert_between",
      target: "b5",
      from: "client",
      to: "web",
      node: "cdn [cdn]: CDN",
      labels: null,
    },
    {
      op: "table.add_row",
      target: "b6",
      after: "r3",
      cells: ["Consistency", "Strong", "Eventual"],
    },
    { op: "table.set_cells", target: "b6", row: "r1", cells: [{ col: "c2", text: "Fixed" }] },
  ];
  it.each(ok)("accepts %j", (op) => {
    expect(OpSchema.safeParse(op).success).toBe(true);
  });

  it("rejects unknown fields and wrong types", () => {
    expect(OpSchema.safeParse({ op: "delete", target: "b1", force: true }).success).toBe(false);
    expect(
      OpSchema.safeParse({ op: "set_status", target: "b1", in: null, status: "gone" }).success,
    ).toBe(false);
    expect(
      OpSchema.safeParse({ op: "insert", at: { after: "b1", end: true }, lmd: "x" }).success,
    ).toBe(false);
    expect(
      OpSchema.safeParse({ op: "mark", target: "b1", match: null, mark: "glow", on: true }).success,
    ).toBe(false);
  });
});

describe("commandJsonSchema", () => {
  const schema = commandJsonSchema() as Record<string, unknown>;
  const text = JSON.stringify(schema);

  it("is one flat object that requires every field, with no extras allowed", () => {
    expect(schema["type"]).toBe("object");
    expect(schema["additionalProperties"]).toBe(false);
    expect(schema["required"]).toEqual(["kind", "summary", "ops", "question", "options", "reason"]);
    expect(schema).not.toHaveProperty("$schema");
  });

  it("forbids extra fields everywhere", () => {
    const objects = text.match(/"type":"object"/g)?.length ?? 0;
    const closed = text.match(/"additionalProperties":false/g)?.length ?? 0;
    expect(objects).toBeGreaterThan(20);
    expect(closed).toBe(objects);
  });

  it("can leave out the kind 'clarify', for when the person has just answered the question", () => {
    const kind = (s: object) =>
      (s as { properties: { kind: { enum: string[] } } }).properties.kind.enum;
    expect(kind(commandJsonSchema())).toEqual(["edit", "clarify", "none"]);
    expect(kind(commandJsonSchema({ allowClarify: true }))).toEqual(["edit", "clarify", "none"]);
    expect(kind(commandJsonSchema({ allowClarify: false }))).toEqual(["edit", "none"]);
    // The schema everyone else gets is not changed by asking for the other one.
    expect(kind(commandJsonSchema())).toContain("clarify");
  });

  it("stays small enough to be sent with every request", () => {
    expect(text.length).toBeLessThan(14000);
  });
});
