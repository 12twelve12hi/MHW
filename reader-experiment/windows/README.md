# Send to Daylight for Windows

A small app in the notification area (the system tray) that sends files and web links from a Windows PC to your
Daylight DC-1, where they land in the Daylight Reader. Three ways to send: drop things on its window, right-click
files in File Explorer and choose **Send to › Daylight**, or copy a link and press **Ctrl + Alt + D** anywhere.

It speaks the same end-to-end encrypted protocol as the other Send to Daylight apps
([`../share/PROTOCOL.md`](../share/PROTOCOL.md)); the protocol code is
[`../share/js/daylight-share.js`](../share/js/daylight-share.js) itself, copied in when the app is built.

## Install

1. Download **`Send-to-Daylight-windows-setup.exe`** from the
   [latest builds](https://github.com/12twelve12hi/MHW/releases/tag/reader-experiment-latest).
2. Run it. The build isn't signed yet, so Windows SmartScreen says *Windows protected your PC*: click
   **More info**, then **Run anyway**. (Your browser may also ask whether to keep the download: choose **Keep**.)
3. It installs for your Windows account only, without asking for an administrator, into
   `%LOCALAPPDATA%\Send to Daylight`, and adds a Start menu entry and **Send to › Daylight** in File Explorer.

The app opens and its icon (a small sun over a horizon) appears in the notification area at the right of the taskbar;
it may be under the **^** arrow. Drag it next to the clock to keep it in sight.

Windows 10 and 11 (64-bit). It uses the Microsoft Edge WebView2 runtime that comes with Windows; on an old Windows 10
without it, the installer downloads it.

## Pair with your Daylight

On the Daylight, open **Daylight Share** and choose **This is my Daylight**. It shows a QR code and a 28-character
pairing code. Then either:

- **type the code** into the app's window and click **Pair** (dashes, spaces and lower case are fine), or
- **open the pairing link** on the PC: a `daylightshare://pair?…` link opens Send to Daylight (when the browser asks,
  allow it to open *Send to Daylight*), which asks first: *Pair with &lt;name&gt;? Code starts E4AY. Check it matches
  the code on your Daylight.*, plus the relay when it isn't ntfy.sh. Check that the first four characters match the
  code on your Daylight's screen, then click **Pair**. A link can come from anywhere, and its name proves nothing, so
  nothing is paired until you do.

The window then says *Sending to &lt;your Daylight's name&gt;*. **Advanced › Relay URL** is only for a Daylight that uses
its own ntfy server (a pairing link already includes it).

Opening your Daylight's link again, after you renamed it or moved it to another relay, applies at once (*Pairing
updated: now sending through …*), and anything not yet delivered goes through the new relay. A link for a **different**
Daylight asks first and says that it replaces the current one (the button reads **Switch**); switching, or **⋯ › Settings
› Unpair this PC**, discards anything the old Daylight hasn't picked up yet. To type a code while paired, use **⋯ ›
Settings › Change pairing…**: the same Daylight's code applies at once, another Daylight's asks first, as a link does.

## Send

- **Drag and drop** files (PDF, EPUB, Word, text, Markdown, HTML…) or a link (from the browser's address bar or a
  page) onto the window. **Choose files…** does the same from a file dialog, and works from the keyboard.
- **File Explorer:** select one or more files, right-click, **Send to › Daylight** (on Windows 11: **Show more
  options** first, or Shift + right-click). A notification names the file and says how it went (*Sent · waiting for
  your Daylight.*), or why it couldn't be sent. The app needn't be open;
  it starts if it isn't running. Internet shortcuts (`.url` files) send their web address.
- **The clipboard's link:** copy a web address anywhere and press **Ctrl + Alt + D**. A notification names the site
  and says how it went, or that there was no link to send. The tray menu's **Send clipboard link** and the button in the
  window do the same. Change or turn off the hotkey in **⋯ › Settings** (click **Change…**, then press the new
  combination; it needs Ctrl, Alt or Win). With Lab on (below) the command is called **Send copied link**, and the
  window's button shows the site first, with **Send**.

**Sizes:** files can be up to 9 MB. The free relay (ntfy.sh) takes attachments of up to 2 MB, so larger files travel in
pieces that fit, and it holds about 20 MB per sender at a time, so after a burst of big files the rest waits a few
hours (the history says so). These rules come with the protocol library; a bigger file is refused at once, with its
size.

## History and retries

The window lists what you sent, newest first, in the same words as the other Send to Daylight apps:

- **Sent · waiting for your Daylight**: on its way; the Daylight hasn't picked it up yet (it may be asleep).
- **Delivered ✓**: the Daylight confirmed it.
- **Waiting to send**, with why: the relay couldn't be reached or is busy and it tries again by itself (**Retry now**
  to try at once), or the relay is full or turned the item down and it tries again in about 3 hours.
- **Not delivered**, with why, and **Try again** where trying again can help: for example the Daylight didn't pick it
  up within a week.

Every row has **Remove**, which drops it and the copy kept for re-sending. The labels, sentences and buttons come from
the protocol library (Daylight Share protocol 1.1, `describeRow`), so every Send to Daylight app says the same.

While the app runs (in the notification area is enough) it checks for the Daylight's confirmations when it starts,
right after each send and again about 30 seconds later, every 15 minutes, and when you open the window; and it
re-sends anything not yet confirmed before the relay forgets it (ntfy.sh keeps messages 12 hours and files 3 hours),
for up to a week. An item still undelivered then shows *Not delivered* with **Try again**; its copy is kept for that
until two weeks after the share, and a confirmation that arrives within about two weeks (the Daylight picked up the
last re-send late) still makes it *Delivered ✓*. With nothing waiting or still to be confirmed, the app doesn't contact
the relay. The history and the copies kept for re-sending survive restarts. Each is written so that a crash or
a power cut leaves the old version or the new one; if a file is damaged all the same, the app sets it aside (renamed
to `….json.bad`), says so in the window, and carries on.

Closing the window keeps the app running in the notification area. Left-click the icon to open the window; right-click
it for **Send clipboard link**, **Open**, **Start at login** and **Quit**. Esc hides the window.

## Start at login

Off by default. Turn it on in the tray menu (**Start at login**) or in **⋯ › Settings**. It then starts quietly in the
notification area when you sign in to Windows, so re-sends and the hotkey keep working. (It adds an entry under
*Settings › Apps › Startup*, where you can also turn it off.) It stays on after an update (see below).

## Comfort and accessibility

**⋯ › Settings › Comfort** makes text and buttons larger, raises the contrast and turns off motion. It is off by
default, and it is there before pairing too (the **⋯** button on the pairing screen). Pairing, switching to another
Daylight and unpairing leave it as it is.

With or without Comfort:

- every control has a name a screen reader (Narrator, NVDA, JAWS) reads out;
- when an item in the history turns **Delivered ✓**, **Waiting to send** or **Not delivered**, a screen reader says so
  (*Delivered ✓: &lt;title&gt;*) without moving the focus; a send's own outcome is read from the line under the buttons;
- states are written out in words (and ✓), never shown by colour alone;
- status lines wrap instead of being cut off, also at the narrowest window and at twice the text size (Windows'
  *Settings › Accessibility › Text size*); with Comfort, titles wrap too instead of ending in "…", and nothing is cut
  off up to Windows' largest text size (225%): the pairing code and relay fields grow to show all you typed, a
  Daylight's name wraps even when it has no spaces (as in the *Pair with …?* question), and side-by-side buttons go
  one under the other when their words no longer fit;
- the pairing code can always be typed (no QR code needed), also while paired (**Change pairing…**).

## Lab

New features are tried out behind one **Lab** switch, the first row of **⋯ › Settings** (LAB-PLAN 1). It is **on** by
default, also after an update from a build without Lab; turn it off for the plain app (*New features we’re trying out.
Turn Lab off for the plain app; nothing you sent is lost.*). Off, the window is exactly the plain app's but for the
switch and that line: it keeps the pairing, the history, the items still waiting to go and the Daylight server's
settings, and an item already on its way still goes. The switch belongs to this PC: pairing, unpairing and re-pairing
leave it as it is.

While Lab is on, two rows under the switch open Lab's screens (**Back** or Esc returns to Settings):

- **What’s in Lab ›**: the features this build has, each with a short state ("Ready", "Pair first", "Needs Lab on your
  Daylight", "Not set up", "In a later update", …): **Delivery timeline**, **Works offline**, **Shortcuts and
  automation**, **Clean links**, **Setup check** and **Send copied link** (Wave 1, below), then, under *With your
  Daylight server (optional)*, the one feature of your own **Daylight server** that comes to Windows, **Files over 9
  MB** (the other server features, Summaries with Claude, Email-in and Feeds, are for the phone and browser apps). The
  header line says whether your Daylight has confirmed Lab ("Your Daylight: Lab on · checked in 4 min ago", or "Needs
  Lab on your Daylight · checked in …"), from what Daylight Share on it says on its confirmation channel. The screen
  shows the server's last states at once when they are 10 minutes old or less (else *Checking your Daylight server…*),
  then reads that channel and asks the server, both at once, and updates the lines in place. Every feature is always
  shown and never greyed out: clicking one when something is missing shows one sentence under it, saying what (with
  **Copy Server code** when there is no server yet) and **OK**; screen readers say it. A ready feature opens (Setup
  check) or moves the focus to its switch. A ready server answers "comes to this app in a later Lab update" for Files
  over 9 MB until it is built here (Wave S).
  - **Use** switches (LAB-PLAN 6.5 Q5), on by default, on the two features that change how sending behaves: **Clean
    links** (*When it’s off, links go exactly as they were shared, tracking and all.*) and **Send copied link** (*When
    it’s off, the app doesn’t offer to send a link you copied.*: the clipboard command is the plain app's again). The
    one Lab switch still turns all of Lab off.
  - **Allow quick sends from other apps** (under Shortcuts and automation; off by default): *Lets Shortcuts, scripts
    and other apps send without asking. Any app or web page could then send to your Daylight.*
- **Daylight server ›** (*Optional · Not set up*): where setup happens. It shows the server's state in full (with the
  exact GitHub secret names); while the server isn't set up, **Turn it on** with the five steps, numbered, and where
  every step is explained; **Your server** (its address and fingerprint, *daylight-….workers.dev · 3f9a-1c2e*);
  **Delivery** (*Through Lab on your Daylight, end-to-end encrypted*, or *Through your pairing (v1 delivery)* with its
  notice); the **Server code** with **Copy**; when the Daylight last said hello to the server; today's AI spend;
  **Set up with a link**; the optional **Server address** field (**Save**; *Only needed when your Daylight server has
  an address of its own…*) and how to re-run the deploy. Every line is in `LAB_TEXT`'s words (LAB-PLAN 2.6, "The rest
  of the server section's copy"). See [`../server/README.md`](../server/README.md) to turn the server on.
  - **Set up with a link** takes the one-time setup link the deploy makes (`https://daylight-….workers.dev/setup#SETUP-…`;
    server DESIGN 3.5). It comes right after the state while that state says to paste one (not set up, the previous
    pairing, locked, or not recognised), else last. The link is read here first: anything else (the Server code, the
    pairing code, another address) says why and sends nothing. Then *Use this Daylight server?* names the link's
    address, and only **Use it** sends the server this pairing's Server code (*Setting up…*); the section then reads
    the server again. Your other devices and your Daylight find it on their own.
  - A server that was deployed again at a new address with the same pairing asks *Your Daylight server moved to {host}.
    Use it?* (**Use it**, **Cancel**), also while the old address fails or doesn't answer (a deploy with a new setup
    link deletes the old Worker). Opening the section or *What's in Lab* reads the server's announcement on the relay
    at once, however recent the last one is (it is otherwise kept for 6 hours), and so does a check whose server, found
    from that kept announcement, fails or can't be reached (one more read; a server that keeps refusing this PC's
    Server code costs no more reads). **Use it** moves to the new address; **Cancel** changes nothing, and the question
    comes back the next time the section opens. A typed Server address wins over the server's own announcement, so
    there is no question while one is typed.

The server is asked only while Lab is on (but for the lock below). An answer is used for 10 minutes; a server that doesn't answer within 5
seconds reads as *Couldn’t reach the Daylight server* (the screen says *Checking your Daylight server…* meanwhile).
Before this PC is paired with another Daylight, a server that knows the old pairing is locked (Lab on or off), so a lost
or replaced pairing can't use it, and a typed Server address and the server's last answer (the old server's) are
forgotten. **Unpair** forgets both too, without locking anything (the same Daylight may come back): pairing another
Daylight then asks that one's server, or says the server knows the previous pairing. Afterwards, while Lab is
on, the send view shows the locked text with the new **Server code**, **Copy** and how to re-run the deploy, under
*Daylight server*, until **OK** (or until the new server answers).

Whether Lab is on or off, the app keeps what Daylight Share says about Lab on the confirmation channel (whether it has
Lab, what it can report, and each item's state in the Reader) each time it reads that channel, so turning Lab on shows
what it has heard. It reads the channel while an item waits for its confirmation, after a send, when What's in Lab
opens and, with Lab on and a Daylight that speaks Lab, after delivery too, while a delivered item of the last 48 hours
waits for its state (every 15 minutes, and every 30 s while the window shows and the item was delivered in the last 10
minutes).

### Lab, Wave 1 (card WIN1)

The first start of this build shows, once, above the pairing screen or the send view: *Lab is on. New features to try
are in Settings › Lab, where you can turn it off.* with **OK** (LAB-PLAN 1.2). With Lab off none of what follows is
there: the window is the plain app's.

- **Delivery timeline** (F01). The history speaks in the timeline's words: *Sent · waiting for your Daylight*, *On your
  Daylight ✓*, *Waiting for a tap on your Daylight*, *Kept for later on your Daylight*, *Handed to the Reader*, *In your
  Reader’s queue*, *In your Reader ✓*… (LAB-PLAN 2.5), with a step line (*Sent ✓ · On your Daylight ✓ · In the Reader
  …*). Every row shows its title and label; the sentence and the step line show on the newest row and on every row
  that isn't settled yet, and elsewhere clicking the title shows them. Screen readers hear "{label}. {sentence}", never
  the step line. Above the history: *Your Daylight checked in 4 min ago.* With a Daylight without Lab the rows read
  exactly as the plain app's (*Delivered ✓*). While the window is closed to the tray, an item that reaches the Reader
  shows a notification: *In your Reader: {title}*.
- **Files over 9 MB** (F02's entry point). Under the too-big sentence of a refused file: **Send files over 9 MB ›**,
  which says what is missing: your Daylight server (with **Copy Server code**) until one exists, then *comes to this app
  in a later Lab update*.
- **Works offline** (F07). Shared while Windows says the PC is offline, an item isn't tried: it waits as *Waiting for
  connection* (*It will send when this device is back online.*) and goes as soon as Windows says the PC is back online,
  oldest first, at most 30 messages and 18 MB of attachments at a time, passes at least 3 minutes apart. What waits to
  send is listed first, under *Waiting to send ({n})*, each with **Cancel**.
- **Sent to {name}** (F08). The notifications after Send To, the hotkey and a quick send name your Daylight: *Sent to
  Desk Daylight* / *Paper: Sent · waiting for your Daylight.*
- **Send links** (F09). `daylightshare://send?url=<address>&title=<title>[&text=<text>][&quick=1]` (from Shortcuts, a
  script, a web page) opens the window and asks *Send to {name}?* with the title and the site, **Send** and **Cancel**.
  `quick=1` sends without asking only when **Allow quick sends from other apps** is on, at most 10 a minute. `text=` goes
  through Clean links; a send link never takes a file. With Lab off: *Turn on Lab in Send to Daylight to use this.*
- **Clean links** (F16). Every link (dropped, copied, a `.url` file, a send link) loses its tracking (`utm_…`, `fbclid`,
  …), Google AMP and redirect wrappers come off, and a shared "headline + link" keeps the headline as its title. The link
  as shared goes along for your Daylight (`x-orig`, *Cleaned from …*).
- **Setup check** (F26), from What's in Lab: *✓ Pairing*, *Send to shortcut*, *Open at login*, *Hotkey* and
  *Notifications* (as Windows reports them), each one not met with **Open setting** (this app's Settings) or **Open
  Settings** (Windows' notification settings); **Send a test article** (*It’s added to your Reader library; delete it
  there when you’re done.*), followed along the timeline to *✓ Delivered* and *✓ In your Reader*; the **Activity log**
  (the last 200 sends, acks and states, without titles or addresses); **Copy diagnostics** (no address, title, code,
  topic or Server code in it).
- **Send copied link** (F33). The clipboard command reads *Send copied link* in the window and the tray menu. The
  window's button shows *Send {site} to {name}?* with **Send** and **Cancel** first; the tray entry and the hotkey send
  at once, and their notification names the site, as before.

Every word on Lab's screens is `LAB_TEXT`'s (`daylight-lab.js`) or the server module's: the server section's setup
steps, host and fingerprint line, delivery mode and Server address field (its `https://` placeholder, **Save** and
footer), which Wave 0 had to word itself, now come from `LAB_TEXT.serverSection` too. The one gap: Setup check's
start-at-login line reads *Open at login* (see *Still to check on a device*).

## Uninstall

Quit it (right-click the icon › **Quit**), then *Settings › Apps › Installed apps › Send to Daylight › Uninstall* (or
*Control Panel › Programs and Features*). This removes the app, **Send to › Daylight**, the `daylightshare:` link
handler and the start-at-login entry. Tick *Delete the application data* to remove the pairing and history too
(`%APPDATA%\com.daylight.share.windows` and `%LOCALAPPDATA%\com.daylight.share.windows`).

## Privacy

Everything is encrypted on this PC with a key derived from the pairing code before it leaves; the relay sees only
random topic names and scrambled data. The pairing, the settings and the outbox (including a copy of each item until
the Daylight confirms it) are JSON files in `%APPDATA%\com.daylight.share.windows\store`, as are Lab's: what the Daylight
said about Lab (`lab~…`) and the Daylight server's address and last answer (`server~…`). The Daylight server, your own
Cloudflare Worker, is contacted only while Lab is on, and, Lab on or off, to lock it before this PC pairs with another
Daylight (see *Lab*).

## How it's built

A [Tauri 2](https://v2.tauri.app) app. The window is plain HTML, CSS and JavaScript (`src/`, no framework); the Rust
side (`src-tauri/src/`) is kept to what a web page can't do.

| Where | What |
|---|---|
| `src/core.js` | Pairing (the module's `pairingConfirmation` and `applyPairingChange`), sending, the outbox and its timers, with `daylight-share.js` (no DOM, no Tauri; unit-tested in node) |
| `src/app.js`, `index.html`, `styles.css` | The window: pairing and its confirmation, drop zone, history, settings (Comfort and Lab among them), Lab's screens, the hotkey recorder, the screen-reader announcements. The code and relay fields size to their text (CSS `field-sizing`, which WebView2 has had since Edge 123) |
| `src/lab.js` | Lab (no DOM, no Tauri; unit-tested in node): the switch (`settings.lab`, a missing key means on), the sender ledger fed by every ack-topic frame (`LabLedger` through the Sender's `onAckHeader`), the gates (`labGate`), the Daylight server (`DaylightServer`: discovery, status, Set up with a link, the Server address, the lock before a re-pairing), the status file's Lab fields; Wave 1: the timeline's words (`describeLabRow`), the Use switches and quick sends, send links (`parseSendLink`), Setup check's lines, activity log and diagnostics |
| `src/lab-ui.js` | Lab's screens' parts (DOM only): the needs-setup note (a polite live region under the clicked control), What's in Lab with its switches, the Daylight server section, the re-pairing follow-up; Wave 1: the timeline's rows, the one-time note, the questions before a send link or the copied link goes, F02's entry point, Setup check |
| `src/core.js` (Lab, Wave 1) | Smart intake at every entry point (`normaliseShare`), sending while offline (`send(…, {defer})`) and the flush back online (`flushNetwork`), reading the ack topic after delivery, the faster checks, "Sent to {name}", send links |
| `src/logic.js` | Small pure helpers (status labels, MIME types, the hotkey's key names, notification texts) |
| `src/bridge.js` | Calls into Rust; the storage adapter (one JSON file per key in the app's data folder) |
| `build.mjs` | Copies `src/`, `../share/js/daylight-share.js`, `../share/js/daylight-lab.js` (unchanged) and `../server/client/daylight-server.js` (with its one import pointed at the copy next to it) into `dist/`, which Tauri embeds |
| `lab-wave.json`, `scripts/lab-wave.mjs` | The Lab wave of this code, as declared and as read from the code, for the release gate (below) |
| `src-tauri/src/main.rs` | Tray icon and menu, the window (closing hides it), single instance (a second launch hands over its arguments: Send To files, pairing and send links), the clipboard hotkey, notifications, start at login, commands for the page (Lab's: the tray entry's words, whether Windows lets the app notify, Windows' notification settings, whether the window is on screen, which WebView2 doesn't tell the page) |
| `src-tauri/src/args.rs` | The command line: files, `daylightshare:` pairing links and `daylightshare://send` links (Lab, F09), `--autostart`, test-mode options and hooks |
| `src-tauri/src/sendto.rs` | The **Send to › Daylight** shortcut (created on the first run if the installer didn't) |
| `src-tauri/src/store.rs`, `atomic.rs` | The page's key-value storage: each write flushed to disk, then renamed into place; a damaged file is set aside |
| `src-tauri/windows/installer-hooks.nsh` | Installer extras: adds and removes the Send to shortcut; puts start at login back after an update |
| `test/unit/` | Unit tests (node): `core.js` against the mock relay with a Receiver playing the Daylight, helpers, configuration; `lab.test.mjs`: Lab against the mock relay, a Lab Daylight (`LabInbox`) and a stand-in Daylight server (`test/helpers/fake-worker.mjs`); `lab-w1.test.mjs`: Wave 1 |
| `test/ui/` | The window's page (`dist/index.html`) in Chromium with a fake bridge in place of Rust (`test/helpers/ui.mjs`): the accessibility checks, the Lab-off parity baselines and Lab's screens (below) |
| `test/e2e/windows.e2e.mjs` | The end-to-end test on Windows (below) |

Plugins (all used from Rust only, so the page needs no plugin permissions): single-instance, deep-link (the
`daylightshare` scheme), global-shortcut, clipboard-manager (reading the link for the hotkey, and Lab's **Copy**),
notification, autostart. Versions are pinned in `src-tauri/Cargo.toml`, `Cargo.lock` and `package-lock.json`.

The window's CSP (`tauri.conf.json`) runs only the app's own scripts and styles. Its `connect-src` takes any `https:`
and `http:` address, because the relay can be your own ntfy server and the Daylight server any address you type; it
names `https://*.workers.dev`, where the deploy puts the Daylight server, as well, so a narrower list later keeps it.

### Build it yourself (on Windows)

Needs [Node.js 22](https://nodejs.org), [Rust](https://rustup.rs) (stable, MSVC) and the Visual Studio C++ build tools
(see Tauri's [prerequisites](https://v2.tauri.app/start/prerequisites/)).

```sh
cd reader-experiment/windows
npm ci
npm test                              # builds dist/ and runs the unit tests
npx playwright install chromium       # once, for the next line
npm run ui                            # the window's page in Chromium: accessibility (test/ui/)
npx tauri build --bundles nsis        # -> src-tauri/target/release/bundle/nsis/Send to Daylight_<version>_x64-setup.exe
npx tauri dev                         # runs it from source (after npm test or node build.mjs), with the developer tools
```

The unit tests and `npm run ui` run anywhere with node 22 (`HEADED=1` shows the browser; `DLS_UI_CHANNEL=msedge`
uses an installed Microsoft Edge, the engine of WebView2). Icons come from the extension's design: `node scripts/make-icons.mjs`
(see the script for what it needs).

### CI and the end-to-end test

[`.github/workflows/rx-windows.yml`](../../.github/workflows/rx-windows.yml) (the win lane's, LAB-PLAN 6.1: every job
carries `# lane: win`) runs for every push that touches this folder, `share/js/`, `server/client/` (the Daylight server's
client module, which the build copies in), `server/vectors/` (which the Lab tests read) or the Lab release gate. Its
jobs:

- **app** (`windows-latest`): unit tests (node, and Rust's `args.rs` and `atomic.rs`), `tauri build`, then
  `test/e2e/windows.e2e.mjs` against the mock relay;
- **ui** (`windows-latest`, so with Windows' own fonts): `test/ui/` in Playwright's Chromium, the accessibility checks,
  the Lab-off parity baselines and Lab's screens (below); screenshots are kept as the `rx-windows-a11y-screenshots`
  artifact;
- **publish** (after both): the Lab release gate, then the upload (below).

The end-to-end test runs against the mock relay (`../share/js/mock-relay.mjs`), with `Receiver`s from
`daylight-share.js` acting as the Daylight. Test mode is `--e2e-status <file>`: the app writes its state (pairing,
outbox, view, the pairing question, the status line, and Lab's: `lab`, `inboxLab`, `caps`, `checkedIn`, `labHeader`,
`labStates`, LAB-PLAN 1.7; Wave 1's: each row's timeline words as `labRow`, `checkedInText`, `online`, the send link's
`sendQuestion`, `clipButton`, `noteShown` and whether the window is `hidden`; the log says what each notification said)
to the file as it changes. The test hooks `--e2e-confirm`, `--e2e-cancel` (answer the pairing question, else a send
link's), `--e2e-hotkey` (the hotkey's code path; pressing a global hotkey on a CI machine isn't practical),
`--e2e-autostart` (the tray switch) and `--e2e-lab 0|1` (sets the Lab switch at start, as a click in Settings would,
and keeps it) work only in an app started in test mode; otherwise none of these options does anything. The test:

1. installs `Send-to-Daylight-windows-setup.exe` silently and checks the Send to shortcut and the link scheme;
2. starts the app the way a clicked link does when it isn't running, `send-to-daylight.exe "daylightshare://pair?…"`:
   it must ask in the protocol's words, pair nothing before the answer, and stay unpaired on Cancel; Lab is on at this
   first start, and saved (F00.1);
3. hands it the same link again while it runs (a second launch, as a browser does) and answers Pair;
4. starts the app again with files as arguments, as Send to does: a PDF, a text file and a 5 MB file arrive intact (the
   last in three pieces, each under the relay's 2 MB limit), and a file over 9 MB is refused with the library's
   sentence;
5. puts a headline and a link with tracking on the clipboard and starts the app with `--e2e-hotkey`: the Daylight gets
   the link without its tracking, the headline as its title and the link as shared in `x-orig` (F16), and the
   notification says *Sent to Test Daylight* and names the site (F08, F33);
6. waits until the status file shows all four **Delivered**, in the library's words; this Daylight is a plain v1.1
   one, so the app has heard no Lab from it and What's in Lab's header says *Needs Lab on your Daylight* (F17.2);
7. opens another Daylight's link with the same name: the question shows the other code and **Switch**; Cancel keeps
   everything;
8. opens the paired Daylight's link with a new relay and name: no question, *Pairing updated…*, the history kept, and
   the next file goes through the new relay and is acked there; the Daylight there is a Lab one (`daylight-lab.js`'s
   `LabInbox` and `LabInboxSim`), in the real order: it acks first, and reports the file's state (`handed`) only after
   the app has read the ack. Sending one more file reads the channel again, and the hello and that state reach the
   app's ledger (F17); the status file keeps the rows' v1.1 words in `label`, and the timeline's in `labRow`: a v1.1
   Daylight's rows read *Delivered ✓* there too (F01.5), the Lab Daylight's file *Handed to the Reader* (F01.2);
9. turns on start at login with `--e2e-autostart` and checks this user's Run entry;
10. restarts the app: pairing, history, start at login and what the ledger learnt come back. With the window in the
    notification area (Rust says it isn't on screen: `hidden`), the hotkey sends a link the Lab Daylight then puts in
    the Reader: at the next ack read the status file shows *In your Reader ✓* (F01.1) and the log the toast *In your
    Reader: {title}* (no toast if the window had to be opened to read the ack). A `daylightshare://send` link asks *Send to Desk Daylight?* with the title
    and site (`sendQuestion`), nothing goes before `--e2e-confirm`, which sends it cleaned with `x-orig`; with
    `quick=1` it asks too (quick sends are off) and `--e2e-cancel` sends nothing (F09.3). Then it restarts with
    `--e2e-lab 0`: Lab is off and saved, the ledger is kept, the rows have no timeline words, and the status file
    equals the Lab-on one but for Lab's own fields (a Lab-off status snapshot);
11. zero-fills `outbox.json` and deletes the Run entry, restarts (with `--e2e-lab 1`, which turns Lab back on): the
    app sets the file aside and says so, puts the Run entry back, and Send To still works;
12. updates the default way (the old uninstaller, then the installer), from settings as a build without Lab left them:
    the Run entry, pairing and history survive, and Lab is on (F00.1);
13. opens the window (screenshot), quits and uninstalls, and checks that the shortcut, the link scheme and the
    start-at-login entry are gone.

`--e2e-pair <link>` pairs without asking, for trying the app by hand against a test relay; the test itself takes the
links' real path.

### Accessibility checks (LAB-PLAN F27)

`test/ui/a11y.test.mjs` opens `dist/index.html` in Chromium (WebView2's engine), served with the window's own CSP from
`tauri.conf.json`, with `window.__TAURI__` faked from a seed: the JSON store's keys (pairing, history, settings) and
`app_info`. The page is laid out at the narrowest window: `minWidth` 360 less a 17 px scrollbar. It checks:

- **axe-core** (`@axe-core/playwright`, pinned) finds no violations in any view (pairing, sending with a history row in
  every state, Settings before and after pairing, the hotkey recorder, Change pairing… and its Switch question), light
  and dark, Comfort off and on; first it proves axe reads the page (an unlabelled field put in for a moment is found);
- every control has a name, and the history's states are the library's words;
- **Comfort**: LAB_TEXT's words for the switch and its footer, off by default, before pairing too; on, the `comfort`
  class on `<body>` gives text at 125%, buttons at least 48 px high, 2 px borders and no transitions, and the next
  start opens in Comfort; a Comfort that can't be saved is put back and says why;
- **no text cut short** (F27.4): with Comfort, for every element with text and every text field (what is typed in it,
  or its placeholder: a textarea's scroll size counts it, an input's is measured in its `::placeholder` font),
  `scrollWidth <= clientWidth` and `scrollHeight <= clientHeight + 1`, and the window never scrolls sideways. At 100%
  text in every view above; at 200% and 225% (Windows' largest text size) in every view too: the pairing screen with a
  typed code and relay, a pasted pairing link and its error, Settings before and after pairing, the send view with a
  row in every state, the hotkey recorder, Change pairing… with a typed code, and both questions (a link's *Pair*, a
  code's *Switch*), also for a Daylight whose name has no spaces (16 characters, and the longest, 60: a link's *Pair*,
  and *Switch* to a pasted link while paired with one). A self-test shows the check catches a field that doesn't grow (its code, then its placeholder), an
  input's placeholder and two buttons that can't wrap. Without Comfort, status text still wraps at 200%;
- **announcements**: a row that the first tick ends as Not delivered, and one the Daylight acks (a real ack on the mock
  relay, read when Rust's tick event fires), are said through the polite live region.

Screenshots of every view go to `test-results/a11y/` (a CI artifact, for review; not compared).

### Lab checks (LAB-PLAN F00, F17 and Wave 1)

`test/unit/lab.test.mjs` runs `src/lab.js` and `core.js` in node against the mock relay, a Lab Daylight (`LabInbox`)
and a stand-in Daylight server (`test/helpers/fake-worker.mjs`): Lab on by default and kept across pairing changes;
no server call with Lab off; What's in Lab's rows and short states; the gate's states (`needs-pairing`, `needs-server`
with the Server code, `OFFLINE` at once for a refused connection and at 5 s for a relay that never answers, a server's
own states, `later`); What's in Lab's cached states (10 minutes old or less, with nothing on the network); the server
section for the vector pairing (its Server code and fingerprint, F00.5), a server found on the relay, a move (also when
the old address never answers, is deleted or refuses while the cached config is fresh: opening What's in Lab or the
section reads the config topic, and a feature's check reads it once more after `SERVER_ERROR` or `OFFLINE`, after
`BAD_AUTH` once per episode), Set up with a link and a typed address; Unpair forgetting a typed address and the cached
status, so another Daylight's pairing says `pairing-mismatch`, finds its own server, and its gates and Settings row
never answer from the old server's status; F17 (every ack-topic frame reaches the ledger, Lab
on or off; a later Lab level, junk and a `lab: 0` frame are read safely; no Lab frame delays an ack); an item queued
offline goes once back online with Lab off (F00.4); the lock before a re-pairing and its follow-up; the build's copies,
the CSP, that the window's words are `LAB_TEXT`'s (the server section's included), and that the code is Wave 1 (the
release gate).

`test/unit/lab-w1.test.mjs` runs Wave 1 the same way: smart intake at each entry point (the clipboard, a dropped text,
an AMP link, a `.url` file), `x-orig` on the wire, F16's Use switch and v1.1 exactly with Lab off (F16); an item shared
offline is deferred (nothing published, *Waiting for connection* in the window and the notification), goes back online,
passes 3 minutes apart, and 70 links go out in passes of 30 with no 429 (F07, F07.3); a Lab Daylight's states as the
rows' words (*In your Reader ✓*, *Handed to the Reader*, *Waiting for a tap…*), v1.1's words for a v1.1 Daylight, the
ack topic read after delivery only while a row waits for its state, the faster checks only while the window shows, the
toast's hook once (F01); "Sent to {name}" and the host (F08, F33); the copied link prepared without sending (F33);
send links: what they read, Lab off, unpaired, not a web address (a file path among them), the question, quick sends
and their limit (F09); F02's gate; the test article to the Reader, the activity log and redacted diagnostics, Setup
check's lines (F26).

`test/ui/lab.test.mjs` opens the window's page as the accessibility checks do: Lab first in Settings and on by default,
with the one-time note once (F00.1, 1.2); a switch that can't be saved is put back; What's in Lab with short states
only, and a click that shows exactly the feature's sentence under it, in a polite live region, with **Copy Server
code** (F00.3); *Checking your Daylight server…*, then `OFFLINE` at 5 s (F00.6), and the cached states at once instead
when the last answer is recent; the server section and **Copy**
(F00.5), Set up with a link and its question, a typed address that answers Ready, the *moved … Use it?* question
while the old address never answers (Cancel keeps the pin, Use it moves), and, with a fresh cached config and the
old Worker deleted, Settings' row, What's in Lab and the section each reading the config topic and the question
showing at once; no secret name or needs-setup
sentence on any screen reached without clicking a Lab feature or opening the server section (F00.7); the re-pairing
follow-up. axe-core finds nothing on each of them, light and dark, and with Comfort at 100%, 200% and 225% text
nothing is clipped at the narrowest window. `test/ui/lab-off-parity.test.mjs` (above) runs axe-core with Lab off.

`test/ui/lab-w1.test.mjs` does the same for Wave 1: the timeline's rows (labels everywhere, the sentence and step line
on the newest row and the rows not settled, the details behind the title, "{label}. {sentence}" for screen readers and
no step line, the check-in header, the queue with Cancel; F01.6), a Lab Daylight's *In your Reader ✓* after a tick, said
politely (F01.1); a send link's question, Send and Cancel, Lab off and unpaired (F09.3); *Send copied link*'s question
and its Use switch, with the tray's words following (F33.3); F02's entry point with its note, and none with Lab off
(F02e.1); offline, *Waiting for connection* in *Waiting to send (1)*, sent once back online (F07.1, F07.2); What's in
Lab's Use switches and quick sends with their footers; Setup check's lines and buttons, the test article to *✓ In your
Reader*, the activity log and Copy diagnostics (F26.1-3); F01's *Needs Lab on your Daylight*. axe-core on each, light and
dark, and with Comfort at 100%, 200% and 225% text nothing clipped in any of Wave 1's views.

### Lab-off parity baselines (LAB-PLAN 1.7)

`test/lab-off-baseline/*.yml` hold what the window says, as Playwright's `locator('body').ariaSnapshot()` (roles,
names and values, in order), for the main window and Settings, unpaired (`main-pair`, `settings-unpaired`) and paired
with a history row in every state (`main-send`, `settings`). They were recorded from the last non-Lab build: protocol
1.1 plus the accessibility baseline with Comfort. `test/ui/lab-off-parity.test.mjs` seeds `settings.lab = false`, a
fixed pairing and rows at fixed ages under a fixed clock, and compares; Comfort on must give the same trees (only the
switch reads checked). With Lab off, every Lab build must still match them: only the Lab switch row in Settings and its
footer, which stay with Lab off, may be left out (`expectBaseline(page, name, {omit})`). Lab off is reached three ways
(stored, the switch clicked off, `--e2e-lab 0`), and axe-core checks each Lab-off screen, light and dark, Comfort off
and on. With Lab on, the pairing screen still equals its baseline but for the one-time note above it (and exactly once
the note is dismissed); the send view's Lab parts (Wave 1) are checked in `lab-w1.test.mjs`.
Re-record them only together with a matching non-Lab change:

```sh
UPDATE_LAB_OFF_BASELINE=1 node --test test/ui/lab-off-parity.test.mjs
```

The workflow then uploads the installer to the `reader-experiment-latest` release; the bare `send-to-daylight.exe`
and the test output (status file, screenshot) are kept as workflow artifacts.

**Lab release gate** (LAB-PLAN 6.2): a Windows Lab build reaches the release only after the iPhone and Mac builds of
the same wave. [`lab-wave.json`](lab-wave.json) names the Lab wave of the code in this folder: `"w1"` since WIN1 (WIN0
set `"w0"`). While [`../lab-release-gate.json`](../lab-release-gate.json) has that wave `false`, the
publish job skips the upload and says so in the log (a "Lab release gate" notice); the tests run all the same. Flipping
the gate starts the workflow again, which then publishes the held build.

The gate does not take `lab-wave.json` on trust: [`scripts/lab-wave.mjs`](scripts/lab-wave.mjs) reads the wave from
the code too, and the publish job holds the build for the later of the two. Any Lab code is W0: `src/lab.js`, a
`daylight-lab.js` in `src/`, or anything in `src/` or `build.mjs` that names `daylight-lab`. W1 code is `src/` using a
W1 export of `daylight-lab.js` (those after its `// W1 (L1)` heading), `describeLabRow` (F01's rows), the Sender's F07
calls (`flushNetwork`, `send(…, {defer})`), `LAB_NOTE_ENABLED = true`, a quoted id of a Windows W1 feature (`'F01'`,
`'F07'`, `'F08'`, `'F09'`, `'F16'`, `'F26'`, `'F33'`) or any feature in `BUILT_FEATURES` (F02's entry point is W1 here).
When the script can't tell (the module or its heading missing, or a quoted feature id of a wave it doesn't know), it
fails and nothing is uploaded. Unit tests check the script on made-up trees (WIN0 forgetting `"w0"`, WIN1 leaving it),
that `lab-wave.json` is not behind the code here and names a wave the gate knows, and that every job carries its lane.

## Still to check on a device

For the W1 device round on the lab tablet **Rooted 2** (JP4R01422; LAB-PLAN 6.4), with the real ntfy.sh relay and a real
Windows 10 or 11 PC. CI covers everything else above with the mock relay, Chromium and Daylights simulated in node, and
on the `windows-latest` runner with the installed app; these need a real DC-1, a real desktop or a person. Nothing here
is ever installed on JP4R03005. The Windows W1 build reaches the release only once the gate opens W1 (until then, take
the `Send-to-Daylight-windows-setup` artifact of the green rx-windows run).

- [ ] **F01.1** A link sent from Windows (Send To, the hotkey, a drop) shows *In your Reader ✓* within 45 s of *On your
  Daylight ✓* with the window open: Daylight Share in front; in the background with the Reader in front and "Display
  over other apps" on; the same with it off (*Waiting for a tap on your Daylight* until the notice is tapped, then *In
  your Reader ✓*); the screen off with Instant delivery on. Note the times in DEVICE-CHECKS.md.
- [ ] **F01.2** With Documents = Ask, a PDF reads *Waiting for a tap on your Daylight*, then, after the tap, *Handed to
  the Reader* and *The Reader doesn’t confirm documents yet.* at the next check.
- [ ] **F01.3** The header reads *Your Daylight checked in N min ago*; with the Daylight off, sends still go out.
- [ ] **F01 (toast)** With the window closed to the notification area (and minimized), a link that reaches the Reader
  shows the Windows notification *In your Reader: {title}*; with the window open, none (its row says so). CI checks it
  on the runner with the window never shown; the app asks Rust whether the window is on screen, since WebView2 tells a
  hidden window's page that it is visible.
- [ ] **F01.6** Narrator (and NVDA) read each row as "{label}. {sentence}", with no step count, and say *In your Reader ✓:
  {title}* when a row gets there.
- [ ] **F02e** Dropping a 14 MB PDF on the window shows the too-big sentence and **Send files over 9 MB ›**, whose note
  says the Daylight server is needed (with Copy Server code).
- [ ] **F07.1** With Wi-Fi off (or flight mode), a link sent from the window, Send To and the hotkey reads *Waiting for
  connection* under *Waiting to send (n)*; with the network back it goes within a minute.
- [ ] **F08** The notifications read *Sent to {your Daylight’s name}* with the item's name (and the site for the
  hotkey).
- [ ] **F09** A `daylightshare://send?url=…` link clicked in Edge and in Chrome opens the window with *Send to {name}?*;
  **Send** sends it. A test page that opens `…&quick=1` by itself shows the question too (quick sends off); with **Allow
  quick sends from other apps** on, it sends without asking, and the 11th in a minute asks again.
- [ ] **F26.1** Setup check's test article reaches the Reader and ticks *✓ Delivered* and *✓ In your Reader*, in each
  condition of F01.1 (*Waiting for a tap on your Daylight* meanwhile where the Inbox asks).
- [ ] **F26.3** Turning the app's notifications off in *Settings › System › Notifications* makes Setup check say *!
  Notifications*, and **Open Settings** opens that page; **Open setting** on *Open at login*, *Hotkey* and *Send to
  shortcut* opens this app's Settings at that setting.
- [ ] **F33.3** The tray menu's entry reads *Send copied link* with Lab on and *Send clipboard link* with Lab off (or
  F33's Use switch off); Ctrl + Alt + D sends at once and its notification names the site.

**Copy, reported to the share lane:** Setup check's start-at-login line uses `LAB_TEXT.setup.checks.loginItem`, *Open at
login* (the Mac's words): LAB_TEXT has no Windows wording for it, and this app calls the setting *Start at login*.

## Not yet

- **Code signing.** Unsigned, hence the SmartScreen warning; signing needs a certificate.
- **Updates** are manual: run the new build's installer. It finds the old one and offers *Uninstall before installing*
  (the default) or not; either way the pairing, the history and the settings are kept, as long as *Delete the
  application data* stays unticked in the uninstaller that may appear. The old uninstaller removes the start-at-login
  entry; the installer puts it back when you had it on (the app keeps your choice in its data folder), and so does the
  app when it next starts. The installer closes the running app (it asks first) and its last page can start it again.
