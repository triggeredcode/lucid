import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { maximizeWindow } from "./helpers";

/** Lucid opens at the size and place it was left, and maximized if it was. */
test("the window opens where and how big it was left", async () => {
  test.setTimeout(90_000);
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const launch = () =>
    electron.launch({
      args: [join(__dirname, "../out/main/index.js")],
      env: { ...process.env, LUCID_HOME: home },
    });
  const bounds = (app: Awaited<ReturnType<typeof launch>>) =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return {
        ...(win?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 }),
        maximized: win?.isMaximized() ?? false,
      };
    });

  // Moved and resized by the person, then closed.
  let app = await launch();
  await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 140, y: 100, width: 1000, height: 700 });
  });
  await app.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
  await app.close();

  app = await launch();
  await app.firstWindow();
  const back = await bounds(app);
  expect(back).toMatchObject({ x: 140, y: 100, width: 1000, height: 700, maximized: false });

  // Maximized, then closed: it opens maximized.
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  await app.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
  await app.close();
  app = await launch();
  await app.firstWindow();
  await expect.poll(async () => (await bounds(app)).maximized).toBe(true);
  await app.close();
});
