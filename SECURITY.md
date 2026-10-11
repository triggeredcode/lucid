# Security

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue: use **Report a vulnerability** on the repository's
[Security tab](https://github.com/triggeredcode/lucid/security/advisories/new). Say what you found, how to reproduce it, and
which version of Lucid and macOS you used. Lucid is maintained by one person: expect a reply as soon as possible, and a fix or a plan after that.

## What Lucid does and does not do

- Lucid has no account, no server and no analytics. Your pages are files in `~/Lucid` (or `LUCID_HOME`).
- The language model is reached at a local address (`127.0.0.1` by default); Settings refuses an address that is not on your
  computer.
- The only network use of Lucid's own code is the one-time download of typesetting files by its PDF engine (Tectonic), and
  the web pages you open from the Help menu.
- AI agents reach the app through a socket in the library folder (`~/Lucid/.lucid/lucid.sock`) that only your user can use.
  An agent can only edit a page it has just read, and every change is one undo step, listed in the history.
- The window loads only the app's own files, under a content security policy.
- Lucid is **not notarized by Apple**. Check the SHA-256 of a download against `SHA256SUMS` in the release.

## Supported versions

Only the latest release gets fixes.
