import { useSyncExternalStore } from "react";

/**
 * How big the page is shown. Only the page (the title, the notes, the diagrams and tables) zooms; the pages list, the input
 * box, the History panel and the top bar keep their size. A per-person convenience, kept in the browser's storage.
 */
export const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const MIN = ZOOM_STEPS[0];
const MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 3;
const KEY = "lucid.pageZoom";

export type ZoomAction = "in" | "out" | "reset";

export const clampZoom = (zoom: number): number =>
  Number.isFinite(zoom) ? Math.min(MAX, Math.max(MIN, Math.round(zoom * 100) / 100)) : 1;

/** A saved zoom, or 100% when there is none or it is not a number. */
export const parseZoom = (value: string | null): number => {
  const n = value === null || value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(n) ? clampZoom(n) : 1;
};

/** The next size up or down from the current one (it may be between two steps, after a pinch). */
export function stepZoom(current: number, direction: "in" | "out"): number {
  const at = clampZoom(current);
  if (direction === "in") return ZOOM_STEPS.find((s) => s > at + 0.001) ?? MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < at - 0.001) ?? MIN;
}

/** A pinch or Ctrl+scroll: a small continuous change (a notch of a mouse wheel is about one step). */
export function wheelZoom(current: number, deltaY: number): number {
  const d = Math.max(-25, Math.min(25, deltaY));
  return clampZoom(current * Math.exp(-d * 0.01));
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let zoom = 1;
const listeners = new Set<() => void>();

function apply(next: number): void {
  zoom = clampZoom(next);
  document.documentElement.style.setProperty("--page-zoom", String(zoom));
  try {
    localStorage.setItem(KEY, String(zoom));
  } catch {
    // Remembering is a convenience only.
  }
  for (const listener of listeners) listener();
}

/** Reads the saved zoom and applies it. Call once, before drawing. */
export function initPageZoom(): void {
  zoom = parseZoom(read());
  document.documentElement.style.setProperty("--page-zoom", String(zoom));
}

export function zoomPage(action: ZoomAction): void {
  apply(action === "reset" ? 1 : stepZoom(zoom, action));
}
export function zoomPageByWheel(deltaY: number): void {
  apply(wheelZoom(zoom, deltaY));
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const usePageZoom = (): number => useSyncExternalStore(subscribe, () => zoom);
