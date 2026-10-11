import { useState } from "react";
import { useLmStatus } from "../llm/useLmStatus";

const gb = (bytes: number | undefined): string =>
  bytes === undefined ? "" : ` (${(bytes / 1e9).toFixed(1)} GB)`;

/** Whether the local model is ready, and when it is not, a way to load it (asks first: it uses most of the memory). */
export function LmStatusPill() {
  const lm = useLmStatus();
  const [asking, setAsking] = useState(false);
  const s = lm.status;
  if (!s) return null;

  if (lm.loading) {
    return (
      <div className="lm-pill" data-state="loading" role="group" aria-label="Model status">
        <i aria-hidden="true" />
        Loading {s.name}… this can take a minute
      </div>
    );
  }
  if (s.state === "ready") {
    return (
      <div
        className="lm-pill"
        data-state="ready"
        role="group"
        aria-label="Model status"
        title={`${s.model} is loaded in LM Studio`}
      >
        <i aria-hidden="true" />
        {s.model.split("/").pop()}
      </div>
    );
  }
  if (s.state === "down") {
    return (
      <div
        className="lm-pill"
        data-state="down"
        role="group"
        aria-label="Model status"
        title={s.problem}
      >
        <i aria-hidden="true" />
        LM Studio isn’t running
        <button
          type="button"
          className="link"
          onClick={() => {
            void window.lucid.lm.openStudio();
          }}
        >
          {s.studioInstalled === true ? "Open LM Studio" : "Get LM Studio"}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            void lm.refresh();
          }}
        >
          Check again
        </button>
      </div>
    );
  }
  const others = s.loaded.length > 0 ? s.loaded.join(", ") : undefined;
  return (
    <div className="lm-pill" data-state="needs-model" role="group" aria-label="Model status">
      <i aria-hidden="true" />
      {s.state === "no-model" ? "No model loaded" : `Another model is loaded (${others ?? ""})`}
      {s.canLoad ? (
        <button
          type="button"
          className="link"
          onClick={() => {
            lm.clearError();
            setAsking(true);
          }}
        >
          Load {s.name}
        </button>
      ) : (
        <span className="lm-problem">{s.problem}</span>
      )}
      {asking && s.canLoad && (
        <div className="lm-confirm" role="dialog" aria-label="Load the model">
          <p>
            Load <b>{s.name}</b>
            {gb(s.sizeBytes)} in LM Studio?
          </p>
          <p className="lm-sub">
            It takes about half a minute and uses most of the memory.
            {others ? ` ${others} is unloaded first.` : ""}
          </p>
          {lm.error && <p className="lm-error">{lm.error}</p>}
          <div className="lm-actions">
            <button
              type="button"
              className="primary small"
              onClick={() => {
                setAsking(false);
                void lm.load();
              }}
            >
              Load
            </button>
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                setAsking(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {!asking && lm.error && <span className="lm-error">{lm.error}</span>}
    </div>
  );
}
