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
  the history at once. In this first Lab
  build (Wave 0) the list holds only the features that run on your own **Daylight server** (Files over 9 MB,
  Summaries with Claude, Email-in address, Feeds and daily digest). They are always shown and never greyed out:
  tapping one that isn't set up shows one sentence under it, saying what's missing, with at most one button that fixes
  it from here (**Copy Server code**) and **OK**. Screen readers hear it. A ready server answers "comes to this app in
  a later Lab update" until the feature is built here.
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

**Test hook** (LAB-PLAN 1.7): `?lab=0` or `?lab=1` in the address sets the switch, only when the page is served from
`127.0.0.1` (the tests' server, or `node build.mjs --serve`); the page then takes it out of the address.

## How it works

`index.html`, `app.js`, `styles.css`, `web-logic.js`, `web-storage.js`, `web-lab.js`, `web-lab-page.js`, `sw.js` and
`manifest.webmanifest` are the page; `build.mjs` copies in the protocol library
([`../share/js/daylight-share.js`](../share/js/daylight-share.js)), the Lab module
([`../share/js/daylight-lab.js`](../share/js/daylight-lab.js)), the Daylight server's client module
([`../server/client/daylight-server.js`](../server/client/daylight-server.js), with its import pointed at the copy
next to it), the status helpers (`../extension/src/logic.js`) and the Lab screens' parts
(`../extension/src/lab-ui.js`), so each has one source, and stamps the service worker with a hash of the site.

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
`BUILT_FEATURES` in `web-lab.js` say what this page lists and runs; `LAB_NOTE_ENABLED` is `false` until a build has the
delivery timeline (B1). The pairing and the outbox live in this browser's IndexedDB (localStorage if that is unavailable). Items are
end-to-end encrypted in the page before they leave it; the relay (ntfy.sh by default) sees only scrambled data.

The page checks for the Daylight's confirmations when it opens, every minute while open, and shortly after each send,
and re-sends anything unconfirmed that the relay may have dropped. An item still undelivered after a week shows *Not
delivered* with **Try again**; its copy is kept for that until two weeks after the share, and a confirmation that
arrives within about two weeks still makes it *Delivered ✓*. With nothing waiting or still to be confirmed, the page
doesn't contact the relay. It can't do that while closed: open it now and then
if the Daylight was off for a long time (or use the app or extension, which check in the background).

The service worker caches the page so it opens offline; sends made offline show *Waiting to send* and go out with
**Retry now** or the next time the page opens online.

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
follow-up and Unpair, with Lab on and off, the stand-in server behind the server's own CORS answer), `../extension/test/e2e/web-lab-a11y.e2e.mjs` (axe-core with Lab on and
off, light and dark, Comfort off and on; nothing clipped at 360 px; notes at 200%; screenshots in
`test-results/web-lab`) and the Lab-off parity test `../extension/test/e2e/web-lab-off-parity.e2e.mjs` with its
baselines `../extension/test/e2e/lab-off-baseline/web-*.yml` (re-recorded only with a non-Lab change).

**Lab release gate** (LAB-PLAN 6.2): a web Lab build waits for the iPhone and Mac builds of its wave before it reaches
the release or Pages. `lab-wave.json` names the Lab wave of this folder's code (`w0` from B0), and
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
