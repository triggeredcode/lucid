import { mkdtemp, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LucidFileError } from "@lucid/core";
import { beforeEach, describe, expect, it } from "vitest";
import { Library } from "./library";

let dir = "";
let trashed: string[] = [];
let clock = new Date("2026-10-10T10:00:00.000Z");
const lib = (extra: Partial<ConstructorParameters<typeof Library>[1]> = {}) =>
  new Library(dir, {
    now: () => clock,
    trash: (p) => Promise.resolve(void trashed.push(p)),
    author: "Asha",
    ...extra,
  });
const tick = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lucid-lib-"));
  trashed = [];
  clock = new Date("2026-10-10T10:00:00.000Z");
});

describe("Library: create, list, load", () => {
  it("starts empty and creates the folder on demand", async () => {
    expect(await lib().list()).toEqual({ pages: [], problems: [] });
  });

  it("starts a page of a note format as that format's section headings, and remembers the format", async () => {
    const l = lib();
    const page = await l.create("SQL vs NoSQL", { format: "comparison" });
    expect(page.meta.format).toBe("comparison");
    expect(page.doc.blocks.map((b) => b.type)).toEqual(Array(5).fill("heading"));
    expect(page.doc.blocks.map((b) => (b.content?.[0] as { text: string }).text)).toEqual([
      "Context",
      "Options",
      "Comparison",
      "Pros and cons",
      "Decision",
    ]);
    expect((await l.load(page.id)).meta.format).toBe("comparison");
    // A blank page, and a format that does not exist, start empty.
    expect((await l.create("Blank")).doc.blocks).toEqual([]);
    const odd = await l.create("Odd", { format: "essay" });
    expect(odd.doc.blocks).toEqual([]);
    expect(odd.meta.format).toBeUndefined();
  });

  it("writes the author set later into the next page", async () => {
    const l = lib();
    l.setAuthor("Asha");
    expect((await l.create("A")).meta.author).toBe("Asha");
  });

  it("creates a page that can be listed and loaded", async () => {
    const l = lib();
    const page = await l.create("Designing a URL shortener");
    expect(page.title).toBe("Designing a URL shortener");
    expect(page.meta.author).toBe("Asha");
    const { pages } = await l.list();
    expect(pages).toEqual([
      expect.objectContaining({
        id: page.id,
        title: "Designing a URL shortener",
        fileName: expect.stringMatching(
          /^designing-a-url-shortener--[a-z0-9]{8}\.lucid$/,
        ) as string,
      }),
    ]);
    expect((await l.load(page.id)).id).toBe(page.id);
  });

  it("lists the most recently changed page first", async () => {
    const l = lib();
    const a = await l.create("A");
    tick(60_000);
    const b = await l.create("B");
    tick(60_000);
    await l.save({ ...a, title: "A" });
    expect((await l.list()).pages.map((p) => p.title)).toEqual(["A", "B"]);
    expect(b.title).toBe("B");
  });

  it("says so when a page doesn't exist", async () => {
    await expect(lib().load("nope")).rejects.toThrow(/doesn't exist/);
  });
});

describe("Library: save", () => {
  it("saves content, bumps updatedAt and leaves no temp file behind", async () => {
    const l = lib();
    const page = await l.create("Notes");
    tick(5000);
    const saved = await l.save({
      ...page,
      doc: {
        blocks: [
          {
            id: "b1",
            type: "paragraph",
            props: {},
            content: [{ type: "text", text: "hi", styles: {} }],
          },
        ],
      },
    });
    expect(saved.updatedAt).toBe("2026-10-10T10:00:05.000Z");
    expect((await l.load(page.id)).doc.blocks).toHaveLength(1);
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("moves the file to its new name when the title changes, keeping one file", async () => {
    const l = lib();
    const page = await l.create("Draft");
    const saved = await l.save({ ...page, title: "KV cache sizing" });
    const names = (await readdir(dir)).filter((n) => n !== ".lucid" && n.endsWith(".lucid"));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^kv-cache-sizing--/);
    expect((await l.load(saved.id)).title).toBe("KV cache sizing");
  });

  it("keeps a backup of the previous version at most every five minutes", async () => {
    const l = lib();
    const page = await l.create("Notes");
    await l.save({ ...page, title: "Notes v2" });
    tick(60_000);
    await l.save({ ...page, title: "Notes v3" });
    const backupDir = join(dir, ".lucid", "backups", page.id);
    expect(await readdir(backupDir)).toHaveLength(1);
    tick(6 * 60_000);
    await l.save({ ...page, title: "Notes v4" });
    expect(await readdir(backupDir)).toHaveLength(2);
  });

  it("keeps only the newest backups", async () => {
    const l = lib({ backupEveryMs: 0, keepBackups: 3 });
    const page = await l.create("Notes");
    for (let i = 0; i < 6; i++) {
      tick(1000);
      await l.save({ ...page, title: `Notes ${String(i)}` });
    }
    expect(await readdir(join(dir, ".lucid", "backups", page.id))).toHaveLength(3);
  });
});

describe("Library: trash and damaged files", () => {
  it("moves a page to the Trash instead of deleting it", async () => {
    const l = lib();
    const page = await l.create("Old");
    await l.trash(page.id);
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toContain("old--");
  });

  it("reports an unreadable page as a problem and never overwrites it", async () => {
    const l = lib();
    await l.create("Good");
    const bad = join(dir, "broken--abcd1234.lucid");
    await writeFile(bad, "{ not json", "utf8");
    const { pages, problems } = await l.list();
    expect(pages).toHaveLength(1);
    expect(problems).toEqual([
      { fileName: "broken--abcd1234.lucid", message: "This file is not a Lucid page." },
    ]);
    expect(await readFile(bad, "utf8")).toBe("{ not json");
  });

  it("reports a page from a newer version in plain words", async () => {
    const l = lib();
    const page = await l.create("Future");
    const files = (await readdir(dir)).filter((n) => n !== ".lucid" && n.endsWith(".lucid"));
    const path = join(dir, files[0] ?? "");
    await writeFile(path, JSON.stringify({ ...page, version: 99 }), "utf8");
    const { problems } = await l.list();
    expect(problems[0]?.message).toContain("newer version");
  });

  it("ignores files that are not pages", async () => {
    await writeFile(join(dir, "notes.txt"), "x", "utf8");
    await utimes(join(dir, "notes.txt"), new Date(), new Date());
    expect(await lib().list()).toEqual({ pages: [], problems: [] });
  });

  it("does not replace an unreadable file that happens to share a page's name", async () => {
    const l = lib();
    const page = await l.create("Same");
    const short = page.id
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 8)
      .toLowerCase();
    const impostor = join(dir, `aaa--${short}.lucid`);
    await writeFile(impostor, "garbage", "utf8");
    await l.save({ ...page, title: "Same again" });
    expect(await readFile(impostor, "utf8")).toBe("garbage");
  });
});

describe("Library: importing a note", () => {
  const exported = async (l: Library) => {
    const page = await l.create("Scaling from 0 to a million");
    return l.save({
      ...page,
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
          createdAt: "2026-10-10T10:00:00.000Z",
          status: "applied",
        },
      ],
      changeLog: [
        {
          id: "c1",
          at: "2026-10-10T10:00:01.000Z",
          summary: "Added a note",
          source: "local-model",
          affected: ["p1"],
          reverted: false,
        },
      ],
    });
  };

  it("brings a note from another library in, with what was said and its history", async () => {
    const elsewhere = lib();
    const note = await exported(elsewhere);
    const here = new Library(await mkdtemp(join(tmpdir(), "lucid-lib-")), {
      now: () => clock,
      trash: () => Promise.resolve(),
      author: "Asha",
    });
    const result = await here.importNote(JSON.parse(JSON.stringify(note)));
    expect(result).toMatchObject({ copy: false, page: { id: note.id, title: note.title } });
    const loaded = await here.load(note.id);
    expect(loaded.doc).toEqual(note.doc);
    expect(loaded.transcripts).toEqual(note.transcripts);
    expect(loaded.changeLog).toEqual(note.changeLog);
    expect((await here.list()).pages.map((p) => p.id)).toEqual([note.id]);
  });

  it("keeps both when the same note is already here: a copy, and the first one is untouched", async () => {
    const l = lib();
    const note = await exported(l);
    const before = await l.load(note.id);
    const result = await l.importNote(JSON.parse(JSON.stringify(note)));
    expect(result.copy).toBe(true);
    expect(result.page.id).not.toBe(note.id);
    expect(result.page.title).toBe("Scaling from 0 to a million (copy)");
    expect((await l.list()).pages).toHaveLength(2);
    expect(await l.load(note.id)).toEqual(before);
    expect((await l.load(result.page.id)).transcripts).toEqual(note.transcripts);
  });

  it("refuses a file that is not a note, or is damaged, with a message, and writes nothing", async () => {
    const l = lib();
    await expect(l.importNote({ hello: "world" })).rejects.toThrow(/not a Lucid page/);
    const page = await l.create("Good");
    const damaged = {
      ...page,
      id: "other-id",
      doc: { blocks: [{ id: "x", type: "table", props: { nonsense: true } }] },
    };
    await expect(l.importNote(damaged)).rejects.toThrow(LucidFileError);
    expect((await l.list()).pages.map((p) => p.id)).toEqual([page.id]);
    expect(await readdir(dir)).not.toContain("other-id");
  });
});
