import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the packaged app is, on this system: the folder electron-builder leaves in release/ (the same files the installers
 * carry), or another copy named by LUCID_APP (for example one taken out of the .dmg, or installed from the Windows installer).
 */
const release = join(__dirname, "../release");

function defaults(): {
  app: string;
  binary: (app: string) => string;
  resources: (app: string) => string;
} {
  switch (process.platform) {
    case "darwin":
      return {
        app: join(release, process.arch === "arm64" ? "mac-arm64" : "mac", "Lucid.app"),
        binary: (a) => join(a, "Contents/MacOS/Lucid"),
        resources: (a) => join(a, "Contents/Resources"),
      };
    case "win32":
      return {
        app: join(release, "win-unpacked"),
        binary: (a) => join(a, "Lucid.exe"),
        resources: (a) => join(a, "resources"),
      };
    default:
      return {
        app: join(release, "linux-unpacked"),
        binary: (a) => join(a, "lucid"),
        resources: (a) => join(a, "resources"),
      };
  }
}

const d = defaults();
const given = process.env["LUCID_APP"];
export const APP = existsSync(given ?? d.app) ? realpathSync(given ?? d.app) : (given ?? d.app);
export const BINARY = d.binary(APP);
export const RESOURCES = d.resources(APP);
export const TECTONIC = join(
  RESOURCES,
  "bin",
  process.platform === "win32" ? "tectonic.exe" : "tectonic",
);

/**
 * What the program is started with. On a Linux build machine without a desktop session Chromium's sandbox cannot start;
 * LUCID_E2E_ARGS (for example "--no-sandbox --disable-gpu") adds the flags a test run there needs. A person's own copy is
 * never started with them.
 */
export const EXTRA_ARGS: string[] = (process.env["LUCID_E2E_ARGS"] ?? "")
  .split(/\s+/)
  .filter(Boolean);

/** A minimal environment, so the test shows the app needs nothing installed: nothing but the system's own folders on the PATH. */
export function bareEnv(home: string): Record<string, string> {
  const system = process.env["SystemRoot"] ?? "C:\\Windows";
  const path = process.platform === "win32" ? `${system}\\System32;${system}` : "/usr/bin:/bin";
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return { ...env, LUCID_HOME: home, PATH: path };
}
