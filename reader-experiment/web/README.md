# Send to Daylight: web sender

A single web page that sends links and files (PDF, EPUB, Word, Markdown, text, HTML; up to 9 MB) to your Daylight
DC-1. Nothing to install: it works in any modern browser, on a phone, a tablet or a computer someone else owns. It is
the fallback for devices without the app or the browser extension, and the target of the
[iPhone Shortcut](SHORTCUT.md).

**Address:** <https://12twelve12hi.github.io/MHW/send/> once GitHub Pages is switched on (below). It can also be hosted
anywhere: unzip `send-to-daylight-web.zip` from the
[latest builds](https://github.com/12twelve12hi/MHW/releases/tag/reader-experiment-latest) onto any static web host
(HTTPS needed for offline use and installing).

## Use

1. **Pair:** type the 28-character code from Daylight Share, or paste its pairing link. A link to the page with
   `#pair=<pairing link or code>` at the end pairs too: it asks first, on the page (*Pair with …? Code starts
   E4AY…*, and the relay when it isn't ntfy.sh; **Pair** or **Cancel**), unless it is the Daylight already paired,
   whose new relay or name then applies at once (*Pairing updated…*). A link or code for a **different** Daylight says
   that it replaces the current one (**Switch** or **Cancel**), and switching discards what the old one hasn't picked
   up yet. *Advanced: Relay URL* is only for your own ntfy server, with a typed code (a link carries its relay).
   **Settings › Change pairing…** takes a code again, with the relay in use filled in.
2. **Send a link:** paste or type it (`example.com/story` is fine) and tap **Send link**.
3. **Send a file:** tap **Choose a file** (or drop files on it on a computer). Files can be up to 9 MB; a larger one
   is refused before it is read (*Too big to send. Files can be up to 9 MB; this one is 14.2 MB.*); one shared to
   the installed app on Android isn't even copied. The free relay takes 2 MB per attachment, so larger files travel in
   pieces that fit.
4. The history uses the words of every Send to Daylight app: **Sent · waiting for your Daylight**, then
   **Delivered ✓** once the Daylight confirms it; **Waiting to send** with why (and **Retry now** when the relay
   couldn't be reached); **Not delivered** with why (and **Try again** where that can help). Every row has **Remove**.

**Settings** (top right, also before pairing) starts with **Lab** (below), then **Comfort**: *Larger text and buttons,
more contrast, no motion.* It is off by default; on, text is 125% larger, every button at least 48 px high, borders 2 px and muted text
full ink, transitions stop and titles wrap instead of ending in "…". It is part of the plain page, not Lab
(`settings.comfort` in IndexedDB), and pairing, unpairing and Lab leave it as it is. The rest of the accessibility
baseline holds with Comfort off too: every control has a name, states are said in words and glyphs, status text wraps
(also at 200% zoom), a history row that turns *Delivered ✓*, *Waiting to send* or *Not delivered* is announced to
screen readers, and the typed-code pairing form is always one tap away.

Links into the page can carry what to send, for Shortcuts, bookmarklets and other apps:

| Address | Effect |
|---|---|
| `…/send/?url=<address>&title=<title>` | fills in the link and title |
| `…/send/?text=<text with an address>` | finds the address in the text (the rest becomes the title) |
| add `&autosend=1` | sends at once (the page is cleared so a reload doesn't send again) |
| `…/send/#autosend=1&pair=<pairing link>&url=<address>` | the same in the fragment, which never reaches the server; pairs first if needed. This is what the Shortcut uses (Settings > *Copy*). |

**Android:** open the page in Chrome, then menu > **Add to Home screen** / **Install app**. **Send to Daylight** then
appears in the share sheet for links and files (Web Share Target; files go through the page's service worker).

**iPhone:** see [SHORTCUT.md](SHORTCUT.md) to add **Send to Daylight** to the share sheet.

## Lab

New features are tried out behind one **Lab** switch, the first row of Settings (LAB-PLAN 1). It is **on** by default;
turn it off for the plain page (*New features we’re trying out. Turn Lab off for the plain app; nothing you sent is
lost.*). Turning it off hides every Lab control and stops Lab's work (no Daylight server is looked for or asked); it
keeps the pairing, the outbox, the history and the Daylight server's settings, and an item already on its way still
goes. The switch belongs to this browser (`settings.lab` in IndexedDB, never in a pairing link or the Shortcut link):
pairing, unpairing and renaming leave it as it is, and every open tab follows it.

While Lab is on, two rows under the switch open:

- **What’s in Lab ›**: the features this page has, each with a short state ("Ready", "Not set up", "In a later
  update", …). The states of the server's last answer show at once when it is 10 minutes old or less (otherwise the
  heading says *Checking your Daylight server…*), and the server is asked again as the list opens. The header line
  says whether your Daylight has confirmed Lab ("Your Daylight: Lab on · checked in 4 min ago"), from what it says on
  its confirmation channel; opening the list reads that channel once, and an item it confirms shows *Delivered ✓* in
  the history at once. The list holds this page's Wave 1 features (Delivery timeline, Works offline, Shortcuts and
  automation, Clean links, Setup check, Send copied link; below), then, under *With your Daylight server (optional)*,
  the features that run on your own **Daylight server** (Files over 9 MB, Summaries with Claude, Email-in address,
  Feeds and daily digest). They are always shown and never greyed out: tapping one that isn't ready shows one sentence
  under it, saying what's missing (*Pair with your Daylight first…*, *Your Daylight hasn’t confirmed Lab yet…*,
  *Needs your Daylight server…*), with at most one button that fixes it from here (**Copy Server code**) and **OK**.
  Screen readers hear it. A ready server answers "comes to this app in a later Lab update" until the feature is built
  here. Tapping a ready **Setup check** or **Shortcuts and automation** opens it. **Clean links** and **Send copied
  link** have a **Use** switch (on by default, LAB-DECISIONS Q5), each with what turning it off does; the one Lab
  switch still turns everything off.
- **Daylight server ›** (*Optional · Not set up*): where setup happens. It shows the server's state in full (with the
  exact GitHub secret names), the server's address and fingerprint, the **Server code** with **Copy** (the
  `daylightserver://` link form when the pairing's relay isn't ntfy.sh), when the Daylight last said hello to the
  server, today's AI spend, **Set up with a link**, the optional **Server address** field and how to re-run the
  deploy. See [`../server/README.md`](../server/README.md) to turn the server on.
  - **Set up with a link** takes the one-time setup link the deploy makes (`https://daylight-….workers.dev/setup#SETUP-…`;
    server DESIGN 3.5). It comes right after the state while that state says to paste one, else last. The link is read
    here first: anything else (the Server code, the pairing code, another address) says why and sends nothing. Then
    *Use this Daylight server?* names the link's address, and only **Use it** sends the server this pairing's Server
    code (*Setting up…*); the section then reads the server again. Your other devices and your Daylight find it on
    their own.
  - **The server moved.** When your server announces itself at a new address (a deploy with *New setup link* makes a
    new Worker and deletes the old one), the section asks *Your Daylight server moved to {host}. Use it?*. Until you
    answer, it keeps using the address you had. **Use it** switches to the new one; **Cancel** changes nothing, and
    the question comes back the next time the section opens. Opening the section or What’s in Lab reads the server's
    announcements again, however recently they were read (otherwise they are kept for 6 hours), so the question comes
    at once. When a server feature is tapped and the server found from those kept announcements fails (gone,
    unreachable, or not recognising this pairing), they are read again then too; a server that keeps saying it
    doesn't recognise the pairing costs one such read, not one per tap.

The page calls your Daylight server itself (the server answers any web page, with its bearer token, never a cookie:
server DESIGN 10.2), so unlike the extension it asks no site permission. A server answer is used for 10 minutes; a
server that doesn't answer within 5 seconds reads as *Couldn’t reach the Daylight server*. Before this browser is
paired with another Daylight, a server that knows the old pairing is locked (Lab on or off), so a lost or replaced
pairing can't use it, and a typed Server address (the old server's) is forgotten. **Unpair** forgets a typed Server
address too (it locks nothing: the same Daylight may come back). Afterwards, while Lab is on, the sending screen shows the locked text with the new **Server code**, **Copy** and how to re-run the deploy, under
*Daylight server*, until **OK** (or until the new server answers).

**The section's words** are all `LAB_TEXT.serverSection`'s (LAB-PLAN 2.6, "The rest of the server section's copy"),
drawn by the extension's `lab-ui.js`: while the server is not set up, **Turn it on** with the five steps, numbered (step
2 is the server module's re-run help, word for word), and where every step is; **Your server** with
`hostLineText(origin, fingerprint)` ("daylight-….workers.dev · 3f9a-1c2e", a port kept as the move question keeps it);
**Delivery** with the Lab or v1 line, then the v1 notice; the Server address field's `https://` placeholder, **Save** and
footer. The server-moved question uses the setup confirmation's **Use it** and **Cancel**, which answer it word for
word.

### Lab's Wave 1 (card B1)

With Lab on, the page also has (LAB-PLAN 3.3; every word is `LAB_TEXT`'s, drawn by the extension's `lab-popup.js`, so
the page says what the popup says):

- **The one-time note** (1.2): *Lab is on. New features to try are in Settings › Lab, where you can turn it off.*, over
  the pairing and sending screens, once, with **OK**.
- **Delivery timeline** (F01). Each row reads where the item is: *Sent · waiting for your Daylight*, *On your Daylight
  ✓*, *Waiting for a tap on your Daylight*, *Handed to the Reader*, *In your Reader ✓*, … The sentence and the step line
  (*Sent ✓ · On your Daylight ✓ · In the Reader …*) show on the newest row and on rows that aren't settled; a settled
  row's title opens them. Screen readers hear "{label}. {sentence}", never the step line, and a row whose label changes
  is announced. Above the history: *Your Daylight checked in 4 min ago.* A Daylight without Lab gives exactly the plain
  rows (*Delivered ✓*). While a row delivered in the last 10 minutes has no settled state and the page is on screen, it
  reads the confirmation channel every 30 s; the minute's check reads it too while a row of the last 48 hours waits for
  its state. Only while the page is open: a web page has no background.
- **Works offline** (F07). Sent while the browser is offline, an item waits (*Waiting for connection*) in **Waiting to
  send (n)** above the history, each with **Cancel**. Back online, the page sends them by itself (the `online` event,
  and its minute's check), oldest first, at most 30 messages and 18 MB a pass, passes 3 minutes apart (`lab/flushAt`,
  shared by every tab). Where the browser has Background Sync (Chromium), the page asks for `dls-flush` when it queues
  one, and the service worker (`sw-sync.js`, bundled into `sw-lab.js`) sends them once the browser is online again,
  even with the page closed; elsewhere they go the next time the page opens online. A relay that fails while the
  browser is online is the plain page's *Waiting to send* with its own back-off and **Retry now**, in the same queue.
  With Lab off, rows already waiting go with the plain page's back-off (LAB-PLAN 1.3).
- **Clean links** (F16). Every link the page sends (typed, from the address, the Shortcut, the share sheet, the
  bookmarklet or Paste and send) goes through `normaliseShare`: redirect wrappers (Google AMP, Facebook, LinkedIn, …)
  unwrapped, tracking parameters (`utm_*`, `fbclid`, …) removed, a headline + link share kept as a link with the
  headline as its title; the link as shared goes along as `x-orig`. With its **Use** switch off, links go exactly as
  shared.
- **Send copied link** (F33): **Paste and send** under **Send link** reads the clipboard only when clicked (the browser
  asks the first time), then asks *Send {host}?* (**Send**, **Cancel**), or says *No link on the clipboard.* Gone with
  its **Use** switch off.
- **Shortcuts and automation** (F09): What's in Lab › Shortcuts and automation gives a **bookmarklet**: drag *Send to
  Daylight* to the bookmarks bar, or **Copy** it. On any page it opens this page with that page's address and title
  (`#autosend=1&url=…&title=…`, in the fragment, which never reaches a server), and the page sends it; the pairing stays
  in this browser. Clicking it on this page copies it. `?url=…&autosend=1` and the fragment forms work as before.
- **Setup check** (F26), What's in Lab › Setup check: ✓ or ! for the pairing (**Open setting**: the pairing form),
  *Installed as an app* (**Open setting** when the browser has offered to install the page: its own prompt, which the
  page keeps without cancelling it, so Chrome's own install banner still shows as in v1.1) and
  *Storage kept by the browser* (**Allow** asks the browser to keep this page's storage); **Send a test article** (a
  page of about 400 words at `https://daylight.invalid/test/…`, `x-cap: "test"`), followed until *✓ Delivered* and *✓
  In your Reader* (or *Waiting for a tap on your Daylight* meanwhile; the page reads the confirmation channel every
  10 s while it waits); the **Activity log** (the last 200 events, without titles or addresses) and **Copy
  diagnostics** (redacted: no address, title, code or topic).
- **Files over 9 MB ›** (the F02 entry point): under *Too big to send. Files can be up to 9 MB; …*, it runs the
  big-files feature's gate: *Needs your Daylight server …* with **Copy Server code** until there is one, then *comes to
  this app in a later Lab update*.

Settings (`settings` in IndexedDB, kept when Lab or a Use switch is off): `labUse` (the Use switches, `{F16, F33}`;
missing means on) and `labNoteShown`. Lab's own keys (`lab/activity`, `lab/testId`, `lab/flushAt`) go with a pairing
change, like the ledger.

**Not in `LAB_TEXT` yet** (asked of the share lane; the page shows no words of its own meanwhile):

- **The bookmarklet's instruction.** F09's view shows the feature's name and sentence, the link named *Send to
  Daylight* (`LAB_TEXT.appName.web`) and **Copy**, but no line telling you to drag the link to the bookmarks bar (or,
  on the iPhone, to save a bookmark and paste the copied text as its address).
- **Steps for Setup check's two web checks.** `LAB_TEXT.setup.steps` has steps for the share sheet, the Safari
  extension and the Share menu only. Where the browser offers no install prompt (Safari, Firefox) *Installed as an app*
  has no button, and where it can't ask to keep storage *Storage kept by the browser* has none either, so F26.3 (a
  button for each unmet check) holds only in Chromium until `setup.steps.installed` and `setup.steps.storage` exist
  (shown under **Show steps**, as the other apps' steps are).

**Test hook** (LAB-PLAN 1.7): `?lab=0` or `?lab=1` in the address sets the switch, only when the page is served from
`127.0.0.1` (the tests' server, or `node build.mjs --serve`); the page then takes it out of the address.

## How it works

`index.html`, `app.js`, `styles.css`, `web-logic.js`, `web-storage.js`, `web-lab.js`, `web-lab-page.js`, `sw.js` and
`manifest.webmanifest` are the page, with `web-flush.js` (F07's offline passes, shared by the page and the service
worker) and `sw-sync.js` (Background Sync, which `build.mjs` bundles with its imports into the classic `sw-lab.js` that
`sw.js` loads); `build.mjs` copies in the protocol library
([`../share/js/daylight-share.js`](../share/js/daylight-share.js)), the Lab module
([`../share/js/daylight-lab.js`](../share/js/daylight-lab.js)), the Daylight server's client module
([`../server/client/daylight-server.js`](../server/client/daylight-server.js), with its import pointed at the copy
next to it), the status helpers (`../extension/src/logic.js`) and the Lab screens' parts
(`../extension/src/lab-ui.js`, and from Wave 1 `lab-popup.js` and `lab-send.js`: the timeline's rows, the queue, Paste
and send and the F02 entry point, as the popup draws them), so each has one source, and stamps the service worker with
a hash of the site.

Lab (card B0, Wave 0): `web-lab.js` is the data, with no page code (`createWebLab`): the switch (`settings.lab`;
missing means on, and the first start writes `true`), the sender ledger (`daylight-lab.js` `LabLedger`, fed by every
frame on the Daylight's confirmation topic through the Sender's `onAckHeader`, Lab on or off, and pruned to the outbox
after each check), the gates (`labGate` with its 5 s deadline), the Daylight server (`DaylightServer`; discovery only
with Lab on; forced when Lab settings open, and once more when a server found from the cached config fails; the move
question from `server/pendingMove`, `confirmMove` on Use it), What's in Lab's cached states (`lab/server` and the
module's `server/status`, 10 minutes; an answer that comes after the pairing or the server changed is not kept), the lock before re-pairing (then `lab/repaired` until OK or a ready server) and
Unpair's `beforeUnpair` (a typed Server address goes with the pairing). `web-lab-page.js` draws
Settings' Lab rows, What's in Lab, the server section and the follow-up with `lab-ui.js`, the same parts as the
extension's `lab.html`. Every word is `LAB_TEXT`'s or the server module's. `LAB_FEATURES`, `LAB_SERVER_FEATURES` and
`BUILT_FEATURES` in `web-lab.js` say what this page lists and runs; `LAB_NOTE_ENABLED` is `true` from this build, which
has the delivery timeline (B1). Wave 1 (card B1) adds to `web-lab.js` the Use switches (`setUse`), the timeline's data
(`timeline`, `page`), smart intake for every link (`labLinkItem`, `copiedLink`), the bookmarklet (`bookmarklet`), Setup
check (`checks`, the test article, the activity log and `diagnostics`); `web-flush.js` holds F07's rule
(`WebSender.holdNetwork`: while Lab is on, a row waiting for a connection is never due in the plain re-send pass, which
has no caps) and its capped pass (`flushPass`, `Sender.flushNetwork`). The pairing and the outbox live in this
browser's IndexedDB (localStorage if that is unavailable). Items are end-to-end encrypted in the page before they leave
it; the relay (ntfy.sh by default) sees only scrambled data.

The page checks for the Daylight's confirmations when it opens, every minute while open, and shortly after each send,
and re-sends anything unconfirmed that the relay may have dropped. An item still undelivered after a week shows *Not
delivered* with **Try again**; its copy is kept for that until two weeks after the share, and a confirmation that
arrives within about two weeks still makes it *Delivered ✓*. With nothing waiting or still to be confirmed, the page
doesn't contact the relay. It can't do that while closed: open it now and then
if the Daylight was off for a long time (or use the app or extension, which check in the background).

The service worker caches the page so it opens offline; sends made offline show *Waiting to send* and go out with
**Retry now** or the next time the page opens online (with Lab on: *Waiting for connection*, and they go by themselves,
above).

**Privacy note for github.io hosting:** every GitHub Pages site of the same account shares one browser origin
(`12twelve12hi.github.io`), so another page on it could read this page's storage, pairing included. Host the zip on its
own domain if that matters to you.

```sh
cd reader-experiment/web
node build.mjs --serve 8080    # builds dist/site and dist/send-to-daylight-web.zip, then serves http://127.0.0.1:8080/
```

Tests live with the extension's (`../extension/test/unit/web-logic.test.mjs`, `../extension/test/e2e/web.e2e.mjs`,
the accessibility checks in `../extension/test/e2e/a11y.e2e.mjs`: axe-core, nothing clipped at 360 px with Comfort
on, status text at 200%); see [the extension README](../extension/README.md#build-and-test). Lab's are
`../extension/test/unit/web-lab.test.mjs` (node: `web-lab.js` against the mock relay, a stand-in Daylight server and
Lab Daylights from `daylight-lab.js`; the build; the release gate), `../extension/test/e2e/web-lab.e2e.mjs`
(Chromium: Settings' Lab rows, What's in Lab with its cached states, the server section with the move question, the
follow-up and Unpair, with Lab on and off, the stand-in server behind the server's own CORS answer; the one-time note;
the F02 entry point), `../extension/test/e2e/web-lab-a11y.e2e.mjs` (axe-core with Lab on and
off, light and dark, Comfort off and on; nothing clipped at 360 px; notes at 200%; Wave 1's screens too; screenshots in
`test-results/web-lab`) and the Lab-off parity test `../extension/test/e2e/web-lab-off-parity.e2e.mjs` with its
baselines `../extension/test/e2e/lab-off-baseline/web-*.yml` (re-recorded only with a non-Lab change). Wave 1's are
`../extension/test/unit/web-lab-w1.test.mjs` (node: smart intake against the `normalise.json` vectors, Paste and
send's reading, the bookmarklet run and read back, the Use switches, the timeline's data, F07's passes against the mock
relay with ntfy.sh's limits (70 links in three passes with no 429, 18 MB of attachments a pass), Background Sync's run
and the bundled `sw-lab.js`, Setup check, the activity log and redacted diagnostics) and
`../extension/test/e2e/web-lab-w1.e2e.mjs` (Chromium, with Lab Daylights from `daylight-lab.js`: the timeline's rows
and announcements, offline and back online, Background Sync with the page closed (dispatched through DevTools), clean
links, Paste and send, the bookmarklet run on another page, Setup check's test article, and Lab off). The plain page's
flows (`web.e2e.mjs`) run with Lab off, and again with Lab on (`web-lab-on.e2e.mjs`).

**Lab release gate** (LAB-PLAN 6.2): a web Lab build waits for the iPhone and Mac builds of its wave before it reaches
the release or Pages. `lab-wave.json` names the Lab wave of this folder's code (`w0` from B0, `w1` from B1), and
`scripts/lab-wave.mjs` reads it from the code too (this folder's page files and the extension files the build copies
in), so a `lab-wave.json` left behind can't let a later wave through: `node scripts/lab-wave.mjs` prints the wave the
build is held for (the later of the two), `--check` fails when `lab-wave.json` is behind this folder's own code (the
copied extension code holds the build without failing it: only this lane edits `lab-wave.json`), and it exits 2 when
it can't tell (then nothing is published). While `../lab-release-gate.json` has that wave `false`, CI builds and tests the page but
uploads neither `send-to-daylight-web.zip` nor the Pages site, and its log says why.

## GitHub Pages

The workflow [`rx-extension.yml`](../../.github/workflows/rx-extension.yml) deploys the web sender to Pages at
`/send/`, next to the highlights prototype at the root (both workflows deploy the same Pages site; this one includes
the latest highlights prototype so it doesn't remove it). Until Pages is on, that job fails without failing the run.
To switch it on:

1. **Settings > Pages > Build and deployment > Source: GitHub Actions.**
2. If the deploy job then says the branch "is not allowed to deploy to github-pages": **Settings > Environments >
   github-pages > Deployment branches and tags**, add `claude/sweet-goldberg-ej1nb0` (the environment allows only the
   default branch at first).
3. Re-run the *Reader experiment - extension and web sender* workflow (Actions tab > Run workflow). The sender is then
   at <https://12twelve12hi.github.io/MHW/send/>.

The highlights prototype's own workflow deploys only `highlights-prototype/www`, so a later run of it replaces the
site and `/send/` disappears until this workflow runs again.

## Still to check on a device

For the W1 device round on the lab tablet **Rooted 2** (JP4R01422; LAB-PLAN 6.4), with the real ntfy.sh relay. CI
covers everything else above with the mock relay, Chromium and Daylights simulated in node; these need a real DC-1, a
real phone or browser, or a person. Nothing here is ever installed on JP4R03005. The page reaches Pages and the release
only once the gate opens W1 for it, so until then use `node build.mjs --serve` or the CI artifact
`send-to-daylight-web-site` on any HTTPS host.

- [ ] **F01.1** A link sent from the page (Chrome on a laptop, Safari on the iPhone, Chrome on Android) shows *In your
  Reader ✓* within 45 s of *On your Daylight ✓* while the page stays open: Daylight Share in front; in the background
  with the Reader in front and "Display over other apps" on; the same with it off (*Waiting for a tap on your Daylight*
  until the notice is tapped, then *In your Reader ✓*); the screen off with Instant delivery on. Note the times in
  DEVICE-CHECKS.md.
- [ ] **F01.2** With Documents = Ask, a PDF reads *Waiting for a tap on your Daylight*, then, after the tap, *Handed to
  the Reader* and *The Reader doesn’t confirm documents yet.* at the next check.
- [ ] **F01.3** The header reads *Your Daylight checked in N min ago*; with the Daylight off, sends still go out.
- [ ] **F01.6** VoiceOver (iPhone Safari) and TalkBack (Android Chrome) read each history row as *{label}. {sentence}*,
  never the step line, and a row whose label changes (*On your Daylight ✓* → *In your Reader ✓*) is announced.
- [ ] **F07.1** Flight mode on the iPhone and on Android, Wi-Fi off on the laptop: a send reads *Waiting for
  connection* in **Waiting to send (1)**; with the network back it goes within a minute while the page is open. On
  Android Chrome (the page installed or not), close the page while it waits and turn the network back on: Chrome's own
  Background Sync sends it (CI fires `dls-flush` through DevTools; a real device decides when), and the next open shows
  it sent. Safari has no Background Sync: there it goes the next time the page opens online.
- [ ] **F09** The bookmarklet dragged to the bookmarks bar in Chrome, Firefox and Safari on a computer, and saved as a
  bookmark whose address is edited to the copied `javascript:` text on the iPhone: on a news page it opens the web
  sender, which sends that page with its title, and a reload doesn't send it again.
- [ ] **F16** Android's share sheet into the installed page with Chrome's "Title\nURL" share and a newsletter link
  carrying `utm_*`: it arrives as a link with the headline as its title and the tracking gone.
- [ ] **F26.1** Setup check's test article reaches the Reader and ticks *✓ Delivered* and *✓ In your Reader*, in each
  condition of F01.1 (*Waiting for a tap on your Daylight* meanwhile where the Inbox asks).
- [ ] **F26.3** Each unmet check's button does what it says: **Open setting** for *Installed as an app* opens the
  browser's install prompt on Android Chrome and desktop Chrome (none where the browser offers no prompt, as on the
  iPhone, where the line stays *!* until the page is added to the Home Screen and opened from there); **Allow** for
  *Storage kept by the browser* gets a ✓ where the browser grants it (Chrome grants an installed or bookmarked page;
  Safari and Firefox decide for themselves).
- [ ] **F26 install banner** Android Chrome, Lab on and the page not installed: Chrome's own *Add to Home screen*
  banner (or menu item) still appears as with Lab off, and **Open setting** in Setup check opens the same install
  prompt, also after the banner was dismissed.
- [ ] **F33** **Paste and send** on the iPhone (Safari shows its Paste callout first), Safari on the Mac, Android Chrome
  and Firefox on a computer: a copied link asks *Send {host}?* before anything goes; copied text without a link says *No link on the
  clipboard.*
