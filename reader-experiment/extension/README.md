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

Every row has **Remove**. The **⋯** button opens settings: **Lab** (below), **Comfort** (below), the Daylight's name,
the relay, this browser's name, **Change pairing…** and **Unpair**. Before pairing it opens Lab and Comfort alone.

**Accessibility.** Every control has a name, states are said in words and glyphs (never colour alone), status text
wraps instead of being cut short (also at 200% zoom), and a history row that turns *Delivered ✓*, *Waiting to send* or
*Not delivered* is announced to screen readers. Pairing by typing the code is always available (⋯ › **Change
pairing…** once paired). **Comfort** (⋯ › Comfort, off by default; *Larger text and buttons, more contrast, no
motion.*) makes text 125% larger, every button at least 48 px high, borders 2 px and muted text full ink, turns off
transitions, and lets titles wrap instead of ending in "…". It is part of the plain app, not Lab: it is kept in
`settings.comfort` (`storage.local`), and pairing, unpairing and Lab leave it as it is.

When a PDF can't be read inside its tab (Safari's PDF viewer, for example) and the server doesn't allow it otherwise,
the popup asks for permission to download from that one site. Saying no sends the link instead.

**Delivery.** Items wait on the relay until the Daylight picks them up (ntfy.sh keeps messages 12 hours, files 3
hours). The extension checks for the Daylight's confirmation after each send, 30 seconds later, whenever the popup is
open, and every 15 minutes while the browser runs. Anything unconfirmed is sent again: links and small pages every 11
hours, files and large pages 3 hours apart twice, then twice a day, for up to a week. An item still undelivered after
a week shows *Not delivered* with **Try again**; its copy is kept for that until two weeks after the share. If the
Daylight picks up the last re-send late, a confirmation that arrives within about two weeks still turns it into
*Delivered ✓*. With nothing waiting or still to be confirmed, the extension doesn't contact the relay.

## Lab

New features are tried out behind one **Lab** switch, the first row of ⋯ settings (LAB-PLAN 1). It is **on** by
default; turn it off for the plain app (*New features we’re trying out. Turn Lab off for the plain app; nothing you sent
is lost.*). Turning it off hides every Lab control and stops Lab's background work; it keeps the pairing, the outbox,
the history and the Daylight server's settings, and an item already on its way still goes. The switch belongs to this
browser: pairing, unpairing and renaming leave it as it is, and Safari's extension has its own, apart from the app's.

While Lab is on, two rows under the switch open the page `lab.html` in a tab:

- **What’s in Lab ›**: the features this build has, each with a short state ("Ready", "Not set up", "In a later
  update", …). The header line says whether your Daylight has confirmed Lab ("Your Daylight: Lab on · checked in 4 min
  ago"), from what it says on its confirmation channel; opening the page reads that channel once, while it asks the
  server. The states the server gave in the last 10 minutes show at once, and its new answer replaces them. In this
  first Lab build (Wave 0) the list holds only the features that run on your own **Daylight server** (Files over 9 MB,
  Summaries with Claude, Email-in address, Feeds and daily digest; Safari: Summaries with Claude). They are always shown and
  never greyed out: tapping one that isn't set up shows one sentence under it, saying what's missing, with at most one
  button that fixes it from here (**Copy Server code**, or **Allow** for the server's site) and **OK**. Screen readers
  hear it. A ready server answers "comes to this app in a later Lab update" until the feature is built here.
- **Daylight server ›** (*Optional · Not set up*): where setup happens. It shows the server's state in full (with the
  exact GitHub secret names); while the server isn't set up, **Turn it on** with the five steps, numbered (the last of
  them points to the server's README for every click); **Your server**, the server's host (with its port) and
  fingerprint; **Delivery** (*Through Lab on your Daylight, end-to-end encrypted*, or *Through your pairing (v1
  delivery)* followed by the v1 notice); the **Server code** with **Copy** (the `daylightserver://` link form when the
  pairing's relay isn't ntfy.sh); when the Daylight last said hello to the server; today's AI spend; **Set up with a
  link**; the optional **Server address** field (placeholder `https://`, **Save**, and the footer saying when it is
  needed); and how to re-run the deploy. Every word is `LAB_TEXT.serverSection`'s (LAB-PLAN 2.6, "The rest of the
  server section's copy") or the server module's. See [`../server/README.md`](../server/README.md) to turn the server
  on.
  - **Set up with a link** takes the one-time setup link the deploy makes (`https://daylight-….workers.dev/setup#SETUP-…`;
    server DESIGN 3.5). It comes right after the state while that state says to paste one (not set up, the previous
    pairing, locked, or not recognised), else last. The link is read here first: anything else (the Server code, the
    pairing code, another address) says why and sends nothing. Then *Use this Daylight server?* names the link's
    address, and only **Use it** asks for that site and sends the server this pairing's Server code (*Setting up…*);
    the section then reads the server again. Your other devices and your Daylight find it on their own.
  - **The server moved.** When your server announces itself at a new address (a deploy with *New setup link* makes a
    new Worker and deletes the old one), the section asks *Your Daylight server moved to {host}. Use it?*. Until you
    answer, it keeps using the address you had. **Use it** asks for the new site and switches to it; **Cancel**
    changes nothing, and the question comes back the next time the section opens. Opening the section or What’s in
    Lab reads the server's announcements again, however recently they were read (otherwise they are kept for 6
    hours), so the question comes at once. When a server feature is tapped and the server found from those kept
    announcements fails (gone, unreachable, or not recognising this pairing), they are read again then too; a server
    that keeps saying it doesn't recognise the pairing costs one such read, not one per tap.

Server calls run in the background (the pairing secret and the server's token never reach a web page). The first time a
server feature or the Server address is used, the browser asks for access to the server's site; saying no shows
*Needs access to this site*, with **Allow**. A server answer is used for 10 minutes; a server that doesn't answer within
5 seconds reads as *Couldn’t reach the Daylight server*. Before this browser is paired with another Daylight, a server
that knows the old pairing is locked (Lab on or off), so a lost or replaced pairing can't use it, and a typed Server
address (the old server's) is forgotten. **Unpair** forgets a typed Server address too (it locks nothing: the same
Daylight may come back). Afterwards, while Lab is on, the popup shows the locked text with the new
**Server code**, **Copy** and how to re-run the deploy, under *Daylight server*, until **OK** (or until the new server
answers).

The Safari extension inside the iPhone and Mac apps gets Lab only once the iPhone and Mac apps have this wave's Lab
(below, *Lab release gate*); until then it is the plain extension, with no Lab switch.

**Copy.** Every Lab word is `LAB_TEXT`'s: since Oct 22 the shared copy has the server section's steps, labels, delivery
lines and Server address field (`LAB_TEXT.serverSection`), so nothing in the section uses the popup's own words any
more. The server-moved question uses the setup confirmation's **Use it** and **Cancel**, which answer it word for word.

## Privacy

Everything is end-to-end encrypted (AES-256-GCM) with a key derived from the pairing code. The relay (ntfy.sh by
default) sees only random topic names, encrypted data, sizes and IP addresses: never the address, title or contents
of what you send. There is no account, no analytics, no remote code. The pairing code and a copy of unconfirmed
items stay in the extension's own storage; a delivered item's copy is deleted, leaving a history line. Anyone with the
pairing code can send to your Daylight, so treat it like a password; **Reset pairing** on the Daylight makes a new one.

Permissions: `activeTab` and `scripting` read the tab you chose to send, only when you click, press the shortcut or
use the menu; `contextMenus`, `alarms`, `storage` and `unlimitedStorage` run the menus, the retries and the outbox
(kept until delivered, so it can be re-sent); host access to `https://ntfy.sh` reaches the relay. Access to other
sites is optional and asked for one site at a time: to download a PDF, and (Lab) to reach your own Daylight server.

## Build and test

Needs Node 22. No npm packages are needed to build; Playwright (and `@axe-core/playwright`, pinned in
`package.json`) is only for the end-to-end tests and the icons.

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
  [`../share/js/daylight-share.js`](../share/js/daylight-share.js) and the Lab module
  [`../share/js/daylight-lab.js`](../share/js/daylight-lab.js) (the one sources of truth; never edit the copies),
  and the Daylight server's client module [`../server/client/daylight-server.js`](../server/client/daylight-server.js)
  with its one import pointed at the copy next to it (`serverModule()`), writes `target.js` and each browser's
  manifest:
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
- **Lab** (LAB-PLAN F00 and F17, card X0): `src/lab.js` runs in the background (`createLab`, wired by `core.js`): the
  switch (`settings.lab`; missing means on, and the first start writes `true`), the sender ledger
  (`daylight-lab.js` `LabLedger`, fed by every frame on the Daylight's confirmation topic through the Sender's
  `onAckHeader`, Lab on or off, and pruned to the outbox after each check), the gates (`labGate` with the 5 s deadline;
  the server's site access, then its state), the Daylight server (`DaylightServer`, discovery only with Lab on) and
  the lock before re-pairing (then the follow-up: `lab/repaired` until OK or a ready server). Its messages are
  `labState`, `setLab`, `labOverview`, `labGate`, `labServer`, `labServerAddress`, `labConfirmMove` (the server moved:
  `DaylightServer.confirmMove`), `labSetupCheck` and `labSetup` (Set up with a link: `parseSetupLink`, then
  `DaylightServer.setup`), `labRepaired` and `labRepairSeen`. `labOverview` with `refresh: false` answers from
  `lab/server` and the cached status while they are 10 minutes old or less (`cached: true`), without the network. `src/lab.html` and `src/lab-page.js` are the page; `src/lab-ui.js` builds its parts (the note,
  What's in Lab, the server section) from data alone, so the web sender's build can copy it (B0). Every word is
  `LAB_TEXT`'s or the server module's. `LAB_FEATURES`, `LAB_SERVER_FEATURES` and `BUILT_FEATURES` in `lab.js` say what
  this build lists and runs; `LAB_NOTE_ENABLED` is `false` until a build has F01 or F04 (X1). A fresh What's in Lab
  answer updates the rows' short states in place (`updateWhatsInLab`), so a note opened meanwhile stays. Tests:
  `test/unit/lab.test.mjs` (node, against the mock relay, a stand-in server in `test/helpers/fake-worker.mjs` and Lab
  Daylights from `daylight-lab.js`) and `test/e2e/lab.e2e.mjs` (Chromium: the popup's row and `lab.html`, Lab on and
  off, the update over a non-Lab build (F00.1), the notes, the Server code and Copy, OFFLINE at 5 s, no setup text
  before a tap, the header line, the cached states, the server-moved question with a fresh cached config, and Unpair
  forgetting a typed Server address).
  **Test hook** (LAB-PLAN 1.7): every build, the `chrome-test` one included, reads `settings.lab` from
  `storage.local` and never overwrites a stored value, so a test seeds `{settings: {lab: false}}` (after the first
  start wrote its default: `labDefaultWritten()` in `test/helpers/lab-off.mjs`) to run with Lab off.
- `test/e2e/a11y.e2e.mjs` is the accessibility baseline (LAB-PLAN F27) for the popup and the web sender: axe-core
  finds no violations in any view (pairing, the pairing question, sending with a row in every state, settings), light
  and dark, Comfort off and on (F27.1); with Comfort on at 360 px no text is clipped (`scrollWidth <= clientWidth`,
  `scrollHeight <= clientHeight + 1` for every element with text) and status text wraps at 200% text (F27.4); every
  control has a name; Comfort's switch and its words (`LAB_TEXT.comfort`, `.comfortFooter`); the announcements; and
  typed-code pairing. Its screenshots (`test-results/a11y/`) are uploaded by CI for review, not compared. The checks
  live in `test/helpers/a11y.mjs`. `lab.html` is held to the same with Lab on and off (its switch, What's in Lab with
  a note open, the server section with no server and a ready one; notes and lines wrap at 200% text), and so is the
  popup's Settings with Lab on and off.
- **Lab-off parity** (LAB-PLAN 1.7, F00.2): `test/e2e/lab-off-parity.e2e.mjs` (popup) and
  `test/e2e/web-lab-off-parity.e2e.mjs` (web sender) compare each main screen's accessibility tree (pairing, sending
  with a row in every state, settings), taken with Playwright's `locator('body').ariaSnapshot()`, with the baselines in
  [`test/e2e/lab-off-baseline/`](test/e2e/lab-off-baseline/), recorded from the P0 close-out (protocol 1.1 plus the
  accessibility baseline, before any Lab code). The tests seed `settings.lab = false` (the extension's test hook, and
  the web sender's stored Lab key). The mock relay's port, the version, the shortcut and the default device name are
  replaced by `<port>`, `<version>`, `<shortcut>` and `<default name>`; the pairing, names and row ages are fixed
  (`test/helpers/lab-off.mjs`). Re-record only together with a matching non-Lab change:
  `UPDATE_LAB_OFF_BASELINE=1 node --test test/e2e/lab-off-parity.e2e.mjs test/e2e/web-lab-off-parity.e2e.mjs`.
  With Lab off the Lab switch row itself stays (LAB-PLAN 1.3); `expectBaseline(page, name, {omit: labSwitchLines(LAB_TEXT)})`
  drops exactly those lines (the switch and its footer) from Settings, and nothing else. `lab.e2e.mjs` also checks that
  with Lab on, Wave 0 leaves the pairing and sending screens equal to the same baselines, and a build without Lab
  (below) equals all three with nothing left out.
- CI: [`.github/workflows/rx-extension.yml`](../../.github/workflows/rx-extension.yml) has one job per lane (LAB-PLAN
  6.1; each marked `# lane:`): **ext** builds the extension and runs every test whose file name doesn't start with
  `web` (the Safari bundle's and the accessibility test included), and **web** builds the web sender and runs the
  `*web*` tests. **publish** (ext's) puts the two zips on the release, and **pages** (web's) deploys the web sender to
  GitHub Pages (see [`../web/README.md`](../web/README.md)). `dist/safari` is the `send-to-daylight-safari`
  artifact, and the accessibility screenshots are `rx-extension-a11y-screenshots`.
- **Lab release gate** (LAB-PLAN 6.2): the extension's and the web sender's Lab builds reach people only after the
  iPhone and Mac builds of the same wave. `lab-wave.json` here (and `../web/lab-wave.json`) names the Lab wave of the
  folder's code: `null` until X0 (B0 for the web sender) sets `"w0"`, then `"w1"` from X1 (B1). The extension's says
  `"w0"` since X0. `scripts/lab-wave.mjs` reads the wave from the code too, so a `lab-wave.json` left behind can't open
  the gate: `src/lab.js` or anything naming `daylight-lab` is W0; a W1 export of `daylight-lab.js` (the ones under its
  `// W1 (L1)` heading, `fillText` among them), `describeLabRow`, the Sender's F07 calls, `LAB_NOTE_ENABLED = true` or
  a quoted id of one of the extension's W1 features (`'F01'`, `'F03'`, … in `LAB_FEATURES`) is W1; a Lab feature of a
  later wave makes it exit 2 (teach it that wave). It prints the later of the two waves; `--check` fails when
  `lab-wave.json` is behind (the ext job runs it, and `build.test.mjs` checks it).
  - **Chrome:** while [`../lab-release-gate.json`](../lab-release-gate.json) has that wave `false`, the build and its
    tests still run, but **publish** doesn't upload the zip and the run shows a notice saying so; when the script
    can't tell, the step fails and nothing is uploaded. A change to the gate file starts the workflow, so opening a
    wave publishes the held builds.
  - **Safari** ships inside the iPhone and Mac apps, which rx-apple.yml publishes with every build, so `build.mjs`
    holds it: while the wave is closed (or can't be told), `node build.mjs --target safari` makes it **without Lab**
    (`target.js` `LAB_BUILT = false`, no `lab.html`): no Lab switch, nothing written for Lab, no ledger; the popup equals
    the non-Lab baselines with nothing left out. The build's log line (a notice in CI) says why. `--lab` builds it with
    Lab anyway (the unit tests, a local Xcode run), `--no-lab` without. Once the gate opens the wave, the next Apple
    build carries the extension's Lab.

## Limits

- Re-sends and delivery checks run only while the browser runs (and on Safari for iPhone, when iOS lets the extension
  run). If the browser stays closed for more than the relay's 12 hours (3 hours for PDFs) while the Daylight is off,
  the item is sent again the next time the browser starts.
- Chrome's own pages (`chrome://…`) and other browser pages can't be sent. Local `file://` pages are sent as HTML
  files if *Allow access to file URLs* is on for the extension.
- The Safari build is tested here by running its background script against a fake `browser` API, not in Safari
  itself; the Mac/iPhone app's CI builds it into the app.
