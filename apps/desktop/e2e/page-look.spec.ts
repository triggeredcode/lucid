import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Block } from "@lucid/core";
import { registry } from "@lucid/kit";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { maximizeWindow } from "./helpers";

/**
 * The page (the document with its diagrams and tables) has a light and dark of its own, apart from the app's: a dark app can
 * show a light page, as paper, and a light app a dark page. The choice is kept, and "like the app" follows the app again.
 */
const luminance = (value: string): number => {
  const v = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  const [r = 0, g = 0, b = 0] = hex
    ? [0, 2, 4].map((i) => Number.parseInt((hex[1] ?? "").slice(i, i + 2), 16))
    : (v.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
const colour = (page: Page, selector: string, property: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

test("the page has its own light and dark, apart from the app's, and it is kept", async () => {
  test.setTimeout(90_000);
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: mkdtempSync(join(tmpdir(), "lucid-home-")) },
  });
  try {
    const page = await app.firstWindow();
    await maximizeWindow(app, page); // this also makes the app light
    const diagram = registry.get("diagram").fixtures[0] as Block;
    await page.evaluate(
      async (blocks: Block[]) => {
        const file = await window.lucid.pages.create("Look");
        await window.lucid.pages.save({ ...file, doc: { blocks } });
      },
      [diagram],
    );
    await page.reload();
    await page.emulateMedia({ colorScheme: "light" });
    await page
      .getByRole("navigation", { name: "Pages" })
      .getByRole("button", { name: /Look/ })
      .click();
    await expect(page.locator(".page-editor svg g.node").first()).toBeVisible({ timeout: 20_000 });

    const toggle = page.getByRole("button", { name: /^Look of the page:/ });
    const nodeFill = () =>
      colour(page, ".page-editor svg g.node rect, .page-editor svg g.node path", "fill");
    const oneLine = async () => {
      const bar = await page.locator(".topbar").boundingBox();
      expect(bar?.height ?? 999, "the top bar stays on one line").toBeLessThan(75);
    };

    // To begin with the page is like the app: light in a light app, and nothing is marked.
    await expect(toggle).toHaveAccessibleName(/like the app\. Click for light/);
    expect(luminance(await colour(page, ".editor-scroll", "--bg"))).toBeGreaterThan(0.9);
    const lightFill = luminance(await nodeFill());
    await expect(page.locator(".editor-scroll[data-page-look]")).toHaveCount(0);
    await oneLine();

    // One click: a light page, whatever the app is. Another: a dark page in the light app, its diagram dark too, and the
    // sidebar and the top bar stay light.
    await toggle.click();
    await expect(toggle).toHaveAccessibleName(/: light\. Click for dark/);
    await toggle.click();
    await expect(toggle).toHaveAccessibleName(/: dark\. Click for like the app/);
    await expect(page.locator(".editor-scroll[data-page-look='dark']")).toHaveCount(1);
    expect(luminance(await colour(page, ".editor-scroll", "--bg"))).toBeLessThan(0.2);
    expect(luminance(await colour(page, ".sidebar", "background-color"))).toBeGreaterThan(0.8);
    expect(luminance(await colour(page, ".topbar", "background-color"))).toBeGreaterThan(0.9);
    await expect.poll(async () => luminance(await nodeFill())).toBeLessThan(lightFill);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await oneLine();

    // It is kept.
    await page.reload();
    await page
      .getByRole("navigation", { name: "Pages" })
      .getByRole("button", { name: /Look/ })
      .click();
    await expect(page.locator(".editor-scroll[data-page-look='dark']")).toHaveCount(1);

    // A light page in a dark app (paper), chosen in Settings: the app follows the system, here made dark.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Meta+,");
    const row = page
      .getByRole("dialog", { name: "Settings" })
      .getByRole("radiogroup", { name: "Page", exact: true });
    await row.getByRole("radio", { name: "Light" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".editor-scroll[data-page-look='light']")).toHaveCount(1);
    expect(luminance(await colour(page, ".editor-scroll", "--bg"))).toBeGreaterThan(0.9);
    expect(luminance(await colour(page, ".sidebar", "background-color"))).toBeLessThan(0.3);

    // Like the app again.
    await page.keyboard.press("Meta+,");
    await row.getByRole("radio", { name: "Like the app" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".editor-scroll[data-page-look]")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
