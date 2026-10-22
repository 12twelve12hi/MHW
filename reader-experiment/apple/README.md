# Send to Daylight for iPhone and Mac

Share articles, web pages and documents from an iPhone or a Mac to your Daylight DC-1. Items are end-to-end encrypted
and travel through an ntfy relay to the **Daylight Share** inbox on the tablet, which hands them to the Daylight Reader
(see [`../share/PROTOCOL.md`](../share/PROTOCOL.md)).

## What's here

| Target | What it does |
|---|---|
| **Send to Daylight** (iPhone, iOS 16+) | Pair by scanning the Daylight's QR code, typing/pasting the code, or opening a `daylightshare://pair?…` link (which asks first). Send a link or a file (PDF, EPUB, DOCX, Markdown, HTML, text… up to 9 MB). History with the same words as every Send to Daylight app (*Sent · waiting for your Daylight*, *Delivered ✓*, *Waiting to send*, *Not delivered*, with *Retry now* or *Try again* where they help). Settings: this device's name, the relay, unpair, and Comfort (see [Accessibility and Comfort](#accessibility-and-comfort)). Re-sends what the Daylight has not acknowledged on launch, while open, and with background app refresh. |
| **Daylight** share sheet item (iOS Share Extension) | In the share sheet of Safari and other apps for web pages, links and documents. From Safari it sends the page as you see it (its HTML, captured by `GetPage.js`), so paywalled and logged-in articles work; links from other apps go as links; files as files (up to 9 MB, refused at once above). Shows "Sending to <your Daylight>…", then the item's status in the words the app's history uses (*Sent · waiting for your Daylight*: it reached the relay, not yet the Daylight; *Delivered ✓* if the Daylight already acknowledged it) and closes, or the item's status and sentence when it could not go yet (or *This device is out of space, so it can’t send this.* when the file cannot be copied). If the app isn't paired yet, you can paste the code right there; a shared `daylightshare://` link pairs after you confirm. |
| **Send to Daylight** Safari extension (iOS) | The shared WebExtension from [`../extension`](../extension) packaged for Safari on iPhone. It reads the pairing from the app, so you pair once. |
| **Send to Daylight** (Mac, macOS 13+) | A window and a menu bar item. Pair by pasting the code or a `daylightshare://` link. Drop PDFs, documents, `.webloc` files or links on the window or on the Dock icon; "Send Clipboard Link" (⇧⌘L in the menu bar item); history; settings, Comfort included, with **Lab** first (see [Lab on the Mac](#lab-on-the-mac)). Re-sends unacknowledged items every minute while it runs. |
| **Daylight** Share menu item (macOS Share Extension) | Share › Daylight in Safari, Finder, Preview and other apps: links, pages and files. Team-signed builds use the app's pairing (and its Lab switch); the released (ad-hoc) build asks for the code once and remembers it, and has its own Lab switch. |
| **Send to Daylight** Safari extension (Mac) | The same WebExtension in Safari on the Mac; its native handler answers the extension's `getPairing` message with the app's pairing. |
| `DaylightShareKit` (Swift package) | The protocol: pairing codes and links, SHA-256 and AES-256-GCM (CryptoKit), raw DEFLATE (Apple's Compression `COMPRESSION_ZLIB`, which is RFC 1951 raw deflate — the tests check it against zlib and the JS vectors), base32/base64, frames, reassembly, the ntfy relay client, the outbox with acks and re-sends, and shared storage. `DaylightShareUI` holds the SwiftUI pieces the apps and extensions share. |

### Pairing once: App Groups

The apps and their extensions share the pairing, settings and outbox through an App Group, so pairing in the app also
pairs the Share menu / share sheet item and the Safari extension. Which group a build uses is decided at build time
(`Config/Base.xcconfig`, with comments):

| Build | App Group | What you notice |
|---|---|---|
| iPhone (any) | `group.com.daylight.share` (`DAYLIGHT_APP_GROUP`; sideloading tools may rename it, the app finds the new name in its provisioning profile) | Pair once in the app. |
| Mac, signed with your team (`DEVELOPMENT_TEAM` set) | `<TEAMID>.com.daylight.share` (`DAYLIGHT_MAC_APP_GROUP`) | Pair once in the app. No prompt, nothing to register: macOS accepts a Team-ID-prefixed group from a team signature. |
| Mac, ad-hoc signed or unsigned (the released `Send-to-Daylight-mac.zip`, any build without a team) | none | The app, its Share menu item and its Safari extension each keep their own pairing: paste the code into the Share menu item once (it says so and remembers it), and pair the Safari extension in its popup. Items sent from the Share menu don't show in the app's history. |

**Why the Mac has two cases (macOS 15).** macOS 15 checks App Group access against the code signature. An iOS-style
`group.` id in an ad-hoc signed app is not authorised, so the first access to its container brings up *"Send to
Daylight would like to access data from other apps"*, and the access waits for the answer. Version 1.0 did that on
the main thread at launch, so the app hung (no window, nothing paired or sent) until someone clicked *Allow*. Now:

- ad-hoc and unsigned Mac builds have no App Group at all (no entitlement, empty `DaylightAppGroup` in Info.plist),
  so nothing can trigger the prompt; CI checks the released app for both;
- a team-signed build uses the Team-ID-prefixed group, which macOS validates without asking, and the code only opens
  a group that the process's own entitlements list and its signing team authorises;
- storage is never resolved on the main thread, in the app or any extension: `SharedStore` starts on the process's
  own storage, looks for the group on a background queue, and switches to it only if it answers within 2 seconds.
  The window appears at once; pairing and sending wait (asynchronously) for that decision. A pairing made earlier
  without the group (say, with an ad-hoc build) moves into the group the first time a team-signed build finds it
  empty.

## What's new in 1.1

Version 1.1 follows protocol revision 1.1 ([`../share/CHANGES-v1.1.md`](../share/CHANGES-v1.1.md)); nothing changes on
the wire, so 1.1 apps work with 1.0 Daylights and senders.

- **Files up to 9 MB**, for every relay. ntfy.sh takes 2 MB per attachment, so items go in parts of 1.9 MB. A larger
  file is refused at once, before it is read: *"Too big to send. Files can be up to 9 MB; this one is 14.2 MB."*
  (1.0 promised 64 MB, and anything over about 2 MB failed on ntfy.sh.)
- **The same words everywhere**: the history, banners and the share sheet show each item's status with the sentence
  every Send to Daylight app uses, and a button only where it helps (*Retry now* after a network failure, *Try again*
  on an item that was not delivered).
- **Pairing links ask first.** A `daylightshare://` link from outside the app (the camera, a tapped link, a link shared
  to the share sheet) pairs only after you confirm the Daylight's name and the first group of its code. A code typed on
  the pairing screen asks only when it would replace a Daylight with another code. Pairing again with the same code (a
  new relay or name) applies at once and keeps the items still on their way; another code drops them.
- **Re-sends follow the relay's limits**: a busy or full relay is retried every 3 hours and given up after three
  tries, with a sentence that says so; nothing loops for a week.
- **Mac: no storage access on the main thread.** Besides the App Group fix below, the app now reads its pairing,
  settings and history on a background queue at launch and afterwards; CI checks that the running app never touched
  storage on its main thread.

### Updating from 1.0 on a Mac: pair again

If you used the 1.0 Mac app and clicked **Allow** when it asked to *"access data from other apps"*, 1.0 kept its
pairing and history in the App Group container `~/Library/Group Containers/group.com.daylight.share`. The released 1.1
build has no App Group (see below), so it cannot read that container and it starts **unpaired**: paste your pairing
code (or the `daylightshare://` link) from the Daylight into the app again, and once into the Share menu item. Items
1.0 had not delivered are not carried over; send them again. The old container can then be moved to the Trash. (If you
never clicked *Allow*, 1.0 never got that far and there is nothing to move.) iPhone builds keep their App Group, so
the iPhone app stays paired.

A relay address that 1.0 accepted but 1.1 refuses when typed (for example one with an underscore in its host name,
such as `http://ntfy_box:8080`) keeps working: a saved pairing is read with the relay as 1.0 saved it, so updating
never quietly unpairs anyone or drops the items still on their way.

## Accessibility and Comfort

Every build, with Lab on or off, has the same accessibility baseline (LAB-PLAN F27; it is not a Lab feature):

- **Comfort**, a switch in Settings (iPhone, iPad and Mac), off by default: *"Larger text and buttons, more contrast,
  no motion."* On iPhone and iPad text stays between xxLarge and accessibility3 whatever the system size; on the Mac
  (where text styles do not follow Dynamic Type) every text style is about 30% larger. Buttons are large, at least
  52 × 52 pt, and standalone ones get a 2 pt border; secondary grey text becomes primary; nothing animates (spinners
  become words). Turning Lab off leaves it as it is. The share sheet item and the Share menu item follow it when they
  share the app's storage (an App Group). Where they cannot (the released ad-hoc Mac build, a sideloaded iPhone build
  without the group), the card counts as an app of its own (LAB-PLAN 1.1) and has its **own Comfort switch**, with the
  same footer, under the pairing form, a result or a note: it is kept in the extension's own storage.
- **Every control has a label** for VoiceOver, decorative images are hidden from it, and headings are marked. On
  iPhone and iPad each history row's words are one element, read in one go: its title, its site rather than the whole
  link, its label and its sentence, with its age as the value ("A long read, example.com, Waiting to send. Couldn't
  send right now. It will try again by itself.", "Today at 1:05 PM"); its *Retry now* or *Try again* stays a button of its
  own. (The row's swipe action, Remove, is offered on each element of a row, which made each small line of text a
  target too small to hit.) On the Mac each text stays an element, as VoiceOver reads a table row's cells.
- **States in words and glyphs**, never colour alone: each history row's label (*Delivered ✓*, *Waiting to send*,
  *Not delivered*) comes after a glyph for its state, and errors carry a warning sign.
- **Nothing in a history row is cut short or runs on by itself**: a row shows its whole title, where it is from (a
  link's site, *example.com*, rather than a whole address cut off after one line; a file's name and size) and when it
  was shared in the system's words (*Today at 1:05 PM*), which never changes on screen, where 1.1 showed a count of
  seconds (*10 min, 13 sec*) that changed every second on screen and under VoiceOver. The state and the time sit side
  by side, or one under the other where they do not fit, so no word is broken.
- **Status labels wrap** instead of being cut, at every text size: at accessibility sizes (and in Comfort) a row's
  button moves under its text (on the Mac it is always there), label/value rows stack, and the pairing buttons
  stack.
- **Status changes are said out loud**: every banner (*Paired with …*, *Sent · waiting for your Daylight*, an error),
  a row that becomes *Delivered ✓* or *Not delivered* ("Delivered ✓, <title>"), and the share sheet's outcome with its
  note, once (*Sent · waiting for your Daylight. The page is larger than 8 MB, so its link was sent.*). *In your
  Reader* comes with the Lab timeline (F01, Wave 1): v1.1 rows do not know it, so `Announcer.changes` cannot say it
  yet; A3 extends it when `TimelineRow` arrives, and A4 and A5 check it in the apps.
- **Typing the pairing code is always offered**, next to the QR code on the iPhone, as the way to pair on the Mac,
  and in the share sheet.

## Lab on the iPhone and iPad (Wave 0)

The iPhone app has the Lab switch (LAB-PLAN 1, card A1), **on by default**. This build is Lab's Wave 0: it adds the
switch and the Daylight server's setup, and changes nothing about sending yet. Wave 1 (A4) brings the features.

- **Settings › Lab**, the first section: the switch, its footer (*New features we’re trying out. Turn Lab off for
  the plain app; nothing you sent is lost.*) and, while Lab is on, **What’s in Lab ›** and **Daylight server ›**
  (*Optional · Not set up*, or the server's short state). Turning Lab off hides them and deletes nothing: the pairing,
  the history, the Lab ledger and the server's pin stay, and Comfort is not part of Lab. The share sheet item follows
  the app's switch through the App Group; it has no switch of its own (a sideloaded build without the group starts on).
- **What’s in Lab** lists the server features from the start, as LAB-DECISIONS asks: *Files over 9 MB*, *Summaries
  with Claude*, *Email-in address*, *Feeds and daily digest*, under *With your Daylight server (optional)*, with the
  server's short state. Its first line is your Daylight's Lab state (*Needs Lab on your Daylight* until Daylight Share
  on the DC-1 says hello with Lab on, then *Your Daylight: Lab on · checked in 4 min ago*). Nothing there says how to
  set anything up until you tap a feature: then its one sentence shows under it (*Needs your Daylight server. Add the
  Cloudflare secrets to turn this on (Lab › Daylight server shows how).*, with **Copy Server code**), and is read out by
  VoiceOver. With no server reachable it says so within 5 seconds.
- **Daylight server** is where setup happens: the state in full (with the secrets' names), *Set up with a link*, the
  steps, the **Server code** with **Copy** (the `daylightserver://` link form when the relay isn't ntfy.sh), the
  optional *Server address* and the deploy's re-run help. Every word is LAB_TEXT's (`share/js/daylight-lab.js`) or the
  server module's, through `DaylightShareUI` (`LabSettingsSection`, `WhatsInLabView`, `ServerSettingsView`).
- **No one-time note** in this build: `LabBuild.LAB_NOTE_ENABLED` (`iOS/App/SendToDaylightApp.swift`) is false
  until the app has F01 or F04 (LAB-PLAN 1.2). Home's note slot (`LabNoteSection`) shows nothing until then.
- With Lab off, every screen is the last non-Lab build's (the Lab-off baselines, below), but for the switch itself.

## Lab on the Mac

Lab (LAB-PLAN 1, card A2: Wave 0, F00 and F17) is a switch at the top of Settings, **on by default**, in the main
window's Settings sheet and in the Settings window (⌘,). Every word is LAB_TEXT's (`share/js/daylight-lab.js`), through
the kit's views (`DaylightShareKit/README.md`); `macOS/App/MacLab.swift` puts them in the Mac's settings.

- **Lab** with its footer (*New features we’re trying out. …*). While it is on, two rows under it: **What’s in Lab ›**
  and **Daylight server ›**, subtitled *Optional · {short state}* (*Optional · Pair first*, *Optional · Not set up*,
  …). With Lab off only the switch shows; nothing is deleted, and Comfort stays as it was. Settings sits in a
  navigation stack for these rows; each page they open has its own **Back** button (⌘[) and title, since a Mac sheet
  has no toolbar for them.
- **What’s in Lab**: the Daylight's Lab state first (*Needs Lab on your Daylight* until a Lab hello arrives, then *Your
  Daylight: Lab on · checked in …*), then *With your Daylight server (optional)*: the server's short state and the four
  server features (Files over 9 MB, Summaries with Claude, Email-in address, Feeds and daily digest). Nothing spells out
  setup until a row is clicked; a click shows its one sentence under the row (*Pair with your Daylight first: …*,
  *Needs your Daylight server. …* with **Copy Server code**, *Couldn’t reach the Daylight server. …* after 5 s), said to
  VoiceOver, with OK. W0 builds none of the four, so a ready server answers *In a later update*.
  **Ad-hoc builds** (the released zip: no App Group) end the list with *This copy of the Mac app isn’t signed with a
  team, so Share › Daylight keeps its own pairing and Lab switch, its sends don’t show here, and it waits until an item
  is sent before closing.* A build signed with a team (the Developer ID path, below) shares the App Group with the Share
  menu item, and the line does not show. The rule is where the app keeps its storage (`MacLab.whatsInLabFooter`):
  its own, so the line; the App Group, no line.
- **Daylight server**: the section where setup happens (LAB-PLAN 2.6): the state's long text, *Set up with a link*, the
  steps while there is no server, the server's host and fingerprint, the delivery mode, this pairing's **Server code**
  with **Copy**, the Lab Inbox and AI lines, the optional Server address and the re-run help.
- **The Share menu card** of an ad-hoc build is an app of its own (LAB-PLAN 1.1): under its pairing form its settings
  start with its **own Lab switch**, on by default, then Comfort (the kit's `ShareExtensionView`). W0 puts nothing
  under it: no Lab feature acts in the Share menu before F04 (W1). With the App Group it follows the app's switch and
  shows none. The menu bar item gets no Lab row.
- **The one-time note** (*Lab is on. …*) waits for a build with F01 or F04: `MacLab.noteEnabled` (`LAB_NOTE_ENABLED`)
  is false in W0, and `LabFirstRunNote` at the top of the main window shows nothing.
- **F17**: the sender's ledger hears every ack-topic message, Lab on or off (the kit's `LabLedger`); the history keeps
  v1.1's words in W0 (*Delivered ✓*), and What's in Lab's first line says whether the Daylight runs Lab.

How it is checked, in the `mac` job of `rx-apple.yml`:

- the UI tests in `macOS/UITests/LabTests.swift`: `LabFirstRunTests` (a first start has Lab on and no note, after an
  update too, with the pairing and history kept, F00.1; no screen reachable without a click on a Lab feature names a
  secret or shows a needs-setup sentence, F00.7; the switch hides and brings back its rows and leaves Comfort, F27.6),
  `LabNoteTests` (a Daylight that never said hello: *Delivered ✓* rows and *Needs Lab on your Daylight*, F17.2; not
  paired: *Pair first* and its sentence under the clicked row, F00.3; the Share menu card's own switch),
  `LabServerNoteTests` (with no server on a mock relay: *Not set up*, the needs-server sentence and Copy Server code,
  and the Daylight server section's Server code, which equal `server/vectors` › `derived`, F00.3, F00.5, F00.6; on a
  relay that never answers: *Checking your Daylight server…*, then OFFLINE at 5 s, F00.6) and
  `LabAccessibilityAuditTests` (the audit of Settings with Lab on, What's in Lab with and without a note, the Daylight
  server section and the Share menu card with its Lab switch, Comfort off and on, F27.2). The job starts the two relays
  these need (`$DLS_LAB_RELAY`, `$DLS_SILENT_RELAY`);
- `LabOffParityTests` (F00.2): with Lab off, Settings and the Share menu card equal their P0 baselines, the Lab switch
  row aside;
- the truncation audit (F27.4) measures Settings with Lab on, What's in Lab and the Daylight server section too, and
  `testWhatsInLabEndsWithTheAdHocLineOnlyWithoutAnAppGroup` renders What's in Lab on its own storage (the line) and on
  a team's App Group (no line);
- the smoke test on the zip that is released (`scripts/mac-smoke-test.sh`, also on the Developer ID build): Lab is on
  at the first start, with `lab`, `caps` and `labStates` in `debug-status.json`; a Lab Daylight
  (`e2e-receiver.mjs --lab`) is heard, its caps and the link's state (*reader*), with the history still saying
  *Delivered ✓*; and F00.4: a link shared while the relay cannot be reached waits, Lab is turned off (`-DLSLab 0`), the
  relay comes back and the link is sent and delivered with Lab off, still paired, the ledger still learning, and with
  Lab on again its state is there at once. (No Daylight server runs in CI, so the server pin's part of F00.4 is the
  kit's `DaylightServerTests`.)

F17.4 (a real Daylight turning Lab on) is a device check (DEVICE-CHECKS.md, the W0 round on Rooted 2).

## Install on a Mac

1. Download **`Send-to-Daylight-mac.zip`** from the
   [latest builds](https://github.com/12twelve12hi/MHW/releases/tag/reader-experiment-latest) and open it.
2. Move **Send to Daylight.app** to **Applications**.
3. The build is ad-hoc signed, not notarized: the first time, **right-click › Open** and confirm (on macOS 15, if it
   is still blocked: System Settings › Privacy & Security › *Open Anyway*). It never asks to "access data from other
   apps" (version 1.0 did, and hung until you clicked *Allow*; see [App Groups](#pairing-once-app-groups)).
4. On the Daylight, open Daylight Share › **This is my Daylight**; paste its code (or the `daylightshare://` link)
   into the app.
5. **Share menu:** System Settings › General › Login Items & Extensions › Sharing (macOS 15; on 13–14: Privacy &
   Security › Extensions › Sharing) › turn on **Daylight**. This build has no App Group, so the first time you use
   Share › Daylight it asks for the pairing code: paste it once and it is remembered. (A build signed with your own
   team shares the app's pairing instead; see *Or build it yourself* below.)
6. **Safari extension:** Safari › Settings › Advanced › turn on *Show features for web developers*; then Safari ›
   Settings › **Developer** › *Allow unsigned extensions* (older Safari: Develop menu › Allow Unsigned Extensions).
   Safari forgets this when it quits, so do it again after restarting Safari. Then Safari › Settings › Extensions ›
   turn on **Send to Daylight**. With a signed build (below) the unsigned-extensions step is not needed. In this build
   the extension pairs in its own popup (paste the code there); a team-signed build reads the app's pairing. The
   app's Settings show whether the extension is on, open the right panes, and say whether the extensions share the
   app's pairing.

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
builds the Mac app the same way; with your team set, the Mac app and its extensions share
`<TEAMID>.com.daylight.share` (no prompt, nothing to register; change it with `DAYLIGHT_MAC_APP_GROUP_TEAM`), so the
Share menu and the Safari extension use the app's pairing. Without a team ("Sign to Run Locally") the Mac build has
no App Group, like the released one. To enable the Safari extension on the iPhone: Settings › Apps › Safari ›
Extensions › Send to Daylight.

## Signing

The released Mac app is ad-hoc signed (LAB-DECISIONS, Q6). The whole Developer ID path is built: a Developer ID
signature with the hardened runtime and a secure timestamp, notarization, and the team's App Group. It switches on by
itself once six repository secrets exist. Until then CI publishes the ad-hoc build exactly as before, and runs the
signing steps as a dry run on every build so the path stays proven.

### What changes for people using the Mac app

| | Ad-hoc build (today) | Developer ID build (with the secrets) |
|---|---|---|
| First open | right-click › Open, or System Settings › Privacy & Security › *Open Anyway* | Notarized and stapled: it opens with a double-click. macOS asks only its usual question about an app downloaded from the internet. |
| Pairing | The app, the Share menu item and the Safari extension each keep their own: paste the code into Share › Daylight once, and pair the extension in its popup | One pairing: pair in the app, and Share › Daylight and the Safari extension use it |
| Settings and history | The Share menu card has its own Comfort switch (and, with Lab, its own Lab switch, LAB-PLAN 1.1). Items sent from the Share menu don't show in the app's history. | The app and the Share menu share one Comfort switch, one Lab switch and one history, in the App Group `<TEAMID>.com.daylight.share`: items sent from the Share menu show in the app. |
| Safari extension | Needs Safari › Settings › Developer › *Allow unsigned extensions*, again after every Safari restart | No developer setting: turn it on in Safari › Settings › Extensions |

The Safari extension is its own app in both builds (LAB-PLAN 1.1). Only its pairing comes from the app, through its
native handler (`getPairing`). Its Lab switch, its settings and its history stay in the extension's own storage.

**Moving from the ad-hoc build.** Replace the app in Applications and open it. The first time, it moves what it kept
in its own storage into the shared group (`SharedStore.migrate`, kit commits 6b354a7 and 05c590b), as LAB-PLAN 1.2
and 1.3 ask of an update:
- paired or not, Comfort, the Lab switch, the one-time Lab note's answer and this Mac's name, each unless the group
  already has its own;
- when the group has no pairing: the pairing with its history (the outbox), what Lab learned about deliveries (the Lab
  ledger, `lab.json`), the Daylight server's pin and notices (`server.json`) and a re-pairing follow-up; unpaired, the
  server's pin and notices.

From then on the Share menu item and the Safari extension use that pairing, and Share › Daylight follows the app's Lab
switch: What's in Lab no longer ends with the ad-hoc build's line (see [Lab on the Mac](#lab-on-the-mac)).

### Turn it on (one time)

You need the Apple Developer account's **Account Holder** role, because only the Account Holder can create a Developer ID
certificate.

**These secrets also start TestFlight.** `APPLE_TEAM_ID` and the three `ASC_*` secrets also switch on the iPhone app's
TestFlight upload (the `testflight` job, [TestFlight](#testflight-later) below) on every build. That job needs an API
key with *Admin* access and the iPhone app's record in App Store Connect. Without them it fails on every run: the Mac
release doesn't wait for it, but the run shows red. So do steps 3 and 4 below as written.

1. **Team ID** (`APPLE_TEAM_ID`): developer.apple.com › Account › Membership details › *Team ID* (10 letters and
   digits).
2. **Developer ID certificate** (`MAC_DEVELOPER_ID_P12`, `MAC_DEVELOPER_ID_P12_PASSWORD`):
   - Create it on a Mac: Xcode › Settings › Accounts › your team › *Manage Certificates…* › **+** › *Developer ID
     Application*. Or on developer.apple.com › Certificates, IDs & Profiles › Certificates › **+** › *Developer ID
     Application* (G2 Sub-CA), with a request from Keychain Access › Certificate Assistant › *Request a Certificate From
     a Certificate Authority…* (saved to disk); then download the certificate and double-click it.
   - Export it with its key: Keychain Access › login › *My Certificates* › **Developer ID Application: *name*
     (*TEAMID*)**. Its private key shows under it when you expand it. Right-click › *Export…* › *Personal Information
     Exchange (.p12)*, with a password.
   - The secret is the file in base64: `base64 -i DeveloperID.p12 | pbcopy`. The password is
     `MAC_DEVELOPER_ID_P12_PASSWORD`.
3. **App Store Connect API key** (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`), used for notarization and by the
   TestFlight job:
   - Create it in App Store Connect › Users and Access › Integrations › App Store Connect API › Team Keys › **+**,
     with Access **Admin**. Notarization alone needs only *Developer*, but the TestFlight job uses the same key and
     needs *Admin* for cloud-managed signing.
   - Download `AuthKey_<KEYID>.p8`. Apple offers the download only once.
   - The *Key ID* is `ASC_KEY_ID`, the *Issuer ID* above the list is `ASC_ISSUER_ID`, and the file's contents are
     `ASC_KEY_P8`: `pbcopy < AuthKey_<KEYID>.p8`.
4. **Create the iPhone app's record** for TestFlight: App Store Connect › Apps › **+** › *New App*, with the bundle id
   `com.daylight.share` (or your `DAYLIGHT_BUNDLE_ID` variable; [TestFlight](#testflight-later)).
5. **Add the six secrets** in MHW › Settings › Secrets and variables › Actions › *New repository secret*, under exactly
   these names. Or use `gh`:

   ```sh
   R=12twelve12hi/MHW
   gh secret set APPLE_TEAM_ID -R $R --body ABCDE12345
   base64 -i DeveloperID.p12 | gh secret set MAC_DEVELOPER_ID_P12 -R $R
   gh secret set MAC_DEVELOPER_ID_P12_PASSWORD -R $R            # asks for the value
   gh secret set ASC_KEY_ID -R $R --body <Key ID>
   gh secret set ASC_ISSUER_ID -R $R --body <Issuer ID>
   gh secret set ASC_KEY_P8 -R $R < AuthKey_<KEYID>.p8
   ```

6. **Run it:** push any change under `reader-experiment/apple/`, or open the latest *Reader experiment – Apple apps*
   run in GitHub › Actions and choose *Re-run all jobs*. The `mac-developer-id` job's summary then reads *Mac release:
   Developer ID*, the `mac` job hands that zip to `publish`, and `Send-to-Daylight-mac.zip` on the release is the
   signed, notarized build. If a secret is missing, the *Mac signing (secrets)* job's log names it and the release
   stays ad-hoc signed.

Nothing needs registering in your account for the Mac. Developer ID apps need no provisioning profile, and macOS
authorises a Team-ID-prefixed App Group (`<TEAMID>.com.daylight.share`, `Config/Base.xcconfig`) from the team
signature alone.

**Keep the secrets once the release is signed.** Without them CI goes back to the ad-hoc build. A Mac that updates
to it would open unpaired, with an empty history, because its pairing and history are in the App Group, which an
ad-hoc build never opens. Gatekeeper's warning and *Allow unsigned extensions* would come back too.

### What CI does

Five mac-lane jobs in [`rx-apple.yml`](../../.github/workflows/rx-apple.yml):

- **`check-mac-signing`** checks that all six secrets are present (it reads nothing else). **`mac-scripts`**
  shellchecks the signing, release-check and smoke-test scripts, and runs the release check's self-test
  (`scripts/check-mac-release.sh --self-test`) on sample `codesign -dvv` output: a Developer ID signature of the team
  passes, and one read with plain `-dv` (which prints no *Authority* lines), another team's, an Apple Development or
  ad-hoc signature, a missing runtime flag or timestamp, and wrong entitlements all fail.
- **`mac-developer-id`** makes a Release build for the team (`DEVELOPMENT_TEAM`, not yet signed), so every bundle's
  Info.plist names the team's App Group. It then runs
  [`scripts/sign-mac.sh`](scripts/sign-mac.sh):
  - it imports the .p12 into a temporary keychain (deleted afterwards);
  - it signs the Share extension, the Safari extension and then the app, each with its own entitlements (the
    `-AppGroup` files with the group filled in), the hardened runtime and a secure timestamp;
  - it checks every bundle with `codesign --verify --deep --strict`. For each one it reads the entitlements actually
    embedded (`codesign -d --entitlements`) and requires them to be the ones it was signed with: sandboxed, the one
    App Group, the same group the bundle's `DaylightAppGroup` names, and no `get-task-allow`. It also checks the
    Developer ID authority, the Team ID, the runtime flag and the timestamp;
  - it notarizes with `xcrun notarytool submit --wait`, using the API key, and prints Apple's log if the submission is
    refused; then it staples the ticket, has Gatekeeper assess the app (`spctl -a -vv` must accept it, and the script
    warns if the answer does not say *Notarized Developer ID*) and zips the app with `ditto -c -k --keepParent`.

  The job then checks the zip as the `mac` job will ([`scripts/check-mac-release.sh`](scripts/check-mac-release.sh))
  and runs the Mac smoke test on it ([`scripts/mac-smoke-test.sh`](scripts/mac-smoke-test.sh), the one the `mac` job
  runs): the app must use the App Group and pair, send and show *Delivered ✓*.
- **`mac`** builds, smoke-tests and UI-tests the ad-hoc app as always. It runs after `mac-developer-id` and chooses
  the zip it hands to `publish` (the `send-to-daylight-mac` artifact):
  - without the secrets, its own ad-hoc zip, whatever the dry run's result;
  - with them, the Developer ID build, after `scripts/check-mac-release.sh` has checked it: the app and both
    extensions signed by `Developer ID Application: … (<TEAMID>)` with that Team ID (read with `codesign -dvv`), the
    runtime flag, a timestamp and the team's App Group in the embedded entitlements, `codesign --verify --deep
    --strict`, and the stapled ticket (`xcrun stapler validate`). It never hands over its ad-hoc zip then. If
    `mac-developer-id` failed (a notary outage or refusal, its smoke test), `mac` fails and `publish` doesn't run, so
    the release keeps its last builds, the iPhone's included.

**Without the secrets** `mac-developer-id` is a dry run of the same script:
- It builds for a stand-in team, `DRYRUN0000`, and signs with a throwaway self-signed code-signing certificate that
  the job makes with `openssl`.
- That covers the keychain import, signing every bundle, the embedded entitlements and the App Group value
  (`DRYRUN0000.com.daylight.share`).
- It skips notarization, stapling and the Gatekeeper check, and it does not require the Developer ID authority or a
  Team ID.
- It runs the release check the `mac` job runs on a Developer ID zip, `check-mac-release.sh --dry-run`, on its own
  zip: the same checks of all three bundles, except that the signer must be the throwaway certificate
  (`Authority=Send to Daylight CI dry run (self-signed)`, `TeamIdentifier=not set`) and there is no ticket to validate.
- It then runs the smoke test, in which the app keeps its own storage: a self-signed signature carries no Team ID, so
  `SharedStore` never opens the group, and nothing asks for access.
- It hands nothing on; the release gets the ad-hoc build from the `mac` job.
- Nothing in it may hold back the ad-hoc release. GitHub skips `publish` when any job upstream of it failed, even
  indirectly, and `mac` runs after `mac-developer-id`. So without the secrets `mac-developer-id` is
  `continue-on-error` as a whole job (a failed checkout, Xcode or XcodeGen step, a lost runner), each of its steps has
  a timeout and together they stay under the job's, and its verdict step always runs. **`mac-developer-id-dry-run`**,
  which nothing needs, fails on that verdict: the run turns red, and the ad-hoc release still goes out.

To sign on your own Mac instead, with the same environment variables as the secrets:

```sh
cd reader-experiment/apple && xcodegen
xcodebuild -project SendToDaylight.xcodeproj -scheme SendToDaylight-macOS -configuration Release \
  -destination 'generic/platform=macOS' -derivedDataPath build/dd DEVELOPMENT_TEAM=ABCDE12345 \
  CODE_SIGN_STYLE=Manual CODE_SIGNING_ALLOWED=NO build
MAC_DEVELOPER_ID_P12=$(base64 -i DeveloperID.p12) MAC_DEVELOPER_ID_P12_PASSWORD=… \
  ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_P8="$(cat AuthKey_….p8)" \
  scripts/sign-mac.sh "build/dd/Build/Products/Release/Send to Daylight.app" ABCDE12345 Send-to-Daylight-mac.zip
```

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

CI ([`.github/workflows/rx-apple.yml`](../../.github/workflows/rx-apple.yml)) has one job per lane (LAB-PLAN 6.1):
`kit` runs the Swift package tests; `ios` builds the iPhone app for the simulator and for devices, smoke-tests it and
runs its UI tests and truncation audit; `mac` checks the Mac App Group build settings with and without a team, builds
the Mac app (and fails if the ad-hoc build carries an App Group), smoke-tests it and runs its UI tests and truncation
audit. Once all three pass, `publish` puts `Send-to-Daylight-unsigned.ipa` and `Send-to-Daylight-mac.zip` on the
release. Both smoke tests gate the release, and each waits for the state it checks in the app's `-DLSStatusDump` file
rather than a fixed time: the app must render (the Mac within 10 s; the iPhone, on a simulator that may have just
started, within 120 s) and keep a main-thread heartbeat, pair through a `daylightshare://` launch argument, send a link
the JavaScript receiver gets and acks, and then show that history row as *Delivered ✓* (the iPhone app once launched
again, as it reads acks when it becomes active).

`StorageResolutionTests` is the regression test for the 1.0 launch hang: with a container check that takes a second
(or never answers in time), the app model must be created within 100 ms, the check must run off the main thread, and
pairing must still work (into the group once found, or into the app's own storage after the 2-second timeout). It also
requires that the app model never reads or writes storage on the main thread (`StorageAudit` records any access made
there), and the Mac smoke test checks the same in the running app after launch and after it delivered an item.
`OutboxLockTests` pin the pairing-change and removal rules against an upload in flight; `DownloadRuleTests` pin the
download rule (https or the relay's own origin, the 12,713,984-byte and 64 MiB caps, the stop after a 429) and the
takeover of a `sending` row 15 minutes after its last progress.

Launch arguments for testing and debugging (only whoever starts the app can pass them):

| Argument | What it does |
|---|---|
| `-DLSPairLink <link>` | Pairs without asking. |
| `-DLSSendLink <url>` | Sends a link. |
| `-DLSStatusDump` | Writes `debug-status.json` (storage, pairing, Comfort, Lab's `lab`, `caps` and `labStates` (LAB-PLAN 1.7), history rows with their labels, and a once-a-second heartbeat) to the app's Application Support folder, on the Mac `~/Library/Containers/com.daylight.share.mac/Data/Library/Application Support/DaylightShare/`. |
| `-DLSComfort 0\|1` | Turns Comfort off or on before the first render (and saves it), LAB-PLAN 1.7. |
| `-DLSTestStorage` | Runs on fresh, empty storage of its own (`DaylightShare-UITest` next to the app's own folder, a separate defaults suite, no App Group), emptied at every launch: the UI tests never see or touch a real pairing or history. |
| `-DLSSampleHistory [n,…]` | Debug builds only, and only with `-DLSTestStorage`: once the launch's pairing is in place, the history holds the sample rows (or only those numbered after it, 1 the newest: `-DLSSampleHistory 3,4`) (`HistorySample`: a row in every state, newest first — *Sending…*; *Waiting to send* with *Retry now*; *Not delivered* as too large; *Delivered ✓*; *Sent · waiting for your Daylight* a day on; *Not delivered* within a week, with *Try again*), and the app reads no acks and re-sends nothing, so each row stays in its state. For the UI tests' walks and audits. |
| `-DLSLab 0\|1` | Turns Lab off or on before the first render, and saves it (LAB-PLAN 1.7; `LabSettings.launchValue`). The share card samples (`-DLSShareCard`) take it too. The Lab-off walks pass `-DLSLab 0`; without it a start on `-DLSTestStorage` is a first start, Lab on. The iPhone smoke test checks the status file's `lab`, `caps` and `labStates` on a fresh install (Lab on) and again launched with `-DLSLab 0`. |
| `-DLSAnnounceLog <path>` | iPhone, Debug builds only: every VoiceOver announcement is also appended to that file, one per line (`LabBuild.logAnnouncements`), so the UI tests can check that a needs-setup note is said (LAB-PLAN F00.3). |
| `-DLSShareCard <name>` | Debug builds only: shows the share card (`ShareExtensionView`) in one of its states in place of the window, with sample words and its own empty storage, for the UI tests' walk: `reading`, `sent`, `sent-note`, `result-note`, `needs-pairing` (a card without an App Group, with its own Comfort switch) or `confirm-pairing` (`ShareCardSample`). |

### UI tests, the truncation audit and the Lab-off baselines

`xcodegen` makes four test targets, run by the app schemes' Test action (CI: the `ios` and `mac` jobs of
`rx-apple.yml`, on a simulated iPhone and on the Mac runner):

- `SendToDaylightUITests-iOS` and `SendToDaylightUITests-macOS` (XCUITest; the tree walk and helpers are in
  `Shared/UITests`):
  - `AccessibilityAuditTests` run Xcode's `performAccessibilityAudit()` on Home (the Mac's main window), Settings and
    the pairing screen, with Comfort off and on (iOS 17+, macOS 14+; F27.2). Home and the main window are audited
    empty and with the sample history (`-DLSSampleHistory`), so every row's status label, time, sentence and *Retry
    now* or *Try again* button is audited. The Mac's main window: at the top of the history and after every step of
    scrolling it to its end (`UITestSupport.auditHistory`). The iPhone's Home: in parts of the history that show whole
    at the top of the screen (`-DLSSampleHistory 1,2`, `3,4`, `5,6`; with Comfort, each row alone), since the audit
    scrolls a list itself and a list scrolled to a row does not stay put under it; with Comfort at the largest size,
    where one row is taller than the screen, Home is audited at its top (the truncation audit measures every row text
    there). On the iPhone the history runs leave Dynamic Type out: at
    the largest size the audit loses every row that was on screen (the list scrolls it away) and reports each of its
    texts, so each row text is measured growing by `testEveryTextGrowsWithTheTextSize` instead (Home with the same
    rows), and the empty Home keeps the audit's Dynamic Type check. Every issue is printed as an `AUDIT` line
    with the element's value, frame and contents; an issue can be allowed only with a stated reason (`allowed`), which
    is printed too. An audit the system stops before it finishes ("Audit failed to complete in time", seen on the
    first audit after the simulator starts) is run again, at most twice; issues are never run again. Allowed today: on the Mac, the system's Touch Bar and its emoji item, the Settings button's
    tooltip, the window title the system dims behind a sheet, groups inside the title-bar buttons, a parent/child
    report that names no element, text the open Settings sheet covers or has scrolled partly out of view, and the
    text of a history row the History list has scrolled partly or wholly out of view (its outline keeps every row in
    the tree; the audit measures each text where it is laid out, also where it is hidden); on the iPhone, contrast
    reports on an element the list has scrolled partly under the navigation bar or off the screen, contrast and
    clipping reports that come without an element while a history row's text shows partly under the navigation bar
    or past the screen's edge (a row's words are one element, so the audit cannot point at the text; the allowance
    names the texts, `UITestSupport.auditHere`), a navigation-bar
    button's capped text size, and Dynamic
    Type reports on exactly the texts `iOS/UITests/DynamicTypeWaivers.swift` names for the screen (today *Nothing
    sent yet.* on the empty Home and the device name's footer in Settings, which the audit loses at the largest size). That
    file is compiled into the unit tests too, and `testEveryTextGrowsWithTheTextSize` fails unless it measures each
    named text growing with the text size; any other Dynamic Type report fails the audit. The Comfort run leaves
    Dynamic Type out on purpose: Comfort holds text between xxLarge and accessibility3 (the F27 table). What the
    audits found and the apps now do: secondary text and section headers at 72% of the primary colour (the primary
    colour on the Mac), a history row's site at 12 pt on the Mac too (a short 10 pt text only "nearly passed" there), a row's
    sentence in the primary colour (small text at 72% failed on the iPhone now and then), a tint of #0058CC and a destructive red of #C01010 (both at least 4.5:1, lighter in dark
    mode), no greyed-out buttons, text fields that grow to more lines, row text that the row sizes, the navigation
    title kept in the bar, a name on every switch, a history row's *Retry now* / *Try again* at the window's control
    size (never small), and on the iPhone each history row's words as one element (below). An audit with an issue
    nobody allowed prints a screenshot into the log (`UITestSupport.printShot`, a base64 JPEG between `=====BEGIN
    shot …=====` markers, at most six a run), since the result bundle's screenshots cannot be read from the log.
  - `BaselineTests`: Comfort is in Settings, off by default, named, with its footer, and switches on; the share card
    without an App Group has its own Comfort switch; typing the code pairs.
  - Lab on the iPhone (Wave 0, card A1), on the relays the `ios` job runs (the mock relay with no Daylight server on
    it, `DLS_RELAY`; one that never answers, `DLS_HANG_RELAY`; and nothing at all, `127.0.0.1:9`), each passed as
    `TEST_RUNNER_…`:
    - `LabFirstRunTests` (F00.1, F00.7): a fresh install has Lab on and no note; Settings starts with Lab and its rows,
      which turning Lab off hides (and Comfort stays); Home with the sample history and the share card in each state
      are, with Lab on, exactly the Lab-off baselines (Wave 0 changes nothing there; "Delivered ✓" without a hello,
      F17.2); and no screen before a tap (pairing, Home, Settings, What's in Lab) names a secret or says how to set
      something up (LAB_TEXT's needs-setup sentences, the server module's state messages and the re-run help, from the
      vectors), while the server section does. `ScrolledWalkTests` checks the walk merge below.
    - `LabNoteTests` (F00.3, F00.5, F00.6, F17.2): *Summaries with Claude* (and each server feature) says the
      needs-server sentence under itself within 5 s, enabled, said to VoiceOver (`-DLSAnnounceLog`), with Copy Server
      code and OK; offline it says the OFFLINE sentence, and with a relay that never answers *Checking your Daylight
      server…* and then OFFLINE at 5 s; the Server code is `server-vectors.json` › `derived` in the link form, and both
      Copy buttons put it on the clipboard (read back with Home's Paste button); with no hello, *Delivered ✓* and the
      needs-inbox header line.
    - `LabAccessibilityAuditTests` (F27.2 with Lab on): Settings with its Lab section, What's in Lab, a needs-setup note
      and the server section, at the default size and with Comfort at the largest, without Dynamic Type (these screens
      run past one screen; the truncation test measures each of their texts growing instead).
  - `LabOffParityTests` (F00.2): an explicit walk of the accessibility tree (element type, label or title, and value,
    in order; never `debugDescription`) compared with `iOS/UITests/lab-off-baseline/*.json` and
    `macOS/UITests/lab-off-baseline/*.json`: Home with the sample history in three parts that each show whole at
    the top of the screen (`home-rows-1-2`, `home-rows-3-4`, `home-rows-5-6`; the iPhone's list holds only the rows on
    screen) and empty (`home-empty`); the Mac's main window with
    the sample history (`main`; its History outline keeps all six rows in the tree whatever it shows) and empty
    (`main-empty`); Settings, pairing, the share card in each of its states (`-DLSShareCard`), and on the Mac the menu
    bar item's menu with the sample history (`menu-bar`, its six rows) and empty (`menu-bar-empty`). The rows are the
    ones W1's timeline (F01) changes: with Lab off they must read exactly as this baseline's. Each row's time (*Today
    at 1:05 PM*), which depends on when the test runs, is written `<when>`, as Android's walk does: on the Mac the age's own text
    (`history-row-time`, `HistoryRowView.timeID`), on the iPhone the value of the row's one element (`history-row`,
    `HistoryRowView.rowID`). The baselines were recorded from the P0 close-out (protocol 1.1 and this
    accessibility baseline) and are re-recorded only with a matching non-Lab change. The iPhone's Settings now starts
    with the Lab section, which pushes its last rows below the screen (a form holds only the rows on screen), so it is
    walked to its end and the steps put together where they overlap (`LabUI.checkScrolledBaseline`), and compared whole.
    The walk keeps every element that has a label, title or value, whatever its type, and every control even without
    one; it leaves out only containers without words and the system's scroll bars, and writes what depends on the
    build or the runner in fixed words: the app's version as `<version>` (a version bump is not a screen change) and
    the Mac's *Safari extension* state as `<Safari's answer>`.
  - **The Lab switch** (for A1 and A2): give the Lab `Toggle` itself `.accessibilityIdentifier("lab-switch")`
    (`AXTree.labSwitchID`, as Android's test tag) and its name `LAB_TEXT.lab`, and nothing else that identifier. With
    Lab off the walk leaves out that one element (with what is inside it) and texts with exactly its words ("Lab" as
    a label or a "LAB" header, and `LAB_TEXT.switchFooter`), and checks that it shows once, only where it lives, as
    one switch named "Lab", off, with nothing else inside. Where it lives: Settings on both platforms, and on the Mac
    the Share menu card's own settings, which of the card's samples only `needs-pairing` shows (the ad-hoc build,
    LAB-PLAN 1.1). The iPhone's share sheet follows the app's switch and has none of its own, so the iPhone's card
    walks allow no Lab switch at all. The card's Lab switch is the kit's (`ShareExtensionView.cardSettings`, Mac only,
    `showsCardLabSwitch`). What's in Lab and Daylight server are rows of their own, outside that element: shown with Lab
    off, they change the compared tree.
  - `TreeWalkTests`: the walk's own rules on trees built by hand (the Lab row and its words, labelled elements of
    any type, the version, the type names, `LAB_TEXT`'s words from `share/vectors/lab-vectors.json`).
  - When a baseline is missing or differs, the test fails and prints the new tree between
    `=====BEGIN lab-off-baseline <platform>-<screen>.json=====` and `=====END …=====` in the job log (and CI uploads
    it): to re-record, copy it into the baseline file.
- `SendToDaylightTests-iOS` and `SendToDaylightTests-macOS` (hosted in the app, Debug only): the truncation audit
  (F27.4). `AuditScreens` hosts each main screen with a history row in every state, and the share card in each state
  (`ShareCardSample`), at the narrowest width (320 pt, an iPad's one-third split; the Mac window's 440 pt minimum, the
  460 pt Settings sheet and the Share menu card's 360 pt) with Comfort on and accessibility3, and every text that
  carries a `truncationProbe` reports its frame and the size it needs; a text that got less, or runs past the
  window's edge, fails the test. Every text the apps lay out carries one: through `wrapping(_:)` or
  `listRowText(_:)`, or a probe of its own where the text keeps a line limit outside Comfort (the share card's
  summary). A history row's time, whose words depend on when it is measured, is probed under a fixed name per row
  (`HistoryRowView.timeProbe`). Not measured: the system's own texts (confirmation dialogs, the menu bar item's menu).
  The audit checks itself on a deliberately cut text first. On the iPhone, `testEveryTextGrowsWithTheTextSize` also measures every text of those screens (and of an
  empty Home) at the default size and at accessibility3, and fails on one that does not grow. On the iPhone both also
  host the Lab screens as a fresh install sees them (no Daylight server): Settings with Lab on, What's in Lab, the
  server section (its longest form) and the needs-setup notes (`AuditScreens.labScreens`). `LabAppTests` (iPhone,
  `LabChecks` in the app) checks the rules no screen shows: an update from the non-Lab build turns Lab on and keeps
  the pairing and history (F00.1), `LAB_NOTE_ENABLED` is off, a stored switch and `-DLSLab` at the next start, the share
  sheet following the app's switch, and F00.4 (an item queued offline, then Lab off, goes once the relay is back; the
  history, pairing and server pin stay; the status dump's `lab`, `caps` and `labStates`). The menu bar item's
  menu is drawn by the system at the width its items need, so it is not measured.

The UI tests run the app on its own storage (`-DLSTestStorage`) paired with the vectors' code and a relay nobody
listens on, empty or with the sample history (`-DLSSampleHistory`), so every screen reads the same on every run. Screenshots of every screen (and of the truncation audit's
windows) are uploaded as the `rx-apple-ios-screenshots` and `rx-apple-mac-screenshots` artifacts for review; they are
never compared. A runner image that changes the iOS or macOS version can change a tree: the test then prints the new
one, ready to copy. Each launch waits until the app answers accessibility queries (a simulator that has just started
can take a while; CI also starts it before the tests). CI does not re-run failed tests, and `scripts/ci-test-summary.sh` fails the job unless
`AccessibilityAuditTests`, `BaselineTests`, `LabOffParityTests`, `TreeWalkTests` and `TruncationAuditTests` (on the
iPhone also `LabAppTests`, `LabFirstRunTests`, `ScrolledWalkTests`, `LabNoteTests` and `LabAccessibilityAuditTests`; on the Mac
also `LabFirstRunTests`, `LabNoteTests`, `LabServerNoteTests` and `LabAccessibilityAuditTests`, [Lab on the
Mac](#lab-on-the-mac)) each ran with every test passed and none skipped (so a runner whose simulator is older than iOS 17, or a macOS older than 14,
cannot turn the audits into skips).

### Notes

- The Safari extension's native handler answers `{type: "getPairing"}` with
  `{ok, paired, pairing: {code, link, relay, name}, from}` (or `{ok, paired: false, shared}`; always `paired: false`
  at first in a build without an App Group), `{type: "setPairing", code|link, relay?, name?, confirm?}` stores a
  pairing made in the extension for the app too (when they share an App Group; one that would replace another code
  answers `{ok: false, needsConfirm: {title, lines, button, current, next}}` unless `confirm` is true, and a relay
  change answers with a `notice`), and `{type: "ping"}` reports the app version and the storage in use. It answers once
  storage is settled, never touching the App Group on its own thread.
- Pairing again with the same code keeps the items still waiting (they go through the new relay); another code
  deletes them (PROTOCOL 3.3). Switching Daylights, unpairing, *Remove* and *Clear delivered and expired* wait for an
  upload in progress in the same app (the outbox lock, as in the JavaScript reference), and an upload never writes
  back a row that was removed meanwhile, even by the share extension in another process. So an item meant for one
  Daylight is never sent to another.
- Every sheet of an app window (Settings, the file picker, the QR scanner) is presented from one place, together
  with the pairing question: a `daylightshare://` link that arrives while one is open replaces it with the question.
- Items not delivered within 7 days keep their content until 14 days after they were shared, so *Try again* still
  works; delivered items keep only a history row. The history keeps every item still on its way and the newest 200
  finished ones.
