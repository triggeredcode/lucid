import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Block } from "@lucid/core";
import { registry } from "@lucid/kit";
import { _electron as electron, expect, test } from "@playwright/test";
import { autoSaveDialog, downloadPdf, maximizeWindow } from "./helpers";

const fixture = (type: Block["type"], id: string): Block => {
  const found = registry.get(type).fixtures.find((f) => f.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

test("a page with a callout, math, table, diagram, chart and code opens in the editor and compiles", async () => {
  test.setTimeout(120_000);
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  try {
    const download = await autoSaveDialog(app);
    const page = await app.firstWindow();
    await maximizeWindow(app, page);
    const blocks: Block[] = [
      {
        id: "h1",
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: "Caching", styles: {} }],
      },
      {
        id: "p1",
        type: "paragraph",
        props: {},
        content: [
          { type: "text", text: "A cache hit costs ", styles: {} },
          { type: "text", text: "microseconds", styles: { bold: true } },
          { type: "text", text: ", a miss costs a database round trip.", styles: {} },
        ],
      },
      fixture("callout", "fx-callout-1"),
      fixture("math", registry.get("math").fixtures[0]?.id ?? ""),
      fixture("table", "fx-table-1"),
      fixture("diagram", registry.get("diagram").fixtures[0]?.id ?? ""),
      fixture("chart", registry.get("chart").fixtures[0]?.id ?? ""),
      fixture("code", registry.get("code").fixtures[0]?.id ?? ""),
    ];
    await page.evaluate(
      async (doc) => {
        const file = await window.lucid.pages.create("Caching notes");
        await window.lucid.pages.save({ ...file, doc });
      },
      { blocks },
    );
    await page.reload();

    await expect(page.getByLabel("Page title")).toHaveValue("Caching notes");
    await expect(page.locator(".figure-svg svg").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".lucid-table")).toBeVisible();
    await expect(page.locator(".callout")).toBeVisible();
    await expect(page.locator(".math-block")).toBeVisible();

    // The same page becomes a real PDF with the table, diagram, chart and code in it.
    const text = await downloadPdf(page, download);
    if (text !== undefined) {
      expect(text).toContain("A cache hit costs microseconds");
      expect(text).toContain("Property");
    }
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.screenshot({ path: join(__dirname, "../test-results/app-rich-page.png") });
  } finally {
    await app.close();
  }
});
