# Trying Lucid with Wispr Flow (a check-list)

Lucid does no speech recognition: Wispr Flow turns your voice into text and pastes it, Lucid's input box takes the paste. The
automated tests paste with ⌘V (what Wispr does); only you can check it with your voice. About ten minutes. (Wispr Flow runs on
macOS and Windows; on Windows read ⌘ as Ctrl and ⌥ as Alt. It has no Linux version: there you type.)

1. **Plain dictation.** Open a page, hold Wispr's key and say a thought ("Load balancer. Multiple application servers behind
   it. Health checks to avoid unhealthy servers."). The text appears in the input box and the notes appear in the page about
   half a second later, without pressing Enter. ✅
2. **A long ramble** (hands-free mode, 30 to 60 s about caching). One set of notes, even if Wispr pasted it in pieces. ✅
3. **Focus somewhere else.** Click **History**, **Markdown** or the page text, then dictate. The words still go to the input
   box. ✅ (Click into a field of Settings and dictate: the words go into that field, not the box.)
4. **Correct before sending.** Dictate a sentence and, within half a second, type a word. The automatic send is cancelled;
   fix the text and press Enter. ✅
5. **A command by voice.** Hold the **right ⌥ key** and dictate "cross out MongoDB" (with a list on the page). It is run as
   a command, one undo step. Say "undo". ✅ Then say "command mode" alone: the mode changes, nothing is written. ✅
6. **Say "Lucid, add a row for cost to this table"** in Input mode: one command, then back to notes. ✅
7. **The diagram builder.** Say "diagram mode", then "client, server, DNS, database", then "connections", then "client to
   server". Each phrase is read as a step. "Done" inserts the diagram. ✅
8. **Clipboard.** After a Wispr paste press ⌘V yourself somewhere else. Wispr normally restores your previous clipboard; note
   what you get, it is not Lucid's doing. ℹ️
9. **Wispr's own command mode** (Fn+Ctrl) is not used by Lucid. If you try it, nothing should be double-processed or crash.

If a step does not behave as written, please open an issue and say which step, and which Wispr "style" you use (it can change the text before pasting).
