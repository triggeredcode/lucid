#!/usr/bin/env node
// Downloads the official Tectonic release for a system into apps/desktop/resources/bin/, where the app finds it in
// development and electron-builder copies it into the packaged app. Every download is checked against a pinned SHA-256
// (the digests GitHub lists for the release files), so a changed or damaged file is refused.
//   node scripts/fetch-tectonic.mjs [--platform darwin|linux|win32] [--arch arm64|x64] [--force]
// Without options it fetches the one for the system it runs on.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.17.0";
const BASE = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${VERSION}`;
/** Platform and architecture (Node's names) → the release file, its digest and the program inside it. */
const TARGETS = {
  "darwin-arm64": {
    file: `tectonic-${VERSION}-aarch64-apple-darwin.tar.gz`,
    sha256: "a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667",
    program: "tectonic",
  },
  "darwin-x64": {
    file: `tectonic-${VERSION}-x86_64-apple-darwin.tar.gz`,
    sha256: "7c90ef5b6ddb1eb1937e4337add5237b79338e4b9676459fa91187d24d6cdf80",
    program: "tectonic",
  },
  // The musl builds are static: they need nothing installed on the system.
  "linux-x64": {
    file: `tectonic-${VERSION}-x86_64-unknown-linux-musl.tar.gz`,
    sha256: "8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7",
    program: "tectonic",
  },
  "linux-arm64": {
    file: `tectonic-${VERSION}-aarch64-unknown-linux-musl.tar.gz`,
    sha256: "b10954a95404f3ab2328d2fa59a5ebab8e657f893fab096f98be8db7c0c979b8",
    program: "tectonic",
  },
  "win32-x64": {
    file: `tectonic-${VERSION}-x86_64-pc-windows-msvc.zip`,
    sha256: "f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f",
    program: "tectonic.exe",
  },
};

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const platform = arg("platform") ?? process.platform;
const arch = arg("arch") ?? process.arch;
const target = TARGETS[`${platform}-${arch}`];
if (!target) {
  console.log(`There is no Tectonic build for ${platform} ${arch} here: nothing to fetch.`);
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps", "desktop", "resources", "bin", target.program);
const stamp = `${out}.version`;
const wanted = `${VERSION} ${target.sha256}`;

if (
  !process.argv.includes("--force") &&
  existsSync(out) &&
  existsSync(stamp) &&
  readFileSync(stamp, "utf8").trim() === wanted
) {
  console.log(`Tectonic ${VERSION} is already in ${out}`);
  process.exit(0);
}

const url = `${BASE}/${target.file}`;
console.log(`Downloading Tectonic ${VERSION} for ${platform} ${arch} ...`);
const response = await fetch(url, { redirect: "follow" });
if (!response.ok) throw new Error(`Could not download ${url}: ${String(response.status)}`);
const bytes = Buffer.from(await response.arrayBuffer());
const sum = createHash("sha256").update(bytes).digest("hex");
if (sum !== target.sha256)
  throw new Error(
    `The download is not the expected file (SHA-256 ${sum}, wanted ${target.sha256}).`,
  );

const work = join(tmpdir(), `lucid-tectonic-${String(process.pid)}`);
mkdirSync(work, { recursive: true });
try {
  const archive = join(work, target.file);
  writeFileSync(archive, bytes);
  // `tar` reads .tar.gz everywhere, and .zip on macOS and Windows (bsdtar); on Linux a .zip would need `unzip`.
  if (target.file.endsWith(".zip") && process.platform === "linux")
    execFileSync("unzip", ["-o", archive, target.program, "-d", work]);
  else execFileSync("tar", ["-xf", archive, "-C", work, target.program]);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, readFileSync(join(work, target.program)));
  if (platform !== "win32") chmodSync(out, 0o755);
  writeFileSync(stamp, `${wanted}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`Tectonic ${VERSION} is in ${out}`);
