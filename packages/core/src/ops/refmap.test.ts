import { describe, expect, it } from "vitest";
import { bullets, callout, doc, h1, h2, numbered, p } from "../testing";
import { buildRefMap } from "./refmap";

const d = doc(
  h1("Title", { id: "h" }),
  p("intro", { id: "p" }),
  bullets("a", { text: "b", id: "bb", children: ["b1", "b2"] }, "c"),
  numbered("one", "two"),
  callout("key", "K", p("inside", { id: "in" }), bullets("x", "y")),
  h2("End", { id: "e" }),
);

describe("RefMap", () => {
  const map = buildRefMap(d);

  it("numbers top-level blocks and groups consecutive list items", () => {
    expect(map.resolve("b1")).toEqual({ kind: "block", id: "h" });
    expect(map.resolve("b2")).toEqual({ kind: "block", id: "p" });
    expect(map.resolve("b3")).toMatchObject({ kind: "list" });
    expect(map.resolve("b4")).toMatchObject({ kind: "list" });
    expect(map.resolve("b5")).toMatchObject({ kind: "block" });
    expect(map.resolve("b6")).toEqual({ kind: "block", id: "e" });
    expect(map.resolve("b7")).toBeUndefined();
  });

  it("references list items and nested children", () => {
    const list = map.resolve("b3");
    expect(list?.kind === "list" && list.ids).toHaveLength(3);
    expect(map.resolve("b3.2")).toEqual({ kind: "item", id: "bb" });
    expect(map.resolve("b3.2.1")).toMatchObject({ kind: "item" });
    expect(map.resolve("b3.2.3")).toBeUndefined();
    expect(map.resolve("b5.1")).toEqual({ kind: "item", id: "in" });
    expect(map.resolve("b5.2")).toMatchObject({ kind: "item" });
  });

  it("goes back from ids to references", () => {
    expect(map.refOf("h")).toBe("b1");
    expect(map.refOf("bb")).toBe("b3.2");
    expect(map.refOf("in")).toBe("b5.1");
    expect(map.refOf("nope")).toBeUndefined();
  });

  it("accepts references in brackets, as the outline prints them", () => {
    expect(map.resolve("[b2]")).toEqual({ kind: "block", id: "p" });
  });

  it("is stable: the same document gives the same references", () => {
    expect(buildRefMap(d).refs).toEqual(map.refs);
  });

  it("handles an empty document", () => {
    expect(buildRefMap({ blocks: [] }).refs).toEqual([]);
  });
});
