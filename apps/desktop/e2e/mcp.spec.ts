import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_DOC } from "@lucid/kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { _electron as electron, expect, test } from "@playwright/test";
import { maximizeWindow, showHistory } from "./helpers";

/** The shipped MCP server (one bundled file), the way Claude Code starts it. */
const bundleFile = (): string => {
  execFileSync(process.execPath, [join(__dirname, "../../../packages/mcp/scripts/bundle.mjs")]);
  return join(__dirname, "../../../packages/mcp/dist/lucid-mcp.mjs");
};

const text = (r: unknown): string =>
  (r as { content: { text: string }[] }).content.map((c) => c.text).join("\n");

test("an agent reads and edits the open page through MCP: it shows up, is one undo step and is listed in History", async () => {
  test.setTimeout(120_000);
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  const client = new Client({ name: "claude-code", version: "1" });
  try {
    // "Scratch" first, so the page that was saved last (the sample) is the one the window opens.
    const ids = await page.evaluate(async (doc) => {
      const other = await window.lucid.pages.create("Scratch");
      await new Promise((r) => setTimeout(r, 20));
      const open = await window.lucid.pages.create("Request flow and databases");
      await window.lucid.pages.save({ ...open, doc });
      return { open: open.id, other: other.id };
    }, SAMPLE_DOC);
    await page.reload();
    await expect(page.locator(".page-editor")).toContainText("MongoDB");

    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [bundleFile()],
        env: { ...process.env, LUCID_HOME: home },
      }),
    );

    // Reading: the library, and the open page's outline with references.
    expect(text(await client.callTool({ name: "list_documents", arguments: {} }))).toContain(
      "Request flow and databases",
    );
    const outline = text(await client.callTool({ name: "get_outline", arguments: {} }));
    expect(outline).toContain("open in Lucid");
    const revision = /revision (\w+)\)/.exec(outline)?.[1];
    expect(revision).toBeTruthy();

    // Writing notes: they appear in the editor.
    const added = await client.callTool({
      name: "insert_notes",
      arguments: { lmd: "## Eviction\nLRU drops the **least recently used** key.", revision },
    });
    expect(added.isError).toBe(false);
    await expect(page.locator(".page-editor h2", { hasText: "Eviction" })).toBeVisible();
    await expect(page.locator(".page-editor")).toContainText("least recently used");

    // The change is listed in History as the agent's, and the window says who did it.
    await expect(page.getByText("Claude Code: Added 2 blocks")).toBeVisible();
    await showHistory(page);
    const history = page.getByRole("complementary", { name: "History" });
    await expect(history.locator('li[data-source="agent"]')).toContainText("Added 2 blocks");

    // One undo takes the whole thing back.
    const bar = page.getByLabel("Dictate or type your notes");
    await bar.fill("undo");
    await bar.press("Enter");
    await expect(page.locator(".page-editor")).not.toContainText("Eviction");

    // An old revision is refused, so an agent cannot edit a page it has not seen.
    const stale = await client.callTool({
      name: "insert_notes",
      arguments: { lmd: "Should not land.", revision },
    });
    expect(stale.isError).toBe(true);
    await expect(page.locator(".page-editor")).not.toContainText("Should not land");

    // Targeted edits by reference: cross out MongoDB and add a CDN.
    const fresh = text(await client.callTool({ name: "get_outline", arguments: {} }));
    expect(fresh).toContain("[b6.2] MongoDB");
    const ops = await client.callTool({
      name: "apply_ops",
      arguments: {
        summary: "Struck MongoDB and added a CDN",
        ops: [
          { op: "set_status", target: "b6.2", in: null, status: "struck" },
          {
            op: "graph.insert_between",
            target: "b3",
            from: "client",
            to: "web",
            node: "cdn [cdn]: CDN",
            labels: null,
          },
        ],
      },
    });
    expect(ops.isError).toBe(false);
    await expect(page.locator(".page-editor")).toContainText("CDN", { timeout: 20_000 });
    const mongo = page
      .locator('.page-editor [data-content-type="bulletListItem"]')
      .filter({ hasText: /^MongoDB$/ });
    await expect(mongo).toHaveCSS("text-decoration-line", "line-through");

    // The open page is saved by the editor, with the agent's entry in its history.
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({
      timeout: 15_000,
    });
    const saved = JSON.parse(
      readFileSync(
        join(
          home,
          readdirSync(home).find((n) => n.startsWith("request-flow") && n.endsWith(".lucid")) ?? "",
        ),
        "utf8",
      ),
    ) as { changeLog: { source: string; summary: string }[] };
    expect(saved.changeLog.map((c) => c.source)).toContain("agent:claude-code");

    // A page that is not open is changed on disk, and the page list notices.
    const other = await client.callTool({
      name: "insert_notes",
      arguments: { page_id: ids.other, lmd: "# Scratch notes\nWritten by an agent." },
    });
    expect(other.isError).toBe(false);
    const file = readdirSync(home).find((n) => n.startsWith("scratch") && n.endsWith(".lucid"));
    const scratch = JSON.parse(readFileSync(join(home, file ?? ""), "utf8")) as {
      doc: { blocks: unknown[] };
      changeLog: { source: string }[];
    };
    expect(scratch.doc.blocks.length).toBeGreaterThan(0);
    expect(scratch.changeLog.at(-1)?.source).toBe("agent:claude-code");
  } finally {
    await client.close().catch(() => undefined);
    await app.close();
  }
});

test("the MCP server says so when Lucid is not running", async () => {
  test.setTimeout(60_000);
  const empty = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const client = new Client({ name: "claude-code", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [bundleFile()],
        env: { ...process.env, LUCID_HOME: empty },
      }),
    );
    const r = await client.callTool({ name: "list_documents", arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Lucid is not running");
  } finally {
    await client.close().catch(() => undefined);
  }
});

test("an agent can see the formats, create a page of one, and put notes under its sections", async () => {
  test.setTimeout(120_000);
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  const client = new Client({ name: "claude-code", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [bundleFile()],
        env: { ...process.env, LUCID_HOME: home },
      }),
    );
    const formats = text(await client.callTool({ name: "list_formats", arguments: {} }));
    expect(formats).toContain("concept-note: Concept note.");
    expect(formats).toContain("  - Intuition:");
    expect(formats).not.toContain("benchmark");

    const made = text(
      await client.callTool({
        name: "create_document",
        arguments: { title: "Agent concept", format: "concept-note" },
      }),
    );
    expect(made).toContain("format concept-note");
    // The page appears in the list at once; opening it shows the format.
    const row = page.getByRole("navigation", { name: "Pages" }).getByText("Agent concept");
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.locator(".page-editor h2")).toHaveCount(6);
    await expect(page.getByRole("button", { name: /^Concept note/ })).toBeVisible();

    const outline = text(await client.callTool({ name: "get_outline", arguments: {} }));
    expect(outline).toContain("open in Lucid, format concept-note");
    expect(outline).toContain("SECTIONS of this concept note");

    const added = await client.callTool({
      name: "insert_notes",
      arguments: { lmd: "- Hash the key\n- Set the bits", position: "section:Intuition" },
    });
    expect(added.isError).toBe(false);
    const order = await page
      .locator(".page-editor .bn-block-content")
      .evaluateAll((els) => els.map((e) => e.textContent.trim()).filter((t) => t.length > 0));
    expect(order.slice(0, 5)).toEqual([
      "Definition",
      "Intuition",
      "Hash the key",
      "Set the bits",
      "How it works",
    ]);

    const bad = await client.callTool({
      name: "create_document",
      arguments: { title: "X", format: "essay" },
    });
    expect(bad.isError).toBe(true);
  } finally {
    await client.close().catch(() => undefined);
    await app.close();
  }
});
