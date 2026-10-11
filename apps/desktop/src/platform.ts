/**
 * The labels of keyboard shortcuts. The texts of the app name keys the Mac way (⌘ ⇧ ⌥); on Windows and Linux the same keys
 * are Ctrl, Shift and Alt, and the text says so. The shortcuts themselves are the same everywhere (Ctrl takes the place of ⌘).
 */
export const IS_MAC: boolean =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

/** The name of a file from its path, whatever the system writes it with: `/Users/a/page.pdf` or `C:\\Users\\a\\page.pdf`. */
export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** `⇧⌘E` as the person's keyboard calls it: `⇧⌘E` on a Mac, `Ctrl+Shift+E` elsewhere. */
export function keys(text: string, mac: boolean = IS_MAC): string {
  if (mac) return text;
  return text.replace(/⇧⌘/g, "Ctrl+Shift+").replace(/⌘/g, "Ctrl+").replace(/⌥/g, "Alt");
}
