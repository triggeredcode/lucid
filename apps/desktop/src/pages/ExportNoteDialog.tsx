import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";

interface Props {
  title: string;
  /** What was said and the changes the note has (to say what the file will hold). */
  said: number;
  changes: number;
  onClose: () => void;
  onExport: (history: boolean) => void;
}

/** Export a note as one file: the whole note with what was said and its history, or only the notes. */
export function ExportNoteDialog({ title, said, changes, onClose, onExport }: Props) {
  const [history, setHistory] = useState(true);
  const go = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    go.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal export-note-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Export note"
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        <header>
          <h2>Export note</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <p>
          Saves <b>{title.trim() || "Untitled"}</b> as one file (<code>.lucid</code>) that you can
          keep as a backup, move to another computer or hand to someone. <b>Import Note…</b> brings
          it back in, and never overwrites a note.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={history}
            onChange={(e) => {
              setHistory(e.target.checked);
            }}
          />
          <span>Include what I said and the change history</span>
        </label>
        <small className="check-note">
          {history
            ? `The file holds everything: the notes, ${String(said)} thing${said === 1 ? "" : "s"} you said, and ${String(changes)} change${changes === 1 ? "" : "s"} in the history (Revert still works on the newest).`
            : "Only the notes, the title and the fields under it. What you said and the history stay with you: your dictation can hold things you do not want to hand out."}
        </small>
        <footer>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            ref={go}
            type="button"
            className="primary"
            onClick={() => {
              onExport(history);
            }}
          >
            Export…
          </button>
        </footer>
      </div>
    </div>
  );
}
