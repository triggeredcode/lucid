import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_ID, FORMATS, FormatSchema, getFormat, pickFormat, skeleton } from "./index";

describe("the five formats", () => {
  it("are the five formats, each valid, with unique ids and section keys", () => {
    expect(FORMATS.map((f) => f.id)).toEqual([
      "concept-note",
      "system-design",
      "comparison",
      "inference-math",
      "benchmark",
    ]);
    for (const f of FORMATS) {
      expect(() => FormatSchema.parse(f), f.id).not.toThrow();
      expect(new Set(f.sections.map((s) => s.key)).size, f.id).toBe(f.sections.length);
      expect(f.description.length, f.id).toBeLessThanOrEqual(200);
    }
    expect(new Set(FORMATS.map((f) => f.name)).size).toBe(5);
  });

  it("have their sections, in order", () => {
    expect(getFormat("comparison")?.sections.map((s) => s.heading)).toEqual([
      "Context",
      "Options",
      "Comparison",
      "Pros and cons",
      "Decision",
    ]);
    expect(getFormat("benchmark")?.sections.map((s) => s.key)).toEqual([
      "goal",
      "setup",
      "method",
      "results",
      "observations",
      "next",
    ]);
    expect(getFormat("system-design")?.sections).toHaveLength(8);
  });

  it("number formulas only in the inference format and keep the rest plain", () => {
    expect(FORMATS.filter((f) => f.latex.equationNumbers).map((f) => f.id)).toEqual([
      "inference-math",
    ]);
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
    ["notes on how paged attention saves KV memory", "inference-math"],
    ["benchmarking qwen vs gemma tok/s on my mac", "benchmark"],
    ["SQL vs NoSQL", "comparison"],
    ["design a URL shortener", "system-design"],
    ["consistent hashing", "concept-note"],
    ["how does raft elect a leader", "concept-note"],
    ["speculative decoding and batching math", "inference-math"],
    ["choose between Kafka and SQS", "comparison"],
    ["measured p99 latency under load", "benchmark"],
    ["KV cache sizing and memory bandwidth", "inference-math"],
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
