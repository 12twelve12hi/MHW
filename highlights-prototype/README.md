# Save passage prototype

A throwaway tablet prototype for comparing two designs of the Daylight Reader's highlight menu:

- **Original**: today's Reader, rebuilt from its source (`a12k-a2b/daylight-reader`): the selection strip with four
  gray levels, mic, Note, Copy and More; the "Note · Undo" chip; the popover you get by tapping a highlight; the note
  sheet with Type it / Write it; the recording bar; symbols in the left margin.
- **Christine**: Christine's proposal (email of Oct 12, "proposed star highlights solution.pdf"), with its own coat of
  paint: the **Save passage** quick select, the hold / edit view, formatting presets per category, symbols in the
  right margin, and the **Annotations** view with note previews over the text.

Switch between them with **Original | Christine** at the top left. Each design keeps its own highlights, so you can
mark the same passages in both and compare.

## Install on the tablet

Download the APK from the latest-build release and open it on the DC-1 (allow installs from the browser if Android
asks):

<https://github.com/12twelve12hi/MHW/releases/download/highlights-prototype-latest/highlights-prototype.apk>

Every push to `claude/highlights-menu-ux-9i3p5j` rebuilds it (GitHub Actions, `.github/workflows/highlights-prototype.yml`).
All builds are signed with the same throwaway key, so a new one installs over the old one and keeps your highlights.
The build number shows at the bottom of the ⋯ menu.

## How to try it

| | Original | Christine |
|---|---|---|
| Select | Long-press a word; lift for the sentence, or drag for words. Tap the selection again for the paragraph. Drag the round handles to adjust. The pen selects as it drags. | Same |
| Save | Tap a gray in the strip | Tap ★ or ? (saves with that category's preset formatting) |
| More options | More: Underline, Strike out, Squiggly | Hold ★ or ?, or tap the pencil: name, text note, voice note, formatting, "Set as default for category", symbol |
| Change a saved one | Tap it: gray, symbol, look, note, voice note, delete | Tap it or its margin symbol: the same edit view |
| Notes on the page | Note glyph in the right margin, tap to peek | Switch to **Annotations**: note previews over the text; tap to open; hold two fingers still to see underneath |

The ⋯ menu has the how-to card again, text size, theme, highlight ink (grays for the DC-1, lavender as in the
mock-up), symbol side (Christine), and buttons to clear or reset the demo.

## Decisions the prototype makes where the mock-up is open

- **Categories without a default formatting** ask each time: tapping one opens the edit view.
- **"Set as default for category"** is ticked when a passage follows its category's preset. Picking a formatting
  while it is ticked changes the preset for every passage that follows it; untick it first for a one-time choice.
- **The pencil** opens the edit view on the selection with the last-used category, where + adds a category and the
  name field renames it.
- **Shade**: Highlight uses the category's gray (the Reader's four levels); the shade row appears under Highlight.
- **Voice notes** record audio on the tablet. Speech-to-text is not connected in this prototype, so the transcript
  preview starts empty unless the browser offers speech recognition; type into it to try the "editable transcript".
- **Two-finger peek** needs both fingers held still for about 0.3 s, so it can't be confused with the Reader's
  two-finger tap for undo.

## Edit it

It is plain HTML, CSS and JavaScript in `www/` with no build step:

- `www/content.js`: the sample text (Walden, chapter 2, abridged) and the starting passages.
- `www/app.js`: everything else; "Original mode" has its own section.
- `www/styles.css`: the Reader's tokens, then the Christine skin (scoped to `body.mode-christine`).

Run it locally with `npm run serve` (or any static server) and open <http://localhost:8080>. To make an APK without
CI: `npm ci && npx cap sync android && cd android && ./gradlew assembleDebug` (needs JDK 21 and the Android SDK).

## Fonts and licences

EB Garamond and Instrument Sans are SIL OFL 1.1 (licences in `www/fonts`). The Reader's own interface fonts
(ABC Arizona, ABC ROM) are licensed to Daylight and are not included.
