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
Daylight asks first and says that it replaces the current one (the button reads **Switch**); switching, or **⋯ › Unpair
this PC**, discards anything the old Daylight hasn't picked up yet.

## Send

- **Drag and drop** files (PDF, EPUB, Word, text, Markdown, HTML…) or a link (from the browser's address bar or a
  page) onto the window. **Choose files…** does the same from a file dialog, and works from the keyboard.
- **File Explorer:** select one or more files, right-click, **Send to › Daylight** (on Windows 11: **Show more
  options** first, or Shift + right-click). A notification says *Sent &lt;name&gt;*, or why not. The app needn't be open;
  it starts if it isn't running. Internet shortcuts (`.url` files) send their web address.
- **The clipboard's link:** copy a web address anywhere and press **Ctrl + Alt + D**. A notification says
  *Sent &lt;site&gt;*, or that there was no link to send. The tray menu's **Send clipboard link** and the button in the
  window do the same. Change or turn off the hotkey in **⋯ › Settings** (click **Change…**, then press the new
  combination; it needs Ctrl, Alt or Win).

**Sizes:** files can be up to 9 MB. The free relay (ntfy.sh) takes attachments of up to 2 MB, so larger files travel in
pieces that fit, and it holds about 20 MB per sender at a time, so after a burst of big files the rest waits a few
hours (the history says so). These rules come with the protocol library; a bigger file is refused at once, with its
size.

## History and retries

The window lists what you sent, newest first, in the same words as the other Send to Daylight apps:

- **Sent · waiting for your Daylight**: on its way; the Daylight hasn't picked it up yet (it may be asleep).
- **Delivered ✓**: the Daylight confirmed it.
- **Waiting to send**: the relay couldn't be reached or is busy; it tries again by itself (**Retry now** to try at
  once).
- **Not delivered**, with the reason, and **Try again** where trying again can help: for example the Daylight didn't
  pick it up within a week.

While the app runs (in the notification area is enough) it checks for the Daylight's confirmations when it starts,
right after each send and again about 30 seconds later, every 15 minutes, and when you open the window; and it
re-sends anything not yet confirmed before the relay forgets it (ntfy.sh keeps messages 12 hours and files 3 hours),
for up to a week. The history and the copies kept for re-sending survive restarts. Each is written so that a crash or
a power cut leaves the old version or the new one; if a file is damaged all the same, the app sets it aside (renamed
to `….json.bad`), says so in the window, and carries on.

Closing the window keeps the app running in the notification area. Left-click the icon to open the window; right-click
it for **Send clipboard link**, **Open**, **Start at login** and **Quit**. Esc hides the window.

## Start at login

Off by default. Turn it on in the tray menu (**Start at login**) or in **⋯ › Settings**. It then starts quietly in the
notification area when you sign in to Windows, so re-sends and the hotkey keep working. (It adds an entry under
*Settings › Apps › Startup*, where you can also turn it off.) It stays on after an update (see below).

## Uninstall

Quit it (right-click the icon › **Quit**), then *Settings › Apps › Installed apps › Send to Daylight › Uninstall* (or
*Control Panel › Programs and Features*). This removes the app, **Send to › Daylight**, the `daylightshare:` link
handler and the start-at-login entry. Tick *Delete the application data* to remove the pairing and history too
(`%APPDATA%\com.daylight.share.windows` and `%LOCALAPPDATA%\com.daylight.share.windows`).

## Privacy

Everything is encrypted on this PC with a key derived from the pairing code before it leaves; the relay sees only
random topic names and scrambled data. The pairing, the settings and the outbox (including a copy of each item until
the Daylight confirms it) are JSON files in `%APPDATA%\com.daylight.share.windows\store`.

## How it's built

A [Tauri 2](https://v2.tauri.app) app. The window is plain HTML, CSS and JavaScript (`src/`, no framework); the Rust
side (`src-tauri/src/`) is kept to what a web page can't do.

| Where | What |
|---|---|
| `src/core.js` | Pairing (the module's `pairingConfirmation` and `applyPairingChange`), sending, the outbox and its timers, with `daylight-share.js` (no DOM, no Tauri; unit-tested in node) |
| `src/app.js`, `index.html`, `styles.css` | The window: pairing and its confirmation, drop zone, history, settings, the hotkey recorder |
| `src/logic.js` | Small pure helpers (status labels, MIME types, the hotkey's key names, notification texts) |
| `src/bridge.js` | Calls into Rust; the storage adapter (one JSON file per key in the app's data folder) |
| `build.mjs` | Copies `src/` and `../share/js/daylight-share.js` into `dist/`, which Tauri embeds |
| `src-tauri/src/main.rs` | Tray icon and menu, the window (closing hides it), single instance (a second launch hands over its arguments: Send To files, pairing links), the clipboard hotkey, notifications, start at login, commands for the page |
| `src-tauri/src/args.rs` | The command line: files, `daylightshare:` links, `--autostart`, test-mode options and hooks |
| `src-tauri/src/sendto.rs` | The **Send to › Daylight** shortcut (created on the first run if the installer didn't) |
| `src-tauri/src/store.rs`, `atomic.rs` | The page's key-value storage: each write flushed to disk, then renamed into place; a damaged file is set aside |
| `src-tauri/windows/installer-hooks.nsh` | Installer extras: adds and removes the Send to shortcut; puts start at login back after an update |
| `test/unit/` | Unit tests (node): `core.js` against the mock relay with a Receiver playing the Daylight, helpers, configuration |
| `test/e2e/windows.e2e.mjs` | The end-to-end test on Windows (below) |

Plugins (all used from Rust only, so the page needs no plugin permissions): single-instance, deep-link (the
`daylightshare` scheme), global-shortcut, clipboard-manager, notification, autostart. Versions are pinned in
`src-tauri/Cargo.toml`, `Cargo.lock` and `package-lock.json`.

### Build it yourself (on Windows)

Needs [Node.js 22](https://nodejs.org), [Rust](https://rustup.rs) (stable, MSVC) and the Visual Studio C++ build tools
(see Tauri's [prerequisites](https://v2.tauri.app/start/prerequisites/)).

```sh
cd reader-experiment/windows
npm ci
npm test                              # builds dist/ and runs the unit tests
npx tauri build --bundles nsis        # -> src-tauri/target/release/bundle/nsis/Send to Daylight_<version>_x64-setup.exe
npx tauri dev                         # runs it from source (after npm test or node build.mjs), with the developer tools
```

The unit tests run anywhere with node 22. Icons come from the extension's design: `node scripts/make-icons.mjs`
(see the script for what it needs).

### CI and the end-to-end test

[`.github/workflows/rx-windows.yml`](../../.github/workflows/rx-windows.yml) runs on `windows-latest` for every push
that touches this folder or `share/js/`: unit tests (node, and Rust's `args.rs` and `atomic.rs`), `tauri build`, then
`test/e2e/windows.e2e.mjs` against the mock relay (`../share/js/mock-relay.mjs`), with `Receiver`s from
`daylight-share.js` acting as the Daylight. Test mode is `--e2e-status <file>`: the app writes its state (pairing,
outbox, view, the pairing question, the status line) to the file as it changes. The test hooks `--e2e-confirm`,
`--e2e-cancel` (answer the pairing question), `--e2e-hotkey` (the hotkey's code path; pressing a global hotkey on a CI
machine isn't practical) and `--e2e-autostart` (the tray switch) work only in an app started in test mode; otherwise
none of these options does anything. The test:

1. installs `Send-to-Daylight-windows-setup.exe` silently and checks the Send to shortcut and the link scheme;
2. starts the app the way a clicked link does when it isn't running, `send-to-daylight.exe "daylightshare://pair?…"`:
   it must ask in the protocol's words, pair nothing before the answer, and stay unpaired on Cancel;
3. hands it the same link again while it runs (a second launch, as a browser does) and answers Pair;
4. starts the app again with files as arguments, as Send to does: a PDF, a text file and a 3 MB file arrive intact (the
   last in pieces under the relay's 2 MB limit), and a file over the size limit is refused with the library's sentence;
5. puts a link on the clipboard and starts the app with `--e2e-hotkey`;
6. waits until the status file shows all four **Delivered**;
7. opens another Daylight's link with the same name: the question shows the other code and **Switch**; Cancel keeps
   everything;
8. opens the paired Daylight's link with a new relay and name: no question, *Pairing updated…*, the history kept, and
   the next file goes through the new relay and is acked there;
9. turns on start at login with `--e2e-autostart` and checks this user's Run entry;
10. restarts the app: pairing, history and start at login come back;
11. zero-fills `outbox.json` and deletes the Run entry, restarts: the app sets the file aside and says so, puts the Run
    entry back, and Send To still works;
12. updates the default way (the old uninstaller, then the installer): the Run entry, pairing and history survive;
13. opens the window (screenshot), quits and uninstalls, and checks that the shortcut, the link scheme and the
    start-at-login entry are gone.

`--e2e-pair <link>` pairs without asking, for trying the app by hand against a test relay; the test itself takes the
links' real path.

The workflow then uploads the installer to the `reader-experiment-latest` release; the bare `send-to-daylight.exe`
and the test output (status file, screenshot) are kept as workflow artifacts.

## Not yet

- **Code signing.** Unsigned, hence the SmartScreen warning; signing needs a certificate.
- **Updates** are manual: run the new build's installer. It finds the old one and offers *Uninstall before installing*
  (the default) or not; either way the pairing, the history and the settings are kept, as long as *Delete the
  application data* stays unticked in the uninstaller that may appear. The old uninstaller removes the start-at-login
  entry; the installer puts it back when you had it on (the app keeps your choice in its data folder), and so does the
  app when it next starts. The installer closes the running app (it asks first) and its last page can start it again.
