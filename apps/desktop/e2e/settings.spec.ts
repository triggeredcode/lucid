import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockLmStudio, type Behaviour, type MockLmStudio } from "@lucid/mock-lmstudio";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { autoSaveDialog, downloadPdf, maximizeWindow } from "./helpers";

let mock: MockLmStudio | undefined;
test.afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const reply = (content: string): Behaviour => ({ kind: "reply", content, chunkChars: 200 });

async function launch(script: Behaviour[] = []): Promise<{
  app: ElectronApplication;
  page: Page;
  home: string;
}> {
  mock = await startMockLmStudio({ models: ["qwen/qwen3.8-27b", "other/model-7b"], script });
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home, LUCID_LLM_URL: mock.url },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  return { app, page, home };
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });
/** A field of the dialog by the start of its label (the labels carry a help line too). */
const field = (page: Page, label: RegExp) => dialog(page).getByRole("textbox", { name: label });
const MODEL = /^Model\b/;
const ADDRESS = /^Base URL/;
const NAME = /^Your name/;
const FOOTER = /^Footer/;
const WORDS = /^One per line/;
const CONTEXT = /^Context length/;
const stored = (home: string) =>
  JSON.parse(readFileSync(join(home, ".lucid", "settings.json"), "utf8")) as {
    author: string;
    footerRight: string;
    vocabulary: string[];
    tectonicPath: string;
    llm: { model: string; contextLength: number; baseUrl: string };
  };

test("in a short window Save and Cancel stay on screen while the form scrolls", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch();
  try {
    // On purpose: this test is about a short window. The window itself is made smaller (not a faked viewport).
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.unmaximize();
      win?.setSize(1100, 640);
    });
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThanOrEqual(640);
    const height = await page.evaluate(() => window.innerHeight);
    await page.getByRole("button", { name: /Settings/ }).click();
    const box = dialog(page);
    await expect(box).toBeVisible();
    const scrolls = await box.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls, "the form is taller than the window, so it scrolls").toBe(true);
    for (const name of ["Save", "Cancel"]) {
      const b = await box.getByRole("button", { name }).boundingBox();
      expect(b?.y ?? 0, `${name} is above the bottom of the window`).toBeGreaterThan(0);
      expect((b?.y ?? 0) + (b?.height ?? 0), `${name} is inside the window`).toBeLessThanOrEqual(
        height,
      );
    }
    // The last field is reachable by scrolling, and the buttons are still there.
    await field(page, WORDS).scrollIntoViewIfNeeded();
    await expect(box.getByRole("button", { name: "Save" })).toBeInViewport();
  } finally {
    await app.close();
  }
});

test("Settings opens from the sidebar and with ⌘, , closes with Esc, and shows the current values", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch();
  try {
    await page.getByRole("button", { name: /Settings/ }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(field(page, MODEL)).toHaveValue("qwen/qwen3.8-27b");
    // Nothing personal is built in: the name and the footer of the PDFs start empty.
    await expect(field(page, NAME)).toHaveValue("");
    await expect(field(page, FOOTER)).toHaveValue("");
    // The address is fixed here by the test setup (LUCID_LLM_URL), and says so.
    await expect(field(page, ADDRESS)).toBeDisabled();
    await expect(dialog(page)).toContainText("LUCID_LLM_URL");

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await page.keyboard.press("Meta+,");
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toBeHidden();
  } finally {
    await app.close();
  }
});

test("provider profiles expose only relevant controls and keep cloud use explicit", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch();
  try {
    await page.getByRole("button", { name: /Settings/ }).click();
    const box = dialog(page);
    await expect(box.getByRole("group", { name: "AI providers" })).toContainText(
      "never switches providers automatically",
    );
    await box.getByLabel("Provider to add").selectOption("openai");
    await box.getByRole("button", { name: "Add", exact: true }).click();
    await expect(field(page, /^API key/)).toBeVisible();
    await expect(field(page, ADDRESS)).toBeDisabled();
    await expect(box).toContainText("subscriptions do not include API access");
    await expect(box).toContainText("selected note context");
    await box.getByRole("button", { name: "Set default" }).click();
    await box.getByRole("button", { name: "Save", exact: true }).click();
    await expect(box).toBeHidden();

    await page.keyboard.press("Meta+,");
    await expect(box).toContainText("OpenAI API · default");
  } finally {
    await app.close();
  }
});

test("saved settings apply at once: the model asked, the PDF footer, the words; and they are in the settings file", async () => {
  test.setTimeout(120_000);
  const notes = "## Caching\n- Redis keeps hot keys in memory.";
  const { app, page, home } = await launch([reply(notes)]);
  try {
    await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
    await expect(page.getByLabel("Page title")).toBeFocused();
    await page.keyboard.type("Caching");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /Settings/ }).click();
    await field(page, MODEL).fill("other/model-7b");
    await field(page, NAME).fill("Asha");
    await field(page, FOOTER).fill("Study notes");
    await field(page, WORDS).fill("vLLM\nKubernetes\n\nvLLM");
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(dialog(page)).toBeHidden();

    const s = stored(home);
    expect(s).toMatchObject({
      author: "Asha",
      footerRight: "Study notes",
      vocabulary: ["vLLM", "Kubernetes"],
    });
    expect(s.llm.model).toBe("other/model-7b");
    // Settings the window cannot change are untouched.
    expect(s.tectonicPath).toBe("");

    // The next request goes to the new model.
    const bar = page.getByLabel("Dictate or type your notes");
    await bar.fill("Redis keeps hot keys in memory.");
    await bar.press("Enter");
    await expect(page.locator(".page-editor h2")).toHaveText("Caching", { timeout: 30_000 });
    expect(mock?.requests[0]?.body).toMatchObject({ model: "other/model-7b" });

    // The next PDF is signed with the new footer.
    const path = await autoSaveDialog(app);
    const text = await downloadPdf(page, path);
    if (text !== undefined) {
      expect(text).toContain("Study notes");
      expect(text).toContain("Asha");
    }

    // Opening Settings again shows what was saved.
    await page.keyboard.press("Meta+,");
    await expect(field(page, FOOTER)).toHaveValue("Study notes");
    await expect(field(page, WORDS)).toHaveValue("vLLM\nKubernetes");
  } finally {
    await app.close();
  }
});

test("a wrong value is explained and nothing is saved", async () => {
  test.setTimeout(60_000);
  const { app, page, home } = await launch();
  try {
    await page.getByRole("button", { name: /Settings/ }).click();
    await field(page, MODEL).fill("x; rm -rf /");
    await field(page, CONTEXT).fill("12");
    await field(page, NAME).fill("x".repeat(81));
    await dialog(page).getByRole("button", { name: "Save" }).click();
    const problems = dialog(page).getByRole("alert");
    await expect(problems).toContainText("must be a model name");
    await expect(problems).toContainText("author");
    await expect(dialog(page)).toBeVisible();
    expect(stored(home)).toMatchObject({ author: "", llm: { model: "qwen/qwen3.8-27b" } });

    // Fix them and it saves.
    await field(page, MODEL).fill("other/model-7b");
    await field(page, CONTEXT).fill("16384");
    await field(page, NAME).fill("Asha");
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(dialog(page)).toBeHidden();
    expect(stored(home)).toMatchObject({
      author: "Asha",
      llm: { model: "other/model-7b", contextLength: 16384 },
    });
  } finally {
    await app.close();
  }
});

test("the model pill looks again when another model is saved", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch();
  try {
    await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
    const pill = page.getByRole("group", { name: "Model status" });
    await expect(pill).toHaveAttribute("data-state", "ready");
    await page.getByRole("button", { name: /Settings/ }).click();
    await field(page, MODEL).fill("not-loaded/model");
    await dialog(page).getByRole("button", { name: "Save" }).click();
    // Not 8 s later, at once.
    await expect(pill).toHaveAttribute("data-state", /needs-model/, { timeout: 5000 });
  } finally {
    await app.close();
  }
});
