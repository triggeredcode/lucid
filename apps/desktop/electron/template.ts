import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LUCID_STY } from "@lucid/kit";
import type { TemplateState } from "./ipc/types";

/**
 * The PDF template: `lucid.sty`, the file that sets the house style (the fonts, the title, the footer, the tables, the boxes).
 * A person can replace it in Settings; the copy is kept in `<library>/.lucid/template/lucid.sty` and is used for every PDF
 * until it is reset. What the Settings choices say (paper, typeface, margins, accent…) is applied after it.
 */
export const TEMPLATE_MAX_BYTES = 64 * 1024;

export const templatePath = (libraryDir: string): string =>
  join(libraryDir, ".lucid", "template", "lucid.sty");

export class TemplateError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("; "));
    this.name = "TemplateError";
  }
}

/** The person's own template, or nothing (never saved, reset, or the file cannot be read). */
export async function readCustomTemplate(libraryDir: string): Promise<string | undefined> {
  try {
    const text = await readFile(templatePath(libraryDir), "utf8");
    return text.trim().length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

export async function loadTemplate(libraryDir: string): Promise<TemplateState> {
  const custom = await readCustomTemplate(libraryDir);
  return custom === undefined ? { custom: false, text: LUCID_STY } : { custom: true, text: custom };
}

/** Checks the text and keeps it (the whole file or nothing: a failure changes nothing). */
export async function saveTemplate(libraryDir: string, text: unknown): Promise<TemplateState> {
  if (typeof text !== "string") throw new TemplateError(["the template must be text"]);
  const problems: string[] = [];
  if (text.trim().length === 0)
    problems.push("the template is empty; use Reset to go back to the built-in one");
  if (Buffer.byteLength(text, "utf8") > TEMPLATE_MAX_BYTES)
    problems.push(`the template is longer than ${String(TEMPLATE_MAX_BYTES / 1024)} KB`);
  if (text.includes("\0")) problems.push("the template contains a character that is not text");
  if (problems.length > 0) throw new TemplateError(problems);
  const file = templatePath(libraryDir);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${String(process.pid)}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
  return { custom: true, text };
}

/** Back to the template that comes with Lucid. */
export async function resetTemplate(libraryDir: string): Promise<TemplateState> {
  await rm(templatePath(libraryDir), { force: true });
  return { custom: false, text: LUCID_STY };
}
