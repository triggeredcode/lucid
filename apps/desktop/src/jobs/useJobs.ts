import { newId, parseMeta, type ChangeEntry, type Meta, type TranscriptEntry } from "@lucid/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorApi } from "../editor/PageEditor";
import { getModel } from "../llm/model";
import { isCommandKey } from "./commandKey";
import { JobQueue, type JobStatus, type Mode, type Utterance } from "./queue";

/** What the page is doing: taking notes, taking commands, or being edited by hand. */
export type UiMode = Mode | "edit";

interface Options {
  editor: () => EditorApi | undefined;
  title: () => string;
  vocabulary: () => string[];
  format: () => string | undefined;
  onTranscript: (entry: TranscriptEntry) => void;
  onChange: (entry: ChangeEntry) => void;
  onApplied?: ((mode: Mode) => void) | undefined;
  onExportPdf?: (() => void) | undefined;
  onExportMarkdown?: (() => void) | undefined;
  /** "diagram mode", "edit this diagram", "table mode": open the guided builder. */
  onBuild?: ((what: "diagram" | "table", existing: boolean) => void) | undefined;
}

/** After the Command key is let go, words that arrive within this time still count as a command (Wispr pastes late). */
const GRACE_MS = 1500;
const WAKE = /^(?:hey\s+)?lucid[,:]\s*(.+)$/is;

/** The job queue for the open page, the Input/Command mode, voice meta-commands, and the status the bar shows. */
export function useJobs(options: Options) {
  const [status, setStatus] = useState<JobStatus>({ kind: "idle" });
  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<UiMode>("input");
  /** The mode to go back to when hand editing ends. */
  const talkMode = useRef<Mode>("input");
  const [momentary, setMomentary] = useState(false);
  const queue = useRef<JobQueue | undefined>(undefined);
  const opts = useRef(options);
  opts.current = options;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  if (mode !== "edit") talkMode.current = mode;
  const held = useRef(false);
  const graceUntil = useRef(0);

  useEffect(() => {
    let live = true;
    void getModel().then((model) => {
      if (!live) return;
      queue.current = new JobQueue({
        client: model.client,
        lanes: model.lanes,
        modelName: model.name,
        editor: () => opts.current.editor(),
        title: () => opts.current.title(),
        vocabulary: () => opts.current.vocabulary(),
        format: () => opts.current.format(),
        onStatus: setStatus,
        onCall: (c) => {
          console.debug("[lucid] model call", JSON.stringify(c));
        },
        onTranscript: (e) => {
          opts.current.onTranscript(e);
        },
        onChange: (e) => {
          opts.current.onChange(e);
        },
        onApplied: (mode) => {
          opts.current.onApplied?.(mode);
        },
      });
      setReady(true);
    });
    // A new model or address saved in Settings applies to the next request.
    const changed = () => {
      void getModel().then((model) => {
        queue.current?.setModel({
          client: model.client,
          lanes: model.lanes,
          modelName: model.name,
        });
      });
    };
    window.addEventListener("lucid:settings-saved", changed);
    return () => {
      live = false;
      window.removeEventListener("lucid:settings-saved", changed);
      queue.current?.cancel();
    };
  }, []);

  const setMode = useCallback((next: UiMode) => {
    setModeState(next);
  }, []);
  const leaveEdit = useCallback(() => {
    setModeState((m) => (m === "edit" ? talkMode.current : m));
  }, []);

  // ⌘/ switches the sticky mode; holding the right Option key is Command mode for as long as it is held.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setModeState((m) => (m === "input" ? "command" : "input"));
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setModeState((m) => (m === "edit" ? talkMode.current : "edit"));
      } else if (isCommandKey(e) && !held.current) {
        held.current = true;
        clearTimeout(timer);
        setMomentary(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "AltRight" || !held.current) return;
      held.current = false;
      graceUntil.current = Date.now() + GRACE_MS;
      timer = setTimeout(() => {
        if (!held.current) setMomentary(false);
      }, GRACE_MS);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      clearTimeout(timer);
    };
  }, []);

  const note = useCallback((summary: string) => {
    setStatus({ kind: "done", summary, at: Date.now(), undoable: false });
  }, []);

  const meta = useCallback(
    (m: Meta, text: string, source: Utterance["source"]) => {
      opts.current.onTranscript({
        id: newId(),
        text,
        source,
        mode: modeRef.current === "edit" ? "input" : modeRef.current,
        createdAt: new Date().toISOString(),
        status: "meta",
      });
      const editor = opts.current.editor();
      switch (m.intent) {
        case "mode":
          setModeState(m.mode);
          note(
            m.mode === "command"
              ? "Command mode: say what to change."
              : m.mode === "edit"
                ? "Edit mode: change the page by hand. Press Esc to go back."
                : "Input mode: say your notes.",
          );
          return;
        case "undo":
          editor?.undo();
          note("Undid the last change.");
          return;
        case "redo":
          editor?.redo();
          note("Redid the change.");
          return;
        case "accept":
          queue.current?.accept();
          return;
        case "reject":
          queue.current?.reject();
          return;
        case "choose":
          queue.current?.choose(m.n);
          return;
        case "stop":
          queue.current?.cancel();
          return;
        case "build":
          opts.current.onBuild?.(m.what, m.existing);
          return;
        case "export_pdf":
          opts.current.onExportPdf?.();
          return;
        case "export_markdown":
          opts.current.onExportMarkdown?.();
          return;
      }
    },
    [note],
  );

  const submit = useCallback(
    (raw: string, source: Utterance["source"]) => {
      const text = raw.trim();
      if (text.length === 0) return;
      const q = queue.current;
      if (!q) return;
      const m = parseMeta(text, q.interaction);
      if (m) {
        meta(m, text, source);
        return;
      }
      if (modeRef.current === "edit" && !held.current) return;
      let useMode: Mode =
        held.current || Date.now() < graceUntil.current
          ? "command"
          : modeRef.current === "edit"
            ? "input"
            : modeRef.current;
      let body = text;
      if (useMode === "input") {
        const wake = WAKE.exec(text);
        if (wake?.[1]) {
          useMode = "command";
          body = wake[1].trim();
        }
      }
      q.submit({
        id: newId(),
        text: body,
        source,
        mode: useMode,
        createdAt: new Date().toISOString(),
      });
    },
    [meta],
  );

  return {
    status,
    ready,
    mode,
    /** The mode shown: Command while the key is held (or just let go), else the chosen one. */
    shownMode: (momentary && mode !== "edit" ? "command" : mode) satisfies UiMode,
    leaveEdit,
    note,
    setMode,
    submit,
    cancel: () => {
      queue.current?.cancel();
    },
    retry: () => {
      queue.current?.retry();
    },
    accept: () => {
      queue.current?.accept();
    },
    reject: () => {
      queue.current?.reject();
    },
    choose: (n: number) => {
      queue.current?.choose(n);
    },
    insertAsContent: () => {
      queue.current?.insertAsContent();
    },
    dismiss: () => {
      setStatus({ kind: "idle" });
    },
  };
}
