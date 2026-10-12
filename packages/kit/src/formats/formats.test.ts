import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_ID, FORMATS, FormatSchema, getFormat, pickFormat, skeleton } from "./index";

describe("the three formats", () => {
  it("are the three formats, each valid, with unique ids and section keys", () => {
    expect(FORMATS.map((f) => f.id)).toEqual(["concept-note", "system-design", "comparison"]);
    for (const f of FORMATS) {
      expect(() => FormatSchema.parse(f), f.id).not.toThrow();
      expect(new Set(f.sections.map((s) => s.key)).size, f.id).toBe(f.sections.length);
      expect(f.description.length, f.id).toBeLessThanOrEqual(200);
    }
    expect(new Set(FORMATS.map((f) => f.name)).size).toBe(3);
  });

  it("have their sections, in order", () => {
    expect(getFormat("comparison")?.sections.map((s) => s.heading)).toEqual([
      "Context",
      "Options",
      "Comparison",
      "Pros and cons",
      "Decision",
    ]);
    expect(getFormat("concept-note")?.sections.map((s) => s.key)).toEqual([
      "definition",
      "intuition",
      "how-it-works",
      "example",
      "pitfalls",
      "related",
    ]);
    expect(getFormat("system-design")?.sections).toHaveLength(8);
  });

  it("keep formulas plain: no built-in format numbers them (a format of one's own may)", () => {
    expect(FORMATS.filter((f) => f.latex.equationNumbers)).toEqual([]);
  });

  it("do not know the two specialized formats that earlier versions had; a page that has one is a plain page", () => {
    expect(getFormat("inference-math")).toBeUndefined();
    expect(getFormat("benchmark")).toBeUndefined();
  });

  it("start a page with one empty heading per section", () => {
    let n = 0;
    const format = getFormat("comparison");
    if (!format) throw new Error("no comparison format");
    const blocks = skeleton(format, () => `s${String(++n)}`);
    expect(blocks.map((b) => b.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(blocks.every((b) => b.type === "heading" && b.props["level"] === 2)).toBe(true);
  });

  it("reject a broken format", () => {
    const good = FORMATS[0];
    expect(() => FormatSchema.parse({ ...good, id: "Bad Id" })).toThrow();
    expect(() => FormatSchema.parse({ ...good, description: "x".repeat(201) })).toThrow();
    expect(() =>
      FormatSchema.parse({ ...good, latex: { equationNumbers: false, diagramWidth: 2 } }),
    ).toThrow();
    expect(() => FormatSchema.parse({ ...good, sections: [] })).toThrow();
  });
});

describe("pickFormat (the fallback when the model cannot choose)", () => {
  const picks: [string, string][] = [
    ["SQL vs NoSQL", "comparison"],
    ["design a URL shortener", "system-design"],
    ["consistent hashing", "concept-note"],
    ["how does raft elect a leader", "concept-note"],
    ["choose between Kafka and SQS", "comparison"],
    ["the difference between a mutex and a semaphore", "comparison"],
  ];
  for (const [text, id] of picks) {
    it(`"${text}" is ${id}`, () => {
      expect(pickFormat(text).format.id).toBe(id);
    });
  }

  it("takes the default when nothing matches, and says the score was zero", () => {
    expect(pickFormat("my grocery list")).toMatchObject({ score: 0 });
    expect(pickFormat("my grocery list").format.id).toBe(DEFAULT_FORMAT_ID);
    expect(pickFormat("").score).toBe(0);
  });

  it("does not let a short keyword match inside a longer word", () => {
    expect(pickFormat("vscode and vsphere").score).toBe(0);
  });
});
