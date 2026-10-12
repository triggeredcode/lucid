# Installing Lucid

Lucid runs on **macOS** (Apple Silicon, macOS 13 or newer), **Windows** (Windows 10 or newer, 64-bit) and **Linux** (64-bit).
The [website](https://triggeredcode.github.io/lucid/#download) offers the right download for your computer; all of them are on
the [latest release](https://github.com/triggeredcode/lucid/releases/latest).

| System | Download | Notes |
|---|---|---|
| **macOS** | `Lucid-<version>-mac-arm64.dmg` (or `.zip`) | Apple Silicon, macOS 13 or newer |
| **Windows** | `Lucid-<version>-win-x64.exe` installer (or the portable `.zip`) | Windows 10 or newer, 64-bit |
| **Linux** | `Lucid-<version>-linux-amd64.deb`, or `Lucid-<version>-linux-x86_64.AppImage` | 64-bit; the `.deb` is for Debian and Ubuntu |

## 1. Install the app

**macOS.** Open the `.dmg` and drag **Lucid** to **Applications**. macOS will say it cannot check the app for malicious
software, because Lucid is a free open-source app that is not notarized by Apple. Allow it once: on macOS 15 and newer, open
**System Settings → Privacy & Security**, scroll to the message about Lucid and click **Open Anyway**; on macOS 13 and 14,
right-click Lucid in Applications, choose **Open**, then **Open** again. Or in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Lucid.app
```

**Windows.** Run the installer. It installs Lucid for you (no administrator needed) and starts it. Lucid is not signed, so
Windows SmartScreen may say "Windows protected your PC": click **More info**, then **Run anyway**. To remove it: Settings →
Apps → Lucid.

**Linux.** With the `.deb` (Debian, Ubuntu and relatives), then start **Lucid** from the menu, or run `lucid`:

```bash
sudo apt install ./Lucid-<version>-linux-amd64.deb
```

With the AppImage (any distribution):

```bash
chmod +x Lucid-<version>-linux-x86_64.AppImage && ./Lucid-<version>-linux-x86_64.AppImage
```

On Ubuntu 24.04 and newer an AppImage can stop with a sandbox message: use the `.deb`, or start the AppImage with `--no-sandbox`.

## 2. Set up the language model

Install [LM Studio](https://lmstudio.ai) (it runs on all three systems), download the model **`qwen/qwen3.8-27b`**, and start its
local server (Developer tab). Lucid's pill at the top says what is missing and can load the model for you.

Lucid is evaluated with `qwen/qwen3.8-27b` only. Another model can be named in Settings, but expect more misses. A 27B model
needs a lot of memory; Lucid was developed on a Mac with 48 GB.

## Checking a download

Each release lists SHA-256 checksums (`SHA256SUMS`). In the folder with both files, on macOS and Linux:

```bash
shasum -a 256 --ignore-missing -c SHA256SUMS
```

On Windows, in PowerShell, then compare the result with the line for your file:

```powershell
Get-FileHash .\Lucid-<version>-win-x64.exe -Algorithm SHA256
```

## Good to know

- Nothing else needs installing: the PDF engine ([Tectonic](https://tectonic-typesetting.github.io)) and the diagram drawing
  come with the app, on every system.
- **The first PDF needs the internet, once.** Tectonic downloads its typesetting files the first time it runs (several hundred
  small ones, about five minutes). Lucid does it in the background after the first start and shows the progress next to
  *Download PDF*. After that PDFs take a second or two and work offline. A typeface other than the default one (Settings →
  PDF look) is fetched the first time it is used.
- Every build is tested on GitHub's own macOS, Windows and Ubuntu machines before a release (it starts, makes a PDF with a
  diagram, and connects an AI agent). The Mac version has had the most everyday use: please
  [report](https://github.com/triggeredcode/lucid/issues/new/choose) what is off on Windows or Linux.
- On Windows and Linux the shortcuts use **Ctrl** where the docs say ⌘ (⌘1 is Ctrl+1), and **Alt** where they say ⌥.

## Troubleshooting

| You see | Do |
|---|---|
| *LM Studio isn't running* | Start LM Studio and its local server, then click **Check again**. |
| *No model loaded* | Click **Load …** in the pill, or `lms load qwen/qwen3.8-27b --context-length 32768 --parallel 1 -y`. |
| A request takes 10 to 25 seconds | Normal for a 27B model on a laptop; the first request after a change is the slowest. |
| *Getting the PDF engine ready…* | Normal on the first start: wait, it counts the files. A PDF you ask for meanwhile waits for it. |
| Words were kept as *unprocessed* | The model could not use them; they are kept as written. Say them again, or fix them in Edit mode. |
| Dictation does nothing | Is Lucid the focused window? A paste goes to the input box wherever the focus is in the window. See [dictation](dictation.md). |

More in the [guide](guide.html). Something else? [Open an issue](https://github.com/triggeredcode/lucid/issues/new/choose).

## Build it yourself

See [CONTRIBUTING.md](../CONTRIBUTING.md#set-up).
