import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { autoSaveDialog, downloadPdf, maximizeWindow } from "./helpers";

test("create a page, type into it by hand, and download the real PDF", async () => {
  test.setTimeout(120_000);
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  try {
    const download = await autoSaveDialog(app);
    const window = await app.firstWindow();
    await maximizeWindow(app, window);

    // A new page opens in Edit mode, with the title selected so typing replaces "Untitled".
    await window.getByRole("complementary").getByRole("button", { name: "New page" }).click();
    const title = window.getByLabel("Page title");
    await expect(title).toBeFocused();
    await window.keyboard.type("Designing a URL shortener");
    await window.keyboard.press("Enter");

    // Notes by hand: a heading and a list through the editor's markdown shortcuts.
    await window.keyboard.type("# Key generation");
    await window.keyboard.press("Enter");
    await window.keyboard.type("Base62 keys give short links.");
    await window.keyboard.press("Enter");
    await window.keyboard.type("- Counter per shard");
    await window.keyboard.press("Enter");
    await window.keyboard.type("Pre-generated key pool");

    // It is saved, and the sidebar shows the new title.
    await expect(window.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(window.getByRole("navigation", { name: "Pages" })).toContainText(
      "Designing a URL shortener",
    );
    const files = readdirSync(home).filter((n) => n !== ".lucid" && n.endsWith(".lucid"));
    expect(files).toHaveLength(1);
    const saved = JSON.parse(readFileSync(join(home, files[0] ?? ""), "utf8")) as {
      title: string;
      doc: { blocks: { type: string }[] };
    };
    expect(saved.title).toBe("Designing a URL shortener");
    expect(saved.doc.blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "bulletListItem",
      "bulletListItem",
    ]);

    // There is one view: no PDF pane next to the page.
    await expect(window.getByRole("separator")).toHaveCount(0);

    // Download PDF makes the real PDF.
    const text = await downloadPdf(window, download);
    if (text !== undefined) {
      expect(text).toContain("Designing a URL shortener");
      expect(text).toContain("Key generation");
      expect(text).toContain("Pre-generated key pool");
      expect(text).toContain("Page 1");
    }
    await window.screenshot({ path: join(__dirname, "../test-results/app-first-slice.png") });
  } finally {
    await app.close();
  }
});

test("pages are listed, reopened with their text, and can be deleted", async () => {
  test.setTimeout(90_000);
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  try {
    const window = await app.firstWindow();
    await maximizeWindow(app, window);
    for (const name of ["First page", "Second page"]) {
      await window.getByRole("complementary").getByRole("button", { name: "New page" }).click();
      await expect(window.getByLabel("Page title")).toBeFocused();
      await window.keyboard.type(name);
      await window.keyboard.press("Enter");
      await window.keyboard.type(`Body of ${name}`);
      await expect(window.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({
        timeout: 15_000,
      });
    }
    const list = window.getByRole("navigation", { name: "Pages" });
    await expect(list.getByRole("button", { name: /First page/ })).toBeVisible();
    await expect(list.getByRole("button", { name: /Second page/ })).toBeVisible();

    await list.getByRole("button", { name: /First page/ }).click();
    await expect(window.getByLabel("Page title")).toHaveValue("First page");
    await expect(window.locator(".page-editor")).toContainText("Body of First page");

    // Delete needs a second click.
    await list.getByRole("button", { name: "Delete First page" }).click({ force: true });
    await list.getByRole("button", { name: "Delete?" }).click();
    await expect(list.getByRole("button", { name: /First page/ })).toHaveCount(0);
    await expect(window.getByLabel("Page title")).toHaveValue("Second page");
  } finally {
    await app.close();
  }
});
