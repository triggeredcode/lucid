# Dictating into Lucid, and using it by voice

Lucid does no speech recognition. A dictation app turns your voice into text and pastes it, and Lucid's input box takes the
paste. Any app that pastes (or types) into the focused window works; you do not need to pick one of these.

| App | Where | Cost and source | Speech runs |
| --- | --- | --- | --- |
| [Wispr Flow](https://wisprflow.ai) | macOS, Windows | commercial, closed source | in the cloud |
| [OpenWhispr](https://github.com/OpenWhispr/openwhispr) | macOS, Windows, Linux | free, MIT | on your computer (Whisper or Parakeet models), or your own cloud key |
| [VoiceNative](https://github.com/triggeredcode/voicenative) | macOS | free, made by Lucid's author | on your computer (WhisperKit, Neural Engine) |
| The system's own | macOS Dictation, Windows Voice Typing (Win+H) | built in | depends on the system |

Lucid was first used with Wispr Flow, because that is what its author had at hand, and the automated tests paste the way Wispr
does. It is a good place to start, but it is one option. If you want something free and open source, or that keeps your voice on
your computer, use OpenWhispr or VoiceNative, which paste the same way. Their privacy terms are theirs, not Lucid's: Lucid only
sees the text that arrives.

Two things to know:

- A **paste** is sent about half a second after the last piece arrives, with no Enter (Settings → Dictation makes that 1 s or
  2 s, or never). Text that is typed key by key is not sent on its own: press Enter.
- Lucid's own command key is the **right ⌥ key** (right Alt on Windows and Linux). Choose another key for your dictation app's
  push-to-talk (VoiceNative's is right Shift) so they do not meet.

## Using Lucid by voice, or with one hand

Lucid began because for a while I couldn't type comfortably (see [the README](../README.md#why-i-made-it)), so this is what works by
voice today:

- **Notes without pressing Enter.** A pasted dictation is sent by itself about half a second after the last piece arrives.
  Settings → **Dictation** makes the pause 1 s or 2 s (slower speech), or turns it off so the words wait in the box until you
  press Enter and you can read them first.
- **Commands by voice.** In Command mode, say what to change: *"cross out Memcached, we are choosing the local LRU"*, *"add a
  CDN in front of the web server"*, *"undo"*. Say *"command mode"*, *"input mode"* or *"edit mode"* to change mode.
- **One key for one command.** Hold the **right ⌥ key** (right Alt on Windows and Linux) and everything you dictate while it is
  held is one command. It is a single key, which you can reach with one hand.
- **Diagrams and tables without a mouse.** Say *"diagram mode"*, then the components, then the connections (*"client to
  server"*), then fix them by number (*"rename 3 to Cache"*). *"Done"* inserts it. Tables work the same way.
- **Pointing by number.** Every block has a number in the margin; say *"in block 3, add a row for cost"*.
- **Everything can be taken back.** Every change by the model is one undo step, and the history lists each change, so a
  misheard word never costs more than one *"undo"*.
- **Shortcuts for one hand.** ⌘1 to ⌘5 switch the modes and open the builders, ⌘/ switches between Input and Command, Esc and ⌘L
  go back to the input box, and ⌘+, ⌘− and ⌘0 zoom the page. The full list is in the [guide](guide.html#keys). Choose a
  push-to-talk key for your dictation app that you can press with one hand, and not the right ⌥.

What it does not do yet: it does not listen by itself (it needs a dictation app); speech mistakes (a name, a tool) are kept as
heard, and Settings → **Words to expect** keeps the names you list as you wrote them; the model is usually right, not always, and
Edit mode is for the rest. The buttons and fields have names a screen reader can read and the app is tested through them, but I
have not used it with a screen reader for real work and it has not been audited: if you do, please
[tell me what happens](https://github.com/triggeredcode/lucid/issues/new/choose).

## Try it with your voice (a check-list)

The automated tests paste with ⌘V, which is what these apps do; only you can check it with your voice. About ten minutes.
Read ⌘ as Ctrl and ⌥ as Alt on Windows and Linux; on Linux, use OpenWhispr or type.

1. **Plain dictation.** Open a page, hold your dictation key and say a thought ("Load balancer. Multiple application servers
   behind it. Health checks to avoid unhealthy servers."). The text appears in the input box and the notes appear in the page
   about half a second later, without pressing Enter. ✅
2. **A long ramble** (hands-free mode, 30 to 60 s about caching). One set of notes, even if the app pasted it in pieces. ✅
3. **Focus somewhere else.** Click **History**, **Markdown** or the page text, then dictate. The words still go to the input
   box. ✅ (Click into a field of Settings and dictate: the words go into that field, not the box.)
4. **Correct before sending.** Dictate a sentence and, within half a second, type a word. The automatic send is cancelled;
   fix the text and press Enter. ✅
5. **A command by voice.** Hold the **right ⌥ key** and dictate "cross out MongoDB" (with a list on the page). It is run as
   a command, one undo step. Say "undo". ✅ Then say "command mode" alone: the mode changes, nothing is written. ✅
6. **Say "Lucid, add a row for cost to this table"** in Input mode: one command, then back to notes. ✅
7. **The diagram builder.** Say "diagram mode", then "client, server, DNS, database", then "connections", then "client to
   server". Each phrase is read as a step. "Done" inserts the diagram. ✅
8. **Clipboard.** After a paste press ⌘V yourself somewhere else. Dictation apps often restore your previous clipboard; note
   what you get, it is not Lucid's doing. ℹ️
9. **The app's own command mode** (Wispr Flow's Fn+Ctrl, for example) is not used by Lucid. If you try it, nothing should be
   double-processed or crash.

If a step does not behave as written, please open an issue and say which step, and which app (and "style", if it has one: it
can change the text before pasting) you use.
