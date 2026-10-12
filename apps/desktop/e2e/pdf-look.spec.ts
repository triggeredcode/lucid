import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Block } from "@lucid/core";
import { _electron as electron, expect, test } from "@playwright/test";
import { autoSaveDialog, downloadPdf, maximizeWindow } from "./helpers";

/**
 * The PDF look (paper, text size, typeface, margins, accent, numbering, date) is chosen in Settings and is what the next PDF
 * has. The PDF is made by the real engine; the tools that read it back are poppler's.
 */
const PDFINFO = "/opt/homebrew/bin/pdfinfo";
const PDFFONTS = "/opt/homebrew/bin/pdffonts";

const text = (value: string) => [{ type: "text" as const, text: value, styles: {} }];
const blocks: Block[] = [
  { id: "h", type: "heading", props: { level: 1 }, content: text("Caching strategies") },
  {
    id: "p",
    type: "paragraph",
    props: {},
    content: text("Hot keys stay in memory, so most reads never reach the database."),
  },
];

test("the look chosen in Settings is the look of the PDF", async () => {
  test.skip(!existsSync(PDFINFO) || !existsSync(PDFFONTS), "needs poppler to read the PDF back");
  // A typeface other than the house one is fetched the first time it is used.
  test.setTimeout(420_000);
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  try {
    const page = await app.firstWindow();
    await maximizeWindow(app, page);
    await page.evaluate(async (doc: Block[]) => {
      const file = await window.lucid.pages.create("Caching");
      await window.lucid.pages.save({ ...file, doc: { blocks: doc } });
    }, blocks);
    await page.reload();
    await page
      .getByRole("navigation", { name: "Pages" })
      .getByRole("button", { name: /Caching/ })
      .click();

    await page.getByRole("button", { name: /Settings/ }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    // The "PDF look" group (Hide is also a choice for the block numbers above it).
    const look = dialog.locator(".pdf-look");
    for (const name of ["A4", "12 pt", "Times", "navy", "Plain", "Hide"])
      await look.getByRole("radio", { name, exact: true }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    // Kept in the settings file, with what was not changed still at its default.
    const stored = JSON.parse(readFileSync(join(home, ".lucid", "settings.json"), "utf8")) as {
      pdf: Record<string, unknown>;
    };
    expect(stored.pdf).toEqual({
      paper: "a4",
      fontSize: 12,
      font: "times",
      margins: "normal",
      accent: "navy",
      numberedHeadings: false,
      showDate: false,
    });

    const path = await autoSaveDialog(app);
    const words = await downloadPdf(page, path, 400_000);
    expect(execFileSync(PDFINFO, [path], { encoding: "utf8" })).toMatch(/\(A4\)/);
    expect(execFileSync(PDFFONTS, [path], { encoding: "utf8" })).toContain("TeXGyreTermes");
    expect(words).toContain("Caching strategies");
    // Plain headings: no number in front, and no date under the title.
    expect(words).not.toMatch(/1\s+Caching strategies/);
    expect(words).not.toMatch(/\b20\d\d\b/);

    // The dialog shows what was chosen when it is opened again.
    await page.getByRole("button", { name: /Settings/ }).click();
    await expect(look.getByRole("radio", { name: "Times", exact: true })).toBeChecked();
    await expect(look.getByRole("radio", { name: "navy", exact: true })).toBeChecked();
  } finally {
    await app.close();
  }
});
