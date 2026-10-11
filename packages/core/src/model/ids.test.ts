import { describe, expect, it } from "vitest";
import { createSequentialIds, newId, nextNumberedId } from "./ids";

describe("newId", () => {
  it("returns unique UUID v4 strings", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});

describe("createSequentialIds", () => {
  it("counts up from 1 with the prefix", () => {
    const next = createSequentialIds("b");
    expect([next(), next(), next()]).toEqual(["b1", "b2", "b3"]);
  });

  it("generators are independent", () => {
    const a = createSequentialIds("x");
    const b = createSequentialIds("x");
    a();
    expect(b()).toBe("x1");
  });
});

describe("nextNumberedId", () => {
  it("starts at 1 when nothing matches", () => {
    expect(nextNumberedId("e", [])).toBe("e1");
    expect(nextNumberedId("e", ["r1", "c2", "web"])).toBe("e1");
  });

  it("uses max + 1, not the count, so deleted ids are never reused", () => {
    expect(nextNumberedId("e", ["e1", "e2", "e5"])).toBe("e6");
  });

  it("compares numerically, not as strings", () => {
    expect(nextNumberedId("e", ["e9", "e10"])).toBe("e11");
  });

  it("ignores ids that merely start with the prefix", () => {
    expect(nextNumberedId("e", ["e3", "edge7", "e4x", "e"])).toBe("e4");
  });
});
