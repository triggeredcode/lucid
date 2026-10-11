import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { maximizeWindow } from "./helpers";

test("a fresh install opens a window with an empty library and a New page button", async () => {
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: mkdtempSync(join(tmpdir(), "lucid-home-")) },
  });
  try {
    const window = await app.firstWindow();
    await maximizeWindow(app, window);
    await expect(window).toHaveTitle("Lucid");
    await expect(window.getByText("No pages yet.")).toBeVisible();
    await expect(window.getByRole("button", { name: "+ New page" })).toBeVisible();
    // A person who has just installed Lucid is told what to do first.
    await expect(window.getByText("Start LM Studio")).toBeVisible();
    await expect(window.getByText("Help → Lucid Guide")).toBeVisible();
  } finally {
    await app.close();
  }
});
