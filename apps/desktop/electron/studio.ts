import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where LM Studio is installed, if it is: the usual two places (LUCID_LMSTUDIO_APP points tests at another one). */
export function findLmStudio(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
  home: string = homedir(),
): string | undefined {
  const override = env["LUCID_LMSTUDIO_APP"];
  const candidates =
    override === undefined
      ? ["/Applications/LM Studio.app", join(home, "Applications", "LM Studio.app")]
      : [override];
  return candidates.find((p) => exists(p));
}

export const LMSTUDIO_DOWNLOAD = "https://lmstudio.ai";
