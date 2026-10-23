import { useSyncExternalStore } from "react";

/**
 * How the app looks: light or dark (or whatever the system uses), and which type it is set in. It is a per-person
 * convenience, kept in the browser's storage and applied to the page before it is drawn, so there is no flash.
 */
export type ThemeChoice = "light" | "dark" | "system";
export type Typeface = "mono" | "sans" | "serif";
export type Resolved = "light" | "dark";
/**
 * The look of the page itself (the document, its diagrams and tables), apart from the app around it: "auto" is the app's own,
 * so a dark app can show a light page, as paper, and a light app a dark page.
 */
export type PageLookChoice = "auto" | "light" | "dark";

export interface Appearance {
  theme: ThemeChoice;
  font: Typeface;
  pageLook: PageLookChoice;
}

const THEME_KEY = "lucid.theme";
const FONT_KEY = "lucid.font";
const PAGE_LOOK_KEY = "lucid.pageLook";
const THEMES: readonly ThemeChoice[] = ["light", "dark", "system"];
const FONTS: readonly Typeface[] = ["mono", "sans", "serif"];
const PAGE_LOOKS: readonly PageLookChoice[] = ["auto", "light", "dark"];

const pick = <T extends string>(allowed: readonly T[], value: string | null, fallback: T): T =>
  allowed.find((a) => a === value) ?? fallback;
/** A saved theme, or the system's when there is none or it is not one of ours. */
export const parseTheme = (value: string | null): ThemeChoice => pick(THEMES, value, "system");
/** A saved typeface, or mono (the app's own) when there is none or it is not one of ours. */
export const parseFont = (value: string | null): Typeface => pick(FONTS, value, "mono");
/** A saved page look, or the app's own when there is none or it is not one of ours. */
export const parsePageLook = (value: string | null): PageLookChoice =>
  pick(PAGE_LOOKS, value, "auto");

/** The look the page is shown in: its own choice, or the app's when it follows the app. */
export const resolvePageLook = (choice: PageLookChoice, app: Resolved): Resolved =>
  choice === "auto" ? app : choice;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembering is a convenience only.
  }
}

export const resolveTheme = (choice: ThemeChoice, systemIsDark: boolean): Resolved =>
  choice === "system" ? (systemIsDark ? "dark" : "light") : choice;

const media = (): MediaQueryList | undefined =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : undefined;

let state: Appearance = { theme: "system", font: "mono", pageLook: "auto" };
let resolved: Resolved = "light";
const listeners = new Set<() => void>();

function apply(): void {
  resolved = resolveTheme(state.theme, media()?.matches ?? false);
  const root = document.documentElement;
  root.dataset["theme"] = resolved;
  root.dataset["themeChoice"] = state.theme;
  root.dataset["font"] = state.font;
  for (const listener of listeners) listener();
}

/** Reads the saved choice, applies it, and follows the system while the choice is "system". Call once, before drawing. */
export function initAppearance(): void {
  state = {
    theme: parseTheme(read(THEME_KEY)),
    font: parseFont(read(FONT_KEY)),
    pageLook: parsePageLook(read(PAGE_LOOK_KEY)),
  };
  media()?.addEventListener("change", () => {
    if (state.theme === "system") apply();
  });
  apply();
}

export function setTheme(theme: ThemeChoice): void {
  state = { ...state, theme };
  write(THEME_KEY, theme);
  apply();
}

export function setFont(font: Typeface): void {
  state = { ...state, font };
  write(FONT_KEY, font);
  apply();
}

export function setPageLook(pageLook: PageLookChoice): void {
  state = { ...state, pageLook };
  write(PAGE_LOOK_KEY, pageLook);
  apply();
}

/** Light or dark, whichever is on screen now. */
export const useResolvedTheme = (): Resolved =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => resolved,
  );

export const useAppearance = (): Appearance =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );

/** The look of the page now, light or dark: what its diagrams and its editor are drawn in. */
export const useResolvedPageLook = (): Resolved =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => resolvePageLook(state.pageLook, resolved),
  );
