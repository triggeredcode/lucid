import type { Inline } from "@lucid/core";

/** Plain text of inline runs (links keep their text, math keeps its LaTeX). */
export function inlineToPlain(inlines: readonly Inline[] | undefined): string {
  return (inlines ?? [])
    .map((run) => {
      switch (run.type) {
        case "text":
          return run.text;
        case "link":
          return run.content.map((c) => c.text).join("");
        case "mathInline":
          return run.latex;
      }
    })
    .join("");
}

/** One plain text run. */
export const textRun = (text: string): Inline => ({ type: "text", text, styles: {} });

/**
 * Characters that would be read as Markdown or LMD syntax get a backslash. The LMD parser must honour
 * these escapes so serialize -> parse is lossless.
 */
export function escapeInline(text: string): string {
  return text.replace(/[\\*_~`$[\]{}]/g, "\\$&").replace(/==/g, "\\=\\=");
}

/** Outermost first: runs are nested in this order, so equal style sets always produce the same text. */
const STYLE_ORDER = [
  { style: "bold", token: "**" },
  { style: "underline", token: "__" },
  { style: "strike", token: "~~" },
  { style: "highlight", token: "==" },
  { style: "italic", token: "*" },
] as const;

/**
 * Inline runs as Markdown/LMD: **bold**, *italic*, __underline__, ~~strike~~, ==highlight==, `code`, $math$, links.
 * Styles are nested rather than wrapped per run, so `***x***` and `**a *b* c**` come out right; whitespace is kept
 * outside the markers (a marker next to a space would not be read back as a marker).
 */
export function inlineToMarkdown(inlines: readonly Inline[] | undefined): string {
  let out = "";
  const stack: (typeof STYLE_ORDER)[number][] = [];
  const closeTo = (depth: number) => {
    while (stack.length > depth) {
      const top = stack.pop();
      const trailing = /\s*$/.exec(out)?.[0] ?? "";
      out = `${out.slice(0, out.length - trailing.length)}${top?.token ?? ""}${trailing}`;
    }
  };

  for (const run of inlines ?? []) {
    if (run.type !== "text") {
      closeTo(0);
      out +=
        run.type === "mathInline"
          ? `$${run.latex}$`
          : `[${run.content.map((c) => escapeInline(c.text)).join("")}](${run.href})`;
      continue;
    }
    const want = STYLE_ORDER.filter((s) => run.styles[s.style]);
    let common = 0;
    while (common < stack.length && stack[common]?.style === want[common]?.style) common++;
    const core = run.styles.code ? run.text : escapeInline(run.text);
    const lead = /^\s*/.exec(core)?.[0] ?? "";
    // A whitespace-only run keeps the current nesting; it cannot carry a marker.
    if (lead.length === core.length) {
      out += core;
      continue;
    }
    closeTo(common);
    out += lead;
    for (const s of want.slice(common)) {
      out += s.token;
      stack.push(s);
    }
    const body = core.slice(lead.length);
    out += run.styles.code ? `\`${body}\`` : body;
  }
  closeTo(0);
  return out;
}

/** Shorten text for outlines: collapse whitespace and cut with an ellipsis, appending the original length. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max
    ? flat
    : `${flat.slice(0, max).trimEnd()}… (${String(flat.length)} chars)`;
}
