import { useEffect, useRef, useState } from "react";
import type { PublicSettings } from "../../electron/ipc/types";
import {
  setFont,
  setTheme,
  useAppearance,
  type ThemeChoice,
  type Typeface,
} from "../theme/appearance";
import { Icon, type IconName } from "../ui/Icon";
import { setBlockNumbers, useBlockNumbers } from "../theme/blockNumbers";
import { saveSettings } from "./settingsStore";

const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: IconName }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "monitor" },
];
const FONT_OPTIONS: { value: Typeface; label: string }[] = [
  { value: "mono", label: "Mono" },
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
];

interface Props {
  settings: PublicSettings;
  onClose: () => void;
}

/** The few things worth changing: which model Lucid asks, how PDFs are signed, and the words to expect. */
export function SettingsDialog({ settings, onClose }: Props) {
  const [author, setAuthor] = useState(settings.author);
  const [footer, setFooter] = useState(settings.footerRight);
  const [address, setAddress] = useState(settings.llm.baseUrl);
  const [model, setModel] = useState(settings.llm.model);
  const [context, setContext] = useState(String(settings.llm.contextLength));
  const [words, setWords] = useState(settings.vocabulary.join("\n"));
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const appearance = useAppearance();
  const numbers = useBlockNumbers();

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    setProblems([]);
    try {
      const result = await saveSettings({
        author,
        footerRight: footer,
        vocabulary: words
          .split(/\r?\n/)
          .map((w) => w.trim())
          .filter((w) => w.length > 0),
        llm: { baseUrl: address, model, contextLength: Number(context) },
      });
      if (result.ok) onClose();
      else setProblems(result.problems);
    } catch (error) {
      setProblems([error instanceof Error ? error.message : "The settings could not be saved."]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal settings"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        <header>
          <h2>Settings</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>

        <fieldset className="appearance">
          <legend>Appearance</legend>
          <div className="setting-row">
            <span id="theme-label">Theme</span>
            <div className="segmented" role="radiogroup" aria-labelledby="theme-label">
              {THEME_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={appearance.theme === o.value}
                  onClick={() => {
                    setTheme(o.value);
                  }}
                >
                  <Icon name={o.icon} size={14} /> {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <span id="font-label">Type</span>
            <div className="segmented" role="radiogroup" aria-labelledby="font-label">
              {FONT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={appearance.font === o.value}
                  data-font={o.value}
                  onClick={() => {
                    setFont(o.value);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <span id="numbers-label">Block numbers</span>
            <div className="segmented" role="radiogroup" aria-labelledby="numbers-label">
              {(
                [
                  [true, "Show"],
                  [false, "Hide"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={numbers === value}
                  onClick={() => {
                    setBlockNumbers(value);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <small>
            Applied at once. Mono is the default; PDFs keep their own typesetting. Block numbers
            (B1, B2…) sit in the page margin; say “in block 3, …” to talk about one.
          </small>
        </fieldset>

        <fieldset>
          <legend>Language model (LM Studio)</legend>
          <label>
            <span>Address</span>
            <input
              ref={first}
              value={address}
              disabled={settings.llmUrlLocked}
              onChange={(e) => {
                setAddress(e.target.value);
              }}
              spellCheck={false}
            />
            <small>
              {settings.llmUrlLocked
                ? "Set by the LUCID_LLM_URL environment variable."
                : "Only this computer, like http://127.0.0.1:1234."}
            </small>
          </label>
          <label>
            <span>Model</span>
            <input
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
              }}
              spellCheck={false}
            />
            <small>
              The name LM Studio uses, like qwen/qwen3.8-27b. Load it with the pill in the top bar.
            </small>
          </label>
          <label>
            <span>Context length when Lucid loads the model</span>
            <input
              value={context}
              inputMode="numeric"
              onChange={(e) => {
                setContext(e.target.value);
              }}
            />
            <small>Between 2048 and 262144. Bigger needs more memory.</small>
          </label>
        </fieldset>

        <fieldset>
          <legend>PDF</legend>
          <label>
            <span>Your name</span>
            <input
              value={author}
              onChange={(e) => {
                setAuthor(e.target.value);
              }}
            />
          </label>
          <label>
            <span>Footer, right side</span>
            <input
              value={footer}
              onChange={(e) => {
                setFooter(e.target.value);
              }}
            />
            <small>The page number is on the left.</small>
          </label>
        </fieldset>

        <fieldset>
          <legend>Words to expect</legend>
          <label>
            <span>One per line</span>
            <textarea
              rows={4}
              value={words}
              onChange={(e) => {
                setWords(e.target.value);
              }}
              spellCheck={false}
            />
            <small>
              Names and tools that speech recognition gets wrong, like vLLM or Kubernetes. They are
              kept as written.
            </small>
          </label>
        </fieldset>

        {problems.length > 0 && (
          <ul className="settings-problems" role="alert">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <footer>
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={saving}
            onClick={() => {
              void save();
            }}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
