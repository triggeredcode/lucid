# Changelog

All notable changes to Lucid are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Lucid uses [semantic versioning](https://semver.org).

## [Unreleased]

## [0.4.0] - 2026-10-20

Lucid can now use local or cloud AI providers, sends less document context for faster and cheaper requests, and makes Command edits easier to understand and recover.

### Added

- **Choose how Lucid runs AI.** Settings now supports LM Studio, Ollama, OpenAI, Anthropic, OpenRouter, Ollama Cloud and compatible endpoints, with reusable provider profiles, connection tests and model discovery. API keys stay in the desktop app's secure main process rather than the page interface.
- **Clearer Command review and recovery.** Structured edits are validated before they reach the page, risky changes ask for confirmation, and every accepted change remains available through history and undo.
- **Useful evaluation reports.** Command evaluations now record latency, usage, repairs, cancellations, affected blocks and unrelated edits so quality, speed and cost can be compared together.

### Changed

- Input and Command requests select the relevant part of a large page instead of repeatedly sending the whole document, reducing context without changing the edit tools.
- Exact selected-block moves and deletions, and explicitly named empty-section creation, use deterministic paths when they are unambiguous.

### Fixed

- Clarification questions with longer text or several choices remain readable in narrow windows instead of overlapping.
- Ordered references such as “the first table” or “the second diagram” now select the intended component while genuinely ambiguous references still ask for clarification.

## [0.3.0] - 2026-10-12

PDFs and dictation can be set up the way you like them, the Mac window is cleaner, and the documents are shorter and easier to find your way in.

### Added

- **The look of the PDF is yours to set** (Settings, "PDF look"): paper (Auto picks Letter or A4 by where the computer is), text size, typeface (Latin Modern, Palatino, Times or Helvetica), margins, an accent colour for the title and headings, numbered or plain headings, and the date under the title. The defaults are the look PDFs always had. **Edit template…** opens `lucid.sty`, the file that sets the house style, so everything else can be changed too; if it has a mistake the PDF is made with the built-in one and says so.
- **The page has its own light and dark**, apart from the app's (a small button in the top bar that goes through like the app, light and dark, and the same three choices in Settings): a dark app can show a light page, as paper, and a light app a dark one. The diagrams follow the page.
- **Dictation timing** (Settings, "Dictation"): how long a paste waits before it is sent by itself: 0.5 s as before, 1 s, 2 s, or never (the words wait in the box until Enter).

### Changed

- **Three note formats, nothing too specialized.** The inference engineering and benchmark formats are gone: Lucid comes with a concept note, a system design note and a comparison, and **New page** has a small **Blank page** button instead of a big card. A page that an earlier version made in one of the two opens as a plain page, with everything in it; formats of your own are still one entry of data.
- **A clean top of the window on a Mac.** The grey title bar with the name in it is gone: the page's top row takes its place, with the three round buttons at its left. Windows and Linux keep their own window frame.
- **A short README**, with the details in `docs/` (installing, what Lucid does, the note formats, dictation), and, in the README, why I made Lucid: so that notes can be taken by voice, or with one hand. The website says the same.
- Tables in the PDF are set ragged right with a little more room between rows, and the bars of a chart use the same greys as on screen.
- Dictation: the docs say that any app that pastes works, and list the free and open-source ones (OpenWhispr, VoiceNative) next to Wispr Flow.
- The picture of each note format (`docs/format-samples`) is made with the real app, with real diagrams and every section filled.
- The list of bundled licences is made when the app is packaged and comes with the app (Help, Licences of the Software Lucid Uses); it is no longer kept in the repository.

### Fixed

- A diagram almost as tall as the page no longer leaves an empty page in the PDF.

## [0.2.0] - 2026-10-12

Lucid now runs on Windows and Linux as well as the Mac, has clearer panels and a new look for the list of pages, and has a website.

### Added

- **Windows and Linux.** Windows 10 or newer (64-bit): an installer that needs no administrator, and a portable `.zip`. Linux (64-bit): a `.deb` for Debian and Ubuntu and an AppImage for other distributions. The PDF engine comes with each, so nothing else has to be installed. Shortcut hints say Ctrl, Shift and Alt on these systems; the connection for AI agents is a named pipe on Windows. Every build is tested on GitHub's own macOS, Windows and Ubuntu machines before it is released.
- **A website** at https://triggeredcode.github.io/lucid/ with the downloads for each system (it picks out yours), the idea in pictures, the note formats and the first-time steps for each system.

### Changed

- The pages list and the History panel stand clearly apart from the page in both themes, and small text is darker (the contrast is checked against WCAG ratios by a test).
- Pages in the list are small file icons with the name, the kind of note and when it last changed; the open page is bold. History entries are cards.
- The top bar is taller, and stays on one line at the default window size (the buttons show only their pictures when the window is narrow).
- The Mac files are named `Lucid-<version>-mac-arm64.dmg` and `.zip`, like the files for the other systems.

### Fixed

- AltGr (the right Alt key on many European keyboards) no longer starts Command mode when you type `@`, `{` or `€`.

### Known limits

- The apps are not signed: macOS asks once (Open Anyway), and Windows SmartScreen may ask (More info, Run anyway). On Ubuntu 24.04 and newer an AppImage may need `--no-sandbox`; the `.deb` does not.
- No Intel Mac build, and no Windows or Linux build for ARM yet.
- The Mac version has had the most everyday use. Please report what is off on Windows or Linux.
- The first PDF on a computer downloads Tectonic's typesetting files (about five minutes, once). Only `qwen/qwen3.8-27b` has been evaluated.

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

[Unreleased]: https://github.com/triggeredcode/lucid/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/triggeredcode/lucid/releases/tag/v0.4.0
[0.3.0]: https://github.com/triggeredcode/lucid/releases/tag/v0.3.0
[0.2.0]: https://github.com/triggeredcode/lucid/releases/tag/v0.2.0
[0.1.0]: https://github.com/triggeredcode/lucid/releases/tag/v0.1.0
