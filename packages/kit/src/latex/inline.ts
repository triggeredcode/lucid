import type { Inline } from "@lucid/core";
import { latexProblems } from "../blocks/math";
import { escapeLatex } from "./escape";

/** A URL is escaped only for the characters that break `\href`. */
const escapeUrl = (url: string): string => url.replace(/([%#\\{}])/g, "\\$1");

/** Inline runs as LaTeX text. Unsafe inline math is shown as escaped text instead of being passed through. */
export function inlineToLatex(inlines: readonly Inline[] | undefined): string {
  return (inlines ?? [])
    .map((run) => {
      if (run.type === "mathInline") {
        return latexProblems(run.latex).length === 0
          ? `\\(${run.latex}\\)`
          : escapeLatex(`$${run.latex}$`);
      }
      if (run.type === "link") {
        return `\\href{${escapeUrl(run.href)}}{${run.content.map((c) => escapeLatex(c.text)).join("")}}`;
      }
      const { styles } = run;
      let out = styles.code ? `\\texttt{${escapeLatex(run.text)}}` : escapeLatex(run.text);
      if (out.length === 0) return out;
      if (styles.highlight) out = `\\colorbox{yellow!40}{${out}}`;
      if (styles.underline) out = `\\uline{${out}}`;
      if (styles.strike) out = `\\sout{${out}}`;
      if (styles.italic) out = `\\textit{${out}}`;
      if (styles.bold) out = `\\textbf{${out}}`;
      return out;
    })
    .join("");
}
