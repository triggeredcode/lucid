import {
  ChartSchema,
  GraphSchema,
  TableSchema,
  type Block,
  type Inline,
  type InlineStyles,
  type LucidDoc,
  type Status,
} from "@lucid/core";
import { latexProblems } from "@lucid/kit";

/**
 * LucidDoc <-> editor blocks. LucidDoc is the source of truth (saved, compiled, edited by the model); the editor holds a
 * working copy. The editor's own JSON is described with minimal local types so this module stays pure and testable.
 *
 * What the editor cannot carry is kept from the previous LucidDoc, matched by block id: block status (struck, chosen),
 * props the editor does not know (e.g. a paragraph's `unprocessed` flag). Empty paragraphs (the editor always keeps a
 * trailing one) are not saved.
 */

export interface BnText {
  type: "text";
  text: string;
  styles: Record<string, boolean | string>;
}
export interface BnLink {
  type: "link";
  href: string;
  content: BnText[];
}
export type BnInline = BnText | BnLink;
export interface BnBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: BnInline[] | undefined;
  children: BnBlock[];
}

const STYLE_KEYS = ["bold", "italic", "underline", "strike", "code"] as const;

// ---------------------------------------------------------------- inline

function toBnInline(inlines: readonly Inline[] | undefined): BnInline[] {
  const out: BnInline[] = [];
  for (const run of inlines ?? []) {
    if (run.type === "mathInline") {
      out.push({ type: "text", text: `$${run.latex}$`, styles: {} });
    } else if (run.type === "link") {
      out.push({
        type: "link",
        href: run.href,
        content: run.content.map((c) => textRun(c.text, c.styles)),
      });
    } else {
      out.push(textRun(run.text, run.styles));
    }
  }
  return out;
}

function textRun(text: string, styles: InlineStyles): BnText {
  const bn: Record<string, boolean | string> = {};
  for (const key of STYLE_KEYS) if (styles[key]) bn[key] = true;
  if (styles.highlight) bn["backgroundColor"] = "yellow";
  return { type: "text", text, styles: bn };
}

const sameStyles = (a: InlineStyles, b: InlineStyles): boolean =>
  JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());

function pushText(out: Inline[], text: string, styles: InlineStyles): void {
  if (text.length === 0) return;
  const last = out.at(-1);
  if (last?.type === "text" && sameStyles(last.styles, styles))
    out[out.length - 1] = { ...last, text: last.text + text };
  else out.push({ type: "text", text, styles });
}

function lucidStyles(styles: BnText["styles"]): InlineStyles {
  const out: InlineStyles = {};
  for (const key of STYLE_KEYS) if (styles[key] === true) out[key] = true;
  const bg = styles["backgroundColor"];
  if (typeof bg === "string" && bg !== "default") out.highlight = true;
  return out;
}

/** `$x^2$` typed in the editor becomes inline math, unless the LaTeX would be unsafe. */
const MATH = /\$([^\s$](?:[^$]*[^\s$])?)\$/g;

function fromBnInline(content: readonly BnInline[] | undefined): Inline[] {
  const out: Inline[] = [];
  for (const run of content ?? []) {
    if (run.type === "link") {
      const text: Inline[] = [];
      for (const c of run.content) pushText(text, c.text, lucidStyles(c.styles));
      const runs = text.filter((t) => t.type === "text");
      if (runs.length > 0 && run.href.length > 0)
        out.push({ type: "link", href: run.href, content: runs });
      continue;
    }
    const styles = lucidStyles(run.styles);
    if (styles.code) {
      pushText(out, run.text, styles);
      continue;
    }
    let last = 0;
    for (const m of run.text.matchAll(MATH)) {
      const latex = m[1] ?? "";
      if (latexProblems(latex).length > 0) continue;
      pushText(out, run.text.slice(last, m.index), styles);
      out.push({ type: "mathInline", latex });
      last = m.index + m[0].length;
    }
    pushText(out, run.text.slice(last), styles);
  }
  return out;
}

const plainOf = (content: readonly BnInline[] | undefined): string =>
  (content ?? [])
    .map((c) => (c.type === "text" ? c.text : c.content.map((t) => t.text).join("")))
    .join("");

// ------------------------------------------------------------ Lucid -> editor

const str = (b: Block, key: string): string =>
  typeof b.props[key] === "string" ? b.props[key] : "";
const plainContent = (text: string): BnInline[] =>
  text.length > 0 ? [{ type: "text", text, styles: {} }] : [];
const json = (value: unknown): string => JSON.stringify(value);

/**
 * Crossed-out and chosen blocks are kept IN the editor's document, so they take part in undo and redo like any other
 * edit. Text blocks have no room for a status, so it rides on their text colour (which Lucid never offers for any
 * other purpose: grey is "struck", green is "chosen"); Lucid's own blocks have a `status` prop.
 */
const STRUCK_COLOR = "gray";
const CHOSEN_COLOR = "green";
const statusOf = (b: Block): Status => {
  const s = b.props["status"];
  return s === "struck" || s === "chosen" ? s : "normal";
};
const colorProps = (b: Block): Record<string, unknown> => ({
  textColor: { struck: STRUCK_COLOR, chosen: CHOSEN_COLOR, normal: "default" }[statusOf(b)],
});
const statusProps = (b: Block): Record<string, unknown> => ({ status: statusOf(b) });
const statusFromColor = (props: Record<string, unknown>): Status =>
  props["textColor"] === STRUCK_COLOR
    ? "struck"
    : props["textColor"] === CHOSEN_COLOR
      ? "chosen"
      : "normal";
const statusFromProp = (props: Record<string, unknown>): Status =>
  props["status"] === "struck" || props["status"] === "chosen" ? props["status"] : "normal";
/** `keep` without any status, plus the given one (absent means normal). */
const withStatus = (keep: Record<string, unknown>, status: Status): Record<string, unknown> => {
  const { status: _old, ...rest } = keep;
  return status === "normal" ? rest : { ...rest, status };
};

export function blockToBn(b: Block): BnBlock {
  const children = (b.children ?? []).map(blockToBn);
  const base = { id: b.id, children };
  switch (b.type) {
    case "heading":
      return {
        ...base,
        type: "heading",
        props: {
          level: b.props["level"] === 2 || b.props["level"] === 3 ? b.props["level"] : 1,
          ...colorProps(b),
        },
        content: toBnInline(b.content),
      };
    case "paragraph":
      return { ...base, type: "paragraph", props: colorProps(b), content: toBnInline(b.content) };
    case "bulletListItem":
    case "numberedListItem":
      return { ...base, type: b.type, props: colorProps(b), content: toBnInline(b.content) };
    case "checkListItem":
      return {
        ...base,
        type: "checkListItem",
        props: { checked: b.props["checked"] === true, ...colorProps(b) },
        content: toBnInline(b.content),
      };
    case "code": {
      const code = str(b, "code");
      return {
        ...base,
        type: "codeBlock",
        props: { language: str(b, "language") || "text" },
        content: code.length > 0 ? [{ type: "text", text: code, styles: {} }] : [],
      };
    }
    case "callout":
      return {
        ...base,
        type: "callout",
        props: { kind: str(b, "kind") || "note", ...statusProps(b) },
        content: plainContent(str(b, "title")),
      };
    case "math":
      return {
        ...base,
        type: "math",
        props: statusProps(b),
        content: plainContent(str(b, "latex")),
      };
    case "table":
      return {
        ...base,
        type: "lucidTable",
        props: { tableJson: json(b.props["table"]), caption: str(b, "caption"), ...statusProps(b) },
      };
    case "diagram":
      return {
        ...base,
        type: "diagram",
        props: { graphJson: json(b.props["graph"]), caption: str(b, "caption"), ...statusProps(b) },
      };
    case "chart":
      return {
        ...base,
        type: "chart",
        props: { chartJson: json(b.props["chart"]), caption: str(b, "caption"), ...statusProps(b) },
      };
  }
}

/** Editor blocks for a document. */
export function toBn(doc: LucidDoc): { blocks: BnBlock[] } {
  return { blocks: doc.blocks.map(blockToBn) };
}

// ------------------------------------------------------------ editor -> Lucid

function index(doc: LucidDoc | undefined): Map<string, Block> {
  const map = new Map<string, Block>();
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      map.set(b.id, b);
      if (b.children) walk(b.children);
    }
  };
  walk(doc?.blocks ?? []);
  return map;
}

function parseJson<T>(
  text: unknown,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
): T | undefined {
  if (typeof text !== "string") return undefined;
  try {
    const r = schema.safeParse(JSON.parse(text));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

/** The Lucid type of an editor block type (the two names differ for code and tables). */
const lucidTypeOf = (editorType: string): string =>
  editorType === "codeBlock" ? "code" : editorType === "lucidTable" ? "table" : editorType;

/**
 * Props carried over from the previous version of the same block (status, flags the editor does not know). A block that
 * has become another type (a heading turned into a bullet, and back by undo) keeps none of them: they belong to the old
 * type, and a bullet with a heading's `level` is not what it was before.
 */
function carried(prev: Block | undefined, editorType: string): Record<string, unknown> {
  return prev && prev.type === lucidTypeOf(editorType) ? { ...prev.props } : {};
}

/** `checked` is written when it is true, or when the block already had the prop; an unchecked item stays as it was. */
function checkedProps(keep: Record<string, unknown>, checked: boolean): Record<string, unknown> {
  return checked || "checked" in keep ? { ...keep, checked } : keep;
}

/** Editor blocks back to a LucidDoc. `prev` supplies status and unknown props by block id. */
export function fromBn(blocks: readonly BnBlock[], prev?: LucidDoc): LucidDoc {
  const before = index(prev);
  const convert = (list: readonly BnBlock[]): Block[] => {
    const out: Block[] = [];
    for (const b of list) {
      const old = before.get(b.id);
      const children = convert(b.children);
      const keep = carried(old, b.type);
      const keepText = withStatus(keep, statusFromColor(b.props));
      const keepCustom = withStatus(keep, statusFromProp(b.props));
      switch (b.type) {
        case "paragraph": {
          const content = fromBnInline(b.content);
          if (content.length > 0)
            out.push({ id: b.id, type: "paragraph", props: keepText, content });
          out.push(...children); // the editor allows children under any block; Lucid hoists them
          break;
        }
        case "heading": {
          const level =
            typeof b.props["level"] === "number" ? Math.min(3, Math.max(1, b.props["level"])) : 1;
          out.push(
            {
              id: b.id,
              type: "heading",
              props: { ...keepText, level },
              content: fromBnInline(b.content),
            },
            ...children,
          );
          break;
        }
        case "bulletListItem":
        case "numberedListItem":
          out.push({
            id: b.id,
            type: b.type,
            props: keepText,
            content: fromBnInline(b.content),
            ...(children.length > 0 ? { children } : {}),
          });
          break;
        case "checkListItem":
          out.push({
            id: b.id,
            type: "checkListItem",
            props: checkedProps(keepText, b.props["checked"] === true),
            content: fromBnInline(b.content),
            ...(children.length > 0 ? { children } : {}),
          });
          break;
        case "codeBlock": {
          const language =
            typeof b.props["language"] === "string" && b.props["language"] !== "text"
              ? b.props["language"]
              : "";
          out.push(
            {
              id: b.id,
              type: "code",
              props: {
                ...keep,
                language: language.toLowerCase().replace(/[^a-z0-9+#._-]/g, ""),
                code: plainOf(b.content),
              },
            },
            ...children,
          );
          break;
        }
        case "callout": {
          const kind = typeof b.props["kind"] === "string" ? b.props["kind"] : "note";
          const title = plainOf(b.content).replace(/[\r\n]+/g, " ");
          out.push({
            id: b.id,
            type: "callout",
            props: { ...keepCustom, kind, title },
            ...(children.length > 0 ? { children } : {}),
          });
          break;
        }
        case "math":
          out.push(
            {
              id: b.id,
              type: "math",
              props: {
                ...keepCustom,
                latex: plainOf(b.content),
              },
            },
            ...children,
          );
          break;
        case "lucidTable": {
          const table = parseJson(b.props["tableJson"], TableSchema) ?? old?.props["table"];
          if (table)
            out.push(
              {
                id: b.id,
                type: "table",
                props: {
                  ...keepCustom,
                  table,
                  caption: typeof b.props["caption"] === "string" ? b.props["caption"] : "",
                },
              },
              ...children,
            );
          break;
        }
        case "diagram": {
          const graph = parseJson(b.props["graphJson"], GraphSchema) ?? old?.props["graph"];
          if (graph)
            out.push(
              {
                id: b.id,
                type: "diagram",
                props: {
                  ...keepCustom,
                  graph,
                  caption: typeof b.props["caption"] === "string" ? b.props["caption"] : "",
                },
              },
              ...children,
            );
          break;
        }
        case "chart": {
          const chart = parseJson(b.props["chartJson"], ChartSchema) ?? old?.props["chart"];
          if (chart)
            out.push(
              {
                id: b.id,
                type: "chart",
                props: {
                  ...keepCustom,
                  chart,
                  caption: typeof b.props["caption"] === "string" ? b.props["caption"] : "",
                },
              },
              ...children,
            );
          break;
        }
        default:
          // A block type the editor offers but Lucid has no equivalent for (quote, divider, ...): keep its text.
          if (fromBnInline(b.content).length > 0)
            out.push({
              id: b.id,
              type: "paragraph",
              props: keep,
              content: fromBnInline(b.content),
            });
          out.push(...children);
      }
    }
    return out;
  };
  return { blocks: convert(blocks) };
}
