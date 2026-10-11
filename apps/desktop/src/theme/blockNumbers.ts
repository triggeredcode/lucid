import { useSyncExternalStore } from "react";

/** Whether the margin of the page shows the block numbers. A per-person convenience, kept in the browser's storage; on by default. */
const KEY = "lucid.blockNumbers";

export const parseBlockNumbers = (value: string | null): boolean => value !== "off";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let shown = true;
const listeners = new Set<() => void>();

/** Reads the saved choice. Call once, before drawing. */
export function initBlockNumbers(): void {
  shown = parseBlockNumbers(read());
}

export function setBlockNumbers(next: boolean): void {
  shown = next;
  try {
    localStorage.setItem(KEY, next ? "on" : "off");
  } catch {
    // Remembering is a convenience only.
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useBlockNumbers = (): boolean => useSyncExternalStore(subscribe, () => shown);
