import { BLOCK_SPECS } from "./blocks";
import { createRegistry } from "./registry";

/** The registry of all built-in blocks. Separate from index.ts so modules inside the kit can use it without cycles. */
export const registry = createRegistry(BLOCK_SPECS);
