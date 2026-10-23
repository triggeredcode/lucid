import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND_DOC } from "@lucid/llm";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { autoSaveDialog, maximizeWindow } from "./helpers";

async function launch(
  settings?: Record<string, unknown>,
): Promise<{ app: ElectronApplication; page: Page; home: string }> {
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  if (settings) {
    // The first run would write the defaults; put ours there first.
    const dir = join(home, ".lucid");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
  }
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  return { app, page, home };
}

const pageFile = (home: string) =>
  readdirSync(home).find((n) => n !== ".lucid" && n.endsWith(".lucid")) ?? "";
const saveNote = (page: Page) => page.locator(".save-note");

test("a save that fails is tried again by itself and nothing is lost, and closing in the meantime asks first", async () => {
  test.setTimeout(120_000);
  const { app, page, home } = await launch();
  try {
    await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
    await expect(page.getByLabel("Page title")).toBeFocused();
    await page.keyboard.type("Caching notes");
    await page.keyboard.press("Enter");
    await expect(saveNote(page)).toHaveText("Saved", { timeout: 15_000 });
    const file = join(home, pageFile(home));

    // The folder stops being writable (a full or locked disk does the same): the next save fails.
    chmodSync(home, 0o500);
    try {
      await page.keyboard.type("Redis keeps hot keys in memory.");
      await expect(saveNote(page)).toContainText("Couldn’t save", { timeout: 15_000 });
      await expect(saveNote(page).getByRole("button", { name: "Try again" })).toBeVisible();
      // The words are still on the page, in memory.
      await expect(page.locator(".page-editor")).toContainText("Redis keeps hot keys");
      expect(readFileSync(file, "utf8")).not.toContain("Redis keeps hot keys");

      // Closing now asks; "Stay" keeps the window (and the words).
      await app.evaluate(({ BrowserWindow, dialog }) => {
        (globalThis as { asked?: string[] }).asked = [];
        const stub = (...args: { message: string; buttons: string[] }[]) => {
          const o = args[args.length - 1];
          (globalThis as { asked?: string[] }).asked?.push(
            `${o?.message} | ${o?.buttons.join("/")}`,
          );
          return 0;
        };
        (dialog as { showMessageBoxSync: unknown }).showMessageBoxSync = stub;
        BrowserWindow.getAllWindows()[0]?.close();
      });
      await page.waitForTimeout(800);
      const stayed = await app.evaluate(({ BrowserWindow }) => ({
        windows: BrowserWindow.getAllWindows().length,
        asked: (globalThis as { asked?: string[] }).asked ?? [],
      }));
      expect(stayed.windows).toBe(1);
      expect(stayed.asked).toEqual(["Lucid couldn’t save your latest changes. | Stay/Quit anyway"]);
    } finally {
      // The problem goes away: the next try (every 5 s) saves, without anyone pressing anything.
      chmodSync(home, 0o700);
    }
    await expect(saveNote(page)).toHaveText("Saved", { timeout: 20_000 });
    expect(readFileSync(file, "utf8")).toContain("Redis keeps hot keys");

    // With everything saved, closing asks nothing.
    await app.evaluate(({ BrowserWindow, dialog }) => {
      (dialog as { showMessageBoxSync: unknown }).showMessageBoxSync = () => {
        throw new Error("asked although everything is saved");
      };
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(0);
  } finally {
    chmodSync(home, 0o700);
    await app.close().catch(() => undefined);
  }
});

test("'Quit anyway' closes the window when the last changes could not be saved", async () => {
  test.setTimeout(90_000);
  const { app, page, home } = await launch();
  try {
    await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
    await page.keyboard.type("Notes");
    await page.keyboard.press("Enter");
    await expect(saveNote(page)).toHaveText("Saved", { timeout: 15_000 });
    chmodSync(home, 0o500);
    await page.keyboard.type("Unsaved words.");
    await expect(saveNote(page)).toContainText("Couldn’t save", { timeout: 15_000 });
    await app.evaluate(({ BrowserWindow, dialog }) => {
      (dialog as { showMessageBoxSync: unknown }).showMessageBoxSync = () => 1;
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(0);
  } finally {
    chmodSync(home, 0o700);
    await app.close().catch(() => undefined);
  }
});

test("without Tectonic the PDF says how to install it, and Markdown still works", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch({ tectonicPath: "/nonexistent/tectonic" });
  try {
    await page.evaluate(async (doc) => {
      const file = await window.lucid.pages.create("Request flow and databases");
      await window.lucid.pages.save({ ...file, doc });
    }, COMMAND_DOC);
    await page.reload();
    await expect(page.locator(".page-editor")).toContainText("MongoDB");

    await page.locator('summary[aria-label="Page actions"]').click();
    await page.getByRole("button", { name: "Download PDF" }).click();
    const note = page.locator(".export-note");
    await expect(note).toContainText("The PDF couldn’t be made", { timeout: 60_000 });
    await expect(note).toContainText("Tectonic, the PDF engine, was not found");
    await expect(note).toContainText("brew install tectonic");
    await expect(note).toContainText("Markdown export still works");

    const path = await autoSaveDialog(app);
    await page.getByRole("button", { name: "Markdown" }).click();
    await expect(page.locator(".export-note")).toContainText("Saved page.pdf");
    expect(readFileSync(path, "utf8")).toContain("# Request flow and databases");
  } finally {
    await app.close();
  }
});
