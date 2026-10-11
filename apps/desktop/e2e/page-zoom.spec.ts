import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Block } from "@lucid/core";
import { registry } from "@lucid/kit";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { maximizeWindow, showHistory } from "./helpers";

/**
 * Zooming (⌘+, ⌘−, ⌘0, a pinch) changes the size of the page and nothing else: the pages list, the input box, the History panel
 * and the top bar keep theirs. Playwright cannot press a menu accelerator, so the View menu items are clicked directly.
 */
const text = (s: string) => ({ type: "text" as const, text: s, styles: {} });
const fixture = (type: Block["type"]): Block => {
  const found = registry.get(type).fixtures[0];
  if (!found) throw new Error(`no fixture for ${type}`);
  return found;
};

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: mkdtempSync(join(tmpdir(), "lucid-home-")) },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  const blocks: Block[] = [
    { id: "h1", type: "heading", props: { level: 2 }, content: [text("Caching")], children: [] },
    {
      id: "p1",
      type: "paragraph",
      props: {},
      content: [text("A cache hit costs microseconds, a miss costs a database round trip.")],
      children: [],
    },
    fixture("diagram"),
    fixture("table"),
  ];
  await page.evaluate(async (b) => {
    const file = await window.lucid.pages.create("Zoom notes");
    await window.lucid.pages.save({ ...file, doc: { blocks: b } });
  }, blocks);
  await page.reload();
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("button", { name: /Zoom notes/ })
    .click();
  await expect(page.locator(".bn-editor")).toBeVisible();
  await expect(page.locator(".page-editor svg g.node").first()).toBeVisible({ timeout: 30_000 });
  await showHistory(page);
  return { app, page };
}

const rect = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
const menu = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, itemId) => {
    Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click();
  }, id);
const zoomOf = (page: Page) =>
  page.evaluate(() => Number(document.documentElement.style.getPropertyValue("--page-zoom")));
const windowZoom = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor(),
  );

const FIXED = [".sidebar", ".dictation-box", ".side", ".topbar"] as const;
const near = (a: number, b: number) => Math.abs(a - b) < 0.6;

test("zooming makes the page bigger and nothing else", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch();
  try {
    const before = Object.fromEntries(
      await Promise.all(FIXED.map(async (s) => [s, await rect(page, s)] as const)),
    );
    const titleBefore = await rect(page, ".doc-title");
    const textBefore = await rect(page, ".bn-block-content[data-content-type='paragraph']");
    const tableBefore = await rect(page, ".lucid-table");
    expect(await zoomOf(page)).toBe(1);

    for (let i = 0; i < 3; i++) await menu(app, "zoom-in");
    await expect.poll(() => zoomOf(page)).toBe(1.5);

    // The page grew: its title is bigger, and the table is wider-looking (taller rows).
    const titleAfter = await rect(page, ".doc-title");
    const tableAfter = await rect(page, ".lucid-table");
    expect(titleAfter.height).toBeGreaterThan(titleBefore.height * 1.3);
    expect(tableAfter.height).toBeGreaterThan(tableBefore.height * 1.3);
    expect(
      (await rect(page, ".bn-block-content[data-content-type='paragraph']")).height,
    ).toBeGreaterThanOrEqual(textBefore.height);

    // Everything else is the size it was.
    for (const s of FIXED) {
      const now = await rect(page, s);
      const was = before[s];
      expect(near(now.width, was?.width ?? 0), `${s} width`).toBe(true);
      expect(near(now.height, was?.height ?? 0), `${s} height`).toBe(true);
    }
    expect(await windowZoom(app)).toBe(1);
    await expect(page.locator(".zoom-chip")).toHaveText("150%");

    // Zoom out, and the chip's click goes back to 100% and the chip goes away.
    await menu(app, "zoom-out");
    await expect.poll(() => zoomOf(page)).toBe(1.25);
    await page.locator(".zoom-chip").click();
    await expect.poll(() => zoomOf(page)).toBe(1);
    await expect(page.locator(".zoom-chip")).toHaveCount(0);
    await menu(app, "zoom-in");
    await menu(app, "zoom-reset");
    await expect.poll(() => zoomOf(page)).toBe(1);
  } finally {
    await app.close();
  }
});

test("a pinch or Ctrl and the scroll wheel over the page zooms the page, and over the rest does nothing", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch();
  try {
    const box = await page.locator(".bn-editor").boundingBox();
    if (!box) throw new Error("no page");
    await page.mouse.move(box.x + 100, box.y + 40);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -25);
    await page.keyboard.up("Control");
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(1);
    await page.keyboard.down("Control");
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 25);
    await page.keyboard.up("Control");
    await expect.poll(() => zoomOf(page)).toBeLessThan(1);

    // Over the pages list, nothing zooms.
    await menu(app, "zoom-reset");
    await expect.poll(() => zoomOf(page)).toBe(1);
    await page.mouse.move(100, 300);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -25);
    await page.keyboard.up("Control");
    await page.waitForTimeout(300);
    expect(await zoomOf(page)).toBe(1);
    expect(await windowZoom(app)).toBe(1);
  } finally {
    await app.close();
  }
});

test("the page zoom is remembered, and a zoom of the whole window from an earlier run is forgotten", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch();
  try {
    await menu(app, "zoom-in");
    await menu(app, "zoom-in");
    await expect.poll(() => zoomOf(page)).toBe(1.25);
    await page.reload();
    await expect.poll(() => zoomOf(page)).toBe(1.25);

    // Chromium remembers the zoom level of an app between runs; the window must not keep one.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomLevel(2);
    });
    expect(await windowZoom(app)).toBeGreaterThan(1.4);
    await page.reload();
    await expect.poll(() => windowZoom(app)).toBe(1);
  } finally {
    await app.close();
  }
});

test("the View menu has no zoom of the whole window", async () => {
  const { app } = await launch();
  try {
    const roles = await app.evaluate(({ Menu }) => {
      const out: string[] = [];
      const walk = (items: Electron.MenuItem[]) => {
        for (const item of items) {
          out.push(item.role ?? "");
          if (item.submenu) walk(item.submenu.items);
        }
      };
      walk(Menu.getApplicationMenu()?.items ?? []);
      return out;
    });
    expect(roles.filter((r) => /^(zoomin|zoomout|resetzoom)$/i.test(r))).toEqual([]);
    const ids = await app.evaluate(({ Menu }) =>
      ["zoom-in", "zoom-out", "zoom-reset"].map(
        (id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.accelerator ?? "",
      ),
    );
    expect(ids).toEqual(["CommandOrControl+Plus", "CommandOrControl+-", "CommandOrControl+0"]);
  } finally {
    await app.close();
  }
});
