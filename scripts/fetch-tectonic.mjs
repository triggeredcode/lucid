#!/usr/bin/env node
// Downloads the official Tectonic release for macOS (Apple Silicon) into apps/desktop/resources/bin/tectonic, where the app
// finds it in development and electron-builder copies it into the packaged app. The download is checked against a pinned
// SHA-256, so a changed or damaged file is refused.
//   node scripts/fetch-tectonic.mjs [--force]
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.17.0";
const ARCHIVE = `tectonic-${VERSION}-aarch64-apple-darwin.tar.gz`;
const URL = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${VERSION}/${ARCHIVE}`;
const SHA256 = "a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "apps", "desktop", "resources", "bin", "tectonic");
const stamp = `${target}.version`;

if (process.platform !== "darwin" || process.arch !== "arm64") {
  console.log("Lucid is packaged for macOS on Apple Silicon: nothing to fetch on this machine.");
  process.exit(0);
}
if (
  !process.argv.includes("--force") &&
  existsSync(target) &&
  existsSync(stamp) &&
  readFileSync(stamp, "utf8").trim() === VERSION
) {
  console.log(`Tectonic ${VERSION} is already in ${target}`);
  process.exit(0);
}

console.log(`Downloading Tectonic ${VERSION} ...`);
const response = await fetch(URL, { redirect: "follow" });
if (!response.ok) throw new Error(`Could not download ${URL}: ${String(response.status)}`);
const bytes = Buffer.from(await response.arrayBuffer());
const sum = createHash("sha256").update(bytes).digest("hex");
if (sum !== SHA256)
  throw new Error(`The download is not the expected file (SHA-256 ${sum}, wanted ${SHA256}).`);

const work = join(tmpdir(), `lucid-tectonic-${String(process.pid)}`);
mkdirSync(work, { recursive: true });
try {
  writeFileSync(join(work, ARCHIVE), bytes);
  execFileSync("tar", ["-xzf", join(work, ARCHIVE), "-C", work, "tectonic"]);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(join(work, "tectonic")));
  chmodSync(target, 0o755);
  writeFileSync(stamp, `${VERSION}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`Tectonic ${VERSION} is in ${target}`);
