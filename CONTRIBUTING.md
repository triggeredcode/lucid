# Contributing to Lucid

Thank you for helping. Lucid is a structured-document editor: speech or typing becomes headings, lists, tables and diagrams, by
a local model. Its shape is small on purpose, so please open an issue to talk about a larger change before you build it.

## Set up

You need macOS (Apple Silicon), Windows or Linux (x64), Node 22.12 or newer and pnpm 9.

```bash
pnpm install
node scripts/fetch-tectonic.mjs   # the PDF engine
pnpm dev
```

You do **not** need LM Studio for tests: unit, integration and end-to-end tests use a scripted server
(`packages/mock-lmstudio`). Only `pnpm eval` and `pnpm e2e:real` use a real model.

## Before you open a pull request

```bash
pnpm run ci    # typecheck, lint, formatting, unit tests
pnpm e2e       # the Electron tests, in a maximized window (do not touch the keyboard while it runs; written and run on a Mac)
```

- One concern per pull request, in small commits with [Conventional Commit](https://www.conventionalcommits.org) messages
  (`feat(kit): …`, `fix(desktop): …`). Each commit should pass the checks on its own.
- A fix comes with a test that fails without it. A new behaviour comes with tests at the level where it lives.
- End-to-end tests call `maximizeWindow` (see `apps/desktop/e2e/helpers.ts`): Lucid is made for a full-screen window.
- If your change touches the prompts or the pipelines, run `pnpm eval` with the model and say what changed in the pass
  rates (see [`docs/evals.md`](docs/evals.md)).
- Update the README, the guide (`docs/guide.html`) and the changelog when something a person sees changes.

## Three systems

The unit tests run on macOS, Linux and Windows in CI, and the packaged app is built and tested on all three before a release. So
code must not assume one system: build file paths with `node:path` (or `posix`/`win32` when the system is a parameter), take
the system as an argument where behaviour differs, so that a test can cover all three on any machine (see `electron/tools.ts`
and `electron/studio.ts`), and never turn a file URL into a path with `.pathname` (use `fileURLToPath`). A test that needs a
Unix shell script, a socket file or a Mac-only path says so with `skipIf` and a comment. Keyboard hints are written with ⌘ ⇧ ⌥ and
shown through `keys()` (`apps/desktop/src/platform.ts`), which turns them into Ctrl, Shift and Alt on Windows and Linux.

## Rules the code keeps

- `packages/core` is pure TypeScript: no DOM, no Electron, no network.
- Every AI change is exactly one undo step. Never lose what the person said: if the model's answer cannot be used, keep their
  words as an unprocessed paragraph.
- The model never writes LaTeX or drawing code. It fills typed blocks; the kit's templates do the typography.
- Calls to LM Studio always switch reasoning off (`reasoning_effort: "none"`).
- No cloud services in the core workflow, and no copied code under a licence that does not fit MIT (GPL in particular).

## Adding a note format

A format is data: open [`packages/kit/src/formats/index.ts`](packages/kit/src/formats/index.ts) and add an entry with an `id`, a
short `description`, `keywords` for the suggestion, the `sections` (each with a `hint` saying what belongs there and the block
types that `prefer` it) and the `latex` options. Then update the lists in `packages/kit/src/formats/formats.test.ts`. The format
shows up in **New from a format…** and in the model's prompts.

## Adding a block type

A block is one folder in [`packages/kit/src/blocks/`](packages/kit/src/blocks): its schema, a short description for the model,
its outline, Markdown and LaTeX output, and fixtures. Register it with one line in `blocks/index.ts`. The kit's contract test
(`packages/kit/src/contract.test.ts`) runs for every registered block and fixture, so a new block is tested as soon as it
exists. The editor side lives in `apps/desktop/src/editor`.

## Reporting bugs

Use the issue templates. Please do not paste notes you want to keep private: in Lucid, **Export note…** with *Include what I
said and the change history* switched off shares only the page.

Security problems go through [`SECURITY.md`](SECURITY.md), not a public issue.

## Licence

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
