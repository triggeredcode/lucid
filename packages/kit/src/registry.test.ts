import { BLOCK_TYPES, type Block } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BlockValidationError, createRegistry } from "./registry";
import type { BlockSpec } from "./spec";

const fake = (
  type: BlockSpec["type"],
  kind: BlockSpec["kind"],
  over: Partial<BlockSpec> = {},
): BlockSpec => ({
  type,
  kind,
  propsSchema: z.looseObject({ status: z.enum(["normal", "struck"]).default("normal") }),
  describe: "fake",
  fixtures: [],
  outline: () => type,
  toMarkdown: () => type,
  ...over,
});
const block = (over: Partial<Block> = {}): Block => ({
  id: "b1",
  type: "paragraph",
  props: {},
  ...over,
});

describe("createRegistry", () => {
  const reg = createRegistry([
    fake("paragraph", "text"),
    fake("callout", "container"),
    fake("math", "atom"),
  ]);

  it("looks specs up and reports missing types", () => {
    expect(reg.get("paragraph").type).toBe("paragraph");
    expect(() => reg.get("table")).toThrow(/no block spec/);
    expect(reg.missing()).toEqual(
      BLOCK_TYPES.filter((t) => !["paragraph", "callout", "math"].includes(t)),
    );
  });

  it("refuses to register a type twice", () => {
    expect(() => createRegistry([fake("paragraph", "text"), fake("paragraph", "text")])).toThrow(
      /twice/,
    );
  });

  it("fills prop defaults without touching the input", () => {
    const input = block();
    const out = reg.validateBlock(input);
    expect(out.props).toEqual({ status: "normal" });
    expect(input.props).toEqual({});
  });

  it("reports schema problems with the property path", () => {
    expect(() => reg.validateBlock(block({ props: { status: "chosen" } }))).toThrow(
      BlockValidationError,
    );
    try {
      reg.validateBlock(block({ props: { status: "chosen" } }));
    } catch (error) {
      expect((error as BlockValidationError).issues[0]?.message).toContain("props.status");
    }
  });

  it("enforces kind rules: only text blocks have content, atoms have no children", () => {
    const text = { type: "text" as const, text: "x", styles: {} };
    expect(reg.validateBlock(block({ content: [text] })).content).toEqual([text]);
    expect(() => reg.validateBlock(block({ id: "c", type: "callout", content: [text] }))).toThrow(
      /inline content/,
    );
    expect(() =>
      reg.validateBlock(block({ id: "m", type: "math", children: [block({ id: "k" })] })),
    ).toThrow(/children/);
    expect(
      reg.validateBlock(block({ id: "c", type: "callout", children: [block({ id: "k" })] }))
        .children,
    ).toHaveLength(1);
  });

  it("validates children recursively and collects every issue", () => {
    const bad = block({
      id: "c",
      type: "callout",
      children: [block({ id: "k1", props: { status: "x" } }), block({ id: "k2", type: "table" })],
    });
    try {
      reg.validateBlock(bad);
      expect.unreachable();
    } catch (error) {
      expect((error as BlockValidationError).issues.map((i) => i.blockId)).toEqual(["k1", "k2"]);
    }
  });

  it("runs the spec's semantic check", () => {
    const checked = createRegistry([
      fake("paragraph", "text", { check: () => ["something is off"] }),
    ]);
    expect(() => checked.validateBlock(block())).toThrow(/something is off/);
  });

  it("validateDoc rejects duplicate ids", () => {
    expect(
      reg.validateDoc({ blocks: [block({ id: "a" }), block({ id: "b" })] }).blocks,
    ).toHaveLength(2);
    expect(() => reg.validateDoc({ blocks: [block({ id: "a" }), block({ id: "a" })] })).toThrow(
      /duplicate/,
    );
  });
});
