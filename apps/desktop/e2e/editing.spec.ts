import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { maximizeWindow, showHistory } from "./helpers";

async function openNewPage(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: mkdtempSync(join(tmpdir(), "lucid-home-")) },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
  await expect(page.getByLabel("Page title")).toBeFocused();
  await page.keyboard.type("Editing");
  await page.keyboard.press("Enter");
  return { app, page };
}

test("the slash menu offers Lucid's blocks and the formatting toolbar is limited to what the PDF can show", async () => {
  test.setTimeout(90_000);
  const { app, page } = await openNewPage();
  try {
    await page.keyboard.type("/");
    const menu = page.locator(".bn-suggestion-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Callout");
    await expect(menu).toContainText("Math");
    await expect(menu).toContainText("Heading 1");
    await expect(menu).not.toContainText("Image");
    await expect(menu).not.toContainText("Video");
    await expect(menu).not.toContainText("Emoji");
    await page.screenshot({ path: join(__dirname, "../test-results/app-slash-menu.png") });
    await page.keyboard.type("callout");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Why Redis");
    await expect(page.locator(".callout")).toBeVisible();

    await page.keyboard.press("Enter");
    await page.keyboard.type("select me");
    await page.getByText("select me").dblclick();
    const toolbar = page.locator(".bn-formatting-toolbar");
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator('[data-test="bold"]')).toBeVisible();
    await expect(toolbar.locator('[data-test="italic"]')).toBeVisible();
    await expect(toolbar.locator('[data-test="underline"]')).toBeVisible();
    await expect(toolbar.locator('[data-test="strike"]')).toBeVisible();
    await expect(toolbar.locator('[data-test="textColor"]')).toHaveCount(0);
    await expect(toolbar.locator('[data-test="alignTextCenter"]')).toHaveCount(0);
    await page.screenshot({ path: join(__dirname, "../test-results/app-toolbar.png") });
  } finally {
    await app.close();
  }
});

test("one view that scales: the page, its text and the input box grow with the window, also in full screen", async () => {
  test.setTimeout(90_000);
  const { app, page } = await openNewPage();
  try {
    await page.keyboard.type("Hello scale");
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Dictate or type your notes")).toBeVisible();
    await expect(page.getByRole("separator")).toHaveCount(0);

    const measure = () =>
      page.evaluate(() => {
        const column = document.querySelector(".page-column")?.getBoundingClientRect();
        const bar = document.querySelector(".dictation-box")?.getBoundingClientRect();
        const root = document.scrollingElement;
        return {
          column: Math.round(column?.width ?? 0),
          font: Number.parseFloat(
            getComputedStyle(document.querySelector(".page-column") as Element).fontSize,
          ),
          barRight: Math.round(bar?.right ?? 0),
          barBottom: Math.round(bar?.bottom ?? 0),
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          overflow: (root?.scrollWidth ?? 0) > (root?.clientWidth ?? 0),
        };
      });

    // The maximized window itself (what a person gets): everything fits, and the page stays focused until History is asked for.
    const maximized = await measure();
    expect(maximized.overflow, "maximized: no horizontal scrolling").toBe(false);
    expect(maximized.barBottom, "maximized: the input box is on screen").toBeLessThanOrEqual(
      maximized.innerHeight,
    );
    expect(maximized.barRight).toBeLessThanOrEqual(maximized.innerWidth);
    await expect(page.getByRole("complementary", { name: "History" })).toHaveCount(0);
    await page.screenshot({ path: join(__dirname, "../test-results/app-maximized.png") });

    const sizes = [
      { width: 900, height: 620 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
    ];
    const seen: Awaited<ReturnType<typeof measure>>[] = [];
    for (const size of sizes) {
      // On purpose: this test is about other window sizes (it starts from the maximized window).
      await page.setViewportSize(size);
      await page.waitForTimeout(250);
      const m = await measure();
      seen.push(m);
      expect(m.overflow, `${String(size.width)}px: no horizontal scrolling`).toBe(false);
      expect(
        m.barBottom,
        `${String(size.width)}px: the input box is on screen`,
      ).toBeLessThanOrEqual(m.innerHeight);
      expect(m.barRight).toBeLessThanOrEqual(m.innerWidth);
    }
    // The page and its text get bigger with the window (up to a limit), they do not stay small in the middle.
    const columns = seen.map((m) => m.column);
    const fonts = seen.map((m) => m.font);
    expect(columns[1]).toBeGreaterThan(columns[0] ?? 0);
    expect(columns[2]).toBeGreaterThan(columns[1] ?? 0);
    expect(fonts[2]).toBeGreaterThan(fonts[0] ?? 0);
    expect(fonts[3]).toBeGreaterThanOrEqual(fonts[2] ?? 0);

    // Real full-screen mode of the window.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setFullScreen(true);
    });
    await page.waitForTimeout(1500);
    const full = await measure();
    expect(full.overflow).toBe(false);
    expect(full.barBottom).toBeLessThanOrEqual(full.innerHeight);
    await page.screenshot({ path: join(__dirname, "../test-results/app-fullscreen.png") });
  } finally {
    await app.close();
  }
});

test("the page is read-only until Edit mode; ⌘E, Esc and 'edit mode' switch; the side panel and page list hide", async () => {
  test.setTimeout(90_000);
  const { app, page } = await openNewPage();
  try {
    const pill = (name: string) =>
      page.getByRole("group", { name: "Mode" }).getByRole("button", { name });
    const editable = () => page.locator(".page-editor .bn-editor").getAttribute("contenteditable");

    // A new page starts in Edit mode.
    await expect(pill("Edit")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.type("typed by hand");
    expect(await editable()).toBe("true");

    // Esc goes back to taking notes: the page can no longer be typed in, and there is one input box.
    await page.keyboard.press("Escape");
    await expect(pill("Input")).toHaveAttribute("aria-pressed", "true");
    expect(await editable()).toBe("false");
    await expect(page.getByLabel("Dictate or type your notes")).toBeFocused();

    // ⌘E toggles Edit mode, and the box gives way to a hint.
    await page.keyboard.press("Meta+e");
    await expect(pill("Edit")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Editing by hand.")).toBeVisible();
    expect(await editable()).toBe("true");
    await page.keyboard.press("Meta+e");
    await expect(pill("Input")).toHaveAttribute("aria-pressed", "true");

    // Saying "edit mode" does the same, without asking the model.
    await page.getByLabel("Dictate or type your notes").fill("edit mode");
    await page.getByLabel("Dictate or type your notes").press("Enter");
    await expect(pill("Edit")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");

    // The panel on the right shows what was said, and hides.
    await showHistory(page);
    const side = page.getByRole("complementary", { name: "History" });
    await side.getByRole("button", { name: "Hide" }).click();
    await expect(side).toHaveCount(0);

    // So does the page list.
    await page.getByRole("button", { name: "Hide pages" }).click();
    await expect(page.getByRole("navigation", { name: "Pages" })).toHaveCount(0);
    await page.getByRole("button", { name: "Show pages" }).click();
    await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
  } finally {
    await app.close();
  }
});
