# Reader experiment: Send to Daylight

Share an article, a web page or a PDF from your iPhone, Android phone, Mac or browser, and it shows up in the
Daylight Reader on your Daylight DC-1.

```
 iPhone app / share sheet ─┐
 Android phone share sheet ┤                          ┌──────────────────── Daylight DC-1 ─────────────────────┐
 Mac app / Share menu      ┼─ encrypted ─▶ ntfy.sh ──▶│ Daylight Share (Inbox) ──▶ Daylight Reader library     │
 Chrome / Safari extension ┤   (relay)                │   receives, acks, hands    "Save to Reader" for links/  │
 Web page (+ iPhone        ┘                          │   each item to the Reader  pages, import for files      │
   Shortcut)                                          └────────────────────────────────────────────────────────┘
```

- **Nothing to sign up for.** Items travel through [ntfy.sh](https://ntfy.sh), a free push relay, or any
  ntfy server you run yourself.
- **End-to-end encrypted.** The relay only sees random topic names and ciphertext. The key comes from the pairing
  code that only your Daylight shows.
- **Nothing gets lost while the Daylight sleeps.** The Daylight confirms every item it receives; senders re-send
  anything unconfirmed before the relay forgets it (ntfy.sh keeps messages 12 hours and files 3 hours), for up to a
  week.
- **Web pages arrive as you saw them.** The browser extensions and the iPhone share sheet send the page itself, so
  paywalled and logged-in articles work; a plain link makes the Reader fetch the article.

## Downloads

All builds: <https://github.com/12twelve12hi/MHW/releases/tag/reader-experiment-latest>

| Where | Install | File |
|---|---|---|
| Daylight DC-1 | **Daylight Share**, choose "This is my Daylight" | `daylight-share.apk` |
| Android phone | **Daylight Share**, choose "Send from this phone" | `daylight-share.apk` (the same app) |
| Chrome (any computer) | **Send to Daylight** extension | `send-to-daylight-chrome.zip` |
| Mac | **Send to Daylight** app with its Share menu item and Safari extension | `Send-to-Daylight-mac.zip` |
| Windows PC | **Send to Daylight** tray app with File Explorer's *Send to › Daylight* and a clipboard-link hotkey | `Send-to-Daylight-windows-setup.exe` |
| iPhone | **Send to Daylight** app with its share sheet item (and Safari extension) | `Send-to-Daylight-unsigned.ipa` |
| Anything with a browser | **Web sender** page (and an iPhone Shortcut) | `send-to-daylight-web.zip` |

Install steps for each are in the README next to its code (see the table at the end).

## Set up in two minutes

1. **On the Daylight:** download `daylight-share.apk` in the browser, open it, allow the install. Open Daylight Share
   and choose **This is my Daylight**. It shows a QR code and a 28-character pairing code.
2. **On each device you send from:** install its app or extension and pair it, either by scanning the QR code or by
   typing the code.
3. **Share** from any app or browser: pick *Daylight* (Android, iPhone, Mac) or click the extension's button. The
   Daylight Inbox picks it up and the Reader saves it to your library.

## What lives where

| Folder | What |
|---|---|
| `share/` | The protocol: [`PROTOCOL.md`](share/PROTOCOL.md), the JavaScript reference implementation, a local stand-in for the relay, and the cross-platform test vectors |
| `android/` | Daylight Share for Android: the phone sender and the DC-1 Inbox (Kotlin) |
| `apple/` | Send to Daylight for iPhone and Mac, their share extensions and Safari extensions (SwiftUI, XcodeGen) |
| `extension/` | The Chrome and Safari browser extension |
| `web/` | The web sender page |
| `e2e/` | The end-to-end test: the Daylight Reader (built from its public source snapshot) and the Inbox on an Android emulator |

CI (`.github/workflows/rx-*.yml`) builds and tests each part on every push to this branch and publishes the files
above to the release.
