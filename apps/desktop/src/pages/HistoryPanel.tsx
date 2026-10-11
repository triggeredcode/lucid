import type { ChangeEntry, TranscriptEntry } from "@lucid/core";
import { useState } from "react";
import { agentName } from "../agent/bridge";

interface Props {
  transcripts: readonly TranscriptEntry[];
  changes: readonly ChangeEntry[];
  /** Whether a change can still be taken back: the blocks it touched are as it left them. */
  canRevert: (entry: ChangeEntry) => boolean;
  /** Take one earlier change back (after the person confirmed). */
  onRevert: (id: string) => void;
  /** Scroll to what a change touched and let it flash. */
  onShow: (entry: ChangeEntry) => void;
  /** Put an utterance back in the dictation box to correct and send again. */
  onEdit: (entry: TranscriptEntry) => void;
  onClose: () => void;
}

const LABEL: Record<TranscriptEntry["status"], string> = {
  applied: "Done",
  meta: "Voice command",
  failed: "Failed",
  unprocessed: "Kept as written",
  rejected: "Not applied",
};

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${String(Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${String(Math.floor(s / 3600))} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const WHO = (source: string): string =>
  source.startsWith("agent:")
    ? agentName(source)
    : source === "builder"
      ? "Builder"
      : source === "revert"
        ? "Revert"
        : "Lucid";

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** What changed, and by whom, with a way to take one change back; and what was said, with a way to say it again. */
export function HistoryPanel({
  transcripts,
  changes,
  canRevert,
  onRevert,
  onShow,
  onEdit,
  onClose,
}: Props) {
  const [confirming, setConfirming] = useState<string | undefined>();
  const summaryOf = new Map(changes.map((c) => [c.id, c.summary]));
  const recent = [...transcripts].reverse().slice(0, 15);
  const listed = [...changes].reverse().slice(0, 12);
  return (
    <aside className="side" aria-label="History">
      <header>
        <strong>History</strong>
        <button type="button" className="link" onClick={onClose}>
          Hide
        </button>
      </header>
      <h3 className="side-h">Changes</h3>
      {listed.length === 0 ? (
        <p className="history-empty">No changes yet. Say something and it shows up here.</p>
      ) : (
        <ul className="changes">
          {listed.map((c) => (
            <li
              key={c.id}
              data-status="applied"
              data-source={c.source.startsWith("agent:") ? "agent" : c.source}
              data-reverted={c.reverted}
            >
              <div className="history-meta">
                <span
                  className="history-mode"
                  data-mode={c.source.startsWith("agent:") ? "agent" : "change"}
                >
                  {WHO(c.source)}
                </span>
                <span className="history-when">{clock(c.at)}</span>
              </div>
              <p>{c.summary}</p>
              {c.reverted ? (
                <span className="history-note">Taken back</span>
              ) : confirming === c.id ? (
                <div className="change-confirm" role="group" aria-label="Take this change back?">
                  <p>
                    Take this back? What it changed goes back to how it was before {clock(c.at)}.
                  </p>
                  <button
                    type="button"
                    className="primary small"
                    onClick={() => {
                      setConfirming(undefined);
                      onRevert(c.id);
                    }}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    className="ghost small"
                    onClick={() => {
                      setConfirming(undefined);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="change-actions">
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      onShow(c);
                    }}
                  >
                    Show
                  </button>
                  {c.revert !== undefined && (
                    <button
                      type="button"
                      className="ghost small"
                      disabled={!canRevert(c)}
                      title={
                        canRevert(c)
                          ? "Take this change back (the rest of the page stays as it is)"
                          : "The page was changed there since, so this can't be taken back"
                      }
                      onClick={() => {
                        setConfirming(c.id);
                      }}
                    >
                      Revert
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <h3 className="side-h">What you said</h3>
      {recent.length === 0 && (
        <p className="history-empty">Nothing yet. Dictate or type in the box below.</p>
      )}
      <ol>
        {recent.map((t) => (
          <li key={`${t.id}-${t.status}`} data-status={t.status}>
            <div className="history-meta">
              <span className="history-mode" data-mode={t.mode}>
                {t.mode === "command" ? "Command" : "Input"}
              </span>
              <span>{LABEL[t.status]}</span>
              <span className="history-when">{ago(t.createdAt)}</span>
            </div>
            <p>{t.text}</p>
            {summaryOf.get(t.id) && <p className="history-summary">{summaryOf.get(t.id)}</p>}
            {t.status !== "meta" && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  onEdit(t);
                }}
              >
                Edit and send again
              </button>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}
