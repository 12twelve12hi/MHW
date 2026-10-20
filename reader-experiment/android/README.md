# Daylight Share for Android

One APK, two jobs:

- **On a phone: "Send to Daylight".** It appears in Android's share menu. Share a link, a web page's address, a PDF,
  an EPUB, a Word document, Markdown, HTML, plain text or any other file, and it goes to your Daylight.
- **On the Daylight DC-1: the Daylight Inbox.** It shows the pairing code, receives what your phones and computers
  send, and hands each item to the Daylight Reader.

Items travel through an [ntfy](https://ntfy.sh) relay (free, no account), end-to-end encrypted with a key only your
devices have. The format is the Daylight Share protocol, revision 1.1
([`../share/PROTOCOL.md`](../share/PROTOCOL.md); what changed and why: [`../share/CHANGES-v1.1.md`](../share/CHANGES-v1.1.md)),
the same one the iPhone app, the Mac app and the browser extensions speak.

## Install

Download **`daylight-share.apk`** from the
[reader-experiment-latest release](https://github.com/12twelve12hi/MHW/releases/tag/reader-experiment-latest).

- **On the Daylight:** open the release page in the Daylight's browser, tap `daylight-share.apk`, open the download,
  and allow installs from the browser when Android asks (Settings › Install unknown apps). Open **Daylight Share**
  and choose **This is my Daylight**.
- **On an Android phone:** the same, then choose **Send from this phone**.

Every build is signed with the same key and has a higher version number, so a newer APK installs over the old one
and keeps your pairing and history.

## Pair

1. On the Daylight, the Inbox shows a QR code and a code like `E4AY-56TM-ADQP-5QSN-MY7B-CGPZ-UFRA`.
2. On the phone, open Daylight Share and tap **Scan the QR code** (or point the camera app at it: the
   `daylightshare://pair?...` link opens the app), or type the code.

A code scanned with the camera app or a tapped link is applied only after you confirm: the app shows the Daylight's
name, "Code starts E4AY. Check it matches the code on your Daylight.", the relay when it is not ntfy.sh, and, when the
phone already sends to a Daylight with another code, "This replaces …. Items not yet delivered to it will not be sent."
(button **Switch**). A link with the code you already use (a new relay or name) applies at once with "Pairing
updated". The same code keeps the history and sends what is pending through the new relay; another code deletes it.

Pair as many phones and computers as you like with the same code. **Reset pairing** on the Daylight makes a new
code; everything paired before has to pair again. Whoever has the code can send to your Daylight and read what is
sent to it, so the code is only shown on the Daylight.

## Send

- From any app: **Share › Send to Daylight**. A small card says "Sending to Daylight…" and then the item's status
  ("Sent · waiting for your Daylight"); the upload carries on in the background if you leave.
- In the app: paste a link and tap **Send link**, or tap **Send a file**.
- The history uses the words every Daylight Share app uses (CHANGES-v1.1 2.5): **Sending…**, **Sent · waiting for
  your Daylight**, **Delivered ✓** (the Daylight has it), **Waiting to send** (with why, and **Retry now** only when
  it failed for lack of a connection) and **Not delivered** (with why, and **Try again** when that can help).

Links go as links (the Reader downloads the article). **Files can be up to 9 MB** (before compression; text files are
compressed); a bigger file is refused before it is copied, with "Too big to send. Files can be up to 9 MB; this one
is 14.2 MB."

What the relay does, honestly: ntfy.sh takes files of up to 2 MB, so a file travels in parts of at most 1.9 MB, and
keeps them for 3 hours (links and small items for 12). Until the Daylight confirms an item, the phone sends it again:
links every 11 hours; files 3 hours 5 minutes after sending, again 3 hours 5 minutes later, then every 12 hours; for
up to 7 days. ntfy.sh also limits each network (a phone and a Daylight on the same Wi-Fi share it) to about 250
messages and 200 MB a day and 20 MB of files at a time; when that is used up, items wait ("A lot has been sent from
this network in the last few hours. It will send by itself in about 3 hours.") and stop after three tries.

## How items reach the Reader

The Inbox receives items when you open it, every 15 minutes in the background, and within seconds while the Inbox
is on screen or **Instant delivery** is on (a small permanent notification keeps a connection open; the Inbox then
offers **Allow running in the background**, because with the screen off Android otherwise pauses that connection). It stores
each item, acknowledges it (that is the sender's "Delivered ✓"), and hands it to the Daylight Reader:

| Item | Hand-off | What you see |
|---|---|---|
| Link | `SAVE_PAGE` with the URL and title (the Reader's read-later) | the Reader's small "Saved" card |
| Web page | `SAVE_PAGE` with the URL, the title and the page's HTML | the same; paywalled and logged-in pages work |
| Document | `ACTION_SEND` with the file, or `ACTION_SEND_MULTIPLE` (several at once, or **Add to the library as a batch**) | one document: the Reader imports it and opens it; several at once: the Reader's library ("N added"), which closes the document that was open |

Each item in the Inbox says **In your Reader ✓** only when the Reader confirmed it (`SAVE_PAGE` answered `saved` or
`duplicate`); documents and shared links get no answer from the Reader, so they say **Handed to the Reader**.

Every document hand-off starts the Reader's import in a fresh task (`FLAG_ACTIVITY_NEW_TASK |
FLAG_ACTIVITY_CLEAR_TASK`), and a document hand-off never starts within 25 seconds of the previous one: it waits, and
then hands over together whatever is waiting by then (logged as `documents: … waiting; next hand-off in N s`). Today's
Reader drops a document shared while its previous import is still pending (DEVICE-CHECKS.md, round 2).

If the Reader refuses `SAVE_PAGE` (read-later from the browser switched off in the Reader's settings), the Inbox
shares the link with the Reader instead. Builds that only have some entry points get what they support
(`SAVE_PAGE`, then a shared link, then `daylightreader://save`; for documents `ACTION_SEND_MULTIPLE` where it applies,
then `ACTION_SEND`, then `ACTION_VIEW`). Each item in the Inbox says which app got it and how. Without a Reader, items
stay in the Inbox with **Open with…**.

**Settings › Deliver to**: **Automatic** is the Daylight Reader (`com.daylightcomputer.reader`, then its suffixed
builds). The list also shows every other installed app that takes `SAVE_PAGE` or shared PDFs/EPUBs, with its package
name and what it takes, so a side-by-side copy such as `com.daylightcomputer.readerexperiment` is only ever chosen on
purpose. What the chosen app does not take goes to Automatic: a copy that answers `SAVE_PAGE` but takes no documents
gets the links and pages, and documents still go to the Daylight Reader (a non-Reader app counts as taking links only
through `SAVE_PAGE` or `daylightreader://save`). If the chosen app is uninstalled, Automatic applies.

### Why "Display over other apps"?

Android only lets an app open another app while you are looking at it. So:

- **Inbox on screen:** items go to the Reader as they arrive.
- **Inbox in the background, "Display over other apps" allowed** (the Inbox has a button for it): links and pages
  go to the Reader as they arrive; documents follow **Documents** (below).
- **Otherwise:** every item waits for a tap on its notification.

Every item that waits for a tap is announced at once, and once:

- **A notification** per item ("New PDF from iPhone: <title>" / "Tap to add to the Reader"), grouped under "3 new from
  iPhone" when there are several. Tapping one hands that item over; tapping the group hands over the ones it lists. They
  use the **New items** channel at high importance, so they can pop up over the full-screen Reader; if notifications
  are off or the channel was turned down, the Inbox says so and links to the setting.
- **A card over the Reader**, with "Display over other apps" (the Daylight's setup): "New PDF from iPhone", the title,
  **Add to Reader** and **Later**. A heads-up notification shows for a few seconds and an e-paper reader can miss it (or
  the system may not show it over a full-screen app); the card stays until answered. It takes no keyboard focus and
  touches outside it go to the Reader. While the card is up, the notifications are posted without popping up. **Later**
  takes it down for those items (they wait in the Inbox and in the notification shade).

Only an item never announced before alerts. A notification swiped away does not come back, one that is up is not posted
again, and an item whose hand-off is running is not announced meanwhile.

**Documents** (on the Inbox screen), for documents that arrive while another app is in front:

| Choice | What happens | Hand-off (`via`) |
|---|---|---|
| **Ask with a notification** (default) | the notification and the card above; a tap hands the document over and the Reader opens it | `send_file` (`send_multiple` for several) |
| **Add to the library as a batch** | handed over at once as a batch, even a single document | `send_multiple` |
| **Open as they arrive** | handed over at once; the Reader imports and opens it | `send_file` |

What the Reader does with a batch is its own decision, and today's Daylight Reader (public source: `ImportActivity`,
`ImportViewModel`, `ReaderLauncher.libraryIntent`) treats `ACTION_SEND` and `ACTION_SEND_MULTIPLE` alike and decides by
how many documents arrive together. One document is followed into the reader and opened. Two or more go to the library
("N added"), which it brings forward in its main task with `CLEAR_TOP`, and that closes the document being read. So
**Add to the library as a batch** is not quiet with today's Reader in either case; it is there for a Reader build that
adds a batch without opening anything, and asking is the default. The earlier switch
"Open documents as they arrive", when it was on, carries over as **Open as they arrive**.

### When nothing arrives

The Inbox says why, in one sentence: "Offline. New items will arrive when this Daylight is back online.", "Too much has
gone through this network for now. New items will arrive later.", "The relay isn’t working right now (error 502). It
will keep trying.", or "Your Daylight is out of space, so new items can’t be saved. Free some space." (an item that
could not be stored is not acknowledged; it comes back with the sender's next re-send).

**Settings › Relay** on the Inbox checks a relay other than ntfy.sh before saving it: it sends a 2 MB test file through
it and downloads it again, and keeps the old relay with a sentence when that fails (too small a file limit, files
turned off, a login needed, or files the Daylight can't download). A relay saved before this check existed is checked
once in the background, and only a warning shows if it fails.

## Build

Requirements: JDK 17 or 21. The protocol module needs nothing else; the APK needs the Android SDK (platform 35).

```sh
cd reader-experiment/android
./gradlew :share-core:test          # protocol tests: vectors, mock relay (needs node), JS interop
./gradlew :app:assembleRelease      # needs ANDROID_HOME or sdk.dir in local.properties
./gradlew :app:testDebugUnitTest    # Robolectric: share parsing, Reader routing, hand-off and notification decisions, every screen composes
```

Without an Android SDK, Gradle builds only `:share-core`. `DLS_LIVE_RELAY=https://ntfy.sh ./gradlew :share-core:test
--tests '*LiveRelayTest*'` runs a round trip through a real relay.

CI (`.github/workflows/rx-android.yml`) runs the tests, builds both APKs, uploads them as workflow artifacts
(`daylight-share-apk` and `daylight-share-debug-apk`, the latter containing `daylight-share-debug.apk`), publishes
`daylight-share.apk` to the release, and tries a live round trip through ntfy.sh.

### Layout

- `share-core/`: the protocol in plain Kotlin/JVM, no Android classes, no dependencies, so the Reader can embed it:
  `Pairing`, `Keys`, `FrameCodec`, `ItemHeader`, `ItemBuilder`/`PreparedItem`, `Reassembler`, `RelayClient`,
  `Outbox` (sender) and `Receiver` (Inbox), plus `RowText` (the shared status words), `PairingConfirmation` and
  `RelayProbe` (the Inbox's relay check).
- `app/`: Compose UI (`ui/`), the share target and outbox (`sender/`), the Inbox (`inbox/`: receiving, live
  connection, Instant delivery service, hand-off to the Reader), WorkManager jobs (`Work.kt`).

### Debug builds: setup without the UI

For automated tests, debug builds accept

```
adb shell am start -a android.intent.action.VIEW \
  -n com.daylight.share/.ui.MainActivity -d "daylightshare://setup?role=inbox&c=<28-character code>&r=http%3A%2F%2F10.0.2.2%3A8787&n=CI&instant=1&auto=1"
```

which makes the device the Inbox with that pairing secret and relay (`role=sender` pairs a sender instead;
`instant=1` turns on Instant delivery; `docs=ask|quiet|open` sets **Documents**, and `auto=1` / `auto=0` mean
`docs=open` / `docs=ask`; `to=<package>` sets **Deliver to**, `to=` puts it back to Automatic). Debug builds also allow
plain HTTP to `10.0.2.2`, `127.0.0.1` and `localhost`. The setup link also skips the
notification-permission prompt. Everything is logged under the tag `DaylightShare` (`adb logcat -s DaylightShare`):

```
received <id> kind=<url|page|file> from=<sender> size=<bytes> stored
received <id> kind=<url|page|file> -> handed to <package> via <save_page|send_link|view_link|send_file|send_file_octet|view_file|send_multiple> status=<saved|duplicate|queued|refused|sent|ok|no_answer>[ docs=<ask|quiet|open>] by=<front|auto|tap|card>
received <id> kind=<...> -> waiting for a tap (<card + notification|notification|card|notifications off>)[ docs=<ask|quiet|open>]
received <id> -> notification dismissed: waits in the Inbox
received <id> kind=<...> -> kept in inbox (no reader installed) status=no_reader
```

`docs=` (documents only) is the **Documents** choice at the time; `by=` says whether the Inbox was in front, handed
over in the background on its own, a notification was tapped, or the card's **Add to Reader**. "waiting for a tap" is
logged once per item, when it is first announced, and says where.

A refused `SAVE_PAGE` logs `status=refused` and then the `send_link` retry. Items reach the Reader at once while the
Inbox is in front; for background hand-offs in a test, `adb shell appops set com.daylight.share SYSTEM_ALERT_WINDOW
allow` and use `instant=1&auto=1` (or `docs=quiet`). With `docs=ask` and that permission, the card comes up over the
app in front (a window titled "Daylight Share" in `adb shell dumpsys window windows`). Without the permission, open the shade with
`adb shell cmd statusbar expand-notifications` and tap the item's notification; on an emulator after `adb root`, the
same tap is `adb shell am start -n com.daylight.share/.inbox.HandoffActivity --es mode one --es item <id>` (the activity
is not exported, so only root may start it). Release builds ignore setup links and only speak HTTPS.
