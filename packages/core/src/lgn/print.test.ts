import { describe, expect, it } from "vitest";
import type { Graph } from "../model/graph";
import { parseLgnOrThrow } from "./apply";
import { printLgn } from "./print";

const roundTrip = (source: string, opts: Parameters<typeof parseLgnOrThrow>[1] = {}): string =>
  printLgn(parseLgnOrThrow(source, opts));

describe("printLgn", () => {
  it("writes nodes with kind and label, then edges, in canonical form", () => {
    expect(roundTrip("web -> redis: check cache\nredis [cache]: Redis")).toBe(
      ["web [process]: Web", "redis [cache]: Redis", "web -> redis: check cache"].join("\n"),
    );
  });

  it("writes statuses, every arrow token and group lines", () => {
    const text = [
      "a [service]: A {chosen}",
      "b [datastore]: B {struck}",
      "c [cache]: C {hidden}",
      "a -> b: one {struck}",
      "b -.-> c",
      "c <..> a: three",
      "group g: Boundary {a, b} {struck}",
    ].join("\n");
    expect(roundTrip(text)).toBe(text);
  });

  it("quotes labels that would not survive being read back", () => {
    const out = roundTrip('x [service]: "ends {struck}"\ny [service]: "  padded  "');
    expect(out).toContain('x [service]: "ends {struck}"');
    expect(out).toContain('y [service]: "  padded  "');
    const g = parseLgnOrThrow(out);
    expect(g.nodes.map((n) => n.label)).toEqual(["ends {struck}", "  padded  "]);
  });

  it("is idempotent: printing a parsed print gives the same text", () => {
    const once = roundTrip("a -> b: x\nb -.-> a: y {struck}\nb [cache]: B\ngroup g: G {a, b}");
    expect(roundTrip(once)).toBe(once);
  });

  it("writes sequence messages in order with fragments around them", () => {
    const source = [
      "c [client]: Client",
      "w [service]: Web",
      "r [cache]: Redis",
      "c -> w: GET",
      "w -> r: lookup",
      "alt hit",
      "r -.-> w: value",
      "else miss",
      "r -.-> w: nil",
      "w -> c: 404",
      "end",
      "w -> c: done",
    ].join("\n");
    expect(roundTrip(source, { type: "sequence" })).toBe(source);
  });

  it("opens outer fragments before inner ones and closes inner ones first", () => {
    const source = [
      "a [process]: A",
      "b [process]: B",
      "loop retry",
      "opt maybe",
      "a -> b: x",
      "end",
      "b -> a: y",
      "end",
    ].join("\n");
    expect(roundTrip(source, { type: "sequence" })).toBe(source);
  });

  it("prints an else before a fragment that opens at the same message", () => {
    const source = [
      "a [process]: A",
      "b [process]: B",
      "alt one",
      "a -> b: x",
      "else two",
      "opt inner",
      "b -> a: y",
      "end",
      "end",
    ].join("\n");
    expect(roundTrip(source, { type: "sequence" })).toBe(source);
  });

  it("prints an empty graph as an empty string", () => {
    const empty: Graph = {
      type: "flowchart",
      direction: "LR",
      nodes: [],
      edges: [],
      groups: [],
      fragments: [],
    };
    expect(printLgn(empty)).toBe("");
  });
});
