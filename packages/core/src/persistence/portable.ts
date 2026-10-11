import { newId } from "../model/ids";
import { parseLucidFile, type LucidFile } from "./format";

/**
 * A note as a file to keep, move to another computer or hand to someone, and back in again. The note's own file already is
 * the whole note (the notes, what was said, the history with its way back), so export is that file, and import reads it with
 * the same checks as every page (`parseLucidFile`: older files are upgraded, newer or damaged ones are refused in words).
 */

export interface ExportOptions {
  /** Include what was said and the history of changes. Without it the note is only its notes (and its title and fields). */
  history: boolean;
}

/** The note as it is written to the file; the note it was made from is not changed. */
export function toExport(file: LucidFile, options: ExportOptions): LucidFile {
  return options.history ? file : { ...file, transcripts: [], changeLog: [] };
}

export interface ImportPlan {
  file: LucidFile;
  /** The same note was here already: this one is a copy with a new id, and the original is left alone. */
  copy: boolean;
}

/**
 * What to do with a file that was read: validate it, and keep it as it is when it is new here. A note with the id of one
 * that is here is imported as a copy (a new id, "(copy)" in the title) so that nothing is ever overwritten. Throws
 * `LucidFileError` with a message for a person when the file cannot be used.
 */
export function planImport(
  raw: unknown,
  existingIds: ReadonlySet<string>,
  ids: () => string = newId,
): ImportPlan {
  const file = parseLucidFile(raw);
  if (!existingIds.has(file.id)) return { file, copy: false };
  let id = ids();
  while (existingIds.has(id)) id = ids();
  return { file: { ...file, id, title: `${file.title} (copy)` }, copy: true };
}
