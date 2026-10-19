import { describe, expect, it } from "vitest";
import { applyPatch, type BlockPatch } from "../model/patch";
import type { Block, BlockType, LucidDoc } from "../model/doc";
import {
  buildDocumentContextIndex,
  changedBlockIds,
  DocumentContextIndexStore,
} from "./documentIndex";

const text = (value: string) => [{ type: "text" as const, text: value, styles: {} }];
const block = (
  id: string,
  type: BlockType,
  value = "",
  props: Record<string, unknown> = {},
  children?: Block[],
): Block => ({ id, type, props, content: text(value), ...(children ? { children } : {}) });
const doc = (...blocks: Block[]): LucidDoc => ({ blocks });

describe("document context index", () => {
  it("indexes sections, stable component parts, and graph relationships", () => {
    const source = doc(
      block("intro", "paragraph", "Preamble"),
      block("h1", "heading", "Architecture", { level: 1 }),
      block("p1", "paragraph", "The request enters the gateway."),
      block("h2", "heading", "Data flow", { level: 2 }),
      block("t1", "table", "", {
        caption: "Latency",
        table: {
          columns: [
            { id: "c1", name: "Model", status: "normal" },
            { id: "c2", name: "Time", status: "normal" },
          ],
          rows: [{ id: "r1", cells: ["Small", "10"], status: "normal" }],
          headerColumn: false,
        },
      }),
      block("d1", "diagram", "", {
        graph: {
          type: "flowchart",
          direction: "LR",
          title: "Request path",
          nodes: [
            { id: "client", label: "Client", kind: "client", status: "normal" },
            { id: "api", label: "API", kind: "service", status: "normal" },
          ],
          edges: [
            {
              id: "e1",
              from: "client",
              to: "api",
              label: "calls",
              arrow: "directed",
              style: "solid",
              status: "normal",
            },
          ],
          groups: [{ id: "system", label: "System", members: ["api"], status: "normal" }],
          fragments: [],
        },
      }),
      block("c1", "chart", "", {
        chart: {
          kind: "bar",
          title: "Throughput",
          xLabel: "Model",
          yLabel: "Tokens",
          categories: ["Small"],
          series: [{ name: "Decode", values: [20] }],
        },
      }),
    );

    const index = buildDocumentContextIndex(source, ["d1", "missing", "d1", "t1"]);

    expect(index.blocks.map(({ id, sectionId }) => [id, sectionId])).toEqual([
      ["intro", null],
      ["h1", "h1"],
      ["p1", "h1"],
      ["h2", "h2"],
      ["t1", "h2"],
      ["d1", "h2"],
      ["c1", "h2"],
    ]);
    expect(index.sections).toMatchObject([
      {
        id: "h1",
        parentSectionId: null,
        title: "Architecture",
        start: 1,
        endExclusive: 7,
        blockIds: ["h1", "p1", "h2", "t1", "d1", "c1"],
      },
      {
        id: "h2",
        parentSectionId: "h1",
        title: "Data flow",
        start: 3,
        endExclusive: 7,
        blockIds: ["h2", "t1", "d1", "c1"],
      },
    ]);
    expect(index.components).toEqual([
      expect.objectContaining({
        id: "t1",
        kind: "table",
        partIds: ["t1:column:c1", "t1:column:c2", "t1:row:r1"],
      }),
      expect.objectContaining({
        id: "d1",
        kind: "diagram",
        partIds: ["d1:node:client", "d1:node:api", "d1:edge:e1", "d1:group:system"],
      }),
      expect.objectContaining({
        id: "c1",
        kind: "chart",
        partIds: ["c1:category:1", "c1:series:1"],
      }),
    ]);
    expect(index.relationships).toEqual([
      {
        id: "d1:edge:e1",
        diagramId: "d1",
        kind: "edge",
        fromId: "d1:node:client",
        toId: "d1:node:api",
        label: "calls",
      },
      {
        id: "d1:group:system:member:api",
        diagramId: "d1",
        kind: "group-member",
        fromId: "d1:group:system",
        toId: "d1:node:api",
        label: "System",
      },
    ]);
    expect(index.recentTouched).toEqual(["d1", "t1"]);
  });

  it("rebuilds without stale block, component, relationship, or touch ids", () => {
    const diagram = block("d1", "diagram", "", {
      graph: {
        type: "flowchart",
        direction: "LR",
        nodes: [{ id: "a", label: "A", kind: "process", status: "normal" }],
        edges: [],
        groups: [],
        fragments: [],
      },
    });
    const store = new DocumentContextIndexStore(doc(diagram, block("p1", "paragraph", "Keep")));
    store.update(doc(block("p1", "paragraph", "Keep")), ["d1"]);

    expect(store.current.blocks.map((entry) => entry.id)).toEqual(["p1"]);
    expect(store.current.components).toEqual([]);
    expect(store.current.relationships).toEqual([]);
    expect(store.current.recentTouched).toEqual([]);
  });

  it("tracks insert, update, move, remove, undo, revert, and load rebuilds", () => {
    const initial = doc(
      block("h", "heading", "Title", { level: 1 }),
      block("a", "paragraph", "A"),
      block("b", "paragraph", "B"),
    );
    const store = new DocumentContextIndexStore(initial);
    const insert: BlockPatch = {
      steps: [
        {
          kind: "insert",
          parentId: null,
          afterId: "a",
          blocks: [block("c", "paragraph", "C")],
        },
      ],
    };
    const inserted = applyPatch(initial, insert);
    store.update(inserted);
    expect(store.current.blocks.map((entry) => entry.id)).toEqual(["h", "a", "c", "b"]);
    expect(store.current.recentTouched).toEqual(["c"]);

    const updated = applyPatch(inserted, {
      steps: [{ kind: "update", id: "a", block: block("a", "paragraph", "A updated") }],
    });
    store.update(updated);
    expect(store.current.recentTouched.slice(0, 2)).toEqual(["a", "c"]);

    const moved = applyPatch(updated, {
      steps: [{ kind: "move", id: "b", parentId: null, afterId: null }],
    });
    store.update(moved);
    expect(store.current.blocks.map((entry) => entry.id)).toEqual(["b", "h", "a", "c"]);
    expect(store.current.recentTouched[0]).toBe("b");

    const removed = applyPatch(moved, { steps: [{ kind: "remove", id: "c" }] });
    store.update(removed, ["c"]);
    expect(store.current.blocks.some((entry) => entry.id === "c")).toBe(false);
    expect(store.current.recentTouched).not.toContain("c");

    // Undo of the removal reports the complete restored document and rebuilds the index.
    store.update(moved);
    expect(store.current.blocks.some((entry) => entry.id === "c")).toBe(true);
    expect(store.current.recentTouched[0]).toBe("c");

    // A revert is an ordinary inverse patch and follows the same update path.
    const reverted = applyPatch(moved, {
      steps: [{ kind: "update", id: "a", block: block("a", "paragraph", "A") }],
    });
    store.update(reverted, ["a"]);
    expect(store.current.blocks.find((entry) => entry.id === "a")?.summary).toBe("A");

    store.load(doc(block("new", "paragraph", "Another page")));
    expect(store.current.blocks.map((entry) => entry.id)).toEqual(["new"]);
    expect(store.current.recentTouched).toEqual([]);
  });

  it("detects only the inserted or minimally moved blocks", () => {
    const before = doc(
      block("a", "paragraph", "A"),
      block("b", "paragraph", "B"),
      block("c", "paragraph", "C"),
    );
    const inserted = doc(
      block("a", "paragraph", "A"),
      block("x", "paragraph", "X"),
      block("b", "paragraph", "B"),
      block("c", "paragraph", "C"),
    );
    const moved = doc(
      block("c", "paragraph", "C"),
      block("a", "paragraph", "A"),
      block("b", "paragraph", "B"),
    );
    expect(changedBlockIds(before, inserted)).toEqual(["x"]);
    expect(changedBlockIds(before, moved)).toEqual(["c"]);
  });

  it("is deterministic for large documents", () => {
    const blocks = Array.from({ length: 5_000 }, (_, index) =>
      block(
        `b${String(index)}`,
        index % 100 === 0 ? "heading" : "paragraph",
        `Block ${String(index)}`,
        {
          ...(index % 100 === 0 ? { level: 1 } : {}),
        },
      ),
    );
    const source = doc(...blocks);
    const first = buildDocumentContextIndex(source, ["b4999", "b1"]);
    const second = buildDocumentContextIndex(source, ["b4999", "b1"]);
    expect(first.blocks).toHaveLength(5_000);
    expect(first.sections).toHaveLength(50);
    expect(second).toEqual(first);
  });
});
