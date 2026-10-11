import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LucidFileError,
  createLucidFile,
  fileNameFor,
  parseLucidFile,
  planImport,
  type LucidFile,
} from "@lucid/core";
import { BlockValidationError, getFormat, registry, skeleton } from "@lucid/kit";

/**
 * The folder of saved pages (default ~/Lucid). One JSON file per page, named `<slug>--<id8>.lucid`. Writes are atomic
 * (temp file, then rename), a page that cannot be read is reported and never overwritten, and a backup of the previous
 * version is kept at most every five minutes per page (the last 50).
 */

export interface PageSummary {
  id: string;
  title: string;
  updatedAt: string;
  fileName: string;
  /** The note format of the page; none for a blank page. */
  format?: string;
}

const summaryOf = (f: LucidFile, fileName: string): PageSummary => ({
  id: f.id,
  title: f.title,
  updatedAt: f.updatedAt,
  fileName,
  ...(f.meta.format ? { format: f.meta.format } : {}),
});

export interface Problem {
  fileName: string;
  message: string;
}

export interface LibraryOptions {
  now?: () => Date;
  /** Move a file to the Trash (the app passes Electron's shell.trashItem). Never hard-deletes. */
  trash: (path: string) => Promise<void>;
  author?: string;
  backupEveryMs?: number;
  keepBackups?: number;
}

/** Backups are named with their time (`2026-10-10T10-00-00-000Z.lucid`); read it back. Unreadable names count as old. */
function backupTime(fileName: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(fileName);
  return m
    ? Date.parse(`${m[1] ?? ""}T${m[2] ?? ""}:${m[3] ?? ""}:${m[4] ?? ""}.${m[5] ?? ""}Z`)
    : 0;
}

export class Library {
  private readonly now: () => Date;
  constructor(
    readonly dir: string,
    private readonly options: LibraryOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /** The author written into pages created from now on. */
  setAuthor(author: string): void {
    this.options.author = author;
  }

  private path(fileName: string): string {
    return join(this.dir, fileName);
  }

  private async ensure(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private async lucidFiles(): Promise<string[]> {
    await this.ensure();
    // Only regular files: the `.lucid` folder inside holds backups and must never be read as a page.
    return (await readdir(this.dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".lucid"))
      .map((e) => e.name);
  }

  private async read(fileName: string): Promise<LucidFile> {
    const text = await readFile(this.path(fileName), "utf8");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LucidFileError("not_json_object", "This file is not a Lucid page.");
    }
    return parseLucidFile(json);
  }

  /** Newest first. Unreadable files are returned as problems, not hidden and not touched. */
  async list(): Promise<{ pages: PageSummary[]; problems: Problem[] }> {
    const pages: PageSummary[] = [];
    const problems: Problem[] = [];
    for (const fileName of await this.lucidFiles()) {
      try {
        const f = await this.read(fileName);
        pages.push(summaryOf(f, fileName));
      } catch (error) {
        problems.push({
          fileName,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    pages.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { pages, problems };
  }

  private async findFileName(id: string): Promise<string | undefined> {
    const short = id
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 8)
      .toLowerCase();
    for (const name of await this.lucidFiles()) {
      if (!name.endsWith(`--${short}.lucid`)) continue;
      try {
        if ((await this.read(name)).id === id) return name;
      } catch {
        // An unreadable file with a matching name is not ours to replace; keep looking.
      }
    }
    return undefined;
  }

  /** A new page; with a note format it starts as that format's section headings. */
  async create(title = "Untitled", options: { format?: string } = {}): Promise<LucidFile> {
    const format = getFormat(options.format);
    const file = createLucidFile({
      title,
      now: this.now,
      ...(format ? { doc: { blocks: skeleton(format) }, format: format.id } : {}),
      ...(this.options.author === undefined ? {} : { author: this.options.author }),
    });
    await this.write(fileNameFor(file), file);
    return file;
  }

  async load(id: string): Promise<LucidFile> {
    const name = await this.findFileName(id);
    if (!name) throw new Error("That page doesn't exist any more.");
    return this.read(name);
  }

  /** Save a page. The title decides the file name; when it changes the page moves to its new name. */
  async save(file: LucidFile): Promise<LucidFile> {
    const existing = await this.findFileName(file.id);
    const next: LucidFile = { ...file, updatedAt: this.now().toISOString() };
    const target = fileNameFor(next);
    if (existing) await this.backupIfDue(existing, file.id);
    await this.write(target, next);
    if (existing && existing !== target) await rm(this.path(existing), { force: true });
    return next;
  }

  /**
   * Brings in a note that was exported (the parsed JSON of its file). It is checked like every page, and so is each block in
   * it; nothing is written unless all of it is good. When the same note is already here the import is a copy with a new id
   * and the first one is left alone. Throws a `LucidFileError` with a message for a person.
   */
  async importNote(raw: unknown): Promise<{ page: PageSummary; copy: boolean }> {
    const existing = new Set((await this.list()).pages.map((p) => p.id));
    const { file, copy } = planImport(raw, existing);
    // Every block is checked, but the note is kept exactly as it was exported: nothing is rewritten, so the way back of its
    // history (which compares blocks) still fits.
    try {
      registry.validateDoc(file.doc);
    } catch (error) {
      if (!(error instanceof BlockValidationError)) throw error;
      throw new LucidFileError(
        "invalid",
        `This page is damaged: ${error.issues[0]?.message ?? "a block cannot be read"}`,
      );
    }
    const saved = await this.save(file);
    return {
      page: summaryOf(saved, fileNameFor(saved)),
      copy,
    };
  }

  async trash(id: string): Promise<void> {
    const name = await this.findFileName(id);
    if (name) await this.options.trash(this.path(name));
  }

  private async write(fileName: string, file: LucidFile): Promise<void> {
    await this.ensure();
    const tmp = this.path(`${fileName}.tmp`);
    await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(tmp, this.path(fileName));
  }

  private async backupIfDue(fileName: string, id: string): Promise<void> {
    const dir = join(this.dir, ".lucid", "backups", id.replace(/[^a-z0-9-]/gi, ""));
    await mkdir(dir, { recursive: true });
    const names = (await readdir(dir)).filter((n) => n.endsWith(".lucid")).sort();
    const last = names.at(-1);
    const every = this.options.backupEveryMs ?? 5 * 60_000;
    if (last) {
      const age = this.now().getTime() - backupTime(last);
      if (age < every) return;
    }
    const stamp = this.now().toISOString().replace(/[:.]/g, "-");
    await copyFile(this.path(fileName), join(dir, `${stamp}.lucid`));
    const keep = this.options.keepBackups ?? 50;
    const all = [...names, `${stamp}.lucid`];
    for (const old of all.slice(0, Math.max(0, all.length - keep)))
      await rm(join(dir, old), { force: true });
  }
}
