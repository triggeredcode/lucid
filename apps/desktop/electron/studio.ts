import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/**
 * Where LM Studio is installed, if it is: the usual places on this system (LUCID_LMSTUDIO_APP points tests at another one).
 * On Linux, LM Studio comes as an AppImage that can be anywhere, so only the usual install folders and the PATH are looked at;
 * when it is not found Lucid offers the download page, which is right if it is not installed and harmless if it is.
 */
export function findLmStudio(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const override = env["LUCID_LMSTUDIO_APP"];
  if (override !== undefined) return exists(override) ? override : undefined;
  const path = platform === "win32" ? win32 : posix;
  const candidates =
    platform === "darwin"
      ? ["/Applications/LM Studio.app", path.join(home, "Applications", "LM Studio.app")]
      : platform === "win32"
        ? [
            path.join(
              env["LOCALAPPDATA"] ?? path.join(home, "AppData", "Local"),
              "Programs",
              "LM Studio",
              "LM Studio.exe",
            ),
            path.join(env["ProgramFiles"] ?? "C:\\Program Files", "LM Studio", "LM Studio.exe"),
          ]
        : [
            "/opt/lm-studio/lm-studio",
            "/opt/LM Studio/lm-studio",
            "/usr/bin/lm-studio",
            path.join(home, ".local", "bin", "lm-studio"),
            ...(env["PATH"] ?? "")
              .split(":")
              .filter((d) => d.length > 0)
              .map((d) => path.join(d, "lm-studio")),
          ];
  return candidates.find((p) => exists(p));
}

/** The `lms` command line tool of LM Studio, where its installer puts it. */
export const defaultLmsPath = (
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string =>
  (platform === "win32" ? win32 : posix).join(
    home,
    ".lmstudio",
    "bin",
    platform === "win32" ? "lms.exe" : "lms",
  );

export const LMSTUDIO_DOWNLOAD = "https://lmstudio.ai";
