import { applyPatch, newId, type BlockPatch, type LucidDoc, type LucidFile } from "@lucid/core";
import { collectFigures, getFormat } from "@lucid/kit";
import {
  BackendError,
  type Backend,
  type ChangeNote,
  type PageInfo,
  type PageState,
  type PdfExport,
} from "@lucid/mcp";
import type { CompileRequest, CompileResult } from "./pdf";

/** What the app needs from its pages on disk. */
export interface PageStore {
  list(): Promise<{ pages: { id: string; title: string; updatedAt: string }[] }>;
  create(title: string, options?: { format?: string }): Promise<LucidFile>;
  load(id: string): Promise<LucidFile>;
  save(file: LucidFile): Promise<LucidFile>;
}

/** The page that is open in the window: it holds the live document, so it must make the edits. */
export interface OpenPage {
  id: string;
  title: string;
  /** The note format the window shows for the page (it may not be saved yet). */
  format?: string | undefined;
  /** The values of the format's fields, as the window shows them. */
  info?: Record<string, string> | undefined;
}

export interface Bridge {
  openPage(): Promise<OpenPage | undefined>;
  getDoc(): Promise<LucidDoc>;
  /** Draws the document's diagrams and charts in the window: block id to SVG. */
  figures(doc: LucidDoc): Promise<Record<string, string>>;
  /** Applies the patch as one undo step in the editor and records the change; resolves to the new document. */
  apply(patch: BlockPatch, note: ChangeNote): Promise<LucidDoc>;
}

/** The PDF engine, and where finished PDFs are kept. */
export interface PdfMaker {
  compile(request: CompileRequest): Promise<CompileResult>;
  /** Writes the PDF in the exports folder under a name made from the title; resolves to its path. */
  save(title: string, pdf: Uint8Array): Promise<string>;
}

export interface AppBackendDeps {
  store: PageStore;
  bridge: Bridge;
  pdf: PdfMaker;
  /** Pages changed on disk behind the window's back: it should list them again. */
  changed(): void;
  now?: () => Date;
}

/**
 * What an AI agent (through the MCP server) can do with pages. The page open in the window is read from and changed
 * through the editor (so the person sees it, can undo it, and the editor's own autosave never overwrites it); any other
 * page is changed on disk.
 */
export class AppBackend implements Backend {
  constructor(private readonly deps: AppBackendDeps) {}

  async listPages(): Promise<PageInfo[]> {
    const { pages } = await this.deps.store.list();
    return pages.map((p) => ({ id: p.id, title: p.title, updatedAt: p.updatedAt }));
  }

  async getPage(id?: string): Promise<PageState> {
    const open = await this.deps.bridge.openPage();
    const key = id ?? open?.id;
    if (key === undefined) throw new BackendError("No page is open in Lucid. Pass a page_id.");
    if (open && key === open.id)
      return {
        id: key,
        title: open.title,
        doc: await this.deps.bridge.getDoc(),
        format: open.format,
        open: true,
      };
    try {
      const file = await this.deps.store.load(key);
      return { id: key, title: file.title, doc: file.doc, format: file.meta.format, open: false };
    } catch {
      throw new BackendError(`There is no page "${key}".`);
    }
  }

  async exportPdf(id?: string): Promise<PdfExport> {
    const open = await this.deps.bridge.openPage();
    const key = id ?? open?.id;
    if (key === undefined) throw new BackendError("No page is open in Lucid. Pass a page_id.");
    let title: string;
    let doc: LucidDoc;
    let format: string | undefined;
    let info: Record<string, string>;
    if (open && key === open.id) {
      // What the window holds right now, which may not be saved yet.
      title = open.title;
      doc = await this.deps.bridge.getDoc();
      format = open.format;
      info = open.info ?? {};
    } else {
      try {
        const file = await this.deps.store.load(key);
        ({ title, doc } = file);
        format = file.meta.format;
        info = file.meta.info;
      } catch {
        throw new BackendError(`There is no page "${key}".`);
      }
    }
    // Only a page with diagrams or charts needs the window (Mermaid draws them there).
    const figures =
      collectFigures(doc.blocks).length > 0 ? await this.deps.bridge.figures(doc) : {};
    const made = await this.deps.pdf.compile({
      // Its own folder, so an agent's PDF never stops the preview or a download of the same page.
      pageId: `agent-${key}`,
      title,
      doc,
      figures,
      format: getFormat(format),
      info,
    });
    if (!made.ok)
      throw new BackendError(
        made.cancelled
          ? "Another PDF of this page was started, so this one was stopped. Try again."
          : made.message,
      );
    return {
      path: await this.deps.pdf.save(title, made.pdf),
      bytes: made.pdf.byteLength,
      warnings: made.warnings,
    };
  }

  async createPage(title: string, format?: string): Promise<{ id: string; title: string }> {
    if (format !== undefined && !getFormat(format))
      throw new BackendError(`There is no format "${format}".`);
    const file = await this.deps.store.create(title, format === undefined ? {} : { format });
    this.deps.changed();
    return { id: file.id, title: file.title };
  }

  async applyPatch(id: string, patch: BlockPatch, note: ChangeNote): Promise<{ doc: LucidDoc }> {
    const open = await this.deps.bridge.openPage();
    if (open && id === open.id) return { doc: await this.deps.bridge.apply(patch, note) };
    let file: LucidFile;
    try {
      file = await this.deps.store.load(id);
    } catch {
      throw new BackendError(`There is no page "${id}".`);
    }
    const doc = applyPatch(file.doc, patch);
    const now = (this.deps.now ?? (() => new Date()))().toISOString();
    await this.deps.store.save({
      ...file,
      doc,
      changeLog: [
        ...file.changeLog,
        {
          id: newId(),
          at: now,
          summary: note.summary,
          source: note.source,
          affected: note.affected,
          reverted: false,
        },
      ],
    });
    this.deps.changed();
    return { doc };
  }
}
