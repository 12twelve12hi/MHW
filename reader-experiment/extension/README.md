# Send to Daylight: browser extension

A toolbar button for Chrome and Safari that sends the page you are reading, a link, or a PDF to your Daylight DC-1,
where it lands in the Daylight Reader. Web pages go as you see them (the HTML from your browser), so articles behind a
login or paywall arrive whole.

One codebase (`src/`) builds both browsers. The web sender page for devices without the extension is in
[`../web/`](../web/).

## Install

### Chrome (also Edge, Brave, Arc, Vivaldi and other Chromium browsers)

1. Download **`send-to-daylight-chrome.zip`** from the
   [latest builds](https://github.com/12twelve12hi/MHW/releases/tag/reader-experiment-latest).
2. Unzip it. You get a folder, `send-to-daylight-chrome`. Put it somewhere it can stay: Chrome loads the extension
   from that folder every time it starts.
3. Open `chrome://extensions` and switch on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped folder.
5. Click the puzzle-piece icon in the toolbar and pin **Send to Daylight**.

To update: unzip the new build over the same folder, then click the reload arrow on the extension's card in
`chrome://extensions`. Your pairing and history are kept.

**Publishing to the Chrome Web Store (later).** The zip is already in the store's format (manifest at the root).
Register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) (one-time $5),
click **New item**, upload `send-to-daylight-chrome.zip`, fill in the listing (description, at least one 1280x800
screenshot, the 128 px icon from `src/icons/icon-128.png`), and answer the privacy questions: single purpose "send
the current page to the user's own Daylight tablet"; `activeTab`/`scripting` to read the page the user chose to
send; `contextMenus`, `alarms`, `storage`/`unlimitedStorage` for the menus, retries and the outbox; the `ntfy.sh` host
permission for the relay; optional host access requested only to download a PDF. No remote code; data is end-to-end
encrypted and sent only to the user's own device. Each later release: bump `version` in `package.json` (CI builds use
`1.0.<run number>`) and upload the new zip.

### Safari (Mac, iPhone, iPad)

The Safari extension comes inside the **Send to Daylight** app (see [`../apple/`](../apple/)); install the app first.
If the app is already paired, the extension picks up its pairing by itself.

- **Mac:** Safari > Settings > Extensions, tick **Send to Daylight**. Click its toolbar button on a page and choose
  **Always Allow on Every Website** (or allow sites one at a time). For a development build that isn't signed, first
  turn on Safari > Settings > Advanced > *Show features for web developers*, then Safari > Settings > Developer >
  *Allow unsigned extensions* (in older Safari: Develop menu > *Allow Unsigned Extensions*; needed again after each
  Safari restart).
- **iPhone and iPad:** Settings > Apps > Safari > Extensions > **Send to Daylight**, switch it on and allow it on all
  websites (or *Ask*). In Safari, tap the page-settings button in the address bar (the "aA" or puzzle icon) and
  choose **Send to Daylight**.

## Pair

On the Daylight, open **Daylight Share** (choose *This is my Daylight* the first time). It shows a QR code and a
28-character code. Click the extension's toolbar button and either type the code (dashes and case don't matter) or
paste the pairing link (`daylightshare://pair?...`), optionally name this browser ("Chrome on my laptop"), and click
**Pair**. *Advanced: Relay URL* is only for a Daylight that uses its own ntfy server (a pairing link already carries
it).

**⋯ › Change pairing…** takes a code again, with *Advanced: Relay URL* filled in with the relay in use (so the same
code typed again, to rename this browser, keeps it; a pasted link always uses its own). The same Daylight's code with a
new relay (or a new name) applies at once
(*Pairing updated: now sending through …*) and keeps anything not yet delivered, which then goes through the new
relay. Another Daylight's code asks first, showing the start of its code (*Code starts E4AY*) and that it replaces the
current Daylight; **Switch** discards what the old one hasn't picked up yet. These words, like the history's, come from
the protocol library (Daylight Share protocol 1.1), so every Send to Daylight app says the same.

## Use

| | What it sends |
|---|---|
| **Send this page** | The page's HTML as you see it, with its address and title. A PDF tab sends the PDF file itself, up to 9 MB (downloaded with your cookies, so PDFs behind a login work). Pages over 8 MB, PDFs over 9 MB, images and pages the browser won't let extensions read (the Chrome Web Store, for example) send their link instead; the popup says when that happens. |
| **Send link only** | Just the address and title; the Daylight Reader downloads the article itself. |
| Right-click a page: **Send page to Daylight** | Same as *Send this page*. |
| Right-click a link: **Send link to Daylight** | The link, titled with the link's text. |
| Right-click a link ending in .pdf: **Send PDF link to Daylight** | Downloads the PDF and sends the file (up to 9 MB); sends the link if it can't. |
| **Alt+Shift+D** (Option+Shift+D on a Mac) | *Send this page*. Change it at `chrome://extensions/shortcuts`. |

**Sizes:** files and PDFs up to 9 MB, pages up to 8 MB. The free relay (ntfy.sh) takes attachments of up to 2 MB, so
larger ones travel in pieces that fit; it holds about 20 MB per network at a time, so after a burst of big files the
rest waits a few hours (the history says so).

The toolbar button shows **…** while sending, **✓** when sent and **!** when it couldn't be sent yet. The popup lists
the last few sends in the words every Send to Daylight app uses:

- *Sending…*;
- **Sent · waiting for your Daylight**: the relay has it; the Daylight hasn't picked it up yet (it may be asleep);
- **Delivered ✓**: the Daylight confirmed it;
- **Waiting to send**, with why: the relay couldn't be reached (**Retry now**), or it is full or turned the item down
  (it tries again by itself in about 3 hours);
- **Not delivered**, with why, and **Try again** where trying again can help (for example the Daylight didn't pick it
  up within a week).

Every row has **Remove**. The **⋯** button opens settings: the Daylight's name, the relay, this browser's name,
**Change pairing…** and **Unpair**.

When a PDF can't be read inside its tab (Safari's PDF viewer, for example) and the server doesn't allow it otherwise,
the popup asks for permission to download from that one site. Saying no sends the link instead.

**Delivery.** Items wait on the relay until the Daylight picks them up (ntfy.sh keeps messages 12 hours, files 3
hours). The extension checks for the Daylight's confirmation after each send, 30 seconds later, whenever the popup is
open, and every 15 minutes while the browser runs. Anything unconfirmed is sent again: links and small pages every 11
hours, files and large pages 3 hours apart twice, then twice a day, for up to a week. An item still undelivered after
a week shows *Not delivered* with **Try again**; its copy is kept for that until two weeks after the share. If the
Daylight picks up the last re-send late, a confirmation that arrives within about two weeks still turns it into
*Delivered ✓*. With nothing waiting or still to be confirmed, the extension doesn't contact the relay.

## Privacy

Everything is end-to-end encrypted (AES-256-GCM) with a key derived from the pairing code. The relay (ntfy.sh by
default) sees only random topic names, encrypted data, sizes and IP addresses: never the address, title or contents
of what you send. There is no account, no analytics, no remote code. The pairing code and a copy of unconfirmed
items stay in the extension's own storage; a delivered item's copy is deleted, leaving a history line. Anyone with the
pairing code can send to your Daylight, so treat it like a password; **Reset pairing** on the Daylight makes a new one.

Permissions: `activeTab` and `scripting` read the tab you chose to send, only when you click, press the shortcut or
use the menu; `contextMenus`, `alarms`, `storage` and `unlimitedStorage` run the menus, the retries and the outbox
(kept until delivered, so it can be re-sent); host access to `https://ntfy.sh` reaches the relay. Access to other
sites is optional and asked for one site at a time, only to download a PDF.

## Build and test

Needs Node 22. No npm packages are needed to build; Playwright is only for the end-to-end tests and the icons.

```sh
cd reader-experiment/extension
node build.mjs              # dist/chrome, dist/safari, dist/chrome-test, dist/send-to-daylight-chrome.zip
node ../web/build.mjs       # the web sender: ../web/dist/site and ../web/dist/send-to-daylight-web.zip
node --test test/unit/*.test.mjs                       # unit tests (no browser)
npm ci && npx playwright install chromium              # once, for the end-to-end tests
node --test --test-concurrency=1 test/e2e/*.e2e.mjs    # Chromium + mock relay (HEADED=1 to watch)
node scripts/make-icons.mjs                            # re-render the PNG icons after changing their SVG
```

- `src/` is the source for both browsers. `build.mjs` copies it, adds the protocol library from
  [`../share/js/daylight-share.js`](../share/js/daylight-share.js) (the one source of truth; never edit the copies),
  writes `target.js` and each browser's manifest:
  - **Chrome:** Manifest V3 with a module service worker.
  - **Safari:** Manifest V3 with a non-persistent background page made of one classic script (`build.mjs` bundles
    the modules), which works on every Safari with Manifest V3 on macOS and iOS; adds `nativeMessaging` (to ask the
    app for its pairing), a monochrome toolbar icon and `strict_min_version` 16.4 (for `CompressionStream`).
    `dist/safari` is the folder the Xcode project's Safari Web Extension target takes as its resources.
  - **chrome-test:** Chrome's plus access to `127.0.0.1` and `localhost`, because automation can't click the toolbar
    button that grants `activeTab`. Only for the tests.
- `src/core.js` is the background logic (pairing, capture, PDFs, outbox, menus, alarms); it takes the browser API as a
  parameter, so `test/unit/core.test.mjs` runs it in node against a fake browser (`test/helpers/fake-browser.mjs`,
  which runs the real injected functions from `src/inject.js` on a stubbed page), the mock ntfy relay and a
  `Receiver` playing the Daylight. `test/unit/safari.test.mjs` loads the Safari bundle exactly as Safari does.
- `test/e2e/extension.e2e.mjs` loads `dist/chrome-test` into Chromium, pairs in the popup, sends an article, a PDF
  shown in Chrome's PDF viewer, a 5 MB PDF (three pieces under the mock relay's 2 MB per attachment), a link, an
  8 MB+ page, the PDF-link menu and the shortcut, receives them with a `Receiver` and waits for **Delivered ✓**. It
  then makes the relay answer 429 and 413 (*Waiting to send*, **Retry now**, **Remove**) and changes the pairing (the
  same code on a new relay, then another Daylight's code with its question). `test/e2e/web.e2e.mjs` does the same for
  the web sender, including the `#pair=` question, a file over 9 MB refused before it is read, the Android share
  target and offline use. Screenshots land in `test-results/`.
- CI: [`.github/workflows/rx-extension.yml`](../../.github/workflows/rx-extension.yml) builds, runs both test suites,
  publishes the two zips to the release, uploads `dist/safari` as the `send-to-daylight-safari` artifact, and deploys
  the web sender to GitHub Pages (see [`../web/README.md`](../web/README.md)).

## Limits

- Re-sends and delivery checks run only while the browser runs (and on Safari for iPhone, when iOS lets the extension
  run). If the browser stays closed for more than the relay's 12 hours (3 hours for PDFs) while the Daylight is off,
  the item is sent again the next time the browser starts.
- Chrome's own pages (`chrome://…`) and other browser pages can't be sent. Local `file://` pages are sent as HTML
  files if *Allow access to file URLs* is on for the extension.
- The Safari build is tested here by running its background script against a fake `browser` API, not in Safari
  itself; the Mac/iPhone app's CI builds it into the app.
