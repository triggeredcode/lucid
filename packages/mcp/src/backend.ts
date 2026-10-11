import { applyPatch, type BlockPatch, type LucidDoc } from "@lucid/core";
import { getFormat, skeleton } from "@lucid/kit";

export interface PageInfo {
  id: string;
  title: string;
  updatedAt: string;
}

export interface PageState {
  id: string;
  title: string;
  doc: LucidDoc;
  /** The note format of the page (a format id), if it has one. */
  format?: string | undefined;
  /** The page is the one open in the Lucid window (the document is then what the editor holds right now). */
  open: boolean;
}

/** What one agent change is called in the page's change history. */
export interface ChangeNote {
  summary: string;
  /** `agent:<name>` */
  source: string;
  /** Ids of the blocks created or changed. */
  affected: string[];
}

/** A PDF made from a page and saved in the library's exports folder. */
export interface PdfExport {
  /** Absolute path of the PDF file. */
  path: string;
  bytes: number;
  /** Things that did not go as hoped (for example, diagrams left out because a tool is missing). */
  warnings: string[];
}

/**
 * What the tools need from Lucid. The running app implements it over a local socket; tests use `MemoryBackend`.
 * Whoever implements it makes sure a change to the open page is ONE undo step in the editor.
 */
export interface Backend {
  listPages(): Promise<PageInfo[]>;
  /** The page with this id, or the page open in the app when no id is given. */
  getPage(id?: string): Promise<PageState>;
  applyPatch(id: string, patch: BlockPatch, note: ChangeNote): Promise<{ doc: LucidDoc }>;
  /** A new page, blank or of a note format (a format id); the app lists it at once. */
  createPage(title: string, format?: string): Promise<{ id: string; title: string }>;
  /** Typesets the page (this one, or the open page) as a PDF in the house style and saves it; the page is not changed. */
  exportPdf(id?: string): Promise<PdfExport>;
}

export class BackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendError";
  }
}

/** Pages held in memory: for tests, and a reference for what a backend must do. */
export class MemoryBackend implements Backend {
  readonly changes: (ChangeNote & { pageId: string })[] = [];
  /** The pages "exported" so far (the memory backend makes no file). */
  readonly exports: string[] = [];
  private openId: string | undefined;

  constructor(
    private readonly pages: Map<
      string,
      { title: string; doc: LucidDoc; updatedAt?: string; format?: string }
    > = new Map(),
  ) {}

  add(id: string, title: string, doc: LucidDoc, open = false): this {
    this.pages.set(id, { title, doc, updatedAt: "2026-10-11T00:00:00.000Z" });
    if (open) this.openId = id;
    return this;
  }

  listPages(): Promise<PageInfo[]> {
    return Promise.resolve(
      [...this.pages].map(([id, p]) => ({
        id,
        title: p.title,
        updatedAt: p.updatedAt ?? "2026-10-11T00:00:00.000Z",
      })),
    );
  }

  getPage(id?: string): Promise<PageState> {
    const key = id ?? this.openId;
    if (key === undefined)
      return Promise.reject(new BackendError("No page is open in Lucid. Pass a page_id."));
    const page = this.pages.get(key);
    if (!page) return Promise.reject(new BackendError(`There is no page "${key}".`));
    return Promise.resolve({
      id: key,
      title: page.title,
      doc: page.doc,
      format: page.format,
      open: key === this.openId,
    });
  }

  applyPatch(id: string, patch: BlockPatch, note: ChangeNote): Promise<{ doc: LucidDoc }> {
    const page = this.pages.get(id);
    if (!page) return Promise.reject(new BackendError(`There is no page "${id}".`));
    page.doc = applyPatch(page.doc, patch);
    this.changes.push({ ...note, pageId: id });
    return Promise.resolve({ doc: page.doc });
  }

  createPage(title: string, format?: string): Promise<{ id: string; title: string }> {
    const f = getFormat(format);
    if (format !== undefined && !f)
      return Promise.reject(new BackendError(`There is no format "${format}".`));
    const id = `page-${String(this.pages.size + 1)}`;
    this.pages.set(id, {
      title,
      doc: { blocks: f ? skeleton(f) : [] },
      updatedAt: "2026-10-11T00:00:00.000Z",
      ...(f ? { format: f.id } : {}),
    });
    return Promise.resolve({ id, title });
  }

  async exportPdf(id?: string): Promise<PdfExport> {
    const page = await this.getPage(id);
    this.exports.push(page.id);
    return { path: `/library/exports/${page.title}.pdf`, bytes: 52_000, warnings: [] };
  }
}
