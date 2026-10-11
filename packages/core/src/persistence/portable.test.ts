import { describe, expect, it } from "vitest";
import { createLucidFile, parseLucidFile, type LucidFile } from "./format";
import { LucidFileError } from "./format";
import { planImport, toExport } from "./portable";

const note = (): LucidFile => ({
  ...createLucidFile({
    title: "Scaling from 0 to a million",
    id: () => "id-original",
    // A fixed clock: the note is built more than once in a test and must be the same each time.
    now: () => new Date("2026-10-11T10:00:00.000Z"),
  }),
  doc: {
    blocks: [
      {
        id: "p1",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "Start with one server.", styles: {} }],
      },
    ],
  },
  transcripts: [
    {
      id: "t1",
      text: "start with one server",
      source: "wispr",
      mode: "input",
      createdAt: "2026-10-11T10:00:00.000Z",
      status: "applied",
    },
  ],
  changeLog: [
    {
      id: "c1",
      at: "2026-10-11T10:00:01.000Z",
      summary: "Added a note",
      source: "local-model",
      affected: ["p1"],
      reverted: false,
      revert: {
        undo: { steps: [{ kind: "remove", id: "p1" }] },
        expect: { p1: null },
      },
    },
  ],
});

describe("exporting a note", () => {
  it("keeps everything: the notes, what was said and the history with its way back", () => {
    const file = note();
    expect(toExport(file, { history: true })).toEqual(file);
  });

  it("can leave out what was said and the history, and nothing else", () => {
    const file = note();
    const clean = toExport(file, { history: false });
    expect(clean.transcripts).toEqual([]);
    expect(clean.changeLog).toEqual([]);
    expect(clean.doc).toEqual(file.doc);
    expect(clean.title).toBe(file.title);
    expect(clean.id).toBe(file.id);
    expect(clean.meta).toEqual(file.meta);
    // The note it was made from is not touched.
    expect(file.transcripts).toHaveLength(1);
    expect(file.changeLog).toHaveLength(1);
  });

  it("is a file that reads back as the same note, through JSON", () => {
    const file = note();
    for (const history of [true, false]) {
      const out = toExport(file, { history });
      expect(parseLucidFile(JSON.parse(JSON.stringify(out)))).toEqual(out);
    }
  });
});

describe("importing a note", () => {
  it("takes a note as it is when it is new here", () => {
    const plan = planImport(JSON.parse(JSON.stringify(note())), new Set(["other"]));
    expect(plan.copy).toBe(false);
    expect(plan.file).toEqual(note());
  });

  it("makes a copy, with a new id and a title that says so, when the same note is already here", () => {
    let n = 0;
    const plan = planImport(note(), new Set(["id-original"]), () => `fresh-${String(++n)}`);
    expect(plan.copy).toBe(true);
    expect(plan.file.id).toBe("fresh-1");
    expect(plan.file.title).toBe("Scaling from 0 to a million (copy)");
    // The rest of the note, its history included, comes with it.
    expect(plan.file.doc).toEqual(note().doc);
    expect(plan.file.transcripts).toEqual(note().transcripts);
    expect(plan.file.changeLog).toEqual(note().changeLog);
  });

  it("never leaves the new id equal to one that is here", () => {
    const ids = ["taken", "taken", "free"];
    const plan = planImport(note(), new Set(["id-original", "taken"]), () => ids.shift() ?? "x");
    expect(plan.file.id).toBe("free");
  });

  it.each([
    ["something that is not a note", { hello: "world" }, /not a Lucid page/],
    ["a list", [1, 2, 3], /not a Lucid page/],
    ["text", "just text", /not a Lucid page/],
    ["a note from a newer Lucid", { ...note(), version: 99 }, /newer version of Lucid/],
    ["a damaged note", { ...note(), doc: { blocks: "no" } }, /damaged/],
  ])("refuses %s, in words, without making anything", (_name, raw, message) => {
    expect(() => planImport(raw, new Set())).toThrow(LucidFileError);
    expect(() => planImport(raw, new Set())).toThrow(message);
  });
});
