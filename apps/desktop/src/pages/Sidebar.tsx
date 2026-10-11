import { useEffect, useState } from "react";
import { getFormat } from "@lucid/kit";
import type { PageProblem, PageSummary } from "../../electron/ipc/types";
import { setTheme, useResolvedTheme } from "../theme/appearance";
import { BrandMark } from "../ui/BrandMark";
import { FileGlyph } from "../ui/FileGlyph";
import { Icon } from "../ui/Icon";
import { keys } from "../platform";

interface Props {
  pages: PageSummary[];
  problems: PageProblem[];
  currentId: string | undefined;
  onOpen: (id: string) => void;
  onCreate: () => void;
  /** Opens the dialog for a page of a note format. */
  onCreateFrom: () => void;
  /** Brings in notes from `.lucid` files (the file picker opens). */
  onImport: () => void;
  onTrash: (id: string) => void;
  onHide: () => void;
  onSettings: () => void;
}

const MINUTE = 60_000;
/** How long ago, short enough to sit beside the kind of note: now, 5 min, 2 h, Oct 11. */
function ago(iso: string, now = Date.now()): string {
  const diff = now - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < MINUTE) return "now";
  if (diff < 60 * MINUTE) return `${String(Math.floor(diff / MINUTE))} min`;
  if (diff < 24 * 60 * MINUTE) return `${String(Math.floor(diff / (60 * MINUTE)))} h`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function Sidebar({
  pages,
  problems,
  currentId,
  onOpen,
  onCreate,
  onCreateFrom,
  onImport,
  onTrash,
  onHide,
  onSettings,
}: Props) {
  const [confirming, setConfirming] = useState<string | undefined>();
  const look = useResolvedTheme();

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => {
      setConfirming(undefined);
    }, 3500);
    return () => {
      clearTimeout(timer);
    };
  }, [confirming]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark />
        Lucid
        <button
          type="button"
          className="icon-button"
          aria-label="Hide pages"
          title="Hide pages"
          onClick={onHide}
        >
          <Icon name="chevrons-left" />
        </button>
      </div>
      <button className="new-page" type="button" onClick={onCreate}>
        <Icon name="plus" /> New page
      </button>
      <button className="new-from" type="button" onClick={onCreateFrom}>
        <Icon name="template" /> New from a format…
      </button>
      <button
        className="new-from"
        type="button"
        title={keys("Bring in a note that was exported (⌘O)")}
        onClick={onImport}
      >
        <Icon name="download" /> Import a note…
      </button>
      <h2 className="side-label">
        Pages <span className="side-count">{pages.length}</span>
      </h2>
      <nav className="page-list" aria-label="Pages">
        {pages.length === 0 && <p className="page-list-empty">No pages yet.</p>}
        {pages.map((p) => (
          <div key={p.id} className="page-row" data-active={p.id === currentId}>
            <button
              type="button"
              className="page-open"
              aria-current={p.id === currentId ? "page" : undefined}
              onClick={() => {
                onOpen(p.id);
              }}
            >
              <FileGlyph />
              <span className="page-text">
                <span className="page-title">{p.title}</span>
                <span className="page-sub">
                  <span className="page-kind">{getFormat(p.format)?.name ?? "Blank page"}</span>
                  <span className="page-when">{ago(p.updatedAt)}</span>
                </span>
              </span>
            </button>
            {confirming === p.id ? (
              <button
                type="button"
                className="page-delete confirm"
                onClick={() => {
                  setConfirming(undefined);
                  onTrash(p.id);
                }}
              >
                Delete?
              </button>
            ) : (
              <button
                type="button"
                className="page-delete"
                aria-label={`Delete ${p.title}`}
                title="Delete page"
                onClick={() => {
                  setConfirming(p.id);
                }}
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        ))}
      </nav>
      {problems.length > 0 && (
        <div className="problems" role="note">
          <strong>
            {problems.length === 1 ? "1 file" : `${String(problems.length)} files`} couldn’t be
            opened.
          </strong>
          <ul>
            {problems.map((p) => (
              <li key={p.fileName} title={p.message}>
                {p.fileName}
              </li>
            ))}
          </ul>
          <span>They were left untouched.</span>
        </div>
      )}
      <div className="sidebar-foot">
        <button
          type="button"
          className="sidebar-settings"
          onClick={onSettings}
          title={keys("Settings (⌘,)")}
        >
          <Icon name="settings" /> Settings
        </button>
        <button
          type="button"
          className="icon-button theme-toggle"
          aria-label={look === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={look === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => {
            setTheme(look === "dark" ? "light" : "dark");
          }}
        >
          <Icon name={look === "dark" ? "sun" : "moon"} />
        </button>
      </div>
    </aside>
  );
}
