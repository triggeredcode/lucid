import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registry } from "@lucid/kit";
import { _electron as electron, expect, test } from "@playwright/test";
import { autoSaveDialog, downloadPdf, maximizeWindow } from "../e2e/helpers";

/**
 * The packaged app, as a person who installed it would run it: no Homebrew, nothing on the PATH, nothing but the app. A new
 * folder is the library; LM Studio is not needed for any of this.
 */
// LUCID_APP points the tests at another copy (for example the one taken out of the .dmg).
const APP = realpathSync(
  process.env["LUCID_APP"] ?? join(__dirname, "../release/mac-arm64/Lucid.app"),
);
const BINARY = join(APP, "Contents/MacOS/Lucid");
const RESOURCES = join(APP, "Contents/Resources");

const bare = (home: string) => ({
  ...process.env,
  LUCID_HOME: home,
  PATH: "/usr/bin:/bin",
});

async function launch(home = mkdtempSync(join(tmpdir(), "lucid-home-"))) {
  const app = await electron.launch({ executablePath: BINARY, env: bare(home) });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  return { app, page, home };
}

test("the app is there, is signed, and carries what it needs", () => {
  expect(existsSync(BINARY), "run `pnpm dist:dir` first").toBe(true);
  for (const file of [
    "bin/tectonic",
    "guide.html",
    "lucid-mcp.mjs",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "LICENSES.chromium.html",
  ])
    expect(existsSync(join(RESOURCES, file)), file).toBe(true);
  expect(statSync(join(RESOURCES, "bin/tectonic")).mode & 0o111).not.toBe(0);
  // Apple Silicon only runs signed code: ad hoc at least, and the signature must be intact.
  execFileSync("codesign", ["--verify", "--deep", "--strict", APP]);
  // Everything is bundled into one small archive: no node_modules travel with it (they would make it ten times bigger).
  expect(statSync(join(RESOURCES, "app.asar")).size).toBeLessThan(25_000_000);
  expect(existsSync(join(RESOURCES, "app"))).toBe(false);
});

test("it opens as Lucid 0.1.0, and a PDF with a diagram is made with nothing installed", async () => {
  const { app, page } = await launch();
  try {
    const identity = await app.evaluate(({ app: a }) => [
      a.isPackaged,
      a.getVersion(),
      a.getName(),
    ]);
    expect(identity).toEqual([true, "0.1.0", "Lucid"]);

    const diagram = registry.get("diagram").fixtures[0];
    if (!diagram) throw new Error("no diagram fixture");
    await page.evaluate(async (d) => {
      const file = await window.lucid.pages.create("Request flow");
      await window.lucid.pages.save({ ...file, doc: { blocks: [d] } });
    }, diagram);
    await page.reload();
    await page
      .getByRole("navigation", { name: "Pages" })
      .getByRole("button", { name: /Request flow/ })
      .click();
    await expect(page.locator(".page-editor svg g.node").first()).toBeVisible({ timeout: 20_000 });

    const path = await autoSaveDialog(app);
    // The first PDF may wait for the engine to prepare itself (it fetches typesetting files once).
    const text = await downloadPdf(page, path);
    await expect(page.locator(".export-note")).not.toContainText("could not be drawn");
    if (text !== undefined)
      for (const word of ["Web Server", "Redis"]) expect(text, word).toContain(word);
  } finally {
    await app.close();
  }
});

test("the Help menu opens the guide that comes with the app, and the links go to the project", async () => {
  const { app } = await launch();
  try {
    const opened = await app.evaluate(({ Menu, shell }) => {
      const log: string[] = [];
      shell.openPath = (p: string) => {
        log.push(`path:${p}`);
        return Promise.resolve("");
      };
      shell.openExternal = (u: string) => {
        log.push(`url:${u}`);
        return Promise.resolve();
      };
      for (const id of [
        "help-guide",
        "help-issue",
        "help-releases",
        "help-source",
        "help-licenses",
      ])
        Menu.getApplicationMenu()?.getMenuItemById(id)?.click();
      return log;
    });
    expect(opened[0]).toBe(`path:${join(RESOURCES, "guide.html")}`);
    expect(existsSync(join(RESOURCES, "guide.html"))).toBe(true);
    expect(opened).toContain("url:https://github.com/triggeredcode/lucid/issues/new/choose");
    expect(opened).toContain("url:https://github.com/triggeredcode/lucid/releases/latest");
    expect(opened).toContain("url:https://github.com/triggeredcode/lucid");
    expect(opened).toContain(`path:${join(RESOURCES, "THIRD_PARTY_NOTICES.md")}`);
  } finally {
    await app.close();
  }
});

test("opening Lucid a second time brings the first to the front instead of starting another", async () => {
  const { app, home } = await launch();
  try {
    const started = Date.now();
    // The second one finds the first and ends by itself.
    await new Promise<void>((resolve, reject) => {
      const second = spawn(BINARY, [], { env: bare(home), stdio: "ignore" });
      const timer = setTimeout(() => {
        second.kill("SIGKILL");
        reject(new Error("the second Lucid did not end by itself"));
      }, 30_000);
      second.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(app.windows().length).toBe(1);
  } finally {
    await app.close();
  }
});

function mcpList(home: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // The agent bridge as Claude Code would start it: the app's own program run as Node, with the file that comes with it.
    const child = spawn(BINARY, [join(RESOURCES, "lucid-mcp.mjs")], {
      env: { ...bare(home), ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "inherit"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`no answer from lucid-mcp: ${out}`));
    }, 30_000);
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.includes('"id":2')) {
        clearTimeout(timer);
        child.kill();
        resolve(out);
      }
    });
    const send = (m: unknown) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_documents", arguments: {} },
    });
  });
}

test("an agent can reach the open app with the bridge that comes with it, with no Node installed", async () => {
  const { app, page, home } = await launch();
  try {
    await page.evaluate(async () => {
      await window.lucid.pages.create("Agent page");
    });
    const answer = await mcpList(home);
    expect(answer).toContain("Agent page");
  } finally {
    await app.close();
  }
});
