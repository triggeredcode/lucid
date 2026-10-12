import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { maximizeWindow } from "./helpers";

/**
 * On a Mac the window has no title bar of its own (no title text, no grey strip): the top row of the page takes its place, with
 * the three round buttons at its left, so the page leaves room for them and its empty parts move the window.
 */
test("on a Mac the window has no title bar, and the page leaves room for the three buttons", async () => {
  test.skip(process.platform !== "darwin", "the three round buttons are a Mac thing");
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: mkdtempSync(join(tmpdir(), "lucid-home-")) },
  });
  try {
    const page = await app.firstWindow();
    await maximizeWindow(app, page);

    // No title bar: the page starts at the very top of the window.
    const frame = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return { top: win?.getBounds().y, content: win?.getContentBounds().y };
    });
    expect(frame.content).toBe(frame.top);

    // The buttons take about 72 px at the left (20 px in, three of 12 px with 8 px between): the brand starts after them.
    await expect(page.locator("html")).toHaveClass(/is-mac/);
    const mark = await page.locator(".brand-mark").boundingBox();
    expect(mark?.x ?? 0).toBeGreaterThanOrEqual(76);
    // In the middle of the top row, like the buttons.
    const row = await page.locator(".brand").boundingBox();
    expect(
      Math.abs((mark?.y ?? 0) + (mark?.height ?? 0) / 2 - (row?.height ?? 0) / 2),
    ).toBeLessThan(2);

    // With the pages hidden, the top bar of a page makes room for them too.
    await page.evaluate(async () => {
      await window.lucid.pages.create("Caching");
    });
    await page.reload();
    await page
      .getByRole("navigation", { name: "Pages" })
      .getByRole("button", { name: /Caching/ })
      .click();
    await page.getByRole("button", { name: "Hide pages" }).click();
    const show = await page.getByRole("button", { name: "Show pages" }).boundingBox();
    expect(show?.x ?? 0).toBeGreaterThanOrEqual(76);

    // The empty parts of the two rows move the window; what can be clicked in them does not.
    const region = (selector: string) =>
      page.evaluate(
        (s) =>
          getComputedStyle(document.querySelector(s) as Element).getPropertyValue(
            "-webkit-app-region",
          ),
        selector,
      );
    expect(await region(".topbar")).toBe("drag");
    expect(await region(".topbar > :first-child")).toBe("no-drag");
    await page.getByRole("button", { name: "Show pages" }).click();
    expect(await region(".brand")).toBe("drag");
    expect(await region(".brand button")).toBe("no-drag");
  } finally {
    await app.close();
  }
});
