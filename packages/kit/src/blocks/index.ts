import type { BlockSpec } from "../spec";
import { calloutBlock } from "./callout";
import { chartBlock } from "./chart";
import { codeBlock } from "./code";
import { diagramBlock } from "./diagram";
import { headingBlock } from "./heading";
import { bulletListItemBlock, checkListItemBlock, numberedListItemBlock } from "./list";
import { mathBlock } from "./math";
import { paragraphBlock } from "./paragraph";
import { tableBlock } from "./table";

/** Every registered block spec. Add one line per block folder. */
export const BLOCK_SPECS: readonly BlockSpec[] = [
  headingBlock,
  paragraphBlock,
  bulletListItemBlock,
  numberedListItemBlock,
  checkListItemBlock,
  calloutBlock,
  mathBlock,
  codeBlock,
  tableBlock,
  diagramBlock,
  chartBlock,
];
