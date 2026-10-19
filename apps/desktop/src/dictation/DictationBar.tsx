import { Icon } from "../ui/Icon";
import { useEffect, useRef, useState } from "react";
import type { JobStatus, Mode, Utterance } from "../jobs/queue";
import type { Phase, TablePhase } from "@lucid/core";
import type { UiMode } from "../jobs/useJobs";
import { keys } from "../platform";

interface Props {
  mode: UiMode;
  onMode: (mode: UiMode) => void;
  status: JobStatus;
  onSubmit: (text: string, source: Utterance["source"]) => void;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  /** Undo the last AI change (shown for a few seconds after something was done). */
  onUndo: () => void;
  onAccept: () => void;
  onReject: () => void;
  onChoose: (n: number) => void;
  onInsertAsContent: () => void;
  /** Text to put back in the box (from the history list), so it can be corrected and sent again. */
  draft?: { text: string; mode: Mode; key: number } | undefined;
  /** The guided builder is open: words go to it, the pills wait, the hint follows the step. */
  builder?:
    | { kind: "diagram"; phase: Phase; busy: boolean }
    | { kind: "table"; phase: TablePhase; busy: boolean }
    | undefined;
  onBuild?: ((what: "diagram" | "table") => void) | undefined;
  autoSubmitDelayMs?: number;
}

const PLACEHOLDER: Record<Mode, string> = {
  input: "Speak or type your notes…",
  command: "Say or type what to change…",
};

const BUILDER_PLACEHOLDER = {
  diagram: {
    components: "Say the parts: client, server, DNS, database…",
    connections: "Say how they connect: client to server…",
    edit: "Fix by number: reverse 2, rename 3 to Cache, delete connection 4…",
    think: "Think out loud, then say “draw it”…",
  },
  table: {
    columns: "Say the columns: property, SQL, NoSQL…",
    rows: "Say a row: schema, fixed, flexible… or one cell at a time",
    edit: "Fix by number: cell 2 3 is embedded, delete row 2, add column cost…",
    think: "Think out loud, then say “draw it”…",
  },
};

const BUILD_NAME = { diagram: "Diagram", table: "Table" } as const;

const PILL_TITLE: Record<UiMode, string> = {
  input: keys("Input (⌘1): your words become notes. ⌘/ switches between Input and Command"),
  command: keys("Command (⌘2): your words change the page. Hold the right ⌥ key for one command"),
  edit: keys("Edit (⌘3, or ⌘E): change the page by hand. Esc goes back"),
};

function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * Where dictation lands. Wispr Flow pastes into whatever has focus, so this box has focus by default: a paste
 * is sent on its own after a short pause, typing is sent with Enter. The pill shows which mode
 * the words are in: Input (notes) or Command (change the page).
 */
export function DictationBar({
  mode,
  onMode,
  status,
  onSubmit,
  onCancel,
  onRetry,
  onDismiss,
  onUndo,
  onAccept,
  onReject,
  onChoose,
  onInsertAsContent,
  draft,
  builder,
  onBuild,
  autoSubmitDelayMs = 450,
}: Props) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const pasted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const textRef = useRef(text);
  textRef.current = text;
  const [seconds, setSeconds] = useState(0);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const send = (source: Utterance["source"]) => {
    clearTimeout(timer.current);
    const value = textRef.current.trim();
    if (value.length === 0) return;
    onSubmit(value, source);
    setText("");
    pasted.current = false;
  };

  /** A paste (Wispr Flow's way of delivering dictation) was just made: send it once nothing more arrives. */
  const sendWhenQuiet = () => {
    pasted.current = true;
    clearTimeout(timer.current);
    // Never: the words wait in the box until Enter.
    if (autoSubmitDelayMs <= 0) return;
    timer.current = setTimeout(() => {
      sendRef.current("wispr");
    }, autoSubmitDelayMs);
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  const quietRef = useRef(sendWhenQuiet);
  quietRef.current = sendWhenQuiet;
  const editingByHand = mode === "edit" && !builder;
  const editingRef = useRef(editingByHand);
  editingRef.current = editingByHand;

  // Wispr Flow pastes with ⌘V into whatever has focus. Clicking a button or the page leaves focus somewhere that cannot take
  // text, so a paste there would be lost: it goes to the input box instead. Fields, the editor in Edit mode and open dialogs
  // keep their own pastes.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (editingRef.current || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      const field = target?.closest(
        "textarea, input, [contenteditable='true'], [contenteditable='']",
      );
      const open =
        field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement
          ? !(field.readOnly || field.disabled)
          : field !== null && field !== undefined;
      if (open) return;
      if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
      const words = e.clipboardData?.getData("text/plain") ?? "";
      if (words.trim().length === 0 || !box.current) return;
      e.preventDefault();
      const current = box.current;
      current.focus();
      setText((was) => (was.trim().length > 0 ? `${was.trimEnd()} ${words}` : words));
      quietRef.current();
    };
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("paste", onPaste);
    };
  }, []);

  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        box.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer.current);
    };
  }, []);

  // Back from hand editing: the next words go in the box again.
  useEffect(() => {
    if (mode !== "edit") box.current?.focus();
  }, [mode]);

  // "Edit & re-run" from the history: put the words back to correct them.
  useEffect(() => {
    if (!draft) return;
    setText(draft.text);
    onMode(draft.mode);
    box.current?.focus();
    // Only a new draft (new key) should do this.
  }, [draft?.key]);

  const startedAt = status.kind === "working" ? status.startedAt : undefined;
  useEffect(() => {
    if (startedAt === undefined) return;
    const tick = () => {
      setSeconds(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => {
      clearInterval(interval);
    };
  }, [startedAt]);

  // The "done" message fades after a while.
  const doneAt = status.kind === "done" ? status.at : undefined;
  const doneHasNotice = status.kind === "done" && Boolean(status.notice);
  useEffect(() => {
    if (doneAt === undefined) return;
    const fade = setTimeout(
      () => {
        dismissRef.current();
      },
      doneHasNotice ? 15000 : 8000,
    );
    return () => {
      clearTimeout(fade);
    };
  }, [doneAt, doneHasNotice]);

  // Return focus to the box when something finishes, so the next thing said lands here.
  useEffect(() => {
    if (status.kind !== "working" && document.activeElement === document.body) box.current?.focus();
  }, [status]);

  const card = status.kind === "proposal" || status.kind === "clarify" || status.kind === "content";

  return (
    <div className="dictation" data-status={status.kind} data-mode={mode}>
      <div className={card ? "dictation-card" : "dictation-line"} role="status">
        {status.kind === "working" && (
          <>
            <Dots />
            <span>
              {status.mode === "command" ? "Working on your change…" : "Structuring your notes…"}{" "}
              {seconds} s{status.queued > 0 ? ` · ${String(status.queued)} waiting` : ""}
            </span>
            <button type="button" className="link" onClick={onCancel}>
              Cancel
            </button>
          </>
        )}
        {status.kind === "waiting" && (
          <>
            <Dots />
            <span>{status.reason} Your words are kept.</span>
            <button type="button" className="link" onClick={onCancel}>
              Cancel
            </button>
          </>
        )}
        {status.kind === "done" && (
          <>
            <span className="tick" aria-hidden="true">
              ✓
            </span>
            <span>
              {status.summary}.{status.notice ? ` ${status.notice}` : ""}
            </span>
            {status.undoable && (
              <button type="button" className="link" onClick={onUndo}>
                Undo
              </button>
            )}
          </>
        )}
        {status.kind === "failed" && (
          <>
            <span className="bang" aria-hidden="true">
              !
            </span>
            <span>{status.message}</span>
            <button type="button" className="link" onClick={onRetry}>
              Try again
            </button>
            <button type="button" className="link" onClick={onDismiss}>
              Dismiss
            </button>
          </>
        )}
        {status.kind === "unavailable" && (
          <>
            <span className="bang" aria-hidden="true">
              !
            </span>
            <span>
              <strong>Command unavailable.</strong> {status.message}
            </span>
            <button type="button" className="link" onClick={onDismiss}>
              Dismiss
            </button>
          </>
        )}
        {status.kind === "proposal" && (
          <>
            <div className="card-text">
              <strong>Apply this change?</strong> {status.summary}.
              <span className="card-sub">
                This would: {status.reasons.join("; ")}. Say “yes” or “no”.
              </span>
            </div>
            <div className="card-actions">
              <button type="button" className="primary small" onClick={onAccept}>
                Apply
              </button>
              <button type="button" className="ghost small" onClick={onReject}>
                Cancel
              </button>
            </div>
          </>
        )}
        {status.kind === "clarify" && (
          <>
            <div className="card-text">
              <strong>{status.question}</strong>
              <span className="card-sub">Click one, or say “the first one”, “the second one”…</span>
            </div>
            <div className="card-actions">
              {status.options.map((o, i) => (
                <button
                  key={`${o.label}-${String(i)}`}
                  type="button"
                  className="ghost small"
                  onClick={() => {
                    onChoose(i + 1);
                  }}
                >
                  <b>{i + 1}</b> {o.label}
                </button>
              ))}
              <button type="button" className="link" onClick={onReject}>
                Cancel
              </button>
            </div>
          </>
        )}
        {status.kind === "content" && (
          <>
            <div className="card-text">
              <strong>That sounded like notes, not an instruction.</strong>
              <span className="card-sub">Add it to the page as a note?</span>
            </div>
            <div className="card-actions">
              <button type="button" className="primary small" onClick={onInsertAsContent}>
                Add as a note
              </button>
              <button type="button" className="ghost small" onClick={onReject}>
                Dismiss
              </button>
            </div>
          </>
        )}
      </div>
      <div className="dictation-box">
        <div className="mode" role="group" aria-label="Mode">
          {(["input", "command", "edit"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className="mode-option"
              data-mode={m}
              aria-pressed={!builder && mode === m}
              disabled={Boolean(builder)}
              title={PILL_TITLE[m]}
              onClick={() => {
                onMode(m);
                box.current?.focus();
              }}
            >
              {m === "input" ? "Input" : m === "command" ? "Command" : "Edit"}
            </button>
          ))}
          {onBuild &&
            (["diagram", "table"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className="mode-option build"
                aria-pressed={builder?.kind === kind}
                disabled={Boolean(builder)}
                title={
                  kind === "diagram"
                    ? keys(
                        "Diagram (⌘4): build it step by step: parts, then connections, then fixes",
                      )
                    : keys("Table (⌘5): build it step by step: columns, then rows, then fixes")
                }
                onClick={() => {
                  onBuild(kind);
                }}
              >
                <Icon name={kind} size={14} /> {BUILD_NAME[kind]}
              </button>
            ))}
        </div>
        {mode === "edit" && !builder ? (
          <p className="edit-hint">{keys("Editing by hand. Esc (or ⌘E) goes back.")}</p>
        ) : (
          <>
            <textarea
              ref={box}
              aria-label="Dictate or type your notes"
              placeholder={
                builder
                  ? builder.kind === "table"
                    ? BUILDER_PLACEHOLDER.table[builder.phase]
                    : BUILDER_PLACEHOLDER.diagram[builder.phase]
                  : PLACEHOLDER[mode === "edit" ? "input" : mode]
              }
              rows={1}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
              onPaste={() => {
                // Let the paste land, then send it once it has stopped arriving (Wispr may paste in several pieces).
                sendWhenQuiet();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(pasted.current ? "wispr" : "typed");
                  return;
                }
                if (e.key === "Escape") {
                  if (card || status.kind === "working" || status.kind === "waiting") onCancel();
                  else {
                    clearTimeout(timer.current);
                    setText("");
                  }
                  return;
                }
                // The user is correcting the text: do not send on their behalf.
                if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1)
                  clearTimeout(timer.current);
              }}
            />
            <button
              type="button"
              className="send"
              aria-label="Send"
              disabled={text.trim().length === 0}
              onClick={() => {
                send(pasted.current ? "wispr" : "typed");
              }}
            >
              <Icon name="send" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
