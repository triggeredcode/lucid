/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registry } from "../defaultRegistry";
import { FORMATS, skeleton, type Format } from "../formats";
import { LUCID_STY, renderDocument } from "./index";

// Integration: every block type's fixtures, with figures, compile to a real PDF with Tectonic (skipped when the tools are
// not installed). This is what proves the LaTeX the model's content turns into is valid.
const tools = [
  "/opt/homebrew/bin/tectonic",
  "/opt/homebrew/bin/rsvg-convert",
  "/opt/homebrew/bin/pdftotext",
];
const have = tools.every((t) => existsSync(t));
const [TECTONIC, RSVG, PDFTOTEXT] = tools as [string, string, string];

function compile(
  title: string,
  blocks: ReturnType<typeof registry.validateBlock>[],
  extraSty = "",
  style: { format?: Format; info?: Record<string, string> } = {},
): { pdf: string; text: string } {
  const dir = mkdtempSync(join(tmpdir(), "lucid-tex-"));
  mkdirSync(join(dir, "figures"));
  const first = renderDocument({
    title,
    author: "Asha",
    footerRight: "Study notes",
    doc: { blocks },
    ...style,
  });
  const rendered: Record<string, string> = {};
  for (const f of first.figures) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120" xml:space="preserve"><rect width="400" height="120" fill="white" stroke="black"/><text x="20" y="65" font-size="18" font-family="Helvetica">${f.kind} ${f.blockId}</text></svg>`;
    writeFileSync(join(dir, f.file.replace(".pdf", ".svg")), svg);
    execFileSync(RSVG, [
      "-f",
      "pdf1.4",
      "-o",
      join(dir, f.file),
      join(dir, f.file.replace(".pdf", ".svg")),
    ]);
    rendered[f.blockId] = f.file;
  }
  const { tex } = renderDocument(
    { title, author: "Asha", footerRight: "Study notes", doc: { blocks }, ...style },
    rendered,
  );
  writeFileSync(join(dir, "lucid.sty"), LUCID_STY + extraSty);
  writeFileSync(join(dir, "main.tex"), tex);
  execFileSync(TECTONIC, ["-X", "compile", "main.tex", "--outdir", ".", "--keep-logs"], {
    cwd: dir,
    stdio: "pipe",
    timeout: 240_000,
  });
  const pdf = join(dir, "main.pdf");
  if (process.env["LUCID_KEEP_PDF"]) execFileSync("cp", [pdf, process.env["LUCID_KEEP_PDF"]]);
  return { pdf, text: execFileSync(PDFTOTEXT, [pdf, "-"], { encoding: "utf8" }) };
}

describe.skipIf(!have)("LaTeX compiles with Tectonic", () => {
  it("every fixture of every block type compiles into one PDF containing its text", () => {
    const blocks = [...registry.specs.values()]
      .flatMap((s) => s.fixtures)
      .map((b) => registry.validateBlock(b));
    const { text } = compile("All blocks", blocks);
    for (const needle of [
      "All blocks",
      "Requirements",
      "PostgreSQL",
      "DynamoDB",
      "Database choice",
      "Property",
      "Request flow",
    ]) {
      expect(text, needle).toContain(needle);
    }
    expect(text).toContain("Page 1");
    expect(text).toContain("Study notes");
  }, 300_000);

  it("survives hostile and unusual text", () => {
    const text = [
      "Cost is 100% of $5 & 20% #1 {braces} ~tilde^ back\\slash under_score",
      "Unicode: café, naïve, → ≈ ≥ ✓ — “curly” 'quotes'",
      '"straight" and (“mixed”)',
    ];
    const blocks = text.map((t, i) =>
      registry.validateBlock({
        id: `h${String(i)}`,
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: t, styles: {} }],
      }),
    );
    blocks.push(
      registry.validateBlock({
        id: "code",
        type: "code",
        props: { language: "python", code: "def f(x):\n    return x  # café → ok\n" },
      }),
    );
    const out = compile("Hostile: 50% & #1 _title_", blocks);
    expect(out.text).toContain("Cost is 100%");
    expect(out.text).toContain("café");
    expect(out.text).toContain("def f(x):");
  }, 300_000);
});

/** A page of each note format with a few sections filled in and the rest left empty, as a person leaves them. */
function filled(format: Format) {
  const para = (text: string) => ({
    id: `p-${format.id}-${text.length}`,
    type: "paragraph" as const,
    props: {},
    content: [{ type: "text" as const, text, styles: {} }],
  });
  const fx = (type: "table" | "diagram" | "math" | "callout" | "bulletListItem", id: string) => {
    const found = registry.get(type).fixtures.find((f) => f.id === id);
    if (!found) throw new Error(`no fixture ${id}`);
    return { ...found, id: `${found.id}-${format.id}` };
  };
  const out: ReturnType<typeof registry.validateBlock>[] = [];
  const heads = skeleton(format, () => `h-${format.id}-${String(out.length)}`);
  const content: Record<string, ReturnType<typeof registry.validateBlock>[]> = {
    "concept-note": [
      registry.validateBlock(
        para('A bloom filter answers "is this key possibly in the set?" with no false negatives.'),
      ),
      registry.validateBlock(fx("diagram", "fx-diagram-1")),
    ],
    "system-design": [
      registry.validateBlock(fx("bulletListItem", "fx-bullet-1")),
      registry.validateBlock(fx("diagram", "fx-diagram-1")),
      registry.validateBlock(fx("callout", "fx-callout-3")),
    ],
    comparison: [
      registry.validateBlock(para("Choosing a store for the session data.")),
      registry.validateBlock(fx("table", "fx-table-1")),
    ],
    "inference-math": [
      registry.validateBlock(para("The KV cache grows with every token.")),
      registry.validateBlock(fx("math", "fx-math-1")),
      registry.validateBlock(fx("table", "fx-table-1")),
    ],
    benchmark: [
      registry.validateBlock(para("Does batching raise throughput without hurting p50 latency?")),
      registry.validateBlock(fx("table", "fx-table-1")),
    ],
  };
  // Fill sections 1, 3 and 5; leave the others as empty headings.
  const sections = [0, 2, 4];
  const items = content[format.id] ?? [];
  heads.forEach((h, i) => {
    out.push(registry.validateBlock(h));
    const at = sections.indexOf(i);
    const mine = at < 0 ? [] : items.filter((_, j) => j % sections.length === at);
    out.push(...mine);
  });
  return out;
}

describe.skipIf(!have)("every note format compiles with Tectonic", () => {
  for (const format of FORMATS) {
    it(`${format.name}: meta lines, filled sections, no empty ones`, () => {
      const blocks = filled(format);
      const info = {
        source: "System Design Interview, Alex Xu",
        book: "Designing Data-Intensive Applications",
        chapter: "Chapter 5: Replication",
        date: "October 2026",
        hardware: "Apple M4 Max, 64 GB",
      };
      const { text, pdf } = compile(`${format.name} sample`, blocks, "", { format, info });
      // `LUCID_SAMPLES_DIR=docs/format-samples pnpm exec vitest run --project @lucid/kit compile` keeps the PDFs to look at.
      const keep = process.env["LUCID_SAMPLES_DIR"];
      if (keep) execFileSync("cp", [pdf, join(keep, `format-${format.id}.pdf`)]);
      expect(text).toContain(`${format.name} sample`);
      // The first section heading is printed, an unfilled one is not.
      expect(text).toContain(format.sections[0]?.heading ?? "?");
      expect(text).not.toContain(format.sections[1]?.heading ?? "?");
      for (const field of format.meta) expect(text, field).toContain(info[field]);
      for (const other of ["source", "book", "chapter", "date", "hardware"] as const)
        if (!format.meta.includes(other)) expect(text, other).not.toContain(info[other]);
    }, 300_000);
  }
});
