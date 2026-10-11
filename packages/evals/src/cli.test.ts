import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockLmStudio, type MockLmStudio } from "@lucid/mock-lmstudio";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateCases } from "./cases";
import { main, select } from "./cli";
import type { Case } from "./types";

let mock: MockLmStudio | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
  vi.restoreAllMocks();
});

const c = (id: string, over: Partial<Case> = {}): Case => ({
  id,
  category: "input_structure",
  mode: "input",
  doc: "empty",
  utterance: `say ${id}`,
  expect: { doc: { hasHeading: [{ text: "load balancer" }] } },
  ...over,
});

describe("select", () => {
  const cases = [c("a"), c("b", { category: "diagram_edit", mode: "command" }), c("c")];
  it("filters by category, id and mode", () => {
    expect(select(cases, ["--category", "diagram_edit"]).map((x) => x.id)).toEqual(["b"]);
    expect(select(cases, ["--id", "a,c"]).map((x) => x.id)).toEqual(["a", "c"]);
    expect(select(cases, ["--mode", "command"]).map((x) => x.id)).toEqual(["b"]);
    expect(select(cases, [])).toHaveLength(3);
  });
});

describe("validateCases", () => {
  it("finds duplicate ids, unknown fixtures, impossible expectations and a variant that repeats the words", () => {
    const bad = [
      c("a"),
      c("a"),
      c("b", { doc: "nope" as never }),
      c("c", { expect: { outcome: "edit" } }),
      c("d", { mode: "command", expect: { outcome: "applied" } }),
      c("e", { variants: ["say e"] }),
    ];
    expect(validateCases(bad)).toEqual([
      "duplicate case id a",
      "b: unknown fixture nope",
      "c: an input case cannot expect edit",
      "d: a command case cannot expect applied",
      "e: a variant repeats the utterance",
    ]);
    expect(validateCases([c("ok", { variants: ["other words"] })])).toEqual([]);
  });
});

describe("main", () => {
  const notes = { kind: "reply" as const, content: "## Load Balancer\n- one", chunkChars: 400 };

  it("runs the chosen cases against the model and writes results.json and report.md", async () => {
    mock = await startMockLmStudio({ script: [notes, notes, notes] });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const out = mkdtempSync(join(tmpdir(), "lucid-eval-"));
    const cases = [
      c("a", { variants: ["variant of a"] }),
      c("b", { expect: { doc: { hasHeading: [{ text: "kafka" }] } } }),
    ];
    const code = await main(["--url", mock.url, "--out", out, "--label", "t"], { cases });
    expect(code).toBe(0);
    const results = JSON.parse(readFileSync(join(out, "results.json"), "utf8")) as {
      meta: { label: string };
      trials: { caseId: string; pass: boolean }[];
    };
    expect(results.meta.label).toBe("t");
    expect(results.trials.map((t) => [t.caseId, t.pass])).toEqual([
      ["a", true],
      ["a", true],
      ["b", false],
    ]);
    expect(readFileSync(join(out, "report.md"), "utf8")).toContain("### b · input_structure");
    // (The Input pipeline may ask again to repair an answer, so the request count is not fixed.)
    expect(mock.requests.length).toBeGreaterThanOrEqual(3);
  });

  it("exits 1 under --strict when a bar is missed, and 0 without it", async () => {
    mock = await startMockLmStudio({ script: [notes, notes] });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cases = [c("b", { expect: { doc: { hasHeading: [{ text: "kafka" }] } } })];
    const out = mkdtempSync(join(tmpdir(), "lucid-eval-"));
    expect(await main(["--url", mock.url, "--out", out, "--strict"], { cases })).toBe(1);
    expect(await main(["--url", mock.url, "--out", out], { cases })).toBe(0);
  });

  it("says what is wrong when the model is not loaded, and runs nothing", async () => {
    mock = await startMockLmStudio({ models: [] });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await main(["--url", mock.url], { cases: [c("a")] })).toBe(2);
    expect(String(err.mock.calls[0]?.[0])).toContain("is not loaded in LM Studio");
    expect(mock.requests).toHaveLength(0);
  });

  it("compares two reports", async () => {
    mock = await startMockLmStudio({ script: [notes, notes] });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const a = mkdtempSync(join(tmpdir(), "lucid-eval-"));
    const b = mkdtempSync(join(tmpdir(), "lucid-eval-"));
    await main(["--url", mock.url, "--out", a, "--label", "before"], { cases: [c("x")] });
    await main(["--url", mock.url, "--out", b, "--label", "after"], {
      cases: [c("x", { expect: { doc: { hasHeading: [{ text: "kafka" }] } } })],
    });
    log.mockClear();
    expect(await main(["--compare", a, b])).toBe(0);
    const printed = String(log.mock.calls[0]?.[0]);
    expect(printed).toContain("before → after");
    expect(printed).toContain("Regressions (1): x#0");
  });
});
