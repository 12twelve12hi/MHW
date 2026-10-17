# Send to Daylight for iPhone and Mac

Share articles, web pages and documents from an iPhone or a Mac to your Daylight DC-1. Items are end-to-end encrypted
and travel through an ntfy relay to the **Daylight Share** inbox on the tablet, which hands them to the Daylight Reader
(see [`../share/PROTOCOL.md`](../share/PROTOCOL.md)).

## What's here

| Target | What it does |
|---|---|
| **Send to Daylight** (iPhone, iOS 16+) | Pair by scanning the Daylight's QR code with the camera, typing/pasting the code, or opening a `daylightshare://pair?…` link. Send a link or a file (PDF, EPUB, DOCX, Markdown, HTML, text…). History with *Sent*, *Delivered ✓* and *Not delivered* + Retry. Settings: this device's name, the relay, unpair. Re-sends what the Daylight has not acknowledged on launch, while open, and with background app refresh. |
| **Daylight** share sheet item (iOS Share Extension) | In the share sheet of Safari and other apps for web pages, links and documents. From Safari it sends the page as you see it (its HTML, captured by `GetPage.js`), so paywalled and logged-in articles work; links from other apps go as links; files as files. Shows "Sending to <your Daylight>… → Sent ✓" and closes. If the app isn't paired yet, you can paste the code right there. |
| **Send to Daylight** Safari extension (iOS) | The shared WebExtension from [`../extension`](../extension) packaged for Safari on iPhone. It reads the pairing from the app, so you pair once. |
| **Send to Daylight** (Mac, macOS 13+) | A window and a menu bar item. Pair by pasting the code or a `daylightshare://` link. Drop PDFs, documents, `.webloc` files or links on the window or on the Dock icon; "Send Clipboard Link" (⇧⌘L in the menu bar item); history; settings. Re-sends unacknowledged items every minute while it runs. |
| **Daylight** Share menu item (macOS Share Extension) | Share › Daylight in Safari, Finder, Preview and other apps: links, pages and files. |
| **Send to Daylight** Safari extension (Mac) | The same WebExtension in Safari on the Mac; its native handler answers the extension's `getPairing` message with the app's pairing. |
| `DaylightShareKit` (Swift package) | The protocol: pairing codes and links, SHA-256 and AES-256-GCM (CryptoKit), raw DEFLATE (Apple's Compression `COMPRESSION_ZLIB`, which is RFC 1951 raw deflate — the tests check it against zlib and the JS vectors), base32/base64, frames, reassembly, the ntfy relay client, the outbox with acks and re-sends, and shared storage. `DaylightShareUI` holds the SwiftUI pieces the apps and extensions share. |

The apps and their extensions share the pairing, settings and outbox through the App Group
`group.com.daylight.share`. Without it (unsigned or ad-hoc builds, or a sideloading tool that renames the group and
isn't picked up), each part stores its own pairing: the Share extension then asks for the code the first time.

## Install on a Mac

1. Download **`Send-to-Daylight-mac.zip`** from the
   [latest builds](https://github.com/12twelve12hi/MHW/releases/tag/reader-experiment-latest) and open it.
2. Move **Send to Daylight.app** to **Applications**.
3. The build is ad-hoc signed, not notarized: the first time, **right-click › Open** and confirm (on macOS 15, if it
   is still blocked: System Settings › Privacy & Security › *Open Anyway*). If macOS asks whether Send to Daylight may
   "access data from other apps", allow it: that is the shared App Group with its own extensions.
4. On the Daylight, open Daylight Share › **This is my Daylight**; paste its code (or the `daylightshare://` link)
   into the app.
5. **Share menu:** System Settings › General › Login Items & Extensions › Sharing (macOS 15; on 13–14: Privacy &
   Security › Extensions › Sharing) › turn on **Daylight**.
6. **Safari extension:** Safari › Settings › Advanced › turn on *Show features for web developers*; then Safari ›
   Settings › **Developer** › *Allow unsigned extensions* (older Safari: Develop menu › Allow Unsigned Extensions).
   Safari forgets this when it quits, so do it again after restarting Safari. Then Safari › Settings › Extensions ›
   turn on **Send to Daylight**. With a signed build (below) the unsigned-extensions step is not needed. The app's
   Settings show whether the extension is on and open the right panes.

## Install on an iPhone

**Sideload the unsigned build** (no Mac needed for AltStore's iPhone side, a free Apple ID is enough):

1. Download **`Send-to-Daylight-unsigned.ipa`** from the
   [latest builds](https://github.com/12twelve12hi/MHW/releases/tag/reader-experiment-latest).
2. Install it with [AltStore](https://altstore.io) (My Apps › +) or [Sideloadly](https://sideloadly.io) (drag the ipa
   in, sign in with your Apple ID). They re-sign it with your Apple ID. A free Apple ID allows 3 sideloaded apps and
   10 app IDs a week; this app uses 3 IDs (app, share extension, Safari extension). Free-account apps expire after 7
   days: AltStore refreshes them, Sideloadly needs a re-install.
3. The first time, iOS asks you to trust the developer: Settings › General › VPN & Device Management.
4. Open **Send to Daylight**, tap **Scan the QR code** and point it at the Daylight (or type the code).
5. In Safari or any app: Share › **Daylight** (if you don't see it, scroll the app row to *More* and turn it on).

**Or build it yourself** on a Mac with Xcode 16 or newer:

```sh
brew install xcodegen
cd reader-experiment/apple
cp Config/Signing.local.xcconfig.example Config/Signing.local.xcconfig   # set DEVELOPMENT_TEAM (and, if needed,
xcodegen                                                                    # DAYLIGHT_BUNDLE_ID / DAYLIGHT_APP_GROUP)
open SendToDaylight.xcodeproj
```

Pick the **SendToDaylight-iOS** scheme and your iPhone, and Run. Xcode's automatic signing registers the bundle ids
and the App Group in your team (bundle ids and App Group ids are global: if `com.daylight.share` is taken, set your
own `DAYLIGHT_BUNDLE_ID` and `DAYLIGHT_APP_GROUP` in `Signing.local.xcconfig`). The **SendToDaylight-macOS** scheme
builds the Mac app the same way. To enable the Safari extension on the iPhone: Settings › Apps › Safari › Extensions
› Send to Daylight.

## TestFlight (later)

The workflow uploads the iPhone app to TestFlight on every build once these repository secrets exist
(Settings › Secrets and variables › Actions):

| Secret | What |
|---|---|
| `APPLE_TEAM_ID` | Your team id (developer.apple.com › Membership) |
| `ASC_KEY_ID`, `ASC_ISSUER_ID` | An App Store Connect API key (Users and Access › Integrations › App Store Connect API), role **Admin** (needed for cloud-managed signing) |
| `ASC_KEY_P8` | The contents of that key's `AuthKey_<id>.p8` file |

Optional repository *variables* `DAYLIGHT_BUNDLE_ID` and `DAYLIGHT_APP_GROUP` override the defaults. Before the
first upload, create the app in App Store Connect with the same bundle id (Apps › + › New App). The job archives
with automatic signing (`-allowProvisioningUpdates` and the API key), exports with `method app-store-connect` and
`destination upload`, and the build appears in TestFlight after processing. Without the secrets the job is skipped.

## Development

```sh
cd reader-experiment/apple/DaylightShareKit
swift test                                   # vectors, fake relay, outbox, zlib cross-checks
node ../../share/js/mock-relay.mjs &         # a local ntfy stand-in on :8787
DLS_E2E_RELAY=http://127.0.0.1:8787 swift test --filter EndToEnd   # Swift sender -> relay -> JS receiver -> acks
```

The Swift tests read the vectors straight from `../share/vectors/test-vectors.json`, so they always test the
committed protocol. The Safari extension targets copy `../extension/dist/safari` into the extension bundle at build
time (`scripts/copy-web-extension.sh`; run `npm run build` in `../extension` first); without it a placeholder goes in.

CI ([`.github/workflows/rx-apple.yml`](../../.github/workflows/rx-apple.yml)) runs the tests, builds the iPhone app for
the simulator and for devices, builds the Mac app, smoke-tests both (launch, pair through a `daylightshare://` link in
the simulator), and publishes `Send-to-Daylight-unsigned.ipa` and `Send-to-Daylight-mac.zip` to the release.

### Notes

- The Safari extension's native handler answers `{type: "getPairing"}` with
  `{ok, paired, pairing: {code, link, relay, name}, from}`, `{type: "setPairing", code|link, relay?, name?}` stores a
  pairing made in the extension for the app too, and `{type: "ping"}` reports the app version.
- Pairing with a different code or relay drops items still queued for the old Daylight (as the browser extension does).
- Expired items keep their content for 30 days so *Try again* still works; delivered items keep only a history row.
