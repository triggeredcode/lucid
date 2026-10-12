import { useEffect, useId, useRef, useState } from "react";
import { ACCENT_COLORS, FONT_NAMES, type PdfStyle } from "@lucid/kit";
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
import { TemplateDialog } from "./TemplateDialog";

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

/** A row of one-of-several choices in the look of the Appearance rows. */
function Choice<T extends string | number | boolean>(props: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="setting-row">
      <span id={id}>{props.label}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={id}>
        {props.options.map(([value, text]) => (
          <button
            key={String(value)}
            type="button"
            role="radio"
            aria-checked={props.value === value}
            onClick={() => {
              props.onChange(value);
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

const PAPER_OPTIONS = [
  ["auto", "Auto"],
  ["a4", "A4"],
  ["letter", "Letter"],
] as const;
const SIZE_OPTIONS = [
  [10, "10 pt"],
  [11, "11 pt"],
  [12, "12 pt"],
] as const;
const TYPEFACE_OPTIONS = (Object.keys(FONT_NAMES) as PdfStyle["font"][]).map(
  (key) => [key, FONT_NAMES[key]] as const,
);
const MARGIN_OPTIONS = [
  ["narrow", "Narrow"],
  ["normal", "Normal"],
  ["wide", "Wide"],
] as const;
const HEADING_OPTIONS = [
  [true, "Numbered"],
  [false, "Plain"],
] as const;
const DATE_OPTIONS = [
  [true, "Show"],
  [false, "Hide"],
] as const;

interface Props {
  settings: PublicSettings;
  onClose: () => void;
}

/** The few things worth changing: which model Lucid asks, how PDFs are signed, and the words to expect. */
export function SettingsDialog({ settings, onClose }: Props) {
  const [author, setAuthor] = useState(settings.author);
  const [footer, setFooter] = useState(settings.footerRight);
  const [pdf, setPdf] = useState<PdfStyle>(settings.pdf);
  // The PDF template: whether the person has their own, and whether its window is open.
  const [ownTemplate, setOwnTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);
  useEffect(() => {
    void window.lucid.template.get().then((t) => {
      setOwnTemplate(t.custom);
    });
  }, []);
  const changePdf = (change: Partial<PdfStyle>) => {
    setPdf((before) => ({ ...before, ...change }));
  };
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
      // The template window has its own Escape.
      if (e.key === "Escape" && !editingTemplate) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, editingTemplate]);

  const save = async () => {
    setSaving(true);
    setProblems([]);
    try {
      const result = await saveSettings({
        author,
        footerRight: footer,
        pdf,
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
    <>
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
              Applied at once. Mono is the default; the look of PDFs is set below. Block numbers
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
                The name LM Studio uses, like qwen/qwen3.8-27b. Load it with the pill in the top
                bar.
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

          <fieldset className="pdf-look">
            <legend>PDF look</legend>
            <Choice
              label="Paper"
              value={pdf.paper}
              options={PAPER_OPTIONS}
              onChange={(paper) => {
                changePdf({ paper });
              }}
            />
            <Choice
              label="Text size"
              value={pdf.fontSize}
              options={SIZE_OPTIONS}
              onChange={(fontSize) => {
                changePdf({ fontSize });
              }}
            />
            <Choice
              label="Typeface"
              value={pdf.font}
              options={TYPEFACE_OPTIONS}
              onChange={(font) => {
                changePdf({ font });
              }}
            />
            <Choice
              label="Margins"
              value={pdf.margins}
              options={MARGIN_OPTIONS}
              onChange={(margins) => {
                changePdf({ margins });
              }}
            />
            <div className="setting-row">
              <span id="accent-label">Accent colour</span>
              <div className="segmented" role="radiogroup" aria-labelledby="accent-label">
                <button
                  type="button"
                  role="radio"
                  aria-checked={pdf.accent === "none"}
                  onClick={() => {
                    changePdf({ accent: "none" });
                  }}
                >
                  None
                </button>
                {(Object.keys(ACCENT_COLORS) as Exclude<PdfStyle["accent"], "none">[]).map(
                  (name) => (
                    <button
                      key={name}
                      type="button"
                      role="radio"
                      className="swatch-button"
                      aria-checked={pdf.accent === name}
                      aria-label={name}
                      title={name}
                      onClick={() => {
                        changePdf({ accent: name });
                      }}
                    >
                      <span className="swatch" style={{ background: `#${ACCENT_COLORS[name]}` }} />
                    </button>
                  ),
                )}
              </div>
            </div>
            <Choice
              label="Headings"
              value={pdf.numberedHeadings}
              options={HEADING_OPTIONS}
              onChange={(numberedHeadings) => {
                changePdf({ numberedHeadings });
              }}
            />
            <Choice
              label="Date under the title"
              value={pdf.showDate}
              options={DATE_OPTIONS}
              onChange={(showDate) => {
                changePdf({ showDate });
              }}
            />
            <div className="setting-row">
              <span>Template</span>
              <span className="template-state">
                {ownTemplate ? "your own" : "built in"}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setEditingTemplate(true);
                  }}
                >
                  Edit template…
                </button>
              </span>
            </div>
            <small>
              Applies to the next PDF. A typeface other than Latin Modern is fetched the first time
              it is used, so that PDF needs the internet once. Auto picks Letter or A4 by where this
              computer is.
            </small>
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
                Names and tools that speech recognition gets wrong, like vLLM or Kubernetes. They
                are kept as written.
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
      {editingTemplate && (
        <TemplateDialog
          onClose={() => {
            setEditingTemplate(false);
          }}
          onChanged={setOwnTemplate}
        />
      )}
    </>
  );
}
