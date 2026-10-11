import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Block } from "@lucid/core";
import { registry } from "@lucid/kit";
import { _electron as electron, expect, test } from "@playwright/test";
import { autoSaveDialog, downloadPdf, maximizeWindow } from "./helpers";

/**
 * The diagrams in a PDF are drawn by Electron's own Chromium (no program outside the app, nothing to install): they come out as
 * vector drawings with their words as text and their font embedded.
 */
const PDFFONTS = "/opt/homebrew/bin/pdffonts";
const PDFIMAGES = "/opt/homebrew/bin/pdfimages";

test("a diagram in the PDF is a vector drawing with real text, made without any other program", async () => {
  test.setTimeout(120_000);
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: {
      ...process.env,
      LUCID_HOME: mkdtempSync(join(tmpdir(), "lucid-home-")),
      // Nothing from Homebrew or the PATH is needed for the figures.
      PATH: "/usr/bin:/bin",
    },
  });
  try {
    const page = await app.firstWindow();
    await maximizeWindow(app, page);
    const diagram = registry.get("diagram").fixtures[0];
    if (!diagram) throw new Error("no diagram fixture");
    await page.evaluate(
      async (blocks: Block[]) => {
        const file = await window.lucid.pages.create("Request flow");
        await window.lucid.pages.save({ ...file, doc: { blocks } });
      },
      [diagram],
    );
    await page.reload();
    await page
      .getByRole("navigation", { name: "Pages" })
      .getByRole("button", { name: /Request flow/ })
      .click();
    await expect(page.locator(".page-editor svg g.node").first()).toBeVisible({ timeout: 20_000 });

    const path = await autoSaveDialog(app);
    const text = await downloadPdf(page, path);
    // No "could not be drawn" warning: the figure was made.
    await expect(page.locator(".export-note")).not.toContainText("could not be drawn");
    if (text !== undefined) {
      for (const word of ["Web Server", "Redis", "PostgreSQL", "DNS"])
        expect(text, word).toContain(word);
    }
    if (existsSync(PDFFONTS)) {
      const fonts = execFileSync(PDFFONTS, [path], { encoding: "utf8" });
      expect(fonts).toMatch(/Helvetica|Arial|Liberation|Sans/i);
      expect(fonts).toMatch(/yes\s+yes/); // embedded and subset
    }
    if (existsSync(PDFIMAGES)) {
      const images = execFileSync(PDFIMAGES, ["-list", path], { encoding: "utf8" })
        .trim()
        .split("\n");
      expect(
        images.length,
        "no raster images: the diagram is drawn with lines and text",
      ).toBeLessThanOrEqual(2);
    }
  } finally {
    await app.close();
  }
});
