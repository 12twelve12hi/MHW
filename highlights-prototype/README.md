# Save passage prototype

A throwaway tablet prototype for comparing two designs of the Daylight Reader's highlight menu:

- **Original**: today's Reader, rebuilt from its source (`a12k-a2b/daylight-reader`): the selection strip with four
  gray levels, mic, Note, Copy and More; the "Note · Undo" chip; the popover you get by tapping a highlight; the note
  sheet with Type it / Write it; the recording bar and voice player; the pen's side-button tap. Book pages show no
  margin symbols, as in the Reader's reflowed books; ⋯ › Page › PDF shows them as on fixed pages.
- **Christine**: Christine's proposal (email of Oct 12, "proposed star highlights solution.pdf") with its own coat of
  paint (a bookish look chosen from three design directions): the **Save passage** quick select, the hold / edit
  view, formatting presets per category, symbols in the right margin, and the **Annotations** view with note
  previews over the text.

Switch between them with **Original | Christine** at the top left. Each design keeps its own highlights, so you can
mark the same passages in both and compare.

## Install on the tablet

Download the APK from the latest-build release and open it on the DC-1 (allow installs from the browser if Android
asks):

<https://github.com/12twelve12hi/MHW/releases/download/highlights-prototype-latest/highlights-prototype.apk>

Every push to `claude/highlights-menu-ux-9i3p5j` rebuilds it (GitHub Actions, `.github/workflows/highlights-prototype.yml`).
All builds are signed with the same throwaway key, so a new one installs over the old one and keeps your highlights.
The build number shows at the bottom of the ⋯ menu.

There is also a web version (no install, private to its owner until shared from its Share menu):
<https://claude.ai/artifact/YapXZVcJdqi7NkdWBBJR7X>. The microphone isn't available there, so voice notes offer
"Pretend to record".

## How to try it

A short intro video plays on first launch (Skip closes it; ⋯ › Watch the intro video plays it again). It was
recorded from the prototype itself (`www/onboarding.webm` / `.mp4`).

| | Original | Christine |
|---|---|---|
| Select | Long-press a word; lift for the sentence, or drag for words. Tap the selection again for the paragraph. Drag the round handles to adjust. The pen selects as it drags. | Same |
| Save | Tap a gray in the strip | Tap ★ or ? (saves with that category's preset formatting) |
| More options | More: Underline, Strike out, Squiggly | Hold ★ or ?, or tap the pencil: name, text note, voice note, formatting, "Set as default for category", symbol |
| Change a saved one | Tap it: gray, symbol, look, note, voice note, delete | Tap it or its margin symbol: the same edit view |
| Notes on the page | Note glyph in the right margin, tap to peek | Switch to **Annotations**: note previews over the text; tap to open; hold two fingers still to see underneath |

The ⋯ menu has the how-to card again, text size, theme, highlight ink (grays for the DC-1, lavender as in the
mock-up), and buttons to clear or reset the demo. In Christine mode it also has hints, formatting previews on the
category buttons, and symbol side; in Original mode, the page type.

## Decisions the prototype makes where the mock-up is open

- **Presets apply to new saves only.** Each passage keeps the formatting it was saved with. With "Set as default for
  category" ticked, what you pick also becomes the category's preset for future taps; unticked, it is just for this
  passage. Passages saved earlier never change.
- **Categories without a preset** ask each time: tapping one opens the edit view. A category made with + starts with
  the passage's current look as its preset.
- **The pencil** opens the edit view without saving anything; choose a category (or + to add one) to save the passage.
- **Shade**: Highlight uses one of the Reader's four grays; the shade row appears under Highlight and follows the same
  preset rule.
- **Formatting previews**: category buttons show their preset (★ on a gray band, ? with a squiggle). Turn this off in
  ⋯ to see her plain symbols.
- **Voice notes** in the APK use Android's own speech recognition (`TranscriberPlugin.java`): the transcript fills in
  live while you talk and stays editable afterwards. The plugin records the audio itself and feeds the same stream to
  the recogniser, so the note keeps both. If the tablet's speech service can't take a shared stream, it listens on its
  own instead and the note keeps the transcript but not the audio (the recorder says so). If the tablet has no speech
  service at all, recording works and you type the transcript. In Chrome on a computer, the browser's speech
  recognition fills it in. The sample passage "Time is but the stream…" has a voice note with a transcript.
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
