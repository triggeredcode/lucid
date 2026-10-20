import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { maximizeWindow } from "./helpers";

test("an automatic backup can be restored as a new page without replacing the current page", async () => {
  test.setTimeout(60_000);
  const home = mkdtempSync(join(tmpdir(), "lucid-backup-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);

  try {
    const originalId = await page.evaluate(async () => {
      const original = await window.lucid.pages.create("Original");
      await window.lucid.pages.save({ ...original, title: "Current" });
      return original.id;
    });
    await page.reload();
    await expect(page.getByLabel("Page title")).toHaveValue("Current");

    await page.getByRole("button", { name: "Backups" }).click();
    const dialog = page.getByRole("dialog", { name: "Automatic backups" });
    await expect(dialog).toContainText("never replaces this one");
    await expect(dialog).toContainText("Original");
    await dialog.getByRole("button", { name: "Restore as copy" }).click();

    await expect(page.getByLabel("Page title")).toHaveValue("Original (recovered)");
    const state = await page.evaluate(
      async (id) => ({
        original: await window.lucid.pages.load(id),
        pages: (await window.lucid.pages.list()).pages,
      }),
      originalId,
    );
    expect(state.original.title).toBe("Current");
    expect(state.pages.map((item) => item.title).sort()).toEqual([
      "Current",
      "Original (recovered)",
    ]);
  } finally {
    await app.close();
  }
});
