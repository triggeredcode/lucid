import { readFileSync, writeFileSync } from "node:fs";

/** Where the window was: so Lucid opens at the size and place it was left. */
export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN = { width: 820, height: 560 };

/** A saved state, if it is well formed; anything else (a missing or damaged file) is nothing. */
export function parseWindowState(text: string): WindowState | undefined {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    const n = (k: string) => (typeof v[k] === "number" && Number.isFinite(v[k]) ? v[k] : undefined);
    const [x, y, width, height] = [n("x"), n("y"), n("width"), n("height")];
    if (x === undefined || y === undefined || width === undefined || height === undefined)
      return undefined;
    return {
      x,
      y,
      width: Math.max(MIN.width, Math.round(width)),
      height: Math.max(MIN.height, Math.round(height)),
      maximized: v["maximized"] === true,
    };
  } catch {
    return undefined;
  }
}

/**
 * The bounds to open with: the saved ones when enough of the window is on a screen that is still there (a screen may have been
 * unplugged since), otherwise the size alone, which lets the system place it.
 */
export function boundsToOpen(
  saved: WindowState | undefined,
  screens: readonly Area[],
  fallback: { width: number; height: number },
): Partial<Area> {
  if (!saved) return fallback;
  const visible = screens.some((a) => {
    const w = Math.min(saved.x + saved.width, a.x + a.width) - Math.max(saved.x, a.x);
    const h = Math.min(saved.y + saved.height, a.y + a.height) - Math.max(saved.y, a.y);
    return w >= 200 && h >= 120;
  });
  return visible
    ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    : { width: saved.width, height: saved.height };
}

export function readWindowState(file: string): WindowState | undefined {
  try {
    return parseWindowState(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

export function writeWindowState(file: string, state: WindowState): void {
  try {
    writeFileSync(file, `${JSON.stringify(state)}\n`, "utf8");
  } catch {
    // Remembering the window is a convenience only.
  }
}
