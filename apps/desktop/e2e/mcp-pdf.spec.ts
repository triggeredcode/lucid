import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_DOC } from "@lucid/kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { _electron as electron, expect, test } from "@playwright/test";
import { maximizeWindow, showHistory } from "./helpers";

const PDFTOTEXT = "/opt/homebrew/bin/pdftotext";

/** The shipped MCP server (one bundled file), the way Claude Code starts it. */
const bundleFile = (): string => {
  execFileSync(process.execPath, [join(__dirname, "../../../packages/mcp/scripts/bundle.mjs")]);
  return join(__dirname, "../../../packages/mcp/dist/lucid-mcp.mjs");
};

const text = (r: unknown): string =>
  (r as { content: { text: string }[] }).content.map((c) => c.text).join("\n");

test("an agent has a page typeset as a PDF through MCP: the open page and a closed one, the page is untouched", async () => {
  test.setTimeout(180_000);
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  const client = new Client({ name: "claude-code", version: "1" });
  try {
    const ids = await page.evaluate(async (doc) => {
      const other = await window.lucid.pages.create("Scratch notes");
      await window.lucid.pages.save({ ...other, doc });
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
    const before = await page.locator(".page-editor").innerText();

    // The open page: the window draws the diagram, the engine typesets, the file is in <library>/exports.
    const made = await client.callTool({ name: "export_pdf", arguments: {} });
    expect(made.isError).toBe(false);
    const path = /^Saved the PDF \(\d+ KB\): (.+\.pdf)/.exec(text(made))?.[1];
    expect(path).toBe(join(home, "exports", "request-flow-and-databases.pdf"));
    if (path === undefined) return;
    expect(readFileSync(path).subarray(0, 5).toString()).toBe("%PDF-");
    expect(statSync(path).size).toBeGreaterThan(3_000);
    if (existsSync(PDFTOTEXT)) {
      const words = execFileSync(PDFTOTEXT, [path, "-"], { encoding: "utf8" });
      expect(words).toContain("Request flow and databases");
      expect(words).toContain("Property");
      // The diagram was drawn by the window and arrived as a vector figure (its labels are in the PDF).
      expect(words).toContain("Web Server");
      expect(words).toContain("cache miss");
    }

    // A page that is not open is typeset from disk.
    const other = await client.callTool({ name: "export_pdf", arguments: { page_id: ids.other } });
    expect(other.isError).toBe(false);
    expect(text(other)).toContain(join(home, "exports", "scratch-notes.pdf"));
    expect(readdirSync(join(home, "exports")).sort()).toEqual([
      "request-flow-and-databases.pdf",
      "scratch-notes.pdf",
    ]);

    // A page that is not there is explained.
    const missing = await client.callTool({ name: "export_pdf", arguments: { page_id: "nope" } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain('There is no page "nope"');

    // Nothing changed in the window: same page, no agent entry in History, nothing to undo.
    expect(await page.locator(".page-editor").innerText()).toBe(before);
    await showHistory(page);
    const history = page.getByRole("complementary", { name: "History" });
    await expect(history.locator('li[data-source="agent"]')).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await client.close().catch(() => undefined);
    await app.close();
  }
});
