import { describe, expect, it } from "vitest";
import { destructiveOps, hasRemovalVerb, needsConfirmation } from "./classify";
import type { Op } from "./schema";

const text = (map: Record<string, string>) => ({ textOf: (ref: string) => map[ref] });

describe("hasRemovalVerb", () => {
  it.each([
    "delete the second row",
    "remove Redis",
    "get rid of that table",
    "drop the CDN",
    "erase it",
    "take out the queue",
    "wipe that",
  ])("%s", (u) => {
    expect(hasRemovalVerb(u)).toBe(true);
  });
  it.each([
    "cross out MongoDB",
    "strike that",
    "discard the old approach",
    "we're not choosing Postgres",
    "add a row",
  ])("%s is not a removal", (u) => {
    expect(hasRemovalVerb(u)).toBe(false);
  });
});

describe("destructiveOps", () => {
  const ops: Op[] = [
    { op: "set_status", target: "b1", in: null, status: "struck" },
    { op: "delete", target: "b2" },
    { op: "graph.remove", target: "b5", nodes: ["redis"], edges: [] },
    { op: "table.remove_row", target: "b6", row: "r2" },
    { op: "table.remove_column", target: "b6", col: "c3" },
    { op: "archive", target: "b3" },
  ];

  it("flags removals and nothing that only marks or moves", () => {
    expect(destructiveOps(ops, text({})).map((d) => d.index)).toEqual([1, 2, 3, 4]);
  });

  it("flags a rewrite that loses most of the old words, not one that keeps them", () => {
    const ctx = text({ b4: "Redis stores hot keys so most reads never reach PostgreSQL" });
    const keep: Op = {
      op: "replace",
      target: "b4",
      lmd: "### Caching\nRedis stores hot keys so most reads never reach PostgreSQL",
    };
    const lose: Op = { op: "replace", target: "b4", lmd: "Something else entirely" };
    expect(destructiveOps([keep], ctx)).toEqual([]);
    expect(destructiveOps([lose], ctx)).toHaveLength(1);
    const convert: Op = {
      op: "convert",
      targets: ["b4"],
      to: "table",
      lmd: "Table: x\n| a |\n| --- |\n| 1 |",
    };
    expect(destructiveOps([convert], ctx)).toHaveLength(1);
    expect(destructiveOps([lose], text({}))).toEqual([]);
  });
});

describe("needsConfirmation", () => {
  const destructive = destructiveOps([{ op: "delete", target: "b2" }], text({}));
  it("asks unless the user said to remove", () => {
    expect(needsConfirmation("get rid of that", destructive)).toBe(false);
    expect(needsConfirmation("clean up that section", destructive)).toBe(true);
    expect(needsConfirmation("anything", [])).toBe(false);
  });
});
