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
      window.getByRole("heading", { name: "Start with the thought, not the setup." }),
    ).toBeVisible();
    await window.getByRole("button", { name: "Connect AI" }).click();

    await expect(window.getByRole("heading", { name: "Connect AI" })).toBeVisible();
    await expect(window.getByText("LM Studio or Ollama", { exact: false })).toBeVisible();
    await window.getByRole("button", { name: "Continue without AI" }).click();

    const guide = window.getByRole("complementary", { name: "First success guide" });
    await expect(guide.getByRole("heading", { name: "Create a page" })).toBeVisible();
    await guide.getByRole("button", { name: "New page" }).click();
    await expect(guide.getByRole("heading", { name: "Write on the page" })).toBeVisible();
    await expect(guide.getByText("Choose Edit", { exact: false })).toBeVisible();
    await guide.getByRole("button", { name: "Skip tour", exact: true }).last().click();
    await expect(guide).toBeHidden();
    await expect
      .poll(() => window.evaluate(() => localStorage.getItem("lucid.onboarding")))
      .toBe("1");
    await expect
      .poll(() =>
        window.evaluate(() => {
          const stored = localStorage.getItem("lucid.firstSuccess");
          if (!stored) return null;
          const progress = JSON.parse(stored) as {
            provider: string;
            paused: boolean;
            milestones: string[];
          };
          return {
            provider: progress.provider,
            paused: progress.paused,
            pageCreated: progress.milestones.includes("page-created"),
          };
        }),
      )
      .toEqual({ provider: "skipped", paused: true, pageCreated: true });
  } finally {
    await app.close();
  }
});
