import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockLmStudio, type MockLmStudio } from "@lucid/mock-lmstudio";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { maximizeWindow } from "./helpers";

const said =
  "Load balancer. Multiple application servers behind it. Distribute incoming traffic. Health checks to avoid unhealthy servers. Database can become the bottleneck.";
const notes = `## Load Balancer
A **load balancer** sits in front of multiple application servers and distributes incoming traffic across them.
- **Health checks** keep traffic away from unhealthy servers.
- The **database** can become the bottleneck.`;

let mock: MockLmStudio | undefined;
test.afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

async function launch(
  script: Parameters<typeof startMockLmStudio>[0],
): Promise<{ app: ElectronApplication; page: Page; home: string }> {
  mock = await startMockLmStudio(script);
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home, LUCID_LLM_URL: mock.url },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
  await expect(page.getByLabel("Page title")).toBeFocused();
  await page.keyboard.type("Load balancing");
  await page.keyboard.press("Enter");
  // A new page opens in Edit mode; the dictation box takes over once it is left.
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeVisible();
  return { app, page, home };
}

const bar = (page: Page) => page.getByLabel("Dictate or type your notes");

test("typed input becomes structured notes in the page and in the PDF, as one undo step", async () => {
  test.setTimeout(120_000);
  const { app, page, home } = await launch({
    script: [{ kind: "reply", content: notes, chunkChars: 20, delayMs: 5 }],
  });
  try {
    await bar(page).fill(said);
    await bar(page).press("Enter");

    // Notes appear in the editor as real blocks.
    const editor = page.locator(".page-editor");
    await expect(editor.locator("h2")).toHaveText("Load Balancer", { timeout: 30_000 });
    await expect(editor.getByText("Health checks")).toBeVisible();
    await expect(page.getByText("Added a heading, a paragraph and 2 bullets.")).toBeVisible();
    await expect(bar(page)).toHaveValue("");

    // The model was asked with the page and the utterance, with reasoning off.
    const body = mock?.requests[0]?.body;
    expect(body).toMatchObject({ reasoning_effort: "none", stream: true });
    const last = (body?.["messages"] as { content: string }[]).at(-1)?.content ?? "";
    expect(last).toContain('DOCUMENT "Load balancing"');
    expect(last.endsWith(`UTTERANCE:\n${said}`)).toBe(true);

    // Saved with the raw words and a change entry.
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({
      timeout: 15_000,
    });
    const file = readdirSync(home).find((n) => n !== ".lucid" && n.endsWith(".lucid"));
    const saved = JSON.parse(readFileSync(join(home, file ?? ""), "utf8")) as {
      doc: { blocks: { type: string }[] };
      transcripts: { text: string; source: string; mode: string; status: string }[];
      changeLog: { summary: string }[];
    };
    expect(saved.doc.blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "bulletListItem",
      "bulletListItem",
    ]);
    expect(saved.transcripts).toMatchObject([
      { text: said, source: "typed", mode: "input", status: "applied" },
    ]);
    expect(saved.changeLog[0]?.summary).toBe("Added a heading, a paragraph and 2 bullets");

    // One Undo removes everything the model added.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(editor.locator("h2")).toHaveCount(0);
    await expect(editor.getByText("Health checks")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("a paste (how Wispr Flow delivers dictation) is sent on its own after a short pause", async () => {
  test.setTimeout(120_000);
  const { app, page } = await launch({ script: [{ kind: "reply", content: notes }] });
  try {
    await app.evaluate(async ({ clipboard }, text) => {
      await clipboard.writeText(text);
    }, `${said} `);
    await bar(page).focus();
    await page.keyboard.press("Meta+V");
    await expect(page.locator(".page-editor h2")).toHaveText("Load Balancer", { timeout: 30_000 });
    expect(mock?.requests).toHaveLength(1);
    const last =
      (mock?.requests[0]?.body["messages"] as { content: string }[]).at(-1)?.content ?? "";
    // Wispr pads with a space; it is trimmed.
    expect(last.endsWith(`UTTERANCE:\n${said}`)).toBe(true);
  } finally {
    await app.close();
  }
});

/** Settings, Dictation: how long a paste waits before it is sent by itself. */
async function chooseSendDelay(page: Page, label: string): Promise<void> {
  await page.keyboard.press("Meta+,");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog
    .locator(".dictation-settings")
    .getByRole("radio", { name: label, exact: true })
    .click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
}

test("Settings can make a paste wait longer before it is sent, or never send it by itself", async () => {
  test.setTimeout(120_000);
  const { app, page, home } = await launch({
    script: [
      { kind: "reply", content: notes },
      { kind: "reply", content: notes },
    ],
  });
  try {
    // Two seconds: nothing is sent after one.
    await chooseSendDelay(page, "2 s");
    const stored = JSON.parse(readFileSync(join(home, ".lucid", "settings.json"), "utf8")) as {
      dictation: unknown;
    };
    expect(stored.dictation).toEqual({ autoSendMs: 2000 });
    await wisprPaste(app, page, `${said} `);
    await page.waitForTimeout(1000);
    expect(requestsSent()).toBe(0);
    await expect.poll(requestsSent, { timeout: 30_000 }).toBe(1);

    // Never: the words wait in the box until Enter.
    await chooseSendDelay(page, "Never");
    await bar(page).focus();
    await wisprPaste(app, page, `${said} `);
    await page.waitForTimeout(2500);
    expect(requestsSent()).toBe(1);
    await expect(bar(page)).toHaveValue(/^Load balancer\. Multiple application servers/);
    await bar(page).press("Enter");
    await expect.poll(requestsSent, { timeout: 30_000 }).toBe(2);
    await expect(bar(page)).toHaveValue("");
    // Said by a paste, so it is kept as a dictation and not as typing.
    expect(JSON.stringify(mock?.requests[1]?.body)).toContain("Multiple application servers");
  } finally {
    await app.close();
  }
});

test("typing after a paste cancels the automatic send", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch({ script: [{ kind: "reply", content: notes }] });
  try {
    await app.evaluate(async ({ clipboard }) => {
      await clipboard.writeText("Redis caches hot keys");
    });
    await bar(page).focus();
    await page.keyboard.press("Meta+V");
    await page.keyboard.type(" and PostgreSQL");
    await page.waitForTimeout(1200);
    expect(mock?.requests ?? []).toHaveLength(0);
    await expect(bar(page)).toHaveValue("Redis caches hot keys and PostgreSQL");
  } finally {
    await app.close();
  }
});

test("when the model's answer is unusable, the user's own words are kept in the page", async () => {
  test.setTimeout(120_000);
  const { app, page } = await launch({
    script: [{ kind: "reply", content: "```graph\nbroken ->\n```" }],
  });
  try {
    await bar(page).fill("Kafka partitions keep ordering per key");
    await bar(page).press("Enter");
    await expect(page.locator(".page-editor")).toContainText(
      "Kafka partitions keep ordering per key",
      { timeout: 30_000 },
    );
    await expect(
      page.getByText("I couldn't structure that, so I added your words as they are."),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});

test("when LM Studio has no model loaded the bar says so and nothing is added", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch({ models: [] });
  try {
    await bar(page).fill("Redis caches hot keys");
    await bar(page).press("Enter");
    await expect(
      page.getByText("qwen3.8-27b isn't loaded in LM Studio. Load it, then try again."),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.locator(".page-editor")).not.toContainText("Redis caches hot keys");
  } finally {
    await app.close();
  }
});

/** What Wispr Flow does: puts the words on the clipboard and presses ⌘V, wherever the focus happens to be. */
async function wisprPaste(app: ElectronApplication, page: Page, words: string): Promise<void> {
  await app.evaluate(async ({ clipboard }, text) => {
    await clipboard.writeText(text);
  }, words);
  await page.keyboard.press("Meta+V");
}
const requestsSent = () => mock?.requests.length ?? 0;

test("a paste goes to the input box and is sent, wherever the focus is: on a button, on nothing, on the read-only title", async () => {
  test.setTimeout(120_000);
  const script = Array.from({ length: 3 }, () => ({ kind: "reply" as const, content: notes }));
  const { app, page } = await launch({ script });
  try {
    // 1. After clicking a button (focus is on it, which cannot take text).
    await page.locator('summary[aria-label="Page actions"]').focus();
    await wisprPaste(app, page, "Load balancer first thing. ");
    await expect.poll(requestsSent, { timeout: 30_000 }).toBe(1);
    const sentFirst = JSON.stringify(mock?.requests[0]?.body);
    expect(sentFirst).toContain("UTTERANCE:\\nLoad balancer first thing.");
    await expect(page.locator(".page-editor h2")).toHaveText("Load Balancer", { timeout: 30_000 });
    // The box took it, was emptied by sending, and has the focus for the next one.
    await expect(bar(page)).toHaveValue("");
    await expect(bar(page)).toBeFocused();

    // 2. With focus on nothing at all.
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await wisprPaste(app, page, "Health checks keep traffic away from unhealthy servers. ");
    await expect.poll(requestsSent, { timeout: 30_000 }).toBe(2);
    expect(JSON.stringify(mock?.requests[1]?.body)).toContain("Health checks keep traffic away");

    // 3. With the cursor in the page title, which is read-only outside Edit mode.
    await page.getByLabel("Page title").focus();
    await wisprPaste(app, page, "The database can become the bottleneck. ");
    await expect.poll(requestsSent, { timeout: 30_000 }).toBe(3);
    await expect(page.getByLabel("Page title")).toHaveValue("Load balancing");
  } finally {
    await app.close();
  }
});

test("a paste keeps going where it was meant: into an open dialog's field, and into the page in Edit mode", async () => {
  test.setTimeout(120_000);
  const { app, page } = await launch({ script: [{ kind: "reply", content: notes }] });
  try {
    // A dialog is open: the words go into its field, not into the box.
    await page.getByRole("button", { name: /Settings/ }).click();
    const name = page
      .getByRole("dialog", { name: "Settings" })
      .getByRole("textbox", { name: /^Your name/ });
    await name.fill("");
    await name.focus();
    await wisprPaste(app, page, "Asha");
    await expect(name).toHaveValue("Asha");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
    expect(requestsSent()).toBe(0);
    await expect(bar(page)).toHaveValue("");

    // Edit mode: the page is typed in by hand, so a paste there is text in the page.
    await page.keyboard.press("Meta+e");
    await page.locator(".page-editor [contenteditable='true']").first().click();
    await wisprPaste(app, page, "typed in by hand");
    await expect(page.locator(".page-editor")).toContainText("typed in by hand");
    expect(requestsSent()).toBe(0);
  } finally {
    await app.close();
  }
});

test("a paste while the diagram builder is open goes to the builder", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch({ script: [] });
  try {
    await bar(page).fill("diagram mode");
    await bar(page).press("Enter");
    const builder = page.getByRole("region", { name: "Diagram builder" });
    await expect(builder).toBeVisible();
    // Focus is on a tab of the builder, which cannot take text (Undo would be disabled and keep the focus where it was).
    const tab = builder.getByRole("tab", { name: /Components/ });
    await tab.focus();
    await expect(tab).toBeFocused();
    await wisprPaste(app, page, "client, server, database ");
    await expect(builder.getByLabel("Numbers")).toContainText("3 Database", { timeout: 15_000 });
    expect(requestsSent()).toBe(0);
  } finally {
    await app.close();
  }
});
