import type { Case } from "../types";

/**
 * Command Mode: an instruction about the page changes only what it names.
 * `touchedOnly` says which blocks may change; everything else must be exactly as it was.
 */
export const COMMAND_CASES: Case[] = [
  // ------------------------------------------------------------------------------------ diagram_edit
  {
    id: "diag-add-redis",
    category: "diagram_edit",
    mode: "command",
    doc: "request-flow-no-cache",
    focus: "diagram",
    why: "Acceptance C: adding a part keeps every part that was already there.",
    utterance: "Add Redis in front of the database so the web server checks it first.",
    variants: ["add redis in front of the database so the web server checks it first"],
    expect: {
      touchedOnly: ["diagram"],
      graph: {
        hasNodes: ["client", "web server", "PostgreSQL", "Redis"],
        hasEdges: [{ from: "web server", to: "Redis" }],
        nodeCount: { min: 4 },
        noUngroundedNodes: true,
      },
    },
  },
  {
    id: "diag-add-cache-miss-path",
    category: "diagram_edit",
    mode: "command",
    doc: "request-flow-no-cache",
    focus: "diagram",
    why: "Acceptance C: a new component and the cache-miss path in one instruction, without losing the old connections.",
    utterance:
      "Add Redis between the web server and PostgreSQL, with a cache-miss path to PostgreSQL and the result stored back in Redis.",
    expect: {
      touchedOnly: ["diagram"],
      graph: {
        hasNodes: ["client", "web server", "PostgreSQL", "Redis"],
        hasEdges: [{ from: "web server", to: "Redis" }],
        edgeCount: { min: 5 },
        noUngroundedNodes: true,
      },
    },
  },
  {
    id: "diag-insert-load-balancer",
    category: "diagram_edit",
    mode: "command",
    doc: "request-flow",
    focus: "diagram",
    utterance: "Add a load balancer in front of the web server.",
    expect: {
      touchedOnly: ["diagram"],
      graph: {
        hasNodes: ["load balancer", "web server", "Redis", "PostgreSQL"],
        hasEdges: [
          { from: "client", to: "load balancer" },
          { from: "load balancer", to: "web server" },
        ],
        nodeCount: { eq: 5 },
        noUngroundedNodes: true,
      },
    },
  },
  {
    id: "diag-rename",
    category: "diagram_edit",
    mode: "command",
    doc: "request-flow",
    focus: "diagram",
    utterance: "Rename the web server to API gateway.",
    expect: {
      touchedOnly: ["diagram"],
      graph: {
        hasNodes: ["API gateway"],
        lacksNodes: ["web server"],
        nodeCount: { eq: 4 },
        edgeCount: { eq: 5 },
      },
    },
  },
  {
    id: "diag-remove-with-verb",
    category: "diagram_edit",
    mode: "command",
    doc: "request-flow",
    focus: "diagram",
    why: "An explicit removal word is obeyed directly, not turned into a question.",
    utterance: "Remove the Redis node.",
    expect: {
      touchedOnly: ["diagram"],
      graph: { lacksNodes: ["Redis"], nodeCount: { eq: 3 } },
    },
  },
  {
    id: "diag-choose",
    category: "diagram_edit",
    mode: "command",
    doc: "request-flow",
    focus: "diagram",
    why: "The diagram is named, so there is nothing to ask (the options list on this page also has a PostgreSQL).",
    utterance: "In the diagram, mark PostgreSQL as the database we chose.",
    expect: {
      touchedOnly: ["diagram"],
      graph: { statuses: [{ label: "PostgreSQL", status: "chosen" }], nodeCount: { eq: 4 } },
    },
  },

  // ------------------------------------------------------------------------------------ table_edit
  {
    id: "table-add-row-this",
    category: "table_edit",
    mode: "command",
    doc: "two-tables",
    focus: { type: "table", nth: 1 },
    why: 'Acceptance F: "this table" is the table the cursor is in, and the other table is left alone.',
    utterance: "Add another row for consistency to this table.",
    variants: ["add another row for consistency to this table"],
    expect: {
      touchedOnly: [{ type: "table", nth: 1 }],
      table: {
        on: { type: "table", nth: 1 },
        rowCount: { eq: 3 },
        rows: [{ header: "Consistency", filled: ["Kafka", "SQS"] }],
      },
    },
  },
  {
    id: "table-add-row-fill",
    category: "table_edit",
    mode: "command",
    doc: "two-tables",
    focus: { type: "table", nth: 0 },
    why: "Acceptance D: a new row with both columns filled in, still one table.",
    utterance: "Add a row for consistency guarantees and fill in the SQL and NoSQL columns.",
    expect: {
      touchedOnly: [{ type: "table", nth: 0 }],
      table: {
        on: { type: "table", nth: 0 },
        rowCount: { eq: 3 },
        rows: [{ header: "Consistency", filled: ["SQL", "NoSQL"] }],
      },
    },
  },
  {
    id: "table-add-row-this-sectioned",
    category: "table_edit",
    mode: "command",
    doc: "two-sectioned-tables",
    focus: { type: "table", nth: 1 },
    why: "Acceptance F as the real run had it: two tables under their own headings, the cursor in the second. The model asked 'which table?' in about 3 of 8 runs although it was told where the cursor is.",
    utterance: "Add another row for consistency to this table.",
    expect: {
      touchedOnly: [{ type: "table", nth: 1 }],
      table: { on: { type: "table", nth: 1 }, rowCount: { eq: 3 } },
    },
  },
  {
    id: "table-rename-column",
    category: "table_edit",
    mode: "command",
    doc: "two-tables",
    focus: { type: "table", nth: 0 },
    utterance: "Rename the NoSQL column to Document stores.",
    expect: {
      touchedOnly: [{ type: "table", nth: 0 }],
      table: {
        on: { type: "table", nth: 0 },
        columns: ["Property", "SQL", "Document stores"],
        rowCount: { eq: 2 },
      },
    },
  },
  {
    id: "table-reorder-rows",
    category: "table_edit",
    mode: "command",
    doc: "two-tables",
    focus: { type: "table", nth: 0 },
    utterance: "Move the scaling row above the schema row.",
    expect: {
      touchedOnly: [{ type: "table", nth: 0 }],
      table: {
        on: { type: "table", nth: 0 },
        rowHeaders: ["Scaling", "Schema"],
        rowCount: { eq: 2 },
      },
    },
  },
  {
    id: "table-strike-row",
    category: "table_edit",
    mode: "command",
    doc: "two-tables",
    focus: { type: "table", nth: 0 },
    utterance: "Cross out the scaling row.",
    expect: {
      touchedOnly: [{ type: "table", nth: 0 }],
      table: {
        on: { type: "table", nth: 0 },
        rowStatuses: [{ header: "Scaling", status: "struck" }],
        rowCount: { eq: 2 },
      },
    },
  },

  // ------------------------------------------------------------------------------------ reference_resolution
  {
    id: "that-is-what-was-just-added",
    category: "reference_resolution",
    mode: "command",
    doc: "dictated-notes",
    focus: { type: "paragraph", nth: 0 },
    touched: [{ type: "bulletListItem", nth: "last" }],
    why: "Acceptance G: right after dictating a sentence, 'that' is the sentence just added, not whatever block the cursor was left in. Found by the real-model acceptance run: the model asked 'which block?'.",
    utterance: "Make that a heading.",
    variants: ["turn that into a heading", "make it a heading"],
    expect: {
      doc: { hasHeading: [{ text: "cache entries" }], listItemCount: { eq: 2 } },
    },
  },
  {
    id: "ref-last-table",
    category: "reference_resolution",
    mode: "command",
    doc: "two-tables",
    utterance: "Add a row for cost to the last table.",
    expect: {
      touchedOnly: [{ type: "table", nth: "last" }],
      table: { on: { type: "table", nth: "last" }, rowCount: { eq: 3 } },
    },
  },
  {
    id: "ref-first-table",
    category: "reference_resolution",
    mode: "command",
    doc: "two-tables",
    utterance: "In the first table change Fixed to Strict.",
    expect: {
      touchedOnly: [{ type: "table", nth: 0 }],
      table: {
        on: { type: "table", nth: 0 },
        rows: [{ header: "Schema", contains: { SQL: "Strict" } }],
        rowCount: { eq: 2 },
      },
    },
  },
  {
    id: "ref-second-option",
    category: "reference_resolution",
    mode: "command",
    doc: "db-options",
    focus: "list",
    utterance: "Cross out the second option.",
    expect: {
      doc: {
        itemStatuses: [
          { text: "MongoDB", status: "struck" },
          { text: "PostgreSQL", status: "normal" },
          { text: "DynamoDB", status: "normal" },
        ],
        listItemCount: { eq: 3 },
      },
    },
  },

  // ------------------------------------------------------------------------------------ block_reference
  // The page margin numbers the blocks (a list is one block, a table one, a diagram one); the request says which reference a
  // number is. request-flow: b1 heading, b2 paragraph, b3 diagram, b4 table, b5 heading, b6 list of three.
  {
    id: "block-table-add-row",
    category: "block_reference",
    mode: "command",
    doc: "request-flow",
    why: "'In block 4' is the table: the person counts the blocks in the margin, not by what they are.",
    utterance: "In block 4, add a row for cost.",
    variants: ["in block four add a row for cost", "block 4, add a row for cost"],
    expect: {
      touchedOnly: [{ type: "table", nth: 0 }],
      table: { on: { type: "table", nth: 0 }, rowCount: { eq: 4 } },
    },
  },
  {
    id: "block-list-item",
    category: "block_reference",
    mode: "command",
    doc: "request-flow",
    why: "A list is one block (b6) and its items are b6.1, b6.2 ...: 'item 2 of block 6' is MongoDB.",
    utterance: "Cross out item 2 of block 6.",
    variants: ["cross out item two of block six", "in block 6 cross out the second item"],
    expect: {
      doc: {
        itemStatuses: [
          { text: "MongoDB", status: "struck" },
          { text: "PostgreSQL", status: "normal" },
          { text: "DynamoDB", status: "normal" },
        ],
        listItemCount: { eq: 3 },
      },
    },
  },
  {
    id: "block-diagram-rename",
    category: "block_reference",
    mode: "command",
    doc: "request-flow",
    why: "'B3' (as the margin writes it) is the diagram, though the person did not say diagram.",
    utterance: "In B3, rename the client to browser.",
    variants: ["in block 3 rename the client to browser"],
    expect: {
      touchedOnly: [{ type: "diagram", nth: 0 }],
      graph: { hasNodes: ["browser", "web server", "Redis", "PostgreSQL"], nodeCount: { eq: 4 } },
    },
  },
  {
    id: "block-ordinal",
    category: "block_reference",
    mode: "command",
    doc: "two-tables",
    why: "'The second block' counts the heading: b1 is the heading, b2 the first table, b3 the second.",
    utterance: "In the second block, add a row for cost.",
    variants: ["in the second block add a row for cost"],
    expect: {
      touchedOnly: [{ type: "table", nth: 0 }],
      table: { on: { type: "table", nth: 0 }, rowCount: { eq: 3 } },
    },
  },
  {
    id: "block-last",
    category: "block_reference",
    mode: "command",
    doc: "two-tables",
    utterance: "In block 3, add a row for cost.",
    expect: {
      touchedOnly: [{ type: "table", nth: "last" }],
      table: { on: { type: "table", nth: "last" }, rowCount: { eq: 3 } },
    },
  },
  {
    id: "block-missing",
    category: "block_reference",
    mode: "command",
    doc: "request-flow",
    why: "There are six blocks: 'block 9' is not there, so the model asks instead of changing something else.",
    utterance: "In block 9, add a row for cost.",
    expect: { outcome: "clarify" },
  },

  // ------------------------------------------------------------------------------------ non_destructive
  {
    id: "keep-alternatives",
    category: "non_destructive",
    mode: "command",
    doc: "db-options",
    focus: "list",
    why: "Acceptance E: discarded ideas stay on the page, crossed out; nothing is deleted.",
    utterance:
      "Cross out PostgreSQL and MongoDB. We're choosing DynamoDB, but I want to remember the alternatives.",
    variants: [
      "cross out postgres and mongodb we are choosing dynamodb but i want to remember the alternatives",
    ],
    expect: {
      touchedOnly: ["list"],
      doc: {
        itemStatuses: [
          { text: "PostgreSQL", status: "struck" },
          { text: "MongoDB", status: "struck" },
          { text: "DynamoDB", status: "chosen" },
        ],
        listItemCount: { eq: 3 },
      },
    },
  },
  {
    id: "keep-rejected-idea",
    category: "non_destructive",
    mode: "command",
    doc: "db-options",
    focus: "list",
    utterance: "We're not going with MongoDB.",
    expect: {
      doc: {
        itemStatuses: [
          { text: "MongoDB", status: "struck" },
          { text: "PostgreSQL", status: "normal" },
          { text: "DynamoDB", status: "normal" },
        ],
        listItemCount: { eq: 3 },
      },
    },
  },

  // ------------------------------------------------------------------------------------ ambiguity_clarify
  {
    id: "ask-which-table",
    category: "ambiguity_clarify",
    mode: "command",
    doc: "two-tables",
    why: "Two tables and no cursor: the question is which one, not a guess.",
    utterance: "Add a row for cost.",
    variants: ["add a row for cost to the table"],
    expect: { outcome: "clarify", clarifyOptionsMin: 2 },
  },
  {
    id: "choose-postgresql-in-options",
    category: "ambiguity_clarify",
    mode: "command",
    doc: "request-flow",
    why: "PostgreSQL is a node in the diagram and an item in the list of options. 'The database we chose' is about the alternatives, so the model marks the list item and does not ask (the same reading as acceptance scenario E). Changed from 'ask which one' on the owner's decision.",
    utterance: "Mark PostgreSQL as the database we chose.",
    expect: {
      doc: { itemStatuses: [{ text: "PostgreSQL", status: "chosen" }] },
    },
  },
  {
    id: "ask-missing-connection",
    category: "ambiguity_clarify",
    mode: "command",
    doc: "request-flow",
    focus: "diagram",
    utterance: "Remove the connection between the database and the client.",
    expect: { outcome: "clarify", clarifyOptionsMin: 2 },
  },

  {
    id: "ask-row-exists",
    category: "ambiguity_clarify",
    mode: "command",
    doc: "sql-nosql-skeleton",
    why: "The table already has a Consistency row: the first time, the model asks whether to fill it in or add a new one (the answer is then given in the next case).",
    utterance: "Add a row for consistency guarantees and fill in the SQL and NoSQL columns.",
    expect: { outcome: "clarify", clarifyOptionsMin: 2 },
  },
  {
    id: "answered-add-row",
    category: "ambiguity_clarify",
    mode: "command",
    doc: "sql-nosql-skeleton",
    why: "The table already has a Consistency row, so asking 'fill it in, or add a new row?' is fair. The person answered (the app adds the answer in brackets): the model must act, not ask again. Found by the acceptance run (D).",
    utterance:
      "Add a row for consistency guarantees and fill in the SQL and NoSQL columns. (I mean: Add a new row for consistency guarantees)",
    expect: {
      touchedOnly: [{ type: "table", nth: 0 }],
      table: {
        on: { type: "table", nth: 0 },
        rowCount: { eq: 6 },
        rows: [{ header: "Consistency guarantees", filled: ["SQL", "NoSQL"] }],
      },
    },
  },
  {
    id: "answered-which-connection",
    category: "ambiguity_clarify",
    mode: "command",
    doc: "request-flow",
    focus: "diagram",
    why: "The answer to 'which connection?' is in brackets: remove that one, do not ask again.",
    utterance:
      "Remove the connection between the database and the client. (I mean: PostgreSQL to Web Server, e4)",
    expect: {
      touchedOnly: [{ type: "diagram" }],
      graph: { on: { type: "diagram" }, edgeCount: { eq: 4 } },
    },
  },

  // ------------------------------------------------------------------------------------ destructive_confirm
  {
    id: "confirm-big-rewrite",
    category: "destructive_confirm",
    mode: "command",
    doc: "request-flow",
    focus: "paragraph",
    why: "Rewriting most of a paragraph without anyone saying delete or rewrite waits for a yes.",
    utterance: "Simplify this paragraph to just say caching is good.",
    expect: { outcome: "proposal" },
  },
  {
    id: "confirm-not-needed-with-verb",
    category: "destructive_confirm",
    mode: "command",
    doc: "db-options",
    focus: "list",
    utterance: "Delete the DynamoDB option.",
    expect: { outcome: "edit", doc: { listItemCount: { eq: 2 }, lacks: ["dynamodb"] } },
  },

  // ------------------------------------------------------------------------------------ conversion
  {
    id: "convert-list-to-diagram",
    category: "conversion",
    mode: "command",
    doc: "lb-points",
    focus: "list",
    utterance: "Turn those points into a diagram.",
    expect: {
      doc: { blockCounts: { diagram: { eq: 1 } } },
      graph: {
        hasNodes: ["load balancer", "database"],
        noUngroundedNodes: true,
      },
    },
  },
  {
    id: "convert-options-to-table",
    category: "conversion",
    mode: "command",
    doc: "db-options",
    focus: "list",
    utterance: "Turn those database options into a table.",
    expect: {
      doc: { blockCounts: { table: { eq: 1 } } },
      table: { cellsContain: ["PostgreSQL", "MongoDB", "DynamoDB"] },
    },
  },

  // ------------------------------------------------------------------------------------ mode_separation
  {
    id: "mode-content-in-command",
    category: "mode_separation",
    mode: "command",
    doc: "lb-points",
    focus: "list",
    why: "Words that are a note, said in Command Mode, are not turned into an edit.",
    utterance: "Then we expire entries after thirty days.",
    expect: { outcome: "none", noneIsContent: true },
  },
];
