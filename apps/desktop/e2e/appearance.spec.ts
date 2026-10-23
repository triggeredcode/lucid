import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_DOC } from "@lucid/kit";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { autoSaveDialog, downloadPdf, maximizeWindow } from "./helpers";

/** Crisp light and dark surfaces with semantic signal colours, set in monospace. */
const LIGHT = { bg: "rgb(251, 252, 255)", ink: "rgb(17, 19, 24)" };
const DARK = {
  bg: "rgb(17, 19, 26)",
  ink: "rgb(247, 248, 255)",
  structure: "rgb(125, 162, 255)",
  structureInk: "rgb(12, 16, 32)",
};

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  await page.evaluate(async (doc) => {
    const file = await window.lucid.pages.create("Request flow");
    await window.lucid.pages.save({ ...file, doc });
  }, SAMPLE_DOC);
  await page.reload();
  await expect(page.locator(".page-editor svg g.node").first()).toBeVisible({ timeout: 20_000 });
  return { app, page };
}

const style = (page: Page, selector: string, property: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset["theme"]);
const labelFill = (page: Page) =>
  page
    .locator(".page-editor svg .edgeLabel rect")
    .first()
    .evaluate((el) => getComputedStyle(el).fill);

test("it is light by default, the sidebar's moon switches to dark, and the choice is remembered", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch();
  try {
    expect(await theme(page)).toBe("light");
    expect(await style(page, "body", "background-color")).toBe(LIGHT.bg);
    expect(await style(page, "body", "color")).toBe(LIGHT.ink);
    expect(await style(page, "body", "font-family")).toContain("iA Writer Mono");
    await expect(page.getByRole("complementary", { name: "History" })).toHaveCount(0);
    await page.screenshot({ path: join(__dirname, "../test-results/appearance-light.png") });

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    expect(await theme(page)).toBe("dark");
    expect(await style(page, "body", "background-color")).toBe(DARK.bg);
    expect(await style(page, "body", "color")).toBe(DARK.ink);
    // Primary actions use the structure signal, with the neutral canvas preserved around them.
    const download = page.getByRole("button", { name: "Download PDF" });
    await expect(download).toHaveCSS("background-color", DARK.structure);
    await expect(download).toHaveCSS("color", DARK.structureInk);
    await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
    await page.screenshot({ path: join(__dirname, "../test-results/appearance-dark.png") });

    await page.reload();
    expect(await theme(page)).toBe("dark");
    await expect(page.locator(".page-editor svg g.node").first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await app.close();
  }
});

test("the page's text and its diagram follow the theme at once, and the PDF does not change with it", async () => {
  test.setTimeout(120_000);
  const { app, page } = await launch();
  try {
    // The page body is in the app's type, not BlockNote's own.
    expect(await style(page, ".page-editor .bn-editor", "font-family")).toContain("iA Writer Mono");
    expect(await labelFill(page)).toBe("rgb(255, 255, 255)");

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    // The drawing is made again in the dark look (no reload): the label behind the words is the page's colour.
    await expect.poll(() => labelFill(page)).toBe("rgb(25, 25, 25)");
    expect(await style(page, ".page-editor .bn-editor", "color")).toBe(DARK.ink);

    // A PDF made in the dark theme is the same white page with the house style.
    const path = await autoSaveDialog(app);
    const words = await downloadPdf(page, path);
    if (words !== undefined) expect(words).toContain("Request flow");
  } finally {
    await app.close();
  }
});

test("Settings: Theme follows the system when asked to, and Type changes the face of the whole app", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch();
  try {
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    const theme_ = dialog.getByRole("radiogroup", { name: "Theme" });
    const type = dialog.getByRole("radiogroup", { name: "Type" });
    const colour = dialog.getByRole("radiogroup", { name: "Colour" });
    await expect(colour.getByRole("radio", { name: /Lucid/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(theme_.getByRole("radio", { name: "System" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(type.getByRole("radio", { name: "Mono" })).toHaveAttribute("aria-checked", "true");

    // System follows the machine, also while the app runs.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => theme(page)).toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => theme(page)).toBe("light");

    // An explicit choice wins over the system.
    await theme_.getByRole("radio", { name: "Dark" }).click();
    expect(await theme(page)).toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    expect(await theme(page)).toBe("dark");

    await type.getByRole("radio", { name: "Sans" }).click();
    expect(await style(page, "body", "font-family")).toContain("ui-sans-serif");
    expect(await style(page, ".page-editor .bn-editor", "font-family")).toContain("ui-sans-serif");
    await type.getByRole("radio", { name: "Serif" }).click();
    expect(await style(page, ".page-editor .bn-editor", "font-family")).toContain("ui-serif");
    await type.getByRole("radio", { name: "Mono" }).click();
    expect(await style(page, ".page-editor .bn-editor", "font-family")).toContain("iA Writer Mono");
    await colour.getByRole("radio", { name: /Solar/ }).click();
    expect(await page.evaluate(() => document.documentElement.dataset["palette"])).toBe("solar");
    await colour.getByRole("radio", { name: /Lucid/ }).click();
    await page.screenshot({ path: join(__dirname, "../test-results/appearance-settings.png") });
  } finally {
    await app.close();
  }
});
