import type { Block, LucidDoc } from "@lucid/core";
import { registry as defaultRegistry } from "./defaultRegistry";
import type { Registry } from "./registry";
import { inlineToPlain } from "./text";

const LIST_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);

/** Renders sibling blocks: list items follow each other line by line, everything else is a paragraph apart. */
function renderBlocks(blocks: readonly Block[], depth: number, registry: Registry): string {
  const parts: { md: string; list: string | undefined }[] = [];
  let index = 0;
  let previous: string | undefined;
  for (const block of blocks) {
    index = block.type === "numberedListItem" && previous === block.type ? index + 1 : 1;
    previous = block.type;
    const md = registry.get(block.type).toMarkdown(block, {
      depth,
      index,
      renderChildren: (children, d) => renderBlocks(children, d, registry),
    });
    if (md.trim().length > 0)
      parts.push({
        md: md.replace(/\s+$/g, ""),
        list: LIST_TYPES.has(block.type) ? block.type : undefined,
      });
  }
  let out = "";
  parts.forEach((p, i) => {
    const before = parts[i - 1];
    if (i > 0) out += before?.list !== undefined && before.list === p.list ? "\n" : "\n\n";
    out += p.md;
  });
  return out;
}

/**
 * The page as Markdown (GitHub flavoured, plus the Lucid extensions the blocks define: `> [!NOTE]` callouts, a Mermaid
 * fence for each diagram with its JSON in a comment, `~~struck~~` and `**chosen** ✓`). The title becomes the first line;
 * a leading heading that repeats it is dropped.
 */
export function docToMarkdown(
  doc: LucidDoc,
  opts: { title?: string | undefined } = {},
  registry: Registry = defaultRegistry,
): string {
  const title = opts.title?.trim() ?? "";
  const first = doc.blocks[0];
  const repeated =
    title.length > 0 &&
    first?.type === "heading" &&
    first.props["level"] === 1 &&
    inlineToPlain(first.content).trim() === title;
  const body = renderBlocks(repeated ? doc.blocks.slice(1) : doc.blocks, 0, registry);
  const head = title.length > 0 ? `# ${title}` : "";
  return `${[head, body].filter((s) => s.length > 0).join("\n\n")}\n`;
}
