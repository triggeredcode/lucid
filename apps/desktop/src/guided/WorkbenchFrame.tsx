import type { ReactNode } from "react";
import type { BuilderState } from "./useBuilder";

export interface PhaseTab<P extends string> {
  phase: P;
  label: string;
  hint: string;
}

interface Props<P extends string> {
  state: BuilderState;
  title: string;
  phases: readonly PhaseTab<P>[];
  phase: P;
  onPhase: (phase: P) => void;
  onUndo: () => void;
  onCancel: () => void;
  onDone: () => void;
  onChoose: (n: number) => void;
  onDismissAsk: () => void;
  doneLabel: string;
  canDone: boolean;
  /** The drawing (or table) and its numbered lists. */
  children: ReactNode;
  /** What is still missing, shown above the hint. */
  checklist?: string | undefined;
  /** The body is one wide column (a table) instead of a drawing with a side list. */
  single?: boolean;
}

/** What every builder shares: the step tabs, Undo / Cancel / Insert, what was understood, a question, the hint. */
export function WorkbenchFrame<P extends string>({
  state,
  title,
  phases,
  phase,
  onPhase,
  onUndo,
  onCancel,
  onDone,
  onChoose,
  onDismissAsk,
  doneLabel,
  canDone,
  children,
  checklist,
  single = false,
}: Props<P>) {
  const hint = phases.find((p) => p.phase === phase)?.hint ?? "";
  return (
    <section
      className="workbench"
      aria-label={`${state.kind === "table" ? "Table" : "Diagram"} builder`}
    >
      <header className="wb-head">
        <strong>{title}</strong>
        <div className="wb-tabs" role="tablist" aria-label="Step">
          {phases.map((p) => (
            <button
              key={p.phase}
              type="button"
              role="tab"
              aria-selected={phase === p.phase}
              onClick={() => {
                onPhase(p.phase);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="ghost small"
          onClick={onUndo}
          disabled={state.history.length === 0}
        >
          Undo
        </button>
        <button type="button" className="ghost small" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary small" onClick={onDone} disabled={!canDone}>
          {doneLabel}
        </button>
      </header>
      <div className="wb-body" data-single={single}>
        {children}
      </div>
      <footer className="wb-foot">
        {state.ask && (
          <div className="wb-ask" role="group" aria-label="Question">
            <strong>{state.ask.question}</strong>
            {state.ask.options.map((o, i) => (
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
            <button type="button" className="link" onClick={onDismissAsk}>
              Cancel
            </button>
          </div>
        )}
        <div className="wb-echo" role="status" aria-live="polite">
          {state.busy ? (
            <span className="wb-busy">{state.busy}</span>
          ) : (
            state.echo.slice(-3).map((line, i, all) => (
              <span key={`${line}-${String(i)}`} data-latest={i === all.length - 1}>
                {line}
              </span>
            ))
          )}
        </div>
        {checklist && <p className="wb-check">{checklist}</p>}
        <p className="wb-hint">{hint}</p>
      </footer>
    </section>
  );
}
