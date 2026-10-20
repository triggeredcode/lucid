import { useEffect, useRef, useState } from "react";
import type { PageBackup, PageProblem } from "../../electron/ipc/types";
import { Icon } from "../ui/Icon";

interface Props {
  pageId: string;
  title: string;
  onClose: () => void;
  onRestore: (backupId: string) => Promise<void>;
}

/** Lists Lucid's automatic snapshots and restores one safely as a separate page. */
export function BackupDialog({ pageId, title, onClose, onRestore }: Props) {
  const [backups, setBackups] = useState<PageBackup[]>([]);
  const [problems, setProblems] = useState<PageProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [restoring, setRestoring] = useState<string>();
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && restoring === undefined) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, restoring]);

  useEffect(() => {
    let active = true;
    void window.lucid.pages
      .backups(pageId)
      .then((result) => {
        if (!active) return;
        setBackups(result.backups);
        setProblems(result.problems);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [pageId]);

  const restore = async (backupId: string) => {
    setRestoring(backupId);
    setError(undefined);
    try {
      await onRestore(backupId);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setRestoring(undefined);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={restoring === undefined ? onClose : undefined}>
      <div
        className="modal backup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Automatic backups"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <header>
          <h2>Automatic backups</h2>
          <button
            ref={close}
            type="button"
            className="icon-button"
            aria-label="Close"
            disabled={restoring !== undefined}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <p>
          Earlier versions of <b>{title.trim() || "Untitled"}</b>. Restoring makes a new page; it
          never replaces this one.
        </p>
        {loading ? (
          <p className="backup-empty" role="status">
            Looking for backups…
          </p>
        ) : backups.length === 0 ? (
          <p className="backup-empty">No automatic backups yet.</p>
        ) : (
          <ul className="backup-list">
            {backups.map((backup) => (
              <li key={backup.id}>
                <div>
                  <b>{new Date(backup.createdAt).toLocaleString()}</b>
                  <span>
                    {backup.title} · {String(backup.blockCount)} block
                    {backup.blockCount === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  type="button"
                  className="ghost"
                  disabled={restoring !== undefined}
                  onClick={() => void restore(backup.id)}
                >
                  {restoring === backup.id ? "Restoring…" : "Restore as copy"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {problems.length > 0 && (
          <p className="backup-warning">
            {String(problems.length)} damaged backup{problems.length === 1 ? " was" : "s were"}
            {" ignored and left untouched."}
          </p>
        )}
        {error && (
          <p className="backup-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            type="button"
            className="ghost"
            disabled={restoring !== undefined}
            onClick={onClose}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
