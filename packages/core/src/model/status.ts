import { z } from "zod";

/**
 * Block, list-item, table row/column and graph node/edge status.
 * `struck` keeps a discarded alternative visible; `chosen` marks the selected option.
 * Graph nodes and edges additionally allow `hidden` (see model/graph.ts).
 */
export const STATUSES = ["normal", "struck", "chosen"] as const;
export const StatusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof StatusSchema>;

export function isStatus(value: unknown): value is Status {
  return StatusSchema.safeParse(value).success;
}
