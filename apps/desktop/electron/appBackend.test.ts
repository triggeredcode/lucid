import { createLucidFile, type BlockPatch, type LucidDoc, type LucidFile } from "@lucid/core";
import { SAMPLE_DOC } from "@lucid/kit";
import { describe, expect, it } from "vitest";
import { AppBackend, type Bridge, type PdfMaker } from "./appBackend";
import type { CompileRequest, CompileResult } from "./pdf";

const removeTable: BlockPatch = { steps: [{ kind: "remove", id: "t1" }] };
const note = { summary: "Removed the table", source: "agent:claude-code", affected: [] };

function setup() {
  const files = new Map<string, LucidFile>();
  const a = { ...createLucidFile(), title: "Closed page", doc: SAMPLE_DOC };
  const b = { ...createLucidFile(), title: "Open page", doc: SAMPLE_DOC };
  files.set(a.id, a);
  files.set(b.id, b);
  const bridgeCalls: string[] = [];
  let live: LucidDoc = SAMPLE_DOC;
  const compiled: CompileRequest[] = [];
  const saved: { title: string; bytes: number }[] = [];
  let outcome: CompileResult = { ok: true, pdf: new Uint8Array(2048), ms: 5, warnings: [] };
  const pdf: PdfMaker = {
    compile: (request) => {
      compiled.push(request);
      return Promise.resolve(outcome);
    },
    save: (title, bytes) => {
      saved.push({ title, bytes: bytes.byteLength });
      return Promise.resolve(`/library/exports/${title}.pdf`);
    },
  };
  const bridge: Bridge = {
    openPage: () =>
      Promise.resolve({
        id: b.id,
        title: b.title,
        format: "comparison",
        info: { author: "On screen" },
      }),
    getDoc: () => Promise.resolve(live),
    figures: () => {
      bridgeCalls.push("figures");
      return Promise.resolve({ g1: "<svg/>" });
    },
    apply: (_patch, n) => {
      bridgeCalls.push(`apply:${n.source}`);
      live = { blocks: live.blocks.filter((x) => x.id !== "t1") };
      return Promise.resolve(live);
    },
  };
  let changed = 0;
  const backend = new AppBackend({
    bridge,
    pdf,
    changed: () => changed++,
    store: {
      create: (title, options) => {
        const f = {
          ...createLucidFile(),
          title,
          ...(options?.format
            ? { meta: { vocabulary: [], info: {}, format: options.format } }
            : {}),
        };
        files.set(f.id, f);
        return Promise.resolve(f);
      },
      list: () =>
        Promise.resolve({
          pages: [...files.values()].map((f) => ({
            id: f.id,
            title: f.title,
            updatedAt: f.updatedAt,
          })),
        }),
      load: (id) => {
        const f = files.get(id);
        return f ? Promise.resolve(f) : Promise.reject(new Error("missing"));
      },
      save: (f) => {
        files.set(f.id, f);
        return Promise.resolve(f);
      },
    },
  });
  return {
    backend,
    files,
    a,
    b,
    bridgeCalls,
    changed: () => changed,
    compiled,
    saved,
    setOutcome: (next: CompileResult) => {
      outcome = next;
    },
  };
}

describe("AppBackend", () => {
  it("lists the library", async () => {
    const { backend, a, b } = setup();
    expect((await backend.listPages()).map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("reads the open page from the editor and a closed page from disk", async () => {
    const { backend, a, b } = setup();
    expect(await backend.getPage()).toMatchObject({ id: b.id, open: true, title: "Open page" });
    expect(await backend.getPage(a.id)).toMatchObject({
      id: a.id,
      open: false,
      title: "Closed page",
    });
    await expect(backend.getPage("nope")).rejects.toThrow('There is no page "nope"');
  });

  it("changes the open page through the editor, never on disk", async () => {
    const { backend, files, b, bridgeCalls, changed } = setup();
    const r = await backend.applyPatch(b.id, removeTable, note);
    expect(r.doc.blocks.some((x) => x.id === "t1")).toBe(false);
    expect(bridgeCalls).toEqual(["apply:agent:claude-code"]);
    expect(files.get(b.id)?.doc.blocks.some((x) => x.id === "t1")).toBe(true);
    expect(changed()).toBe(0);
  });

  it("changes a closed page on disk with a history entry from the agent, and tells the window", async () => {
    const { backend, files, a, bridgeCalls, changed } = setup();
    await backend.applyPatch(a.id, removeTable, note);
    const saved = files.get(a.id);
    expect(saved?.doc.blocks.some((x) => x.id === "t1")).toBe(false);
    expect(saved?.changeLog.at(-1)).toMatchObject({
      source: "agent:claude-code",
      summary: "Removed the table",
      reverted: false,
    });
    expect(bridgeCalls).toEqual([]);
    expect(changed()).toBe(1);
  });

  it("without an open page, says so when no id is given, and still works by id", async () => {
    const { a } = setup();
    const none = new AppBackend({
      bridge: {
        openPage: () => Promise.resolve(undefined),
        getDoc: () => Promise.reject(new Error("no window")),
        figures: () => Promise.reject(new Error("no window")),
        apply: () => Promise.reject(new Error("no window")),
      },
      pdf: {
        compile: () => Promise.reject(new Error("no engine")),
        save: () => Promise.reject(new Error("no folder")),
      },
      changed: () => undefined,
      store: {
        create: () => Promise.reject(new Error("no")),
        list: () => Promise.resolve({ pages: [] }),
        load: () => Promise.resolve(a),
        save: (f) => Promise.resolve(f),
      },
    });
    await expect(none.getPage()).rejects.toThrow("No page is open");
    expect((await none.getPage(a.id)).open).toBe(false);
  });

  it("creates a page, blank or of a format, tells the window, and refuses a format that does not exist", async () => {
    const { backend, files, changed } = setup();
    const made = await backend.createPage("Notes", "comparison");
    expect(files.get(made.id)?.meta.format).toBe("comparison");
    expect((await backend.getPage(made.id)).format).toBe("comparison");
    const blank = await backend.createPage("Blank");
    expect(files.get(blank.id)?.meta.format).toBeUndefined();
    expect(changed()).toBe(2);
    await expect(backend.createPage("X", "essay")).rejects.toThrow('There is no format "essay"');
  });

  it("reports the format the window shows for the open page", async () => {
    const { backend } = setup();
    expect((await backend.getPage()).format).toBe("comparison");
  });

  describe("export_pdf", () => {
    it("typesets the open page from what the window holds, with its format and fields, figures drawn by the window", async () => {
      const { backend, b, bridgeCalls, compiled, saved } = setup();
      const made = await backend.exportPdf();
      expect(made).toEqual({
        path: "/library/exports/Open page.pdf",
        bytes: 2048,
        warnings: [],
      });
      expect(bridgeCalls).toEqual(["figures"]);
      expect(compiled).toHaveLength(1);
      expect(compiled[0]).toMatchObject({
        pageId: `agent-${b.id}`,
        title: "Open page",
        figures: { g1: "<svg/>" },
        format: { id: "comparison" },
        info: { author: "On screen" },
      });
      expect(compiled[0]?.doc).toEqual(SAMPLE_DOC);
      expect(saved).toEqual([{ title: "Open page", bytes: 2048 }]);
    });

    it("typesets a closed page from disk, with the format and fields it was saved with", async () => {
      const { backend, files, a, compiled } = setup();
      files.set(a.id, {
        ...a,
        meta: { vocabulary: [], format: "comparison", info: { source: "Q" } },
      });
      await backend.exportPdf(a.id);
      expect(compiled[0]).toMatchObject({
        pageId: `agent-${a.id}`,
        title: "Closed page",
        format: { id: "comparison" },
        info: { source: "Q" },
      });
    });

    it("does not need the window for a page without diagrams or charts", async () => {
      const { backend, files, a, bridgeCalls, compiled } = setup();
      files.set(a.id, {
        ...a,
        doc: { blocks: SAMPLE_DOC.blocks.filter((x) => x.type === "paragraph") },
      });
      await backend.exportPdf(a.id);
      expect(compiled[0]?.doc.blocks.length).toBeGreaterThan(0);
      expect(bridgeCalls).toEqual([]);
      expect(compiled[0]?.figures).toEqual({});
    });

    it("passes the engine's complaint on, hides nothing, and saves no file", async () => {
      const { backend, saved, setOutcome } = setup();
      setOutcome({
        ok: false,
        message: "Tectonic, the PDF engine, isn't installed.",
        log: "…",
      });
      await expect(backend.exportPdf()).rejects.toThrow(
        "Tectonic, the PDF engine, isn't installed.",
      );
      setOutcome({ ok: false, cancelled: true });
      await expect(backend.exportPdf()).rejects.toThrow("Another PDF of this page was started");
      expect(saved).toEqual([]);
    });

    it("carries the engine's warnings, and says so for a page that is not there", async () => {
      const { backend, setOutcome } = setup();
      setOutcome({
        ok: true,
        pdf: new Uint8Array(10),
        ms: 1,
        warnings: ["rsvg-convert is not installed, so diagrams are empty boxes."],
      });
      expect((await backend.exportPdf()).warnings).toEqual([
        "rsvg-convert is not installed, so diagrams are empty boxes.",
      ]);
      await expect(backend.exportPdf("nope")).rejects.toThrow('There is no page "nope"');
    });
  });

  it("refuses a patch that no longer fits the page, leaving it as it was", async () => {
    const { backend, files, a } = setup();
    await expect(
      backend.applyPatch(a.id, { steps: [{ kind: "remove", id: "gone" }] }, note),
    ).rejects.toThrow();
    expect(files.get(a.id)?.changeLog).toEqual([]);
  });
});
