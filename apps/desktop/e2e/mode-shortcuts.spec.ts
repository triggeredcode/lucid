import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { maximizeWindow } from "./helpers";

/** ⌘1 Input, ⌘2 Command, ⌘3 Edit, ⌘4 the diagram builder, ⌘5 the table builder. */
async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: mkdtempSync(join(tmpdir(), "lucid-home-")) },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
  await expect(page.getByLabel("Page title")).toBeFocused();
  await page.keyboard.type("Shortcuts");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  return { app, page };
}

const mode = (page: Page, name: "Input" | "Command" | "Edit"): Locator =>
  page.getByRole("group", { name: "Mode" }).getByRole("button", { name, exact: true });
const builder = (page: Page, kind: "Diagram" | "Table"): Locator =>
  page.getByRole("region", { name: `${kind} builder` });

test("⌘1, ⌘2 and ⌘3 switch between Input, Command and Edit, from anywhere", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch();
  try {
    await page.keyboard.press("Meta+1");
    await expect(mode(page, "Input")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Meta+2");
    await expect(mode(page, "Command")).toHaveAttribute("aria-pressed", "true");
    await expect(mode(page, "Input")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Meta+3");
    await expect(mode(page, "Edit")).toHaveAttribute("aria-pressed", "true");
    // From Edit mode, with the cursor in the page, the keys still work.
    await page.keyboard.press("Meta+1");
    await expect(mode(page, "Input")).toHaveAttribute("aria-pressed", "true");
    // The same keys on the buttons' tooltips.
    await expect(mode(page, "Command")).toHaveAttribute("title", /⌘2/);
  } finally {
    await app.close();
  }
});

test("⌘4 and ⌘5 open the diagram and the table builder; the modes stay off while one is open", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch();
  try {
    await page.keyboard.press("Meta+1");
    await page.keyboard.press("Meta+4");
    await expect(builder(page, "Diagram")).toBeVisible();
    // A builder is open: ⌘2 and ⌘5 do nothing.
    await page.keyboard.press("Meta+2");
    await page.keyboard.press("Meta+5");
    await expect(builder(page, "Diagram")).toBeVisible();
    await expect(builder(page, "Table")).toHaveCount(0);
    await builder(page, "Diagram").getByRole("button", { name: "Cancel" }).click();
    await expect(builder(page, "Diagram")).toHaveCount(0);

    await page.keyboard.press("Meta+5");
    await expect(builder(page, "Table")).toBeVisible();
    await builder(page, "Table").getByRole("button", { name: "Cancel" }).click();
    await expect(builder(page, "Table")).toHaveCount(0);

    // From Edit mode a builder opens too (it leaves Edit mode, as the button does).
    await page.keyboard.press("Meta+3");
    await expect(mode(page, "Edit")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Meta+4");
    await expect(builder(page, "Diagram")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("while a dialog is open the number keys are left alone", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch();
  try {
    await page.keyboard.press("Meta+1");
    await page.keyboard.press("Meta+,");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.keyboard.press("Meta+3");
    await page.keyboard.press("Meta+4");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
    await expect(mode(page, "Input")).toHaveAttribute("aria-pressed", "true");
    await expect(builder(page, "Diagram")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
