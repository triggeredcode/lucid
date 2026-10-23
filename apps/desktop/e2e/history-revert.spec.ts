import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND_DOC } from "@lucid/llm";
import { startMockLmStudio, type Behaviour, type MockLmStudio } from "@lucid/mock-lmstudio";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { maximizeWindow, showHistory } from "./helpers";

let mock: MockLmStudio | undefined;
test.afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const json = (over: Record<string, unknown>) =>
  JSON.stringify({
    kind: "edit",
    summary: null,
    ops: null,
    question: null,
    options: null,
    reason: null,
    ...over,
  });
const reply = (content: string): Behaviour => ({ kind: "reply", content, chunkChars: 400 });
const strike = (ref: string, name: string) =>
  json({
    summary: `Crossed out ${name}`,
    ops: [{ op: "set_status", target: ref, in: null, status: "struck" }],
  });

async function launch(
  script: Behaviour[],
  home = mkdtempSync(join(tmpdir(), "lucid-home-")),
): Promise<{ app: ElectronApplication; page: Page; home: string }> {
  mock = await startMockLmStudio({ script });
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home, LUCID_LLM_URL: mock.url },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  if (readdirSync(home).filter((n) => n !== ".lucid" && n.endsWith(".lucid")).length === 0) {
    await page.evaluate(async (doc) => {
      const file = await window.lucid.pages.create("Request flow and databases");
      await window.lucid.pages.save({ ...file, doc });
    }, COMMAND_DOC);
    await page.reload();
  }
  await expect(page.locator(".page-editor")).toContainText("MongoDB");
  return { app, page, home };
}

const bar = (page: Page) => page.getByLabel("Dictate or type your notes");
const say = async (page: Page, text: string) => {
  await bar(page).fill(text);
  await bar(page).press("Enter");
};
const command = (page: Page) =>
  page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Command" });
const item = (page: Page, text: string) =>
  page
    .locator('.page-editor [data-content-type="bulletListItem"]')
    .filter({ hasText: new RegExp(`^${text}$`) });
const struck = async (page: Page, text: string) =>
  (await item(page, text).evaluate((el) => getComputedStyle(el).textDecorationLine)) ===
  "line-through";
const changes = (page: Page) =>
  page.getByRole("complementary", { name: "History" }).locator(".changes li");

test("one earlier change can be taken back while the others stay, as one undo step, and the page file keeps the way back", async () => {
  test.setTimeout(120_000);
  const { app, page, home } = await launch([
    reply(strike("b6.2", "MongoDB")),
    reply(strike("b6.1", "PostgreSQL")),
  ]);
  try {
    await command(page).click();
    await say(page, "cross out MongoDB");
    await expect(page.getByText("Crossed out MongoDB.")).toBeVisible({ timeout: 20_000 });
    await say(page, "cross out PostgreSQL");
    await expect(page.getByText("Crossed out PostgreSQL.")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => struck(page, "MongoDB")).toBe(true);
    await expect.poll(() => struck(page, "PostgreSQL")).toBe(true);

    await showHistory(page);
    // Newest first: PostgreSQL, then MongoDB, each with its way back.
    await expect(changes(page)).toHaveCount(2);
    await expect(changes(page).first()).toContainText("Crossed out PostgreSQL");
    // By its words, not by its place: a new entry will be added on top.
    const mongo = changes(page).filter({
      has: page.locator("p", { hasText: /^Crossed out MongoDB$/ }),
    });
    await expect(mongo).toContainText("Crossed out MongoDB");
    await page.screenshot({ path: join(__dirname, "../test-results/history-changes.png") });

    // Revert the OLDER one: it asks first (Cancel keeps everything), then only MongoDB comes back.
    await mongo.getByRole("button", { name: "Revert" }).click();
    await expect(mongo.getByRole("group", { name: "Take this change back?" })).toContainText(
      "Take this back?",
    );
    await mongo.getByRole("button", { name: "Cancel" }).click();
    expect(await struck(page, "MongoDB")).toBe(true);
    await mongo.getByRole("button", { name: "Revert" }).click();
    await mongo.getByRole("button", { name: "Restore" }).click();
    await expect.poll(() => struck(page, "MongoDB")).toBe(false);
    expect(await struck(page, "PostgreSQL")).toBe(true);
    await expect(page.getByText("Took back: Crossed out MongoDB.")).toBeVisible();
    await expect(changes(page).first()).toContainText("Took back: Crossed out MongoDB");
    await expect(mongo).toContainText("Taken back");
    await expect(mongo.getByRole("button", { name: "Revert" })).toHaveCount(0);

    // It was ONE undo step: saying "undo" brings MongoDB's line back, and only that.
    await say(page, "undo");
    await expect.poll(() => struck(page, "MongoDB")).toBe(true);
    expect(await struck(page, "PostgreSQL")).toBe(true);

    // The way back is in the page file, so it is still there after a restart.
    await expect(page.locator(".save-note")).toHaveAttribute("data-state", "saved", {
      timeout: 15_000,
    });
    const file = readdirSync(home).find((n) => n !== ".lucid" && n.endsWith(".lucid")) ?? "";
    const saved = JSON.parse(readFileSync(join(home, file), "utf8")) as {
      changeLog: { summary: string; revert?: { undo: { steps: unknown[] } } }[];
    };
    expect(saved.changeLog.filter((c) => c.revert !== undefined).length).toBeGreaterThanOrEqual(2);
  } finally {
    await app.close();
  }
  // After a restart (the page file only): the older change can still be taken back.
  const again = await launch([], home);
  try {
    await showHistory(again.page);
    const first = changes(again.page).filter({ hasText: "Crossed out PostgreSQL" });
    await expect(first.getByRole("button", { name: "Revert" })).toBeEnabled();
  } finally {
    await again.app.close();
  }
});

test("a change cannot be taken back once the block it touched was changed since, by another change or by hand", async () => {
  test.setTimeout(120_000);
  const unstrike = json({
    summary: "Brought MongoDB back",
    ops: [{ op: "set_status", target: "b6.2", in: null, status: "normal" }],
  });
  const { app, page } = await launch([reply(strike("b6.2", "MongoDB")), reply(unstrike)]);
  try {
    await command(page).click();
    await say(page, "cross out MongoDB");
    await expect(page.getByText("Crossed out MongoDB.")).toBeVisible({ timeout: 20_000 });
    await showHistory(page);
    const first = changes(page).first();
    await expect(first.getByRole("button", { name: "Revert" })).toBeEnabled();

    // A second change to the same block: the first can no longer be taken back, the second can.
    await say(page, "bring MongoDB back");
    await expect(page.getByText("Brought MongoDB back.")).toBeVisible({ timeout: 20_000 });
    const older = changes(page).filter({ hasText: "Crossed out MongoDB" });
    await expect(older.getByRole("button", { name: "Revert" })).toBeDisabled();
    await expect(older.getByRole("button", { name: "Revert" })).toHaveAttribute(
      "title",
      /can't be taken back/,
    );
    const newer = changes(page).filter({ hasText: "Brought MongoDB back" });
    await expect(newer.getByRole("button", { name: "Revert" })).toBeEnabled();
  } finally {
    await app.close();
  }
});

test("a change cannot be taken back after the block was edited by hand", async () => {
  test.setTimeout(120_000);
  const { app, page } = await launch([reply(strike("b6.2", "MongoDB"))]);
  try {
    await command(page).click();
    await say(page, "cross out MongoDB");
    await expect(page.getByText("Crossed out MongoDB.")).toBeVisible({ timeout: 20_000 });
    await showHistory(page);
    const only = changes(page).first();
    await expect(only.getByRole("button", { name: "Revert" })).toBeEnabled();

    // By hand, in Edit mode: type into that very list item.
    await page.keyboard.press("Meta+e");
    await expect(
      page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Edit" }),
    ).toHaveAttribute("aria-pressed", "true");
    await item(page, "MongoDB").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Atlas");
    // The typing has landed (the "Saved" shown before it started must not be taken for the one after it).
    await expect(item(page, "MongoDB Atlas")).toBeVisible();
    await expect(page.locator(".save-note")).toHaveAttribute("data-state", "saved", {
      timeout: 15_000,
    });
    await expect(only.getByRole("button", { name: "Revert" })).toBeDisabled();
  } finally {
    await app.close();
  }
});

test("Show scrolls to what a change touched and lets it flash", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch([reply(strike("b6.2", "MongoDB"))]);
  try {
    await command(page).click();
    await say(page, "cross out MongoDB");
    await expect(page.getByText("Crossed out MongoDB.")).toBeVisible({ timeout: 20_000 });
    await showHistory(page);
    await changes(page).first().getByRole("button", { name: "Show" }).click();
    await expect(page.locator('.page-editor [data-id="o2"].flash')).toBeVisible();
    await expect(page.locator('.page-editor [data-id="o2"].flash')).toHaveCount(0, {
      timeout: 5_000,
    });
  } finally {
    await app.close();
  }
});
