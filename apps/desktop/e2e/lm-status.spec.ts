import { existsSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockLmStudio, type MockLmStudio } from "@lucid/mock-lmstudio";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { maximizeWindow } from "./helpers";

let mock: MockLmStudio | undefined;
test.afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const LS = JSON.stringify([
  {
    type: "llm",
    modelKey: "qwen/qwen3.8-27b",
    displayName: "Qwen3.8 27B",
    sizeBytes: 16_081_678_492,
  },
]);

/** A stand-in for LM Studio's `lms` tool: records what it was asked, and `load` waits until the test lets it finish. */
function fakeLms(dir: string): {
  bin: string;
  log: () => string[][];
  started: string;
  release: string;
} {
  const bin = join(dir, "lms");
  const logFile = join(dir, "calls.log");
  const started = join(dir, "load.started");
  const release = join(dir, "load.release");
  writeFileSync(
    bin,
    `#!/bin/bash
echo "$@" >> "${logFile}"
case "$1" in
  ls) echo '${LS}' ;;
  unload) ;;
  load) touch "${started}"; while [ ! -f "${release}" ]; do sleep 0.1; done ;;
esac
`,
  );
  chmodSync(bin, 0o755);
  return {
    bin,
    started,
    release,
    log: () =>
      existsSync(logFile)
        ? readFileSync(logFile, "utf8")
            .trim()
            .split("\n")
            .map((l) => l.split(" "))
        : [],
  };
}

async function launch(models: string[], studioApp = "/nowhere/LM Studio.app") {
  mock = await startMockLmStudio({ models });
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const lms = fakeLms(home);
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: {
      ...process.env,
      LUCID_HOME: home,
      LUCID_LLM_URL: mock.url,
      LUCID_LMS_BIN: lms.bin,
      // Where LM Studio is "installed" for this test (the real one on this computer must not matter).
      LUCID_LMSTUDIO_APP: studioApp,
    },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  // The status sits in the top bar of an open page.
  await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
  await expect(page.getByLabel("Page title")).toBeVisible();
  return { app, page, lms };
}
const pill = (page: Page) => page.getByRole("group", { name: "Model status" });

test("a loaded model shows as ready", async () => {
  const { app, page } = await launch(["qwen/qwen3.8-27b"]);
  try {
    await expect(pill(page)).toContainText("qwen3.8-27b");
    await expect(pill(page)).toHaveAttribute("data-state", "ready");
  } finally {
    await app.close();
  }
});

test("with no model loaded it asks first, then loads the model with one slot and shows ready", async () => {
  test.setTimeout(60_000);
  const { app, page, lms } = await launch([]);
  try {
    await expect(pill(page)).toContainText("No model loaded");
    await pill(page).getByRole("button", { name: "Load Qwen3.8 27B" }).click();
    const ask = page.getByRole("dialog", { name: "Load the model" });
    await expect(ask).toContainText("16.1 GB");
    // Nothing has been loaded by asking.
    expect(lms.log().some((c) => c[0] === "load")).toBe(false);

    await ask.getByRole("button", { name: "Load" }).click();
    await expect(pill(page)).toContainText("Loading Qwen3.8 27B");
    await expect.poll(() => existsSync(lms.started)).toBe(true);
    mock?.setModels(["qwen/qwen3.8-27b"]);
    writeFileSync(lms.release, "");

    await expect(pill(page)).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    expect(lms.log()).toContainEqual([
      "load",
      "qwen/qwen3.8-27b",
      "--context-length",
      "32768",
      "--parallel",
      "1",
      "-y",
    ]);
  } finally {
    await app.close();
  }
});

test("another loaded model is unloaded first, and Cancel loads nothing", async () => {
  test.setTimeout(60_000);
  const { app, page, lms } = await launch(["gemma-4-e2b"]);
  try {
    await expect(pill(page)).toContainText("Another model is loaded (gemma-4-e2b)");
    await pill(page).getByRole("button", { name: "Load Qwen3.8 27B" }).click();
    const ask = page.getByRole("dialog", { name: "Load the model" });
    await expect(ask).toContainText("gemma-4-e2b is unloaded first");
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toBeHidden();
    expect(lms.log().filter((c) => c[0] !== "ls")).toEqual([]);

    await pill(page).getByRole("button", { name: "Load Qwen3.8 27B" }).click();
    await page
      .getByRole("dialog", { name: "Load the model" })
      .getByRole("button", { name: "Load" })
      .click();
    await expect.poll(() => existsSync(lms.started)).toBe(true);
    expect(lms.log().findIndex((c) => c[0] === "unload")).toBeLessThan(
      lms.log().findIndex((c) => c[0] === "load"),
    );
    expect(lms.log()).toContainEqual(["unload", "gemma-4-e2b"]);
    mock?.setModels(["qwen/qwen3.8-27b"]);
    writeFileSync(lms.release, "");
    await expect(pill(page)).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  } finally {
    await app.close();
  }
});

test("when LM Studio is not running it says so and offers to check again", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch(["qwen/qwen3.8-27b"]);
  try {
    await expect(pill(page)).toHaveAttribute("data-state", "ready");
    await mock?.close();
    await expect(pill(page)).toContainText("LM Studio isn’t running", { timeout: 20_000 });
    await expect(pill(page).getByRole("button", { name: "Check again" })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("when LM Studio is not installed the pill offers to get it, and when it is, to open it", async () => {
  test.setTimeout(90_000);
  // Not installed: "Get LM Studio" goes to its download page.
  {
    const { app, page } = await launch(["qwen/qwen3.8-27b"]);
    try {
      await mock?.close();
      await expect(pill(page)).toContainText("LM Studio isn’t running", { timeout: 20_000 });
      await app.evaluate(({ shell }) => {
        (globalThis as { __opened?: string[] }).__opened = [];
        shell.openExternal = (u: string) => {
          (globalThis as { __opened?: string[] }).__opened?.push(u);
          return Promise.resolve();
        };
      });
      await pill(page).getByRole("button", { name: "Get LM Studio" }).click();
      await expect
        .poll(() => app.evaluate(() => (globalThis as { __opened?: string[] }).__opened))
        .toEqual(["https://lmstudio.ai"]);
    } finally {
      await app.close();
    }
  }
  // Installed: "Open LM Studio" opens the application.
  {
    const installed = mkdtempSync(join(tmpdir(), "lucid-studio-"));
    const { app, page } = await launch(["qwen/qwen3.8-27b"], installed);
    try {
      await mock?.close();
      await expect(pill(page)).toContainText("LM Studio isn’t running", { timeout: 20_000 });
      await app.evaluate(({ shell }) => {
        (globalThis as { __opened?: string[] }).__opened = [];
        shell.openPath = (p: string) => {
          (globalThis as { __opened?: string[] }).__opened?.push(p);
          return Promise.resolve("");
        };
      });
      await pill(page).getByRole("button", { name: "Open LM Studio" }).click();
      await expect
        .poll(() => app.evaluate(() => (globalThis as { __opened?: string[] }).__opened))
        .toEqual([installed]);
    } finally {
      await app.close();
    }
  }
});
