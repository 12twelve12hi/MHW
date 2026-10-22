# Send to Daylight: every way in (Lab)

*The one list of every entry point into Send to Daylight (LAB-PLAN F09), for people who automate and for the agents
that build the apps. Everything here is a **Lab** feature: with Lab off, an app answers automation with "Turn on Lab in
{app} to use this." (pairing links still work). Built so far: the command line (L1). The rest is specified here and
built by the cards named in each section.*

Every entry point runs **smart intake** on what it gets (`normaliseShare`, F16: the real article behind Google AMP,
Facebook, Instagram, LinkedIn and Substack links, tracking parameters removed, headline + link shares kept as links)
and sends the original URL along as `x-orig` when it changed. Text becomes an **excerpt** only from an explicit
selection (`classifyShare`, F11 and LAB-PLAN 6.5 Q1 = b). Files are at most 9 MB; an empty or unreadable file is
refused with a sentence and never sent as 0 bytes.

| Entry point | Where | Built by | Answer |
|---|---|---|---|
| [Command line `daylight-send`](#command-line-daylight-send) | macOS, Linux, Windows (Node 22) | L1 (built) | exit code, `--json` |
| [URL scheme `daylightshare://send`](#url-scheme) | iPhone, Mac, Android, Windows | A4, A5, K4, WIN1 | a confirmation sheet |
| [Shortcuts and Siri (App Intents)](#shortcuts-and-siri) | iPhone, iPad, Mac | A4, A5 | `DeliveryEntity {id, status, label}` |
| [Android intent `SEND_URL`](#android-intent) | Android phone | K4 | `RESULT_OK` with `id` and `status` |
| [Web sender URL and bookmarklet](#web-sender) | any browser | B1 | the web sender page |
| [People's entry points](#what-people-use) | share sheets, right-click menus, Services, Print, the menu bar, the clipboard | A4, A5, K4, X1, WIN1 | the app's history |

## Command line: `daylight-send`

One file, `daylight-send.mjs`, published to the
[`reader-experiment-latest` release](https://github.com/12twelve12hi/MHW/releases/tag/reader-experiment-latest).
It needs Node 22 and nothing else.

```sh
curl -fLO https://github.com/12twelve12hi/MHW/releases/download/reader-experiment-latest/daylight-send.mjs
chmod +x daylight-send.mjs && mv daylight-send.mjs ~/bin/daylight-send
daylight-send pair 'daylightshare://pair?c=…'      # or the code Daylight Share shows, ABCD-EFGH-…
daylight-send https://example.com/story
```

**Commands.**

| Command | Does |
|---|---|
| `daylight-send <url\|file> [options]` | Sends a link (`kind: url`; the Reader downloads it) or a file (`kind: file`, at most 9 MB) |
| `daylight-send status [<id>] [--json]` | The newest item, or the one with this id (or a unique start of it, at least 4 characters): its title, label, sentence and delivery steps |
| `daylight-send tick [--json]` | Reads the acks and re-sends what is due, nothing else: `{"delivered":n,"resent":n}` |
| `daylight-send pair <link\|code>` | Checks the pairing and saves it to `~/.config/daylight-send/pairing` (mode 0600) |
| `daylight-send --help`, `--version` | |

A file whose name is `status`, `tick` or `pair` goes as `./status`.

**Options.**

| Option | |
|---|---|
| `--title T` | The item's title. For a link it replaces the title smart intake would give |
| `--json` | One line of JSON on stdout: `{"id","status","label","sentence","state","kind"}`. `status` is the outbox's (`sending`, `sent`, `delivered`, `failed`, `expired`); `label` and `sentence` are the app's words (`describeLabRow`); `state` is your Daylight's Lab state (`reader`, `handed`, `waiting`, …) or null. An error before anything was stored prints `{"id":null,"status":"error","error":"<reason>","label":"<sentence>"}` |
| `--wait[=secs]` | Waits until your Daylight acknowledges the item (default 120 s), reading the ack topic every 5 s |
| `--wait-for delivered\|reader` | `delivered` is `--wait`. `reader` waits until your Daylight's Reader has it: `reader` or `queued` for a link or page, `handed` for a document (the Reader does not confirm documents yet). It needs Lab on your Daylight; ends with exit 1 if the Daylight reports `inbox` or `failed` |
| `--pairing P` | A pairing link or code for this run only |
| `--from NAME` | The sender name your Daylight shows (default: this computer's name; or `DAYLIGHT_FROM`) |

**Exit codes.** `0` sent (with `--wait` or `--wait-for`: delivered, or in the Reader); `2` timed out (the item stays
in the outbox; `status` checks it again); `3` refused or too big, with the v1.1 sentence on stderr ("Too big to send.
Files can be up to 9 MB; this one is 14 MB.", "The relay set on your Daylight turned this down. …"); `1` anything else
(not paired, no such file, an empty file, offline: the sentence is on stderr). The sentence is on stderr with or
without `--json`; stdout still has the item when one was stored (its label, step line and id, or the `--json` line).

**Re-sends need a run.** The outbox re-sends an item until your Daylight acknowledges it, as every app does, but only
while `daylight-send` runs. Every run, `status` included, first does `tick()`: it reads the acks and re-sends what is
due. To keep items moving while you are away, add a cron line:

```cron
*/15 * * * * /usr/local/bin/node $HOME/bin/daylight-send tick >/dev/null 2>&1
```

**Where things are.**

| | |
|---|---|
| `~/.config/daylight-send/` | The tool's folder: `$DAYLIGHT_SEND_DIR`, else `$XDG_CONFIG_HOME/daylight-send` |
| `…/pairing` | The saved pairing (`daylight-send pair`). `--pairing` and `DAYLIGHT_PAIRING` take precedence |
| `…/outbox-<16 hex>/` | One outbox per pairing (the hex is from SHA-256 of "daylight-send/outbox\0" and the secret, so it names no topic). One JSON file per storage key, written by atomic rename |
| `…/lock` | An exclusive lock file, held around each change to the outbox. Its holder touches it every 10 s; one untouched for 60 s is stale and the next run takes it over |

Two runs at once (from a script, or one of them in `--wait`) take turns at the lock and lose no rows; a run never
holds the lock while it waits. Lab on the command line is always on: smart intake runs, and the Lab ledger learns your
Daylight's item states from the ack topic, which `status` and `--wait-for reader` show.

## URL scheme

`daylightshare://send?url=<u>&title=<t>[&text=<s>][&quick=1]` (iPhone, Mac, Android through `MainActivity`, Windows
through `args.rs`).

- It opens a sheet: **Send to {name}?**, the title and host, **Send** and **Cancel**.
- `quick=1` skips the sheet only when the Lab setting **Allow quick sends from other apps** is on (off by default;
  footer: "Lets Shortcuts, scripts and other apps send without asking. Any app or web page could then send to your
  Daylight."). At most 10 quick sends a minute; past that, the sheet shows.
- `text=` goes through `normaliseShare` (a URL in it is found; a headline stays the title). The scheme never takes a
  file path.
- Lab off: "Turn on Lab in {app} to use this." Not paired: the `needs-pairing` sentence.

## Shortcuts and Siri

App Intents in the iPhone and Mac apps (`openAppWhenRun = false`):

| Intent | Takes | Returns |
|---|---|---|
| `SendLinkIntent` | `url`, `title?` | `DeliveryEntity` |
| `SendTextIntent` | `text` | `DeliveryEntity` (a link when the text has one, else a note) |
| `SendFileIntent` | `file: IntentFile` | `DeliveryEntity`; an empty or unreadable file fails with its sentence |
| `SendCopiedLinkIntent` | the clipboard (iOS asks to allow pasting the first time) | `DeliveryEntity` |
| `GetDeliveryStatusIntent` | `delivery` | `DeliveryEntity` |
| `GetLastDeliveryIntent` | | the newest row's title and label |

`DeliveryEntity` is `{id, status, label}`, with `label` from `describeLabRow`. Siri answers "Sent to {name}.". Phrases:
"Send copied link with Send to Daylight" and "Check my Daylight with Send to Daylight".

## Android intent

`com.daylight.share.action.SEND_URL`, handled by the exported, translucent `sender/AutomationActivity`:

| Extra | |
|---|---|
| `android.intent.extra.TEXT` | the link, or text holding one |
| `android.intent.extra.TITLE` | optional title |
| `com.daylight.share.extra.QUICK` (boolean) | skip the confirmation, under the same setting and limit as `quick=1` |

Started with `startActivityForResult`, it answers `RESULT_OK` with the extras `id` and `status`.

## Web sender

- `?url=<u>&autosend=1` and the `#url=…&title=…&autosend=1` fragment forms (the pairing stays in that browser).
- Settings › Lab gives a bookmarklet:
  `javascript:location.href='<page>#autosend=1&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)`.

## What people use

These are not for scripts, but they are entry points too, and they run the same intake:

| Entry point | Apps |
|---|---|
| Share › Daylight (share in place, F04), with Options: Send as, Review, "Send the link instead", "Send as excerpt" | iPhone, Mac, Android |
| Right-click menu: page, clean article, link, selection, an image's page, PDF link; shortcuts Alt+Shift+D and Alt+Shift+S; Chrome's omnibox keyword `dl` (F34) | Chrome, Safari |
| Services › Send to Daylight for text, URLs and files (F11) | Mac |
| Print › PDF › Send to Daylight (F23) and drop on the menu-bar icon (F29) | Mac |
| Send copied link (F33): a chip, a button, or the clipboard command and hotkey (⇧⌘L, Ctrl+Alt+D) | every app |
| Send to › Daylight, the tray menu | Windows |
