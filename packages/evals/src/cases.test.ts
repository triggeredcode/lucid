import { FORMATS, getFormat, registry } from "@lucid/kit";
import { describe, expect, it } from "vitest";
import { ALL_CASES, validateCases } from "./cases";
import { fixture } from "./fixtures";
import { findBlock } from "./matchers";
import { CATEGORIES, type Case } from "./types";

describe("the case list", () => {
  it("is valid: unique ids, known categories and pages, possible expectations", () => {
    expect(validateCases(ALL_CASES)).toEqual([]);
  });

  it("points the cursor and the untouched-blocks check at blocks that exist on the starting page", () => {
    const missing: string[] = [];
    for (const c of ALL_CASES) {
      const doc = fixture(c.doc);
      if (c.focus && !findBlock(doc, c.focus)) missing.push(`${c.id}: focus`);
      for (const s of c.expect.touchedOnly ?? [])
        if (!findBlock(doc, s)) missing.push(`${c.id}: touchedOnly`);
    }
    expect(missing).toEqual([]);
  });

  it("covers the spec's acceptance workflows A, B, C, D, E, F and G", () => {
    const covered = (id: string) => ALL_CASES.some((c: Case) => c.id === id);
    for (const id of [
      "struct-load-balancer", // A
      "diagram-request-flow", // B
      "diag-add-redis", // C
      "table-sql-nosql", // D
      "keep-alternatives", // E
      "table-add-row-this", // F
      "mode-content-that-sounds-like-a-command", // G
    ])
      expect(covered(id), id).toBe(true);
  });

  it("covers every note format with a pick case, and every format page case names a real format", () => {
    const picked = new Set(
      ALL_CASES.filter((c) => c.mode === "advisor").map((c) => c.expect.formatId),
    );
    expect([...picked].sort()).toEqual(FORMATS.map((f) => f.id).sort());
    expect(ALL_CASES.filter((c) => c.category === "format_pick").length).toBeGreaterThanOrEqual(10);
    for (const c of ALL_CASES.filter((x) => x.format))
      expect(getFormat(c.format), c.id).toBeDefined();
  });

  it("has cases in the categories the bars are strictest about", () => {
    for (const category of ["non_destructive", "mode_separation"] as const)
      expect(ALL_CASES.filter((c) => c.category === category).length).toBeGreaterThanOrEqual(2);
    expect(new Set(ALL_CASES.map((c) => c.category)).size).toBeGreaterThanOrEqual(12);
    expect(CATEGORIES.length).toBeGreaterThan(0);
  });

  it("starts every case from a page the block kit accepts", () => {
    for (const c of ALL_CASES)
      expect(() => registry.validateDoc(fixture(c.doc)), c.id).not.toThrow();
  });
});
