import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND_DOC } from "@lucid/llm";
import { _electron as electron, expect, test } from "@playwright/test";
import { autoSaveDialog, maximizeWindow, openPageActions } from "./helpers";

test("the page can be saved as Markdown, from the button and by voice", async () => {
  test.setTimeout(60_000);
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  try {
    const page = await app.firstWindow();
    await maximizeWindow(app, page);
    await page.evaluate(async (doc) => {
      const file = await window.lucid.pages.create("Request flow and databases");
      await window.lucid.pages.save({ ...file, doc });
    }, COMMAND_DOC);
    await page.reload();
    await expect(page.locator(".page-editor")).toContainText("MongoDB");

    const path = await autoSaveDialog(app);
    await openPageActions(page);
    await page.getByRole("button", { name: "Markdown" }).click();
    await expect(page.getByText(/^Saved page\.pdf/)).toBeVisible();
    const md = readFileSync(path, "utf8");
    expect(md.startsWith("# Request flow and databases\n")).toBe(true);
    expect(md).toContain("Caching reduces database load.");
    expect(md).toContain("```mermaid");
    expect(md).toContain("| Property | SQL | NoSQL |");
    expect(md).toContain("| Schema | Fixed | Flexible |");
    expect(md).toContain("- PostgreSQL");
    expect(md.endsWith("\n")).toBe(true);

    // By voice, in Input mode: handled without the model.
    const again = await autoSaveDialog(app);
    const bar = page.getByLabel("Dictate or type your notes");
    await bar.fill("export as markdown");
    await bar.press("Enter");
    await expect.poll(() => readFileSync(again, "utf8").length).toBeGreaterThan(100);
    expect(readFileSync(again, "utf8")).toBe(md);
  } finally {
    await app.close();
  }
});
