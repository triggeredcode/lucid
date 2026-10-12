# Lucid as a toolbox for AI agents (MCP)

Lucid runs a Model Context Protocol server, `lucid-mcp`, so an agent (Claude Code, or a model in LM Studio's chat) can read
your notes and change them with the same safe tools the local model uses. **The Lucid app must be running**: it owns the
pages, and whatever an agent does is done in the editor you are looking at.

* One undo step per agent change (say "undo", or ⌘Z in the editor).
* Every change is listed in **History** as made by the agent ("Claude Code", with what it did).
* Struck-through ideas are kept on purpose; ops that delete or mostly rewrite content are refused unless the agent says
  `allow_destructive` (and tells you).
* An agent can only edit a page it has just read: edits carry the page's `revision`, and are refused if the page changed.
* The agent talks to the app over a local connection: a socket in your library folder (`~/Lucid/.lucid/lucid.sock`, readable
  only by you) on macOS and Linux, a named pipe on Windows. Nothing leaves your computer.

## Tools

| Tool | What it does |
|------|--------------|
| `list_documents` | The pages: id, title, last change. |
| `get_outline` | A page as a compact outline with `[bN]` references (list items `[b6.2]`; table rows and columns, diagram nodes and edges use their own ids), and its `revision`. |
| `read_document` | A page in full as Lucid Markdown (LMD). |
| `insert_notes` | Add notes written in LMD at the end, after or before a block, as more items or rows, or in a section. They become typed blocks. |
| `apply_ops` | Targeted edits with the op language (`graph.insert_between`, `table.add_row`, `set_status` struck or chosen, `replace`, `move`...). All ops apply together or none. |
| `list_formats` | The note formats (concept note, system design, comparison): what each is for, its sections with hints, the fields under the title. |
| `create_document` | A new page, blank or of a format. A format page starts as its section headings; add notes under them with `insert_notes` (`position: "section:Setup"`). |
| `export_pdf` | Typesets a page as a PDF in the house style (diagrams, tables, formulas, the page's format) and saves it in `<library>/exports/`; returns the path (and any warning, such as diagrams left out because a tool is missing). The page is not changed. Takes seconds, up to a minute for a big page. |
| `describe_kit` | The block types, the LMD language and the op language. Read it once. |

Agents never write LaTeX or Mermaid: Lucid draws diagrams and PDFs itself.

## Connect Claude Code

The installed app carries the server. It is started with the app's own program, run as plain Node (`ELECTRON_RUN_AS_NODE`),
so nothing else has to be installed. The command depends on where the app is:

**macOS**

```bash
claude mcp add lucid -e ELECTRON_RUN_AS_NODE=1 -- /Applications/Lucid.app/Contents/MacOS/Lucid /Applications/Lucid.app/Contents/Resources/lucid-mcp.mjs
```

**Windows** (PowerShell; the installer puts Lucid in `%LOCALAPPDATA%\Programs\Lucid`)

```powershell
claude mcp add lucid -e ELECTRON_RUN_AS_NODE=1 -- "$env:LOCALAPPDATA\Programs\Lucid\Lucid.exe" "$env:LOCALAPPDATA\Programs\Lucid\resources\lucid-mcp.mjs"
```

**Linux** (installed from the `.deb`, which puts Lucid in `/opt/Lucid`)

```bash
claude mcp add lucid -e ELECTRON_RUN_AS_NODE=1 -- /opt/Lucid/lucid /opt/Lucid/resources/lucid-mcp.mjs
```

An AppImage mounts itself at a different place each time it runs, so it has no fixed path for this: use the `.deb`, or unpack
the AppImage once (`./Lucid-<version>-linux-x86_64.AppImage --appimage-extract`) and use the `lucid` and `resources/lucid-mcp.mjs`
inside the `squashfs-root` folder.

Then ask Claude Code, for example: *"Read my open Lucid page and add a Pitfalls section."*

If your library is not `~/Lucid`, give the server the same `LUCID_HOME` as the app: add `-e LUCID_HOME=/path/to/library`.
If Lucid is installed somewhere else, use its real path in both places.

## Connect LM Studio

In LM Studio open **Program → Install → Edit mcp.json** and add the same program and file as above. On a Mac:

```json
{
  "mcpServers": {
    "lucid": {
      "command": "/Applications/Lucid.app/Contents/MacOS/Lucid",
      "args": ["/Applications/Lucid.app/Contents/Resources/lucid-mcp.mjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

On Windows use `"command": "C:\\Users\\<you>\\AppData\\Local\\Programs\\Lucid\\Lucid.exe"` with the matching
`resources\\lucid-mcp.mjs` in `args` (JSON needs the backslashes doubled); on Linux `/opt/Lucid/lucid` and
`/opt/Lucid/resources/lucid-mcp.mjs`.

A tool-capable model can then use Lucid in the chat. (Lucid's own voice features use LM Studio through its normal API; this
is separate.)

## Running from source

If you build Lucid yourself, bundle the single-file server (needs Node 22) and point the agent at it with `node`:

```bash
pnpm --filter @lucid/mcp bundle
claude mcp add lucid -- node /absolute/path/to/lucid/packages/mcp/dist/lucid-mcp.mjs
```

In LM Studio's `mcp.json` use `"command": "node"` and that file as the argument.

## If something goes wrong

* *"Lucid is not running."* Open the Lucid app (the connection exists only while it runs).
* *"The page changed since you read it."* Call `get_outline` again, then retry.
* *"These ops throw something away."* The agent asked to delete or mostly rewrite content; tell it, or have it pass
  `allow_destructive` if that is what you want.
