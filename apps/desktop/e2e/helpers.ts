import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type ElectronApplication, type Page } from "@playwright/test";

const PDFTOTEXT = "/opt/homebrew/bin/pdftotext";

/** Answers the Save dialog with a file in a temp folder, so Download PDF can be driven without a person. */
export async function autoSaveDialog(app: ElectronApplication): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "lucid-dl-")), "page.pdf");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath });
  }, path);
  return path;
}

/** Clicks Download PDF, waits for the file, and returns its text (when pdftotext is installed). */
export async function downloadPdf(
  page: Page,
  path: string,
  timeoutMs = 90_000,
): Promise<string | undefined> {
  await page.getByRole("button", { name: "Download PDF" }).click();
  try {
    await expect(page.getByText(/^Saved page\.pdf/)).toBeVisible({ timeout: timeoutMs });
  } catch (error) {
    // Say what the window said instead (the engine's own message, if it failed), so a failure on another machine can be read.
    const said = await page.locator(".export-note").allTextContents();
    throw new Error(`The PDF was not saved. The window says: ${JSON.stringify(said)}`, {
      cause: error,
    });
  }
  expect(readFileSync(path).subarray(0, 5).toString()).toBe("%PDF-");
  expect(statSync(path).size).toBeGreaterThan(3_000);
  return existsSync(PDFTOTEXT)
    ? execFileSync(PDFTOTEXT, [path, "-"], { encoding: "utf8" })
    : undefined;
}

/**
 * Makes the app window as big as the screen allows, the way a person uses it, and waits until the page really has that
 * size (no emulated viewport). Every spec calls this right after `firstWindow()`; a test that is about other sizes
 * (editing.spec.ts) resizes on purpose afterwards. Returns the page size.
 */
export async function maximizeWindow(
  app: ElectronApplication,
  page: Page,
): Promise<{ width: number; height: number }> {
  // The look follows the system by default: the tests run in the light theme unless one asks for the dark.
  await page.emulateMedia({ colorScheme: "light" });
  const area = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const work = screen.getPrimaryDisplay().workArea;
    if (win) {
      win.setBounds(work);
      win.maximize();
      win.show();
    }
    return work;
  });
  await expect
    .poll(() => page.evaluate(() => window.innerWidth), { message: "the window is maximized" })
    .toBeGreaterThanOrEqual(area.width - 40);
  await expect
    .poll(() => page.evaluate(() => window.innerHeight))
    .toBeGreaterThanOrEqual(area.height - 140);
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
}

/** Opens the History panel unless it is open already: a wide (maximized) window opens it by itself. */
export async function showHistory(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: /^History/ });
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  await expect(page.getByRole("complementary", { name: "History" })).toBeVisible();
}
