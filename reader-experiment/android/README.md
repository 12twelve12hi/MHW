# Daylight Share for Android

One APK, two jobs:

- **On a phone: "Send to Daylight".** It appears in Android's share menu. Share a link, a web page's address, a PDF,
  an EPUB, a Word document, Markdown, HTML, plain text or any other file, and it goes to your Daylight.
- **On the Daylight DC-1: the Daylight Inbox.** It shows the pairing code, receives what your phones and computers
  send, and hands each item to the Daylight Reader.

Items travel through an [ntfy](https://ntfy.sh) relay (free, no account), end-to-end encrypted with a key only your
devices have. The format is the Daylight Share protocol, [`../share/PROTOCOL.md`](../share/PROTOCOL.md), the same
one the iPhone app, the Mac app and the browser extensions speak.

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

Pair as many phones and computers as you like with the same code. **Reset pairing** on the Daylight makes a new
code; everything paired before has to pair again. Whoever has the code can send to your Daylight and read what is
sent to it, so the code is only shown on the Daylight.

## Send

- From any app: **Share › Send to Daylight**. A small card says "Sending to Daylight…" and then "Sent ✓"; the
  upload carries on in the background if you leave.
- In the app: paste a link and tap **Send link**, or tap **Send a file**.
- The history shows **Sent** (on the relay), **Delivered ✓** (the Daylight has it) or **Not delivered** with
  **Retry**. Items the Daylight has not picked up are sent again before the relay forgets them (ntfy.sh keeps
  messages 12 hours, attachments 3 hours) for up to 7 days.

Links go as links (the Reader downloads the article). Files up to 64 MB go as they are; text files are compressed.

## How items reach the Reader

The Inbox receives items when you open it, every 15 minutes in the background, and within seconds while the Inbox
is on screen or **Instant delivery** is on (a small permanent notification keeps a connection open). It stores
each item, acknowledges it (that is the sender's "Delivered ✓"), and hands it to the Daylight Reader:

| Item | Hand-off | What you see |
|---|---|---|
| Link | `SAVE_PAGE` with the URL and title (the Reader's read-later) | the Reader's small "Saved" card |
| Web page | `SAVE_PAGE` with the URL, the title and the page's HTML | the same; paywalled and logged-in pages work |
| Document | `ACTION_SEND` with the file | the Reader imports it and opens it; several at once go to the library |

If the Reader refuses `SAVE_PAGE` (read-later from the browser switched off in the Reader's settings), the Inbox
shares the link with the Reader instead. Builds that only have some entry points get what they support
(`SAVE_PAGE`, then a shared link, then `daylightreader://save`; for documents `ACTION_SEND`, then `ACTION_VIEW`).
**Settings › Deliver to** picks one Reader when several are installed. Each item in the Inbox says which app got it
and how. Without a Reader, items stay in the Inbox with **Open with…**.

### Why "Display over other apps"?

Android only lets an app open another app while you are looking at it. So:

- **Inbox on screen:** items go to the Reader as they arrive.
- **Inbox in the background, "Display over other apps" allowed** (the Inbox has a button for it): links and pages
  go to the Reader as they arrive. Documents wait for a tap, because the Reader opens every document it imports;
  turn on **Open documents as they arrive** to change that.
- **Otherwise:** a notification ("2 new from iPhone — tap to add to Reader"); tapping it does the hand-off.

## Build

Requirements: JDK 17 or 21. The protocol module needs nothing else; the APK needs the Android SDK (platform 35).

```sh
cd reader-experiment/android
./gradlew :share-core:test          # protocol tests: vectors, mock relay (needs node), JS interop
./gradlew :app:assembleRelease      # needs ANDROID_HOME or sdk.dir in local.properties
```

Without an Android SDK, Gradle builds only `:share-core`. `DLS_LIVE_RELAY=https://ntfy.sh ./gradlew :share-core:test
--tests '*LiveRelayTest*'` runs a round trip through a real relay.

CI (`.github/workflows/rx-android.yml`) runs the tests, builds both APKs, uploads them as workflow artifacts
(`daylight-share-apk` and `daylight-share-debug-apk`, the latter containing `daylight-share-debug.apk`), publishes
`daylight-share.apk` to the release, and tries a live round trip through ntfy.sh.

### Layout

- `share-core/`: the protocol in plain Kotlin/JVM, no Android classes, no dependencies, so the Reader can embed it:
  `Pairing`, `Keys`, `FrameCodec`, `ItemHeader`, `ItemBuilder`/`PreparedItem`, `Reassembler`, `RelayClient`,
  `Outbox` (sender) and `Receiver` (Inbox).
- `app/`: Compose UI (`ui/`), the share target and outbox (`sender/`), the Inbox (`inbox/`: receiving, live
  connection, Instant delivery service, hand-off to the Reader), WorkManager jobs (`Work.kt`).

### Debug builds: setup without the UI

For automated tests, debug builds accept

```
adb shell am start -a android.intent.action.VIEW \
  -n com.daylight.share/.ui.MainActivity -d "daylightshare://setup?role=inbox&c=<28-character code>&r=http%3A%2F%2F10.0.2.2%3A8787&n=CI&instant=1&auto=1"
```

which makes the device the Inbox with that pairing secret and relay (`role=sender` pairs a sender instead;
`instant=1` turns on Instant delivery, `auto=1` hands documents over in the background too). Debug builds also allow
plain HTTP to `10.0.2.2`, `127.0.0.1` and `localhost`. Every hand-off is logged under the tag `DaylightShare`:

```
received <id> kind=<url|page|file> -> handed to <package> via <save_page|send_link|view_link|send_file|send_file_octet|view_file|send_multiple> status=<saved|duplicate|queued|refused|sent|ok|no_answer>
```

(`adb logcat -s DaylightShare`). Release builds ignore setup links and only speak HTTPS.
