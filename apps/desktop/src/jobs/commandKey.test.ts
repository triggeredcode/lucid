import { describe, expect, it } from "vitest";
import { isCommandKey } from "./commandKey";

const key = (code: string, opts: { ctrl?: boolean; altGraph?: boolean } = {}) => ({
  code,
  ctrlKey: opts.ctrl ?? false,
  getModifierState: (name: string) => name === "AltGraph" && (opts.altGraph ?? false),
});

describe("isCommandKey", () => {
  it("is the right Alt / Option key", () => {
    expect(isCommandKey(key("AltRight"))).toBe(true);
  });

  it("is not the left Alt key, or any other key", () => {
    expect(isCommandKey(key("AltLeft"))).toBe(false);
    expect(isCommandKey(key("KeyA"))).toBe(false);
  });

  it("is not AltGr, which types characters on many keyboards (Windows says Ctrl and Alt, other systems say AltGraph)", () => {
    expect(isCommandKey(key("AltRight", { ctrl: true }))).toBe(false);
    expect(isCommandKey(key("AltRight", { altGraph: true }))).toBe(false);
  });
});
