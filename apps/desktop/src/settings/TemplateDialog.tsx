import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";

interface Props {
  onClose: () => void;
  /** Whether the template is the person's own after this window changed it (Settings shows which one is in use). */
  onChanged: (custom: boolean) => void;
}

/**
 * The PDF template: the text of `lucid.sty`, the file that sets the house style. It can be replaced; Settings choices (paper,
 * typeface, margins…) are applied after it. If the template does not work, the PDF is made with the built-in one, and says so.
 */
export function TemplateDialog({ onClose, onChanged }: Props) {
  const [loaded, setLoaded] = useState<{ custom: boolean; text: string }>();
  const [text, setText] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    void window.lucid.template.get().then((state) => {
      if (!alive) return;
      setLoaded(state);
      setText(state.text);
      area.current?.focus();
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // The "really?" of a reset goes away by itself.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => {
      setConfirming(false);
    }, 4000);
    return () => {
      clearTimeout(timer);
    };
  }, [confirming]);

  const save = async () => {
    setBusy(true);
    setProblems([]);
    try {
      const result = await window.lucid.template.save(text);
      if (result.ok) {
        onChanged(true);
        onClose();
      } else setProblems(result.problems);
    } catch (error) {
      setProblems([error instanceof Error ? error.message : "The template could not be saved."]);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      const state = await window.lucid.template.reset();
      onChanged(false);
      setLoaded(state);
      setText(state.text);
      setConfirming(false);
      setProblems([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal template"
        role="dialog"
        aria-modal="true"
        aria-label="PDF template"
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        <header>
          <h2>PDF template</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close the template"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <p className="template-about">
          This is <code>lucid.sty</code>, the file that sets the house style of every PDF: the
          fonts, the title, the footer, the tables and the boxes.{" "}
          {loaded?.custom
            ? "You are using your own copy."
            : "This is the one that comes with Lucid."}{" "}
          The choices under <i>PDF look</i> are applied after it. If it has a mistake, the PDF is
          made with the built-in style and says so.
        </p>
        <textarea
          ref={area}
          aria-label="Template text"
          value={text}
          spellCheck={false}
          wrap="off"
          disabled={loaded === undefined}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        {problems.length > 0 && (
          <ul className="settings-problems" role="alert">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <footer>
          <button
            type="button"
            className="ghost"
            disabled={busy || loaded === undefined || (!loaded.custom && !confirming)}
            onClick={() => {
              void reset();
            }}
          >
            {confirming ? "Really go back to the built-in one?" : "Use the built-in template"}
          </button>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || loaded === undefined}
            onClick={() => {
              void save();
            }}
          >
            Save template
          </button>
        </footer>
      </div>
    </div>
  );
}
