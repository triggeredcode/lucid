import type { LucidDoc } from "@lucid/core";
import { collectFigures } from "@lucid/kit";
import { pdfBox } from "./fit";
import { renderFitted } from "./mermaid";

export type PdfMade =
  { ok: true; pdf: Uint8Array; warnings: string[] } | { ok: false; message: string };

/** Turns the page into the real PDF (typeset with Tectonic). */
export async function makePdf(
  pageId: string,
  title: string,
  doc: LucidDoc,
  style: { format?: string | undefined; info?: Record<string, string> | undefined } = {},
): Promise<PdfMade> {
  try {
    const figures: Record<string, string> = {};
    // A big diagram is drawn in the direction that has to be shrunk least to fit the page, not squeezed until it cannot be read.
    const box = pdfBox();
    for (const f of collectFigures(doc.blocks))
      figures[f.blockId] = (await renderFitted(f.mermaid, "pdf", box)).svg;
    const result = await window.lucid.pdf.compile({
      pageId,
      title,
      doc,
      figures,
      format: style.format,
      info: style.info,
    });
    if (result.ok) return { ok: true, pdf: result.pdf, warnings: result.warnings };
    if (result.cancelled) return { ok: false, message: "Another PDF was started." };
    return { ok: false, message: result.message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** A file name for the PDF: the title, without characters a file system dislikes. */
export function pdfFileName(title: string): string {
  const clean = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${clean || "Untitled"}.pdf`;
}
