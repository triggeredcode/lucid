import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LUCID_STY } from "@lucid/kit";
import { describe, expect, it } from "vitest";
import {
  TEMPLATE_MAX_BYTES,
  TemplateError,
  loadTemplate,
  readCustomTemplate,
  resetTemplate,
  saveTemplate,
  templatePath,
} from "./template";

const library = () => mkdtemp(join(tmpdir(), "lucid-tpl-"));

describe("the PDF template", () => {
  it("is the one that comes with Lucid until the person saves their own", async () => {
    const dir = await library();
    expect(await loadTemplate(dir)).toEqual({ custom: false, text: LUCID_STY });
    expect(await readCustomTemplate(dir)).toBeUndefined();
  });

  it("is kept as written, in the library's own folder, and read back", async () => {
    const dir = await library();
    const mine = `${LUCID_STY.replace("Page \\thepage", "Sheet \\thepage")}\n% mine\n`;
    expect(await saveTemplate(dir, mine)).toEqual({ custom: true, text: mine });
    expect(await readFile(templatePath(dir), "utf8")).toBe(mine);
    expect(await loadTemplate(dir)).toEqual({ custom: true, text: mine });
    expect(await readCustomTemplate(dir)).toBe(mine);
    // No half-written file is left beside it.
    expect(await readdir(join(dir, ".lucid", "template"))).toEqual(["lucid.sty"]);
  });

  it("goes back to the built-in one on reset, and reset with nothing to reset is fine", async () => {
    const dir = await library();
    await saveTemplate(dir, "% mine");
    expect(await resetTemplate(dir)).toEqual({ custom: false, text: LUCID_STY });
    expect(await readCustomTemplate(dir)).toBeUndefined();
    expect(await resetTemplate(dir)).toEqual({ custom: false, text: LUCID_STY });
  });

  it("refuses an empty one, a very long one and one that is not text, and changes nothing", async () => {
    const dir = await library();
    await saveTemplate(dir, "% mine");
    const bad = async (text: unknown) => saveTemplate(dir, text).catch((e: unknown) => e);
    expect(await bad("   \n")).toBeInstanceOf(TemplateError);
    expect(await bad("x".repeat(TEMPLATE_MAX_BYTES + 1))).toBeInstanceOf(TemplateError);
    expect(await bad("a\0b")).toBeInstanceOf(TemplateError);
    expect(await bad(42)).toBeInstanceOf(TemplateError);
    expect(await bad(undefined)).toBeInstanceOf(TemplateError);
    expect(await readCustomTemplate(dir)).toBe("% mine");
  });

  it("ignores a file that has nothing in it", async () => {
    const dir = await library();
    await saveTemplate(dir, "% mine");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(templatePath(dir), "  \n", "utf8");
    expect(await loadTemplate(dir)).toEqual({ custom: false, text: LUCID_STY });
  });
});
