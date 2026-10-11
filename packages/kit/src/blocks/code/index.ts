import { z } from "zod";
import type { BlockSpec } from "../../spec";
import { statusSuffix, str, withStatus } from "../common";

const lineCount = (code: string): number => (code.length === 0 ? 0 : code.split("\n").length);

export const codeBlock: BlockSpec = {
  type: "code",
  kind: "atom",
  propsSchema: withStatus({
    language: z
      .string()
      .regex(/^[a-z0-9+#._-]*$/, "use a lowercase language name such as python or sql")
      .default(""),
    code: z.string(),
  }),
  describe: [
    "A code or command snippet. Rare in these notes; use it for an API request, a SQL query or a shell command.",
    "LMD: a fenced block with the language: ```sql",
  ].join("\n"),
  fixtures: [
    {
      id: "fx-code-1",
      type: "code",
      props: { language: "sql", code: "SELECT * FROM urls WHERE short_code = $1;" },
    },
    {
      id: "fx-code-2",
      type: "code",
      props: { language: "", code: "GET /api/v1/short/abc\nHost: example.com" },
    },
  ],
  outline: (block, detail) => {
    const code = str(block, "code");
    const language = str(block, "language");
    const head = `code${language ? ` ${language}` : ""} (${String(lineCount(code))} line${lineCount(code) === 1 ? "" : "s"})${statusSuffix(block)}`;
    return detail === "full" && code.length > 0 ? `${head}: ${code.split("\n")[0] ?? ""}` : head;
  },
  toMarkdown: (block) => {
    const code = str(block, "code");
    // A fence one backtick longer than any run inside the code can never be closed early.
    const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((r) => r.length));
    const fence = "`".repeat(longest + 1);
    return `${fence}${str(block, "language")}\n${code}\n${fence}`;
  },
};
