import { existsSync } from "node:fs";
import { posix, win32 } from "node:path";

export interface ToolLookup {
  /** Where the programs that come with Lucid are (`bin/tectonic` inside it). */
  resourcesDir?: string;
  pathEnv?: string | undefined;
  exists?: (path: string) => boolean;
  /** The system to look for a program on (tests pass another one). */
  platform?: NodeJS.Platform;
}

/** The file name of a program on this system. */
export const programName = (name: string, platform: NodeJS.Platform = process.platform): string =>
  platform === "win32" ? `${name}.exe` : name;

/**
 * Which Tectonic to run: the one the person chose (Settings file), else the one that comes with Lucid, else the usual
 * places (Homebrew on a Mac, /usr/local and /usr on Linux), else whatever the PATH has. When none is there the plain name is
 * returned, and starting it says that it was not found (in words, with what to do).
 */
export function resolveTectonic(configured: string, lookup: ToolLookup = {}): string {
  const exists = lookup.exists ?? existsSync;
  if (configured.trim().length > 0) return configured.trim();
  const platform = lookup.platform ?? process.platform;
  const path = platform === "win32" ? win32 : posix;
  const exe = programName("tectonic", platform);
  const usual =
    platform === "darwin"
      ? ["/opt/homebrew/bin/tectonic", "/usr/local/bin/tectonic"]
      : platform === "linux"
        ? ["/usr/local/bin/tectonic", "/usr/bin/tectonic"]
        : [];
  const candidates = [
    ...(lookup.resourcesDir ? [path.join(lookup.resourcesDir, "bin", exe)] : []),
    ...usual,
    ...(lookup.pathEnv ?? process.env["PATH"] ?? "")
      .split(path.delimiter)
      .filter((d) => d.length > 0)
      .map((d) => path.join(d, exe)),
  ];
  return candidates.find((c) => exists(c)) ?? "tectonic";
}
