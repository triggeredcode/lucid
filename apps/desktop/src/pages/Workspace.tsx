import { Icon } from "../ui/Icon";
import {
  canRevert,
  newId,
  withinRevertWindow,
  type Block,
  type ChangeEntry,
  type LucidDoc,
  type LucidFile,
  type TranscriptEntry,
} from "@lucid/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DictationBar } from "../dictation/DictationBar";
import { PageEditor, type EditorApi } from "../editor/PageEditor";
import { DiagramWorkbench } from "../guided/DiagramWorkbench";
import { TableWorkbench } from "../guided/TableWorkbench";
import { builderInfo, useBuilder } from "../guided/useBuilder";
import { useJobs } from "../jobs/useJobs";
import { getFormat, skeleton } from "@lucid/kit";
import { ExportButton } from "./ExportButton";
import { FormatChip } from "./FormatChip";
import { LmStatusPill } from "./LmStatusPill";
import { PageLookSwitch } from "./PageLookSwitch";
import { ZoomChip } from "./ZoomChip";
import { zoomPageByWheel } from "../theme/pageZoom";
import { agentName, setAgentHandler } from "../agent/bridge";
import { peekSettings, useAutoSendMs } from "../settings/settingsStore";
import { useAppearance } from "../theme/appearance";
import { HistoryPanel } from "./HistoryPanel";
import { useAutosave } from "./useAutosave";
import { BackupDialog } from "./BackupDialog";
import type { ActivationMilestone } from "../onboarding/activation";

const SIDE_KEY = "lucid.history";

function sideOpenAtStart(): boolean {
  try {
    return localStorage.getItem(SIDE_KEY) === "open";
  } catch {
    // Remembering is a convenience only.
    return false;
  }
}

/** The text of a heading block, lower-cased, to tell whether a section is already there. */
const headingText = (b: Block): string =>
  b.content
    ?.map((i) => (i.type === "text" ? i.text : ""))
    .join("")
    .trim()
    .toLowerCase() ?? "";

/** How many of the format's sections have no heading in the page yet. */
function missingSections(doc: LucidDoc, format: string | undefined): number {
  const f = getFormat(format);
  if (!f) return 0;
  const have = new Set(doc.blocks.filter((b) => b.type === "heading").map(headingText));
  return f.sections.filter((s) => !have.has(s.heading.toLowerCase())).length;
}

interface Props {
  file: LucidFile;
  onSaved: (file: LucidFile) => void;
  /** Sidebar (page list) state, so the top bar can bring it back. */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onRestoreBackup: (pageId: string, backupId: string) => Promise<void>;
  onActivationMilestone?: ((milestone: ActivationMilestone) => void) | undefined;
}

/**
 * One open page, one view: the document, a single input box under it, and an optional panel on the right that
 * lists what was said. The page is edited by speaking or typing in the box; Edit mode lets you type in the page
 * itself for the few things the model gets wrong.
 */
export function Workspace({
  file,
  onSaved,
  sidebarOpen,
  onToggleSidebar,
  onRestoreBackup,
  onActivationMilestone,
}: Props) {
  const [title, setTitle] = useState(file.title);
  const [doc, setDoc] = useState<LucidDoc>(file.doc);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>(file.transcripts);
  const [changeLog, setChangeLog] = useState<ChangeEntry[]>(file.changeLog);
  const [format, setFormat] = useState<string | undefined>(file.meta.format);
  const [info, setInfo] = useState<Record<string, string>>(file.meta.info);
  const [sideOpen, setSideOpen] = useState(sideOpenAtStart);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [draft, setDraft] = useState<
    { text: string; mode: "input" | "command"; key: number } | undefined
  >();
  const exportRef = useRef<{ pdf: () => void; markdown: () => void; note: () => void } | undefined>(
    undefined,
  );
  // File → Export Note… (⇧⌘E) opens the same dialog as the button.
  useLayoutEffect(
    () =>
      window.lucid.note.onMenu((action) => {
        if (action === "export-note") exportRef.current?.note();
      }),
    [],
  );
  const registerExport = useCallback(
    (start: { pdf: () => void; markdown: () => void; note: () => void }) => {
      exportRef.current = start;
    },
    [],
  );
  const editorApi = useRef<EditorApi | undefined>(undefined);
  const pageScroll = useRef<HTMLDivElement>(null);

  // A pinch on the trackpad, or Ctrl and the scroll wheel, over the page zooms the page and nothing else.
  useEffect(() => {
    const el = pageScroll.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomPageByWheel(e.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, []);
  /** Lists a change in the History, with its way back (what the editor says takes the last change back). */
  const addChange = useCallback(
    (entry: ChangeEntry) => {
      const revert = editorApi.current?.takeRevert();
      setChangeLog((list) => withinRevertWindow([...list, revert ? { ...entry, revert } : entry]));
      if (entry.source === "builder") onActivationMilestone?.("visual-created");
    },
    [onActivationMilestone],
  );
  const builder = useBuilder({
    pageId: file.id,
    editor: () => editorApi.current,
    onChange: addChange,
  });
  const formatRef = useRef(format);
  formatRef.current = format;
  const infoRef = useRef(info);
  infoRef.current = info;
  const titleRef = useRef(title);
  titleRef.current = title;
  const titleInput = useRef<HTMLTextAreaElement>(null);

  const {
    state: saveState,
    retry,
    snapshot,
  } = useAutosave(file, { title, doc, transcripts, changeLog, format, info }, onSaved);
  const autoSendMs = useAutoSendMs();
  // Only a page with a look of its own is marked; one that follows the app inherits the app's colours.
  const { pageLook: pageLookChoice } = useAppearance();
  const pageLook = pageLookChoice === "auto" ? undefined : pageLookChoice;
  const jobs = useJobs({
    editor: () => editorApi.current,
    title: () => titleRef.current,
    vocabulary: () => [...(peekSettings()?.vocabulary ?? []), ...file.meta.vocabulary],
    format: () => formatRef.current,
    onTranscript: (entry) => {
      setTranscripts((list) => [...list, entry]);
    },
    onChange: addChange,
    onApplied: (mode) => {
      onActivationMilestone?.(mode === "command" ? "command-applied" : "content-added");
    },
    onExportPdf: () => {
      exportRef.current?.pdf();
    },
    onExportMarkdown: () => {
      exportRef.current?.markdown();
    },
    onBuild: (what, existing) => {
      openBuilder(what, existing);
    },
  });
  const editing = jobs.mode === "edit";

  // An AI agent working through MCP reads this page and changes it here, in the editor: one undo step, listed in History.
  const agentRef = useRef({ file, jobs, addChange });
  agentRef.current = { file, jobs, addChange };
  useEffect(() => {
    setAgentHandler((request) => {
      const api = editorApi.current;
      if (request.method === "openPage")
        return {
          id: file.id,
          title: titleRef.current,
          format: formatRef.current,
          info: infoRef.current,
        };
      if (!api) throw new Error("The page is still loading.");
      if (request.method === "getDoc") return api.getDoc();
      const { patch, note } = request.params;
      const next = api.apply(patch);
      agentRef.current.addChange({
        id: newId(),
        at: new Date().toISOString(),
        summary: note.summary,
        source: note.source,
        affected: note.affected,
        reverted: false,
      });
      agentRef.current.jobs.note(`${agentName(note.source)}: ${note.summary}. Undo takes it back.`);
      return next;
    });
    return () => {
      setAgentHandler(undefined);
    };
  }, [file.id]);

  /** Takes one earlier change back, if the blocks it touched are still as it left them. One undo step. */
  const revertChange = (id: string) => {
    const api = editorApi.current;
    const entry = changeLog.find((e) => e.id === id);
    if (!api || !entry?.revert || entry.reverted) return;
    const check = canRevert(api.getDoc(), entry.revert);
    try {
      if (!check.ok) throw new Error("changed since");
      api.apply(entry.revert.undo);
    } catch {
      jobs.note("That change can't be taken back any more: the page was changed there since.");
      return;
    }
    const revert = api.takeRevert();
    setChangeLog((list) =>
      withinRevertWindow([
        ...list.map((e) => (e.id === id ? { ...e, reverted: true } : e)),
        {
          id: newId(),
          at: new Date().toISOString(),
          summary: `Took back: ${entry.summary}`,
          source: "revert",
          affected: entry.affected,
          reverted: false,
          ...(revert ? { revert } : {}),
        },
      ]),
    );
    jobs.note(`Took back: ${entry.summary}. Undo brings it back.`);
  };
  /** Scrolls to what a change touched and lets it flash, so it can be seen what it was. */
  const showChange = (entry: ChangeEntry) => {
    for (const id of entry.affected) {
      const el = document.querySelector(`.page-editor [data-id="${CSS.escape(id)}"]`);
      if (!el) continue;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("flash");
      setTimeout(() => {
        el.classList.remove("flash");
      }, 1600);
      return;
    }
    jobs.note("What that change touched is not on the page any more.");
  };

  /** Opens the guided builder: a new diagram or table, or the one in the page. */
  function openBuilder(what: "diagram" | "table", existing: boolean, blockId?: string) {
    if (jobs.mode === "edit") jobs.setMode("input");
    if (existing || blockId) {
      const id = blockId ?? builder.findBlock(what);
      if (!id) {
        jobs.note(`There is no ${what} on this page yet. Say “${what} mode” to make one.`);
        return;
      }
      builder.open(what, id);
    } else builder.open(what);
  }

  // ⌘1 Input, ⌘2 Command, ⌘3 Edit, ⌘4 the diagram builder, ⌘5 the table builder (Ctrl on other systems). While a builder
  // is open the modes are off (Cancel or Done first), and while a dialog is open the keys are the dialog's.
  const modeKey = useRef<(e: KeyboardEvent) => void>(() => undefined);
  modeKey.current = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || !/^[1-5]$/.test(e.key)) return;
    if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
    e.preventDefault();
    if (builder.state) return;
    if (e.key === "1") jobs.setMode("input");
    else if (e.key === "2") jobs.setMode("command");
    else if (e.key === "3") jobs.setMode("edit");
    else openBuilder(e.key === "4" ? "diagram" : "table", false);
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      modeKey.current(e);
    };
    window.addEventListener("keydown", on);
    return () => {
      window.removeEventListener("keydown", on);
    };
  }, []);

  // The "Edit diagram" / "Edit table" button on a figure in the page asks for the builder through an event.
  useEffect(() => {
    const on = (e: Event) => {
      const detail = (e as CustomEvent<{ kind: "diagram" | "table"; blockId: string }>).detail;
      openBuilder(detail.kind, true, detail.blockId);
    };
    window.addEventListener("lucid:build", on);
    return () => {
      window.removeEventListener("lucid:build", on);
    };
  });

  const toggleSide = (open: boolean) => {
    setSideOpen(open);
    try {
      localStorage.setItem(SIDE_KEY, open ? "open" : "closed");
    } catch {
      // Remembering is a convenience only.
    }
  };

  // A page that was just created is called "Untitled": select it so typing replaces it.
  useEffect(() => {
    if (file.title === "Untitled" && file.doc.blocks.length === 0) {
      jobs.setMode("edit");
    }
    // Only when the page opens.
  }, [file.id]);

  // Entering Edit mode puts the cursor where typing is wanted; Esc leaves it.
  useEffect(() => {
    if (!editing) return;
    if (file.title === "Untitled" && titleRef.current === "Untitled") {
      titleInput.current?.focus();
      titleInput.current?.select();
    } else editorApi.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !document.querySelector(".bn-suggestion-menu, .bn-formatting-toolbar")
      ) {
        jobs.leaveEdit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [editing]);

  // Undo and redo for the model's changes, wherever the focus is outside a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || editing) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      e.preventDefault();
      if (e.shiftKey) editorApi.current?.redo();
      else editorApi.current?.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [editing]);

  return (
    <div className="workspace" data-side={sideOpen ? "open" : "closed"} data-editing={editing}>
      <section className="main" aria-label="Page">
        <header className="topbar">
          {!sidebarOpen && (
            <button
              type="button"
              className="icon-button"
              aria-label="Show pages"
              title="Show pages"
              onClick={onToggleSidebar}
            >
              ☰
            </button>
          )}
          <FormatChip
            format={format}
            info={info}
            missing={missingSections(doc, format)}
            onChange={(f, i) => {
              setFormat(f);
              setInfo(i);
            }}
            onAddSections={() => {
              const api = editorApi.current;
              const f = getFormat(format);
              if (!api || !f) return;
              const have = new Set(
                api
                  .getDoc()
                  .blocks.filter((b) => b.type === "heading")
                  .map((b) => headingText(b)),
              );
              const add = skeleton(f).filter((h) => !have.has(headingText(h)));
              if (add.length === 0) return;
              const last = api.getDoc().blocks.at(-1)?.id ?? null;
              api.apply({
                steps: [{ kind: "insert", parentId: null, afterId: last, blocks: add }],
              });
            }}
          />
          <span className="spacer" />
          <LmStatusPill />
          <div className="save-note" data-state={saveState} role="status">
            {saveState === "saving" ? (
              "Saving…"
            ) : saveState === "error" ? (
              <>
                Couldn’t save.{" "}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    void retry();
                  }}
                >
                  Try again
                </button>
              </>
            ) : (
              "Saved"
            )}
          </div>
          <details className="workspace-menu">
            <summary className="icon-button" aria-label="Page actions" title="Page actions">
              <Icon name="more" />
            </summary>
            <div className="workspace-menu-popover">
              <div className="workspace-menu-section appearance-controls">
                <PageLookSwitch />
                <ZoomChip />
              </div>
              <button
                type="button"
                className="workspace-menu-item"
                title="Restore an automatic backup as a new page"
                onClick={() => {
                  setBackupsOpen(true);
                }}
              >
                <Icon name="undo" /> Backups
              </button>
              <button
                type="button"
                className="workspace-menu-item"
                aria-pressed={sideOpen}
                onClick={() => {
                  toggleSide(!sideOpen);
                }}
              >
                <Icon name="history" /> History
                {transcripts.length > 0 ? ` (${String(Math.min(transcripts.length, 99))})` : ""}
              </button>
              <div className="workspace-menu-export">
                <ExportButton
                  pageId={file.id}
                  title={title}
                  doc={doc}
                  format={format}
                  info={info}
                  getNote={snapshot}
                  said={transcripts.length}
                  changes={changeLog.length}
                  register={registerExport}
                  onSaved={() => {
                    onActivationMilestone?.("export-saved");
                  }}
                />
              </div>
            </div>
          </details>
        </header>
        <div
          className="editor-scroll"
          hidden={Boolean(builder.state)}
          ref={pageScroll}
          data-page-look={pageLook}
        >
          <div className="page-column zoomable">
            <textarea
              ref={titleInput}
              className="doc-title"
              aria-label="Page title"
              placeholder="Untitled"
              rows={1}
              readOnly={!editing}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value.replace(/[\r\n]+/g, " "));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  editorApi.current?.focus();
                }
              }}
            />
            <PageEditor
              initial={file.doc}
              editable={editing}
              onChange={(next) => {
                setDoc(next);
                if (next !== file.doc && next.blocks.length > 0) {
                  onActivationMilestone?.("content-added");
                }
              }}
              onReady={(api) => {
                editorApi.current = api;
              }}
            />
          </div>
        </div>
        {builder.state && (
          <div className="editor-scroll" data-page-look={pageLook}>
            <div className="page-column wide">
              {builder.state.kind === "table" ? (
                <TableWorkbench
                  state={builder.state}
                  onPhase={builder.setPhase}
                  onUndo={builder.undo}
                  onCancel={builder.cancel}
                  onDone={builder.done}
                  onChoose={builder.choose}
                  onDismissAsk={builder.dismissAsk}
                />
              ) : (
                <DiagramWorkbench
                  state={builder.state}
                  onPhase={builder.setPhase}
                  onUndo={builder.undo}
                  onCancel={builder.cancel}
                  onDone={builder.done}
                  onChoose={builder.choose}
                  onDismissAsk={builder.dismissAsk}
                />
              )}
            </div>
          </div>
        )}
        <div className="dock">
          <div className="page-column">
            <DictationBar
              autoSubmitDelayMs={autoSendMs}
              mode={jobs.shownMode}
              onMode={jobs.setMode}
              status={jobs.status}
              onSubmit={(text, source) => {
                if (builder.state) builder.say(text);
                else jobs.submit(text, source);
              }}
              builder={builder.state ? builderInfo(builder.state) : undefined}
              onBuild={(what) => {
                openBuilder(what, false);
              }}
              onCancel={jobs.cancel}
              onRetry={jobs.retry}
              onDismiss={jobs.dismiss}
              onUndo={() => {
                editorApi.current?.undo();
                jobs.dismiss();
              }}
              onAccept={jobs.accept}
              onReject={jobs.reject}
              onChoose={jobs.choose}
              onInsertAsContent={jobs.insertAsContent}
              draft={draft}
            />
          </div>
        </div>
      </section>
      {sideOpen && (
        <HistoryPanel
          transcripts={transcripts}
          changes={changeLog}
          canRevert={(entry) =>
            entry.revert !== undefined && !entry.reverted && canRevert(doc, entry.revert).ok
          }
          onRevert={revertChange}
          onShow={showChange}
          onClose={() => {
            toggleSide(false);
          }}
          onEdit={(entry) => {
            setDraft({ text: entry.text, mode: entry.mode, key: Date.now() });
            jobs.setMode(entry.mode);
          }}
        />
      )}
      {backupsOpen && (
        <BackupDialog
          pageId={file.id}
          title={title}
          onClose={() => {
            setBackupsOpen(false);
          }}
          onRestore={(backupId) => onRestoreBackup(file.id, backupId)}
        />
      )}
    </div>
  );
}
