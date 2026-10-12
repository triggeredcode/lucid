**Install:** download the file for your system below.

- **macOS** (Apple Silicon, macOS 13 or newer): `Lucid-…-mac-arm64.dmg`. Open it, drag Lucid to Applications. Lucid is not notarized by Apple, so macOS asks once: on macOS 15 open **System Settings → Privacy & Security** and click **Open Anyway**; on macOS 13 and 14 right-click the app and choose **Open**.
- **Windows** (Windows 10 or newer, 64-bit): `Lucid-…-win-x64.exe`. Run it; it installs for you and starts Lucid. Lucid is not signed, so Windows SmartScreen may say "Windows protected your PC": click **More info**, then **Run anyway**. A portable `.zip` is also there.
- **Linux** (64-bit): `Lucid-…-linux-amd64.deb` for Debian and Ubuntu (`sudo apt install ./Lucid-…-linux-amd64.deb`), or `Lucid-…-linux-x86_64.AppImage` for other distributions (make it executable, then run it).

Then start [LM Studio](https://lmstudio.ai) with the model `qwen/qwen3.8-27b`. Steps for each system, checksums and troubleshooting are in [docs/install.md](https://github.com/triggeredcode/lucid/blob/main/docs/install.md).

Check a download with `shasum -a 256 --ignore-missing -c SHA256SUMS` (macOS, Linux) or `Get-FileHash` (Windows) against the file `SHA256SUMS`.

