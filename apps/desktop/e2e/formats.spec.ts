import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
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

const reply = (content: string, delayMs?: number): Behaviour => ({
  kind: "reply",
  content,
  chunkChars: 200,
  ...(delayMs === undefined ? {} : { delayMs }),
});
const advice = (formatId: string, title: string, reason: string) =>
  JSON.stringify({ formatId, title, reason });

async function launch(script: Behaviour[] = []): Promise<{
  app: ElectronApplication;
  page: Page;
  home: string;
}> {
  mock = await startMockLmStudio({ script });
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home, LUCID_LLM_URL: mock.url },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  return { app, page, home };
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "New page" });
const formatOption = (page: Page, name: string) =>
  dialog(page).getByRole("radio", { name: new RegExp(`^${name}`) });
const headings = (page: Page) => page.locator(".page-editor h2");
const pageFile = (home: string) => {
  const name = readdirSync(home).find((n) => n !== ".lucid" && n.endsWith(".lucid"));
  return JSON.parse(readFileSync(join(home, name ?? ""), "utf8")) as {
    meta: { format?: string; info: Record<string, string> };
    doc: { blocks: { type: string }[] };
  };
};

test("a new page from a format: the model's choice and title, and the page starts as the sections", async () => {
  test.setTimeout(60_000);
  const { app, page, home } = await launch([
    reply(advice("comparison", "SQL vs NoSQL for sessions", "Two options are compared.")),
  ]);
  try {
    await page.getByRole("button", { name: "New from a format…" }).click();
    await expect(dialog(page)).toBeVisible();
    // Blank is the default.
    await expect(formatOption(page, "Blank page")).toBeChecked();

    // It is laid out as a dialog (a white card, the field and the six formats readable), not squeezed into a row.
    const look = await dialog(page).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const about = el.querySelector("textarea")?.getBoundingClientRect();
      const first = el.querySelector(".np-format")?.getBoundingClientRect();
      const second = el.querySelectorAll(".np-format")[1]?.getBoundingClientRect();
      return {
        background: getComputedStyle(el).backgroundColor,
        width: box.width,
        height: box.height,
        windowHeight: window.innerHeight,
        aboutWidth: about?.width ?? 0,
        formatWidth: first?.width ?? 0,
        sameRow: first && second ? Math.abs(first.top - second.top) < 4 : false,
      };
    });
    expect(look.background).toBe("rgb(255, 255, 255)");
    expect(look.width).toBeGreaterThan(500);
    expect(look.aboutWidth).toBeGreaterThan(400);
    expect(look.formatWidth).toBeGreaterThan(180);
    expect(look.sameRow).toBe(true);
    expect(look.height).toBeLessThan(look.windowHeight);

    await dialog(page)
      .getByLabel("What will you write about?")
      .fill("SQL versus NoSQL for storing sessions");
    await dialog(page).getByRole("button", { name: "Suggest a format" }).click();
    await expect(formatOption(page, "Comparison")).toBeChecked();
    // Then the model answers, with its reason and its title.
    await expect(dialog(page).getByRole("status")).toContainText(
      "Suggested: Comparison. Two options are compared.",
      {
        timeout: 30_000,
      },
    );
    await expect(dialog(page).getByLabel("Title")).toHaveValue("SQL vs NoSQL for sessions");

    await dialog(page).getByRole("button", { name: "Create page" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(headings(page)).toHaveText([
      "Context",
      "Options",
      "Comparison",
      "Pros and cons",
      "Decision",
    ]);
    await expect(page.getByRole("button", { name: /^Comparison/ })).toBeVisible();
    await expect(page.getByLabel("Page title")).toHaveValue("SQL vs NoSQL for sessions");
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
    expect(pageFile(home).meta.format).toBe("comparison");
    expect(pageFile(home).doc.blocks.map((b) => b.type)).toEqual(Array(5).fill("heading"));
  } finally {
    await app.close();
  }
});

test("what the person chose is not overwritten by a late answer, and the page can be blank", async () => {
  test.setTimeout(60_000);
  const { app, page, home } = await launch([
    reply(advice("system-design", "Designing a URL shortener", "It designs a system."), 1200),
  ]);
  try {
    await page.getByRole("button", { name: "New from a format…" }).click();
    await dialog(page).getByLabel("What will you write about?").fill("design a url shortener");
    await dialog(page).getByRole("button", { name: "Suggest a format" }).click();
    await expect(formatOption(page, "System design note")).toBeChecked();
    // The person picks something else before the model has answered.
    await formatOption(page, "Benchmark note").check({ force: true });
    await dialog(page).getByLabel("Title").fill("My own title");
    await expect(dialog(page).getByRole("status")).toContainText("Suggested: System design note", {
      timeout: 30_000,
    });
    await expect(formatOption(page, "Benchmark note")).toBeChecked();
    await expect(dialog(page).getByLabel("Title")).toHaveValue("My own title");

    await formatOption(page, "Blank page").check({ force: true });
    await dialog(page).getByRole("button", { name: "Create page" }).click();
    await expect(page.getByLabel("Page title")).toHaveValue("My own title");
    await expect(page.getByRole("button", { name: /^Blank page/ })).toBeVisible();
    await expect(headings(page)).toHaveCount(0);
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
    expect(pageFile(home).meta.format).toBeUndefined();
  } finally {
    await app.close();
  }
});

test("when the model is not there the keyword pick still works, and Esc closes the dialog", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch([{ kind: "http-error", status: 500, message: "boom" }]);
  try {
    await page.getByRole("button", { name: "New from a format…" }).click();
    await dialog(page)
      .getByLabel("What will you write about?")
      .fill("benchmarking qwen vs gemma tok/s on my mac");
    await dialog(page).getByRole("button", { name: "Suggest a format" }).click();
    await expect(formatOption(page, "Benchmark note")).toBeChecked();
    await expect(dialog(page).getByRole("status")).toContainText("Looks like a benchmark note.");
    await expect(dialog(page).getByRole("status")).not.toContainText("Asking the model", {
      timeout: 30_000,
    });
    await expect(formatOption(page, "Benchmark note")).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
  } finally {
    await app.close();
  }
});

test("dictation on a format page goes under the section it belongs to, and the model is told the sections", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch([reply("@@ section Options\n- Kafka\n- SQS")]);
  try {
    await page.getByRole("button", { name: "New from a format…" }).click();
    await formatOption(page, "Comparison").check({ force: true });
    await dialog(page).getByRole("button", { name: "Create page" }).click();
    await expect(headings(page)).toHaveCount(5);
    await page.keyboard.press("Escape");

    const bar = page.getByLabel("Dictate or type your notes");
    await bar.fill("The options we are looking at are Kafka and SQS.");
    await bar.press("Enter");
    await expect(page.locator('.page-editor [data-content-type="bulletListItem"]')).toHaveText(
      ["Kafka", "SQS"],
      {
        timeout: 30_000,
      },
    );
    // They sit between the Options and Comparison headings.
    const order = await page
      .locator(".page-editor .bn-block-content")
      .evaluateAll((els) => els.map((e) => e.textContent.trim()).filter((t) => t.length > 0));
    expect(order).toEqual([
      "Context",
      "Options",
      "Kafka",
      "SQS",
      "Comparison",
      "Pros and cons",
      "Decision",
    ]);
    expect(JSON.stringify(mock?.requests[0]?.body)).toContain("SECTIONS of this comparison");
  } finally {
    await app.close();
  }
});

test("the format chip changes the format and the fields shown under the title, and the PDF prints only what is filled in", async () => {
  test.setTimeout(180_000);
  const { app, page, home } = await launch([
    reply("@@ section Goal and hypothesis\nDoes batching raise throughput?"),
  ]);
  try {
    await page.getByRole("button", { name: "New from a format…" }).click();
    await formatOption(page, "Benchmark note").check({ force: true });
    await dialog(page).getByLabel("Title").fill("Batching");
    await dialog(page).getByRole("button", { name: "Create page" }).click();
    await expect(headings(page)).toHaveCount(6);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /^Benchmark note/ }).click();
    const pop = page.getByRole("dialog", { name: "Note format" });
    await pop.getByLabel("Hardware").fill("M4 Max, 48 GB");
    await pop.getByLabel("Date").fill("2026-10-11");
    await page.keyboard.press("Escape");
    await expect(pop).toBeHidden();

    const bar = page.getByLabel("Dictate or type your notes");
    await bar.fill("Does batching raise throughput?");
    await bar.press("Enter");
    await expect(page.locator(".page-editor")).toContainText("Does batching raise throughput?", {
      timeout: 30_000,
    });
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
    expect(pageFile(home).meta.info).toEqual({ hardware: "M4 Max, 48 GB", date: "2026-10-11" });

    const path = await autoSaveDialog(app);
    const text = await downloadPdf(page, path);
    if (text !== undefined) {
      expect(text).toContain("Hardware: M4 Max, 48 GB");
      expect(text).toContain("Date: 2026-10-11");
      expect(text).toContain("Goal and hypothesis");
      expect(text).not.toContain("Next experiments");
      expect(text).not.toContain("Observations");
    }
  } finally {
    await app.close();
  }
});

test("a blank page can take a format later, and the missing sections are added in one undo step", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch();
  try {
    await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
    await expect(page.getByLabel("Page title")).toBeFocused();
    await page.keyboard.type("Raft");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /^Blank page/ }).click();
    const pop = page.getByRole("dialog", { name: "Note format" });
    await pop.getByRole("radio", { name: "Concept note" }).check();
    await pop.getByRole("button", { name: "Add the 6 missing sections" }).click();
    await expect(headings(page)).toHaveText([
      "Definition",
      "Intuition",
      "How it works",
      "Example",
      "Pitfalls and gotchas",
      "Related concepts",
    ]);
    await expect(pop.getByRole("button", { name: /missing section/ })).toBeHidden();
    await page.keyboard.press("Escape");

    const bar = page.getByLabel("Dictate or type your notes");
    await bar.fill("undo");
    await bar.press("Enter");
    await expect(headings(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});
