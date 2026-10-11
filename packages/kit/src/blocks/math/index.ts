import { z } from "zod";
import { clip } from "../../text";
import type { BlockSpec } from "../../spec";
import { statusSuffix, str, withStatus } from "../common";

/** LaTeX control sequences that read or write files or redefine the engine; never allowed in math. */
export const FORBIDDEN_LATEX = [
  "\\input",
  "\\include",
  "\\write",
  "\\openout",
  "\\immediate",
  "\\def",
  "\\catcode",
  "\\read",
  "\\csname",
] as const;

/** Problems with a LaTeX math string that would be unsafe or would break the document syntax. */
export function latexProblems(latex: string): string[] {
  const out: string[] = [];
  for (const word of FORBIDDEN_LATEX) {
    // Match the control word exactly, not a longer command that starts with it (\defeq is fine).
    if (new RegExp(`${word.replace(/\\/g, "\\\\")}(?![a-zA-Z])`).test(latex))
      out.push(`LaTeX command ${word} is not allowed`);
  }
  if (latex.includes("$$")) out.push("math must not contain $$");
  let depth = 0;
  for (let i = 0; i < latex.length; i++) {
    const escaped = i > 0 && latex.charAt(i - 1) === "\\";
    if (!escaped && latex.charAt(i) === "{") depth++;
    if (!escaped && latex.charAt(i) === "}") depth--;
    if (depth < 0) break; // a closing brace before its opening one
  }
  if (depth !== 0) out.push("math has unbalanced braces");
  return out;
}

export const mathBlock: BlockSpec = {
  type: "math",
  kind: "atom",
  propsSchema: withStatus({ latex: z.string().min(1) }),
  describe: [
    "A displayed formula for inference-engineering style notes (KV-cache size, FLOPs, bandwidth). Plain LaTeX math only.",
    "Define the symbols in a bullet list right after it. Never invent numbers.",
    "LMD: `$$` newline `M = 2 \\cdot L \\cdot H \\cdot d \\cdot b \\cdot T` newline `$$`",
  ].join("\n"),
  fixtures: [
    {
      id: "fx-math-1",
      type: "math",
      props: { latex: "M_{KV} = 2 \\cdot L \\cdot H \\cdot d_{head} \\cdot b \\cdot T" },
    },
    {
      id: "fx-math-2",
      type: "math",
      props: { latex: "\\text{hit rate} = \\frac{hits}{hits + misses}", status: "chosen" },
    },
  ],
  check: (props) => latexProblems(typeof props["latex"] === "string" ? props["latex"] : ""),
  outline: (block, detail) =>
    `math "${clip(str(block, "latex"), detail === "full" ? 200 : 60)}"${statusSuffix(block)}`,
  toMarkdown: (block) => `$$\n${str(block, "latex")}\n$$`,
};
