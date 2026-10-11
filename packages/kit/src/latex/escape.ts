/** Plain-text characters to LaTeX: specials escaped, common symbols as math, quotes typeset. */
const MAP: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  "^": "\\textasciicircum{}",
  _: "\\_",
  "%": "\\%",
  "~": "\\textasciitilde{}",
  "<": "\\textless{}",
  ">": "\\textgreater{}",
  "|": "\\textbar{}",
  "→": "$\\rightarrow$",
  "←": "$\\leftarrow$",
  "↔": "$\\leftrightarrow$",
  "⇒": "$\\Rightarrow$",
  "≈": "$\\approx$",
  "≠": "$\\neq$",
  "≤": "$\\leq$",
  "≥": "$\\geq$",
  "×": "$\\times$",
  "≫": "$\\gg$",
  "≪": "$\\ll$",
  "·": "$\\cdot$",
  "−": "$-$",
  µ: "$\\mu$",
  "°": "$^{\\circ}$",
  "✓": "\\ding{51}",
  "✗": "\\ding{55}",
  "…": "\\ldots{}",
  " ": "~",
};

/** Escape text for use in running LaTeX text. Never throws; every input gives compilable output. */
export function escapeLatex(text: string): string {
  let out = "";
  let prev = " ";
  for (const ch of text.replace(/\r\n?|\n/g, " ")) {
    if (ch === '"') {
      // Straight double quotes become typeset pairs: opening after whitespace or an opening bracket.
      out += /[\s([{]/.test(prev) ? "``" : "''";
    } else if (ch === "\t") {
      out += " ";
    } else if (ch.charCodeAt(0) < 32) {
      // Other control characters have no meaning in notes and would break the engine.
    } else {
      out += MAP[ch] ?? ch;
    }
    prev = ch;
  }
  return out;
}
