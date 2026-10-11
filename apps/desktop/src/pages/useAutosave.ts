import type { ChangeEntry, LucidDoc, LucidFile, TranscriptEntry } from "@lucid/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "saved" | "saving" | "error";
const QUIET_MS = 600;
const RETRY_MS = 5000;

/** What the page keeps besides its identity: edited by the user and by the model. */
export interface PageState {
  title: string;
  doc: LucidDoc;
  transcripts: TranscriptEntry[];
  changeLog: ChangeEntry[];
  /** The note format (a kit format id) and the values for its fields under the title. */
  format: string | undefined;
  info: Record<string, string>;
}

/**
 * Saves the page shortly after the user stops typing, and straight away when the page is closed or the
 * window goes away. The library writes atomically, so a crash never leaves a half-written file.
 */
export function useAutosave(file: LucidFile, page: PageState, onSaved: (f: LucidFile) => void) {
  const [state, setState] = useState<SaveState>("saved");
  const persisted = useRef(file);
  const latest = useRef(page);
  latest.current = page;
  const dirty = useRef(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const version = useRef(0);

  /** The page as it is now, as the file that is saved (also what an export is made from). */
  const snapshot = useCallback((): LucidFile => {
    const { title, doc, transcripts, changeLog, format, info } = latest.current;
    const { format: _was, ...meta } = persisted.current.meta;
    return {
      ...persisted.current,
      title: title.trim().length > 0 ? title.trim() : "Untitled",
      doc,
      transcripts: transcripts.slice(-2000),
      changeLog: changeLog.slice(-300),
      meta: { ...meta, info, ...(format === undefined ? {} : { format }) },
      updatedAt: new Date().toISOString(),
    };
  }, []);

  const flush = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    const mine = version.current;
    const next = snapshot();
    try {
      const written = await window.lucid.pages.save(next);
      persisted.current = written;
      onSavedRef.current(written);
      if (mine === version.current) setState("saved");
    } catch {
      dirty.current = true;
      setState("error");
    }
  }, [snapshot]);

  useEffect(() => {
    const was = persisted.current;
    if (
      page.title === was.title &&
      page.doc === was.doc &&
      page.transcripts === was.transcripts &&
      page.changeLog === was.changeLog &&
      page.format === was.meta.format &&
      page.info === was.meta.info
    )
      return;
    version.current++;
    dirty.current = true;
    setState("saving");
    const timer = setTimeout(() => void flush(), QUIET_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [page.title, page.doc, page.transcripts, page.changeLog, page.format, page.info, flush]);

  // A save that failed (the disk is full, the folder is not writable) is tried again every few seconds, with the changes
  // kept in memory, so nothing is lost when the problem goes away.
  useEffect(() => {
    if (state !== "error") return;
    const timer = setInterval(() => {
      void flush();
    }, RETRY_MS);
    return () => {
      clearInterval(timer);
    };
  }, [state, flush]);

  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const onHide = () => void flush();
    // Closing the window while the last changes could not be saved asks first (the main process shows the question).
    const onClose = (e: BeforeUnloadEvent) => {
      void flush();
      if (stateRef.current === "error") e.preventDefault();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onClose);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onClose);
      void flush();
    };
  }, [flush]);

  return { state, retry: flush, snapshot };
}
