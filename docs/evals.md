# Evals: is the model still doing what Lucid needs?

`pnpm eval` runs a list of cases against the model in LM Studio, the way the app does (the same Input and Command pipelines),
and says which ones still work. Prompt changes must not make it worse.

```bash
pnpm eval --label my-change                    # every case, one request at a time (~15 minutes)
pnpm eval --category diagram_edit,table_edit   # some categories
pnpm eval --id diag-add-redis --no-variants    # one case
pnpm eval --compare packages/evals/reports/2026-10-11-baseline packages/evals/reports/2026-10-12-my-change
```

The model must be loaded first (`lms load qwen/qwen3.8-27b --context-length 32768 --parallel 1 -y`, or the model pill in the
app). A run writes `packages/evals/reports/<date>-<label>/results.json` and `report.md` (pass rates per category against the
bars, and every failure with what was said, what was expected and what the model wrote). `--strict` exits 1 below a bar.

Each trial also records its provider, model, lane, time to first token, total time, model and repair call counts, final outcome,
affected blocks, and unrelated blocks changed. Token totals use provider-reported usage when available; otherwise Lucid stores
character-based estimates and marks them `estimated` rather than presenting them as exact. This measurement data contains
counts and identifiers only—never API keys, full prompts, or document text. Failure examples shown by the eval reporter come
only from this repository's synthetic fixtures and scripted utterances.

## The bars

Overall 90%. Each category 80%, and 95% for `non_destructive` and `mode_separation` (a mistake there loses the person's
work or words). A change that lowers a category by more than 5 points needs its reason written in the pull request.

## What a case looks like

`packages/evals/src/cases/input.ts` and `command.ts`. A case names a starting page (`doc`), the block the cursor is in
(`focus`), what was said and other ways of saying it (`variants`: lower case without punctuation, with fillers), and what a good
answer has. Nothing is compared as an exact string:

```ts
{
  id: "diag-add-redis",
  category: "diagram_edit",
  mode: "command",
  doc: "request-flow-no-cache",
  focus: "diagram",
  utterance: "Add Redis in front of the database so the web server checks it first.",
  expect: {
    touchedOnly: ["diagram"],                       // every other block is exactly as before
    graph: {
      hasNodes: ["client", "web server", "PostgreSQL", "Redis"],
      hasEdges: [{ from: "web server", to: "Redis" }],
      nodeCount: { min: 4 },
      noUngroundedNodes: true,                      // nothing the person did not say
    },
  },
}
```

Matchers (`packages/evals/src/matchers.ts`): the outcome (applied, command, edit, proposal, clarify, none), blocks untouched,
diagram nodes and edges (labels match through aliases and word forms: "Postgres" is "PostgreSQL"), table columns, rows and
cells, headings, terms, list items, statuses, counts, invented numbers, formulas and an output-token budget.

## Adding a case

1. Add it to `cases/input.ts` or `cases/command.ts` (a new category: add it to `CATEGORIES` in `types.ts`).
2. `pnpm test:core`-style check: `pnpm exec vitest run --project @lucid/evals` validates the list (unique ids, known pages,
   a `focus` that exists on the starting page).
3. Run just it: `pnpm eval --id <id>`. If it fails, decide whether the model or the case is wrong.
4. A bug found with the real model gets a case here ("every bug gets a regression test").

A new starting page goes in `fixtures.ts` and `FIXTURES` in `types.ts`.
