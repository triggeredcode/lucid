// Apple Silicon only runs signed code. Without a developer certificate the app is signed "ad hoc" (no identity), which is enough
// to run it once the person has allowed it (see README: Install). Runs after electron-builder has put the app together.
const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

// What the app must carry. A missing file is a broken build (for example Electron was never downloaded, so its licence notices
// were not there to copy), and it must stop the build instead of shipping.
const REQUIRED_RESOURCES = [
  "bin/tectonic",
  "lucid-mcp.mjs",
  "guide.html",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "LICENSES.chromium.html",
];

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const resources = path.join(app, "Contents", "Resources");
  for (const file of REQUIRED_RESOURCES) {
    if (!existsSync(path.join(resources, file))) throw new Error(`The app is missing ${file}.`);
  }
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
};
