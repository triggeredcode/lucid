import {
  GraphSchema,
  TableSchema,
  adoptGraph,
  adoptTable,
  graphChange,
  draftFromGraph,
  draftFromTable,
  newDraft,
  newId,
  newTableDraft,
  patchedIds,
  numberingHint,
  parseMeta,
  step,
  stepTable,
  tableChange,
  tableHint,
  type Block,
  type BlockPatch,
  type ChangeEntry,
  type DiagramDraft,
  type Phase,
  type TableDraft,
  type TablePhase,
} from "@lucid/core";
import { runCommand, runInput } from "@lucid/llm";
import { placeBlocks } from "@lucid/kit";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorApi } from "../editor/PageEditor";
import { getModel } from "../llm/model";

export type AnyDraft = DiagramDraft | TableDraft;
export type BuilderKind = "diagram" | "table";
export const isTableDraft = (d: AnyDraft): d is TableDraft => "table" in d;
export const isDiagramDraft = (d: AnyDraft): d is DiagramDraft => "graph" in d;

export interface BuilderAsk {
  question: string;
  options: {
    label: string;
    draft?: AnyDraft | undefined;
    echo?: string[] | undefined;
    retry?: string | undefined;
  }[];
}

/** The diagram or table being built. */
export interface BuilderState {
  kind: BuilderKind;
  draft: AnyDraft;
  /** Earlier drafts, newest last: every step is one undo. */
  history: AnyDraft[];
  /** What was understood, newest last. */
  echo: string[];
  ask?: BuilderAsk | undefined;
  /** Waiting for the model. */
  busy?: string | undefined;
  /** The diagram or table in the page that is being edited (absent when building a new one). */
  blockId?: string | undefined;
}

/** What the input box needs to know about the builder: which one, which step, and whether it is waiting. */
export function builderInfo(state: BuilderState) {
  const busy = Boolean(state.busy);
  const d = state.draft;
  return isTableDraft(d)
    ? { kind: "table" as const, phase: d.phase, busy }
    : { kind: "diagram" as const, phase: d.phase, busy };
}

const KEEP_ECHO = 6;
const KEEP_HISTORY = 40;
const storageKey = (pageId: string) => `lucid.builder.${pageId}`;

interface Options {
  pageId: string;
  editor: () => EditorApi | undefined;
  /** A finished diagram or table is a change to the page: it is listed in the History, where it can be taken back. */
  onChange?: ((entry: ChangeEntry) => void) | undefined;
}

const NOT_UNDERSTOOD: Record<BuilderKind, string> = {
  diagram: "I didn't understand that. Try a connection like “client to server”, or “undo”.",
  table: "I didn't understand that. Try a row like “schema, fixed, flexible”, or “undo”.",
};

/** The guided builder: state, the steps a person can take, and keeping an unfinished draft safe. */
export function useBuilder({ pageId, editor, onChange }: Options) {
  const [state, setStateRaw] = useState<BuilderState | undefined>(() => {
    try {
      const saved = localStorage.getItem(storageKey(pageId));
      if (!saved) return undefined;
      const parsed = JSON.parse(saved) as {
        kind?: BuilderKind;
        draft?: AnyDraft;
        history?: AnyDraft[];
        blockId?: string;
      };
      if (!parsed.draft) return undefined;
      return {
        kind: parsed.kind ?? "diagram",
        draft: parsed.draft,
        history: parsed.history ?? [],
        echo: ["Picked up where you left off."],
        blockId: parsed.blockId,
      };
    } catch {
      return undefined;
    }
  });
  const ref = useRef(state);
  const setState = useCallback((next: BuilderState | undefined) => {
    ref.current = next;
    setStateRaw(next);
  }, []);
  ref.current = state;

  // An unfinished draft is kept with the page until Done or Cancel.
  useEffect(() => {
    try {
      if (state) {
        localStorage.setItem(
          storageKey(pageId),
          JSON.stringify({
            kind: state.kind,
            draft: state.draft,
            history: state.history.slice(-KEEP_HISTORY),
            blockId: state.blockId,
          }),
        );
      } else localStorage.removeItem(storageKey(pageId));
    } catch {
      // Keeping the draft is a convenience only.
    }
  }, [state, pageId]);

  const commit = useCallback(
    (cur: BuilderState, draft: AnyDraft, echo: string[], keep = true) => {
      setState({
        ...cur,
        draft,
        history: keep ? [...cur.history, cur.draft].slice(-KEEP_HISTORY) : cur.history,
        echo: [...cur.echo, ...echo].slice(-KEEP_ECHO),
        ask: undefined,
        busy: undefined,
      });
    },
    [setState],
  );

  const say$ = (cur: BuilderState, echo: string[]) => {
    setState({ ...cur, echo: [...cur.echo, ...echo].slice(-KEEP_ECHO), busy: undefined });
  };

  const open = useCallback(
    (kind: BuilderKind, blockId?: string) => {
      const api = editor();
      const block = blockId ? api?.getDoc().blocks.find((b) => b.id === blockId) : undefined;
      if (kind === "table") {
        const parsed = block ? TableSchema.safeParse(block.props["table"]) : undefined;
        if (blockId && parsed?.success) {
          setState({
            kind,
            draft: draftFromTable(parsed.data),
            history: [],
            echo: ["Say what to change. Rows and columns are numbered."],
            blockId,
          });
        } else
          setState({
            kind,
            draft: newTableDraft(),
            history: [],
            echo: ["Say the columns, like “property, SQL, NoSQL”."],
          });
        return;
      }
      const parsed = block ? GraphSchema.safeParse(block.props["graph"]) : undefined;
      if (blockId && parsed?.success) {
        setState({
          kind,
          draft: draftFromGraph(parsed.data),
          history: [],
          echo: ["Say what to change. Numbers show on the drawing."],
          blockId,
        });
      } else
        setState({
          kind,
          draft: newDraft(),
          history: [],
          echo: ["Say the parts, like “client, server, DNS, database”."],
        });
    },
    [editor, setState],
  );

  /** The diagram or table to edit when someone says "edit this diagram": the one at the cursor, else the last one. */
  const findBlock = useCallback(
    (kind: BuilderKind): string | undefined => {
      const api = editor();
      if (!api) return undefined;
      const doc = api.getDoc();
      const found = doc.blocks.filter((b) => b.type === kind);
      const cursor = api.cursorBlockId();
      return (
        found.find((b) => b.id === cursor)?.id ??
        (found.length === 1 ? found[0]?.id : found.at(-1)?.id)
      );
    },
    [editor],
  );

  const cancel = useCallback(() => {
    setState(undefined);
  }, [setState]);

  const finish = useCallback(
    (cur: BuilderState) => {
      const api = editor();
      const d = cur.draft;
      const empty = isTableDraft(d) ? d.table.columns.length === 0 : d.graph.nodes.length === 0;
      if (!api || empty) {
        setState(undefined);
        return;
      }
      const doc = api.getDoc();
      const props = isTableDraft(d) ? { table: d.table } : { graph: d.graph };
      let patch: BlockPatch;
      if (cur.blockId) {
        const old = doc.blocks.find((b) => b.id === cur.blockId);
        if (!old) {
          say$(cur, [`That ${cur.kind} is no longer on the page.`]);
          return;
        }
        patch = {
          steps: [
            { kind: "update", id: old.id, block: { ...old, props: { ...old.props, ...props } } },
          ],
        };
      } else {
        const block: Block = { id: newId(), type: cur.kind, props: { ...props, caption: "" } };
        patch = placeBlocks(
          doc,
          [block],
          { kind: "cursor" },
          { cursorBlockId: api.cursorBlockId() },
        );
      }
      api.apply(patch);
      onChange?.({
        id: newId(),
        at: new Date().toISOString(),
        summary: `${cur.blockId ? "Changed" : "Added"} the ${cur.kind}`,
        source: "builder",
        affected: patchedIds(patch),
        reverted: false,
      });
      setState(undefined);
    },
    [editor, onChange, setState],
  );

  const setPhase = useCallback(
    (phase: Phase | TablePhase) => {
      const cur = ref.current;
      if (!cur) return;
      const draft = { ...cur.draft, phase, fresh: [] } as AnyDraft;
      commit(cur, draft, [], false);
    },
    [commit],
  );

  const undo = useCallback(() => {
    const cur = ref.current;
    if (!cur) return;
    const previous = cur.history.at(-1);
    if (!previous) {
      say$(cur, ["Nothing to undo."]);
      return;
    }
    setState({
      ...cur,
      draft: previous,
      history: cur.history.slice(0, -1),
      echo: [...cur.echo, "Undone."].slice(-KEEP_ECHO),
      ask: undefined,
      busy: undefined,
    });
  }, [setState]);

  /** What the grammar could not read goes to the model, with the numbering the person is using. */
  const askModel = useCallback(
    async (cur: BuilderState, text: string) => {
      setState({ ...cur, busy: "Thinking…" });
      try {
        const model = await getModel();
        const d = cur.draft;
        const block: Block = isTableDraft(d)
          ? { id: "draft", type: "table", props: { table: d.table, caption: "" } }
          : { id: "draft", type: "diagram", props: { graph: d.graph, caption: "" } };
        const out = await runCommand(
          {
            doc: { blocks: [block] },
            utterance: text,
            cursorBlockId: "draft",
            title: isTableDraft(d) ? "Table" : "Diagram",
            extra: isTableDraft(d) ? tableHint(d) : numberingHint(d),
          },
          { client: model.client, lane: model.lanes.command },
        );
        const latest = ref.current ?? cur;
        if (out.kind === "edit" || out.kind === "proposal") {
          const made = out.next.blocks.find((b) => b.id === "draft");
          const ld = latest.draft;
          if (isTableDraft(ld)) {
            const table = TableSchema.safeParse(made?.props["table"]);
            if (table.success) {
              const change = tableChange(ld.table, table.data);
              if (change.length === 0) {
                say$(latest, ["The model found nothing to change."]);
                return;
              }
              commit(latest, adoptTable(ld, table.data), [out.summary, `Changed: ${change}`]);
              return;
            }
          } else {
            const graph = GraphSchema.safeParse(made?.props["graph"]);
            if (graph.success) {
              const change = graphChange(ld.graph, graph.data);
              if (change.length === 0) {
                say$(latest, ["The model found nothing to change."]);
                return;
              }
              commit(latest, adoptGraph(ld, graph.data), [out.summary, `Changed: ${change}`]);
              return;
            }
          }
        }
        if (out.kind === "clarify") {
          setState({
            ...latest,
            busy: undefined,
            ask: {
              question: out.question,
              options: out.options.map((o) => ({
                label: o.label,
                retry: `${text} (I mean: ${o.label}${o.ref ? `, ${o.ref}` : ""})`,
              })),
            },
          });
          return;
        }
        say$(latest, [out.kind === "none" ? out.reason : NOT_UNDERSTOOD[cur.kind]]);
      } catch (error) {
        say$(ref.current ?? cur, [
          error instanceof Error ? error.message : NOT_UNDERSTOOD[cur.kind],
        ]);
      }
    },
    [commit, setState],
  );

  /** Think: "draw it" turns the whole of what was said into a diagram or table; later statements win over earlier ones. */
  const draw = useCallback(
    async (cur: BuilderState, notes: string) => {
      if (notes.trim().length === 0) {
        say$(cur, ["There is nothing in your notes yet."]);
        return;
      }
      setState({ ...cur, busy: "Drawing your notes…" });
      try {
        const model = await getModel();
        const preface = `The user was thinking aloud while building ONE ${cur.kind} and may correct themselves; when two statements disagree, the later one wins. Make only what was said, as a single ${cur.kind}.\n\n`;
        const out = await runInput(
          { doc: { blocks: [] }, utterance: preface + notes },
          { client: model.client, lane: model.lanes.input },
        );
        const latest = ref.current ?? cur;
        const ld = latest.draft;
        const block =
          out.kind === "applied" ? out.blocks.find((b) => b.type === cur.kind) : undefined;
        if (isTableDraft(ld)) {
          const table = block ? TableSchema.safeParse(block.props["table"]) : undefined;
          if (table?.success) {
            commit(latest, adoptTable(ld, table.data, "edit"), [
              `Made a table with ${String(table.data.columns.length)} columns and ${String(table.data.rows.length)} rows from your notes. Fix anything in Edit.`,
            ]);
            return;
          }
          say$(latest, [
            "I couldn't find a table in that. Say the columns and rows, then try again.",
          ]);
          return;
        }
        const graph = block ? GraphSchema.safeParse(block.props["graph"]) : undefined;
        if (graph?.success && isDiagramDraft(ld)) {
          const next = adoptGraph(
            {
              ...ld,
              graph: { ...graph.data, nodes: [], edges: [], groups: [] },
              nodeNo: {},
              nextNo: 1,
            },
            graph.data,
            "edit",
          );
          commit(latest, next, [
            `Drew ${String(graph.data.nodes.length)} components and ${String(graph.data.edges.length)} connections from your notes. Fix anything in Edit.`,
          ]);
          return;
        }
        say$(latest, [
          "I couldn't find a diagram in that. Say how the parts connect, then try again.",
        ]);
      } catch (error) {
        say$(ref.current ?? cur, [
          error instanceof Error ? error.message : NOT_UNDERSTOOD[cur.kind],
        ]);
      }
    },
    [commit, setState],
  );

  const choose = useCallback(
    (n: number) => {
      const cur = ref.current;
      const option = cur?.ask?.options[n - 1];
      if (!cur || !option) return;
      if (option.draft) commit(cur, option.draft, option.echo ?? []);
      else if (option.retry) {
        setState({ ...cur, ask: undefined });
        void askModel({ ...cur, ask: undefined }, option.retry);
      }
    },
    [askModel, commit, setState],
  );

  const dismissAsk = useCallback(() => {
    const cur = ref.current;
    if (cur) setState({ ...cur, ask: undefined });
  }, [setState]);

  const say = useCallback(
    (text: string) => {
      const cur = ref.current;
      if (!cur || cur.busy) return;
      // A question is open: "the second one" picks, "no" or "cancel" drops it.
      if (cur.ask) {
        const answer = parseMeta(text, { proposal: false, clarify: true, running: false });
        if (answer?.intent === "choose") {
          choose(answer.n);
          return;
        }
        if (answer?.intent === "reject") {
          dismissAsk();
          return;
        }
      }
      const d = cur.draft;
      const r = isTableDraft(d) ? stepTable(d, text) : step(d, text);
      switch (r.kind) {
        case "applied":
          commit(cur, r.draft, r.echo);
          return;
        case "nothing":
          say$(cur, r.echo);
          return;
        case "undo":
          undo();
          return;
        case "done":
          finish(cur);
          return;
        case "cancel":
          cancel();
          return;
        case "ask":
          setState({
            ...cur,
            ask: {
              question: r.question,
              options: r.options.map((o) => ({ label: o.label, draft: o.draft, echo: o.echo })),
            },
          });
          return;
        case "draw":
          void draw(cur, r.text);
          return;
        case "unknown":
          void askModel(cur, r.text);
          return;
      }
    },
    [askModel, cancel, choose, commit, dismissAsk, draw, finish, setState, undo],
  );

  return {
    state,
    open,
    findBlock,
    say,
    choose,
    dismissAsk,
    undo,
    cancel,
    done: () => {
      const cur = ref.current;
      if (cur) finish(cur);
    },
    setPhase,
  };
}
