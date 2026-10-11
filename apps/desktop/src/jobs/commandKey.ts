/** What a keyboard event says, as far as the Command key is concerned (a real KeyboardEvent has all of it). */
export interface KeyInfo {
  code: string;
  ctrlKey: boolean;
  getModifierState(key: string): boolean;
}

/**
 * Holding the right Option / Alt key is Command mode for one command. On many keyboards (German, French, Polish…) the right Alt
 * key is AltGr, which is how `@`, `{` or `€` are typed: Windows reports it as Ctrl and Alt together, and other systems as
 * AltGraph. Those presses are typing, not the Command key.
 */
export function isCommandKey(e: KeyInfo): boolean {
  return e.code === "AltRight" && !e.ctrlKey && !e.getModifierState("AltGraph");
}
