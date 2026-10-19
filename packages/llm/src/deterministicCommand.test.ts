import { buildRefMap } from "@lucid/core";
import { doc, h1, h2, p } from "@lucid/core/testing";
import { describe, expect, it } from "vitest";
import { deterministicCommand } from "./deterministicCommand";

const page = doc(
  h1("Notes", { id: "title" }),
  h2("Caching", { id: "caching" }),
  p("Redis stores hot keys.", { id: "redis" }),
);

describe("deterministicCommand", () => {
  it("maps exact selected-block commands to stable document refs", () => {
    expect(deterministicCommand(page, "delete this block", "redis")?.ops).toEqual([
      { op: "delete", target: "b3" },
    ]);
    expect(deterministicCommand(page, "Move this block up.", "redis")?.ops).toEqual([
      { op: "move", target: "b3", to: { before: "b2" } },
    ]);
    expect(deterministicCommand(page, "move this block down", "caching")?.ops).toEqual([
      { op: "move", target: "b2", to: { after: "b3" } },
    ]);
  });

  it("creates only an explicitly quoted, safe empty section", () => {
    expect(deterministicCommand(page, 'create an empty section named "Failure modes"')).toEqual({
      ops: [{ op: "insert", at: { end: true }, lmd: "## Failure modes" }],
      summary: "Created empty section “Failure modes”",
    });
  });

  it.each([
    ["delete this block please", "redis"],
    ["delete the block", "redis"],
    ["move this block up", "title"],
    ["move this block down", "redis"],
    ["move this block up", "nested-or-missing"],
    ["create an empty section named Failure modes", undefined],
    ['create an empty section named "# injected"', undefined],
  ])("leaves a near miss for the model: %s", (utterance, cursor) => {
    expect(deterministicCommand(page, utterance, cursor)).toBeUndefined();
  });

  it("keeps references stable after routing", () => {
    expect(buildRefMap(page).refOf("redis")).toBe("b3");
  });
});
