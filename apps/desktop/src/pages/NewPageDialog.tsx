import { Icon } from "../ui/Icon";
import { runAdvisor, titleFrom } from "@lucid/llm";
import { FORMATS, getFormat, pickFormat } from "@lucid/kit";
import { useEffect, useRef, useState } from "react";
import { getModel } from "../llm/model";

interface Props {
  onCreate: (page: { title: string; format: string | undefined }) => void;
  onClose: () => void;
}

const BLANK = "blank";

/**
 * A new page: blank, or of a note format. Say what the notes are about and the format is suggested at once (by keywords)
 * and again when the model has answered (a few seconds); the choice is always the person's.
 */
export function NewPageDialog({ onCreate, onClose }: Props) {
  const [about, setAbout] = useState("");
  const [choice, setChoice] = useState<string>(BLANK);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<string | undefined>();
  const [asking, setAsking] = useState(false);
  // What the person set by hand is never overwritten by a late answer from the model.
  const touchedChoice = useRef(false);
  const touchedTitle = useRef(false);
  const run = useRef(0);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    field.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const suggest = async () => {
    const text = about.trim();
    if (text.length === 0) return;
    const mine = ++run.current;
    const quick = pickFormat(text);
    if (!touchedChoice.current) setChoice(quick.format.id);
    if (!touchedTitle.current) setTitle(titleFrom(text));
    setNote(
      quick.score > 0 ? `Looks like a ${quick.format.name.toLowerCase()}.` : "No clear match yet.",
    );
    setAsking(true);
    try {
      const model = await getModel();
      const advice = await runAdvisor(text, { client: model.client, lane: model.lanes.advisor });
      if (mine !== run.current) return;
      if (advice.source === "model") {
        if (!touchedChoice.current) setChoice(advice.formatId);
        if (!touchedTitle.current) setTitle(advice.title);
        const name = getFormat(advice.formatId)?.name ?? advice.formatId;
        setNote(`Suggested: ${name}. ${advice.reason}`);
      }
    } finally {
      if (mine === run.current) setAsking(false);
    }
  };

  const create = () => {
    onCreate({
      title: title.trim() || "Untitled",
      format: choice === BLANK ? undefined : choice,
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal np-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New page"
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        <header>
          <h2>New page</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>

        <label className="np-about">
          <span>What will you write about?</span>
          <textarea
            ref={field}
            rows={2}
            value={about}
            placeholder="notes on how consistent hashing works…"
            onChange={(e) => {
              setAbout(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void suggest();
              }
            }}
          />
        </label>
        <div className="np-suggest">
          <button
            type="button"
            className="ghost small"
            disabled={about.trim().length === 0}
            onClick={() => {
              void suggest();
            }}
          >
            Suggest a format
          </button>
          <span className="np-note" role="status">
            {asking ? "Asking the model… " : ""}
            {note}
          </span>
        </div>

        <div role="radiogroup" aria-label="Format">
          <div className="np-formats">
            {FORMATS.map((f) => (
              <label key={f.id} className="np-format" data-selected={choice === f.id}>
                <input
                  type="radio"
                  name="format"
                  value={f.id}
                  checked={choice === f.id}
                  onChange={() => {
                    touchedChoice.current = true;
                    setChoice(f.id);
                  }}
                />
                <span className="np-name">{f.name}</span>
                <span className="np-desc">{f.description}</span>
                <span className="np-sections">
                  {getFormat(f.id)
                    ?.sections.map((s) => s.heading)
                    .join(" · ")}
                </span>
              </label>
            ))}
          </div>
          <div className="np-blank-row">
            <label className="np-blank" data-selected={choice === BLANK}>
              <input
                type="radio"
                name="format"
                value={BLANK}
                checked={choice === BLANK}
                onChange={() => {
                  touchedChoice.current = true;
                  setChoice(BLANK);
                }}
              />
              Blank page
            </label>
            <span className="np-blank-hint">or start empty and write what you like</span>
          </div>
        </div>

        <label className="np-title">
          <span>Title</span>
          <input
            value={title}
            placeholder="Untitled"
            onChange={(e) => {
              touchedTitle.current = true;
              setTitle(e.target.value);
            }}
          />
        </label>

        <footer>
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={create}>
            Create page
          </button>
        </footer>
      </div>
    </div>
  );
}
