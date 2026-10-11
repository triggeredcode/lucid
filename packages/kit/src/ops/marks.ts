import { aliasKey, type Inline, type InlineStyles } from "@lucid/core";

type TextRun = Extract<Inline, { type: "text" }>;

const sameStyles = (a: InlineStyles, b: InlineStyles): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof InlineStyles>;
  for (const k of keys) if ((a[k] ?? false) !== (b[k] ?? false)) return false;
  return true;
};

function merge(runs: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const run of runs) {
    const last = out.at(-1);
    if (run.type === "text" && run.text.length === 0) continue;
    if (last?.type === "text" && run.type === "text" && sameStyles(last.styles, run.styles)) {
      out[out.length - 1] = { ...last, text: last.text + run.text };
    } else out.push(run);
  }
  return out;
}

/** Where `match` is in the plain text, ignoring case and extra spaces; "Postgres" also finds "PostgreSQL". */
export function findMatch(text: string, match: string): { start: number; end: number } | undefined {
  const words = match.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = words.map(escape).join("\\s+");
  // Whole words first, so "Postgres" never marks half of "PostgreSQL".
  const whole = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu").exec(text);
  if (whole) return { start: whole.index, end: whole.index + whole[0].length };
  // Then a word or phrase that means the same ("Postgres" for "PostgreSQL", "k8s" for "Kubernetes").
  const wanted = aliasKey(match);
  const tokens = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)];
  for (let i = 0; i < tokens.length; i++) {
    for (const n of [1, 2, 3]) {
      const first = tokens[i];
      const last = tokens[i + n - 1];
      if (!first || !last) continue;
      const start = first.index;
      const end = last.index + last[0].length;
      if (aliasKey(text.slice(start, end)) === wanted) return { start, end };
    }
  }
  // Last, any occurrence.
  const any = new RegExp(body, "i").exec(text);
  return any ? { start: any.index, end: any.index + any[0].length } : undefined;
}

/**
 * Turns an inline style on or off for `match` (the first occurrence in the text) or for everything (`match` null).
 * Math and links are left alone. Returns undefined when `match` is not in the text.
 */
export function applyMark(
  content: readonly Inline[],
  match: string | null,
  mark: keyof InlineStyles,
  on: boolean,
): Inline[] | undefined {
  const set = (styles: InlineStyles): InlineStyles => {
    if (on) return { ...styles, [mark]: true };
    return Object.fromEntries(Object.entries(styles).filter(([k]) => k !== mark));
  };

  if (match === null) {
    return merge(
      content.map((run) => (run.type === "text" ? { ...run, styles: set(run.styles) } : run)),
    );
  }
  // The text of the text runs only, with the offset of each run in it.
  let text = "";
  const offsets: number[] = [];
  for (const run of content) {
    offsets.push(text.length);
    if (run.type === "text") text += run.text;
  }
  const found = findMatch(text, match);
  if (!found) return undefined;

  const out: Inline[] = [];
  content.forEach((run, i) => {
    if (run.type !== "text") {
      out.push(run);
      return;
    }
    const from = offsets[i] ?? 0;
    const to = from + run.text.length;
    const a = Math.max(found.start, from);
    const b = Math.min(found.end, to);
    if (a >= b) {
      out.push(run);
      return;
    }
    const piece = (text: string, styles: InlineStyles): TextRun => ({ type: "text", text, styles });
    out.push(piece(run.text.slice(0, a - from), run.styles));
    out.push(piece(run.text.slice(a - from, b - from), set(run.styles)));
    out.push(piece(run.text.slice(b - from), run.styles));
  });
  return merge(out);
}
