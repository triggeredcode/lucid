import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registry } from "@lucid/kit";
import { _electron as electron, expect, test } from "@playwright/test";
import { autoSaveDialog, downloadPdf, maximizeWindow } from "../e2e/helpers";
import { APP, BINARY, EXTRA_ARGS, RESOURCES, TECTONIC, bareEnv } from "./target";

/**
 * The packaged app, as a person who installed it would run it: no Homebrew, nothing on the PATH, nothing but the app. A new
 * folder is the library; LM Studio is not needed for any of this.
 */
// Where the app is (and the other copy LUCID_APP can point to) is in target.ts. The tests run on macOS, Windows and Linux.
const VERSION = (
  JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")) as { version: string }
).version;
const bare = bareEnv;

/** What the app and its window printed, kept so that a failure on a machine nobody can look at can be read afterwards. */
const output: string[] = [];

async function launch(home = mkdtempSync(join(tmpdir(), "lucid-home-"))) {
  const app = await electron.launch({
    executablePath: BINARY,
    args: EXTRA_ARGS,
    env: { ...bare(home), ELECTRON_ENABLE_LOGGING: "1" },
  });
  const child = app.process();
  child.stdout?.on("data", (d: Buffer) => output.push(`[app out] ${d.toString().trimEnd()}`));
  child.stderr?.on("data", (d: Buffer) => output.push(`[app err] ${d.toString().trimEnd()}`));
  const page = await app.firstWindow();
  page.on("console", (m) => output.push(`[window ${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => output.push(`[window error] ${e.message}`));
  await maximizeWindow(app, page);
  return { app, page, home };
}

test.beforeEach(() => {
  output.length = 0;
});
// Playwright requires the first argument of a hook to be a destructuring pattern, even when it uses no fixture.
// eslint-disable-next-line no-empty-pattern
test.afterEach(({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  console.log(
    `---- what the app and its window printed (${testInfo.title}) ----\n${output.slice(-200).join("\n")}`,
  );
});

test("the app is there, carries what it needs, and is signed on a Mac", () => {
  expect(existsSync(BINARY), "run `pnpm dist:dir` first").toBe(true);
  for (const file of [
    "guide.html",
    "lucid-mcp.mjs",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "LICENSES.chromium.html",
  ])
    expect(existsSync(join(RESOURCES, file)), file).toBe(true);
  expect(existsSync(TECTONIC), TECTONIC).toBe(true);
  if (process.platform !== "win32") expect(statSync(TECTONIC).mode & 0o111).not.toBe(0);
  // Apple Silicon only runs signed code: ad hoc at least, and the signature must be intact.
  if (process.platform === "darwin")
    execFileSync("codesign", ["--verify", "--deep", "--strict", APP]);
  // Everything is bundled into one small archive: no node_modules travel with it (they would make it ten times bigger).
  expect(statSync(join(RESOURCES, "app.asar")).size).toBeLessThan(25_000_000);
  expect(existsSync(join(RESOURCES, "app"))).toBe(false);
});

test("it opens as Lucid with its own version, and a PDF with a diagram is made with nothing installed", async () => {
  test.setTimeout(720_000);
  const { app, page } = await launch();
  try {
    const identity = await app.evaluate(({ app: a }) => [
      a.isPackaged,
      a.getVersion(),
      a.getName(),
    ]);
    expect(identity).toEqual([true, VERSION, "Lucid"]);

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
    // On a machine that has never made a PDF this downloads Tectonic's typesetting files, which takes minutes.
    const text = await downloadPdf(page, path, 600_000);
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
      const second = spawn(BINARY, EXTRA_ARGS, { env: bare(home), stdio: "ignore" });
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
