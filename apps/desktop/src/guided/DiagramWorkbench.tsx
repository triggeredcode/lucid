import { compileMermaid, displayGraph, legend, type DiagramDraft, type Phase } from "@lucid/core";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { minWidthFor, type Layout } from "../preview/fit";
import { renderFitted } from "../preview/mermaid";
import { useWidth } from "../preview/useWidth";
import { useResolvedPageLook } from "../theme/appearance";
import { isDiagramDraft, type BuilderState } from "./useBuilder";
import { WorkbenchFrame } from "./WorkbenchFrame";

interface Props {
  state: BuilderState;
  onPhase: (phase: Phase) => void;
  onUndo: () => void;
  onCancel: () => void;
  onDone: () => void;
  onChoose: (n: number) => void;
  onDismissAsk: () => void;
}

const PHASES: { phase: Phase; label: string; hint: string }[] = [
  {
    phase: "components",
    label: "1 Components",
    hint: "Say the parts, like “client, server, DNS, database”. Say “connections” when you are ready.",
  },
  {
    phase: "connections",
    label: "2 Connections",
    hint: "Say how they connect, like “client to server”. They are numbered as you go. Add a label by saying it: “from server to client returns HTML”.",
  },
  {
    phase: "edit",
    label: "3 Edit",
    hint: "Fix things by number: “reverse 2”, “rename 3 to Cache”, “delete connection 4”, “connection 1 is resolve domain”, “group 2 and 3 as Backend”.",
  },
  {
    phase: "think",
    label: "Think",
    hint: "Think out loud. Nothing is drawn until you say “draw it”. Later statements win over earlier ones.",
  },
];

/** Draws the draft as it is now (a newer drawing replaces an older one when it is ready). */
function Canvas({ draft }: { draft: DiagramDraft }) {
  const [layout, setLayout] = useState<Layout | undefined>();
  const [failed, setFailed] = useState(false);
  const look = useResolvedPageLook();
  const fit = useRef<HTMLDivElement>(null);
  const width = useWidth(fit);
  const source = useMemo(
    () => (draft.graph.nodes.length > 0 ? compileMermaid(displayGraph(draft)) : undefined),
    [draft],
  );
  useEffect(() => {
    let live = true;
    if (source === undefined) {
      setLayout(undefined);
      return;
    }
    if (width === 0) return;
    // Readable at this size: the other direction when that is less squeezed, else it scrolls.
    renderFitted(source, look, { width, height: Math.round(window.innerHeight * 0.6) }).then(
      (l) => {
        if (!live) return;
        setLayout(l);
        setFailed(false);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [source, look, width]);
  // The wrapper is always there, so its width is known by the time there is something to draw.
  return (
    <div className="wb-fit" ref={fit}>
      {source === undefined ? (
        <div className="wb-empty">
          <p>The drawing appears here as you speak.</p>
          <p className="wb-sub">Start with the parts: “client, server, DNS, database”.</p>
        </div>
      ) : (
        <div
          className="wb-svg"
          data-failed={failed}
          style={
            {
              "--min-w": `${String(minWidthFor(layout?.size ?? { width: 0, height: 0 }))}px`,
            } as CSSProperties
          }
        >
          {layout !== undefined && <div dangerouslySetInnerHTML={{ __html: layout.svg }} />}
          {failed && (
            <p className="wb-sub">
              The drawing could not be updated just now. Keep going; it will catch up.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The one place where a diagram is built: the live drawing with numbers, the two numbered lists, and what was understood. */
export function DiagramWorkbench({
  state,
  onPhase,
  onUndo,
  onCancel,
  onDone,
  onChoose,
  onDismissAsk,
}: Props) {
  const draft = state.draft;
  if (!isDiagramDraft(draft)) return null;
  const l = legend(draft);
  return (
    <WorkbenchFrame
      state={state}
      title={state.blockId ? "Edit diagram" : "New diagram"}
      phases={PHASES}
      phase={draft.phase}
      onPhase={onPhase}
      onUndo={onUndo}
      onCancel={onCancel}
      onDone={onDone}
      onChoose={onChoose}
      onDismissAsk={onDismissAsk}
      doneLabel={state.blockId ? "Done" : "Insert diagram"}
      canDone={l.nodes.length > 0}
    >
      <div className="wb-canvas">
        <Canvas draft={draft} />
      </div>
      <aside className="wb-legend" aria-label="Numbers">
        <h3>Components</h3>
        {l.nodes.length === 0 ? (
          <p className="wb-sub">None yet.</p>
        ) : (
          <ol>
            {l.nodes.map((n) => (
              <li
                key={n.id}
                data-fresh={draft.fresh.includes(n.id)}
                data-loose={n.connections === 0 && l.edges.length > 0}
              >
                <b>{n.no}</b> {n.label} <span className="wb-kind">{n.kind}</span>
              </li>
            ))}
          </ol>
        )}
        <h3>Connections</h3>
        {l.edges.length === 0 ? (
          <p className="wb-sub">None yet.</p>
        ) : (
          <ol>
            {l.edges.map((e) => (
              <li key={e.id}>
                <b>#{e.no}</b> {e.from} {e.arrow === "bidirectional" ? "↔" : "→"} {e.to}
                {e.label ? <span className="wb-label"> “{e.label}”</span> : null}
                {e.style !== "solid" ? <span className="wb-kind"> {e.style}</span> : null}
              </li>
            ))}
          </ol>
        )}
        {l.loose.length > 0 && l.edges.length > 0 && (
          <p className="wb-loose">Not connected yet: {l.loose.join(", ")}.</p>
        )}
      </aside>
    </WorkbenchFrame>
  );
}
