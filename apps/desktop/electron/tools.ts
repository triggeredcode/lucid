import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export interface ToolLookup {
  /** Where the programs that come with Lucid are (`bin/tectonic` inside it). */
  resourcesDir?: string;
  pathEnv?: string | undefined;
  exists?: (path: string) => boolean;
}

/**
 * Which Tectonic to run: the one the person chose (Settings file), else the one that comes with Lucid, else the usual
 * places (Homebrew), else whatever the PATH has. When none is there the plain name is returned, and starting it says that it
 * was not found (in words, with what to do).
 */
export function resolveTectonic(configured: string, lookup: ToolLookup = {}): string {
  const exists = lookup.exists ?? existsSync;
  if (configured.trim().length > 0) return configured.trim();
  const candidates = [
    ...(lookup.resourcesDir ? [join(lookup.resourcesDir, "bin", "tectonic")] : []),
    "/opt/homebrew/bin/tectonic",
    "/usr/local/bin/tectonic",
    ...(lookup.pathEnv ?? process.env["PATH"] ?? "")
      .split(delimiter)
      .filter((d) => d.length > 0)
      .map((d) => join(d, "tectonic")),
  ];
  return candidates.find((c) => exists(c)) ?? "tectonic";
}
