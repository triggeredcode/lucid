import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { LucidDocSchema, LucidFileError, parseLucidFile, slugify, toExport } from "@lucid/core";
import { EngineStatus } from "../engineStatus";
import { PdfCompiler } from "../pdf";
import { svgToPdf } from "../svgPdf";
import { resolveTectonic } from "../tools";
import { Library } from "../library";
import { SettingsError, loadSettings, saveSettings, type Settings } from "../settings";
import {
  TemplateError,
  loadTemplate,
  readCustomTemplate,
  resetTemplate,
  saveTemplate,
} from "../template";
import { getFormat } from "@lucid/kit";
import { serveBackend, socketPathFor } from "@lucid/mcp/socket";
import { AppBackend } from "../appBackend";
import { RendererBridge } from "../agentBridge";
import { lmLoad, lmStatus, type LmDeps } from "../lmstudio";
import { LMSTUDIO_DOWNLOAD, defaultLmsPath, findLmStudio } from "../studio";
import { checkLlmUrl, registerLlmIpc } from "./llm";
import { registerSecureAiIpc } from "./ai";
import {
  IPC,
  type NoteImportResult,
  type PublicSettings,
  type SettingsSaveResult,
  type TemplateSaveResult,
} from "./types";

/** Where pages live: LUCID_HOME (tests) or ~/Lucid. */
export const libraryDir = (): string => process.env["LUCID_HOME"] ?? join(homedir(), "Lucid");

export function registerIpc(): void {
  const savedPdfs = new Set<string>();
  ipcMain.handle(IPC.ping, () => "pong" as const);

  const library = (async () => {
    const dir = libraryDir();
    const settings = await loadSettings(dir);
    return new Library(dir, { trash: (p) => shell.trashItem(p), author: settings.author });
  })();
  // AI agents (Claude Code, a model in LM Studio's chat) reach the pages through the MCP server, which asks this socket.
  const bridge = new RendererBridge();
  void library.then(async (lib) => {
    try {
      const backend = new AppBackend({
        store: lib,
        bridge,
        pdf: {
          compile: async (request) => (await compiler).compile(request),
          // Kept in the library, in a folder of its own, so an agent can say where the PDF is.
          save: async (title, pdf) => {
            const dir = join(libraryDir(), "exports");
            await mkdir(dir, { recursive: true });
            const path = join(dir, `${slugify(title) || "page"}.pdf`);
            await writeFile(path, pdf);
            return path;
          },
        },
        changed: () => {
          for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send(IPC.pagesChanged);
          }
        },
      });
      const stop = await serveBackend(socketPathFor(libraryDir()), backend);
      app.once("will-quit", () => {
        void stop();
      });
    } catch (error) {
      console.error("The agent socket could not start:", error);
    }
  });
  ipcMain.handle(IPC.pagesList, async () => (await library).list());
  ipcMain.handle(IPC.pagesCreate, async (_e, title: unknown, options: unknown) => {
    const format = (options as { format?: unknown } | null | undefined)?.format;
    return (await library).create(
      typeof title === "string" && title.trim().length > 0 ? title : "Untitled",
      typeof format === "string" ? { format } : {},
    );
  });
  ipcMain.handle(IPC.pagesLoad, async (_e, id: unknown) => {
    if (typeof id !== "string") throw new Error("invalid page id");
    return (await library).load(id);
  });
  // Never trust the renderer: the page is validated before it is written.
  ipcMain.handle(IPC.pagesSave, async (_e, file: unknown) =>
    (await library).save(parseLucidFile(file)),
  );
  registerLlmIpc();
  registerSecureAiIpc(libraryDir());
  const lmDeps = async (): Promise<LmDeps> => {
    const s = await loadSettings(libraryDir());
    const baseUrl = process.env["LUCID_LLM_URL"] ?? s.llm.baseUrl;
    checkLlmUrl(`${baseUrl.replace(/\/+$/, "")}/v1/models`); // only LM Studio on this computer
    return {
      baseUrl,
      model: s.llm.model,
      contextLength: s.llm.contextLength,
      lms: process.env["LUCID_LMS_BIN"] ?? (s.llm.lmsPath || defaultLmsPath()),
      studioInstalled: () => findLmStudio() !== undefined,
    };
  };
  ipcMain.handle(IPC.lmStatus, async () => lmStatus(await lmDeps()));
  ipcMain.handle(IPC.lmLoad, async () => lmLoad(await lmDeps()));
  // "Open LM Studio" when it is installed, otherwise the page where it is downloaded.
  ipcMain.handle(IPC.lmOpenStudio, async () => {
    const found = findLmStudio();
    if (found) {
      await shell.openPath(found);
      return "opened" as const;
    }
    await shell.openExternal(LMSTUDIO_DOWNLOAD);
    return "download" as const;
  });
  // The preparation of the PDF engine: a window that opens after it began (or after it failed) asks for it.
  const engineStatus = new EngineStatus();
  const compiler = (async () => {
    const dir = libraryDir();
    const s = await loadSettings(dir);
    return new PdfCompiler({
      workRoot: join(dir, ".lucid", "build"),
      tectonicPath: resolveTectonic(s.tectonicPath, {
        // The programs that come with Lucid: in the app's resources when packaged, in apps/desktop/resources in development.
        resourcesDir: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources"),
      }),
      convertSvg: svgToPdf,
      author: s.author,
      footerRight: s.footerRight,
      style: s.pdf,
      country: app.getLocaleCountryCode(),
      readTemplate: () => readCustomTemplate(dir),
      onProgress: (progress) => {
        engineStatus.report(progress);
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.send(IPC.pdfProgress, progress);
        }
      },
    });
  })();
  // The first PDF downloads its typesetting files, which takes minutes: do it now, while the person is writing.
  void compiler.then((c) => {
    app.once("will-quit", () => {
      c.dispose();
    });
    if (process.env["LUCID_PDF_WARMUP"] !== "0") void c.warmUp();
  });
  ipcMain.handle(IPC.pdfStatus, () => engineStatus.read());
  // LUCID_LLM_URL points tests and development at another server (for example the fake LM Studio).
  const publicSettings = (s: Settings): PublicSettings => ({
    author: s.author,
    footerRight: s.footerRight,
    pdf: s.pdf,
    dictation: s.dictation,
    vocabulary: s.vocabulary,
    llm: {
      baseUrl: process.env["LUCID_LLM_URL"] ?? s.llm.baseUrl,
      model: s.llm.model,
      contextLength: s.llm.contextLength,
    },
    llmUrlLocked: process.env["LUCID_LLM_URL"] !== undefined,
  });
  ipcMain.handle(IPC.settingsGet, async () => publicSettings(await loadSettings(libraryDir())));
  ipcMain.handle(IPC.settingsSave, async (_e, input: unknown): Promise<SettingsSaveResult> => {
    try {
      // With the address fixed from the environment, keep the stored one whatever the window sends.
      const sent = input as { llm?: { baseUrl?: unknown } } | null;
      const locked = process.env["LUCID_LLM_URL"] !== undefined;
      const stored = await loadSettings(libraryDir());
      const checked =
        locked && sent?.llm
          ? { ...sent, llm: { ...sent.llm, baseUrl: stored.llm.baseUrl } }
          : input;
      const saved = await saveSettings(libraryDir(), checked);
      (await compiler).setStyle({
        author: saved.author,
        footerRight: saved.footerRight,
        style: saved.pdf,
      });
      (await library).setAuthor(saved.author);
      return { ok: true, settings: publicSettings(saved) };
    } catch (error) {
      if (error instanceof SettingsError) return { ok: false, problems: error.problems };
      throw error;
    }
  });
  ipcMain.handle(IPC.templateGet, () => loadTemplate(libraryDir()));
  ipcMain.handle(IPC.templateSave, async (_e, text: unknown): Promise<TemplateSaveResult> => {
    try {
      return { ok: true, template: await saveTemplate(libraryDir(), text) };
    } catch (error) {
      if (error instanceof TemplateError) return { ok: false, problems: error.problems };
      throw error;
    }
  });
  ipcMain.handle(IPC.templateReset, () => resetTemplate(libraryDir()));
  ipcMain.handle(IPC.pdfCompile, async (_e, req: unknown) => {
    const r = req as {
      pageId?: unknown;
      title?: unknown;
      doc?: unknown;
      figures?: unknown;
      format?: unknown;
      info?: unknown;
    };
    if (typeof r.pageId !== "string" || typeof r.title !== "string")
      throw new Error("invalid PDF request");
    const doc = LucidDocSchema.parse(r.doc);
    const figures: Record<string, string> = {};
    for (const [id, svg] of Object.entries((r.figures ?? {}) as Record<string, unknown>)) {
      if (typeof svg === "string" && svg.length < 5_000_000) figures[id] = svg;
    }
    const info: Record<string, string> = {};
    for (const [key, value] of Object.entries((r.info ?? {}) as Record<string, unknown>)) {
      if (typeof value === "string" && value.length <= 200) info[key] = value;
    }
    return (await compiler).compile({
      pageId: r.pageId,
      title: r.title,
      doc,
      figures,
      format: typeof r.format === "string" ? getFormat(r.format) : undefined,
      info,
    });
  });
  ipcMain.handle(IPC.pdfSave, async (_e, pdf: unknown, name: unknown) => {
    if (!(pdf instanceof Uint8Array)) throw new Error("invalid PDF data");
    const base = typeof name === "string" ? slugify(name.replace(/\.pdf$/i, "")) : "page";
    const chosen = await dialog.showSaveDialog({
      title: "Save PDF",
      defaultPath: join(app.getPath("downloads"), `${base}.pdf`),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (chosen.canceled || !chosen.filePath) return null;
    await writeFile(chosen.filePath, pdf);
    savedPdfs.add(chosen.filePath);
    return chosen.filePath;
  });
  // A note as a file to keep (the whole note, with what was said and the history, unless the person leaves them out).
  ipcMain.handle(IPC.noteExport, async (_e, file: unknown, options: unknown) => {
    const note = parseLucidFile(file);
    const history = (options as { history?: unknown } | null | undefined)?.history !== false;
    const chosen = await dialog.showSaveDialog({
      title: "Export note",
      defaultPath: join(app.getPath("downloads"), `${slugify(note.title) || "note"}.lucid`),
      filters: [{ name: "Lucid note", extensions: ["lucid"] }],
    });
    if (chosen.canceled || !chosen.filePath) return null;
    // Not into the library itself: a second file with the same id would be taken for the page.
    if (resolve(chosen.filePath).startsWith(resolve(libraryDir()) + sep))
      throw new Error(
        "Choose a folder outside your Lucid folder: the note is already saved in it as a page.",
      );
    await writeFile(
      chosen.filePath,
      `${JSON.stringify(toExport(note, { history }), null, 2)}\n`,
      "utf8",
    );
    return chosen.filePath;
  });
  ipcMain.handle(IPC.noteImport, async (): Promise<NoteImportResult | null> => {
    const chosen = await dialog.showOpenDialog({
      title: "Import note",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Lucid note", extensions: ["lucid"] }],
    });
    if (chosen.canceled || chosen.filePaths.length === 0) return null;
    const lib = await library;
    const result: NoteImportResult = { imported: [], problems: [] };
    for (const path of chosen.filePaths.slice(0, 50)) {
      try {
        if ((await stat(path)).size > 20_000_000)
          throw new LucidFileError("invalid", "This file is too big to be a note (over 20 MB).");
        let json: unknown;
        try {
          json = JSON.parse(await readFile(path, "utf8"));
        } catch {
          throw new LucidFileError("not_json_object", "This file is not a Lucid page.");
        }
        const { page, copy } = await lib.importNote(json);
        result.imported.push({ id: page.id, title: page.title, copy });
      } catch (error) {
        result.problems.push({
          fileName: basename(path),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return result;
  });
  ipcMain.handle(IPC.fileSaveText, async (_e, text: unknown, name: unknown) => {
    if (typeof text !== "string" || text.length > 20_000_000) throw new Error("invalid text");
    const base = typeof name === "string" ? slugify(name.replace(/\.md$/i, "")) : "page";
    const chosen = await dialog.showSaveDialog({
      title: "Save Markdown",
      defaultPath: join(app.getPath("downloads"), `${base}.md`),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (chosen.canceled || !chosen.filePath) return null;
    await writeFile(chosen.filePath, text, "utf8");
    return chosen.filePath;
  });
  // Only a PDF this session saved can be opened, so the renderer cannot make the app open arbitrary files.
  ipcMain.handle(IPC.pdfOpen, async (_e, path: unknown) => {
    if (typeof path !== "string" || !savedPdfs.has(path))
      throw new Error("not a PDF saved by Lucid");
    await shell.openPath(path);
  });
  ipcMain.handle(IPC.pagesTrash, async (_e, id: unknown) => {
    if (typeof id !== "string") throw new Error("invalid page id");
    await (await library).trash(id);
  });
}
