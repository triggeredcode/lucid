import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockLmStudio } from "@lucid/mock-lmstudio";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { maximizeWindow, showHistory } from "./helpers";

async function launch() {
  const mock = await startMockLmStudio({ models: ["qwen/qwen3.8-27b"], script: [] });
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home, LUCID_LLM_URL: mock.url },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  return { app, page, mock };
}

async function seed(page: Page): Promise<void> {
  // Created oldest first: the list shows the most recently changed first.
  await page.evaluate(async () => {
    await window.lucid.pages.create("Plain notes");
  });
  await page.waitForTimeout(1100);
  await page.evaluate(async () => {
    await window.lucid.pages.create("Designing a URL shortener", { format: "system-design" });
  });
  await page.reload();
}

const rows = (page: Page) => page.getByRole("navigation", { name: "Pages" }).locator(".page-row");

test("a page in the list looks like a file: a picture, its name, what kind of note it is, and the open one is marked in bold", async () => {
  test.setTimeout(60_000);
  const { app, page, mock } = await launch();
  try {
    await seed(page);
    await expect(rows(page)).toHaveCount(2);
    const first = rows(page).nth(0);
    const second = rows(page).nth(1);
    await expect(first.locator(".page-title")).toHaveText("Designing a URL shortener");
    await expect(first.locator(".page-kind")).toHaveText("System design note");
    await expect(second.locator(".page-title")).toHaveText("Plain notes");
    await expect(second.locator(".page-kind")).toHaveText("Blank page");
    await expect(first.locator(".page-when")).not.toBeEmpty();
    for (const row of [first, second]) await expect(row.locator("svg.file-glyph")).toBeVisible();
    // The open page is the marked one, and the mark follows when another is opened.
    await first.getByRole("button", { name: /Designing a URL shortener/ }).click();
    await expect(first).toHaveAttribute("data-active", "true");
    await expect(second).toHaveAttribute("data-active", "false");
    await second.getByRole("button", { name: /Plain notes/ }).click();
    await expect(second).toHaveAttribute("data-active", "true");
    await expect(first).toHaveAttribute("data-active", "false");
    // Names are regular, and the open file's is bold.
    const weight = (row: typeof first) =>
      row.locator(".page-title").evaluate((el) => Number(getComputedStyle(el).fontWeight));
    expect(await weight(second)).toBeGreaterThanOrEqual(700);
    expect(await weight(first)).toBeLessThan(700);

    // The open page's picture is filled, so it stands out from the others.
    const fill = (row: typeof first) =>
      row.locator(".file-body").evaluate((el) => getComputedStyle(el).fill);
    expect(await fill(second)).not.toBe(await fill(first));
  } finally {
    await app.close();
    await mock.close();
  }
});

test("the side panels are set apart from the page, in the light and the dark theme", async () => {
  test.setTimeout(60_000);
  const { app, page, mock } = await launch();
  try {
    await seed(page);
    await page.getByRole("button", { name: /Plain notes/ }).click();
    await showHistory(page);
    const colours = () =>
      page.evaluate(() => {
        const bg = (sel: string) =>
          getComputedStyle(document.querySelector(sel) as Element).backgroundColor;
        return { sidebar: bg(".sidebar"), history: bg(".side"), page: bg(".topbar") };
      });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(async () => (await colours()).sidebar).not.toBe((await colours()).page);
      const c = await colours();
      expect(c.sidebar, `${scheme}: pages panel`).not.toBe(c.page);
      expect(c.history, `${scheme}: History panel`).not.toBe(c.page);
      expect(c.sidebar).toBe(c.history);
    }
  } finally {
    await app.close();
    await mock.close();
  }
});

test("the top bar is a solid bar that stays on one line in the default window with History open", async () => {
  test.setTimeout(60_000);
  const { app, page, mock } = await launch();
  try {
    await seed(page);
    await page.getByRole("button", { name: /Plain notes/ }).click();
    // On purpose: this test is about the default window size (it starts from the maximized window).
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.unmaximize();
      win?.setBounds({ x: 60, y: 40, width: 1280, height: 800 });
    });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(1280);
    await showHistory(page);
    const bar = page.locator(".topbar");
    // On one row when the middles of all the parts are level (the parts have different heights, so their tops are not).
    const rowsOf = () =>
      bar.evaluate((el) => {
        const middles = [...el.children]
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.height > 0)
          .map((r) => r.top + r.height / 2);
        return {
          spread: Math.max(...middles) - Math.min(...middles),
          height: el.getBoundingClientRect().height,
        };
      });
    await expect.poll(async () => (await rowsOf()).spread, { message: "one row" }).toBeLessThan(8);
    expect((await rowsOf()).height).toBeGreaterThanOrEqual(56);
    // The buttons are still there, by name, even where only their pictures show.
    for (const name of [/^History/, "Export note", "Markdown", "Download PDF"])
      await expect(page.getByRole("button", { name })).toBeVisible();
  } finally {
    await app.close();
    await mock.close();
  }
});
