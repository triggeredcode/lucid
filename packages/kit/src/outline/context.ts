import {
  buildDocumentContextIndex,
  buildRefMap,
  type DocumentContextIndex,
  type LucidDoc,
  type RefMap,
} from "@lucid/core";
import { buildOutline } from "./outline";

export type ContextScope = "targeted" | "document";

export interface ContextSelection {
  scope: ContextScope;
  selectedBlockIds: string[];
  fullBlockIds: string[];
  missingRefs: string[];
  ambiguities: { kind: "table" | "chart" | "diagram"; blockIds: string[] }[];
  totalBlockCount: number;
}

export interface DocumentContextBundle {
  text: string;
  refMap: RefMap;
  selection: ContextSelection;
}

export interface DocumentContextRequest {
  doc: LucidDoc;
  /** The live editor's disposable index. Tests and non-editor callers may omit it. */
  index?: DocumentContextIndex | undefined;
  utterance: string;
  title?: string | undefined;
  format?: string | undefined;
  cursorBlockId?: string | undefined;
  recentTouched?: readonly string[] | undefined;
  /** Additional known targets, such as an Input request's focus ids. */
  focusIds?: readonly string[] | undefined;
}

const WHOLE_DOCUMENT =
  /\b(?:whole|entire)\s+(?:document|page|note|notes)\b|\b(?:all|every)\s+(?:section|sections|block|blocks|heading|headings|paragraph|paragraphs|table|tables|diagram|diagrams|chart|charts|item|items)\b|\b(?:summari[sz]e|rewrite|reorganize|review)\s+(?:the\s+)?(?:document|page|whole thing)\b/i;
const COMPONENT_KINDS = ["table", "diagram", "chart"] as const;
const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "before",
  "block",
  "change",
  "could",
  "document",
  "from",
  "have",
  "into",
  "make",
  "page",
  "please",
  "section",
  "should",
  "that",
  "these",
  "this",
  "those",
  "with",
  "would",
]);

const normalized = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const words = (value: string): Set<string> =>
  new Set(
    normalized(value)
      .split(" ")
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
  );

const ordered = (index: DocumentContextIndex, ids: ReadonlySet<string>): string[] =>
  index.blocks.filter((block) => ids.has(block.id)).map((block) => block.id);

const addResolved = (ids: Set<string>, resolved: ReturnType<RefMap["resolve"]>): void => {
  if (!resolved) return;
  if (resolved.kind === "list") for (const id of resolved.ids) ids.add(id);
  else ids.add(resolved.id);
};

function lexicalTargets(index: DocumentContextIndex, utterance: string): string[] {
  const queryWords = words(utterance);
  const quoted = [...utterance.matchAll(/["“]([^"”]+)["”]/g)]
    .map((match) => normalized(match[1] ?? ""))
    .filter(Boolean);
  const summaries = index.blocks.map((block) => ({
    id: block.id,
    words: new Set(normalized(block.summary).split(" ").filter(Boolean)),
    summary: normalized(block.summary),
  }));
  const unique = new Set<string>();
  for (const word of queryWords) {
    const matches = summaries.filter((block) => block.words.has(word));
    if (matches.length === 1 && matches[0]) unique.add(matches[0].id);
  }
  const scored = summaries.map((block) => {
    let score = [...queryWords].filter((word) => block.words.has(word)).length;
    if (quoted.some((phrase) => block.summary.includes(phrase))) score += 3;
    return { id: block.id, score };
  });
  const best = Math.max(0, ...scored.map(({ score }) => score));
  if (best >= 2) {
    for (const { id, score } of scored) if (score === best) unique.add(id);
    return [...unique];
  }
  if (unique.size > 0) return [...unique];
  if (best !== 1) return [];
  const hits = scored.filter(({ score }) => score === 1);
  return hits.length === 1 ? hits.map(({ id }) => id) : [];
}

function overview(index: DocumentContextIndex, refMap: RefMap): string[] {
  const lines = ["OVERVIEW"];
  const sectionBlocks = new Set(index.sections.flatMap((section) => section.blockIds));
  const loose = index.blocks.filter((block) => !sectionBlocks.has(block.id)).length;
  if (loose > 0)
    lines.push(`- ${String(loose)} block${loose === 1 ? "" : "s"} before or outside sections`);
  for (const section of index.sections) {
    const ref = refMap.refOf(section.headingId);
    const indent = "  ".repeat(Math.max(0, section.level - 1));
    lines.push(
      `${indent}- ${ref ? `[${ref}] ` : ""}${section.title || "Untitled section"} (${String(section.blockIds.length)} blocks)`,
    );
  }
  if (index.sections.length === 0 && index.blocks.length === 0) lines.push("- empty document");
  if (index.components.length > 0) {
    lines.push("COMPONENTS");
    for (const component of index.components) {
      const ref = refMap.refOf(component.blockId);
      const summary = component.summary ? ` — ${component.summary.slice(0, 100)}` : "";
      lines.push(`- ${ref ? `[${ref}] ` : ""}${component.kind}${summary}`);
    }
  }
  return lines;
}

/** Deterministically selects prompt context. It performs no model call, search, or persistence. */
export function buildDocumentContext(request: DocumentContextRequest): DocumentContextBundle {
  const { doc, utterance } = request;
  const index = request.index ?? buildDocumentContextIndex(doc, request.recentTouched);
  const refMap = buildRefMap(doc);
  const allIds = new Set(index.blocks.map((block) => block.id));
  const roots = new Set<string>();
  const missingRefs: string[] = [];
  const ambiguities: ContextSelection["ambiguities"] = [];
  const scope: ContextScope = WHOLE_DOCUMENT.test(utterance) ? "document" : "targeted";

  for (const match of utterance.matchAll(/\bb\d+(?:\.\d+)*\b/gi)) {
    const ref = match[0].toLowerCase();
    const resolved = refMap.resolve(ref);
    if (resolved) addResolved(roots, resolved);
    else if (!missingRefs.includes(ref)) missingRefs.push(ref);
  }
  for (const match of utterance.matchAll(/\bblocks?\s+(\d+)\b/gi)) {
    const ref = `b${match[1] ?? ""}`;
    const resolved = refMap.resolve(ref);
    if (resolved) addResolved(roots, resolved);
    else if (!missingRefs.includes(ref)) missingRefs.push(ref);
  }
  const normalizedUtterance = normalized(utterance);
  for (const section of index.sections) {
    const title = normalized(section.title);
    if (title.length >= 3 && normalizedUtterance.includes(title)) roots.add(section.headingId);
  }
  for (const id of request.focusIds ?? []) if (allIds.has(id)) roots.add(id);
  for (const id of lexicalTargets(index, utterance)) roots.add(id);

  const recent = [...(request.recentTouched ?? []), ...index.recentTouched].filter(
    (id, position, list) => allIds.has(id) && list.indexOf(id) === position,
  );

  const utteranceIds = new Set(utterance.toLowerCase().match(/[a-z][a-z0-9_]*/g) ?? []);
  for (const component of index.components) {
    if (
      component.partIds.some((partId) => {
        const part = partId.split(":").at(-1);
        return part !== undefined && utteranceIds.has(part.toLowerCase());
      })
    )
      roots.add(component.blockId);
  }

  for (const kind of COMPONENT_KINDS) {
    if (!new RegExp(`\\b${kind}s?\\b`, "i").test(utterance)) continue;
    const candidates = index.components.filter((component) => component.kind === kind);
    const focused = candidates.find(
      (component) =>
        component.blockId === request.cursorBlockId ||
        roots.has(component.blockId) ||
        recent.includes(component.blockId),
    );
    if (scope === "document") for (const candidate of candidates) roots.add(candidate.blockId);
    else if (focused) roots.add(focused.blockId);
    else if (candidates.length === 1) roots.add(candidates[0]?.blockId ?? "");
    else if (candidates.length > 1)
      ambiguities.push({ kind, blockIds: candidates.map((component) => component.blockId) });
  }

  const unresolved = missingRefs.length > 0 || ambiguities.length > 0;
  if (roots.size === 0 && !unresolved && request.cursorBlockId && allIds.has(request.cursorBlockId))
    roots.add(request.cursorBlockId);
  if (roots.size === 0 && !unresolved && recent[0]) roots.add(recent[0]);
  if (roots.size === 0 && !unresolved && index.blocks.at(-1))
    roots.add(index.blocks.at(-1)?.id ?? "");

  const selected = new Set<string>();
  if (scope === "document") {
    for (const id of allIds) selected.add(id);
  } else {
    for (const root of roots) {
      selected.add(root);
      const entry = index.blocks.find((block) => block.id === root);
      const section = entry?.sectionId
        ? index.sections.find((candidate) => candidate.id === entry.sectionId)
        : undefined;
      if (section) for (const id of section.blockIds) selected.add(id);
      const position = entry?.order;
      if (position !== undefined) {
        for (const nearby of index.blocks.slice(Math.max(0, position - 1), position + 2))
          selected.add(nearby.id);
      }
    }
    for (const id of recent.slice(0, 3)) selected.add(id);
    for (const ambiguity of ambiguities) for (const id of ambiguity.blockIds) selected.add(id);
  }

  const selectedBlockIds = ordered(index, selected);
  const full = new Set<string>(
    scope === "document" ? selectedBlockIds : unresolved ? [] : [...roots],
  );
  for (const component of index.components) {
    if (
      selected.has(component.blockId) &&
      (scope === "document" || (!unresolved && roots.has(component.blockId)))
    )
      full.add(component.blockId);
  }
  const fullBlockIds = ordered(index, full);
  const detail = buildOutline(doc, {
    title: request.title,
    format: request.format,
    include: selectedBlockIds,
    full: fullBlockIds,
    maxChars: 24_000,
  });
  const header = detail.text.split("\n")[0] ?? `DOCUMENT "${request.title ?? "Untitled"}"`;
  const details = detail.text.split("\n").slice(1);
  const lines = [header, ...overview(index, refMap)];
  lines.push(scope === "document" ? "CONTEXT: whole document" : "CONTEXT: targeted");
  lines.push(...details);

  const recentRefs = recent
    .slice(0, 3)
    .map((id) => refMap.refOf(id))
    .filter((ref): ref is string => Boolean(ref));
  if (recentRefs.length > 0)
    lines.push(`RECENT_TOUCHED: ${recentRefs.map((ref) => `[${ref}]`).join(", ")}`);
  for (const ambiguity of ambiguities) {
    const refs = ambiguity.blockIds
      .map((id) => refMap.refOf(id))
      .filter((ref): ref is string => Boolean(ref));
    lines.push(
      `TARGET_STATUS: ambiguous ${ambiguity.kind}: ${refs.map((ref) => `[${ref}]`).join(" or ")}. Ask which one; do not guess.`,
    );
  }
  if (missingRefs.length > 0)
    lines.push(
      `TARGET_STATUS: missing ${missingRefs.join(", ")}. Say the target is not in the document; do not guess.`,
    );

  return {
    text: lines.join("\n"),
    refMap,
    selection: {
      scope,
      selectedBlockIds,
      fullBlockIds,
      missingRefs,
      ambiguities,
      totalBlockCount: index.blocks.length,
    },
  };
}
