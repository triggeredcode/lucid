import { describe, expect, it } from "vitest";
import { parseBlockNumbers } from "./blockNumbers";

describe("the block numbers setting", () => {
  it("is on unless it was turned off", () => {
    expect(parseBlockNumbers(null)).toBe(true);
    expect(parseBlockNumbers("on")).toBe(true);
    expect(parseBlockNumbers("rubbish")).toBe(true);
    expect(parseBlockNumbers("off")).toBe(false);
  });
});
