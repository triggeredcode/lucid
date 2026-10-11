/** The op language as the model is told about it; also what agents reading the MCP tools get. */
export const OPS_REFERENCE = `Ops (use only these; every field is required, use null where a field does not apply):
  insert {at, lmd}                  add notes written in LMD. at: {"after":"b3"} | {"before":"b3"} | {"start_of_section":"b2"} | {"end_of_section":"b2"} | {"end":true}
  replace {target, lmd}             rewrite one block or one list with new LMD (the first new block keeps the old block's place)
  delete {target}                   only when the user says delete, remove, get rid of, drop or erase
  move {target, to}                 to is a position like at above
  archive {target}                  move to the Archive section (keeps it, out of the way)
  set_type {target, type}           h1 h2 h3 paragraph bullet numbered checklist quote callout_note callout_key callout_decision callout_tradeoff callout_warning callout_question
  mark {target, match, mark, on}    bold italic underline strike highlight code on a phrase (match) or on the whole block (match null)
  set_status {target, in, status}   normal | struck | chosen, on a block or list item (target "b9.2", in null), or on a row, column, node or edge (target "r2" / "c1" / "redis" / "e4", in the table or diagram "b6")
  convert {targets, to, lmd}        replace blocks by new LMD: to is table diagram bullets checklist chart paragraph
  graph.patch {target, lines}       add or change nodes and edges with LGN lines ("cdn [cdn]: CDN", "web -> cdn: request", "redis {struck}")
  graph.insert_between {target, from, to, node, labels}   put a node between two connected nodes; node is one LGN node line; labels null or [label before, label after]
  graph.rename {target, node, label}   graph.reverse {target, edge}   graph.remove {target, nodes, edges}
  graph.group {target, group}       group is an LGN line: "group app: Application { web, redis }"      graph.ungroup {target, group}
  graph.set {target, direction, title, type}   direction LR|TB, each field null to leave it
  table.add_row {target, after, cells}         after is a row id, "start" or "end"; cells has one text per column
  table.set_cells {target, row, cells}         cells is a list of {col, text} using column ids
  table.remove_row {target, row}   table.move_row {target, row, after}
  table.add_column {target, name, after, cells}  cells has one text per existing row (or "" )
  table.rename_column {target, col, name}   table.remove_column {target, col}   table.move_column {target, col, after}   table.set_caption {target, caption}`;
