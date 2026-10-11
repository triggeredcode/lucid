import {
  BLOCK_TYPES,
  findDuplicateIds,
  type Block,
  type BlockType,
  type LucidDoc,
} from "@lucid/core";
import type { BlockSpec } from "./spec";

export interface ValidationIssue {
  blockId: string;
  message: string;
}

export class BlockValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(issues.map((i) => `block ${i.blockId}: ${i.message}`).join("; "));
    this.name = "BlockValidationError";
    this.issues = issues;
  }
}

export interface Registry {
  readonly specs: ReadonlyMap<BlockType, BlockSpec>;
  get(type: BlockType): BlockSpec;
  /** Normalised copy of the block (props defaults filled, children validated) or a BlockValidationError. */
  validateBlock(block: Block): Block;
  validateDoc(doc: LucidDoc): LucidDoc;
  /** Types in `BLOCK_TYPES` that have no spec registered. */
  missing(): BlockType[];
}

export function createRegistry(specs: readonly BlockSpec[]): Registry {
  const map = new Map<BlockType, BlockSpec>();
  for (const spec of specs) {
    if (map.has(spec.type)) throw new Error(`block type "${spec.type}" is registered twice`);
    map.set(spec.type, spec);
  }

  const get = (type: BlockType): BlockSpec => {
    const spec = map.get(type);
    if (!spec) throw new Error(`no block spec registered for "${type}"`);
    return spec;
  };

  function collect(block: Block, issues: ValidationIssue[]): Block {
    const spec = map.get(block.type);
    if (!spec) {
      issues.push({ blockId: block.id, message: `no block spec registered for "${block.type}"` });
      return block;
    }
    const parsed = spec.propsSchema.safeParse(block.props);
    let props = block.props;
    if (parsed.success) {
      props = parsed.data;
      for (const problem of spec.check?.(props) ?? [])
        issues.push({ blockId: block.id, message: problem });
    } else {
      for (const issue of parsed.error.issues) {
        issues.push({
          blockId: block.id,
          message: `props.${issue.path.join(".") || "(root)"}: ${issue.message}`,
        });
      }
    }
    if (spec.kind !== "text" && block.content !== undefined) {
      issues.push({
        blockId: block.id,
        message: `${block.type} blocks cannot have inline content`,
      });
    }
    if (spec.kind === "atom" && block.children !== undefined && block.children.length > 0) {
      issues.push({ blockId: block.id, message: `${block.type} blocks cannot have children` });
    }
    const children = block.children?.map((child) => collect(child, issues));
    return {
      ...block,
      props,
      ...(children === undefined ? {} : { children }),
    };
  }

  return {
    specs: map,
    get,
    validateBlock(block) {
      const issues: ValidationIssue[] = [];
      const result = collect(block, issues);
      if (issues.length > 0) throw new BlockValidationError(issues);
      return result;
    },
    validateDoc(doc) {
      const issues: ValidationIssue[] = [];
      const blocks = doc.blocks.map((b) => collect(b, issues));
      for (const id of findDuplicateIds(doc))
        issues.push({ blockId: id, message: "duplicate block id" });
      if (issues.length > 0) throw new BlockValidationError(issues);
      return { blocks };
    },
    missing: () => BLOCK_TYPES.filter((t) => !map.has(t)),
  };
}
