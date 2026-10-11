import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { autoSaveDialog, maximizeWindow } from "./helpers";

/**
 * The first PDF on a computer makes Tectonic download its typesetting files (hundreds, one at a time: about six minutes). The
 * engine is therefore prepared in the background after the first start, the window says so with a count, and a PDF asked for
 * meanwhile waits for it. These tests use a stand-in engine that downloads "files" slowly, so they take seconds.
 */
const SLOW_ENGINE = `#!/bin/sh
for i in 1 2 3 4 5 6 7 8 9 10; do echo "note: downloading f$i.sty"; sleep 0.4; done
printf '%%PDF-1.5\\n' > main.pdf
`;
const OFFLINE_ENGINE = `#!/bin/sh
echo "thread 'main' panicked: this bundle isn't cached, and we couldn't get it from the internet. Error: error sending request" >&2
exit 101
`;

async function launch(
  engine: string,
): Promise<{ app: ElectronApplication; page: Page; home: string }> {
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const tool = join(mkdtempSync(join(tmpdir(), "lucid-engine-")), "tectonic");
  writeFileSync(tool, engine);
  chmodSync(tool, 0o755);
  mkdirSync(join(home, ".lucid"), { recursive: true });
  writeFileSync(join(home, ".lucid", "settings.json"), JSON.stringify({ tectonicPath: tool }));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    // The suite turns the preparation off; these tests are about it.
    env: { ...process.env, LUCID_HOME: home, LUCID_PDF_WARMUP: "1" },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  return { app, page, home };
}

async function newPage(page: Page, title: string): Promise<void> {
  await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
  await expect(page.getByLabel("Page title")).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
}

test("the first start prepares the PDF engine in the background and says so, with a count", async () => {
  test.setTimeout(90_000);
  const { app, page, home } = await launch(SLOW_ENGINE);
  try {
    await newPage(page, "Caching notes");
    const note = page.locator(".export-note");
    await expect(note).toContainText("Getting the PDF engine ready");
    await expect(note).toContainText(/\d+ files/);
    await expect(note).toContainText("The PDF engine is ready.", { timeout: 30_000 });
    expect(existsSync(join(home, ".lucid", "build", "engine-ready"))).toBe(true);

    // Ready: a PDF is made at once, without a download.
    await autoSaveDialog(app);
    await page.getByRole("button", { name: "Download PDF" }).click();
    await expect(page.getByText(/^Saved page\.pdf/)).toBeVisible({ timeout: 30_000 });
  } finally {
    await app.close();
  }
});

test("a PDF asked for during the preparation waits for it, and shows what is happening", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch(SLOW_ENGINE);
  try {
    await newPage(page, "Caching notes");
    await autoSaveDialog(app);
    const button = page.getByRole("button", { name: /PDF/ }).last();
    await button.click();
    await expect(button).toHaveText(/Making PDF/);
    await expect(page.locator(".export-note")).toContainText("Getting the PDF engine ready");
    await expect(page.getByText(/^Saved page\.pdf/)).toBeVisible({ timeout: 60_000 });
  } finally {
    await app.close();
  }
});

test("without the internet the first PDF says what is wrong in plain words", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch(OFFLINE_ENGINE);
  try {
    await newPage(page, "Caching notes");
    await expect(page.locator(".export-note")).toContainText("needs the internet the first time", {
      timeout: 20_000,
    });
    await expect(page.locator(".export-note")).not.toContainText("panicked");
  } finally {
    await app.close();
  }
});
