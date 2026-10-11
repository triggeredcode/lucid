import { Icon } from "../ui/Icon";
import { FORMATS, META_LABEL, getFormat, type MetaField } from "@lucid/kit";
import { useEffect, useRef, useState } from "react";

interface Props {
  format: string | undefined;
  info: Record<string, string>;
  /** How many of the format's sections are not in the page yet. */
  missing: number;
  onChange: (format: string | undefined, info: Record<string, string>) => void;
  onAddSections: () => void;
}

/** The page's note format, shown in the top bar. It decides the fields under the title, formula numbers and which sections empty pages show. */
export function FormatChip({ format, info, missing, onChange, onAddSections }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = getFormat(format);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className="format-chip" ref={box}>
      <button
        type="button"
        className="chip"
        aria-expanded={open}
        title="The kind of note this page is"
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <Icon name="page" size={14} /> {current ? current.name : "Blank page"}{" "}
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div className="format-pop" role="dialog" aria-label="Note format">
          <div role="radiogroup" aria-label="Note format">
            {[{ id: "", name: "Blank page" }, ...FORMATS].map((f) => (
              <label key={f.id} className="fp-option">
                <input
                  type="radio"
                  name="note-format"
                  checked={(format ?? "") === f.id}
                  onChange={() => {
                    onChange(f.id === "" ? undefined : f.id, info);
                  }}
                />
                {f.name}
              </label>
            ))}
          </div>
          {current && current.meta.length > 0 && (
            <div className="fp-fields">
              <p className="fp-sub">Shown under the title in the PDF:</p>
              {current.meta.map((field: MetaField) => (
                <label key={field}>
                  <span>{META_LABEL[field]}</span>
                  <input
                    value={info[field] ?? ""}
                    onChange={(e) => {
                      onChange(format, { ...info, [field]: e.target.value });
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          {current && missing > 0 && (
            <button type="button" className="ghost small" onClick={onAddSections}>
              Add the {missing === 1 ? "missing section" : `${String(missing)} missing sections`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
