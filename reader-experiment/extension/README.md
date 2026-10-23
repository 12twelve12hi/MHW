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
  server. The states the server gave in the last 10 minutes show at once, and its new answer replaces them. The list
  holds this build's Lab features (Wave 1, below: Delivery timeline, Pages as you see them, Share in place, Works
  offline, Send as, Send a selection, Clean links, Setup check, Send copied link, More right-click choices), then,
  under *With your Daylight server (optional)*, the features that run on your own **Daylight server** (Files over 9
  MB, Summaries with Claude, Email-in address, Feeds and daily digest; Safari: Summaries with Claude). They are always
  shown and never greyed out: tapping one that isn't set up shows one sentence under it, saying what's missing, with at
  most one button that fixes it from here (**Copy Server code**, or **Allow** for the server's site) and **OK**. Screen
  readers hear it. A ready server answers "comes to this app in a later Lab update" until the feature is built here.
  Share in place, Send as, More right-click choices and Setup check open their own settings when tapped; the features
  that change how sharing behaves have a **Use** switch (below).
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

### Lab, Wave 1 (card X1)

What Lab adds to sending (LAB-PLAN 3.3). With Lab off none of it shows or runs, and the popup equals the plain app's.

- **Delivery timeline** (F01). History rows say how far each item got, in the words every Lab app uses
  (`describeLabRow`): *Sent* → *On your Daylight ✓* → *In your Reader ✓*, or *Waiting for a tap on your Daylight*,
  *Kept for later on your Daylight*, *Handed to the Reader* (the Reader doesn't confirm documents yet), *In your Reader's
  queue*, *Not added to the Reader*. The newest row and every row still under way show their sentence and the step line
  (*Sent ✓ · On your Daylight ✓ · In the Reader …*); a settled row keeps them behind its title (click it). Screen
  readers hear "{label}. {sentence}", never the step line. Above the history: *Your Daylight checked in 4 min ago.* A
  Daylight without Lab gives exactly the plain rows (*Delivered ✓*). While a delivered row's state is still on its way,
  the open popup reads the confirmation channel every 30 s, and the background every 15 minutes for 48 hours. The
  toolbar badge shows the most recent row: **…** on its way, **✓** on your Daylight (for 6 s), **⌛** waiting for a tap
  there, **!** not on its way. A send that fails or makes no row (a page the extension may not send, copied text with
  no link, nothing selected) shows **!**, as the plain app does, never an older row's ✓; a question (a PDF's site, the
  thin-page one, Review) leaves the most recent row's mark.
- **Pages as you see them** (F03). The page goes through `clean-html.js` (the one copy in
  [`../share/js/capture/`](../share/js/capture/), which the build copies): no scripts (JSON-LD stays), no `on…`
  attributes, no form contents, hidden or password fields, `javascript:` links or `srcdoc`; the logged-in text stays.
  It is marked `x-cap: "seen"`. Pages over 8 MB after cleaning go as links, as before; PDFs are untouched.
- **Share in place** (F04). With **Send when I click the toolbar button** (What's in Lab › Share in place, off by
  default) the popup opens as a card, *Sending to {your Daylight}*, and the page goes 1.5 s later with the last choices;
  the background owns the timer, so closing the popup still sends. **Options** stops it and shows Send as, **Review
  before sending**, **Send** and **Send the link instead**. With Comfort or **Always show Options before sending** on,
  the card opens with the choices and nothing goes before **Send** (an extension can't tell whether a screen reader or
  switch access is on, so those two cover it). A page the extension can't read says its link will be sent. A PDF the
  extension may download only with its site's permission is asked for in the popup once the countdown ends, as **Send
  this PDF** asks (the browser's prompt, or **Allow and send** and **Send the link**); the popup takes the question
  first (`labHoldPdf`). If the toolbar's popup was closed by then, nobody can answer, so its link goes at once with the
  plain sentence (*Without access to the site the PDF can’t be downloaded, so its link was sent.*); the pairing page
  open in a tab (`popup.html?standalone=1`) doesn't count as the popup. A question no popup takes within 3 s (the
  card's popup closed just as the countdown ended, while another window's popup is open) goes as its link the same way.
- **Works offline** (F07). Shared while the browser is offline, an item waits (*Waiting for connection*) in **Waiting
  to send (n)** above the history, each with **Cancel**; the `dls-offline` alarm (every minute, only while something
  waits) and the popup's `online` event send them once the network is back (oldest first, at most 30 messages and 18 MB
  a pass, passes 3 minutes apart). A relay that fails while the browser is online is the plain app's *Waiting to send*
  with its own back-off, in the same queue, with the plain app's **Retry now** beside **Cancel** where it helps (a busy
  relay, a network error) and no button where it can't (a full relay sends by itself in about 3 hours) (F01.4).
- **Send as** (F10). "Send as: Page ▾" above **Send this page**: Page as you see it, Clean article, Link only,
  Selection. It switches to Selection by itself when text is selected, a PDF tab sends the file, and otherwise it starts
  with the mode last used on that site (`lab/sendAs`, the 500 most recent sites). **Clean article** runs Mozilla
  Readability 0.6.0 (copied from `share/js/capture/` too) on a copy of the page and sends the article as a page marked
  `x-cap: "clean"`; on that copy, `clean-html.js`'s `prepareForReadability` first moves the page's summary boxes ("Key
  points" and the like, a heading and a list beside the article's text) into the text, where Readability keeps them
  (F10.1; `inject.js` `captureArticle`, in the order `share/README.md` gives); under 150 words it asks *This page looks thin (n words). Send the full page instead?*
  (**Send full page**, **Send anyway**); a menu, a shortcut or the card can't ask, so they send the full page then.
  **Review before sending** (What's in Lab › Send as) opens `review.html`: the page with JavaScript off and in greys,
  its word count and size, and its title to edit, with **Send** and **Cancel**; after **Send** it says what the popup
  says for the same row (*Waiting for connection* offline). With Send as's **Use** switch off there is no Send as line
  and pages go as you see them; while text is selected, **Send as excerpt** under **Send link only** still sends the
  selection, since that switch doesn't take away F11's explicit selections (LAB-PROTOCOL 2.9.6).
- **Send a selection** (F11), from Selection mode (or **Send as excerpt**), the right-click menu or Alt+Shift+S: the
  selected passage as an
  excerpt document (HTML, "Excerpt - {first words}.html", titled "“{first line}” · {page title}", with the page's link
  and the date, `x-cap: "excerpt"`), never the whole article. The first one says once: *Excerpts wait for a tap on your
  Daylight for now.* Only these explicit paths make excerpts (LAB-DECISIONS Q1).
- **Clean links** (F16). Links and page addresses lose tracking parameters and redirect wrappers (`normaliseShare`);
  the address as shared goes along as `x-orig`. What is typed or copied (Paste and send's clipboard, or
  `dl see (https://…).` in the address bar) goes to `normaliseShare` whole, as text, so it finds the link by its own
  rules (parentheses, quotes, brackets and trailing punctuation left out) and the words are the title. An address typed
  on its own goes the same way (`typedLinkItem`): `example.com/story` gets `https://` first (`typedUrl`), and
  `dl https://example.com/a/b.` sends `https://example.com/a/b`.
- **Setup check** (F26), What's in Lab › Setup check: ✓ or ! for the pairing, the toolbar button (Chrome), the keyboard
  shortcut (Chrome) and site access (Safari, which asks on each site until it may read pages there; **Allow** asks
  Safari, whose prompt says how far. Chrome has no such line: it reads only the tab you chose, and asks for one site at
  a time where a PDF or your Daylight server needs more), each unmet one with a button where there is one to press.
  Chrome's toolbar pin has no page to open, so its button is **Show steps**, which shows *Click the puzzle piece in
  Chrome’s toolbar, then the pin next to Send to Daylight.* under the line (`LAB_TEXT.setup.steps.toolbarButton`,
  LAB-PLAN 1.6's copy added Oct 22). **Send a test article**
  (a page of about 400 words at `https://daylight.invalid/test/…`, `x-cap: "test"`), followed until *✓ Delivered* and
  *✓ In your Reader* (or *Waiting for a tap on your Daylight* meanwhile); the **Activity log** (the last 200 events,
  without titles or addresses; an event about a row ends with the HTTP status of its last failed publish, such as 413
  or 429, or `-`) and **Copy diagnostics** (redacted: no address, title, code or topic).
- **Send copied link** (F33): **Paste and send** reads the clipboard only when clicked (Chrome asks for the clipboard
  permission the first time; Safari shows its Paste button), then asks *Send {host}?* (**Send**, **Cancel**), or says
  *No link on the clipboard.*
- **More right-click choices** (F34): Send page, Send clean article, Send link, Send selection, Send this image's page
  (the page, not the image) and Send PDF link to Daylight, each with a box in What's in Lab › More right-click choices;
  shortcuts `send-page` (Alt+Shift+D), `send-selection` (Alt+Shift+S), `send-clean` and `send-link` (set them at
  `chrome://extensions/shortcuts`); Chrome's address bar: type **dl**, a space and an address. With Lab off the menu is
  the plain three and the keyword opens Lab's page with *Turn on Lab in Send to Daylight to use this.* Safari has no
  keyword, and iPhone Safari no right-click menu (Selection mode covers it).
- **Use switches** (LAB-DECISIONS Q5): Share in place, Send as, Clean links and Send copied link have **Use** (on by
  default) in What's in Lab, each with what turning it off does; the one Lab switch still turns everything off. Pages
  as you see them has none here: its switch only hides a share sheet's "Only the link came through" line, which the
  extension never shows (it reads the page itself, and says so when it can't).
- **The one-time note** (1.2): *Lab is on. New features to try are in Settings › Lab, where you can turn it off.*,
  once, with **OK**.
- **Files over 9 MB ›** (the F02 entry point, Chrome): under *The PDF is over 9 MB, so its link was sent.*, it runs the
  big-files feature's gate: *Needs your Daylight server …* until there is one, then *comes to this app in a later Lab
  update*.

Settings (all in `storage.local`'s `settings`, never synced, kept when Lab or a Use switch is off): `labUse` (the Use
switches), `labClickSend`, `labAlwaysOptions`, `labReview`, `labMenus` (the menu boxes), `labNoteShown` and
`labExcerptNoteShown`. Lab's own keys (`lab/sendAs`, `lab/activity`, `lab/badge`, `lab/review`, `lab/testId`,
`lab/flushAt`, `lab/offlineAt`) go with a pairing change, like the ledger.

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
On Safari, Lab's Setup check also shows whether Safari lets the extension read pages without asking on each site; its
**Allow** asks Safari, and Safari's prompt lets you choose how far.

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
  this build lists and runs; `LAB_NOTE_ENABLED` is `true` from X1 (the first build with F01 and F04). A fresh What's in Lab
  answer updates the rows' short states in place (`updateWhatsInLab`), so a note opened meanwhile stays. Tests:
  `test/unit/lab.test.mjs` (node, against the mock relay, a stand-in server in `test/helpers/fake-worker.mjs` and Lab
  Daylights from `daylight-lab.js`) and `test/e2e/lab.e2e.mjs` (Chromium: the popup's row and `lab.html`, Lab on and
  off, the update over a non-Lab build (F00.1), the notes, the Server code and Copy, OFFLINE at 5 s, no setup text
  before a tap, the header line, the cached states, the server-moved question with a fresh cached config, and Unpair
  forgetting a typed Server address).
  **Test hook** (LAB-PLAN 1.7): every build, the `chrome-test` one included, reads `settings.lab` from
  `storage.local` and never overwrites a stored value, so a test seeds `{settings: {lab: false}}` (after the first
  start wrote its default: `labDefaultWritten()` in `test/helpers/lab-off.mjs`) to run with Lab off. The plain app's
  own suites (`test/unit/core.test.mjs`, `test/e2e/extension.e2e.mjs`) run that way, and again with Lab on, the
  default (`test/unit/core-lab-on.test.mjs`, `test/e2e/extension-lab-on.e2e.mjs` set `DLS_TEST_LAB` and `DLS_E2E_LAB`),
  so Lab's send path and popup keep every plain flow: relay trouble with **Retry now**, 413, Remove and Cancel among
  them. What Lab changes on purpose (the badge from the most recent row, `clean-html.js`'s lowercase doctype, the queue,
  Lab's menu entries) is each suite's `LAB` branch.
- **Lab, Wave 1** (LAB-PLAN 3.3, card X1): `src/lab-send.js` holds the rules as pure functions (the menus with Lab on
  and off, Send as's default and the mode kept per site, the clean article's page, the badge mark, who gets no
  countdown, the queue, the omnibox's typed address `typedUrl`, and `textLinkItem` for text that may hold a link: the
  clipboard's, and through `typedLinkItem` the omnibox's); `core.js` sends with them (`labSendTab`: the capture through
  `clean-html.js`, Clean article through `prepareForReadability` and `Readability.js`, both files injected with `scripting.executeScript({files})` before
  the capture; `labSendSelection`; `normaliseShare` on every link and page address; `Sender.send(…, {defer})` offline,
  the `dls-offline` alarm and `flushNetwork`; the countdown, `scheduleSend` and `cancelScheduled`; Review's
  `lab/review`; the badge from the most recent row; menus, commands and the omnibox), and `lab.js` keeps the Use
  switches, the features' own settings, the timeline's data, Setup check, the activity log and diagnostics. Its
  messages: `labPopup`, `labTimeline`, `labSeen`, `labSetUse`, `labSetOption`, `labFeatureView`, `labChecks`,
  `labActivity`, `labDiagnostics`, `labTabInfo`, `labScheduleSend`, `labCancelScheduled`, `labHoldPdf`,
  `labSendCopied`, `labTestSend`, `labCheckAcks`, `labOnline`, `labReviewGet`, `labReviewSend`, `labReviewCancel`, `labOmnibox`, and
  `sendTab` with `mode` and `force`. The popup's pieces are `src/lab-popup.js` (DOM only, from data: the timeline's
  rows, the check-in header, the queue, Send as, the thin question, the F02 entry point, the card, Paste and send, the
  one-time note), so the web sender's build can copy it (B1); `src/review.html` with `src/review.js` is Review.
  `build.mjs` copies `clean-html.js` and `Readability.js` from `../share/js/capture/` into every Lab build (a build
  without Lab has neither), and the ext job runs `node ../share/js/capture/sync.mjs --check` on the copies; there is
  no copy of its own in `src/`. Tests: `test/unit/lab-send.test.mjs` (node, with the fake browser's stand-ins for the
  capture code: `executeScript({files})`, a page's `selection` and `article`) and `test/e2e/lab-w1.e2e.mjs`
  (Chromium, the real capture code and Readability: the one-time note; F03.1 and F03.2 on a page shown only with a
  login cookie; the timeline with a Lab Daylight and a v1.1 one; F02e.1 with a 14 MB PDF; Send as, Selection by
  itself, Send selection, Clean article, the share lane's `storm-warning-live` page with its Key points box kept, first,
  where Readability alone drops it, the thin question and the mode kept across a browser restart; Review of a 1 MB
  page within 1 s, and its result line offline; Send as excerpt with Send as's Use switch off; the card, Options and
  Comfort, and the card's popup asking for a PDF's site; offline with `context.setOffline`; Paste and send; the menu entries,
  commands and the omnibox; the Use switches and the features' settings; Setup check with the test article; axe,
  light and dark, Comfort, nothing clipped).
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
  `"w1"` since X1. `scripts/lab-wave.mjs` reads the wave from the code too, so a `lab-wave.json` left behind can't open
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

## Still to check on a device

For the W1 device round on the lab tablet **Rooted 2** (JP4R01422; LAB-PLAN 6.4), with the real ntfy.sh relay. CI
covers everything else above with the mock relay, Chromium and Daylights simulated in node; these need a real DC-1, a
real browser or a person. Nothing here is ever installed on JP4R03005. The Safari items wait until the gate opens W1
for the extension (its Safari build is the plain one until then).

- [ ] **F01.1** A link sent from Chrome (and from Safari on the Mac and on the iPhone) shows *In your Reader ✓* within
  45 s of *On your Daylight ✓*, with the popup open: Daylight Share in front; in the background with the Reader in
  front and "Display over other apps" on; the same with it off (*Waiting for a tap on your Daylight* until the notice is
  tapped, then *In your Reader ✓*); the screen off with Instant delivery on. Note the times in DEVICE-CHECKS.md.
- [ ] **F01.2** With Documents = Ask, a PDF reads *Waiting for a tap on your Daylight* (badge ⌛), then, after the
  tap, *Handed to the Reader* and *The Reader doesn’t confirm documents yet.* at the next check.
- [ ] **F01.3** The header reads *Your Daylight checked in N min ago*; with the Daylight off, sends still go out.
- [ ] **F03.1** A page that needs a login (a subscribed news site) arrives whole from Chrome and from Safari on the Mac
  and the iPhone, and the Reader shows the logged-in text.
- [ ] **F04** On Safari (Mac and iPhone; the background page is not persistent) the card's page still goes when the
  popup closes at once; Options stops it; with VoiceOver on and Comfort on, nothing goes before **Send** (one VoiceOver
  run, F04.5).
- [ ] **F07.1** Chrome on a laptop with Wi-Fi off, and Safari on the iPhone in flight mode: the share reads *Waiting
  for connection*; with the network back it goes within a minute while the browser runs (and on the iPhone, when iOS
  next lets the extension run).
- [ ] **F10.1, F10.4** Clean article on five real news sites keeps the body and drops navigation; Review renders a 1 MB
  page within 1 s on the lab iPhone (record its model in DEVICE-CHECKS.md).
- [ ] **F11.1, F11.4** A selection sent from the right-click menu (Chrome, Mac Safari) and from Selection mode (iPhone
  Safari) shows the quote, the source link and the date in the Reader; an excerpt of a page already in the Reader
  arrives as a new document.
- [ ] **F26.1** Setup check's test article reaches the Reader and ticks *✓ Delivered* and *✓ In your Reader*, in each
  condition of F01.1 (*Waiting for a tap on your Daylight* meanwhile where the Inbox asks).
- [ ] **F26.3** Each unmet check's button opens the right place: the shortcuts page (Chrome), site access (Allow,
  Safari), pairing. With the button unpinned, Chrome's *! Toolbar button* line has **Show steps**: following its words
  (*Click the puzzle piece in Chrome’s toolbar, then the pin next to Send to Daylight.*) on the real toolbar pins the
  button, and the line reads *✓ Toolbar button* when Setup check opens again.
- [ ] **F26, Safari's Site access** On the Mac and the iPhone: a fresh install reads *! Site access*; **Allow** shows
  Safari's own prompt, and its choice turns the line to *✓ Site access* (for every website) or leaves it (one site);
  the line follows what Safari › Settings › Extensions (iPhone: Settings › Apps › Safari › Extensions) says. Chrome
  shows no Site access line.
- [ ] **F04, a PDF on a site the extension may not read** With **Send when I click the toolbar button** on: a PDF whose
  in-tab read fails (Safari's PDF view; Chrome only for a PDF the page can't fetch) brings Chrome's or Safari's own
  prompt in the card's popup after the countdown, or **Allow and send** and **Send the link**; closing the popup at once
  sends its link with *Without access to the site the PDF can’t be downloaded, so its link was sent.*, also with the
  pairing page (`popup.html?standalone=1`) open in a tab, and nothing more goes 3 s after the popup asked (Chrome tells
  the toolbar's popup by `runtime.getContexts` with `contextTypes: ['POPUP']`, Safari by `extension.getViews` and the
  page's address `popup.html`: check both, and that Safari's toolbar popup on the Mac and the iPhone reports exactly
  that address).
- [ ] **F33** Chrome asks for the clipboard permission on the first **Paste and send**, and Safari shows its Paste
  button; the host shows before anything is sent.
- [ ] **F34.2** The four shortcuts at `chrome://extensions/shortcuts`; "dl example.com/story" in Chrome's address bar
  sends the link, and "dl see (https://en.wikipedia.org/wiki/Foo_(bar))." sends that Wikipedia address whole; right-click entries in Chrome and Mac Safari, and unticking one removes it.
- [ ] **F27.3** A VoiceOver run (Safari, Mac and iPhone) and a screen-reader run in Chrome of pair → send → delivered
  → in the Reader announce each state change, with no step count.

## Limits

- Re-sends and delivery checks run only while the browser runs (and on Safari for iPhone, when iOS lets the extension
  run). If the browser stays closed for more than the relay's 12 hours (3 hours for PDFs) while the Daylight is off,
  the item is sent again the next time the browser starts.
- Chrome's own pages (`chrome://…`) and other browser pages can't be sent. Local `file://` pages are sent as HTML
  files if *Allow access to file URLs* is on for the extension.
- The Safari build is tested here by running its background script against a fake `browser` API, not in Safari
  itself; the Mac/iPhone app's CI builds it into the app.
