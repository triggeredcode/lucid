# Changelog

All notable changes to Lucid are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Lucid uses [semantic versioning](https://semver.org).

## [0.1.0] - 2026-10-12

The first public release.

### Added

- **Structured pages from speech or typing.** Notes become typed blocks (headings and sub-headings, bullet, numbered and check
  lists, callouts, tables, diagrams, formulas, charts, code) written by a local model in LM Studio. Ideas you rejected stay
  on the page, crossed out.
- **Three modes in one input box:** Input (notes), Command (instructions about the page) and Edit (typing in the page),
  with ⌘1 to ⌘5 shortcuts and voice commands.
- **Guided diagram and table builders** you can drive by voice, by number, with components drawn as what they are (database,
  queue, cache, CDN, load balancer…).
- **Block numbers** in the margin, so "in block 3, add a row for cost" is understood.
- **History:** every change is one undo step; any earlier change can be reverted on its own; what you said is kept and can be
  sent again.
- **Five note formats:** concept note, system design, comparison, inference engineering and benchmark.
- **Export** as a typeset PDF (Tectonic, fixed house style), as Markdown, or as a `.lucid` file that carries the whole note
  with its history; import of `.lucid` files that never overwrites.
- **MCP server** so Claude Code or a model in LM Studio's chat can read and edit pages with the same safe tools.
- **A self-contained macOS app** (Apple Silicon, macOS 13 or newer): the PDF engine and the diagram conversion are bundled,
  nothing but LM Studio has to be installed. A user guide opens from the Help menu.
- Light and dark themes, three typefaces, page zoom, a remembered window size and position.

### Known limits

- macOS on Apple Silicon only. The app is not notarized, so macOS asks once to allow it (see the README).
- The first PDF on a computer downloads Tectonic's typesetting files (about five minutes, once).
- Only `qwen/qwen3.8-27b` has been evaluated. A request takes 10 to 25 seconds on a laptop.

[0.1.0]: https://github.com/triggeredcode/lucid/releases/tag/v0.1.0
