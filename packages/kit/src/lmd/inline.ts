import type { Inline, InlineStyles, TextInline } from "@lucid/core";

/**
 * Inline LMD: **bold**, *italic*, __underline__, ~~strike~~, ==highlight==, `code`, $math$, [text](url), and
 * backslash escapes (a backslash before any ASCII punctuation makes it literal).
 *
 * Emphasis is resolved with a delimiter stack, like CommonMark: a marker opens when the next character is not
 * whitespace and closes when the previous one is not, a run such as `***` can close italic then bold, and any marker
 * that never finds its partner stays literal text, so a stray `*` can never swallow the rest of a line.
 */

const PUNCT = /[!-/:-@[-`{-~]/;
type StyleKey = keyof InlineStyles;

type Item =
  | { k: "text"; text: string }
  | { k: "atom"; inline: Inline }
  | { k: "code"; text: string }
  | { k: "delim"; style: StyleKey; chars: string; role?: "open" | "close" };

const SYMMETRIC: { token: string; style: StyleKey }[] = [
  { token: "__", style: "underline" },
  { token: "~~", style: "strike" },
  { token: "==", style: "highlight" },
];

const isSpace = (c: string | undefined): boolean => c === undefined || /\s/.test(c);

/** Index of the `$` closing a math span that opens at `from - 1`, or -1. */
function findDollar(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text.charAt(i) === "\\") {
      i++;
      continue;
    }
    if (text.charAt(i) === "$") return i > from ? i : -1;
  }
  return -1;
}

function tokenize(text: string): Item[] {
  const items: Item[] = [];
  const stack: Extract<Item, { k: "delim" }>[] = [];
  const delim = (style: StyleKey, chars: string): Extract<Item, { k: "delim" }> => {
    const d: Extract<Item, { k: "delim" }> = { k: "delim", style, chars };
    items.push(d);
    return d;
  };
  const closeTop = (style: StyleKey): boolean => {
    const top = stack.at(-1);
    if (top?.style !== style) return false;
    stack.pop();
    return true;
  };

  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);

    if (c === "\\" && i + 1 < text.length && PUNCT.test(text.charAt(i + 1))) {
      items.push({ k: "text", text: text.charAt(i + 1) });
      i += 2;
      continue;
    }

    if (c === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        items.push({ k: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (c === "$") {
      const end = findDollar(text, i + 1);
      if (end > 0) {
        items.push({ k: "atom", inline: { type: "mathInline", latex: text.slice(i + 1, end) } });
        i = end + 1;
        continue;
      }
    }

    if (c === "[") {
      const close = text.indexOf("](", i);
      const match = close > i + 1 ? /^\]\(([^)\s]+)\)/.exec(text.slice(close)) : null;
      if (match) {
        const inner = parseInline(text.slice(i + 1, close)).filter(
          (r): r is TextInline => r.type === "text",
        );
        items.push({ k: "atom", inline: { type: "link", href: match[1] ?? "", content: inner } });
        i = close + match[0].length;
        continue;
      }
    }

    if (c === "*") {
      let n = 0;
      while (text.charAt(i + n) === "*") n++;
      const canClose = !isSpace(text[i - 1]);
      const canOpen = !isSpace(text[i + n]);
      let rest = n;
      // Closing: italic and bold sit on the stack in nesting order, so `***` can end both.
      let guard = 0;
      while (canClose && rest > 0 && guard++ < 4) {
        const top = stack.at(-1);
        if (top?.style === "italic") {
          closeTop("italic");
          const d = delim("italic", "*");
          d.role = "close";
          rest -= 1;
        } else if (top?.style === "bold" && rest >= 2) {
          closeTop("bold");
          const d = delim("bold", "**");
          d.role = "close";
          rest -= 2;
        } else break;
      }
      if (canOpen && rest > 0) {
        if (rest >= 2) {
          const b = delim("bold", "**");
          b.role = "open";
          stack.push(b);
          rest -= 2;
        }
        if (rest >= 1) {
          const it = delim("italic", "*");
          it.role = "open";
          stack.push(it);
          rest -= 1;
        }
      }
      if (rest > 0) items.push({ k: "text", text: "*".repeat(rest) });
      i += n;
      continue;
    }

    const sym = SYMMETRIC.find((s) => text.startsWith(s.token, i));
    if (sym) {
      const canClose = !isSpace(text[i - 1]);
      const canOpen = !isSpace(text[i + sym.token.length]);
      if (canClose && stack.at(-1)?.style === sym.style) {
        closeTop(sym.style);
        delim(sym.style, sym.token).role = "close";
      } else if (canOpen) {
        const d = delim(sym.style, sym.token);
        d.role = "open";
        stack.push(d);
      } else items.push({ k: "text", text: sym.token });
      i += sym.token.length;
      continue;
    }

    items.push({ k: "text", text: c });
    i++;
  }
  return items;
}

/** Parse the inline markup of one line or paragraph into runs. */
export function parseInline(text: string): Inline[] {
  const items = tokenize(text);
  // A delimiter that was opened but never closed (or whose close was never reached) is literal text.
  const closed = new Set<Item>();
  const openStack: Extract<Item, { k: "delim" }>[] = [];
  for (const it of items) {
    if (it.k !== "delim") continue;
    if (it.role === "open") openStack.push(it);
    else if (it.role === "close") {
      const open = openStack.pop();
      if (open) {
        closed.add(open);
        closed.add(it);
      }
    }
  }

  const out: Inline[] = [];
  const active = new Set<StyleKey>();
  const push = (t: string, extra: Partial<Record<StyleKey, true>> = {}) => {
    if (t.length === 0) return;
    const styles: InlineStyles = {
      ...Object.fromEntries([...active].map((k) => [k, true])),
      ...extra,
    };
    const last = out.at(-1);
    if (last?.type === "text" && JSON.stringify(last.styles) === JSON.stringify(styles)) {
      out[out.length - 1] = { ...last, text: last.text + t };
    } else out.push({ type: "text", text: t, styles });
  };
  for (const it of items) {
    if (it.k === "text") push(it.text);
    else if (it.k === "code") push(it.text, { code: true });
    else if (it.k === "atom") out.push(it.inline);
    else if (!closed.has(it)) push(it.chars);
    else if (it.role === "open") active.add(it.style);
    else active.delete(it.style);
  }
  return out;
}
