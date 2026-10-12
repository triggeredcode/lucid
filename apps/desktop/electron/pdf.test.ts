import { chmod, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PDF_STYLE, LUCID_STY, getFormat, registry } from "@lucid/kit";
import { describe, expect, it } from "vitest";
import type { LucidDoc } from "@lucid/core";
import {
  PdfCompiler,
  explainLatexError,
  svgWidthsInPoints,
  warmUpDoc,
  type CompileRequest,
  type CompileResult,
  type PdfOptions,
  type PdfProgress,
} from "./pdf";

const doc = (text: string): LucidDoc => ({
  blocks: [
    {
      id: "h",
      type: "heading",
      props: { level: 1 },
      content: [{ type: "text", text: "Caching", styles: {} }],
    },
    { id: "p", type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }] },
  ],
});
const req = (pageId: string, text = "hello"): CompileRequest => ({
  pageId,
  title: "KV cache",
  doc: doc(text),
  figures: {},
});

/** The engine log of a failed compile (empty for success or a cancelled compile). */
const logOf = (r: CompileResult): string => (!r.ok && !r.cancelled ? r.log : "");
/** The plain-words message of a failed compile (empty for success or a cancelled compile). */
const messageOf = (r: CompileResult): string => (!r.ok && !r.cancelled ? r.message : "");

async function script(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lucid-fake-"));
  const path = join(dir, "tool.sh");
  await writeFile(path, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(path, 0o755);
  return path;
}
/** A figure converter that writes a stand-in PDF (the stand-in engines never read it). */
const stubConvert = (): Promise<Uint8Array> =>
  Promise.resolve(new TextEncoder().encode("%PDF-1.4 fake"));

/** The real figure converter in the app is Chromium; here, when it is installed, rsvg-convert stands in for it. */
const RSVG = "/opt/homebrew/bin/rsvg-convert";
async function rsvgConvert(svg: string): Promise<Uint8Array> {
  const { execFile } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "lucid-svg-"));
  await writeFile(join(dir, "in.svg"), svg, "utf8");
  await new Promise<void>((resolve, reject) => {
    execFile(RSVG, ["-f", "pdf1.4", "-o", join(dir, "out.pdf"), join(dir, "in.svg")], (e) => {
      if (e) reject(new Error(e.message));
      else resolve();
    });
  });
  return new Uint8Array(await readFile(join(dir, "out.pdf")));
}

async function compiler(
  tectonicPath: string,
  convertSvg: PdfOptions["convertSvg"] = stubConvert,
  extra: Partial<PdfOptions> = {},
) {
  const workRoot = await mkdtemp(join(tmpdir(), "lucid-work-"));
  return {
    c: new PdfCompiler({
      workRoot,
      tectonicPath,
      convertSvg,
      author: "Asha",
      footerRight: "Footer text",
      timeoutMs: 20_000,
      ...extra,
    }),
    workRoot,
  };
}

describe("explainLatexError", () => {
  it.each([
    [
      "error: main.tex:7: Undefined control sequence",
      "A command in your text isn't understood by the PDF engine.",
    ],
    ["error: main.tex:3: Missing $ inserted", "A formula is missing a closing dollar sign."],
    [
      'error: lucid.sty:5: Package fontspec Error: The font "X" cannot be found.',
      "A font the PDF style needs isn't available.",
    ],
    ["! Emergency stop", "Emergency stop"],
    [
      "something else entirely",
      "The PDF engine stopped without saying why. Open the log for details.",
    ],
    ["", "The PDF engine stopped without saying why. Open the log for details."],
  ])("%j", (log, expected) => {
    expect(explainLatexError(log)).toBe(expected);
  });
});

describe("explaining a missing PDF engine", () => {
  const log =
    "could not start /opt/Lucid/resources/bin/tectonic: spawn /opt/Lucid/resources/bin/tectonic ENOENT";
  it("suggests Homebrew on a Mac only", () => {
    expect(explainLatexError(log, "darwin")).toContain("brew install tectonic");
    for (const platform of ["linux", "win32"] as const) {
      const said = explainLatexError(log, platform);
      expect(said).not.toContain("brew");
      expect(said).toContain("tectonic-typesetting.github.io");
    }
  });

  it("names the engine whichever way the path is written", () => {
    const windows =
      "could not start C:\\Lucid\\resources\\bin\\tectonic.exe: spawn C:\\Lucid\\resources\\bin\\tectonic.exe ENOENT";
    expect(explainLatexError(windows, "win32")).toMatch(/^Tectonic, the PDF engine, was not found/);
  });
});

describe("explaining what went wrong on a first PDF", () => {
  it("says the first PDF needs the internet, when Tectonic could not fetch its files", () => {
    const log =
      "thread 'main' panicked at src/config.rs:154:18: this bundle isn't cached, and we couldn't get it from the internet. Error: error sending request for url (https://relay.example/default_bundle.tar.index.gz)";
    expect(explainLatexError(log)).toMatch(/needs the internet the first time/);
    expect(explainLatexError(log)).not.toMatch(/panicked|config\.rs/);
  });

  it("says the engine stopped responding, or took too long, and that what it fetched is kept", () => {
    expect(explainLatexError("error: the engine printed nothing for 90 s (stalled)")).toMatch(
      /stopped responding.*already downloaded is kept/,
    );
    expect(explainLatexError("error: the engine ran for more than 1800 s (too long)")).toMatch(
      /took too long.*already downloaded is kept/,
    );
  });
});

// The stand-in engines below are shell scripts, which Windows cannot start directly. There, the real engine is exercised
// by the packaged-app tests (a PDF with a diagram, the first-run download), so these describe blocks are skipped.
const shellScripts = process.platform === "win32" ? describe.skip : describe;

shellScripts("the first run, which downloads the typesetting files", () => {
  const downloads =
    'for i in 1 2 3 4 5 6; do echo "note: downloading f$i.sty"; sleep 0.4; done\necho "%PDF-1.5" > main.pdf';

  it("stops an engine that prints nothing, with a message a person can act on", async () => {
    const t = await script("exec sleep 30");
    const { c } = await compiler(t, stubConvert, { idleMs: 600 });
    const started = Date.now();
    const r = await c.compile(req("page-idle"));
    expect(r.ok).toBe(false);
    expect(messageOf(r)).toContain("stopped responding");
    expect(Date.now() - started).toBeLessThan(8_000);
  }, 30_000);

  it("lets an engine that keeps downloading run longer than the quiet limit", async () => {
    // Prints every 0.4 s for about 5 s. The quiet limit is 2 s, five times the interval, so a slow start of the script on a
    // busy machine (the whole suite runs in parallel) does not trip it.
    const t = await script(
      'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo "note: downloading f$i.sty"; sleep 0.4; done\necho "%PDF-1.5" > main.pdf',
    );
    const { c } = await compiler(t, stubConvert, { idleMs: 2_000 });
    const started = Date.now();
    const r = await c.compile(req("page-slow"));
    expect(r.ok).toBe(true);
    expect(Date.now() - started).toBeGreaterThan(2_800); // longer than the quiet limit, because it kept printing
  }, 30_000);

  it("stops an engine that runs for too long, however much it prints", async () => {
    const t = await script('while true; do echo "note: downloading x.sty"; sleep 0.1; done');
    const { c } = await compiler(t, stubConvert, { idleMs: 5_000, timeoutMs: 1_200 });
    const r = await c.compile(req("page-long"));
    expect(r.ok).toBe(false);
    expect(messageOf(r)).toContain("took too long");
  }, 30_000);

  it("reports how many files it has downloaded", async () => {
    const t = await script(downloads);
    const seen: PdfProgress[] = [];
    const { c } = await compiler(t, stubConvert, {
      onProgress: (p) => seen.push(p),
    });
    await c.compile(req("page-count"));
    expect(seen.map((p) => p.files)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seen.every((p) => p.phase === "pdf")).toBe(true);
  }, 30_000);

  it("prepares once, in the background, and not again", async () => {
    const t = await script(
      'echo run >> ../events.log\necho "note: downloading a.sty"\necho "%PDF-1.5" > main.pdf',
    );
    const seen: PdfProgress[] = [];
    const { c, workRoot } = await compiler(t, stubConvert, { onProgress: (p) => seen.push(p) });
    expect(await c.warmUp()).toBe("warmed");
    expect(await c.warmUp()).toBe("already");
    expect((await readFile(join(workRoot, "events.log"), "utf8")).trim().split("\n")).toEqual([
      "run",
    ]);
    expect(seen).toEqual([
      { phase: "warmup", files: 1 },
      { phase: "warmup", files: 0, done: true },
    ]);
  }, 30_000);

  it("makes a page asked for during the preparation wait for it, never two engines at once", async () => {
    const t = await script(
      'echo start >> ../events.log\nsleep 0.5\necho "%PDF-1.5" > main.pdf\necho end >> ../events.log',
    );
    const { c, workRoot } = await compiler(t);
    const preparing = c.warmUp();
    const page = await c.compile(req("page-wait"));
    await preparing;
    expect(page.ok).toBe(true);
    expect((await readFile(join(workRoot, "events.log"), "utf8")).trim().split("\n")).toEqual([
      "start",
      "end",
      "start",
      "end",
    ]);
  }, 30_000);

  it("reports a failed preparation in words, and tries again the next time", async () => {
    const t = await script(
      "echo run >> ../events.log\necho \"this bundle isn't cached, and we couldn't get it from the internet. Error: error sending request\" >&2\nexit 101",
    );
    const seen: PdfProgress[] = [];
    const { c, workRoot } = await compiler(t, stubConvert, { onProgress: (p) => seen.push(p) });
    expect(await c.warmUp()).toBe("failed");
    expect(seen.at(-1)).toMatchObject({ phase: "warmup", done: true });
    expect(seen.at(-1)?.message).toMatch(/needs the internet/);
    expect(existsSync(join(workRoot, "engine-ready"))).toBe(false);
    expect(await c.warmUp()).toBe("failed");
    expect((await readFile(join(workRoot, "events.log"), "utf8")).trim().split("\n")).toEqual([
      "run",
      "run",
    ]);
  }, 30_000);

  it("prepares with a page that has one of every kind of block", () => {
    const types = new Set(warmUpDoc().blocks.map((b) => b.type));
    for (const type of registry.specs.keys()) expect(types, type).toContain(type);
  });
});

shellScripts("PdfCompiler with stand-in tools", () => {
  it("reports an engine error in plain words and keeps the log", async () => {
    const t = await script('echo "error: main.tex:7: Undefined control sequence" >&2; exit 1');
    const { c } = await compiler(t);
    const r = await c.compile(req("page-1"));
    expect(r).toMatchObject({
      ok: false,
      message: "A command in your text isn't understood by the PDF engine.",
    });
    expect(logOf(r)).toContain("Undefined control sequence");
  });

  it("explains a missing tool instead of crashing", async () => {
    const { c } = await compiler("/nonexistent/tectonic");
    const r = await c.compile(req("page-2"));
    expect(r.ok).toBe(false);
    expect(logOf(r)).toContain("could not start");
  });

  it("cancels the compile in flight when a newer request for the same page arrives", async () => {
    const t = await script('sleep 3; echo "error: main.tex:1: slow" >&2; exit 1');
    const { c } = await compiler(t);
    const slow = c.compile(req("page-3", "first"));
    await new Promise((r) => setTimeout(r, 300));
    const fast = c.compile(req("page-3", "second"));
    expect(await slow).toEqual({ ok: false, cancelled: true });
    expect((await fast).ok).toBe(false); // the stand-in always fails; what matters is the first was cancelled
  }, 30_000);

  it("never starts the engine for a compile that was already replaced", async () => {
    // Five requests for the same page in a row: only the last one may run the engine, and never two at once.
    const t = await script(
      'echo start >> ../events.log\nsleep 0.2\necho "%PDF-1.5" > main.pdf\necho end >> ../events.log',
    );
    const { c, workRoot } = await compiler(t);
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => c.compile(req("page-5", `version ${String(n)}`))),
    );
    expect(results.slice(0, 4)).toEqual(
      Array.from({ length: 4 }, () => ({ ok: false, cancelled: true })),
    );
    expect(results[4]?.ok).toBe(true);
    expect(
      (await readFile(join(workRoot, "page-5", "..", "events.log"), "utf8")).trim().split("\n"),
    ).toEqual(["start", "end"]);
  }, 30_000);

  it("uses the author and footer set later, for the next PDF", async () => {
    const t = await script("exit 1");
    const { c, workRoot } = await compiler(t);
    await c.compile(req("page-6", "text"));
    const first = await readFile(join(workRoot, "page-6", "main.tex"), "utf8");
    expect(first).toContain("{Footer text}");
    expect(first).toContain("\\author{Asha}");
    c.setStyle({ author: "Asha & Co", footerRight: "Notes" });
    await c.compile(req("page-6", "text"));
    const next = await readFile(join(workRoot, "page-6", "main.tex"), "utf8");
    expect(next).toContain("lucidfooterright}{Notes}");
    expect(next).toContain("\\author{Asha \\& Co}");
  });

  it("sets the page in the look chosen in Settings, and the next PDF in a changed one", async () => {
    const t = await script("exit 1");
    const { c, workRoot } = await compiler(t);
    await c.compile(req("page-look", "text"));
    // No look was ever set: the house style, as it always was.
    expect(await readFile(join(workRoot, "page-look", "main.tex"), "utf8")).toContain(
      "\\documentclass{article}",
    );
    c.setStyle({
      author: "Asha",
      footerRight: "Notes",
      style: { ...DEFAULT_PDF_STYLE, paper: "a4", fontSize: 12, accent: "teal", font: "palatino" },
    });
    await c.compile(req("page-look", "text"));
    const tex = await readFile(join(workRoot, "page-look", "main.tex"), "utf8");
    expect(tex).toContain("\\documentclass[a4paper,12pt]{article}");
    expect(tex).toContain("\\setmainfont{texgyrepagella}");
    expect(tex).toContain("lucidaccent");
  });

  it("decides the paper from the country when the look says auto", async () => {
    const t = await script("exit 1");
    const make = async (country: string) => {
      const { c, workRoot } = await compiler(t, stubConvert, {
        style: DEFAULT_PDF_STYLE,
        country,
      });
      await c.compile(req(`page-${country}`, "text"));
      return readFile(join(workRoot, `page-${country}`, "main.tex"), "utf8");
    };
    expect(await make("US")).toContain("\\documentclass[letterpaper]{article}");
    expect(await make("IN")).toContain("\\documentclass[a4paper]{article}");
  });

  it("typesets with the person's own template, and with the built-in one when theirs does not work", async () => {
    // A stand-in engine that fails on a template with BROKEN in it, as LaTeX would on a mistake in the file.
    const t = await script(
      'if grep -q BROKEN lucid.sty; then echo "error: lucid.sty:3: Undefined control sequence" >&2; exit 1; fi\nprintf "%%PDF-1.4 fake" > main.pdf',
    );
    let mine: string | undefined = "% my template\n\\ProvidesPackage{lucid}";
    const { c, workRoot } = await compiler(t, stubConvert, {
      readTemplate: () => Promise.resolve(mine),
    });

    // Theirs works: it is the file the engine reads, and nothing is said about it.
    const ok = await c.compile(req("page-tpl"));
    expect(ok.ok).toBe(true);
    expect(await readFile(join(workRoot, "page-tpl", "lucid.sty"), "utf8")).toBe(mine);
    if (ok.ok) expect(ok.warnings).toEqual([]);

    // Theirs has a mistake: the PDF is made with the built-in one, and the person is told why.
    mine = "% BROKEN";
    const fallback = await c.compile(req("page-tpl"));
    expect(fallback.ok).toBe(true);
    if (fallback.ok) {
      expect(fallback.warnings.join(" ")).toContain("Your PDF template did not work");
      expect(fallback.warnings.join(" ")).toContain("built-in style");
    }
    expect(await readFile(join(workRoot, "page-tpl", "lucid.sty"), "utf8")).toBe(LUCID_STY);

    // None: the one that comes with Lucid.
    mine = undefined;
    await c.compile(req("page-tpl"));
    expect(await readFile(join(workRoot, "page-tpl", "lucid.sty"), "utf8")).toBe(LUCID_STY);
  });

  it("does not hide a failure that is the page's: the built-in template fails too", async () => {
    const t = await script('echo "error: main.tex:7: Undefined control sequence" >&2\nexit 1');
    const { c } = await compiler(t, stubConvert, { readTemplate: () => Promise.resolve("% mine") });
    const r = await c.compile(req("page-tpl2"));
    expect(r.ok).toBe(false);
    expect(messageOf(r)).toContain("isn't understood");
  });

  it("sets the page in its note format: the fields under the title, and no empty sections", async () => {
    const t = await script("exit 1");
    const { c, workRoot } = await compiler(t);
    const heading = (id: string, text: string) => ({
      id,
      type: "heading" as const,
      props: { level: 2 },
      content: [{ type: "text" as const, text, styles: {} }],
    });
    await c.compile({
      pageId: "page-7",
      title: "Q",
      doc: {
        blocks: [
          heading("a", "Goal and hypothesis"),
          {
            id: "p",
            type: "paragraph",
            props: {},
            content: [{ type: "text", text: "Does it?", styles: {} }],
          },
          heading("b", "Setup"),
        ],
      },
      figures: {},
      format: getFormat("benchmark"),
      info: { hardware: "M4 Max", source: "ignored" },
    });
    const tex = await readFile(join(workRoot, "page-7", "main.tex"), "utf8");
    expect(tex).toContain("\\lucidmeta{Hardware}{M4 Max}");
    expect(tex).not.toContain("ignored");
    expect(tex).toContain("{Goal and hypothesis}");
    expect(tex).not.toContain("{Setup}");
  });

  it("writes main.tex, the style and one work folder per page", async () => {
    const t = await script("exit 1");
    const { c, workRoot } = await compiler(t);
    await c.compile(req("page-4", "50% & $x$"));
    const files = await readdir(join(workRoot, "page-4"));
    expect(files).toEqual(expect.arrayContaining(["main.tex", "lucid.sty", "figures"]));
  });
});

// With Tectonic installed (and rsvg-convert standing in for the app's own figure converter) the real engine is used.
const realTools = ["/opt/homebrew/bin/tectonic", RSVG].every((p) => existsSync(p));
describe.skipIf(!realTools)("PdfCompiler with real Tectonic", () => {
  it("prepares with the page of every kind of block, which compiles into a real PDF", async () => {
    const { c, workRoot } = await compiler("/opt/homebrew/bin/tectonic", rsvgConvert, {
      timeoutMs: 600_000,
    });
    expect(await c.warmUp()).toBe("warmed");
    expect(existsSync(join(workRoot, "warm-up", "main.pdf"))).toBe(true);
    expect(await c.warmUp()).toBe("already");
  }, 700_000);

  it("makes a PDF with the page text, and a diagram figure from SVG", async () => {
    const { c } = await compiler("/opt/homebrew/bin/tectonic", rsvgConvert);
    const d = doc("The cache sits in front of the database.");
    d.blocks.push({
      id: "dg",
      type: "diagram",
      props: {
        graph: {
          type: "flowchart",
          direction: "LR",
          title: "Flow",
          nodes: [{ id: "a", label: "A", kind: "process", status: "normal" }],
          edges: [],
          groups: [],
          fragments: [],
        },
        caption: "Flow",
      },
    });
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60" fill="white" stroke="black"/><text x="10" y="35">A B</text></svg>';
    const r = await c.compile({
      pageId: "real-1",
      title: "KV cache",
      doc: d,
      figures: { dg: svg },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Buffer.from(r.pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(r.pdf.length).toBeGreaterThan(5000);
    // A second compile of the same page reuses the cached figure and still works.
    expect(
      (await c.compile({ pageId: "real-1", title: "KV cache", doc: d, figures: { dg: svg } })).ok,
    ).toBe(true);
  }, 300_000);

  it("sets a big figure at its own size, reaching into the margins, so its words are not squeezed", async () => {
    const { c, workRoot } = await compiler("/opt/homebrew/bin/tectonic", rsvgConvert);
    const d = doc("A wide figure.");
    d.blocks.push({
      id: "wide",
      type: "diagram",
      props: {
        graph: {
          type: "flowchart",
          direction: "LR",
          title: "Wide",
          nodes: [{ id: "a", label: "A", kind: "process", status: "normal" }],
          edges: [],
          groups: [],
          fragments: [],
        },
        caption: "Wide",
      },
    });
    // 1200 px (900 pt) wide, with a 16 px word: squeezed into the text width (345 pt) it would be about 4.4 pt high.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300" width="100%"><rect width="1200" height="300" fill="white" stroke="black"/><text x="40" y="150" font-size="16" font-family="Helvetica">WIDEWORD</text></svg>';
    const r = await c.compile({ pageId: "wide-1", title: "Wide", doc: d, figures: { wide: svg } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tex = await readFile(join(workRoot, "wide-1", "main.tex"), "utf8");
    expect(tex).toContain("\\setlength{\\lucidfigw}{900.0pt}");
    expect(tex).toContain("\\makebox[\\linewidth][c]{\\includegraphics[width=\\lucidfigw");
    // The word on the page: its box is as high as the figure's scale makes it (about 6 pt at 1.3 times the text width, about 4.6 pt squeezed into the text width).
    const pdfPath = join(workRoot, "wide-bbox.pdf");
    await writeFile(pdfPath, r.pdf);
    const { execFileSync } = await import("node:child_process");
    const bbox = execFileSync("/opt/homebrew/bin/pdftotext", ["-bbox", pdfPath, "-"], {
      encoding: "utf8",
    });
    const word = /yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">WIDEWORD</.exec(bbox);
    expect(word).toBeTruthy();
    expect(Number(word?.[2]) - Number(word?.[1])).toBeGreaterThan(5.5);
  }, 300_000);

  it("does not blow a small narrow figure up to the width of the page", async () => {
    const { c, workRoot } = await compiler("/opt/homebrew/bin/tectonic", rsvgConvert);
    const d = doc("A small figure.");
    d.blocks.push({
      id: "narrow",
      type: "diagram",
      props: {
        graph: {
          type: "flowchart",
          direction: "TB",
          title: "Narrow",
          nodes: [{ id: "a", label: "A", kind: "process", status: "normal" }],
          edges: [],
          groups: [],
          fragments: [],
        },
        caption: "Narrow",
      },
    });
    // 200 x 300 px (150 x 225 pt) with a 16 px word. Enlarged to 0.85 of the text width the word would be 20.6 pt high, at most
    // one and a half times the size 15.8 pt; kept below 45% of the text height (about 13 pt).
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="100%"><rect width="200" height="300" fill="white" stroke="black"/><text x="20" y="150" font-size="16" font-family="Helvetica">NARROWWORD</text></svg>';
    const r = await c.compile({ pageId: "narrow-1", title: "N", doc: d, figures: { narrow: svg } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pdfPath = join(workRoot, "narrow-bbox.pdf");
    await writeFile(pdfPath, r.pdf);
    const { execFileSync } = await import("node:child_process");
    const bbox = execFileSync("/opt/homebrew/bin/pdftotext", ["-bbox", pdfPath, "-"], {
      encoding: "utf8",
    });
    const word = /yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">NARROWWORD</.exec(bbox);
    expect(word).toBeTruthy();
    const height = Number(word?.[2]) - Number(word?.[1]);
    expect(height).toBeGreaterThan(11);
    expect(height).toBeLessThan(14.5);
  }, 300_000);

  it("compiles a page with awkward text and an empty page", async () => {
    const { c } = await compiler("/opt/homebrew/bin/tectonic", rsvgConvert);
    expect(await c.compile(req("real-2", "100% of $5 & {x} _y_ ~ ^ \\ café → ✓"))).toMatchObject({
      ok: true,
    });
    expect(
      await c.compile({ pageId: "real-3", title: "Empty", doc: { blocks: [] }, figures: {} }),
    ).toMatchObject({ ok: true });
  }, 300_000);
});

describe("the natural width of a figure", () => {
  it("is read from its viewBox, in points (a pixel is three quarters of a point)", () => {
    expect(
      svgWidthsInPoints({
        a: '<svg xmlns="x" width="100%" viewBox="0 0 800 200"><g/></svg>',
        b: '<svg viewBox="0 0 1200.5 10">',
        none: '<svg width="200" height="60"></svg>',
        text: "not an svg",
      }),
    ).toEqual({ a: 600, b: 900.375 });
  });
});

shellScripts("tools that are not installed", () => {
  it("says what is missing and how to install it, in plain words", async () => {
    const { c } = await compiler("/nonexistent/tectonic");
    const r = await c.compile(req("page-8"));
    expect(r.ok).toBe(false);
    const message = !r.ok && !r.cancelled ? r.message : "";
    expect(message).toContain("Tectonic, the PDF engine, was not found");
    expect(message).toContain(
      process.platform === "darwin" ? "brew install tectonic" : "tectonic-typesetting.github.io",
    );
    expect(message).toContain("Markdown export still works");
    expect(
      explainLatexError("error: could not start /opt/x/other: spawn /opt/x/other ENOENT"),
    ).toBe("/opt/x/other was not found.");
  });

  it("still makes the PDF when a figure cannot be drawn into it, and says so", async () => {
    // The engine stand-in writes a PDF; the figure converter fails.
    const t = await script('printf "%%PDF-1.4 fake" > main.pdf');
    const { c } = await compiler(t, () => Promise.reject(new Error("no")));
    const diagram = registry.get("diagram").fixtures[0];
    if (!diagram) throw new Error("no diagram fixture");
    const r = await c.compile({
      pageId: "page-9",
      title: "T",
      doc: { blocks: [diagram] },
      figures: { [diagram.id]: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' },
    });
    expect(r.ok).toBe(true);
    const warnings = r.ok ? r.warnings : [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("could not be drawn into the PDF");
  });

  it("uses the converter it was given, once for a figure that did not change", async () => {
    const t = await script('printf "%%PDF-1.4 fake" > main.pdf');
    let calls = 0;
    const { c } = await compiler(t, () => {
      calls++;
      return stubConvert();
    });
    const diagram = registry.get("diagram").fixtures[0];
    if (!diagram) throw new Error("no diagram fixture");
    const request = {
      pageId: "page-11",
      title: "T",
      doc: { blocks: [diagram] },
      figures: { [diagram.id]: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>' },
    };
    await c.compile(request);
    await c.compile(request);
    expect(calls).toBe(1);
    await c.compile({ ...request, figures: { [diagram.id]: '<svg viewBox="0 0 20 20"/>' } });
    expect(calls).toBe(2);
  });

  it("has no warnings when everything is there", async () => {
    const t = await script('printf "%%PDF-1.4 fake" > main.pdf');
    const { c } = await compiler(t);
    const r = await c.compile(req("page-10"));
    expect(r.ok && r.warnings).toEqual([]);
  });
});
