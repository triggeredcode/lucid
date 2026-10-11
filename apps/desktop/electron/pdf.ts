import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LUCID_STY, registry, renderDocument, type Format } from "@lucid/kit";
import type { LucidDoc } from "@lucid/core";
import type { PdfProgress } from "./ipc/types";

export type { PdfProgress };

/**
 * Compiles a page to a PDF with Tectonic . Diagrams and charts arrive
 * as SVG (rendered by the app from Mermaid), are converted to vector PDF (by the converter the app gives it: Electron's own
 * Chromium) and cached by content. A newer
 * request for the same page cancels the one still running, so the preview never shows stale work.
 */

export interface CompileRequest {
  pageId: string;
  title: string;
  doc: LucidDoc;
  /** Block id to SVG text for every diagram and chart in the page. */
  figures: Record<string, string>;
  /** The page's note format and the values for its fields under the title. */
  format?: Format | undefined;
  info?: Record<string, string> | undefined;
}

export type CompileResult =
  | { ok: true; pdf: Uint8Array; ms: number; warnings: string[] }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; message: string; log: string };

export interface PdfOptions {
  workRoot: string;
  tectonicPath: string;
  /** One SVG drawing to a vector PDF page of the drawing's own size. */
  convertSvg: (svg: string) => Promise<Uint8Array>;
  author: string;
  footerRight: string;
  /** The longest a single engine run may take in all (default 30 minutes: a first start downloads for about six). */
  timeoutMs?: number;
  /** The longest the engine may print nothing before it is taken to be stuck (default 90 s). */
  idleMs?: number;
  onProgress?: (progress: PdfProgress) => void;
}

interface Running {
  proc?: ChildProcess;
  cancelled: boolean;
  /** Settles once this compile has stopped touching the page's folder. */
  done?: Promise<unknown>;
}

/** The natural height of each figure in points (1 px of the drawing is 0.75 pt), from its viewBox. */
export function svgHeightsInPoints(
  figures: Readonly<Record<string, string>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, svg] of Object.entries(figures)) {
    const m = /<svg\b[^>]*\bviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+[\d.]+[\s,]+([\d.]+)\s*"/.exec(
      svg,
    );
    const height = Number(m?.[1]);
    if (Number.isFinite(height) && height > 0) out[id] = height * 0.75;
  }
  return out;
}

/** The natural width of each figure in points (1 px of the drawing is 0.75 pt), from its viewBox. */
export function svgWidthsInPoints(
  figures: Readonly<Record<string, string>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, svg] of Object.entries(figures)) {
    const m = /<svg\b[^>]*\bviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+[\d.]+\s*"/.exec(
      svg,
    );
    const width = Number(m?.[1]);
    if (Number.isFinite(width) && width > 0) out[id] = width * 0.75;
  }
  return out;
}

/** The first LaTeX error in words a person can act on, without file paths or engine jargon. */
export function explainLatexError(log: string): string {
  // A tool that is not installed, before anything about LaTeX.
  const missing = /could not start (\S+): spawn \S+ ENOENT/.exec(log);
  if (missing?.[1]) {
    const name = missing[1].split("/").pop() ?? missing[1];
    return name.includes("tectonic")
      ? `Tectonic, the PDF engine, was not found (${missing[1]}). Reinstall Lucid, or install it with: brew install tectonic. The Markdown export still works.`
      : `${missing[1]} was not found.`;
  }
  // The first PDF needs the internet once: the typesetting files are downloaded, then kept.
  if (
    /couldn't get it from the internet|error sending request|dns error|failed to (?:download|fetch)/i.test(
      log,
    )
  )
    return "The PDF engine needs the internet the first time it makes a PDF (it downloads its typesetting files once, then works offline). Check the connection and try again.";
  if (log.includes("(stalled)"))
    return "The PDF engine stopped responding. The first PDF downloads typesetting files from the internet; if the connection is slow or cut off, check it and try again: what was already downloaded is kept.";
  if (log.includes("(too long)"))
    return "The PDF took too long and was stopped. Try again: what the engine already downloaded is kept, so it goes faster.";
  const line = log.split("\n").find((l) => /^error:/.test(l) || /^! /.test(l));
  if (!line) return "The PDF engine stopped without saying why. Open the log for details.";
  const text = line.replace(/^error:\s*/, "").replace(/^!\s*/, "");
  const where = /main\.tex:(\d+):\s*(.*)$/.exec(text);
  const detail = where ? (where[2] ?? "") : text;
  const lower = detail.toLowerCase();
  if (lower.includes("undefined control sequence"))
    return "A command in your text isn't understood by the PDF engine.";
  if (lower.includes("missing $")) return "A formula is missing a closing dollar sign.";
  if (lower.includes("font") && lower.includes("cannot be found"))
    return "A font the PDF style needs isn't available.";
  if (lower.includes("file") && lower.includes("not found"))
    return `The PDF engine couldn't find a file: ${detail}`;
  return detail.length > 0 ? detail : "The PDF engine reported an error.";
}

interface RunLimits {
  /** Stop the program when it has printed nothing for this long. */
  idleMs: number;
  /** Stop it when it has run this long, whatever it prints. */
  maxMs: number;
  /** Each whole line it prints. */
  onLine?: (line: string) => void;
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  running: Running,
  limits: RunLimits,
): Promise<{ code: number | null; out: string }> {
  // A compile that was cancelled before it got here never starts its engine.
  if (running.cancelled) return Promise.resolve({ code: -2, out: "" });
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    running.proc = proc;
    let out = "";
    let partial = "";
    let stopped: string | undefined;
    const stop = (why: string) => {
      stopped = why;
      proc.kill("SIGKILL");
    };
    const watch = () =>
      setTimeout(() => {
        stop(
          `error: the engine printed nothing for ${String(Math.round(limits.idleMs / 1000))} s (stalled)`,
        );
      }, limits.idleMs);
    let idle = watch();
    const cap = setTimeout(() => {
      stop(
        `error: the engine ran for more than ${String(Math.round(limits.maxMs / 1000))} s (too long)`,
      );
    }, limits.maxMs);
    const feed = (d: Buffer) => {
      const text = d.toString();
      out += text;
      clearTimeout(idle);
      idle = watch();
      if (!limits.onLine) return;
      const lines = (partial + text).split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) limits.onLine(line);
    };
    proc.stdout.on("data", feed);
    proc.stderr.on("data", feed);
    const settle = () => {
      clearTimeout(idle);
      clearTimeout(cap);
    };
    proc.on("error", (error) => {
      settle();
      resolve({ code: -1, out: `${out}\nerror: could not start ${cmd}: ${error.message}` });
    });
    proc.on("close", (code) => {
      settle();
      if (partial) limits.onLine?.(partial);
      resolve({ code, out: stopped ? `${out}\n${stopped}` : out });
    });
  });
}

/** A page with one of every kind of block: making it fetches every typesetting file a real page can need. */
export function warmUpDoc(): LucidDoc {
  return {
    blocks: [...registry.specs.values()]
      .flatMap((spec) => spec.fixtures)
      .map((block) => registry.validateBlock(block)),
  };
}

/** Written in the work folder once the first PDF has been made, so the preparation is not repeated. */
const READY_FILE = "engine-ready";

export class PdfCompiler {
  private readonly inflight = new Map<string, Running>();
  private warming: Promise<unknown> | undefined;
  constructor(private readonly options: PdfOptions) {}

  /** Stops every engine that is running (the app is closing). */
  dispose(): void {
    for (const running of this.inflight.values()) {
      running.cancelled = true;
      running.proc?.kill("SIGKILL");
    }
  }

  /**
   * Makes a page of every kind of block once, so the typesetting files Tectonic downloads on first use are fetched in the
   * background, while the person is writing, instead of during their first Download PDF. It never throws: when the internet is
   * not there the next real PDF tries again and says what is wrong.
   */
  warmUp(): Promise<"warmed" | "already" | "failed"> {
    // Set at once, so a page made a moment later already waits for it.
    this.warming ??= this.prepare().finally(() => {
      this.warming = undefined;
    });
    return this.warming as Promise<"warmed" | "already" | "failed">;
  }

  private async prepare(): Promise<"warmed" | "already" | "failed"> {
    const marker = join(this.options.workRoot, READY_FILE);
    const ready = await readFile(marker, "utf8").catch(() => "");
    if (ready === this.options.tectonicPath) return "already";
    const running: Running = { cancelled: false };
    this.inflight.set("warm-up", running);
    const work = this.work(
      { pageId: "warm-up", title: "Warm-up", doc: warmUpDoc(), figures: {} },
      running,
      "warmup",
    );
    try {
      const result = await work;
      if (result.ok) {
        await writeFile(marker, this.options.tectonicPath, "utf8");
        this.options.onProgress?.({ phase: "warmup", files: 0, done: true });
        return "warmed";
      }
      if (!result.cancelled)
        this.options.onProgress?.({
          phase: "warmup",
          files: 0,
          done: true,
          message: result.message,
        });
      return "failed";
    } catch (error) {
      this.options.onProgress?.({
        phase: "warmup",
        files: 0,
        done: true,
        message: error instanceof Error ? error.message : String(error),
      });
      return "failed";
    } finally {
      this.inflight.delete("warm-up");
    }
  }

  /** The author and footer of PDFs made from now on (the Settings window changed them). */
  setStyle(style: { author: string; footerRight: string }): void {
    this.options.author = style.author;
    this.options.footerRight = style.footerRight;
  }

  async compile(req: CompileRequest): Promise<CompileResult> {
    // One engine at a time: it shares its download cache, so a page made during the preparation waits for it.
    await this.warming;
    const previous = this.inflight.get(req.pageId);
    const running: Running = { cancelled: false };
    this.inflight.set(req.pageId, running);
    if (previous) {
      // One engine at a time per page folder: stop the old compile and wait until it has let go of the files.
      previous.cancelled = true;
      previous.proc?.kill("SIGKILL");
      await previous.done;
    }
    if (running.cancelled) return { ok: false, cancelled: true };
    const work = this.work(req, running, "pdf");
    running.done = work.catch(() => undefined);
    try {
      return await work;
    } finally {
      if (this.inflight.get(req.pageId) === running) this.inflight.delete(req.pageId);
    }
  }

  private async work(
    req: CompileRequest,
    running: Running,
    phase: PdfProgress["phase"],
  ): Promise<CompileResult> {
    const started = Date.now();
    const limits: RunLimits = {
      idleMs: this.options.idleMs ?? 90_000,
      maxMs: this.options.timeoutMs ?? 30 * 60_000,
    };
    let files = 0;
    const counting: RunLimits = {
      ...limits,
      onLine: (line) => {
        if (!line.startsWith("note: downloading ")) return;
        files++;
        this.options.onProgress?.({ phase, files });
      },
    };
    try {
      const dir = join(this.options.workRoot, req.pageId.replace(/[^a-z0-9-]/gi, ""));
      await mkdir(join(dir, "figures"), { recursive: true });

      // 1. Figures: SVG to vector PDF, skipping the ones already converted from identical SVG.
      const figureWidths = svgWidthsInPoints(req.figures);
      const figureHeights = svgHeightsInPoints(req.figures);
      const first = renderDocument({
        title: req.title,
        doc: req.doc,
        author: this.options.author,
        footerRight: this.options.footerRight,
        format: req.format,
        info: req.info,
        figureWidths,
        figureHeights,
      });
      const rendered: Record<string, string> = {};
      const warnings: string[] = [];
      let unconverted = 0;
      for (const figure of first.figures) {
        const svg = req.figures[figure.blockId];
        if (svg === undefined) continue;
        const fixed = svg.replace("<svg ", '<svg xml:space="preserve" ');
        const hash = createHash("sha256").update(`chromium-pdf\n${fixed}`).digest("hex");
        const hashFile = `${join(dir, figure.file)}.hash`;
        const cached = await readFile(hashFile, "utf8").catch(() => "");
        if (cached !== hash) {
          try {
            const bytes = await this.options.convertSvg(fixed);
            if (running.cancelled) return { ok: false, cancelled: true };
            await writeFile(join(dir, figure.file), bytes);
            await writeFile(hashFile, hash, "utf8");
          } catch {
            // The page still compiles, with a placeholder for this figure.
            unconverted++;
            continue;
          }
        }
        rendered[figure.blockId] = figure.file;
      }

      // 2. The document itself.
      const { tex } = renderDocument(
        {
          title: req.title,
          doc: req.doc,
          author: this.options.author,
          footerRight: this.options.footerRight,
          format: req.format,
          info: req.info,
          figureWidths,
          figureHeights,
        },
        rendered,
      );
      await writeFile(join(dir, "lucid.sty"), LUCID_STY, "utf8");
      await writeFile(join(dir, "main.tex"), tex, "utf8");
      const result = await run(
        this.options.tectonicPath,
        ["-X", "compile", "main.tex", "--outdir", ".", "--keep-logs"],
        dir,
        running,
        counting,
      );
      if (running.cancelled) return { ok: false, cancelled: true };
      if (result.code !== 0)
        return { ok: false, message: explainLatexError(result.out), log: result.out };
      const pdf = await readFile(join(dir, "main.pdf"));
      if (unconverted > 0)
        warnings.push(
          `${String(unconverted)} diagram${unconverted === 1 ? "" : "s"} or chart${unconverted === 1 ? "" : "s"} could not be drawn into the PDF and show as empty boxes.`,
        );
      return { ok: true, pdf: new Uint8Array(pdf), ms: Date.now() - started, warnings };
    } catch (error) {
      if (running.cancelled) return { ok: false, cancelled: true };
      throw error;
    }
  }
}
