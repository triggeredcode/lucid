import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Block } from "@lucid/core";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { autoSaveDialog, downloadPdf, maximizeWindow } from "./helpers";

/**
 * The PDF template (`lucid.sty`) can be replaced in Settings: the next PDF is typeset with it. One that does not work falls back
 * to the built-in one and says so, and the built-in one can be brought back.
 */
const text = (value: string) => [{ type: "text" as const, text: value, styles: {} }];
const blocks: Block[] = [
  { id: "h", type: "heading", props: { level: 1 }, content: text("Caching strategies") },
  { id: "p", type: "paragraph", props: {}, content: text("Hot keys stay in memory.") },
];

const dialog = (page: Page) => page.getByRole("dialog", { name: "PDF template" });
const box = (page: Page) => dialog(page).getByRole("textbox", { name: "Template text" });

async function openTemplate(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Settings/ }).click();
  await page.getByRole("button", { name: "Edit template…" }).click();
  await expect(dialog(page)).toBeVisible();
  // The text has loaded (the box is disabled until it has).
  await expect(box(page)).toBeEnabled();
}

test("a template of one's own is used for the PDF, a broken one falls back and says so, and it can be reset", async () => {
  test.setTimeout(240_000);
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: mkdtempSync(join(tmpdir(), "lucid-home-")) },
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
    const path = await autoSaveDialog(app);

    // The one that comes with Lucid: "Page 1" in the footer.
    expect(await downloadPdf(page, path)).toMatch(/Page 1/);

    // Their own: the footer says "Sheet".
    await openTemplate(page);
    const builtIn = await box(page).inputValue();
    expect(builtIn).toContain("\\ProvidesPackage{lucid}");
    expect(builtIn).toContain("Page \\thepage");
    await box(page).fill(builtIn.replaceAll("Page \\thepage", "Sheet \\thepage"));
    await dialog(page).getByRole("button", { name: "Save template" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator(".template-state")).toContainText("your own");
    await page.keyboard.press("Escape"); // the Settings window
    const own = await downloadPdf(page, path);
    expect(own).toMatch(/Sheet 1/);
    expect(own).not.toMatch(/Page 1/);

    // Broken: the PDF is made with the built-in one, and the note says why.
    await openTemplate(page);
    await box(page).fill("\\ProvidesPackage{lucid}\n\\thisCommandDoesNotExist\n");
    await dialog(page).getByRole("button", { name: "Save template" }).click();
    await expect(dialog(page)).toBeHidden();
    await page.keyboard.press("Escape");
    const fallback = await downloadPdf(page, path);
    expect(fallback).toMatch(/Page 1/);
    await expect(page.locator(".export-note")).toContainText("Your PDF template did not work");

    // Back to the built-in one.
    await openTemplate(page);
    const reset = dialog(page).getByRole("button", { name: "Use the built-in template" });
    await reset.click();
    await dialog(page)
      .getByRole("button", { name: /^Really go back/ })
      .click();
    await expect(box(page)).toHaveValue(builtIn);
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".template-state")).toContainText("built in");
    await page.keyboard.press("Escape");
    expect(await downloadPdf(page, path)).toMatch(/Page 1/);
    await expect(page.locator(".export-note")).not.toContainText("did not work");
  } finally {
    await app.close();
  }
});

test("an empty template is refused with a reason", async () => {
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: mkdtempSync(join(tmpdir(), "lucid-home-")) },
  });
  try {
    const page = await app.firstWindow();
    await maximizeWindow(app, page);
    await openTemplate(page);
    await box(page).fill("   ");
    await dialog(page).getByRole("button", { name: "Save template" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("is empty");
    await expect(dialog(page)).toBeVisible();
    // Escape closes the template window only, and then Settings.
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
  } finally {
    await app.close();
  }
});
