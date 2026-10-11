import {
  GraphSchema,
  GraphOpError,
  TableOpError,
  TableSchema,
  addColumn,
  addRow,
  applyLgn,
  refineNewNodeKinds,
  applyPatch,
  buildRefMap,
  diffDocs,
  insertBetween,
  moveColumn,
  moveRow,
  newId,
  parseStatements,
  patchedIds,
  removeColumn,
  removeEdges,
  removeNodes,
  removeRow,
  renameColumn,
  renameNode,
  reverseEdge,
  setCells,
  setColumnStatus,
  setEdgeStatus,
  setMeta,
  setNodeStatus,
  setRowStatus,
  ungroup,
  type Block,
  type BlockPatch,
  type Graph,
  type IdGenerator,
  type LucidDoc,
  type Op,
  type Pos,
  type RefMap,
  type Resolved,
  type Status,
  type Table,
} from "@lucid/core";
import { parseLmd } from "../lmd/parse";
import { inlineToPlain } from "../text";
import { applyMark } from "./marks";

export type OpErrorCode = "UnknownRef" | "Ambiguous" | "Invalid" | "MatchNotFound";

/** An op that cannot be carried out. The message is written for the model's repair round. */
export class OpError extends Error {
  readonly code: OpErrorCode;
  constructor(code: OpErrorCode, message: string) {
    super(message);
    this.name = "OpError";
    this.code = code;
  }
}

export interface CompileOptions {
  ids?: IdGenerator | undefined;
}

export interface CompileResult {
  /** The document after every op. */
  next: LucidDoc;
  /** The same change as a patch, for the editor. */
  patch: BlockPatch;
  /** Ids of blocks created or changed (blocks removed are not included). */
  affected: string[];
  warnings: string[];
}

interface Place {
  list: Block[];
  index: number;
  parent: Block | null;
}

function find(blocks: Block[], id: string, parent: Block | null = null): Place | undefined {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (!block) continue;
    if (block.id === id) return { list: blocks, index, parent };
    const inner = block.children ? find(block.children, id, block) : undefined;
    if (inner) return inner;
  }
  return undefined;
}

const headingLevel = (b: Block): number =>
  typeof b.props["level"] === "number" ? b.props["level"] : 1;
const strProp = (v: unknown): string => (typeof v === "string" ? v : "");
const textOf = (b: Block): string =>
  b.type === "callout" ? strProp(b.props["title"]) : inlineToPlain(b.content);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const TEXT_TYPES = new Set([
  "heading",
  "paragraph",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
]);

export function compileOps(
  doc: LucidDoc,
  ops: readonly Op[],
  options: CompileOptions = {},
): CompileResult {
  const refMap: RefMap = buildRefMap(doc);
  const ids = options.ids ?? newId;
  const warnings: string[] = [];
  let work: LucidDoc = clone(doc);

  // ---------------------------------------------------------------- lookups
  const resolve = (ref: string): Resolved => {
    const r = refMap.resolve(ref);
    if (!r)
      throw new OpError(
        "UnknownRef",
        `There is no block ${ref}. Use only the references shown in the outline.`,
      );
    return r;
  };
  const idsOf = (ref: string): string[] => {
    const r = resolve(ref);
    const list = r.kind === "list" ? r.ids : [r.id];
    for (const id of list) {
      if (!find(work.blocks, id))
        throw new OpError("UnknownRef", `${ref} was already removed by an earlier step.`);
    }
    return list;
  };
  const one = (ref: string): Block => {
    const list = idsOf(ref);
    if (list.length !== 1) {
      throw new OpError(
        "Invalid",
        `${ref} is a list of ${String(list.length)} items. Point at one item (for example ${ref}.1).`,
      );
    }
    const place = find(work.blocks, list[0] ?? "");
    if (!place) throw new OpError("UnknownRef", `${ref} was already removed by an earlier step.`);
    return place.list[place.index] as Block;
  };
  const blockOfType = (ref: string, type: Block["type"], what: string): Block => {
    const block = one(ref);
    if (block.type !== type)
      throw new OpError("Invalid", `${ref} is a ${block.type}, not ${what}.`);
    return block;
  };

  // ---------------------------------------------------------------- edits (all go through patches on `work`)
  const update = (id: string, change: (b: Block) => Block) => {
    const place = find(work.blocks, id);
    if (!place) throw new OpError("UnknownRef", "A block needed by this step is gone.");
    const next = change(clone(place.list[place.index] as Block));
    work = applyPatch(work, { steps: [{ kind: "update", id, block: next }] });
  };
  const remove = (blockIds: readonly string[]) => {
    work = applyPatch(work, { steps: blockIds.map((id) => ({ kind: "remove" as const, id })) });
  };
  const insertBlocks = (parentId: string | null, afterId: string | null, blocks: Block[]) => {
    if (blocks.length > 0)
      work = applyPatch(work, { steps: [{ kind: "insert", parentId, afterId, blocks }] });
  };

  /** Where a position in the model's words is, as (parent, after) in the working document. */
  const where = (pos: Pos): { parentId: string | null; afterId: string | null } => {
    const top = work.blocks;
    const lastTop = top.at(-1)?.id ?? null;
    if ("end" in pos) return { parentId: null, afterId: lastTop };
    if ("after" in pos || "before" in pos) {
      const ref = "after" in pos ? pos.after : pos.before;
      const r = resolve(ref);
      const targetIds = r.kind === "list" ? r.ids : [r.id];
      const anchorId = "after" in pos ? targetIds.at(-1) : targetIds[0];
      const place = anchorId ? find(work.blocks, anchorId) : undefined;
      if (!place) throw new OpError("UnknownRef", `${ref} was already removed by an earlier step.`);
      const parentId = place.parent?.id ?? null;
      if ("after" in pos) return { parentId, afterId: place.list[place.index]?.id ?? null };
      return { parentId, afterId: place.list[place.index - 1]?.id ?? null };
    }
    const ref = "start_of_section" in pos ? pos.start_of_section : pos.end_of_section;
    const heading = one(ref);
    if (heading.type !== "heading")
      throw new OpError("Invalid", `${ref} is a ${heading.type}, not a heading.`);
    const start = top.findIndex((b) => b.id === heading.id);
    if (start < 0) throw new OpError("Invalid", `${ref} is not a top-level heading.`);
    if ("start_of_section" in pos) return { parentId: null, afterId: heading.id };
    let end = top.length;
    for (let i = start + 1; i < top.length; i++) {
      const b = top[i];
      if (b?.type === "heading" && headingLevel(b) <= headingLevel(heading)) {
        end = i;
        break;
      }
    }
    return { parentId: null, afterId: top[end - 1]?.id ?? null };
  };

  const parseBlocks = (lmd: string, what: string): Block[] => {
    const parsed = parseLmd(lmd, { ids });
    if (!parsed.ok) {
      throw new OpError(
        "Invalid",
        `${what}: ${parsed.errors.map((e) => `line ${String(e.line)}: ${e.message}`).join("; ")}`,
      );
    }
    if (parsed.command) throw new OpError("Invalid", `${what} must be notes, not an instruction.`);
    return parsed.blocks;
  };

  // ---------------------------------------------------------------- graph and table helpers
  const withGraph = (ref: string, change: (g: Graph) => Graph) => {
    const block = blockOfType(ref, "diagram", "a diagram");
    const graph = GraphSchema.parse(block.props["graph"]);
    let next: Graph;
    try {
      next = change(graph);
    } catch (error) {
      if (error instanceof GraphOpError) throw new OpError("Invalid", `${ref}: ${error.message}`);
      throw error;
    }
    update(block.id, (b) => ({ ...b, props: { ...b.props, graph: next } }));
  };
  const withTable = (ref: string, change: (t: Table) => Table) => {
    const block = blockOfType(ref, "table", "a table");
    const table = TableSchema.parse(block.props["table"]);
    let next: Table;
    try {
      next = change(table);
    } catch (error) {
      if (error instanceof TableOpError) throw new OpError("Invalid", `${ref}: ${error.message}`);
      throw error;
    }
    update(block.id, (b) => ({ ...b, props: { ...b.props, table: next } }));
  };
  const lgn = (graph: Graph, source: string): Graph => {
    const result = applyLgn(graph, source);
    if (!result.ok)
      throw new GraphOpError(
        "invalid",
        result.errors.map((e) => `line ${String(e.line)}: ${e.message}`).join("; "),
      );
    // Kafka written as a plain service is still a queue.
    return refineNewNodeKinds(graph, result.graph);
  };

  // ---------------------------------------------------------------- one op
  const run = (op: Op): void => {
    switch (op.op) {
      case "insert": {
        const blocks = parseBlocks(op.lmd, "insert");
        const at = where(op.at);
        insertBlocks(at.parentId, at.afterId, blocks);
        return;
      }
      case "replace": {
        const targets = idsOf(op.target);
        const first = find(work.blocks, targets[0] ?? "");
        if (!first)
          throw new OpError("UnknownRef", `${op.target} was already removed by an earlier step.`);
        const blocks = parseBlocks(op.lmd, "replace");
        const parentId = first.parent?.id ?? null;
        const afterId = first.list[first.index - 1]?.id ?? null;
        remove(targets);
        const [head] = blocks;
        if (head) head.id = targets[0] ?? head.id;
        insertBlocks(parentId, afterId, blocks);
        return;
      }
      case "delete":
        remove(idsOf(op.target));
        return;
      case "move": {
        const targets = idsOf(op.target);
        const blocks = targets.map((id) => {
          const place = find(work.blocks, id);
          return clone(place?.list[place.index] as Block);
        });
        const anchor =
          "after" in op.to ? op.to.after : "before" in op.to ? op.to.before : undefined;
        if (anchor !== undefined) {
          const anchorIds = idsOf(anchor);
          if (anchorIds.some((id) => targets.includes(id)))
            throw new OpError("Invalid", `Cannot move ${op.target} next to itself.`);
        }
        remove(targets);
        const at = where(op.to);
        insertBlocks(at.parentId, at.afterId, blocks);
        return;
      }
      case "archive": {
        const targets = idsOf(op.target);
        const blocks = targets.map((id) => {
          const place = find(work.blocks, id);
          return clone(place?.list[place.index] as Block);
        });
        remove(targets);
        let archive = work.blocks.find(
          (b) =>
            b.type === "heading" &&
            headingLevel(b) === 2 &&
            textOf(b).trim().toLowerCase() === "archive",
        );
        if (!archive) {
          archive = {
            id: ids(),
            type: "heading",
            props: { level: 2 },
            content: [{ type: "text", text: "Archive", styles: {} }],
          };
          insertBlocks(null, work.blocks.at(-1)?.id ?? null, [archive]);
        }
        const start = work.blocks.findIndex((b) => b.id === archive.id);
        let end = work.blocks.length;
        for (let i = start + 1; i < work.blocks.length; i++) {
          const b = work.blocks[i];
          if (b?.type === "heading" && headingLevel(b) <= 2) {
            end = i;
            break;
          }
        }
        insertBlocks(null, work.blocks[end - 1]?.id ?? archive.id, blocks);
        return;
      }
      case "set_type": {
        for (const id of idsOf(op.target)) {
          update(id, (b) => retype(b, op.type));
        }
        return;
      }
      case "mark": {
        const targets = idsOf(op.target);
        let done = false;
        for (const id of targets) {
          const place = find(work.blocks, id);
          const block = place?.list[place.index];
          if (!block) continue;
          if (!TEXT_TYPES.has(block.type)) {
            if (targets.length === 1)
              throw new OpError(
                "Invalid",
                `${op.target} is a ${block.type}; marks only apply to text.`,
              );
            continue;
          }
          const content = applyMark(block.content ?? [], op.match, op.mark, op.on);
          if (content) {
            update(id, (b) => ({ ...b, content }));
            done = true;
            if (op.match !== null) break;
          }
        }
        if (!done)
          throw new OpError("MatchNotFound", `"${op.match ?? ""}" was not found in ${op.target}.`);
        return;
      }
      case "set_status":
        setStatus(op.target, op.in, op.status);
        return;
      case "convert": {
        const targets = op.targets.flatMap((t) => idsOf(t));
        const first = find(work.blocks, targets[0] ?? "");
        if (!first) throw new OpError("UnknownRef", "A block to convert is gone.");
        const blocks = parseBlocks(op.lmd, "convert");
        const want: Record<string, string> = {
          table: "table",
          diagram: "diagram",
          bullets: "bulletListItem",
          checklist: "checkListItem",
          chart: "chart",
          paragraph: "paragraph",
        };
        const need = want[op.to];
        if (need && !blocks.some((b) => b.type === need)) {
          throw new OpError(
            "Invalid",
            `Converting to ${op.to} must produce ${need} blocks; your lmd produced ${blocks.map((b) => b.type).join(", ") || "nothing"}.`,
          );
        }
        const parentId = first.parent?.id ?? null;
        const afterId = first.list[first.index - 1]?.id ?? null;
        remove(targets);
        const [head] = blocks;
        if (head) head.id = targets[0] ?? head.id;
        insertBlocks(parentId, afterId, blocks);
        return;
      }
      // ---- diagram
      case "graph.patch":
        withGraph(op.target, (g) => lgn(g, op.lines.join("\n")));
        return;
      case "graph.remove":
        withGraph(op.target, (g) => removeNodes(removeEdges(g, op.edges), op.nodes));
        return;
      case "graph.rename":
        withGraph(op.target, (g) => renameNode(g, op.node, op.label));
        return;
      case "graph.reverse":
        withGraph(op.target, (g) => reverseEdge(g, op.edge));
        return;
      case "graph.insert_between":
        withGraph(op.target, (g) => {
          const parsed = parseStatements(op.node);
          const decl = parsed.statements.find((s) => s.type === "node");
          if (parsed.errors.length > 0 || decl?.type !== "node") {
            throw new GraphOpError(
              "invalid",
              `node "${op.node}" is not a node declaration like: cdn [cdn]: CDN`,
            );
          }
          return refineNewNodeKinds(
            g,
            insertBetween(
              g,
              op.from,
              op.to,
              {
                id: decl.id,
                label: decl.label ?? decl.id,
                ...(decl.kind ? { kind: decl.kind } : {}),
              },
              op.labels
                ? [op.labels[0] || undefined, op.labels[1] || undefined]
                : [undefined, undefined],
            ),
          );
        });
        return;
      case "graph.group":
        withGraph(op.target, (g) => lgn(g, op.group));
        return;
      case "graph.ungroup":
        withGraph(op.target, (g) => ungroup(g, op.group));
        return;
      case "graph.set":
        withGraph(op.target, (g) =>
          setMeta(g, {
            ...(op.direction ? { direction: op.direction } : {}),
            ...(op.title !== null ? { title: op.title } : {}),
            ...(op.type ? { type: op.type } : {}),
          }),
        );
        return;
      // ---- table
      case "table.add_row":
        withTable(op.target, (t) => addRow(t, { after: op.after, cells: op.cells }));
        return;
      case "table.set_cells":
        withTable(op.target, (t) => setCells(t, op.row, op.cells));
        return;
      case "table.remove_row":
        withTable(op.target, (t) => removeRow(t, op.row));
        return;
      case "table.move_row":
        withTable(op.target, (t) => moveRow(t, op.row, op.after));
        return;
      case "table.add_column":
        withTable(op.target, (t) =>
          addColumn(t, { name: op.name, after: op.after, cells: op.cells }),
        );
        return;
      case "table.rename_column":
        withTable(op.target, (t) => renameColumn(t, op.col, op.name));
        return;
      case "table.remove_column":
        withTable(op.target, (t) => removeColumn(t, op.col));
        return;
      case "table.move_column":
        withTable(op.target, (t) => moveColumn(t, op.col, op.after));
        return;
      case "table.set_caption": {
        const block = blockOfType(op.target, "table", "a table");
        update(block.id, (b) => ({ ...b, props: { ...b.props, caption: op.caption } }));
        return;
      }
    }
  };

  /** "Cross out X": a block or list item by its reference, or a row, column, node or edge by its own id. */
  const setStatus = (target: string, inRef: string | null, status: Status) => {
    if (refMap.resolve(target) && inRef === null) {
      // A block with no status is a normal one, so "normal" removes the prop instead of writing it.
      for (const id of idsOf(target)) {
        update(id, (b) => {
          const { status: _old, ...rest } = b.props;
          return { ...b, props: status === "normal" ? rest : { ...rest, status } };
        });
      }
      return;
    }
    const holders =
      inRef !== null
        ? [one(inRef)]
        : [...allBlocks(work.blocks)].filter((b) => b.type === "table" || b.type === "diagram");
    const hits: { block: Block; kind: "row" | "column" | "node" | "edge" }[] = [];
    for (const block of holders) {
      if (block.type === "table") {
        const table = TableSchema.safeParse(block.props["table"]);
        if (!table.success) continue;
        if (table.data.rows.some((r) => r.id === target)) hits.push({ block, kind: "row" });
        if (table.data.columns.some((c) => c.id === target)) hits.push({ block, kind: "column" });
      } else if (block.type === "diagram") {
        const graph = GraphSchema.safeParse(block.props["graph"]);
        if (!graph.success) continue;
        if (graph.data.nodes.some((n) => n.id === target)) hits.push({ block, kind: "node" });
        if (graph.data.edges.some((e) => e.id === target)) hits.push({ block, kind: "edge" });
      }
    }
    if (hits.length === 0)
      throw new OpError(
        "UnknownRef",
        `There is no block, row, column, node or edge called ${target}.`,
      );
    if (hits.length > 1) {
      const where = hits.map((h) => refMap.refOf(h.block.id) ?? h.block.id).join(" or ");
      throw new OpError(
        "Ambiguous",
        `${target} exists in more than one place (${where}). Say which one with "in".`,
      );
    }
    const hit = hits[0] as (typeof hits)[number];
    update(hit.block.id, (b) => {
      if (hit.kind === "row")
        return {
          ...b,
          props: {
            ...b.props,
            table: setRowStatus(TableSchema.parse(b.props["table"]), target, status),
          },
        };
      if (hit.kind === "column")
        return {
          ...b,
          props: {
            ...b.props,
            table: setColumnStatus(TableSchema.parse(b.props["table"]), target, status),
          },
        };
      const graph = GraphSchema.parse(b.props["graph"]);
      return {
        ...b,
        props: {
          ...b.props,
          graph:
            hit.kind === "node"
              ? setNodeStatus(graph, target, status)
              : setEdgeStatus(graph, target, status),
        },
      };
    });
  };

  for (const [i, op] of ops.entries()) {
    try {
      run(op);
    } catch (error) {
      if (error instanceof OpError)
        throw new OpError(error.code, `Step ${String(i + 1)} (${op.op}): ${error.message}`);
      throw error;
    }
  }

  const patch = diffDocs(doc, work);
  const touched = new Set(patchedIds(patch));
  for (const step of patch.steps) if (step.kind === "remove") touched.delete(step.id);
  return { next: work, patch, affected: [...touched], warnings };
}

function* allBlocks(blocks: readonly Block[]): Generator<Block> {
  for (const b of blocks) {
    yield b;
    if (b.children) yield* allBlocks(b.children);
  }
}

/** The new form of a text block: same words, different kind. */
function retype(block: Block, type: Extract<Op, { op: "set_type" }>["type"]): Block {
  if (!TEXT_TYPES.has(block.type) && block.type !== "callout") {
    throw new OpError("Invalid", `A ${block.type} cannot be turned into ${type}.`);
  }
  if (block.type === "callout" && (block.children?.length ?? 0) > 0) {
    throw new OpError("Invalid", "This callout has content inside it; change that content first.");
  }
  const text =
    block.type === "callout"
      ? [{ type: "text" as const, text: strProp(block.props["title"]), styles: {} }]
      : (block.content ?? []);
  const status =
    block.props["status"] === "struck" || block.props["status"] === "chosen"
      ? { status: block.props["status"] }
      : {};
  const base = { id: block.id };
  if (type === "h1" || type === "h2" || type === "h3") {
    return {
      ...base,
      type: "heading",
      props: { level: Number(type.slice(1)), ...status },
      content: text,
    };
  }
  if (type === "paragraph")
    return { ...base, type: "paragraph", props: { ...status }, content: text };
  if (type === "bullet")
    return { ...base, type: "bulletListItem", props: { ...status }, content: text };
  if (type === "numbered")
    return { ...base, type: "numberedListItem", props: { ...status }, content: text };
  if (type === "checklist")
    return { ...base, type: "checkListItem", props: { checked: false, ...status }, content: text };
  const kind = type === "quote" ? "note" : type.slice("callout_".length);
  const title = inlineToPlain(text).replace(/[\r\n]+/g, " ");
  return { ...base, type: "callout", props: { kind, title, ...status }, children: [] };
}
