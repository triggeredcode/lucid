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
const strike = json({
  summary: "Crossed out MongoDB",
  ops: [{ op: "set_status", target: "b6.2", in: null, status: "struck" }],
});

/** A page that already has a diagram, a table and a list of options (COMMAND_DOC), open in the editor. */
async function launch(
  script: Behaviour[],
): Promise<{ app: ElectronApplication; page: Page; home: string }> {
  mock = await startMockLmStudio({ script });
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home, LUCID_LLM_URL: mock.url },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  await page.evaluate(async (doc) => {
    const file = await window.lucid.pages.create("Request flow and databases");
    await window.lucid.pages.save({ ...file, doc });
  }, COMMAND_DOC);
  await page.reload();
  await expect(page.locator(".page-editor")).toContainText("MongoDB");
  return { app, page, home };
}

const bar = (page: Page) => page.getByLabel("Dictate or type your notes");
const say = async (page: Page, text: string) => {
  await bar(page).fill(text);
  await bar(page).press("Enter");
};
const modeButton = (page: Page, name: "Input" | "Command") =>
  page.getByRole("group", { name: "Mode" }).getByRole("button", { name });
/** The list item with this text: where the page draws a crossed-out option. */
const struck = (page: Page, text: string) =>
  page
    .locator('.page-editor [data-content-type="bulletListItem"]')
    .filter({ hasText: new RegExp(`^${text}$`) });

test("the mode pill, the ⌘/ shortcut and the spoken 'command mode' all switch modes without asking the model", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch([]);
  try {
    await expect(modeButton(page, "Input")).toHaveAttribute("aria-pressed", "true");
    await expect(bar(page)).toHaveAttribute("placeholder", /Speak or type your notes/);
    await modeButton(page, "Command").click();
    await expect(modeButton(page, "Command")).toHaveAttribute("aria-pressed", "true");
    await expect(bar(page)).toHaveAttribute("placeholder", /Say or type what to change/);
    await page.keyboard.press("Meta+/");
    await expect(modeButton(page, "Input")).toHaveAttribute("aria-pressed", "true");
    await say(page, "Command mode.");
    await expect(modeButton(page, "Command")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Command mode: say what to change.")).toBeVisible();
    await say(page, "back to notes");
    await expect(modeButton(page, "Input")).toHaveAttribute("aria-pressed", "true");
    expect(mock?.requests).toHaveLength(0);
    await page.screenshot({ path: join(__dirname, "../test-results/app-modes.png") });
  } finally {
    await app.close();
  }
});

test("a command crosses out a list item on the page, is saved, and the voice command 'undo' takes it back", async () => {
  test.setTimeout(90_000);
  const { app, page, home } = await launch([reply(strike)]);
  try {
    await modeButton(page, "Command").click();
    await say(page, "cross out MongoDB");
    await expect(page.getByText("Crossed out MongoDB.")).toBeVisible({ timeout: 20_000 });
    await expect(struck(page, "MongoDB")).toHaveCSS("text-decoration-line", "line-through");
    await expect(struck(page, "PostgreSQL")).not.toHaveCSS("text-decoration-line", "line-through");

    // The model was asked with the command schema, the outline, and the hints.
    const body = mock?.requests[0]?.body;
    expect(body?.["response_format"]).toMatchObject({
      type: "json_schema",
      json_schema: { name: "lucid_command" },
    });
    const last = (body?.["messages"] as { content: string }[]).at(-1)?.content ?? "";
    expect(last).toContain("[b6] bullets: [b6.1] PostgreSQL | [b6.2] MongoDB | [b6.3] DynamoDB");
    expect(last).toContain("HINTS:");

    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({
      timeout: 15_000,
    });
    const file = readdirSync(home).find((n) => n !== ".lucid" && n.endsWith(".lucid"));
    const saved = JSON.parse(readFileSync(join(home, file ?? ""), "utf8")) as {
      doc: { blocks: { id: string; props: { status?: string } }[] };
      transcripts: { text: string; mode: string; status: string }[];
    };
    expect(saved.doc.blocks.find((b) => b.id === "o2")?.props.status).toBe("struck");
    expect(saved.transcripts.at(-1)).toMatchObject({
      text: "cross out MongoDB",
      mode: "command",
      status: "applied",
    });

    // "undo" is a voice command: no model call, one step back.
    await say(page, "undo");
    await expect(struck(page, "MongoDB")).not.toHaveCSS("text-decoration-line", "line-through");
    expect(mock?.requests).toHaveLength(1);
    await say(page, "redo");
    await expect(struck(page, "MongoDB")).toHaveCSS("text-decoration-line", "line-through");
  } finally {
    await app.close();
  }
});

test("a command that throws something away waits for a yes: by button, or by voice", async () => {
  test.setTimeout(90_000);
  const remove = json({
    summary: "Removed the comparison table",
    ops: [{ op: "delete", target: "b4" }],
  });
  const { app, page } = await launch([reply(remove), reply(remove)]);
  try {
    await modeButton(page, "Command").click();
    await say(page, "clean up the comparison");
    await expect(page.getByText("Apply this change?")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".lucid-table")).toBeVisible();
    await page.screenshot({ path: join(__dirname, "../test-results/app-proposal.png") });
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Apply this change?")).toHaveCount(0);
    await expect(page.locator(".lucid-table")).toBeVisible();

    await say(page, "clean up the comparison");
    await expect(page.getByText("Apply this change?")).toBeVisible({ timeout: 20_000 });
    await say(page, "yes");
    await expect(page.locator(".lucid-table")).toHaveCount(0);
    await expect(page.getByText("Removed the comparison table.")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".lucid-table")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("an unclear command asks which one, and the answer is sent back to the model", async () => {
  test.setTimeout(90_000);
  const ask = json({
    kind: "clarify",
    question: "Which connection do you mean?",
    options: [
      { label: "Web Server to Redis", ref: "e2" },
      { label: "Web Server to Client", ref: "e5" },
    ],
  });
  const removeEdge = json({
    summary: "Removed the connection",
    ops: [{ op: "graph.remove", target: "b3", nodes: [], edges: ["e5"] }],
  });
  const { app, page } = await launch([reply(ask), reply(removeEdge)]);
  try {
    await modeButton(page, "Command").click();
    await say(page, "remove the connection to the client");
    await expect(page.getByText("Which connection do you mean?")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: join(__dirname, "../test-results/app-clarify.png") });
    await page.getByRole("button", { name: /Web Server to Client/ }).click();
    await expect(page.getByText("Removed the connection.")).toBeVisible({ timeout: 20_000 });
    const second =
      (mock?.requests[1]?.body["messages"] as { content: string }[]).at(-1)?.content ?? "";
    expect(second).toContain("(I mean: Web Server to Client, e5)");
  } finally {
    await app.close();
  }
});

test("'Lucid, ...' in Input mode and holding the right Option key both send one command", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch([
    reply(strike),
    reply(json({ kind: "none", reason: "nothing to do" })),
  ]);
  try {
    await say(page, "Lucid, cross out MongoDB");
    await expect(page.getByText("Crossed out MongoDB.")).toBeVisible({ timeout: 20_000 });
    const first = mock?.requests[0]?.body;
    expect(first?.["response_format"]).toBeDefined();
    expect(
      (first?.["messages"] as { content: string }[])
        .at(-1)
        ?.content.endsWith("UTTERANCE:\ncross out MongoDB"),
    ).toBe(true);
    await expect(modeButton(page, "Input")).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.down("AltRight");
    await expect(modeButton(page, "Command")).toHaveAttribute("aria-pressed", "true");
    await bar(page).fill("do something odd");
    await page.keyboard.up("AltRight");
    await bar(page).press("Enter"); // within the grace period after release
    await expect(page.getByText("nothing to do")).toBeVisible({ timeout: 20_000 });
    expect(mock?.requests[1]?.body["response_format"]).toBeDefined();
  } finally {
    await app.close();
  }
});

test("the history lists what was said and lets a mistake be corrected and sent again", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch([
    reply(json({ kind: "none", reason: "There is nothing like that." })),
  ]);
  try {
    await modeButton(page, "Command").click();
    await say(page, "cross out Mongo DB please");
    await expect(page.getByText("There is nothing like that.")).toBeVisible({ timeout: 20_000 });
    await showHistory(page);
    const history = page.getByRole("complementary", { name: "History" });
    await expect(history).toContainText("cross out Mongo DB please");
    await page.screenshot({ path: join(__dirname, "../test-results/app-history.png") });
    await history.getByRole("button", { name: "Edit and send again" }).click();
    await expect(bar(page)).toHaveValue("cross out Mongo DB please");
    await expect(modeButton(page, "Command")).toHaveAttribute("aria-pressed", "true");
  } finally {
    await app.close();
  }
});
