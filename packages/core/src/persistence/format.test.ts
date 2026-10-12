import { describe, expect, it } from "vitest";
import {
  CURRENT_VERSION,
  LucidFileError,
  createLucidFile,
  fileNameFor,
  parseLucidFile,
  slugify,
} from "./format";

const fixed = () => new Date("2026-10-10T12:00:00.000Z");

describe("createLucidFile", () => {
  it("makes an empty page with sensible defaults", () => {
    const file = createLucidFile({ now: fixed, id: () => "abc12345-0000" });
    expect(file).toEqual({
      format: "lucid",
      version: CURRENT_VERSION,
      id: "abc12345-0000",
      title: "Untitled",
      createdAt: "2026-10-10T12:00:00.000Z",
      updatedAt: "2026-10-10T12:00:00.000Z",
      doc: { blocks: [] },
      transcripts: [],
      changeLog: [],
      meta: { vocabulary: [], info: {} },
    });
  });

  it("round-trips through JSON and parseLucidFile", () => {
    const file = createLucidFile({
      title: "Caching",
      author: "Asha",
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
    expect(parseLucidFile(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });
});

describe("note format in the page file", () => {
  it("a new page can name its format, and the fields under the title start empty", () => {
    const f = createLucidFile({ format: "comparison", author: "Asha" });
    expect(f.meta).toEqual({ vocabulary: [], info: {}, author: "Asha", format: "comparison" });
    expect(createLucidFile().meta.format).toBeUndefined();
  });

  it("keeps the format and the fields through JSON, and reads an older file that has neither", () => {
    const f = createLucidFile({ format: "comparison" });
    f.meta.info = { source: "Review", date: "2026-10-11" };
    const back = parseLucidFile(JSON.parse(JSON.stringify(f)));
    expect(back.meta).toMatchObject({
      format: "comparison",
      info: { source: "Review", date: "2026-10-11" },
    });
    const old = JSON.parse(JSON.stringify(createLucidFile())) as { meta: Record<string, unknown> };
    old.meta = { vocabulary: ["vLLM"] };
    expect(parseLucidFile(old).meta).toEqual({ vocabulary: ["vLLM"], info: {} });
  });
});

describe("the way back of a change in the page file", () => {
  const revert = {
    undo: { steps: [{ kind: "remove" as const, id: "n1" }] },
    expect: { n1: null },
  };
  const entry = {
    id: "c1",
    at: "2026-10-11T10:00:00.000Z",
    summary: "Added a note",
    source: "local-model",
    affected: ["n1"],
    reverted: false,
  };

  it("is kept when the file is read, and is optional (older files have none)", () => {
    const file = { ...createLucidFile(), changeLog: [{ ...entry, revert }, entry] };
    const parsed = parseLucidFile(JSON.parse(JSON.stringify(file)));
    expect(parsed.changeLog[0]?.revert).toEqual(revert);
    expect(parsed.changeLog[1]?.revert).toBeUndefined();
  });

  it("is refused when it is not a patch and the blocks it expects", () => {
    const bad = {
      ...createLucidFile(),
      changeLog: [{ ...entry, revert: { undo: { steps: [{ kind: "explode" }] }, expect: {} } }],
    };
    expect(() => parseLucidFile(JSON.parse(JSON.stringify(bad)))).toThrow(LucidFileError);
  });
});

describe("parseLucidFile", () => {
  const valid = () => JSON.parse(JSON.stringify(createLucidFile())) as Record<string, unknown>;

  it("fills defaults for optional lists", () => {
    const { transcripts: _t, changeLog: _c, meta: _m, ...rest } = valid();
    const file = parseLucidFile(rest);
    expect(file.transcripts).toEqual([]);
    expect(file.changeLog).toEqual([]);
    expect(file.meta).toEqual({ vocabulary: [], info: {} });
  });

  it.each([
    ["null", null, "not_json_object"],
    ["an array", [], "not_json_object"],
    ["a string", "hello", "not_json_object"],
    ["another format", { format: "markdown" }, "not_lucid"],
    ["no format", {}, "not_lucid"],
  ])("rejects %s", (_name, input, code) => {
    expect(() => parseLucidFile(input)).toThrow(LucidFileError);
    try {
      parseLucidFile(input);
    } catch (error) {
      expect((error as LucidFileError).code).toBe(code);
    }
  });

  it("refuses files from a newer version without trying to read them", () => {
    try {
      parseLucidFile({ ...valid(), version: CURRENT_VERSION + 1 });
      expect.unreachable();
    } catch (error) {
      expect((error as LucidFileError).code).toBe("newer_version");
      expect((error as LucidFileError).message).toContain("newer version");
    }
  });

  it("refuses an unknown older version it has no migration for", () => {
    expect(() => parseLucidFile({ ...valid(), version: 0 })).toThrow(/Cannot upgrade/);
  });

  it("reports damaged files with the path of the problem", () => {
    const bad = { ...valid(), doc: { blocks: [{ id: "", type: "paragraph", props: {} }] } };
    try {
      parseLucidFile(bad);
      expect.unreachable();
    } catch (error) {
      expect((error as LucidFileError).code).toBe("invalid");
      expect((error as LucidFileError).message).toContain("damaged");
    }
  });

  it("rejects unknown top-level keys instead of silently dropping them", () => {
    expect(() => parseLucidFile({ ...valid(), surprise: 1 })).toThrow(LucidFileError);
  });
});

describe("slugify and fileNameFor", () => {
  it.each([
    ["Designing a URL shortener", "designing-a-url-shortener"],
    ["  KV cache: sizing (v2)!  ", "kv-cache-sizing-v2"],
    ["Café résumé", "cafe-resume"],
    ["", "untitled"],
    ["!!!", "untitled"],
    ["日本語", "untitled"],
    ["a".repeat(100), "a".repeat(60)],
  ])("slugify(%j) = %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("builds a file name from the slug and the start of the id", () => {
    expect(fileNameFor({ title: "Caching", id: "A1B2C3D4-e5f6" })).toBe("caching--a1b2c3d4.lucid");
    expect(fileNameFor({ title: "", id: "x" })).toBe("untitled--x.lucid");
  });
});
