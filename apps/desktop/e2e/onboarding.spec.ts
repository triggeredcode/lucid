import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { maximizeWindow } from "./helpers";

test("a first run leads into a real first-success task", async () => {
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: {
      ...process.env,
      LUCID_HOME: mkdtempSync(join(tmpdir(), "lucid-home-")),
      LUCID_PDF_WARMUP: "0",
      LUCID_SKIP_ONBOARDING: "0",
    },
  });

  try {
    const window = await app.firstWindow();
    await maximizeWindow(app, window);
    await window.evaluate(() => {
      localStorage.removeItem("lucid.onboarding");
      localStorage.removeItem("lucid.firstSuccess");
    });
    await window.reload();

    await expect(
      window.getByRole("heading", { name: "Speak or type the messy version." }),
    ).toBeVisible();
    await window.getByRole("button", { name: "Set up Lucid" }).click();

    await expect(window.getByRole("heading", { name: "Connect an AI provider" })).toBeVisible();
    await expect(window.getByText("LM Studio or Ollama", { exact: false })).toBeVisible();
    await window.getByRole("button", { name: "Continue without AI" }).click();

    await expect(
      window.getByRole("heading", { name: "Everything happens around one page" }),
    ).toBeVisible();
    await window.getByRole("button", { name: "Open my workspace" }).click();

    const guide = window.getByRole("complementary", { name: "First success guide" });
    await expect(guide.getByRole("heading", { name: "Create your first page" })).toBeVisible();
    await guide.getByRole("button", { name: "Create my page" }).click();
    await expect(guide.getByRole("heading", { name: "Add your first thought" })).toBeVisible();
    await expect(guide.getByText("Choose Edit mode", { exact: false })).toBeVisible();
    await guide.getByRole("button", { name: "Skip for now", exact: true }).last().click();
    await expect(guide).toBeHidden();
    await expect
      .poll(() => window.evaluate(() => localStorage.getItem("lucid.onboarding")))
      .toBe("1");
    await expect
      .poll(() =>
        window.evaluate(() => {
          const stored = localStorage.getItem("lucid.firstSuccess");
          return Boolean(
            stored?.includes('"provider":"skipped"') &&
            stored.includes('"paused":true') &&
            stored.includes('"page-created"'),
          );
        }),
      )
      .toBe(true);
  } finally {
    await app.close();
  }
});
