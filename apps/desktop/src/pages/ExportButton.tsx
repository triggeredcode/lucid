import { Icon } from "../ui/Icon";
import { baseName, keys } from "../platform";
import { useEffect, useRef, useState } from "react";
import { makePdf, pdfFileName } from "../preview/exportPdf";
import { docToMarkdown } from "@lucid/kit";
import type { LucidDoc, LucidFile } from "@lucid/core";
import type { PdfProgress } from "../../electron/ipc/types";
import { ExportNoteDialog } from "./ExportNoteDialog";

interface Props {
  pageId: string;
  title: string;
  doc: LucidDoc;
  /** The page's note format and the values for its fields under the title. */
  format?: string | undefined;
  info?: Record<string, string> | undefined;
  /** The page as the file that is saved, with what was said and its history (for "Export note"). */
  getNote: () => LucidFile;
  said: number;
  changes: number;
  /** Lets the page start an export (the voice commands "export PDF" and "export Markdown", the File menu). */
  register?:
    ((start: { pdf: () => void; markdown: () => void; note: () => void }) => void) | undefined;
}

/** What went wrong, without the "Error invoking remote method ..." that Electron puts in front. */
const plain = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']*': (?:Error: )?/,
    "",
  );

/** Makes the real PDF (or the Markdown) of the page on request, asks where to save it, and offers to open the PDF. */
export function ExportButton({
  pageId,
  title,
  doc,
  format,
  info,
  getNote,
  said,
  changes,
  register,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState<
    { kind: "saved" | "error"; text: string; path?: string } | undefined
  >();
  const latest = useRef({ pageId, title, doc, format, info });
  latest.current = { pageId, title, doc, format, info };

  // The first PDF on a computer downloads its typesetting files (minutes, once): say so, with a count, instead of a silent wait.
  const [engine, setEngine] = useState<PdfProgress | undefined>();
  const sawPreparing = useRef(false);
  useEffect(() => {
    let alive = true;
    void window.lucid.pdf.status().then((p) => {
      if (alive && p) setEngine(p);
    });
    const off = window.lucid.pdf.onProgress((p) => {
      if (p.phase === "warmup" && !p.done) sawPreparing.current = true;
      setEngine(p);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  const preparing = engine?.phase === "warmup" && engine.done !== true;
  const engineNote = preparing
    ? `Getting the PDF engine ready (first time only, needs the internet)${
        engine.files > 0 ? `: ${String(engine.files)} files` : ""
      }…`
    : busy && engine?.phase === "pdf" && engine.files > 0
      ? `Downloading typesetting files (first time only): ${String(engine.files)}…`
      : undefined;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setNote(undefined);
    try {
      const { pageId: id, title: name, doc: current, format: kind, info: fields } = latest.current;
      const made = await makePdf(id, name, current, { format: kind, info: fields });
      if (!made.ok) {
        setNote({ kind: "error", text: `The PDF couldn’t be made. ${made.message}` });
        return;
      }
      const path = await window.lucid.pdf.save(made.pdf, pdfFileName(name));
      if (path) {
        const warning = made.warnings.length > 0 ? ` ${made.warnings.join(" ")}` : "";
        setNote({ kind: "saved", text: `Saved ${baseName(path)}.${warning}`, path });
      }
    } finally {
      setBusy(false);
    }
  };
  const runMarkdown = async () => {
    if (busy) return;
    setNote(undefined);
    const { title: name, doc: current } = latest.current;
    const path = await window.lucid.file.saveMarkdown(
      docToMarkdown(current, { title: name }),
      pdfFileName(name).replace(/\.pdf$/, ".md"),
    );
    if (path) setNote({ kind: "saved", text: `Saved ${baseName(path)}` });
  };
  const runNote = async (history: boolean) => {
    setNoteOpen(false);
    setNote(undefined);
    try {
      const path = await window.lucid.note.export(getNote(), { history });
      if (path) setNote({ kind: "saved", text: `Saved ${baseName(path)}.` });
    } catch (error) {
      setNote({ kind: "error", text: `The note couldn’t be exported. ${plain(error)}` });
    }
  };
  const runRef = useRef({ run, runMarkdown });
  runRef.current = { run, runMarkdown };
  useEffect(() => {
    register?.({
      pdf: () => {
        void runRef.current.run();
      },
      markdown: () => {
        void runRef.current.runMarkdown();
      },
      note: () => {
        setNoteOpen(true);
      },
    });
  }, [register]);

  // The preparation ended: say it once if the person saw it run, or say why it did not work.
  useEffect(() => {
    if (engine?.phase !== "warmup" || engine.done !== true) return;
    if (engine.message) {
      setNote({ kind: "error", text: engine.message });
    } else if (sawPreparing.current) {
      sawPreparing.current = false;
      setNote({ kind: "saved", text: "The PDF engine is ready." });
    }
  }, [engine]);

  useEffect(() => {
    if (note?.kind !== "saved") return;
    const timer = setTimeout(() => {
      setNote(undefined);
    }, 12000);
    return () => {
      clearTimeout(timer);
    };
  }, [note]);

  return (
    <div className="export">
      {engineNote && (
        <span className="export-note" data-kind="busy" role="status">
          {engineNote}
        </span>
      )}
      {!engineNote && note && (
        <span className="export-note" data-kind={note.kind} role="status">
          {note.text}
          {note.path && (
            <>
              {" "}
              <button
                type="button"
                className="link"
                onClick={() => {
                  if (note.path) void window.lucid.pdf.open(note.path);
                }}
              >
                Open
              </button>
            </>
          )}
        </span>
      )}
      <button
        className="ghost small"
        type="button"
        title={keys("Save this note as a file, with what you said and its history (⇧⌘E)")}
        onClick={() => {
          setNoteOpen(true);
        }}
      >
        <Icon name="upload" /> <span className="btn-text">Export note</span>
      </button>
      <button
        className="ghost small"
        type="button"
        title="Save the page as a Markdown file"
        onClick={() => void runMarkdown()}
        disabled={busy}
      >
        <Icon name="markdown" /> <span className="btn-text">Markdown</span>
      </button>
      <button className="primary" type="button" onClick={() => void run()} disabled={busy}>
        <Icon name="download" /> {busy ? "Making PDF…" : "Download PDF"}
      </button>
      {noteOpen && (
        <ExportNoteDialog
          title={title}
          said={said}
          changes={changes}
          onClose={() => {
            setNoteOpen(false);
          }}
          onExport={(history) => void runNote(history)}
        />
      )}
    </div>
  );
}
