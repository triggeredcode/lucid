import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { maximizeWindow } from "./helpers";

test("a first run explains setup and points out the workspace", async () => {
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

    const tour = window.getByRole("dialog", { name: "Lucid workspace tour" });
    await expect(tour.getByRole("heading", { name: "Your pages live here" })).toBeVisible();
    await tour.getByRole("button", { name: "Next" }).click();
    await expect(tour.getByRole("heading", { name: "Change how Lucid listens" })).toBeVisible();
    await expect
      .poll(async () => {
        const card = await window.locator(".tour-card").boundingBox();
        const modes = await window.locator('[data-tour="modes"]').boundingBox();
        return card && modes ? card.y + card.height <= modes.y : false;
      })
      .toBe(true);
    await tour.getByRole("button", { name: "Next" }).click();
    await expect(tour.getByRole("heading", { name: "Take the result with you" })).toBeVisible();
    await tour.getByRole("button", { name: "Done" }).click();

    await expect(tour).toBeHidden();
    await expect
      .poll(() => window.evaluate(() => localStorage.getItem("lucid.onboarding")))
      .toBe("1");
  } finally {
    await app.close();
  }
});
