// Runs after electron-builder has put the app together, on every system.
//  - It refuses an app that lacks a file it must carry (for example Electron was never downloaded, so its licence notices were
//    not there to copy): a broken build must stop here instead of shipping.
//  - On a Mac it signs the app "ad hoc" (no identity): Apple Silicon only runs signed code, and without a developer certificate
//    this is what lets it run once the person has allowed it (see docs/install.md).
const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const system = context.electronPlatformName; // "darwin", "win32" or "linux"
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const resources =
    system === "darwin"
      ? path.join(app, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const required = [
    system === "win32" ? "bin/tectonic.exe" : "bin/tectonic",
    "lucid-mcp.mjs",
    "guide.html",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "LICENSES.chromium.html",
  ];
  for (const file of required) {
    if (!existsSync(path.join(resources, file))) throw new Error(`The app is missing ${file}.`);
  }
  if (system !== "darwin") return;
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
};
