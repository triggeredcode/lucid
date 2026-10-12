# Lucid and accessibility

## Why Lucid exists

Lucid started because its author broke their right hand and still wanted to take notes while learning system design. Typing
with one hand is slow, and a dictation app on its own gives you a wall of text, when what you want is the structure: headings,
the options with the rejected ones crossed out, a table, a diagram. So Lucid takes what you say and builds the structured
document while you talk.

It is not a medical or assistive device, and it has not been audited with screen readers or checked against accessibility
standards. What follows is what it does today, so you can judge whether it helps you.

## Using it by voice

Lucid does no speech recognition itself: a dictation app turns your voice into text and pastes it into Lucid's input box (see
[dictation](dictation.md) for free and open-source choices). From there:

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

## Using it with one hand

- The three modes and both builders have shortcuts (⌘1 to ⌘5, ⌘/ to switch between Input and Command), and Esc and ⌘L go back to
  the input box. Zoom for the page is ⌘+, ⌘− and ⌘0. The full list is in the [guide](guide.html#keys).
- Choose a push-to-talk key for your dictation app that you can press with one hand. Lucid's own command key is the right ⌥,
  so pick another for dictation (VoiceNative's default, the right Shift, does not meet it).
- Light and dark themes, three typefaces for the page and a zoom for the page are in Settings and the View menu.

## What it does not do yet

- It does not listen to you itself; it needs a dictation app.
- Speech recognition mistakes (a name, a tool) are kept as heard. Settings → **Words to expect** lists names that should be kept
  as written, and *Edit and send again* in the history puts your words back in the box to fix.
- The language model is usually right, not always. Edit mode is there for the rest.
- Buttons and fields have names that a screen reader can read and the app is tested through those names, but nobody has used it
  with a screen reader for real work. If you do, please [say what happens](https://github.com/triggeredcode/lucid/issues/new/choose).
