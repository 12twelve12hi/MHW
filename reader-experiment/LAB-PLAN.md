# Lab plan: how to build the Lab version of Send to Daylight

*Written 2026-10-20 for the agents that build the Lab version. It turns `research/FEATURES.md` (69 features in waves)
and the user's rules in `LAB-DECISIONS.md` into work that independent agents can do without guessing. Other inputs:
`share/PROTOCOL.md` rev 1.1 and `share/CHANGES-v1.1.md`, `server/DESIGN.md` and `server/README.md`,
`DEVICE-CHECKS.md`, `READER-INTEGRATION.md`, the app READMEs and the Daylight Reader's public snapshot
(`a12k-a2b/daylight-reader` 0.27.843; the live Reader has moved on, so check every Reader class name before editing).*

**Revision 2 (Oct 20, 2026)** answers a product review and an engineering review. Section 7 logs every point and
what was done with it. The main changes:

- Excerpts come only from clear selections, so "headline + link" shares stay links (F11, F16).
- Share in place notifies when a send fails after the card closed, and never runs on a timer for people who need
  more time (F04).
- The first run is quiet: short states in What's in Lab, the server features grouped, and the one-time note held
  until a build has F01 or F04 (1.4–1.6). Comfort moves to the accessibility baseline (F27).
- A household message budget, with Lab frames as the lowest priority (2.2.4, 2.2.7). Exact parse rules, ledger
  entries per publisher, and header extras that reach the Inbox (2.2.5, 2.2.6, 2.3).
- The Mac's W1 gains Print to Daylight and the menu-bar drop. W1 offers big files where a file is refused. W2 is
  ordered, with F06 and F13 first (3.1, 4.1).
- P0 close-out tasks, a W0 server-lane task (SV0), the K6 card, and clearer ownership of `apple/Shared`, the capture
  code and the CI files (3.5, 6).

**How to use it.** Sections 1 and 2 are binding for every task. Section 3 specifies Waves 0 and 1 feature by
feature. For each feature it gives the common rules, then the UI, behaviour, edge cases, acceptance checks (`[ ]`,
with IDs) and automated tests for each platform. Section 3.5 has one task card per folder: pick a card, read what it
cites, build it, and stop when its "Done when" list passes. Section 4 lists the later waves, section 5 the Reader-side
work, section 6 the schedule and the user's open decisions, and section 7 the critique log.

---

## 0. Ground rules

1. **Copy is final for W0 and W1.** It is revisited once, after the W0 device round and its usability pass (6.4).
   Every user-visible string in this plan is the text to ship, written with ASCII apostrophes where a table needs
   them. Apps show ’ … · ✓ → (U+2019, U+2026, U+00B7, U+2713, U+2192) exactly as protocol v1.1
   does (CHANGES-v1.1 2.5). `{braces}` are template slots. The vectors (2.8) pin every string, so the apps cannot
   drift apart.
2. **Prerequisite P0: protocol v1.1 everywhere.** Every folder's v1.1 port is now on the branch (CHANGES-v1.1
   §6.3–6.8):
   - `share/js` (44968a6) and Windows (0e7a470);
   - `android/share-core` (5e9f918) and `android/app` (08e7ff7, with the `FLAG_ACTIVITY_NEW_TASK |
     FLAG_ACTIVITY_CLEAR_TASK` document hand-off workaround);
   - `apple/DaylightShareKit` and the Apple apps (c1b445c and its follow-ups);
   - the extension and the web sender (b44c509);
   - the DEVICE-CHECKS fixes cb57057 (Inbox) and 0e90108 (Mac).

   The v1.1 review findings are still being closed. A folder's P0 is done when its findings are closed and its CI is
   green. One **P0 close-out** task per lane tracks this (6.2, Stage A). It ends with the F27 accessibility baseline
   (Comfort included) as a non-Lab commit, and then records that app's Lab-off baselines (1.7). A Lab task in a
   folder starts only after that folder's close-out. Lab code calls the v1.1 row text (`describeRow`, `RowText.of`,
   `RowText(row:now:)`) and never re-implements it.
3. **Wire rule.** `v` stays `1`. Lab adds only `x-` header fields, ack-topic frames whose `ids` is empty, and new
   derived topics with their own AAD (2.1). Every v1.0 and v1.1 peer keeps working, and CI proves it (2.8).
4. **One task, one folder** (6.1). A task edits only the folders its card names. Shared files follow 6.3.
5. **Platform names.** *iPhone* (and *iPad*: the same app) = `apple/iOS`. *Mac* = `apple/macOS`. Both compile
   `apple/Shared` (`GetPage.js` and the Safari extension handler), which the kit lane owns (6.1).
   *Chrome* and *Safari* = the extension in `extension/` (Safari's build ships inside the Apple apps). *Web* =
   `web/`. *Android phone* and *DC-1 Inbox* = `android/app` in its two roles. *Windows* = `windows/`. *JS reference* =
   `share/js`. *Lab Reader* = the side-by-side Reader copy on the lab tablet (section 5).
6. **Devices.**
   - **The Lab Reader** (section 5) is installed only on the lab tablet "Rooted 2" (JP4R01422). It is never
     installed on JP4R03005, and never merged into the main Reader or shipped without the user (LAB-DECISIONS,
     "Reader-side features").
   - **Agents install nothing on JP4R03005**, Lab or not. Device rounds run on Rooted 2.
   - **Daylight Share with Lab** is the ordinary release APK: Lab is a switch inside it (1.2). The user may install it
     on any DC-1, JP4R03005 included, so the iPhone and Mac Lab features work with the tablet the user reads on. 6.5
     Q7 asks the user to confirm this reading of LAB-DECISIONS. Until then, no acceptance item depends on it.

---

## 1. The Lab switch

### 1.1 Where it lives

Each app has exactly one **Lab** switch, at the top of its settings. While Lab is on, the switch has two rows under
it:

- **What’s in Lab ›**;
- **Daylight server ›**, with the subtitle "Optional · {short state}" (1.4), for example "Optional · Not set up".

With Lab off, only the switch shows. **Comfort** is not under Lab. It is part of the accessibility baseline (F27)
and has its own settings row in every build, Lab on or off.

| App | Place |
|---|---|
| iPhone, iPad | Settings sheet (`SettingsView`, `iOS/App/HomeView.swift`): a new first section "Lab". The share sheet item follows the app's switch through the App Group (1.2). |
| Mac | Settings window (`MacSettingsView`, `macOS/App/MacViews.swift`): a new first section "Lab". The Share menu item follows the app through the App Group. **Ad-hoc builds** (the released `Send-to-Daylight-mac.zip`) have no App Group. On them the Share menu item counts as its own app, like the Safari extension: its pairing card's ⋯ settings gain their own Lab switch, on by default. What's in Lab says what such a build lacks (1.4). The menu bar item gets no Lab row. |
| Safari extension (Mac, iPhone) | Its popup › ⋯ settings, first row. It is its own app for this purpose: the extension code keeps its own storage. |
| Chrome extension | Popup › ⋯ settings, first row. "What’s in Lab" and "Daylight server" open the extension page `lab.html`. |
| Android phone | Settings screen (`ui/SettingsScreen.kt`, sender role): a top card "Lab". `ShareActivity` follows it. |
| DC-1 Inbox | The same settings screen in the Inbox role: a top card "Lab". "Daylight server" shows the server lane (Wave S). |
| Web sender | Settings panel, first row. |
| Windows | ⋯ › Settings, first row. |

### 1.2 Default and persistence

| Platform | Keys | Store |
|---|---|---|
| iPhone, iPad, Mac | `dls.lab`, `dls.labNoteShown` (Bool), added to `SharedStore.Key` | `SharedStore` defaults: the App Group suite once it is resolved, else the process's own (`SharedStore.swift`) |
| Android (both roles) | `lab`, `labNoteShown` | `Prefs` (`App.kt`, SharedPreferences `daylight-share`) |
| Chrome, Safari | `lab`, `labNoteShown` fields of the existing `settings` object | `storage.local` |
| Web | the same fields of `settings` | IndexedDB `kv` (`web-storage.js`) |
| Windows | the same fields of `settings` | the app's JSON store (`bridge.js`) |

The baseline's `comfort` key (F27) sits in the same stores, but it is not a Lab key and Lab never reads it.

- **A missing key means on.** The first start of a build with Lab writes `lab = true` when the key is missing. This
  applies to fresh installs and upgrades alike.
- **The one-time note waits for something you can feel.** The note (1.6) shows only in builds where the app has F01
  or F04, so from that app's first W1 build, and never in a W0 build. It shows once, until it is dismissed
  (`labNoteShown = true`). Each app sets the build constant `LAB_NOTE_ENABLED`.
- The switch belongs to the app and the device. It is never synced and never in a pairing link. Pairing, unpairing,
  re-pairing and updates leave it as it is; an uninstall loses it, and a fresh install starts it on again.
- **One reading.** UI and background code read the flag through one accessor: `LabSettings.isOn` (Swift),
  `Prefs.lab` with a `StateFlow` (Kotlin), and `labOn(storage)` with `storage.onChanged` (JS). The Apple apps post
  `SharedStore.postChange()` when it changes, so the app and its extensions agree. While `SharedStore` is still
  resolving, the value is `true`, and views update once storage settles.

### 1.3 What turns off with it

With Lab off, every screen, string and flow is the last non-Lab build's. Neither the v1.1 fixes nor the F27
accessibility baseline (Comfort included) are Lab features.

| Lab off does this | Lab off never does this |
|---|---|
| Hides every Lab control: rows, menu entries, the Options window, the timeline's step line and check-in header, the "Daylight server" section, "What’s in Lab" and Lab's notifications (F04). The switch row stays. | Deletes the pairing, the outbox, history, the Lab ledger (2.2.6), the server pin and notices, or any Lab feature's own settings. They return when Lab is turned on. |
| Stops Lab background work. The Inbox sends one last hello with `lab: 0` (2.2.4), then no hellos and no state frames. Return-lane polling (W2) stops, connectivity-triggered sending (F07) falls back to v1.1 back-off, and the F08 shortcut is removed. | Changes sending. Items already queued keep their `x-` fields and go out as stored. |
| F09: URL-scheme `send` links, App Intents and the Android `SEND_URL` intent answer "Turn on Lab in {app} to use this." Pairing links still work. | Stops recording Lab frames read from the ack topic. The ledger keeps learning, invisibly, so turning Lab on shows correct states at once. |

### 1.4 What's in Lab

A list with one row per Lab feature this app has in this build. Each row has the name, one sentence and a **short
state** (table below), such as "Ready" or "Needs Lab on your Daylight". The full needs-setup sentence (1.6) appears
only when the row is tapped, as for any other control (1.5). Nothing in the list spells out setup steps until
something is tapped. Tapping a row opens the feature, or runs its gate. The list's header line is the Inbox's Lab
state: "Your Daylight: Lab on · checked in 4 min ago" (2.5), or the `needs-inbox` short state with the check-in time.

Names and sentences, shared by every app:

| Feature | Name | Sentence | Apps |
|---|---|---|---|
| F01 | Delivery timeline | See each item reach your Daylight and its Reader. | all senders |
| F03 | Pages as you see them | Pages go as you see them, logged-in parts included, without scripts or form contents. | iPhone, Chrome, Safari |
| F04 | Share in place | Share › Daylight closes in a second; Options lets you choose how it goes. | iPhone, Mac, Android, Chrome, Safari |
| F07 | Works offline | Items shared offline wait here and go as soon as you’re back online. | all senders |
| F08 | Your Daylight in the share sheet | Your Daylight appears next to your contacts when you share. | Android |
| F09 | Shortcuts and automation | Send from Shortcuts, Siri, scripts and other apps. | iPhone, Mac, Android, Windows, web |
| F10 | Send as | Choose page, clean article, link or selection. | iPhone, Chrome, Safari |
| F11 | Send a selection | Send just the passage you selected, with its source. | Chrome, Safari; iPhone, Mac and Android after 6.5 Q1 |
| F15 | Arrival notices | See what arrived and from where, and act on it. | DC-1 Inbox |
| F16 | Clean links | Removes tracking from links and finds the real article. | all senders |
| F23 | Print to Daylight | Print › PDF › Send to Daylight from any app. | Mac |
| F26 | Setup check | Checks your setup and sends a test article. | all apps |
| F29 | Drop on the menu bar | Drop files and links on the menu-bar icon to send them. | Mac |
| F33 | Send copied link | Send a link you copied with one tap. | all senders (Mac and Windows: the existing clipboard command) |
| F34 | More right-click choices | Send a page, clean article, link, selection or an image’s page from the right-click menu and shortcuts. | Chrome, Safari |

**With your Daylight server (optional).** The four server features come last, under this heading, with one line
under it: the server's short state, for example "Not set up". Each row below it shows its own short state only when
it differs from the heading's, for example "Needs a Claude key".

| Feature | Name | Sentence | Apps |
|---|---|---|---|
| F02 | Files over 9 MB | Big PDFs and books go through your Daylight server. | iPhone, Mac, Android, Chrome, web, Windows |
| F37 | Summaries with Claude | Short summaries and answers about what you send, using your Claude key. | iPhone, Mac, Chrome, Safari, web, Android |
| F19 | Email-in address | Forward newsletters and documents to your Daylight by email. | iPhone, Mac, Chrome, web, Android |
| F36 | Feeds and daily digest | Follow feeds; new articles arrive one by one or in a morning digest. | iPhone, Mac, Chrome, web, Android |

These four are listed from Wave 0, as LAB-DECISIONS requires. Until a platform builds one (Wave S, 4.2), its gate
ends in the state `later` once the server is ready. F02 is also offered where a file is refused as too big (3.1, the
F02 entry point).

**Ad-hoc Mac builds** end the list with: "This copy of the Mac app isn’t signed with a team, so Share › Daylight
keeps its own pairing and Lab switch, its sends don’t show here, and it waits until an item is sent before closing."

**Short states** (`LAB_TEXT.short`, 2.7.2):

| State | Short state |
|---|---|
| ready | Ready |
| `needs-pairing` | Pair first |
| `needs-inbox` | Needs Lab on your Daylight |
| `needs-notifications` | Needs notifications |
| `needs-quick-sends` | Off in Lab settings |
| `needs-site-access` | Needs access to this site |
| `needs-server` | Not set up (the heading) · Needs your Daylight server (a row) |
| `pairing-mismatch`, `locked` | Needs the new Server code |
| `server-outdated` | Server needs an update |
| `app-outdated` | Update this app |
| `needs-key` | Needs a Claude key |
| `needs-r2` | Needs R2 storage |
| `needs-domain` | Needs an email domain |
| `needs-paid` | Needs Workers Paid |
| `needs-lab-inbox` | Waiting to hear from your Daylight |
| `OFFLINE` | Can’t reach the server |
| `error` | Server problem |
| `later` | In a later update |

### 1.5 The "needs setup" behaviour

- The control looks and acts like any enabled control: never greyed out, never locked, never hidden.
- A tap runs the feature's gate, `labGate(feature)` (2.7). Local checks come first: paired, the Inbox's capability,
  the Lab Reader, an OS permission, a setting. Then, for a server feature, the server state (2.6).
- **Ready**: the feature runs. The first use of a server feature shows its notice (DESIGN 14.3) once, with Continue
  and Cancel.
- **Not ready**: exactly one sentence, the state's message (1.6), appears as an **inline note directly under the
  tapped control**.
  - The note stays until the user taps OK, taps another control or leaves the screen.
  - It is announced to screen readers: iOS `AccessibilityNotification.Announcement`, Android
    `liveRegion = LiveRegionMode.Polite`, and `aria-live="polite"` on the web, in the extension and on Windows.
  - It is never an auto-dismissing toast. It is never a modal alert, except F09's confirmation sheet.
  - It may carry one button, and only when this device can fix the problem directly: **Open Settings** (an OS
    permission), **Open setting** (a setting in this app: it opens that setting with its footer and never changes
    it by itself), **Copy Server code** (`needs-server`) or **Allow** (site access in the extension).
- **Server states.** A cached status that is 10 minutes old or less answers at once. Otherwise the note first says
  "Checking your Daylight server…" for at most 5 s, then shows the state. `labGate` enforces the 5 s itself (2.7.2):
  a server that has not answered by then gives `OFFLINE`, as a network failure does.
- What's in Lab shows each feature's short state without a tap (1.4). It uses cached states and refreshes the server
  status when the list opens.

### 1.6 Copy

**Lab switch and note**

| Where | Text |
|---|---|
| Section title and switch | Lab |
| Switch footer | New features we’re trying out. Turn Lab off for the plain app; nothing you sent is lost. |
| One-time note (button **OK**; only in builds with F01 or F04, 1.2) | Lab is on. New features to try are in Settings › Lab, where you can turn it off. |
| List title | What’s in Lab |
| A feature with nothing missing | Ready |
| Server row subtitle | Optional · {short state} |
| Server features heading | With your Daylight server (optional) |
| Comfort switch (baseline, F27; not under Lab) | Comfort |
| Comfort footer | Larger text and buttons, more contrast, no motion. |
| Answer from an automation entry with Lab off | Turn on Lab in {app} to use this. |

`{app}` is "Send to Daylight" on Apple, the extension, the web sender and Windows, and "Daylight Share" on Android.

**Needs-setup states.** This extends the style of CHANGES-v1.1 2.5 and adds to DESIGN 14.1.

| State | Decided by | Message | Button |
|---|---|---|---|
| `needs-pairing` | app: not paired | Pair with your Daylight first: open Daylight Share on the Daylight and scan or type its code here. | — |
| `needs-inbox` | app: no fresh Lab hello carrying the feature's capability (2.2.6) | Your Daylight hasn’t confirmed Lab yet. Update Daylight Share on it and open it once. | — |
| `needs-notifications` | app: OS permission off | Needs notifications for {app}. Turn them on in {path}. | Open Settings |
| `needs-quick-sends` | app: setting off (F09) | Quick sends from other apps are off. Turn on “Allow quick sends from other apps” in Lab settings. | Open setting |
| `needs-site-access` | extension: host permission | Needs access to this site. Choose Allow when your browser asks. | Allow |
| `needs-server` | app (2.6) | Needs your Daylight server. Add the Cloudflare secrets to turn this on (Lab › Daylight server shows how). | Copy Server code |
| `needs-lab-inbox` | server (2.6) | Your Daylight server hasn’t heard from your Daylight yet. Open Daylight Share on it with Lab on. | — |
| `pairing-mismatch`, `server-outdated`, `app-outdated`, `locked`, `needs-key`, `needs-domain`, `needs-r2`, `needs-paid`, `OFFLINE`, `error` | app or server (2.6) | Exactly `STATE_MESSAGES[state]` from `server/client/daylight-server.js` (DESIGN 14.1), or the server's own `message` for `error` | — |
| `later` | app: the server answers ready, this app lacks the feature yet | Your Daylight server is ready. {feature} comes to this app in a later Lab update. | — |

No W0 or W1 feature gates on a Reader capability, so there is no Reader state in `LAB_TEXT`. The phone features of
R2–R4 (W2 and later) add their own, worded then, and show them only for the lab tablet's pairing.

`{path}` for notifications:

| Platform | `{path}` |
|---|---|
| iPhone | Settings › Notifications › Send to Daylight |
| Mac | System Settings › Notifications › Send to Daylight |
| Android | Settings › Apps › Daylight Share › Notifications |
| Windows | Settings › System › Notifications › Send to Daylight |

`needs-inbox` and `needs-lab-inbox` are different states:

- **`needs-inbox`** is decided by this app, from its Lab ledger. No fresh Lab hello reached it, usually because
  Daylight Share on the Daylight is old or hasn't run for a while.
- **`needs-lab-inbox`** is decided by the server: its delivery lane has no hello yet.

Under controls, `LAB_TEXT` overrides the module's `needs-server` and `needs-lab-inbox` texts with the two above. The
**Daylight server** section (2.6) keeps DESIGN 14.1's long texts, with the exact secret names and the re-run step,
because that is where setup happens. The server lane brings DESIGN 14.1's `needs-lab-inbox` text in line in Wave S
(S0, 4.2).

### 1.7 Test hooks (test builds and launch arguments only)

| Platform | Hook |
|---|---|
| Apple | Launch arguments `-DLSLab 0\|1` and `-DLSComfort 0\|1`; `debug-status.json` gains `lab`, `caps` and `labStates` |
| Android | The debug setup link gains `lab=0\|1` |
| Extension | The `chrome-test` build reads a seeded `settings.lab` |
| Web | `?lab=0\|1`, honoured only when the page is served from `127.0.0.1` |
| Windows | `--e2e-lab 0\|1` in test mode; the status file gains `lab` |

**Lab-off parity test (F00, every app).** With Lab off, the accessibility tree of each main screen must equal a
baseline recorded from the last non-Lab build of the same app. That build is the app's P0 close-out: v1.1 plus the
F27 baseline with Comfort (0.2). The tree is element types, labels and values, in order. Each platform records it
with a tool whose output is stable across tool releases:

- Apple: an explicit walk of the `XCUIElement` tree (`elementType`, `label`, `value`, in order). Not
  `debugDescription`, whose format changes between Xcode releases.
- Android: the Compose semantics tree in Robolectric.
- Extension, web and Windows: Playwright `locator('body').ariaSnapshot()` (YAML). Not `page.accessibility.snapshot()`,
  which Playwright 1.56 deprecates and which is effectively Chromium-only.

Baselines live next to the tests (`…/lab-off-baseline/*.json` or `*.yml`) and are re-recorded only together with a
matching non-Lab change. Pixel screenshots are uploaded as CI artifacts for review, not compared.

---

## 2. Shared foundations

### 2.1 Compatibility rules (binding)

1. `v` stays `1`. Frames, keys, the inbox and ack topics and the pairing link are unchanged.
2. Lab adds only:
   - item header fields named `x-…`, which receivers pass on as validated extras (2.3);
   - frames on the ack topic whose `ids` is `[]` and that carry `x-inbox` and maybe `x-st` (2.2);
   - new derived topics with their own AAD (2.4);
   - the server lane, as DESIGN 5 specifies.
3. An ack frame that lists ids never carries Lab fields, so the v1.1 size proof for acks stands.
4. A v1.0 or v1.1 sender that reads a Lab frame finds `kind: "ack"` and `ids: []`, and nothing happens: JS
   `checkAcks` adds no id, Kotlin `AckHeader.idsOf` returns `[]` and Swift `AckHeader.ids(in:)` returns `[]`. The
   vectors prove it in all three (2.8).
5. A Lab sender whose Inbox is not Lab shows exactly the v1.1 rows (`describeRow`).
6. Everything Lab reads from the wire is untrusted. It is validated as in 2.2.5, a reader never throws on it, and
   unknown fields, tokens and values are ignored.
7. `LAB_LEVEL = 1`. A later incompatible change to a Lab structure raises it. A reader treats a Lab frame whose
   `lab` is above its own `LAB_LEVEL` as unknown (2.2.5). So an Inbox that raises the level keeps sending level-1
   frames as long as it supports level-1 senders.
8. Lab frames are the lowest priority on the household's relay budget (2.2.7). They never delay an ack, and they are
   the first traffic to give way.

### 2.2 Lab frames on the ack topic: hello and item states (the return path for W0/W1)

**2.2.1 Frame.** A Lab frame is sealed exactly like an ack: the pairing key, AAD `dlshare/v1/ack`, on the ack topic,
always a small frame published with `POST`. Header:

```json
{"v":1,"kind":"ack","ids":[],"sent":"2026-10-20T08:00:00.000Z","from":"Anjan’s Daylight",
 "x-inbox":{"lab":1,"app":"android/1.5.0","caps":["st","tap","reader-link","cap-kind"],
            "poll":"2026-10-20T07:59:58.000Z","live":true},
 "x-st":[{"i":"0f1e2d3c4b5a69788796a5b4c3d2e1f0","s":"reader","t":1792483198},
         {"i":"00112233445566778899aabbccddeeff","s":"waiting","t":1792483190}]}
```

| `x-inbox` field | Type | Rule |
|---|---|---|
| `lab` | integer | The Lab level the Inbox speaks; `0` in the one frame sent when Lab is turned off |
| `app` | Printable ASCII string, ≤ 60 characters, the server's clamp too (readers clamp anything longer and drop anything else, 2.2.5) | `android/<versionName>` (Daylight Share) or `reader-lab/<versionName>` (the Lab Reader). The part before the first `/` names the publisher (2.2.6). |
| `caps` | array of ≤ 16 tokens, each `/^[a-z0-9-]{1,16}$/` | 2.2.2 |
| `poll` | ISO 8601 UTC with milliseconds | When the Inbox last polled the inbox topic successfully |
| `live` | boolean | Instant delivery has a connection open now |

`x-st` is optional and holds at most **24** entries `{i, s, t}`:

- `i` is an item id (32 lowercase hex);
- `s` is a state token (2.2.3);
- `t` is when the Inbox reached that state, in Unix **seconds**.

**Size.** The worst case is not 60 emoji in `from` but 60 lone surrogates: `JSON.stringify` and Kotlin's
`Json.quote` escape each one as 6 bytes (`\ud800`). Add `app` of 60 characters, `lab` 99, 16 caps of 16 characters
and 24 entries with 7-character states and 10-digit times. The header is then 2,572 bytes, the frame 2,608 bytes and
its base64 3,480 characters, under 3,800. (Swift strings cannot hold lone surrogates, so Swift's worst case is
smaller.) `buildLabFrame` refuses more than 24 entries and checks `isSmallFrame`, and a vector pins this case.
`LabInbox.flush()` never stalls on a refusal (2.2.4).

**2.2.2 Capability tokens.**

| Token | Meaning | Who sets it | Wave |
|---|---|---|---|
| `st` | Sends item states (`x-st`) | Lab Inbox, Lab Reader | W0 |
| `tap` | Reports `waiting` when an item waits for a tap | Lab Inbox | W0 |
| `reader-link` | Its Reader confirms links and pages (`reader`, `queued`) | Lab Inbox, when the link target answers `SAVE_PAGE` (`ReaderApps.takesLinks` with `savePage`); Lab Reader | W0 |
| `cap-kind` | Shows the `x-cap` kind on its rows | Lab Inbox | W1 |
| `reader-doc` | Its Reader confirms documents | Lab Reader only (R1) | R1 |
| `quiet` | Items reach the Reader without anything opening on the Daylight | Lab Reader only (R1) | R1 |
| Reserved | `note`, `dest`, `hold` (F12) · `lan` (F13) · `return` (F06) · `stack` (F14) · `manifest`, `control` (F20) · `marks` (R2) · `queue` (R3) · `reading` (R4) · `server` (server lane) | — | later |

**2.2.3 Item states.**

| `s` | Rank | Meaning | The Inbox reports it when |
|---|---|---|---|
| `waiting` | 1 | Waits for a tap on the Daylight | The item is first announced (notification or card). Never again for the same id. |
| `held` | 2 | Kept in the Inbox for later, on purpose | **Keep for later** is chosen on its notice or card, or its notice is swiped away (F15) |
| `inbox` | 2 | Stays in the Inbox: no Reader takes it | Kept in the Inbox (`no_reader`, `no_route`) |
| `handed` | 3 | Handed to the Reader, which did not confirm | Status `sent`, `ok` or `no_answer`. Today that is every document, and a refused `SAVE_PAGE` that was retried as a shared link. |
| `failed` | 3 | The Reader tried and could not add it | Lab Reader import failure (R1) |
| `queued` | 4 | In the Reader's read-later queue; downloads when online | `SAVE_PAGE` status `queued` |
| `reader` | 5 | In the Reader's library | `SAVE_PAGE` status `saved` or `duplicate`; the Lab Reader's import done, or already on the shelf |

These are the Inbox's own log statuses (`HandoffActivity.start`/`done`, README "Debug builds"), mapped: `saved`,
`duplicate` → `reader`; `queued` → `queued`; `no_reader`, `no_route` → `inbox`; `sent`, `ok`, `no_answer` and **any
status not listed here** → `handed`. (The Reader's status is a free string, `EXTRA_STATUS.take(20)`.)

`held` ranks above `waiting`, so a re-announced item (`HandoffActivity`'s `finally` calls `notifyWaiting` again on
everything still waiting) can never go back from "Kept for later" to "Waiting for a tap", on the Inbox or on a
sender.

**2.2.4 When the Inbox publishes.** Lab frames come last on the household's relay budget (2.1 rule 8, 2.2.7).

- **Which items.** Only items received on the pairing's inbox topic. Items from the server lane (S0) are tagged
  `lane = "server"` in `InboxItem` and get no states: no sender holds their ids, and their states would push sender
  items out of the state digest.
- **States.**
  - `LabInbox.record(id, s, t)` persists an entry. For the same id, a new entry replaces an unpublished one only
    under the ledger's merge rule: a higher rank, or the same rank with a later `t` (2.2.6).
  - `LabInbox.flush()` publishes pending entries, oldest first, in frames of at most 24. It runs:
    - after every poll or live batch, once its acks are out;
    - at the end of every hand-off run (`HandoffActivity`'s `finally`);
    - otherwise 2 s after the last `record`.
  - **Spacing.** At most one Lab frame every 30 s. A flush that comes sooner waits until 30 s after the previous Lab
    frame, and takes along whatever was recorded meanwhile.
  - **Giving way.** `flush()` publishes nothing, and keeps its entries, while the last poll's acks failed to
    publish, or within an hour of any `429` or `413` from the relay (`LabInbox.noteRelayLimit`). It runs again at
    the next flush point after that.
  - **Daily cap.** At most 30 Lab frames (hellos and state frames) per UTC day. Past the cap, states wait for the
    next state digest, and hellos for the next day.
  - **Never stalls.** If `buildLabFrame` refuses a batch as not small, `flush()` halves the batch and tries again,
    down to one entry. The 2.2.1 bound makes this unexpected. An entry that still does not fit is dropped and logged.
  - With no network, `flush()` schedules the WorkManager one-time job `lab-flush` with a `CONNECTED` constraint.
  - A failed publish keeps the entries. At most 500 pending entries are kept; the oldest go first.
- **Hello.** A hello is a Lab frame with no `x-st`. It goes out:
  - when Lab is turned on;
  - when `caps` or `app` changed since the last Lab frame;
  - at any flush when the last Lab frame is more than 11 hours old (so at most 3 a day while idle).

  Every frame that carries states also carries `x-inbox` and counts as a hello. When Lab is turned off, the Inbox
  sends one frame with `lab: 0` and `caps: []`. For the next 48 hours, each v1.1 ack digest is followed by the same
  `lab: 0` frame (at most 5 more frames), so a sender that was offline still sees it. Then nothing.
- **State digest.** With the v1.1 11-hourly ack digest, the Inbox republishes the latest state of every item whose
  state changed in the last 48 hours: at most 48 entries (2 frames), newest first. A sender that missed a frame
  catches up. For this, `LabInbox` keeps every published entry `{id, s, t}` for 48 hours in its store, next to the
  pending ones, the time of the last Lab frame and the day's frame count. Digest frames follow the giving-way rule
  but not the daily cap.
- **Order.** No order relative to acks is needed. A sender keeps states for ids it has not seen acked and uses them
  only once the row is delivered (2.2.6).
- **Budget.** Idle: at most 3 hellos a day, plus 1 per Lab toggle. Busy: at most 30 Lab frames, plus 4 digest
  frames. 2.2.7 has the whole household; the soak checks it (2.8).

**2.2.5 Parsing.** This is an exact algorithm: JS, Kotlin and Swift must produce the same result, and the
`labParse` vectors pin every step.

```
parseLabAck(header) -> {inbox: Info | null, states: [{id, s, t}]}                     never throws
  1. header is not a JSON object, kind != "ack", or ids is not an empty array  -> {null, []}
     (Lab fields count only on frames whose ids is [].)
  2. x = header["x-inbox"]
     x is an object and x.lab is an integer (rule I):
        x.lab > LAB_LEVEL        -> return {null, []}       a later level is unknown (2.1 rule 7)
        x.lab < 0                -> inbox = null
        otherwise                -> inbox = {lab, app, caps, poll, live}:
          app  : a string made only of printable ASCII (U+0020 to U+007E) -> its first 60 characters;
                 anything else (non-ASCII included) -> ""
          caps : an array -> (a) take its first 16 elements, (b) keep the strings that match
                 /^[a-z0-9-]{1,16}$/, (c) drop repeats, keeping the first; anything else -> []
          poll : a string matching /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/ whose
                 fields pass rule D -> ms since 1970-01-01 UTC (the fraction right-padded to 3 digits);
                 else null
          live : true only for the JSON value true
     otherwise inbox = null
  3. x-st is an array -> (a) take its first 64 elements, (b) keep each element that is an object with
        i : a string matching /^[0-9a-f]{32}$/,
        s : one of the 7 tokens of 2.2.3,
        t : an integer (rule I) with 0 <= t <= 4102444800,
     in order, repeats of an id included (the ledger merges them in order, 2.2.6); anything else -> []

  Rule I, integers. A JSON number (not a string and not a boolean) whose value is a whole number:
     1, 1.0 and 1e0 are 1; -0 is 0; "1", true, 1.5 and 1e400 are not integers.
     Kotlin: JsonPrimitive with isString == false, content.toDoubleOrNull() finite and whole.
     Swift: an NSNumber that is not a CFBoolean, finite and whole.
  Rule D, dates. Checked field by field, never with a platform date parser (JS Date.parse accepts
     2026-02-30 and T24:00): month 1-12; day 1 to the month's length (February has 29 days in Gregorian
     leap years); hour 0-23; minute 0-59; second 0-59.
  A header that the platform's JSON parser rejects outright counts as step 1. Vectors keep every number
  within ±1e300, which every parser reads, and store headers as JSON text so every port parses the same source.
```

**2.2.6 Sender ledger (`LabLedger`).** It records every ack-topic message that decrypts, whether Lab is on or off,
through the Sender's `onAckHeader` hook (2.7.1). It stores:

| Key (JS storage; a `lab.json` file next to the outbox in Kotlin and Swift) | Content |
|---|---|
| `lab/inbox` | One entry per **publisher**: its last `Info`, plus `at` = that message's relay `time` in ms. The publisher is the part of `app` before the first `/` (`android`, `reader-lab`; anything else, an empty `app` included, is `other`). A message replaces its publisher's entry when its `at` is the same or later. Messages are processed in the order the poll returns them, so a tie within one relay second goes to the later message. |
| `lab/heard` | The latest relay time (ms) of any ack-topic message that decrypted: an ack or a Lab frame |
| `lab/states` | id → `{s, t}`. A new entry replaces the stored one when its rank is higher, or when the ranks are equal and its `t` is later. Pruned to ids still in the Sender's outbox or in the hosted outbox (`server/hosted`, F02), at most 200. |

- **Pairing changes.** A different secret removes every `lab/*` key with the outbox (`applyPairingChange`). The same
  secret keeps them.
- **Two Inboxes on one ack topic.** During a handover (5.3.4), Daylight Share and the Lab Reader both publish on the
  same ack topic. Each keeps its own entry, so neither overwrites the other's caps (`reader-doc`, `quiet`).
- **Derived values.**
  - A publisher is **fresh** when `now − at ≤ INBOX_STALE` = 36 hours, three hello periods.
  - `inboxLab()` = some fresh publisher has `lab ≥ 1`. A publisher's `lab: 0` frame replaces its own entry, so it
    ends that publisher's Lab at once. A sender that missed the `lab: 0` frame gets it again from the 48-hour repeat
    (2.2.4), and in any case the entry goes stale after 36 hours.
  - `caps()` = the union of the caps of the fresh publishers with `lab ≥ 1`. `hasCap(t)` = `t` is in `caps()`.
  - Each publisher's `poll` is clamped to no later than the relay `time` of the message that carried it, so a
    Daylight whose clock runs fast cannot read as "just now" forever.
  - `checkedIn()` = the later of `heard` and the newest clamped `poll`, or null.
  - `state(id)` is shown only for rows whose status is `delivered`.
- **No row says Delivered without an ack.** An ack frame listing the id is the only way into `delivered`; states
  never change a row's status.

**2.2.7 Household message budget.** ntfy.sh allows about 250 published messages a day per IP address. At home the
phone, the Mac and the DC-1 share one address. Polls are requests, not messages: they count only against the request
rate, a burst of 60 refilled at one per 5 s. The server's own messages (config frames, server items) come from
Cloudflare's addresses (DESIGN 5.3) and are not counted here. The server lane's acks, though, come from the DC-1 and
are.

A busy day: 30 items sent (20 links and pages, 10 files of 1–3 parts), Documents = Ask, Instant delivery on, and the
server lane delivering 60 feed items.

| Traffic | Published by | Messages a day | What bounds it |
|---|---|---|---|
| Item frames | senders | ≈ 40 | v1.1: one message per small frame, files in parts of ≤ 1.9 MB |
| Re-sends | senders | ≤ 5 | v1.1: 11 h for messages, 185 min for attachments, three tries when the relay is full |
| Acks, pairing lane | DC-1 | ≤ 30 | One per poll or live batch that brought new items |
| v1.1 ack digests | DC-1 | ≤ 8 | ≤ 4 frames every 11 h |
| Lab hellos and state frames | DC-1 | ≤ 30 | The daily cap and 30 s spacing (2.2.4) |
| Lab state digests | DC-1 | ≤ 4 | 2 frames every 11 h |
| Server-lane acks and hellos (Wave S) | DC-1 | ≤ 27 | S0 sends server-lane acks at most once every 15 minutes while items arrive (≤ 24 for hourly feeds), plus 3 hellos |
| **Household total** | | **≤ 144** | **Target: ≤ 150** |

Return-lane traffic (W2 and the Reader work) must fit the same target before it ships. That covers F06 items, which
the user starts (about 5 a day); R2 marks (≤ 6 batches); R3 manifests (≤ 8, 2.4); R4 progress (≤ 6); and each
device's return acks. L2 adds these rows to this table and to the soak. While return traffic runs, the Lab state cap
drops to 20.

### 2.3 Item header fields (W1) and reserved names

| Field | Value | On kinds | Meaning | Written by | Read by |
|---|---|---|---|---|---|
| `x-cap` | `"seen"`, `"clean"`, `"excerpt"` or `"test"` | page, file | How the content was made: the page as rendered (F03), a Readability article (F10), a selection excerpt (F11), the setup test article (F26) | extension, iPhone share extension, Android, Mac Services, CLI | Lab Inbox row line (F03, F11) |
| `x-orig` | a URL passing the web URL rule | url, page | The URL as shared, when `normaliseShare` changed it (F16) | every sender, Lab on | Lab Inbox item details ("Cleaned from {host}") |

Senders add these only with Lab on. Inboxes ignore an unknown value, and an `x-orig` that fails the web URL rule.

- **`x-orig` stays small.** A sender leaves `x-orig` out when it is over 1,024 characters, or when it would turn a
  small frame into a large one (over 3,800 base64 characters). A large frame would make the item an attachment: kept
  3 h, re-sent at 185 minutes and counted against the 20 MB per sender. Vectors pin both cases.
- **How they reach the Inbox.** Today's validators drop unknown fields: JS `checkItemHeader` returns a cleaned copy
  with only known fields, and Kotlin's `ItemHeader.check` returns a typed `ItemHeader`. So L0 and K0 (W0) make them
  also return **`extras`**: `x-cap` when it is one of the four values, and `x-orig` when it passes `webUrl`, both read
  from part 0 only. Every other `x-` field is still dropped. `Reassembler.add` and `Receiver.accept()` carry `extras`
  with the item. Swift's `ItemHeader` does the same (A0) for parity. The Inbox stores the extras in `InboxItem` (K5).
  The `labHeaderExtras` vectors pin it.

**Reserved** (no other use): `x-note`, `x-tags`, `x-dest`, `x-private`, `x-to`, `x-rk`, `x-dev`, `x-anchor`,
`x-item`, `x-inbox`, `x-st`, and the server's `x-origin` and `x-about`.

### 2.4 Return lane and control lane (specified now, built in W2 and W3)

These carry what goes from the DC-1 back to phones and computers, beyond states: items shared from the Daylight
(F06), highlights and notes (R2), the tablet's queue (R3), reading progress (R4) and, in the other direction,
commands (F20, F21). Labels end in a `0x00` byte, like the server's (DESIGN 3.2):

```
returnTopic     = "dls-" + hex(SHA-256("dlshare/v1/lab-return\0"      ‖ secret))[0:32]   AAD "dlshare/v1/lab-return"
returnAckTopic  = "dls-" + hex(SHA-256("dlshare/v1/lab-return-ack\0"  ‖ secret))[0:32]   AAD "dlshare/v1/lab-return-ack"
controlTopic    = "dls-" + hex(SHA-256("dlshare/v1/lab-control\0"     ‖ secret))[0:32]   AAD "dlshare/v1/lab-control"
controlAckTopic = "dls-" + hex(SHA-256("dlshare/v1/lab-control-ack\0" ‖ secret))[0:32]   AAD "dlshare/v1/lab-control-ack"
key             = the pairing key (PROTOCOL 1.4), as for the inbox and ack topics
```

- **Lane.** A *lane* is `{itemTopic, ackTopic, itemAad, ackAad}`. The v1 lane is
  `{inboxTopic, ackTopic, "dlshare/v1/inbox", "dlshare/v1/ack"}`. The return lane runs the protocol's `Sender` (on
  the Daylight) and `Receiver` (on phones and computers) with their own topics and AADs. Frames, chunking, re-sends,
  acks, dedupe and every limit of PROTOCOL 2–4 apply as they are. It is not "unchanged", though: L2 adds three
  things to `Sender` and `Receiver`:
  - a `lane` option (topics and AADs);
  - a storage prefix per lane (`lane/<name>/…` in JS storage; a `lane-<name>/` folder in Kotlin and Swift), so the
    two outboxes never share keys;
  - per-device delivery (below), because v1.1's `_checkAcks` counts any ack.
- **Device ids.** Each phone and computer keeps a random 16-hex id, `x-dev`. It is stored locally, never synced, and
  new after a reinstall. `from` is free text and often repeats ("iPhone"), so it cannot name a device. With Lab on, a
  device puts `x-dev` in its item headers on the pairing lane (W2) and in its return-lane acks. The Daylight learns
  its devices from them, keeping the 8 most recently heard.
- **Return items** are ordinary item headers (PROTOCOL 2.1) plus two fields:
  - `x-rk`: `"share"` (the user shared it on the DC-1, F06), `"marks"` (R2), `"queue"` (R3) or `"reading"` (R4);
  - `x-to`: optional, one device's `x-dev`; absent means every known device.

  `marks`, `queue` and `reading` are `kind: "file"` with the MIME types `application/vnd.daylight.marks+json`,
  `…queue+json` and `…reading+json` (5.4–5.6). A device acks every return item it reads, even one whose `x-rk` it
  does not know (it drops that one).
- **Delivery per device.** The Daylight's return outbox tracks each item per target device. The item is delivered to
  a device when an ack carrying that device's `x-dev` lists it, and it is done when every target has acked, or after
  7 days. Without `x-to`, the targets are the known devices at publish time (at most 8), so the first device's ack
  no longer stops the re-sends another device still needs. An ack without `x-dev` counts for no device.
- **Manifests replace each other.** A `queue` manifest (R3) is published only when its content hash changed, at most
  once an hour. Publishing one removes every older, un-acked manifest from the return outbox, so a superseded
  manifest is never re-sent for 7 days.
- **Budget.** Every return-lane row is in 2.2.7 before it ships.
- **Control frames** (W3) are reserved: `{v:1, kind:"cmd", id, cmd, args, sent, from}`, acked on `controlAckTopic`.
- **AADs.** The protocol module's `aadFor` becomes an explicit map: `inbox`, `ack`, `lab-return`, `lab-return-ack`,
  `lab-control`, `lab-control-ack`. An unknown purpose throws `ShareError('purpose')`, as DESIGN 17.2 asks. The
  vectors pin the derived topics and one sealed return frame from W0, so every port derives them identically before
  they are used.

### 2.5 Delivery timeline text

`describeLabRow(row, now, ctx)`, where `ctx = {lab, inboxLab, hasCap, state, online}`, returns
`{label, sentence, action, stepLine, final}`. Rules in order:

1. `ctx.lab` is false → `describeRow(row, now)`, with no steps.
2. Offline (`ctx.online === false`) and the row is `sending`, or `failed` with error code `network` →
   **Waiting for connection** (table below).
3. Not `delivered` → `describeRow(row, now)`, plus steps.
4. `delivered` and not `ctx.inboxLab` → `describeRow` (Delivered ✓, "Saved on your Daylight."), with no steps. This
   is what keeps a v1.1 Inbox's rows exactly as today.
5. `delivered` and `ctx.inboxLab` → the state's row below.

| Row | Label | Sentence |
|---|---|---|
| Lab, offline, pending | Waiting for connection | It will send when this device is back online. |
| Delivered, Lab Inbox, no state yet | On your Daylight ✓ | Saved on your Daylight. |
| `waiting` | Waiting for a tap on your Daylight | Tap its notice on your Daylight to add it to the Reader. |
| `held` | Kept for later on your Daylight | It waits in Daylight Share until you add it to the Reader. |
| `inbox` | In Daylight Share on your Daylight | No Reader on your Daylight takes this, so it waits in Daylight Share. |
| `handed`, a file | Handed to the Reader | Your Daylight passed it to the Reader. The Reader doesn’t confirm documents yet. |
| `handed`, a link or page | Handed to the Reader | Your Daylight passed it to the Reader as a shared link. The Reader doesn’t confirm those. |
| `failed` | Not added to the Reader | The Reader couldn’t open this. It waits in the inbox on your Daylight. |
| `queued` | In your Reader’s queue | The Reader will download it when your Daylight is online. |
| `reader` | In your Reader ✓ | Saved in the Daylight Reader. |

Delivered rows have no action button; every row can be removed. The Reader step is never a control: tapping a row
opens its details, and nothing on a row asks for setup.

**Step line.** There are three steps, in the user's words: "Sent", "On your Daylight" and "In the Reader". Each has a
mark: `✓` done, `…` under way, `!` stopped, or none (not reached yet). For `handed`, the third step reads "Handed to
the Reader" with no mark, because the Reader did not confirm it. Steps are joined with ` · `.

| Row | Step line |
|---|---|
| `sending`; offline waiting | Sent … · On your Daylight · In the Reader |
| `failed`, `expired` | Sent ! · On your Daylight · In the Reader |
| `sent` | Sent ✓ · On your Daylight … · In the Reader |
| Delivered with no state; `waiting`; `held` | Sent ✓ · On your Daylight ✓ · In the Reader … |
| `handed` | Sent ✓ · On your Daylight ✓ · Handed to the Reader |
| `inbox`, `failed` (state) | Sent ✓ · On your Daylight ✓ · In the Reader ! |
| `queued`, `reader` | Sent ✓ · On your Daylight ✓ · In the Reader ✓ |

**What a row shows.** A history list stays light:

- Every row shows its title and label.
- The sentence and the step line show on the **newest row**, and on every row that is **not final**. `final` is true
  for `reader`, `queued` and `handed`. Rows from rules 2 and 3 are in flight or failed, so they are never final. Rows
  from rules 1 and 4 are v1.1's `describeRow`, with no step line, and keep v1.1's layout exactly.
- Everywhere else they are in the row's details (tap the row).
- The row's accessibility label is `{label}. {sentence}`, whether the sentence is shown or not. It has no step count.
  The step line is hidden from screen readers, because the label says it. The marks are glyphs and words, never
  colour alone.

**Check-in header** (Lab on, paired; above the history): "Your Daylight checked in {rel}."

- `{rel}` is "just now" under 60 s, "{m} min ago" under 60 minutes, "{h} h ago" under 48 hours, else "{d} days ago".
- With no check-in yet: "Your Daylight hasn’t checked in since this device paired."
- It comes from `checkedIn()` (2.2.6). With a v1.1 Inbox it still works, from ack times. It never blocks sending.

**Faster checks while something is in flight.** While the app or popup is visible and a delivered row from the last
10 minutes has no settled state (`reader`, `queued`, `handed`, `inbox`, `failed`, `held`), the sender reads the ack
topic every 30 s instead of its normal interval.

### 2.6 Server discovery and the NEEDS_KEY / NOT_CONFIGURED mapping

The JS apps use `server/client/daylight-server.js` as it is. Swift and Kotlin port the W0 subset below under the
same names, and pass `server/vectors/server-vectors.json`. Discovery runs only with Lab on (DESIGN 4.3).

| Source | Answer | `state(feature)` | App does |
|---|---|---|---|
| discovery | No config and no pin | `needs-server` | Show it, with **Copy Server code** |
| discovery | The pinned origin belongs to an earlier pairing's fingerprint | `pairing-mismatch` | Show it |
| config | `api` > `SERVER_API` / `api` < `SERVER_API_MIN` | `app-outdated` / `server-outdated` | Show it |
| config | Same fingerprint, new origin | ready, on the old pin | Sheet "Your Daylight server moved to {host}. Use it?"; `confirmMove()` on yes |
| any request | No network | `OFFLINE` | Show it |
| any request | `401 BAD_AUTH` | `error` | `discover({force: true})` once, then show the `BAD_AUTH` message |
| any request | `423 LOCKED` | `locked` | Show it |
| `GET /v1/status` | `features[f].state` is `needs-key`, `needs-r2`, `needs-domain`, `needs-paid` or `needs-lab-inbox` | that state | Show it |
| a call | `409 NEEDS_KEY` | `needs-key` | `server.noteError(feature, err)` updates the cached status; show |
| a call | `409 NOT_CONFIGURED`; `missing` is read in this order: `DAYLIGHT_SERVER_CODE`, `DAYLIGHT_EMAIL_DOMAIN`, `R2` (the client module's order, which DESIGN 10.4 omits) | `needs-server`, `needs-domain` or `needs-r2` | `noteError`; show |
| a call | `409 NEEDS_LAB_INBOX` | `needs-lab-inbox` | `noteError`; show |
| a call | `429 RATE_LIMITED`, `AI_BUSY`, `AI_QUEUE_FULL` | stays ready | Show the server's message and wait `retryAfter` |

**The 5 s bound.** `DaylightServer.state()` may wait on `_origin()`, `discover()` and a relay poll that has no
timeout; only `status()` races 5 s. So `labGate` puts its own 5 s deadline around `server.state()`, which yields
`OFFLINE` (2.7.2), and the Swift and Kotlin gates do the same.

**Client-module change (SV0, server lane, W0).** The JS apps use the module unchanged, so the small additions they
need come from the server lane:

- `DaylightServer.noteError(feature, error)` updates the cached status from a `ServerError`. Nothing outside the
  module writes `server/status`.
- A `serverState` section in `server-vectors.json`: status JSON or error JSON in, `{state, message}` out, including
  the `NOT_CONFIGURED` order. With it the Swift and Kotlin ports cannot map states differently.
- DESIGN 13.1's storage keys gain `server/pendingMove`, which the module already uses and the ports follow.
- `pollAcks` tests with Lab frames (2.8).

Swift and Kotlin mirror `noteError`.

**Lab feature → server feature key.** Summaries with Claude → `ai` (`pdf` when the source is a PDF). Email-in address
→ `email`. Feeds and daily digest → `feeds`. Files over 9 MB → `files`. "Also send the result to my Daylight" →
`deliver`.

**The "Daylight server" section (W0)** is where setup happens, so it carries the long texts. Its row under Lab is
subtitled "Optional · {short state}". It shows:

- the state: "Ready", or the state's long message (DESIGN 14.1, with the exact secret names);
- when the server is not set up, the setup steps in brief (server README "Turning it on", steps 1–5 and 10), with
  step 5's **Copy** button for the Server code;
- the server's host and fingerprint ("3f9a-1c2e");
- the delivery mode, with the v1 notice when it applies (DESIGN 14.3);
- the **Server code** with **Copy** (the `daylightserver://` link form when the relay is not ntfy.sh);
- "Lab Inbox last seen {rel}", or "Your Daylight hasn’t said hello to the server yet.";
- "AI today: US${used} of US${cap}" (display only until Wave S);
- the optional **Server address** field;
- `RERUN_HELP`.

The Server code is on the critical path: the server's deploy needs it (server README step 5). So the iPhone and Mac
show it in W0.

**Re-pairing.** Before replacing a pairing while a server pin exists, call `lockBeforeRepair()`, whether Lab is on or
off. Afterwards, show the new Server code and the re-run help (DESIGN 12.7).

**W0 subset for Swift and Kotlin:**

- `SERVER_API`, `SERVER_API_MIN`;
- `deriveServerSeed`, `formatServerCode`, `parseServerCode`, `deriveServerValues`, `showFingerprint`;
- `openBox` (config only), `checkConfig`, `pollServerTopic`;
- `DaylightServer`: `discover`, `confirmMove`, `setManualUrl`, `clearManualUrl`, `status`, `state`, `request`,
  `noteError`, `lockBeforeRepair`, `notice`, `markNoticeShown`;
- `STATE_MESSAGES`, `ERROR_MESSAGES`, `errorMessage`, `localMessage`, `noticeText`;
- the storage keys of DESIGN 13.1, `server/pendingMove` included.

They must pass `server-vectors.json` › `derived`, `serverCodeParsing`, `frames` (config), `negative` (config parts)
and `serverState`. Wave S adds the rest.

**Setup link (added Oct 22; server DESIGN 3.5).** The deploy needs only `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`, so it cannot know the Server code. Instead it makes a one-time **setup link**
(`https://daylight-<12 hex>.<subdomain>.workers.dev/setup#SETUP-…`), which the user reads in Cloudflare and pastes into
one app. That app sends the server this pairing's Server code. Every other device and the Lab Inbox then find the server
as before. `DAYLIGHT_SERVER_CODE` still works and always wins.

- **W0 subset, Swift (A0, kit lane):** `SETUP_HOST`, `parseSetupLink`, `deriveSetupToken` and `DaylightServer.setup(link)`.
  They follow the client module exactly, including its error reasons (`format`, `host`, `checksum`, `server-code`,
  `pairing-code`) and messages. They pass `server-vectors.json` › `setupLinks`. If A0 is already done without them, they
  are A1's first commit (titled "kit: …"); A2 waits for that commit and never writes a second copy.
- **Kotlin:** Wave S (with S0). The Android app needs no setup link in W0: the server's README tells users to paste it
  in the iPhone or Mac app.
- **JS apps:** the module already has them. X0, B0 and WIN0 may add the row; it is not required in W0.
- **Where it shows.** The Daylight server section (iPhone and Mac in W0) shows a **Set up with a link** row while the
  server's state is `needs-server`, `pairing-mismatch` or `locked`, or after a `BAD_AUTH` (their messages say to paste a
  new setup link). Elsewhere it stays under the section's other rows. The flow:
  1. A text field and a **Set up** button.
  2. `parseSetupLink` runs locally. A refused link shows the module's message for its reason; nothing is sent.
  3. A confirmation that shows the link's address (`parseSetupLink(link).server` minus the scheme). Nothing is sent
     unless the user confirms (DESIGN 3.5: a look-alike Worker name on someone else's account is possible).
  4. `DaylightServer.setup(link)`, with "Setting up…" while it runs. Success shows the done line, and the section
     re-reads the state. Failures show the module's messages (`SETUP_USED`, `SETUP_INVALID`, `BAD_AUTH`, `423`,
     offline).
- **Copy** (LAB_TEXT `serverSection`, added by the share lane before A0; ASCII apostrophes here, ’ in the apps):

  | Id | Text |
  |---|---|
  | `setupRow` | Set up with a link |
  | `setupFooter` | Paste the setup link from your deploy. It gives your own Daylight server this pairing's Server code, once. |
  | `setupPlaceholder` | https://daylight-….workers.dev/setup#SETUP-… |
  | `setupButton` | Set up |
  | `setupConfirmTitle` | Use this Daylight server? |
  | `setupConfirmBody` | {host} will get this pairing's Server code. Continue only if this address is on your own Cloudflare account. |
  | `setupConfirm` | Use it |
  | `setupCancel` | Cancel |
  | `setupWorking` | Setting up… |
  | `setupDone` | Your Daylight server is set up. Your other devices and your Daylight will find it on their own. |

  `setupConfirmText(link)` fills `{host}` the way `serverMovedText` does, and the Lab vectors pin it.

### 2.7 JS reference additions, then the ports

**2.7.1 `share/js/daylight-share.js`** (protocol module). These changes are wire-neutral, and `test-vectors.json`
must not change:

- `aadFor` becomes the explicit map of 2.4; an unknown purpose throws.
- `new Sender({…, onAckHeader})`: called as `onAckHeader(header, {time, msgId})` for every decrypted ack-topic frame
  whose `kind` is `ack`, inside `_checkAcks`, before rows are updated. Its exceptions are caught and logged.
- `checkItemHeader(h)` returns the header as today plus `extras` (2.3). `Reassembler.add` and `Receiver` pass
  `extras` on with the item.
- `Sender.send(item, {defer = false})` (F07): with `defer`, the row is stored as `failed` with error code `network`,
  `attempts: 0` and `lastPublish: now`. Nothing is published; the content is stored as usual.
- `Sender.flushNetwork({maxFrames = 30, maxAttachmentBytes = 18_000_000})` (F07) attempts the `failed`/`network`
  rows now, oldest first, whatever their back-off.
  - A pass stops before a row that would take it over either cap.
  - It follows `_resendDue`'s pass rules: after a `429` it publishes nothing more, and after a `413` no more
    attachments.
  - Each attempted row gets `attachment` and `lastPublish` exactly as `_attempt` sets them.
  - It returns the rows it attempted.
  - Callers space passes at least 3 minutes apart. In that time ntfy.sh's request bucket refills by 36, so a pass of
    30 never meets an empty bucket.
- `applyPairingChange` also removes every `lab/*` key when the secret differs.
- W2 (L2): `Sender` and `Receiver` take `lane` (2.4).

**2.7.2 New `share/js/daylight-lab.js`.** No dependencies but `daylight-share.js`. The extension, web and Windows
builds copy it, as they copy the protocol module. W0 exports:

```js
export const LAB_LEVEL = 1;
export const CAPS = { st: 'st', tap: 'tap', readerLink: 'reader-link', capKind: 'cap-kind', readerDoc: 'reader-doc', quiet: 'quiet' };
export const LAB_STATES = ['waiting', 'held', 'inbox', 'handed', 'failed', 'queued', 'reader'];
export const STATE_RANK = { waiting: 1, held: 2, inbox: 2, handed: 3, failed: 3, queued: 4, reader: 5 };
export const MAX_ST_PER_FRAME = 24, HELLO_EVERY_MS = 11 * 3600e3, STATE_DIGEST_WINDOW_MS = 48 * 3600e3,
             STATE_DIGEST_MAX = 48, INBOX_STALE_MS = 36 * 3600e3, PENDING_MAX = 500, APP_MAX = 60,
             LAB_FRAME_GAP_MS = 30e3, LAB_FRAMES_PER_DAY = 30, LAB_YIELD_MS = 3600e3,
             LAB_OFF_REPEAT_MS = 48 * 3600e3, GATE_DEADLINE_MS = 5e3;
export function buildInboxInfo({ lab, app, caps, poll, live }) {}      // clamps as 2.2.5
export async function buildLabFrame(keys, { inbox, states = [], from, sent, nonce }) {}   // throws if >24 or not small
export function parseLabAck(header) {}                                  // 2.2.5, exactly
export class LabLedger { constructor({ storage, now }) {} async record(header, { time }) {} async publishers() {}
  async inboxLab() {} async caps() {} async hasCap(token) {} async checkedIn() {} async state(id) {}
  async prune(ids) {} }                                                // per publisher (2.2.6)
export function labHook(ledger) {}                                     // -> onAckHeader for the Sender
export function describeLabRow(row, now, ctx) {}                       // 2.5 -> {label, sentence, action, stepLine, final}
export function checkedInText(ms, now) {}                              // 2.5
export const LAB_TEXT = { /* every string of 1.4, 1.6 and 2.5, keyed; LAB_TEXT.short holds the short states */ };
export function needsMessage(state, { app, platform, feature, short = false } = {}) {}
export async function labGate(feature, ctx) {}                         // -> {ready, state, message, short}
export async function deriveLabTopics(secret) {}                       // 2.4
export class LabInbox { constructor({ storage, relay, keys, info, from, now }) {}   // the Inbox side, for the JS
  record(id, s, t) {} async flush() {} noteRelayLimit(status) {} noteAcksFailed() {}
  async labTurnedOn() {} async labTurnedOff() {} async digest() {} }    // 2.2.4: spacing, giving way, cap
export class LabInboxSim { constructor({ receiver, labInbox, stateFor }) {} async pollOnce() {} }  // tests: a Lab Daylight
```

- `LabInbox` is the reference for Kotlin's. Tests and the Apple e2e receiver use it as the Daylight.
- `LabInboxSim.pollOnce()` runs `receiver.pollOnce()` and then records, for each new item, `stateFor(header)`. The
  default is `reader` for url and page, `handed` for file; `waiting` is available as a test option. Then it flushes.
- `labGate(feature, ctx)` checks, in order:
  1. Lab is on.
  2. Paired (`needs-pairing`).
  3. The feature's required Inbox capability (`needs-inbox`).
  4. Its permission or setting, supplied by the app as `ctx.local(feature)`.
  5. For server features, the server state: `ctx.server.state(key)` raced against `GATE_DEADLINE_MS`, where the
     deadline gives `OFFLINE`. When a later server call fails with a `ServerError`, the app calls
     `ctx.server.noteError(key, err)` (2.6).
  6. `later` when `ctx.built(feature)` is false.

W1 additions (L1):
- `normaliseShare`, `extractAppleNewsTarget`;
- `classifyShare({text, url, title, source})` (F11);
- `excerptHtml`, `excerptMarkdown`, `excerptFileName`, `textFragment`;
- `testArticle`, `redactDiagnostics`;
- the W1 strings in `LAB_TEXT`;
- `share/js/capture/`: `clean-html.js` (moved here from `extension/src/clean-html.js`), Mozilla Readability 0.6.0 and
  `sync.mjs` (6.3);
- then the CLI `share/js/bin/daylight-send.mjs` (F09).

**2.7.3 Ports.** Same names, same behaviour, same vectors:

| JS | Swift (`DaylightShareKit`) | Kotlin (`share-core`, package `com.daylight.share.core.lab`) |
|---|---|---|
| `checkItemHeader` → `extras` | `ItemHeader` `extras` | `ItemHeader.check` → `ItemHeader.extras`, carried by `Reassembler` and `Receiver` |
| `buildInboxInfo` / Info | `LabInboxInfo` | `LabInboxInfo` |
| `buildLabFrame`, `parseLabAck` | `LabFrame.build`, `LabFrame.parse` | `LabFrame.build`, `LabFrame.parse` |
| `LabLedger` | `LabLedger` (file `lab.json` next to the outbox state, coordinated like `OutboxStore`) | `LabLedger` (`lab.json` in `FileOutboxStore.dir`) |
| `describeLabRow`, `checkedInText`, `LAB_TEXT`, `needsMessage` | `LabRowText(row:now:ctx:)`, `LabText` | `LabRowText.of(row, now, ctx)`, `LabText` |
| `deriveLabTopics` | `LabTopics.derive(secret:)` | `LabTopics.derive(secret)` |
| `LabInbox` | — | `LabInbox` (pure JVM: the Daylight Share Inbox and the Lab Reader vendor the same class) |
| Sender hook | `ShareSender(…, onAckHeader:)` | `Outbox(…, onAckHeader = …)` |
| W1: `normaliseShare`, excerpt builders | `ShareNormaliser`, `Excerpt` | `Normalise`, `Excerpt` |
| server W0 subset (2.6), `noteError` included | `DaylightServer`, `ServerCode`, `ServerMessages` (folder `Server/`) | package `…core.server` |

### 2.8 Vectors and CI

**`share/vectors/lab-vectors.json`**, generated by `share/vectors/generate-lab.mjs` from the JS with fixed nonces, for
the protocol vectors' secret:

| Section | Holds |
|---|---|
| `labTopics` | The four derived topics (2.4) and one sealed return frame |
| `labFrames` | A hello, a frame with 3 states and the worst-case frame of 2.2.1 (60 lone surrogates in `from`), each with nonce, base64 frame, header JSON and its expected parse |
| `labParse` | At least 45 headers, stored as JSON text: valid; junk caps; bad ids; ids not empty with `x-st` (ignored); unknown state; out-of-range `t`; missing `x-inbox`; `lab: 0`; 70 entries (first 64 read). Then every rule of 2.2.5: `poll` on Feb 30, at T24:00, with second 60 and on Feb 29 of a leap year; `lab` as 1.0, 1e0, "1", true and 2 (above `LAB_LEVEL`); `t` as -0 and 1.5; 16 junk caps before a valid one; repeated caps after junk; emoji and combining marks in `app` (→ ""); the same `i` twice → expected `{inbox, states}` |
| `labLedger` | Sequences of (header, relay time) → the expected state per id, and `inboxLab`, `caps`, `hasCap` and `checkedIn` at a given `now`. Cases: equal rank with a later `t`; a lower rank ignored; `held` after `waiting` and a re-announced `waiting`; a hello gone stale at 36 h; two publishers (`android/…`, `reader-lab/…`) in either order and within the same relay second; a `lab: 0` from one of them; the handover order of 5.3.4; a `poll` later than its relay time (clamped) |
| `labGate` | A stubbed ctx (paired or not, caps, local check, server state, a server that never answers) → `{state, short}` |
| `labHeaderExtras` | Item headers with valid and invalid `x-cap` and `x-orig`, on part 0 and on later parts, and unknown `x-` fields → the `extras` that `checkItemHeader` returns |
| `labRowText` | (row, now, ctx) → `{label, sentence, action, stepLine, final}` for every row of 2.5 and the v1.1 fall-throughs |
| `labText` | Every string id → text, with the per-platform variants of 1.6 and the short states of 1.4 |
| `v1Safety` | The `labFrames` frames as a v1.1 ack reader sees them: no ids. Kotlin's and Swift's `VectorTests` also assert `idsOf` / `ids(in:)` = `[]` and no delivered row. |

**W1 additions:**

- `share/vectors/normalise.json`: at least 50 cases (F16). They include real "headline + link" shares that must stay
  links with the headline as the title: NYT ("Opinion | … https://nyti.ms/…"), the Guardian, Apple News, Substack,
  X, and Chrome on Android's "Title\nURL". They also include `x-orig` over 1,024 characters (left out).
- A `labExcerpt` section: selection inputs → HTML, Markdown, file name and URL (F11). It includes the `classifyShare`
  cases of F11: the four excerpt rules, and the headline + link shares above as links.
- A `diagnostics` section: a log fixture → its redacted text (F26).

**`server/vectors/server-vectors.json`** (server lane, SV0) gains `serverState`: status JSON or error JSON in,
`{state, message}` out.

**CI:**

- **`rx-share.yml`.** `node --test share/js/test/*.test.mjs` gains `lab.test.mjs`, `lab-skew.test.mjs`,
  `normalise.test.mjs` and `cli.test.mjs`. The vectors are regenerated and `git diff --exit-code` must find no
  change.
- **F17 skew suite.**
  - JS (`lab-skew.test.mjs`): {v1.0 Sender, v1.1 Sender, Lab Sender} × {v1.0 Receiver, v1.1 Receiver,
    `LabInboxSim`} × {url, page, file}. The v1.0 peer is `daylight-share.js` as of b48752b, kept as
    `share/js/test/fixtures/daylight-share-v1.0.js`. Every item is delivered. Lab states appear only when both sides
    are Lab. A v1.0 or v1.1 Sender never throws on Lab frames. `describeRow` is unchanged against a v1.1 Receiver.
    Two `LabInboxSim` publishers on one ack topic (Daylight Share and the Lab Reader) run in both handover orders.
  - Kotlin `LabSkewTest`: the Kotlin `Outbox` with `LabLedger` against the JS Receiver with and without
    `LabInboxSim`, and the Kotlin `Receiver` with `LabInbox` against the JS Sender with and without the ledger, plus
    the two-publisher case. It uses the existing node interop through the mock relay.
  - Swift `LabSkewTests`: Swift's sender against `apple/scripts/e2e-receiver.mjs`, with and without its new `--lab`
    flag.
- **Soak** (in `lab-skew.test.mjs`): 7 simulated days on the mock relay with ntfy.sh's limits. Every client sits
  behind one visitor address, as a household does. The traffic is 2.2.7's busy day: 30 items, Documents = Ask, and a
  simulated server lane delivering 60 items a day. It runs twice: with the Inbox polling every 15 minutes, and with
  Instant delivery. It asserts: no 429; at most 150 messages from the household on any day; Lab frames within their
  cap; and no ack delayed by a Lab frame. A second run adds a forced 429 and checks that Lab frames give way for an
  hour.
- **Server (SV0, `rx-server.yml`).** `pollAcks` in v1 mode with Lab frames (`ids: []`, with `x-st`, and `lab: 0`) on
  the pairing ack topic: they deliver nothing and change no row. That they count as presence in v1 mode is harmless,
  and DESIGN 5.5 is updated to say so. Wave S adds the server ack topic in Lab mode (4.2).

---

## 3. Wave 0 and Wave 1

### 3.1 What is in each wave, per platform

| Platform | Wave 0 | Wave 1 |
|---|---|---|
| iPhone, iPad | F00 (with the server section), F17, F27 (baseline with Comfort, in P0) | F01, F02 entry point, F03, F04, F07, F08, F09, F10, F16, F26, F33; F11 after 6.5 Q1 |
| Mac | F00 (with the server section), F17, F27 | F01, F02 entry point, F04, F07, F08, F09, F16, F23 (Print to Daylight), F26, F29 (menu-bar drop), F33 (the existing clipboard command); F11 (Services) after Q1 |
| Chrome, Safari | F00, F17, F27 | F01, F02 entry point (Chrome), F03, F04, F07, F10, F11 (explicit selections only), F16, F26, F33, F34 |
| Android phone | F00, F17, F27 | F01, F02 entry point, F03, F04, F07, F08, F09, F16, F26, F33; F11 after Q1 |
| Web sender | F00, F17, F27 | F01, F02 entry point, F07, F09, F16, F26, F33 |
| DC-1 Inbox | F00, F17 (hello and states), F27 | F01 (states complete), F03 and F11 (row lines), F15, F26 |
| Windows | F00, F17, F27 | F01, F02 entry point, F07, F08, F09, F16, F26, F33 (the existing clipboard command) |

iPhone and Mac land first in each wave. The DC-1 Inbox's W0 part (hello and states) runs at the same time, in its own
folder, because the iPhone's and the Mac's timelines need a Lab Inbox to show anything on a real device. Its W1 UI
work (F15 and the rest) follows the Android phone, as the user's order says. The Windows, extension and web Lab
builds are not published to the release before the iPhone and Mac W0 builds are (6.2).

**What W0 and W1 are for.** They make sending feel reliable and effortless: share in place, the honest timeline,
the offline outbox, clean links and the page as you see it. They do not yet deliver what makes a DC-1 owner say
"finally". The research ranks that list as big files, notes coming home, email-in and the morning stack
(raw/eink-tablets.md §8.2). Those come next, in this order:

- W2 starts with F06 (send back) and F13 (big files on the same Wi-Fi), iPhone, Mac and Inbox first (4.1).
- Wave S starts with S0 and F02, big files through the server (4.2).
- R2 (notes coming home) follows L2 (5.4).

Meanwhile W1 points to big files at the moment of need (the F02 entry point below). On the tablet, W1 adds no new
interruption: excerpts wait for 6.5 Q1, Keep for later replaces Later (F15), and the extra lines live in item
details. The quiet-arrival fix (R0, R1) reaches only the lab tablet; 6.5 Q8 asks whether to request its main-Reader
equivalents. (FEATURES §1 item 8 says Lab ships F06 "now". It ships in W2, and this plan wins where the two differ.
The research lane corrects that sentence.)

**F02 entry point (W1, every sender with F02).** Where a file is refused as over 9 MB, Lab adds one control under the
v1.1 too-big sentence: **Send files over 9 MB ›**. It runs `labGate('files')`, so it shows the `needs-server` note
until a server exists, and `later` once one is ready but this app does not build F02 yet (Wave S). From W2 the same
note also offers F13 ("Or send it over your Wi-Fi."). With Lab off the screen is v1.1's.

- [ ] **F02e.1** Refusing a 14 MB PDF shows the too-big sentence and, with Lab on, **Send files over 9 MB ›** under
  it. Tapping it shows the `needs-server` sentence with no server, and `later` with a ready server (stubbed). With
  Lab off, the screen equals the v1.1 baseline.

### 3.2 Wave 0

#### F00 Lab switch, What's in Lab, needs-setup notes, Daylight server section

**Common.** Section 1 and 2.6. Every app gets one Lab settings block, a What's in Lab list with short states and the
server group (1.4), a `LabNote` component and the server section (the Inbox gets the server-lane version in Wave S).
W0 builds set `LAB_NOTE_ENABLED = false` (1.2).

| Platform | UI and behaviour | Edge cases |
|---|---|---|
| iPhone, iPad | In `DaylightShareUI`: `LabSettingsSection` (switch, footer, rows), `WhatsInLabView` (a `List`), `ServerSettingsView`, the `LabNote` view modifier and `LabGate` (async). The one-time note (from W1) is a banner at the top of `HomeView`. The share extension reads `SharedStore.lab`; with Lab off it is exactly v1.1. On iPad the settings sheet works at every split width. | Storage still resolving: treat Lab as on and re-render on `.daylightShareChanged`. Not paired: the server section shows `needs-pairing`. |
| Mac | The same components in `MacSettingsView`; the one-time note (from W1) in the main window. | Ad-hoc builds: the Share menu item's pairing card gets its own Lab switch (1.1), and What's in Lab ends with the ad-hoc line (1.4). |
| Android phone | `Prefs.lab` with a `StateFlow`; a `LabCard` at the top of `SettingsScreen`; `ui/LabScreen.kt` (What's in Lab and the server section); a `LabNote` composable; the one-time note as a card on `SenderScreen`. `ShareActivity` reads `Prefs.lab`. | Role switch: the Lab flag is shared by both roles. |
| DC-1 Inbox | The same card in the Inbox role, and the note on `InboxScreen`. What's in Lab lists the Inbox's features. The server row shows `needs-server` until Wave S. | Lab off sends the `lab: 0` hello (F17). |
| Chrome, Safari | The popup's settings row; `src/lab.html` with `src/lab-page.js` (What's in Lab and the server section); `src/lab-ui.js` (`labNote(el, msg)`, `aria-live`). Server calls run in the service worker (DESIGN 13.2). | The host permission for the Worker is requested at the first server tap; a refusal gives `needs-site-access`. |
| Web | A settings row, a What's in Lab dialog and a server panel; `web/web-lab.js`. `build.mjs` copies `daylight-lab.js`, `daylight-server.js` and the extension's `lab-ui.js`. | The shared github.io origin warning stays (README). |
| Windows | A settings row and panels in `src/app.js`; `src/lab.js`. The build copies `daylight-lab.js` and `daylight-server.js`. Tauri's CSP `connect-src` gains `https://*.workers.dev` and the relay. | — |

**Acceptance (all apps):**

- [ ] **F00.1** On a fresh install, Lab is on. The one-time note shows once, and only in builds whose app has F01 or
  F04; a W0 build shows none. An upgrade from the last non-Lab build does the same, keeping the pairing and history.
- [ ] **F00.2** With Lab off, each main screen's accessibility tree equals the non-Lab baseline (1.7).
- [ ] **F00.3** Each Lab feature's row in What's in Lab shows its short state. Tapping the feature in a needs-setup
  state shows exactly its sentence under the control. The control is not greyed out, and a screen reader announces
  the sentence.
- [ ] **F00.4** Queue an item offline, turn Lab off, go back online: the item is sent. History, pairing and server pin
  are all still there.
- [ ] **F00.5** For the vector pairing, the Server code shown equals `server-vectors.json` › `derived`, and Copy puts
  it on the clipboard (every sender).
- [ ] **F00.6** With no server deployed, "Summaries with Claude" shows the `needs-server` sentence within 5 s
  (online), or the `OFFLINE` sentence (offline). With a relay that never answers, it shows `OFFLINE` at 5 s.
- [ ] **F00.7** A fresh install with nothing set up shows no setup instructions until something is tapped. No screen
  reachable without tapping a Lab feature or opening the Daylight server section contains a secret name or a
  needs-setup sentence (UI test over each screen's text).

**Automated:**

| Platform | Tests |
|---|---|
| Apple | `swift test`: `LabTextVectorTests`, `ServerVectorTests`; XCUITest `LabOffParityTests` (iPhone and Mac), `LabNoteTests` (stubbed gate states), `LabFirstRunTests` (F00.1, F00.7) |
| Android | Robolectric `LabOffParityTest` (semantics trees, both roles), `LabNoteTest`, `PrefsLabTest` (missing key → on; the note only with `LAB_NOTE_ENABLED`, once), `LabFirstRunTest` |
| Extension, web | `test/unit/lab.test.mjs`; Playwright `test/e2e/lab.e2e.mjs`: popup and `lab.html` with Lab on and off, parity snapshots (`ariaSnapshot`), notes for stubbed states, the first-run text check |
| Windows | `test/unit/lab.test.mjs`; `windows.e2e.mjs` gains a Lab-off status snapshot |

#### F17 Capability hello and version-skew safety

**Senders (every app).**

- Wire `LabLedger` through `onAckHeader` (2.2.6) and persist it.
- What's in Lab's header shows the Inbox's Lab state.
- Features that depend on the Inbox gate on capabilities. In W1 that is only the timeline: `st` decides whether
  "On your Daylight ✓" or "Delivered ✓" shows. No W0 or W1 control gates on a Reader capability. A row's Reader step
  is not interactive, and a document's `handed` sentence says on its own that the Reader does not confirm documents
  yet (2.5).

**DC-1 Inbox (W0, needed by every sender's W1).**

- `inbox/LabReporter.kt` wires share-core's `LabInbox` into `InboxRepo`, `Handoff` and `HandoffActivity`. Its store is
  `files/inbox/lab-<inboxTopic>.json`.
- It records, for items received on the pairing's inbox topic only (2.2.4):
  - `waiting` when `Handoff.notifyWaiting` (or the card) first announces an item, and never again for that id;
  - the final state of every hand-off in `HandoffActivity.done` and in each kept-in-Inbox path, mapped as in 2.2.3;
  - nothing for `mark(…, "started")`.
- It flushes after `pollOnce` and `handleLive` (after acks) and in `HandoffActivity`'s `finally`, under 2.2.4's
  spacing, giving-way and cap rules. `pollOnce` and the live path report a failed ack publish
  (`noteAcksFailed`), and any `429` or `413` (`noteRelayLimit`, from `Receiver.Result.limited` and the publish
  answers).
- Hello caps: `st`, `tap`; `reader-link` when the link target takes `SAVE_PAGE`; `cap-kind` from W1.
- It logs, under the `DaylightShare` tag: `lab: hello caps=<…>`, `lab: states n=<k> published`, and
  `lab: state <id> <s>`.
- **Edge cases.**
  - Reset pairing clears the `LabInbox` store.
  - A version change or a change of the chosen Reader target changes `caps`, which sends a hello.
  - Instant delivery's live path flushes after `publishAcks`.
  - A flush failure never blocks a hand-off.

**Acceptance:**

- [ ] **F17.1** Every pair in the skew matrix delivers url, page and file items and gets acks. Lab-only states appear
  only when both sides are Lab (CI).
- [ ] **F17.2** A sender that has never seen a hello shows "Delivered ✓" rows and the `needs-inbox` header line in
  What's in Lab.
- [ ] **F17.3** Hello frames are small messages: at most 3 a day while idle, plus one per Lab toggle (unit test with a
  fake clock; soak).
- [ ] **F17.4** On a real DC-1: turning Lab on in Daylight Share makes an iPhone with the app open show
  "Your Daylight: Lab on" within one ack check.
- [ ] **F17.5** The household soak (2.8) passes in both polling and Instant modes: no 429 and at most 150 messages a
  day. Lab frames stay within 30 a day, at least 30 s apart, and publish nothing for an hour after a 429 or 413.

**Automated:** the vectors and the skew suite (2.8).

- Android: share-core `LabInboxTest`. It covers record with the merge rule, flush in 24s, 30 s spacing, giving way
  after a 429 or 413 and after failed acks, the daily cap, halving a refused batch, hello cadence, the `lab: 0` frame
  and its 48-hour repeats, the pending cap and the digest.
- Robolectric `LabReporterTest`: 2.2.3's mapping for every hand-off path, an unknown status → `handed`, a held item
  that is re-announced stays `held`, and an item tagged `lane = "server"` records nothing.
- e2e (`rx-e2e.yml`): `inbox-e2e.sh` reads Lab frames with `e2e/sender.mjs` and asserts `reader` for the page and
  `handed` for the PDF.

#### F27 Accessibility baseline, with Comfort (not a Lab feature since revision 2)

**Baseline (not Lab, every build).** It lands in each app's P0 close-out, before the Lab-off baselines are recorded
(0.2, 1.7).

- Every control has a label.
- Status labels wrap instead of truncating at 200% text (Dynamic Type, Android font scale, browser zoom).
- Status changes are announced: "Delivered", "In your Reader".
- Typed-code pairing is always available.
- States are shown in words and glyphs, never colour alone.
- **Comfort**, a switch in every build's settings, outside Lab and off by default. Footer: "Larger text and buttons,
  more contrast, no motion." It works the same with Lab on or off, so someone who turns Lab off keeps it.
- Nothing sends on a timer for someone who needs more time. When Comfort, VoiceOver, Switch Control, TalkBack or
  Switch Access is on, a Lab countdown (F04) is replaced by an explicit **Send** (WCAG 2.2.1).

**Comfort.**

| Platform | Comfort mode |
|---|---|
| Apple | `.dynamicTypeSize(.xxLarge ... .accessibility3)`; minimum hit target 52 pt; primary-on-background text with 2 pt control borders; animations off (`.transaction { $0.animation = nil }`) |
| Android | Font scale ×1.3 via `LocalDensity`; `minimumInteractiveComponentSize` 56 dp; no `AnimatedVisibility` or crossfades |
| JS apps | The `comfort` class on `<body>`: `font-size: 125%`, buttons at least 48 px high, 2 px borders, `*{transition:none;animation:none}` |

The DC-1 Inbox's Lab screens never animate, comfort or not (F15).

**Acceptance:**

- [ ] **F27.1** axe-core reports no violations on the popup, `lab.html` and the web sender, with Lab on and off (CI).
- [ ] **F27.2** XCUITest `performAccessibilityAudit()` passes on the iPhone's Home and Settings and the Mac's main
  window and Settings (iOS 17+ and macOS 14+ runners). Compose `enableAccessibilityChecks()` passes in the Robolectric
  screen tests.
- [ ] **F27.3** A VoiceOver run and a TalkBack run of pair → send → delivered, recorded for each release, announce
  each state change.
- [ ] **F27.4** With Comfort on, at the narrowest supported width (iPad one-third split, 360 dp phone, 360 px popup)
  and the largest text size, no text is truncated or clipped:
  - Apple: an XCTest hosts each screen at that width with `.accessibility3` and compares every text element's fitting
    size with its laid-out frame (`TruncationAudit`).
  - Android: no text node's `TextLayoutResult` has `hasVisualOverflow`.
  - JS apps: Playwright checks `scrollWidth ≤ clientWidth` and `scrollHeight ≤ clientHeight + 1` for every element
    with text.

  Screenshots are uploaded for review.
- [ ] **F27.5** With Comfort on, or a screen reader or switch access reported on (stubbed in unit tests), every Lab
  countdown is replaced by an explicit Send (F04.5).
- [ ] **F27.6** Turning Lab off leaves Comfort as it was.

**Automated:** `@axe-core/playwright` (pinned) in `extension/test/e2e/a11y.e2e.mjs`, also run against the Windows
`dist/index.html` with a fake bridge; the XCUITest audits; Compose accessibility checks; the truncation checks of
F27.4.

### 3.3 Wave 1: features

#### F01 Honest delivery timeline

**Common.** `describeLabRow`, the step line, what a row shows, and the check-in header (2.5); `LabLedger` (2.2.6);
failure sentences and buttons exactly as v1.1 (**Retry now** / **Try again** only where they help); faster checks
while an item is in flight (2.5).

| Platform | UI | Behaviour, edge cases |
|---|---|---|
| iPhone, iPad, Mac | A `TimelineRow` in `DaylightShareUI`: title and label; the sentence and step line (caption style) on the newest row and rows that are not final; everything in the row's details on tap. The check-in header sits above History. | Background app refresh runs `tick()`, so the ledger updates; rows refresh on `.daylightShareChanged`. |
| Android phone | `SenderScreen` rows from `LabRowText.of` and the header. | WorkManager's periodic job feeds the ledger. |
| Chrome, Safari | Popup rows and the header. Toolbar badge: `…` sending, `✓` delivered, `!` error, and a new `⌛` for an item waiting for a tap (`waiting` or `held`). | The badge shows the state of the most recent row. |
| Web | Rows and header. | Only while the page is open. |
| Windows | Window rows (`logic.js` `rowView` → `describeLabRow`) and the header; a toast "In your Reader: {title}" for `reader` states while the window is hidden. | — |
| DC-1 Inbox | Records and publishes states (F17). The item's detail screen gains the line "Sender sees: {label}" (the same text as the sender). The list rows do not. | — |

**Acceptance:**

- [ ] **F01.1** A link sent with Lab on both sides shows "In your Reader ✓" on the sender within 45 s of
  "On your Daylight ✓", with the Inbox open (CI e2e). On Rooted 2, once per sender family, under real conditions:
  - the Inbox in front;
  - the Inbox in the background with the Reader in front, "Display over other apps" on;
  - the same with it off: the row shows "Waiting for a tap on your Daylight" until the notice is tapped, then
    "In your Reader ✓";
  - the screen off, with Instant delivery on.
- [ ] **F01.2** With the Inbox's Documents set to Ask, a PDF shows "Waiting for a tap on your Daylight". After the
  notice is tapped, the sender shows "Handed to the Reader" and "The Reader doesn’t confirm documents yet." at its
  next ack check ("In your Reader ✓" when the Lab Reader receives, R1).
- [ ] **F01.3** The header shows "Your Daylight checked in N min ago". With the Daylight off, sends still go out.
- [ ] **F01.4** Every failed row has one sentence naming the cause, and v1.1's button where it helps: **Retry now**
  after a network failure, **Try again** where trying again can help, none for too big or refused. No row says
  Delivered or In your Reader without an ack listing its id (unit test over the outbox state machine and the
  ledger).
- [ ] **F01.5** Against a v1.0 or v1.1 Inbox, rows read Sent / Delivered ✓ exactly as today (skew suite).
- [ ] **F01.6** VoiceOver and TalkBack read "{label}. {sentence}" for each row, with no step count. The step line
  shows only on the newest row and on rows that are not final (UI test with three rows: `reader`, `waiting`, and
  the newest, `sent`).

**Automated:** the `labRowText` vectors in JS, Swift and Kotlin. The extension e2e uses `LabInboxSim` for
`reader`, `waiting` → `handed`, and a v1.1 Receiver. Apple: `EndToEndTests` with `e2e-receiver.mjs --lab`. Android:
Robolectric `SenderTimelineTest`. Windows e2e: the status file shows `In your Reader ✓`. `rx-e2e`: the states
published by the real Inbox.

#### F03 Send the page as you see it, and say when only a link came through

**Common.**

- **`share/js/capture/clean-html.js`**, the single source (moved from `extension/src/clean-html.js` by L1; consumers
  copy it with `sync.mjs`, 6.3), is run on `document.documentElement.cloneNode(true)`, never on the live page. It:
  - removes every `<script>` whose `type`, trimmed and lowercased, is not `application/ld+json`;
  - removes every attribute whose name starts with `on`, in any case;
  - removes `srcdoc` from iframes;
  - removes the `href` of links starting with `javascript:`;
  - removes `<input type=hidden>` and `<input type=password>`, clears other inputs' `value`, empties `<textarea>`,
    and drops `selected` from options;
  - removes `<meta>` elements whose `name` or `property` contains `csrf` or `token`.

  It returns `'<!doctype html>\n' + clone.outerHTML`.
- Captured pages carry `x-cap: "seen"`.
- The Reader runs its own article extraction on `SAVE_PAGE` HTML (`ReadLaterSaver.saveNow` → `ports.extract`), so the
  page stays the default.

| Platform | UI and behaviour | Edge cases |
|---|---|---|
| Chrome, Safari | `inject.js` calls `cleanHtml` before returning the capture, with Lab on. | Pages over 8 MiB after cleaning still go as links (unchanged). PDF tabs are not affected. |
| iPhone, iPad | **`GetPage.js` cannot read the Lab flag.** It is the share extension's JavaScript preprocessing file, so it runs in the page before any extension code and receives nothing from it. It therefore returns `html` exactly as v1.1 does, plus a `lab` object: `cleanHtml`, and the F10 extras (F10). Its copy of `clean-html.js` sits between the markers `// BEGIN clean-html` and `// END clean-html`. The native side chooses: with `dls.lab` on it sends `cleanHtml` with `x-cap: "seen"`; with Lab off it sends `html`, byte for byte as v1.1. **Size:** `cleanHtml` is made only when `html` is at most 8 MiB, and Readability runs only when `html` is at most 2 MiB (F04.2 measures memory with an 8 MiB page). **Link-only hint:** when a share from another app carries only a URL, the share card shows, **once on this device**: "Only the link came through. If this needs your login, open it in Safari and share from there." After that, the line lives in Setup check (F26). | iOS share extensions cannot open other apps, so the history row for that item gets an **Open in Safari** action in the app instead. |
| Android phone | Chrome shares only the title and URL, so a once-per-site hint would fire for nearly every new site. The card shows it **once on this device**: "Only the link came through. For pages behind a login, send from your computer’s browser with the Send to Daylight extension." After that, the line lives in Setup check. | — |
| DC-1 Inbox | Each row gets one line under its title, from the item's `extras` (2.3): "Page as you saw it" (`page` with `x-cap` `seen` or none), "Clean article", "Excerpt", "Test article", "Link (the Reader downloads it)" (`url`), or "Document · {MB} MB". Then " · from {from}". | An unknown `x-cap` is shown as if it were absent. |

**Acceptance:**

- [ ] **F03.1 (Chrome)** A Playwright fixture page that shows text only with a login cookie arrives with that text in
  the received HTML.
- [ ] **F03.2 (Chrome, Safari, iPhone)** The sent HTML has no `<script>` except JSON-LD, no `on*` attribute and no
  form value. Unit test: a fixture with a token in a hidden input, `onclick`, a password field and textarea text.
- [ ] **F03.3 (iPhone, Android)** The first share of a bare URL from another app (Notes on iPhone, Chrome on Android)
  shows the "Only the link came through" line. Later ones do not, and Setup check lists it. Sharing a page from
  Safari never shows it.
- [ ] **F03.4 (Inbox)** Every row states its kind line, and TalkBack reads it.
- [ ] **F03.5 (iPhone, Mac)** With Lab off, a Safari share sends `GetPage.js`'s `html` byte for byte as v1.1 (XCTest
  with a fixture page in a `WKWebView` host).

**Automated:**

- `share/js/test/clean-html.test.mjs` (moved from the extension with the file), plus `sync.mjs --check` on every
  copy: the extension's build copy in `rx-extension.yml`, and `GetPage.js` between the markers in `rx-apple.yml`;
- e2e F03.1;
- Robolectric `InboxRowLineTest`.

#### F04 Share in place: done in a second, never opens the app

**Common.**

- Tapping Daylight shows a card "Sending to {name}" on every platform (`{name}` = the pairing's `n`, else "your
  Daylight"), with an **Options** button for 1.5 s.
- Doing nothing sends with the last-used choices. Tapping Options stops the countdown, shows the choices and a
  **Send** button.
- **No timer for people who need more time.** In these cases the card opens with the choices and **Send**, and
  nothing goes until Send is tapped (WCAG 2.2.1):
  - Comfort is on;
  - VoiceOver or Switch Control (iPhone, Mac) is on;
  - TalkBack or Switch Access (Android: `AccessibilityManager.isTouchExplorationEnabled`, or Switch Access among
    `getEnabledAccessibilityServiceList`) is on;
  - the Lab setting **Always show Options before sending** (off by default) is on.
- The publish starts when the countdown ends or Send is tapped. The card closes within 2.5 s of the tap.
- The OS and the outbox finish the upload.
- **When it fails after the card has closed.** iPhone, Mac and Android post a local notification when a
  share-in-place item ends `failed` or `expired`. A `network` failure is the exception: it waits for a connection
  instead (F07).
  - Title: "Couldn’t send ‘{title}’ to {name}". Text: "Open to try again." Tapping it opens the app at the row.
  - Lab setting **Tell me when a send fails**: on by default.
  - Optional Lab setting **Tell me when it’s in my Reader**: off by default. When on, a quiet "In your Reader ✓:
    {title}" is posted when the ledger confirms `reader` while the app runs or refreshes in the background.
  - Without notification permission nothing is posted, and F04's row in What's in Lab shows `needs-notifications`.
    iPhone and Mac ask for the permission in the app, the first time it opens after a share in place, and never from
    the extension. Windows keeps its toasts.
- **Options in W1:** Send as (F10, where available), Review (F10), and "Send the link instead". Nothing from W2.

| Platform | UI and behaviour | Edge cases |
|---|---|---|
| iPhone, iPad, Mac (with an App Group) | New `BackgroundPublisher` in the kit, for the share extension's first attempt. Each part's header carries `size`, `sha256` and `parts`, and for text types (`enc: deflate-raw`) the part count depends on the compressed length, so it works in two passes:<br>1. **Measure.** Stream the source with `FileHandle` in `CHUNK`-sized pieces. For text types, stream it through the deflater into a temp file `bg/<id>.src` in the App Group. Hash with CryptoKit's incremental `SHA256`. This gives `size`, `sha256` and `parts`.<br>2. **Seal.** Read the (deflated) source again chunk by chunk, and seal each chunk into `bg/<id>-<part>.body` (base64 text for small frames, raw for large). Never hold the whole file. Delete `bg/<id>.src`.<br>3. Save the row `sending` with `bgAttempt` (UUID) and `bgParts`.<br>4. Start one `uploadTask(with:fromFile:)` per frame on `URLSessionConfiguration.background("com.daylight.share.bg")` with `sharedContainerIdentifier` = the App Group, `isDiscretionary = false`, `sessionSendsLaunchEvents = true` and `timeoutIntervalForResource` = 24 h. `taskDescription` = `"<id>:<part>:<attempt>"`; headers as PROTOCOL 3.1.<br>5. Close.<br>The app handles completions in `application(_:handleEventsForBackgroundURLSession:)` (iOS), or at launch and while it runs (Mac). All parts 2xx → `sent`. Otherwise it classifies the answer as PROTOCOL 3.1 says → `failed` / `expired`, as v1.1's `attempt()` does, cancels the attempt's other tasks and posts the failure notification. Then it deletes the body files.<br>**Re-send timing.** ntfy.sh dates an attachment from its upload, and background parts can finish hours apart. So the row counts as an attachment row, and its `lastPublish` is the first part's completion. If the last part completes more than 170 minutes after the first, part 0 may already have expired, and the row is due for a re-send at once (in the app, as today). | Frames of one attempt go concurrently. Receivers are order-independent (PROTOCOL 2.3), and a failure cancels the rest, which stands in for "later frames are not published". A `sending` row with live tasks for its `bgAttempt` is not stale (checked with `getAllTasks` once per tick). With no tasks after 15 min, the v1.1 staleness rule applies. Re-sends run in the app as today. Peak memory for a 9 MB PDF or an 8 MiB page stays under 60 MB. **Ad-hoc Mac builds** (no App Group) publish in the extension as today. The card stays until "Sent", a failure shows on the card, the item is not in the app's history, and the extension follows its own Lab switch (1.1). |
| Android phone | `ShareActivity` is translucent. The card reads "Sending to {name}" with an **Options** chip for 1.5 s (no timer in the cases above). The content is copied into the outbox while the grant lives. Then an expedited `OneTimeWorkRequest` `send-<id>` (`sender/SendWorker.kt`; `setExpedited(RUN_AS_NON_EXPEDITED_WORK_REQUEST)`, `CONNECTED`) is enqueued, and the activity finishes within 1 s of the countdown's end. The worker posts the failure notification in a new channel, "Send results" (`IMPORTANCE_DEFAULT`). Options holds an editable title, and, for text with a link and after 6.5 Q1, "Send as excerpt" / "Send link". | Inbox role: unchanged message. Process death during the countdown: nothing is queued, and the next share works (no half rows). |
| Chrome, Safari | New setting "Send when I click the toolbar button" (Lab, off by default). When on, the popup opens with the countdown card, or with Send and no countdown in the cases above. The service worker owns the timer (`scheduleSend(tabId, mode, 1500)`), so closing the popup still sends. Options cancels it. | Pages the extension cannot read: the card says the link will be sent. |

**Acceptance:**

- [ ] **F04.1 (iPhone)** From Safari, Notes and Files, on iOS 16, 17, 18 and 26 simulators: the share sheet is gone
  no later than 2.5 s after the tap on Daylight. A swipe sent to the host app at that moment changes its first frame
  within 500 ms. XCUITest records three timestamps: the tap, the sheet's disappearance and the host's first changed
  frame. The extension's `debug-status` logs its open and close times.
- [ ] **F04.2 (iPhone)** A 9 MB PDF shared from Files, and an 8 MiB page shared from Safari, each keep the extension
  under 60 MB peak (Instruments, on a device). The PDF reaches "Sent" after the extension has closed, with the app
  not running.
- [ ] **F04.3 (Mac)** On the released ad-hoc build, Share › Daylight from Safari, Finder and Preview:
  - closes as soon as the item is "Sent", within 2.5 s for a link on a home connection;
  - shows a failure on its card;
  - follows its own Lab switch.

  On a team-signed build (6.5 Q6), the same as F04.1, from Safari, Finder and Preview.
- [ ] **F04.4 (Android)** The share activity finishes within 1 s of the countdown. The upload completes after the app
  is swiped away.
- [ ] **F04.5 (all)** Options stops the countdown and shows the choices. Doing nothing sends with the last-used
  choices. With Comfort, a screen reader, switch access or "Always show Options before sending" on, the card shows
  the choices and Send, and sends nothing until Send (unit tests with the flags stubbed; one VoiceOver and one
  TalkBack run per release).
- [ ] **F04.6 (iPhone, Mac, Android)** The mock relay answers 413 to a share-in-place item after the extension or
  activity has closed. A notification "Couldn’t send ‘{title}’ to {name}" appears within one background completion:
  the `handleEventsForBackgroundURLSession` wake on iPhone, the running app on Mac, the worker's end on Android. With
  "Tell me when a send fails" off, none appears.

**Automated:**

- Swift `FrameFileBuilderTests`: frames from a file, built in two passes, equal `buildItemFrames` for the same
  nonces, for a binary file and for a text file that deflates. The resident memory delta for a 9 MB file is under
  40 MB.
- Swift `BackgroundCompletionTests`: a fake delegate drives 2xx, 413, 429 and a network error into the v1.1 row
  states, and stale attempt ids are ignored. Parts that finish more than 3 h apart make the row due for a re-send at
  once. A failure posts the notification through a fake notification center.
- XCUITest share-extension timing (F04.1).
- Robolectric `ShareActivityTimingTest` (fake clock; the accessibility flags) and `SendWorkerTest` (a 413 posts the
  notification).
- Extension unit test for `scheduleSend` and cancel.

#### F07 Offline-first outbox

**Common.**

- **Connectivity.** iPhone and Mac: `NWPathMonitor`. Android: `ConnectivityManager.NetworkCallback`. JS:
  `navigator.onLine` and the `online` / `offline` events.
- **Sharing while offline** uses `send(item, {defer: true})` (2.7.1). The row reads "Waiting for connection" (2.5).
- **Coming back online** calls `flushNetwork()` (2.7.1). Rows go oldest first, at most 30 frames and 18 MB of
  attachments a pass. After a 429 nothing more is published, and after a 413 no more attachments. The next pass
  comes at least 3 minutes later.
- **The queue view.** History gains a section "Waiting to send ({n})", with **Cancel** (= Remove) on each row.

| Platform | Background |
|---|---|
| iPhone, iPad | First attempts ride background `URLSession`s (F04), which wait for connectivity by themselves; `BGAppRefreshTask` and app launch call `flushNetwork`. |
| Mac | Path monitor while the app runs. |
| Android phone | With offline rows, a unique `OneTimeWorkRequest` `flush` with `CONNECTED`. |
| Chrome, Safari | The alarm `dls-offline` (`periodInMinutes: 1`) exists while any row waits for connection, and is cleared when none does. |
| Web | The `online` event; Background Sync `dls-flush` where `registration.sync` exists (Chromium). Otherwise rows go on the next open. |
| Windows | `online` in WebView2. |

**Acceptance:**

- [ ] **F07.1** In flight mode, sharing from each app shows "Waiting for connection", not "Not delivered". With the
  network back, the item goes within a minute while the app runs, and on iPhone and Android also with the app closed,
  within the OS's background window.
- [ ] **F07.2** The queue shows waiting items with Cancel and a count.
- [ ] **F07.3** Against the mock relay with ntfy.sh's limits:
  - 70 links queued offline go out in order with no 429, in three passes;
  - 10 queued 9 MB files never put more than 18 MB in one pass, or more than 20 MB on the relay at once;
  - a 413 sends the remaining files into v1.1's 3-hour wait, with its sentence.

**Automated:** JS `flushNetwork` and `defer` tests, the two F07.3 cases among them; the extension e2e
(`context.setOffline`); Swift `OfflineQueueTests` (an injected path monitor); Robolectric `OfflineFlushTest`; Windows
unit test.

#### F08 Your Daylight in the share sheet's top row

| Platform | UI and behaviour | Edge cases |
|---|---|---|
| Android phone | `sender/Shortcuts.kt`: `ShortcutManagerCompat.pushDynamicShortcut` with id `daylight`, short label = the Daylight's name (≤ 10 characters, cut with "…"), long label = the name, `setLongLived(true)`, category `com.daylight.share.category.SEND_TO_DAYLIGHT`. `res/xml/shortcuts.xml` declares a `<share-target>` for `ShareActivity` with `text/plain`, `application/pdf`, `application/epub+zip` and `*/*`, and the manifest links it from the launcher activity. Pushed on every send, updated when the name changes, removed on unpair and when Lab turns off. A share arriving with `EXTRA_SHORTCUT_ID` sends directly. | The id is stable, so it survives updates. Not shown in the Inbox role. |
| iPhone, iPad, Mac, Windows | The share entry keeps the label "Daylight". The F04 card and the notifications name the paired Daylight. Windows toast: "Sent to {name}". | — |

**Acceptance:**

- [ ] **F08.1 (Android 13 and 14)** After one send, sharing a link from Chrome shows the Daylight's name in the Direct
  Share row. Tapping it sends with no other screen, and the item appears in history.
- [ ] **F08.2** Unpair removes the shortcut, and the shortcut id survives an app update
  (`adb shell cmd shortcut get-shortcuts --user 0 com.daylight.share`).

**Automated:** Robolectric `ShortcutsTest` (push, update, remove; Lab off removes); emulator e2e step in `rx-e2e`.

#### F09 Automation: Shortcuts, Siri, URL scheme, Android intent, command line

**Common.**

- **URL scheme** `daylightshare://send?url=<u>&title=<t>[&text=<s>][&quick=1]`, in every native app.
  - It opens a confirmation sheet. Title "Send to {name}?", then the title and host, with **Send** and **Cancel**.
  - `quick=1` skips the sheet only when the Lab setting "Allow quick sends from other apps" is on (off by default;
    footer: "Lets Shortcuts, scripts and other apps send without asking. Any app or web page could then send to your
    Daylight."). Quick sends are limited to 10 a minute; past that, the sheet shows.
  - `text=` goes through `normaliseShare`. The scheme never takes a file path.
  - With Lab off: "Turn on Lab in {app} to use this."
- **CLI** `share/js/bin/daylight-send.mjs` (Node 22, one file, no dependencies once built):
  `daylight-send <url|file> [--title T] [--json] [--wait[=secs]] [--wait-for reader|delivered] [--pairing <link|code>]`.
  - The pairing comes from `--pairing`, else the environment variable `DAYLIGHT_PAIRING`, else
    `~/.config/daylight-send/pairing`. The outbox is `~/.config/daylight-send/` (a file storage adapter).
  - `--json` prints `{"id","status","label"}`.
  - Exit codes: 0 sent (or delivered, or in the Reader, with `--wait` / `--wait-for`); 2 timed out; 3 refused or too
    big (with the v1.1 sentence on stderr); 1 anything else.
  - `daylight-send status <id> [--json]` prints the row and its Lab state.
  - **Two runs at once.** The JS storage lock works only inside one process. So the file storage adapter takes an
    exclusive lock file (`O_EXCL` on `~/.config/daylight-send/lock`, stale after 60 s) and writes every key by
    atomic rename. Two runs at once, from a script or with `--wait`, lose no rows.
  - **Re-sends need a run.** Every run, `status` included, first does `tick()` (acks, re-sends). `daylight-send tick`
    does only that. Re-sends happen only when the CLI runs; SEND-API.md says so and shows a cron line.
  - It is published to the release as `daylight-send.mjs`, and documented in `share/SEND-API.md`, the one list of every
    entry point.

| Platform | UI and behaviour |
|---|---|
| iPhone, iPad, Mac | App Intents in the app target: `SendLinkIntent(url, title?)`, `SendTextIntent(text)`, `SendFileIntent(file: IntentFile)`, `SendCopiedLinkIntent`, `GetDeliveryStatusIntent(delivery)` and `GetLastDeliveryIntent`. Each send returns a `DeliveryEntity {id, status, label}` (`label` from `describeLabRow`) and the spoken answer "Sent to {name}." `openAppWhenRun = false`. `AppShortcutsProvider` phrases: "Send copied link with \(.applicationName)" (`SendCopiedLinkIntent`; iOS asks to allow pasting the first time) and "Check my Daylight with \(.applicationName)" (`GetLastDeliveryIntent`, which answers with the newest row's title and label). The docs show Action button and Back Tap setups. |
| Android phone | `sender/AutomationActivity.kt`, exported and translucent, for action `com.daylight.share.action.SEND_URL` (`EXTRA_TEXT`, `EXTRA_TITLE`, boolean `com.daylight.share.extra.QUICK`), behind the same setting. It answers `startActivityForResult` with `RESULT_OK` and the extras `id` and `status`. `daylightshare://send` is routed from `MainActivity` to it. |
| Windows | `daylightshare://send` in `args.rs`, then the confirmation in the window, unless quick. |
| Web | `?url=&autosend=1` and the fragment forms stay. Settings gains a bookmarklet generator: `javascript:location.href='<page>#autosend=1&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)` (the pairing stays in that browser). |

**Edge cases.**

- An empty or unreadable file fails with a sentence and is never sent as 0 bytes.
- A file over 9 MB gives the v1.1 too-big sentence.
- An intent run while not paired gives `needs-pairing`.
- An intent run with Lab off gives the Lab-off sentence.

**Acceptance:**

- [ ] **F09.1** A Shortcut "Send link to Daylight" returns an entity with an id and status "sent". "Get delivery
  status" returns "delivered" after the Daylight acks, and its label once in the Reader.
- [ ] **F09.2** On the lab iPhone (iOS 18 or later), with `https://example.com/story` copied, saying "Send copied
  link with Send to Daylight" (and allowing Paste the first time) makes Siri answer "Sent to {name}.". Within 10 s
  the history gains a row for example.com reading "Sent · waiting for your Daylight". Then "Check my Daylight with
  Send to Daylight" answers with that row's title and current label.
- [ ] **F09.3** The URL scheme shows the confirmation sheet unless both `quick=1` and the setting are on. A test web
  page cannot send silently.
- [ ] **F09.4** `daylight-send https://example.com --json` prints `{"id":…,"status":"sent",…}` and exits 0. With
  `--wait` it exits 0 when delivered and 2 on timeout.
- [ ] **F09.5** An empty or unreadable file passed to Send File fails with a sentence and is never sent as 0 bytes.

**Automated:** `share/js/test/cli.test.mjs` (mock relay, exit codes); Swift `IntentTests` (intents called directly with
a fake relay); Robolectric `AutomationActivityTest`; Windows `args.rs` tests for `send`; the extension's web e2e for
the bookmarklet.

#### F10 Send as: page, clean article, link or selection, with a thin-content check

**Common.**

- **Modes:** Page as you see it (default), Clean article, Link only, Selection.
- **Default by context:** a selection, then a PDF tab (the file), then the mode remembered for the site
  (`lab/sendAs/<host>`, the 500 most recent hosts), then Page.
- **Clean article** runs Mozilla Readability 0.6.0 (Apache-2.0, vendored once as
  `share/js/capture/Readability.js` and copied by each consumer, 6.3) on a clone. The result is wrapped as
  `<!doctype html><html><head><meta charset="utf-8"><title>{title}</title><base href="{url}"><meta name="dl:capture" content="clean"></head><body><article><h1>{title}</h1><p>{byline} · {site}</p>{content}</article></body></html>`
  and sent as `page` with `x-cap: "clean"`.
- **Thin check:** an extraction under 150 words shows "This page looks thin ({n} words). Send the full page
  instead?" with **Send full page** and **Send anyway**. 150 is the Reader's `PaywallHint.BROWSER_RETRY_WORDS`: below
  it the Reader re-fetches the URL itself, and under 40 words it keeps only a link document.
- **Review** (Lab setting "Review before sending", off by default): a preview with JavaScript off and a CSS
  `filter: grayscale(1)`, the word count, the estimated size (`formatMB` of the deflated size) and an editable title.
  **Send** and **Cancel**.

| Platform | UI |
|---|---|
| Chrome, Safari | One line in the popup, "Send as: Page ▾", a menu with the four modes. It switches to Selection by itself when text is selected. Review opens `src/review.html`. |
| iPhone, iPad | Options in the share extension, for Safari pages. `GetPage.js` also inlines Readability (from `share/js/capture/`) and returns, next to v1.1's `{html, title, url}`, the object `lab: {cleanHtml, words, article?: {html, words}, selectionHtml, selectionText}` (F03; `article` only when `html` is at most 2 MiB). Review uses a `WKWebView` with `allowsContentJavaScript = false`. |

**Acceptance:**

- [ ] **F10.1** On Readability's test pages plus ten news fixtures, Clean article keeps at least 90% of the expected
  body text and drops navigation and footers.
- [ ] **F10.2** A page with under 150 extracted words shows the thin warning. Choosing Send full page sends the page
  HTML.
- [ ] **F10.3** The chosen mode is remembered per site across browser restarts.
- [ ] **F10.4** Review renders a 1 MB fixture page within 1 s, measured in CI Chromium (GitHub's `ubuntu-latest`
  runner) and on the lab iPhone of the W1 device round (its model is recorded in DEVICE-CHECKS.md). The edited title
  is the title sent.

**Automated:** `share/js/test/readability.test.mjs` (fixtures under `share/js/test/fixtures/articles/`); e2e for the
modes, the switch to Selection and Review; an XCTest for `GetPage.js` in a `WKWebView` host on fixture pages.

#### F11 Send a selection as an excerpt

**Common.** This is a Reader fact that decides the design. The Reader's read-later path drops the fragment from a
URL when it deduplicates (`CanonicalUrl.of`). It re-fetches pages under 150 words and keeps only a link document under
40. A selection sent as `page` would therefore become a "duplicate" of the article, or lose the quote. So
**excerpts are documents:**

- **With a source URL:** `kind: "file"`, `mime: "text/html"`, `name` = `excerptFileName` → "Excerpt - {first 6
  words}.html", `url` = the source URL plus `#:~:text=` and its first 8 words (`textFragment`), `title` =
  "“{first line, up to 100 characters}” · {page title}", `x-cap: "excerpt"`. The body comes from `excerptHtml`:

  ```
  <!doctype html><html><head><meta charset="utf-8"><title>{title}</title></head><body><article>
  <p><a href="{source url}">{page title}</a> · {site} · {date}</p><blockquote>{selection}</blockquote></article></body></html>
  ```

  The selection is sanitised to the tags `p br b strong i em u s sub sup a ul ol li blockquote code pre h1–h6`, with
  `href` only on `a`, and only http(s).
- **Without a URL** (Notes, Books, a plain text share): `excerptMarkdown` → "Note - {first 6 words}.md"
  (`text/markdown`): the quote, a blank line, then "— shared from {app} on {date}".
- **Limits:** 50,000 characters of text. Past that, the text is cut and ends with "(Excerpt trimmed to 50,000
  characters.)".
- **`classifyShare({text, url, title, source})`** decides between a link and an excerpt. Apps share "headline +
  link" as text all the time: NYT's "Opinion | The Real Reason Inflation Is Still Too High, According to Economists
  https://nyti.ms/…", Chrome on Android's "Title\nURL", Apple News, Substack, the Guardian, X. A word-count rule
  would turn those into quote-only documents that wait for a tap. So it returns an excerpt **only when the share is
  clearly a selection**:
  1. `source` is `selection`: the extension's selection (context menu, Selection mode), `GetPage.js`'s
     `selectionText` in a Safari share, or the Options choice "Send as excerpt".
  2. The URL carries a text fragment (`#:~:text=`), as Chrome on Android uses for a shared selection. The excerpt
     is the shared text without the URL, or else the fragment's decoded text.
  3. There is no URL at all (Notes, Books, the Mac Services text type): a note (`excerptMarkdown`).
  4. The text left after removing the URL has **at least 40 words or at least 3 sentences**, and it is not the
     title. A sentence ends in `.`, `!` or `?` followed by a space or the end. "Not the title" means it is not a
     prefix of `title`, and `title` is not a prefix of it, compared without case, punctuation or repeated
     whitespace.

  Everything else is a link, with the text as its title (F16). The `labExcerpt` and `normalise.json` vectors hold
  real headline + link shares, which must come out as links, and selections, which must come out as excerpts.
- **Excerpts follow the Inbox's Documents setting.** With Ask, they wait for a tap; with the Lab Reader (R1), they
  arrive quietly. A two-second "send this passage" must not become a tablet interruption, so **6.5 Q1 decides how
  far F11 goes before R1**. Until the user answers, only the explicit paths are built: the Chrome and Safari context
  menu and Selection mode (X1), and the excerpt builders in the libraries (L1, A3, K3). The share-sheet paths on
  iPhone, Mac and Android are the last item of A4, A5 and K4, and start only after the answer. If excerpts stay
  documents:
  - the first excerpt sent from each device shows once: "Excerpts wait for a tap on your Daylight for now.";
  - the Inbox groups waiting excerpts into one notice (F15).

| Platform | UI |
|---|---|
| Chrome, Safari | The "Send selection to Daylight" context menu (macOS Safari and Chrome) and the Selection mode (every build, including iPhone Safari, which has no context menus). |
| iPhone, iPad (after Q1) | A Safari share with a selection uses `GetPage.js`'s selection (rule 1). Text from other apps goes through `classifyShare`. |
| Mac (after Q1) | `NSServices` "Send to Daylight" for text, URLs and files (`macOS/App/Services.swift`, `Info.plist` `NSServices` with `NSSendTypes` `public.utf8-plain-text`, `public.url` and `public.file-url`). Text goes through `classifyShare`. |
| Android phone (after Q1) | `ACTION_SEND` `text/plain` goes through `classifyShare`. Chrome's "Share" of a selection carries a `#:~:text=` link (rule 2) and becomes an excerpt with that URL. |
| DC-1 Inbox | The row title is the header's `title`; the kind line reads "Excerpt" (F03). |

**Acceptance:**

- [ ] **F11.1** Selecting a paragraph and choosing Send selection delivers one item that shows the quote, the source
  link and the date in the Reader. The full article is not sent.
- [ ] **F11.2** Text with no URL arrives as a Markdown document the Reader opens.
- [ ] **F11.3** Excerpt HTML contains only the allowed tags, and a selection over 50,000 characters is cut with the
  note (unit tests and `labExcerpt` vectors).
- [ ] **F11.4** An excerpt of a page already in the Reader is a new document, not "already in your library".
- [ ] **F11.5** The headline + link vectors come out as links in JS, Swift and Kotlin. After Q1, an NYT headline +
  link shared from Chrome on Android arrives as a link that the Reader downloads (Android e2e).

**Automated:** `labExcerpt` vectors in JS, Swift and Kotlin; extension e2e for the context menu; Robolectric for the
Android share path; Swift tests for the Services handler.

#### F15 Arrival notices with actions, and Inbox health (DC-1 Inbox)

**Settings** (Lab, Inbox screen):

- "Arrival notices": **Off**, **Quiet** (default) or **Alert**. Quiet uses the new channel "Arrivals" at
  `IMPORTANCE_LOW`; Alert uses the new channel "Arrivals (alert)" at `IMPORTANCE_HIGH`.
- "Quiet hours" (off; 22:00–07:00 when on): arrivals are posted with `setSilent(true)`.

**Items that wait for a tap** keep the v1.1 "New items" behaviour (channel, card, announced once). On an e-paper
notice, "Hold" and "Later" would both read as "not now", so Lab gives the notice and the card two actions:

- **Add to Reader**: the tap, as today;
- **Keep for later**: the state `held`. The item stays in the Inbox, marked "Kept for later", until **Add to
  Reader**. It replaces the card's v1.1 **Later**.

Swiping the notice away also records `held`: the item already stays in the Inbox, and now the sender says so.
Waiting excerpts and documents from one sender share one notice ("3 excerpts from iPhone"), as v1.1 already groups
notifications.

**Items handed over by themselves** (links and pages, and documents with "Open as they arrive"): one grouped notice
"Saved to the Reader: {title}", text "From {from}", only **Dismiss**. The group summary reads "{n} saved from {from}"
(or "from your devices"). Notices are never posted for items whose notice was already shown.

**Health card** at the top of the Inbox screen: "Last checked {rel} · Instant delivery on" (or "off"). Warnings, one
at a time:

- Instant delivery is on but its service is not running (no heartbeat for 2 minutes): "Instant delivery stopped. Turn
  it back on to get items within seconds." with **Turn on**.
- Notifications are off: `needs-notifications`.
- The last poll's error: the v1.1 Inbox sentence.

The existing 15-minute WorkManager job checks the first case and posts "Instant delivery stopped" in the new channel
"Inbox health" (`IMPORTANCE_DEFAULT`), at most once every 12 hours.

**Lab Inbox screens** never animate and show every state in words.

**Acceptance:**

- [ ] **F15.1** Every arrival posts one notice (grouped when several), and TalkBack reads the title and the source.
  Each action publishes its state on the ack topic, which the emulator e2e reads:
  - **Add to Reader** → `reader` for a link, `handed` for a document;
  - **Keep for later** → `held`;
  - swiping the notice away → `held`;
  - **Dismiss** on a "Saved to the Reader" notice → no new state.
- [ ] **F15.2** Stopping the service from Android's Task Manager shows the warning card on the next open, and the
  notice within 15 minutes.
- [ ] **F15.3** Lab Inbox screens render their final state with animations disabled, and no state is shown by colour
  alone.
- [ ] **F15.4** Keep for later makes the sender show "Kept for later on your Daylight", and Add to Reader then gives
  "In your Reader ✓" for a link.

**Automated:** Robolectric `ArrivalNoticesTest` (the channels, grouping, actions → hand-off / `held`, swipe →
`held`, quiet hours); `HealthTest` (a fake heartbeat and clock); emulator e2e for every action of F15.1 on the ack
topic.

#### F16 Smart intake: unwrap Apple News, AMP, Substack and tracking links

`normaliseShare({text, url, subject})` returns `{url, title, excerpt, orig}`. It is pure, and every app uses it at
every entry point while Lab is on.

1. **URL.** `url` when it passes the web URL rule. Otherwise the first http(s) URL in `text` (`findUrl`), with
   trailing `. , ; : ! ? ' " » ” ’` removed, and a trailing `)` or `]` removed when unbalanced.
2. **Title.** `subject` when it is not empty. Otherwise `text` with the URL removed, whitespace collapsed, and leading
   and trailing `- – — : | ·` and quotes trimmed, through `cleanTitle`. `excerpt` is set, and the title is null,
   only when `classifyShare` (F11) returns an excerpt. A headline is always a title, however long.
3. **Unwrap without the network:**
   - `google.<tld>/amp/s/<rest>` → `https://<rest>`;
   - `google.<tld>/url?q=` or `?url=` → that URL;
   - `<x>.cdn.ampproject.org/c/s/<rest>` or `/v/s/<rest>` → `https://<rest>`, and `/c/<rest>` → `http://<rest>`;
   - `l.facebook.com/l.php?u=`, `lm.facebook.com/l.php?u=` and `l.instagram.com/?u=` → that URL;
   - `www.linkedin.com/safety/go?url=` → that URL;
   - `open.substack.com/pub/<pub>/p/<slug>` → `https://<pub>.substack.com/p/<slug>`.
4. **Remove tracking parameters.** Names are compared exactly:
   - everywhere: `utm_*`, `fbclid`, `gclid`, `gbraid`, `wbraid`, `dclid`, `msclkid`, `mc_cid`, `mc_eid`, `igshid`,
     `igsh`, `yclid`, `twclid`, `ttclid`, `_hsenc`, `_hsmi`, `mkt_tok`, `ref_src`, `ref_url`, `__s`, `sr_share`;
   - `si` on `youtube.com`, `youtu.be` and `open.spotify.com`;
   - `s` and `t` on `twitter.com` and `x.com`;
   - `smid` and `smtyp` on `nytimes.com`;
   - `r`, `triedRedirect` and `showWelcome` on `*.substack.com`.

   Other parameters are never reordered, paths are never lowercased, and the fragment is kept. A query left empty
   loses its `?`.
5. **Apple News** (`https://apple.news/<id>`): only iPhone and Mac resolve it. One `GET` on an ephemeral `URLSession`
   (no cookies, 3 s timeout), then `extractAppleNewsTarget(html)` (pure: the `redirectToUrlAfterTimeout("…")`
   argument, else the first `<a href>` in `<body>` that passes the web URL rule). On failure the apple.news URL
   stays.
6. **`orig`** = the input URL when the result differs. It is sent as `x-orig`, unless it is over 1,024 characters or
   would make a small frame large (2.3).

**Acceptance:**

- [ ] **F16.1** At least 50 vectors pass in JS, Kotlin and Swift: an Apple News text share (parser fixture), a
  Substack app link, AMP, `utm_*`, a Facebook redirect, a plain URL, parentheses, trailing punctuation, and the real
  headline + link shares of 2.8 (NYT, the Guardian, Apple News, Substack, X, Chrome on Android), which stay links
  with the headline as the title.
- [ ] **F16.2** Sharing from Apple News on an iPhone sends the article URL, not a text note.
- [ ] **F16.3** A URL whose only change is removed tracking parameters is otherwise byte-identical (a vector check).

**Automated:** the `normalise.json` vectors in all three languages; a Swift test for `extractAppleNewsTarget`.

#### F26 Setup coach, test send and diagnostics

**Common.**

- **"Setup check"** (Lab): a checklist with one line per check, "✓ {check}" or "! {check}". Each unmet check has a
  button that opens the right settings screen.
- **"Send a test article"** sends `testArticle()`: a bundled page of about 400 words written for this, so the Reader
  neither re-fetches it nor keeps only a link. It goes as `page` with `url` = `https://daylight.invalid/test/<id>`
  (the server's convention for URLs that never resolve), `title` = "Test article from {device}", `x-cap: "test"`. The
  button's footer says: "It’s added to your Reader library; delete it there when you’re done." The checklist then
  follows it along the timeline and ticks "Delivered" and "In your Reader".
- **Hints shown once** (F03's link-only line) stay listed in Setup check afterwards.
- **"Activity log"**: the last 200 events, `{time, type, id8, kind, status, http}`.
- **"Copy diagnostics"**: the app version, platform, Lab on, caps seen, last check-in, outbox counts by status, the
  relay as "ntfy.sh" or "custom relay", and the last 50 log events, all passed through `redactDiagnostics`. That
  replaces URLs with `[url]`, 28-character base32 codes with `[code]`, `dls-` plus 32 hex with `[topic]`, and
  `SERVER-…` and `daylightserver://…` with `[server code]`. Titles, names and `from` are never logged.

| Platform | Checks |
|---|---|
| iPhone, iPad | Paired; share item used at least once (else the steps to add it from "More"); Safari extension (steps only, since iOS cannot detect it); notifications (for F04's failure notices); background app refresh |
| Mac | Share menu extension and Safari extension state (the app already reads the Safari one); start at login; **Add to the Print menu** (F23); notifications; on ad-hoc builds, the line of 1.4 about the Share menu item |
| Android phone | Notifications; battery optimisation exemption |
| DC-1 Inbox | Notifications and the "New items" channel at high importance; Display over other apps; battery optimisation; Instant delivery; a Reader installed that answers `SAVE_PAGE`; the Reader's read-later not refused lately. Instead of a test send: **Test the Reader hand-off**, which hands the bundled test article to the Reader through the normal hand-off and shows the result. |
| Chrome, Safari | Pinned button (Chrome: `action.getUserSettings().isOnToolbar`); shortcut set (`commands.getAll`); site access (`permissions.contains`) |
| Web | Installed as an app (`display-mode: standalone`); storage persisted (`navigator.storage.persisted()`) |
| Windows | The Send to shortcut exists; start at login; the hotkey is registered; notifications |

**Acceptance:**

- [ ] **F26.1** The test article reaches the Reader from every app, and the checklist ticks Delivered and In your
  Reader. On Rooted 2 this holds in each condition of F01.1. Where the Inbox waits for a tap, the checklist shows
  "Waiting for a tap on your Daylight" until then.
- [ ] **F26.2** Copied diagnostics contain no URL, title, pairing code, topic or Server code (unit test on a fixture
  log, plus the `diagnostics` vectors).
- [ ] **F26.3** Each unmet check has a button that opens the right settings screen.

**Automated:** the `redactDiagnostics` vectors in all three languages; per-app UI tests for each check's state.

#### F33 Send the copied link

| Platform | UI and behaviour |
|---|---|
| iPhone, iPad | On becoming active, `UIPasteboard.general.hasURLs` (no paste alert) shows a chip. The chip is a SwiftUI `PasteButton(payloadType: URL.self)` labelled "Send copied link"; it reads only on tap, then shows "Send {host} to {name}?" with **Send** and **Cancel**. |
| Mac | **No new control.** The app's existing **Send Clipboard Link** command (the window's button, the menu bar item's entry, ⇧⌘L) is F33 on the Mac. With Lab on it is labelled "Send copied link" and runs `normaliseShare`. The button shows the host and **Send** before sending; the menu entry and ⇧⌘L send at once, as today, and their result line names the host. With Lab off it is exactly v1.1. |
| Android phone | On resume, `primaryClipDescription` only. On API 31+, show the chip when `getConfidenceScore(TextClassifier.TYPE_URL) ≥ 0.5`, or the MIME type is `text/uri-list`. Read on tap, then show the host and **Send**. |
| Chrome, Safari, Web | A "Paste and send" button, always shown, reads the clipboard on click and shows "Send {host}?" with **Send** and **Cancel**. A non-URL gives "No link on the clipboard." |
| Windows | **No new control**: the existing **Send clipboard link** (the window's button, the tray menu, Ctrl+Alt+D), labelled "Send copied link" with Lab on. The window's button shows the host and **Send** first; the tray entry and the hotkey send at once, and their toast names the host, as today. |

All of them run `normaliseShare` on what they read. A stale clipboard is never sent unseen from a button: only the
Mac and Windows hotkeys and menu entries send at once, as they already do, and their result names the host.

**Acceptance:**

- [ ] **F33.1** Copy a link in Safari and open the app: the chip appears with no iOS paste alert. Tapping it shows
  the link's host, and Send sends the link.
- [ ] **F33.2** No chip appears for a non-URL clipboard. On Android 13, no "pasted from" toast appears before the
  tap.
- [ ] **F33.3** In every app, a button that reads the clipboard shows the host before anything is sent. Lab off on
  the Mac and Windows: the clipboard command's label and behaviour equal v1.1 (parity test).

**Automated:** XCUITest with a seeded pasteboard; Robolectric with a `ClipDescription` stub; extension e2e with
clipboard permission granted.

#### F34 Full browser context menu and keyboard shortcuts (Chrome, Safari)

- **Menus** (Lab): Send page to Daylight (exists), Send clean article to Daylight, Send link to Daylight (exists),
  Send selection to Daylight, Send this image’s page to Daylight (sends the page, not the image), Send PDF link to
  Daylight (exists). The service worker rebuilds the menus when Lab or the "Show in the right-click menu" checkboxes
  change (one per entry).
- **Commands:** `send-page` Alt+Shift+D (exists), `send-selection` Alt+Shift+S, and `send-clean` and `send-link` with
  no default key.
- **Chrome omnibox:** keyword `dl` (manifest `omnibox`). `onInputEntered` runs `normalizeUserUrl` and sends the link.
  With Lab off it opens `lab.html` with the Lab-off sentence.
- **Safari:** no omnibox (left out of the Safari manifest by `build.mjs`), and shortcuts cannot be rebound. iPhone
  Safari has no context menus, so the popup's mode buttons cover them.

**Acceptance:**

- [ ] **F34.1** Each menu entry sends the right kind (one e2e test per entry).
- [ ] **F34.2** The shortcuts are listed at `chrome://extensions/shortcuts`. "dl example.com/story" in the omnibox
  sends the link. Unticking an entry removes it from the menu.

**Automated:** `core.test.mjs` with the fake browser (menu ids per Lab state); Playwright for the menus, the commands
and the omnibox; `safari.test.mjs` checks the Safari manifest has no `omnibox`.

#### F23 and F29, Mac parts: Print to Daylight, and drop on the menu bar

The research's Mac list for a DC-1 owner (raw/eink-tablets.md §8.2, item 8) names these two. They are small and need
nothing else, so the Mac gets them in W1. The rest of F23 and F29 stays in W2 (4.1).

| Platform | UI and behaviour | Edge cases |
|---|---|---|
| Mac | **Print › PDF › Send to Daylight.** Setup check offers **Add to the Print menu**. It opens a save panel at `~/Library/PDF Services` that creates an alias to the app named "Send to Daylight"; the user picks the folder, so the sandbox needs only user-selected access. The print system then opens the printed PDF with the app (`application(_:open:)`, the path a file dropped on the Dock icon already takes), which sends it as a file titled with the document's name. **Drop on the menu bar.** The menu bar item accepts dropped files and links. SwiftUI's `MenuBarExtra` (`SendToDaylightMacApp.swift`) takes no drops, so A5 replaces it with an `NSStatusItem` whose button is registered for file URLs and URLs, and which keeps the same menu. Each drop sends at once; the item's menu shows the result line. | Lab off: no drop target. A Print menu alias already added keeps working, because it uses the v1.1 open-file path. A file over 9 MB gives the too-big sentence and the F02 entry point. |

**Acceptance:**

- [ ] **F23.1 (Mac)** Print › PDF › Send to Daylight from TextEdit delivers a PDF with the same page count
  (XCUITest drives TextEdit's print panel on the macOS runner; device round on the Mac mini).
- [ ] **F29.1 (Mac)** A PDF from Finder and a link from Safari, dropped on the menu-bar icon, are both sent
  (XCUITest drag; device round).

**Automated:** an XCTest for the open-file path with a PDF Services-style temporary file; XCUITest for the
status-item drop.

### 3.4 What W0 and W1 deliberately do not do

- No note, tags or destination fields (F12, W2).
- No return topic polling (F06, W2).
- No LAN transfers (F13, W2).
- No server feature UI beyond the gate, the F02 entry point and the `later` state (Wave S).
- No per-feature Lab switches (6.5 Q5). Feature settings such as "Always show Options before sending" are ordinary
  settings inside their feature.
- No Reader-side change: the Lab Reader is section 5. Its R0 fix and R1 inbox may land during W1; senders need no
  change to show the Lab Reader's states. Main-Reader requests wait for the user (6.5 Q8).

### 3.5 Task cards

Every card:

- builds on the folder's P0 close-out (0.2);
- keeps the folder's CI green, editing only its lane's job blocks (6.3);
- updates its README (Lab section, test hooks);
- shows the strings exactly as `LAB_TEXT` gives them;
- has a **Done when** list that includes the parity test (F00.2) for every app the card touches.

**P0 close-outs · one per lane · Stage A** (P0-core, P0-kit, P0-ios, P0-mac, P0-app, P0-ext, P0-web, P0-win)

- **Depends on:** nothing. P0-ios and P0-mac also depend on P0-kit.
- **Builds**, in this order and in the lane's own folders:
  1. the folder's remaining v1.1 review findings (CHANGES-v1.1 §6). P0-app includes cb57057 and the document
     hand-off workaround; P0-mac includes 0e90108. Both are confirmed on the pending device re-check.
  2. the F27 baseline with Comfort, as a non-Lab commit. P0-kit builds `ComfortModifier` and the baseline pieces of
     `DaylightShareUI`; P0-ios and P0-mac wire them.
  3. the Lab-off parity baselines of 1.7, recorded from that commit. P0-core and P0-kit have no screens, so they
     have none.
- **Done when:** the folder's CI is green, F27.1–F27.4 hold for its apps, and the baselines are committed.

**SV0 · `server/` · W0 · client-module gaps**

- **Depends on:** nothing.
- **Builds:**
  - `DaylightServer.noteError(feature, error)` (2.6);
  - the `serverState` vectors;
  - `server/pendingMove` in DESIGN 13.1's key list;
  - DESIGN 5.5's note that Lab frames on the pairing ack topic count as presence in v1 mode;
  - the `pollAcks` test with Lab frames (2.8).
- **CI:** `rx-server.yml`.
- **Done when:** `npm test` is green and `npm run vectors` leaves no diff.

**L0 · `share/` · W0 · JS reference**

- **Depends on:** nothing.
- **Builds:**
  - 2.7.1: `aadFor`, `checkItemHeader` extras (2.3), `onAckHeader`, `defer`, `flushNetwork` with both caps and the
    pass rules, `lab/*` removal;
  - `share/js/daylight-lab.js` (2.7.2, W0 list). It includes the exact parser (2.2.5), the per-publisher ledger
    (2.2.6), `LabInbox` with spacing, giving way, the daily cap, halving and the `lab: 0` repeats (2.2.4), and
    `labGate` with its 5 s deadline;
  - `share/vectors/generate-lab.mjs` and `lab-vectors.json` with every section of 2.8;
  - `share/js/test/lab.test.mjs`, and `lab-skew.test.mjs` with the v1.0 peer fixture (b48752b), the two-publisher
    cases and the household soak;
  - `share/LAB-PROTOCOL.md`: section 2 of this plan, copied verbatim and kept as the normative text from then on;
  - a pointer from `share/README.md`.
- **CI:** `rx-share.yml` (2.8).
- **Done when:** the vectors are regenerated with no diff to `test-vectors.json`, and the skew and soak tests pass.

**L1 · `share/` · W1 · JS reference**

- **Depends on:** L0.
- **Builds:**
  - `normaliseShare`, `extractAppleNewsTarget`, `classifyShare` (F11's four rules), `excerptHtml`,
    `excerptMarkdown`, `excerptFileName`, `textFragment`, `testArticle`, `redactDiagnostics` and the W1 `LAB_TEXT`;
  - `share/js/capture/`: `clean-html.js` (moved from the extension, with its test), Readability 0.6.0 and `sync.mjs`
    (6.3);
  - `share/vectors/normalise.json` (with the headline + link shares) and the `labExcerpt` and `diagnostics`
    sections;
  - `share/js/bin/daylight-send.mjs` with `cli.test.mjs`, with the lock file, atomic renames and `tick()` on every run
    (F09);
  - `share/SEND-API.md`;
  - `rx-share.yml` publishes `daylight-send.mjs` to the release.
- **Done when:** F09.4, F11.5 (JS), F16.1 (JS) and F26.2 (JS) pass, and two `daylight-send` runs at once lose no
  rows.

**A0 · `apple/DaylightShareKit` · W0 · Swift port and shared UI**

- **Depends on:** L0, SV0 (for `serverState`), P0-kit.
- **Builds:**
  - `Lab.swift` (`LabInboxInfo`, `LabFrame` with the exact parser, `LabLedger` per publisher), `LabText.swift`
    (with the short states), `LabTopics.swift`;
  - `ItemHeader` extras (2.3); `ShareSender(onAckHeader:)`; `SharedStore.Key` `dls.lab`, `dls.labNoteShown`;
  - `Server/` (the 2.6 W0 subset, `noteError` included);
  - in `DaylightShareUI`: `LabSettingsSection`, `WhatsInLabView` (short states, the server group), `ServerSettingsView`,
    `LabNote`, `LabGate` (with the 5 s deadline), `TimelineRow` (W0: label and sentence only);
  - tests: `LabVectorTests`, `ServerVectorTests`, `LabLedgerTests`, `LabSkewTests`;
  - `apple/scripts/e2e-receiver.mjs --lab`.
- **Done when:** the vectors pass, `swift test` is green and the skew suite passes.

**A1 · `apple/iOS` · W0 · iPhone and iPad**

- **Depends on:** A0, P0-ios.
- **Builds:** F00 and F17 for the iPhone (3.2): settings section, What's in Lab, server section with the Server
  code, the share extension following `dls.lab`, `LAB_NOTE_ENABLED = false`, the XCUITest parity test (tree walk)
  and the first-run test; `-DLSLab`.
- **Done when:** F00.1–7, F17.2 and F17.4 (device) pass, and F27.1–4 still hold.

**A2 · `apple/macOS` · W0 · Mac**

- **Depends on:** A0, P0-mac. Runs in parallel with A1.
- **Builds:** as A1, for the Mac window, the Settings window and the Share menu extension. On ad-hoc builds the
  Share menu item gets its own Lab switch, and What's in Lab gets its closing line (1.1, 1.4).
- **Done when:** as A1, for the Mac, checked on the released ad-hoc build.

**K0 · `android/share-core` · W0 · Kotlin port**

- **Depends on:** L0, SV0, P0-core.
- **Builds:**
  - package `core.lab`: `LabInboxInfo`, `LabFrame` (the exact parser), `LabLedger` (per publisher), `LabInbox`
    (2.2.4's rules), `LabText`, `LabTopics`;
  - `ItemHeader.check` extras, carried by `Reassembler` and `Receiver` (2.3);
  - `Outbox(onAckHeader)`;
  - package `core.server` (the 2.6 W0 subset, `noteError` included);
  - tests: `LabVectorsTest`, `ServerVectorsTest`, `LabInboxTest`, `LabSkewTest` (two publishers included).
- **Done when:** `./gradlew :share-core:test` is green, with the vectors and skew suite.

**K1 · `android/app` · W0 · Android, both roles**

- **Depends on:** K0, P0-app.
- **Builds:**
  - `Prefs.lab` and `labNoteShown`; `LabCard`, `LabScreen` (short states, the server group), `LabNote`;
  - the sender's ledger via `onAckHeader`;
  - the Inbox's `inbox/LabReporter.kt` (F17: pairing-lane items only, records, flush under 2.2.4's rules, hello, the
    `lab: 0` frame and its repeats, the log lines);
  - the debug link's `lab=`;
  - Robolectric `LabOffParityTest`, `LabReporterTest`, `PrefsLabTest`, `LabFirstRunTest`.
- **Done when:** F00 (Android parts), F17.1–3 and F17.5 pass.

**X0 · `extension/` · W0 · Chrome and Safari**

- **Depends on:** L0, P0-ext.
- **Builds:**
  - `build.mjs` copies `daylight-lab.js` and `daylight-server.js`;
  - `src/lab.js` (service worker: Lab state, ledger, gate, server);
  - `src/lab-ui.js`, `src/lab.html`, `src/lab-page.js`;
  - the popup settings row;
  - `test/unit/lab.test.mjs` and `test/e2e/lab.e2e.mjs` (with `ariaSnapshot` parity).
- **Done when:** F00 and F17 (extension parts) pass.
- **Release:** not published before the iPhone and Mac W0 builds (6.2).

**B0 · `web/` · W0 · web sender**

- **Depends on:** X0 (it uses `extension/src/lab-ui.js` and `logic.js` through the build), P0-web.
- **Builds:** `web/web-lab.js`, the settings row, What's in Lab, the server panel; tests in
  `extension/test/{unit,e2e}/web-lab*`.
- **Done when:** F00 and F17 (web parts) pass.
- **Release:** as X0.

**WIN0 · `windows/` · W0 · Windows**

- **Depends on:** L0, P0-win.
- **Builds:** `build.mjs` copies the two modules; `src/lab.js`; the settings row and panels; the CSP; the
  `--e2e-lab` flag; unit and e2e tests.
- **Done when:** F00 and F17 (Windows parts) pass in `rx-windows.yml`.
- **Release:** as X0.

**E0 · `e2e/`, `.github/workflows/rx-e2e.yml` · W0**

- **Depends on:** K1.
- **Builds:** `e2e/sender.mjs` reads Lab frames (`lab-states <id…>`). `inbox-e2e.sh` asserts the hello and the states
  for page, link and PDF. A second pass with `docs=ask` expects `waiting`, then a root tap through
  `HandoffActivity`, then `handed`. A third pass, with the overlay permission off and the Reader in front, expects
  `waiting` for a link too.
- **Done when:** F17.1 runs on the emulator.

**A3 · `apple/DaylightShareKit`, `apple/Shared` · W1**

- **Depends on:** A0, L1.
- **Builds:**
  - `ShareNormaliser` (with the Apple News fetch), `Excerpt`, `classifyShare`, `testArticle`, `redactDiagnostics`;
  - `ShareSender` `defer` and `flushNetwork` (both caps, the pass rules);
  - `BackgroundPublisher` (two passes, re-send timing) and `FrameFileBuilder` (F04);
  - `FailureNotices` (F04's notifications, with the permission request for the apps);
  - `TimelineRow` with the step line, what a row shows (2.5) and the check-in header;
  - shared UI pieces: `QueueSection`, `SetupCheckView`, `ActivityLogView`, `PasteChip` (with the host preview),
    `OptionsSheet` (no countdown under F04's accessibility rule), `ReviewView`;
  - **`apple/Shared`**, which both the iPhone and the Mac targets compile: `GetPage.js` returns v1.1's `html` plus
    the `lab` extras (F03, F10), with `clean-html.js` and Readability synced from `share/js/capture/`. A4 and A5 only
    wire this; they never edit `apple/Shared`.
  - tests: `NormaliseVectorTests`, `ExcerptVectorTests`, `FrameFileBuilderTests`, `BackgroundCompletionTests`,
    `OfflineQueueTests`, and the `GetPage.js` XCTest (F03.5).

**A4 · `apple/iOS` · W1 · iPhone and iPad**

- **Depends on:** A3, A1.
- **Builds:**
  - F01, the F02 entry point, F03 (choosing `cleanHtml` by `dls.lab`; the link-only line once), F04 (with the
    failure notification and the iOS 16–26 timing matrix), F07, F08, F09 (App Intents in `iOS/App/Intents/` with
    both phrases, the scheme), F10, F16, F26, F33;
  - `LAB_NOTE_ENABLED = true`;
  - last, and only after 6.5 Q1: F11's share-sheet paths;
  - `project.yml`: iOS targets only;
  - XCUITests for share-extension timing, intents, the paste chip and the audits.
- **Done when:** the iPhone acceptance items F01–F33, and a device round on an iPhone with Rooted 2.

**A5 · `apple/macOS` · W1 · Mac**

- **Depends on:** A3, A2. Runs in parallel with A4.
- **Builds:**
  - F01, the F02 entry point, F04 (the ad-hoc path, and the team-signed path for when 6.5 Q6 is yes), F07, F08, F09
    (intents and scheme), F16;
  - F23's Print menu entry and F29's menu-bar drop (an `NSStatusItem` in place of `MenuBarExtra`);
  - F26 (with Add to the Print menu);
  - F33 on the existing clipboard command;
  - `LAB_NOTE_ENABLED = true`;
  - last, and only after Q1: F11 (Services);
  - `project.yml`: macOS targets only.
- **Done when:** the Mac acceptance items on the released ad-hoc build (F04.3, F23.1, F29.1 included), and a
  device round with Rooted 2 (on the Mac mini).

**X1 · `extension/` · W1 · Chrome and Safari**

- **Depends on:** X0, L1.
- **Builds:**
  - F01 (rows, badge `⌛`), the F02 entry point (Chrome);
  - F03: the build copies `share/js/capture/clean-html.js`, and `extension/src/clean-html.js` is removed;
  - F04 (the click-to-send setting), F07 (`dls-offline`);
  - F10 (the "Send as" menu, Readability from `share/js/capture/`, `review.html`);
  - F11 (the explicit paths only), F16, F26, F33 (with the host preview);
  - F34 (menus, commands, omnibox).
- **Done when:** the Chrome and Safari acceptance items pass, and `safari.test.mjs` is green.
- **Release:** as X0.

**K3 · `android/share-core` · W1**

- **Depends on:** K0, L1.
- **Builds:** `Normalise`, `Excerpt`, `classifyShare`, `testArticle`, `redactDiagnostics`, `Outbox` `defer` and
  `flushNetwork` (both caps, the pass rules), `LabRowText` steps and `final`; the vector tests.

**K4 · `android/app` · W1 · Android phone** (sender packages `sender/`, `ui/SenderScreen.kt`)

- **Depends on:** K3, K1.
- **Builds:**
  - F01, the F02 entry point, F03 (the hint, once);
  - F04: the "Send results" channel, and its workers `sender/SendWorker.kt` and `sender/FlushWorker.kt`. They live
    in `sender/`, not in `Work.kt`, which belongs to K5.
  - F07, F08 (`Shortcuts.kt`, `shortcuts.xml`), F09 (`AutomationActivity`), F16, F26, F33 (with the host preview);
  - last, and only after 6.5 Q1: F11's share path.
- **Done when:** the Android-phone acceptance items pass.

**K5 · `android/app` · W1 · DC-1 Inbox** (packages `inbox/`, `ui/InboxScreen.kt`, `Work.kt`)

- **Depends on:** K3, K1. It may run in parallel with K4 under 6.3.
- **Builds:**
  - `InboxItem` gains the header `extras` (2.3) and a `lane` field ready for S0;
  - F01: the "Sender sees" line in item details;
  - F03 and F11: the row lines from the extras, and the cap `cap-kind`;
  - F15: Add to Reader and Keep for later, swipe → `held`, grouped excerpt notices;
  - F26: the checks and the Reader hand-off test.
- **Done when:** the Inbox acceptance items pass, and E1's emulator steps run.

**K6 · `android/app` · W1 · handover to the Lab Reader** (Inbox role; package `inbox/handover/`)

- **Depends on:** K1.
- **Builds:**
  - 5.3.4's `HandoverProvider` and `receivingElsewhere`;
  - a `<queries>` entry for the Lab Reader's pinned package and its `ShareInboxProvider` authority;
  - the resume rule of step 4;
  - Robolectric `HandoverTest` (5.3), including an invisible provider.
- **Done when:** `HandoverTest` passes, and R1.4 on Rooted 2 once R1 exists.

**B1 · `web/` · W1**

- **Depends on:** B0, X1.
- **Builds:** F01, the F02 entry point, F07 (Background Sync), F09 (bookmarklet), F16, F26, F33 (with the host
  preview).
- **Release:** as X0.

**WIN1 · `windows/` · W1**

- **Depends on:** WIN0, L1.
- **Builds:** F01 (rows, toast), the F02 entry point, F07, F08 (toast name), F09 (scheme in `args.rs`), F16, F26,
  and F33 on the existing clipboard command.
- **Release:** as X0.

**E1 · `e2e/`, `rx-e2e.yml` · W1**

- **Depends on:** K5.
- **Builds:** the e2e steps for:
  - F08 (shortcut listed);
  - F15 (every action of F15.1 → its state);
  - F11 (an excerpt imports as a new document; after Q1, an NYT headline + link from the share sheet arrives as a
    link);
  - F04 (the worker's notification after a forced 413);
  - F26 (the Reader hand-off test).

---

## 4. Waves 2, S, 3 and 4

"Needs" means: **none** (companion apps and the Inbox only), **Reader** (a Reader change, section 5) or **server**
(the Daylight server deployed, plus the extra it names).

### 4.1 Wave 2

W2 is built in this order. Within each step, iPhone, Mac and the Inbox come first. Steps 1 to 3 deliver two of the
DC-1 owner's "finally" items (3.1).

| Order | Feature | Needs | Depends on | What it takes |
|---|---|---|---|---|
| 1 | L2 Return lane (infrastructure) | none | L0 (2.4) | In JS `Sender` and `Receiver`: `lane`, the per-lane storage prefix, `x-dev` and per-device delivery, and manifest replacement; then Kotlin and Swift. Also vectors, skew tests, and the return rows of 2.2.7 with their soak. |
| 2 | F06 Send back from the DC-1 | none | L2 | The Inbox role's share-target `activity-alias` "Send to my phone or Mac" (the phone role keeps "Send to Daylight"). The Daylight's return outbox, with targets per 2.4. Senders poll the return topic with the ack-topic rules and show "From your Daylight" (Open, Save, Share). The cap `return`. 6.5 Q3 decides the default targets. |
| 3 | F13 Big files on the same Wi-Fi | none | F17 (`lan` in `x-inbox`), F04 | The Inbox's LAN listener (`PUT /dls/v1/frame`, `GET /dls/v1/have`, `/dls/v1/ping`), with rate limits. Native senders upload 12 MiB frames directly. A new state, `needs-same-wifi`. The F02 entry point gains "Or send it over your Wi-Fi." |
| 4 | F12 Note, tags, destination | none (filing into collections: Reader) | F04's Options; caps `note`, `dest`, `hold` | `x-note` (≤ 280), `x-tags` (≤ 8 × 40), `x-dest` (`now`, `quiet`, `hold`, `stack`). The Inbox shows and filters them, and puts "Note from {from}: …" at the top of pages. Senders gate `hold` and `stack` on caps (`needs-inbox`). |
| 5 | F32 Already sent | none | F16 | A local history keyed by canonical URL and SHA-256. |
| 6 | F48 Verified delivery, private items | none | F01 | The hash shown on both ends; `x-private`. |
| 7 | F23 Print to Daylight, the rest | none | — | An Android `PrintService`; the iPhone's Print › Share tip. The Mac part shipped in W1. |
| 8 | F29 Mac power moves, the rest | none | F09, F11 | A watched folder, a Quick Action, the front browser tab. Windows: a watched folder. The menu-bar drop shipped in W1. |
| 9 | F30 Scan to PDF | none | — | VisionKit (iPhone); ML Kit Document Scanner (Android). |
| 10 | F42 iPhone controls and widgets | none | F01, F33 | `ControlWidgetButton`; widgets read the App Group outbox and ledger. |
| 11 | F50 iPad layout | none | — | `NavigationSplitView`; drag and drop. |
| 12 | F51 No lock-in | none | — | Export history (JSON, CSV) and the pairing (behind device authentication); a "Your data" page. |
| 13 | F22 Tabs as one issue | none | F10 | An EPUB in the extension (fflate) and on Mac and Windows; epubcheck in CI. |
| 14 | F24 Image diet | none | F10 | Image budgets in `inject.js` and `GetPage.js`. Reader check: `data:` images in saved pages. |
| 15 | F31 Chrome Reading List | none | F16, F32 | The optional `readingList` permission; throttled; a ledger; its rows in 2.2.7. |
| 16 | F41 Android tile and `PROCESS_TEXT` | none | F11, F33 | A `TileService`; `PROCESS_TEXT`. |

### 4.2 Wave S (server lane; starts once the Worker is deployed, alongside W2)

Order: S0, then F02, then F37, F19 and F36, each on iPhone and Mac first. SV0 (W0) already gave the client module
`noteError` and the `serverState` vectors.

| Feature | Needs | Depends on | What it takes |
|---|---|---|---|
| S0 The Inbox's server lane | server | K0, the server deployed | DESIGN 5.5, with Kotlin ports of `sealBox`, `openBox` and `buildServerItemFrames` (tests):<br>• poll `itemTopic` with `openBox('item')`;<br>• ack on the server ack topic with `sealBox('ack')`, batched to at most one ack frame every 15 minutes (2.2.7);<br>• hello with `x-inbox` exactly as `buildInboxInfo` makes it for the pairing lane, `lab: 0` included;<br>• tag server items `lane = "server"`, so LabReporter records nothing for them (2.2.4).<br>After a handover (5.3.4), the server lane stays with Daylight Share, which hands server items to the main Reader, until the Lab Reader's hello carries the cap `server`. On the server side (server lane): `pollAcks` treats `x-inbox.lab === 0` as the end of presence (DESIGN 5.5 updated), and it keeps its 60-character `app` clamp, which Lab now uses too (2.2.1). An integration test puts Lab frames (`ids: []`, `x-st`, `lab: 0`) on the server ack topic in Lab mode. DESIGN 14.1's `needs-lab-inbox` text takes 1.6's. Recommended first (DESIGN 3.1), so that v1 delivery stays an exception. |
| F02 Files over 9 MB | server + R2 | F04's `BackgroundPublisher` (iPhone) | `files.sendLarge` with the hosted outbox. The iPhone uploads from files with a background session; Chrome uploads from an extension page, never from the service worker. `files.tick` reads acks through the Sender's `onAckHeader` (DESIGN 17.7) instead of its own `server/hostedAckCursor`, so acks are polled once. `LabLedger.prune` keeps hosted ids, so large files show timeline states. The W1 entry point then sends at once. Second in Wave S, iPhone and Mac first: it is the DC-1 owner's first "finally". |
| F37 Summaries with Claude | server + `ANTHROPIC_API_KEY` | W0 gate | `ai.summarize`, `explain` and `ask` UI, iPhone and Mac first (Swift port of `ai`), then the extension and web (the module as it is), then Android. The first-use notice. The AI cap editable in the server section. |
| F19 Email-in | server + R2 + domain (Workers Paid in practice) | W0 gate | The address with Copy; Recent mail; block and unblock. |
| F36 Feeds and digest | server | W0 gate | The feed list, OPML import, the digest hour, "Send digest now". |
| F58 Webhook | server | — | Server only. Not scheduled until the user asks. |

### 4.3 Wave 3

| Feature | Needs | Depends on |
|---|---|---|
| F14 Morning stack | none | F12 (`x-dest: stack`), cap `stack` |
| F20 "On your Daylight" (the Inbox's held items) | none | L2; the control lane (`controlTopic`); caps `manifest`, `control` |
| F25 Read-later connectors pulled by the Inbox | none | The control lane (the token travels encrypted) |
| F28 YouTube transcripts | none | F10 |
| F35 RSS on the Inbox | none | The control lane (subscribe from the extension) |
| F38 Notes into Obsidian or a folder | none | F06, R2 |
| F39 Handwriting to text | none | F06 |
| F40 Inbox triage | none | F12 (`hold`) |
| F43 Paper mode | none | — |
| F44 DOI, arXiv, PubMed | none | — |
| F45 X threads | none | F10 |
| F46 Guest drop | none | Web sender guest mode |
| F47 Import a reading list | none | F16, F32 |
| F49 Pairing fingerprint | none | Vectors (four words from the key) |

### 4.4 Wave 4 (stretch) and Reader features

- **Wave 4:** F56 Listen on the phone, F57 Zotero plugin (with F06), F59 Safari Reading List, F60 command palette,
  F61 OCR, F62 arXiv maths, F63 fake redactions, F67 watched folder on the tablet. All need nothing but the companion
  apps.
- **Reader features:** F05, F18, F21 and F55 become the Lab Reader tasks R2–R4 (section 5). F52–F54 and F68 belong to
  the Reader session's own Labs; F66 belongs to the Reader's sync plan. F64 (Apple Intelligence) waits for the user's
  decision (FEATURES §6 Q4).

---

## 5. Reader-side Lab work (the side-by-side Reader copy on the lab tablet)

### 5.1 Ground rules

- **Who and where.**
  - Built by the Reader session on the Mac mini, from the live Reader repository.
  - Class names below are from the public snapshot 0.27.843; check each against the live code.
  - Installed only on Rooted 2 (JP4R01422), as the side-by-side copy already there (DEVICE-CHECKS). Its
    applicationId is `com.daylightcomputer.readerexperiment`, with no dot, unlike other `-PidSuffix` twins
    (`com.daylightcomputer.reader.<suffix>`). R1 first confirms it on Rooted 2 (`pm list packages |
    grep daylightcomputer`), and then every allow-list (5.3.4) and `<queries>` entry names exactly that id, with no
    suffix pattern.
  - Never on JP4R03005; never merged or shipped without the user (0.6).
- **Why its own inbox.** Side-by-side builds keep no implicit intent filter (`app/src/sideBySide/AndroidManifest.xml`,
  checked by `checkIntentClaims<Variant>`). So the Lab Reader cannot be reached by `SAVE_PAGE` or `ACTION_SEND` the way
  the main Reader is, which is also why today's Inbox never hands to it. It receives through its own built-in inbox
  (READER-INTEGRATION), with no activity hand-off.
- **Labs switches.** Everything sits behind a new group in `settings/features/LabsSwitches.kt`:
  `object ShareLabs : FeatureGroup("labs.share", Labs, R.string.labs_group_share, "LAB-SHARE")`, with these keys:

  | Key | Purpose | Part |
  |---|---|---|
  | `labs.shareInbox` | Receive from your phone and computer | R1 |
  | `labs.shareInstant` | Instant while the Reader is open | R1 |
  | `labs.shareMarks` | Send highlights and notes back | R2 |
  | `labs.shareQueue` | Show my reading queue on my phone | R3 |
  | `labs.shareReading` | Send reading progress | R4 |

  - A build flag `SHARE_LABS_DEFAULT_ON` (a `buildConfigField`, true only for the lab copy's build) puts
    `shareInstant`, `shareMarks` and `shareQueue` in `FeatureRegistry.labsOnByDefault`.
  - `shareInbox` starts off, because turning it on needs the handover (5.3.4).
  - `shareReading` stays off: it is personal and opt-in.
  - `FeatureRegistryTest`'s rules are kept.
- **share-core.** Vendored as `third_party/share-core`: a copy of `reader-experiment/android/share-core` at v1.1 with
  Lab (K0; K3 is not needed), plus `VERSION`, `PATCHES.md` and `tools/share/sync-core.sh`, the same pattern as
  `third_party/showme-client`. `settings.gradle.kts` gets `include(":share-core")` and its `projectDir`.

### 5.2 R0 · Fix the ImportActivity race (needed by every path, the main Reader included)

- **Problem** (DEVICE-CHECKS round 2).
  - `ImportActivity` (singleTask) collects `vm.navigation` only while RESUMED.
  - `ImportViewModel._nav` is a buffered `Channel`.
  - A pending `ImportNav.OpenReader` for document 1 is delivered after a new share has arrived through
    `onNewIntent`. It reopens document 1 and `finish()`es, which drops the new file.
- **Change.**
  1. `ImportViewModel` keeps a `generation: Int`. `enqueue()` increments it whenever it adds sources after a terminal
     navigation was sent for an earlier generation. Every `ImportNav` carries `gen`.
  2. `ImportActivity` ignores navigation whose `gen` is below `vm.generation`.
  3. `finish(index, outcome)` sends `OpenReader` only while `_state.value.total` is still 1 for the current
     generation. Once a second share has joined the batch, the batch ends through `afterItem()` with
     `ToLibrary(added, notOpened, lastWorkId)` instead.
- **Tests.**
  - JVM `ImportViewModelGenerationTest`: the generation logic and nav filtering.
  - Robolectric `ImportActivityRaceTest`:
    1. Start with share A (fake stager and `ImportWork`); A finishes while the activity is paused, so its nav is
       pending.
    2. Deliver share B through `onNewIntent`, then resume.
    3. Assert: `ImportWork` was enqueued for B; no `ReaderActivity` was started for A; the final nav is
       `ToLibrary(2)`.
  - Device: three PDFs sent 2 s apart through today's Daylight Share to the main Reader on the emulator (the
    `inbox-e2e.sh` pattern) all import; `ShellReceiver count` grows by 3.
- **Acceptance:** the "PDF handed off but never imported" case of DEVICE-CHECKS no longer happens in 10 runs on
  Rooted 2 (lab copy), nor on the emulator (snapshot build). Whether the Reader session is asked to bring it to the
  main app, for every DC-1 owner, is 6.5 Q8.

### 5.3 R1 · Built-in inbox with quiet import and "In your Reader" confirmation

Package `com.daylightcomputer.reader.labs.share`:

| Class | What it does |
|---|---|
| `ShareInbox` | The coordinator, scoped to `AppContainer`. It holds the pairing (from the handover, or its own new one); a share-core `Receiver` (`FileReceiverStore` at `files/share-inbox/receiver-<topic>.json`, `Reassembler` spooling to `files/share-inbox/spool`, `RelayClient` with user agent `DaylightReaderLab/<versionName>`); and a share-core `LabInbox` (`files/share-inbox/lab.json`). Its `accept()` stores durably and returns (store before ack, PROTOCOL 3.4): content to `files/share-inbox/items/<id>/` and a row in `files/share-inbox/items.json` with state `stored`. The ack means "On your Daylight". |
| `ShareInboxWorker` | Unique periodic WorkManager work "share-inbox", every 15 min, `CONNECTED`: `pollOnce`, then process stored items, then `LabInbox.flush()`. |
| `ShareProcessor` | Turns stored items into library documents with **no activity**:<br>• `url` and `page`: `ReadLaterCenter.saver(c).save(SavedItem(url, title, source = SavedItem.VIA_REMOTE), html)` in process (the same caps as `SAVE_PAGE`: 4 KB URL, 8 MiB HTML).<br>• `file`: the new `ImportStager.stageFile(file, name, mime, sha256)` (moves the reassembled, already verified file into staging; `Sniffer` decides the format from the bytes), then the in-process import port, `ImportPipeline(c).run(staged)` (or `ReadLaterPorts.import(staged)`, whichever the live code has), which returns an `ImportOutcome`, as `ReadLaterSaver` and `PerfDocs` already use it. This is simpler than enqueuing `ImportWork` and watching its `WorkInfo`, and it starts no activity. |
| `ShareLive` | While `ProcessLifecycleOwner` is STARTED and `labs.shareInstant` is on: the ntfy JSON stream, handled like a poll. No foreground service, no "Display over other apps". |
| `ShareStates` | Maps outcomes to Lab states (2.2.3) and records them in `LabInbox`. |
| `ShareInboxProvider` | Exported; authority `<applicationId>.shareinbox`. `call("receiving")` → `{receiving: Boolean}`, answered only to the package `com.daylight.share`. On Android 11 and later, package visibility needs declarations on both sides: the Reader's manifest has `<queries><package android:name="com.daylight.share"/></queries>`, so it can call `HandoverProvider`, and K6 gives Daylight Share the matching entry for the Lab Reader. |
| `ShareInboxSettings` | The rows of the `ShareLabs` group and the receive screen (5.3.5). |

**5.3.1 Changes in existing Reader code:**

- `importing/readlater/ReadLaterModel.kt`: `SavedItem.VIA_REMOTE = "remote"`, added to `DIRECT`. It is governed by
  `labs.shareInbox`, not by `readLater.fromBrowser`.
- `importing/ImportStager.kt`: `stageFile`, as above.
- `ReadLaterUpkeep.onLibraryShown`: calls `ShareInbox.pollSoon()` (at most once every 2 minutes).
- `library/LibraryEvents.kt`: a quiet line when the library is next shown, "Arrived from {from}: {title}" or
  "{n} arrived from your devices", in the style of `ReadLaterLines.queueDone`. No toast while reading.
- `documents.meta_json` gets `"dls": {"item": "<id>", "from": "<from>", "app": "<app>"}`, through `stageArticle`'s
  `extraMeta` for articles and the import request's meta for files. `ArticleLabel` shows "from {from}".
- `shell/ShellReceiver.kt`: a new `share-state` command prints `receiving`, the pairing fingerprint (never the code),
  the last poll, and counts by state.
- `settings/features/LabsSwitches.kt` and `FeatureRegistry.kt`: the `ShareLabs` group (5.1).

**5.3.2 States and capabilities.**

- Hello caps: `st`, `reader-link`, `reader-doc`, `quiet`, and later `marks` and `queue`.
- Mapping:

  | Outcome | State |
  |---|---|
  | `SaveResult.Saved`, `Duplicate`, `KeptLink` | `reader` |
  | `SaveResult.Queued` | `queued` |
  | `SaveResult.Refused`, `Problem` | `failed` |
  | Import `ImportOutcome.Opened`, `AlreadyOnShelf` | `reader` |
  | Import `Failed`, `Unsupported`, `Cancelled` | `failed` |

- The Lab Reader never reports `waiting`: nothing waits for a tap.

**5.3.3 Untrusted input** (CONTRACTS 0.13): share-core's `checkItemHeader`; the URL rule; clamped strings; safe file
names; size and SHA-256 checked before staging; the bounded inflate.

**5.3.4 Handover from Daylight Share (one receiver per pairing).** This is companion work, task K6 in `android/app`,
Inbox role.

1. In Daylight Share › Settings › Lab, **Let Daylight Reader (lab) receive** arms a 2-minute grant and shows: "Open
   Daylight Reader (lab) › Settings › Labs › Send to Daylight and choose Take over."
2. Its exported `HandoverProvider` (authority `com.daylight.share.handover`) answers `call("pairing")` with
   `{code, relay, name}`. It does so only while armed, and only to the calling package (`getCallingPackage()`) named
   in its allow-list: the Lab Reader's applicationId as confirmed on Rooted 2 (5.1), and nothing else.
3. Daylight Share then sets `receivingElsewhere = <package>`. It stops polling the pairing lane, the live
   connection and Instant delivery, sends a `lab: 0` hello, and shows: "Daylight Reader (lab) receives for this
   Daylight now." with **Receive here again**. The server lane (S0) stays with Daylight Share until the Lab Reader's
   hello carries the cap `server` (4.2).
4. Before each would-be poll, Daylight Share asks the Reader's `ShareInboxProvider.call("receiving")`, which its
   `<queries>` entry (K6) makes visible. It resumes by itself only when the Reader answers false, or when
   `PackageManager` confirms the package is no longer installed. A provider it cannot reach while the package is
   installed is **not** a reason to resume, because two receivers would then both take every item. Daylight Share
   keeps waiting and shows "Can’t reach Daylight Reader (lab) right now." **Receive here again** is offered only when
   the Reader says false.
5. Without Daylight Share installed, the Lab Reader can make its own pairing (QR code and typed code), as
   READER-INTEGRATION describes. So R1 needs only K0 and R0; K6 is an add-on.

During a handover both apps publish on the ack topic. Senders keep one ledger entry per publisher (2.2.6), so
neither overwrites the other's caps.

**5.3.5 UI** (Settings › Labs › Send to Daylight):

- the switch "Receive from your phone and computer";
- the privacy line from READER-INTEGRATION;
- the status: "Last checked {rel}";
- **Take over from Daylight Share**, shown when it is installed;
- "This Daylight’s code" (QR and typed code), only for a pairing the Reader made;
- **Reset pairing**;
- Advanced: the relay.

**Acceptance R1** (Rooted 2 with the Mac mini; senders are the Mac app and `daylight-send` on the Mac):

- [ ] **R1.1** After the handover, with the lab copy in front (so `ShareLive` is connected),
  `daylight-send --wait-for reader --json` exits 0 within 2 minutes for a link, a page and a 3 MB PDF. With the lab
  copy in the background, it exits 0 within 20 minutes (the 15-minute worker). The lab copy's `ShellReceiver count`
  grows by 3 each time.
- [ ] **R1.2** Quiet: the resumed activity (`dumpsys activity activities | grep -m1 ResumedActivity`) is the same
  before and after every item. While a PDF is open in the lab copy, an arriving PDF does not change the page shown.
- [ ] **R1.3** The iPhone and Mac Lab apps show "In your Reader ✓" for all three, the PDF included (`reader-doc`).
- [ ] **R1.4** Daylight Share shows the handed-over line and polls nothing for 20 minutes
  (`logcat -s DaylightShare`). Turning off the Reader's switch makes Daylight Share resume at its next poll.
- [ ] **R1.5** Re-sending an item with the same id adds no second document. A link sent while the Daylight is offline
  shows "In your Reader’s queue".
- [ ] **R1.6** A malformed item (a bad header, or a SHA-256 that does not match) adds nothing and acks nothing.

**JVM and Robolectric tests** (Reader repository):

- `:share-core:test` (the vectors run in the Reader's build too);
- `ShareInboxTest`: an in-JVM fake relay, poll → stored → ack → processed → states; restart while an item is stored
  but not yet processed;
- `ShareProcessorTest`: fake `ReadLaterPorts` and a fake in-process import port; each `SaveResult` and
  `ImportOutcome` → its state;
- `QuietImportTest` (Robolectric): after a link, a page and a file are processed,
  `shadowOf(app).nextStartedActivity == null`;
- `HandoverTest` (Robolectric, with a fake provider on each side; in the companion repo, K6). It includes a provider
  that is invisible while the package is installed: Daylight Share must not resume while the Reader is receiving.

### 5.4 R2 · Highlights and notes back to phones (F05; needs W2's L2 and the senders' "From your Daylight")

- **Triggers.** `MarksOutbound` runs when a document closes (`ReaderActivity.onStop`) or the screen turns off,
  debounced 60 s, and sends at most 6 batches a day (2.2.7). Changes past that wait and go together in the next
  batch.
- **Scope** (setting): "Documents sent from my devices" (default: those with `meta_json.dls`) or "All documents".
- **What it collects.** Highlights (`highlights`), typed notes (`notes.text_md`) and handwritten notes (sent as the
  placeholder "Handwritten note, page {n}") whose `updated_at` is later than the document's cursor
  (`files/share-inbox/marks.json`).
- **Format.** A return-lane item (2.4): `kind: "file"`, `name` = "{title} - notes.json",
  `mime: application/vnd.daylight.marks+json`, `x-rk: "marks"`. Batches over 2 MB are split. Body:

  ```json
  {"v":1,"kind":"marks","doc":{"item":"<dls item id|null>","id":"<document id>","title":"…","url":"…|null","sha256":"<source_sha256>"},
   "marks":[{"id":"<highlight or note id>","type":"highlight|note","text":"<selected_text>","before":"…","after":"…",
             "note":"<text_md|null>","page":12,"style":"band|underline","created":"…","updated":"…","deleted":"…|null"}]}
  ```

- **Cursor.** It advances only after the Sender reports `sent`. Re-sends and acks are as usual.
- **No deep link.** Side-by-side builds may not claim `daylightreader://`, so phones show the page number instead.
- **Phones (W2 work, in the sender tasks).** Merge by mark id: the later `updated` wins, and `deleted` is a tombstone.
  Deletes are never inferred from a missing mark. Marks are listed per document under "From your Daylight › Notes",
  with Markdown export.
- **Acceptance R2:**
  - [ ] **R2.1** On a PDF sent from the iPhone: two highlights and a typed note, then close the document. Within 2
    minutes the iPhone shows the three marks under that document.
  - [ ] **R2.2** Deleting a highlight removes it on the phone after the next batch. Nothing is duplicated after
    re-sends.
  - [ ] **R2.3** JVM `MarksOutboundTest`: batches from a fake store, ordered by page then position; tombstones; the
    cursor advances only after `sent`; the 60 s debounce. The JS return-lane reader parses the batch:
    `daylight-send return --dump`, added in L2.

### 5.5 R3 · The tablet's queue on phones (read-only; F20 view, F21 commands later)

- **What it lists.** `QueueManifest` builds the Reader's reading queue, at most 200 items:
  - `article_queue` rows (`queue_state`, `queue_order`, `done_at`);
  - `read_later_queue` (links waiting to download);
  - documents with `meta_json.dls` from the last 30 days.
- **When.** Only when the manifest's content hash changed: debounced 60 s after a change, at most once an hour, and
  checked when the library is shown. A new manifest drops every un-acked older one from the return outbox (2.4), so
  at most about 8 go out on a busy day (2.2.7).
- **Format.** A return item with `x-rk: "queue"`, `mime: application/vnd.daylight.queue+json`, replace semantics
  (phones keep the newest `sent`). Body:

  ```json
  {"v":1,"kind":"queue","at":"…","items":[{"doc":"<id>","item":"<dls id|null>","title":"…","type":"article|pdf|epub|other",
   "state":"next|later|done|archived|downloading","progress":0.42,"added":"…","from":"iPhone|null"}]}
  ```

- **Phones (W3 F20 view).** "On your Daylight" lists it, read-only, with "Updated {rel}". Commands (F21) come later,
  over the control lane.
- **Acceptance R3:**
  - [ ] **R3.1** Reordering or marking an article done on the tablet updates the iPhone's list within 15 minutes, or
    within 2 minutes while the Reader is open.
  - [ ] **R3.2** JVM `QueueManifestTest`: the order, the 200 cap, the states, and no personal text beyond titles.

### 5.6 R4 · Reading progress (F18; optional, off by default)

- `ReadingOutbound` sends "opened", progress at close (`reading_positions.progress`) and "finished"
  (`documents.finished`), for documents with `meta_json.dls`. It uses `x-rk: "reading"` and is throttled to one batch
  an hour, sent only when something changed, and at most 6 batches a day (2.2.7).
- Phones extend the F01 line: "Opened Tue · 62% read · Finished".
- **Acceptance:** with the switch off nothing is sent (a relay-log check); with it on, the iPhone shows the progress
  within an hour of closing the document.

### 5.7 Order of the Reader work

| Task | After | Notes |
|---|---|---|
| R0 | now | Independent of every companion task |
| R1 | K0 (share-core with Lab and header extras) and R0 | K6 (handover) is an add-on: without it the Lab Reader pairs itself (5.3.4 step 5). K3 is not needed. |
| R2 | L2 and the senders' W2 "From your Daylight" | |
| R3 | L2; the phones' read-only list comes with W3's F20 | |
| R4 | R2 | |

Every R task ends with a device round on Rooted 2, written into DEVICE-CHECKS.md.

---

## 6. Build schedule

### 6.1 Lanes: who owns which folder

| Lane | Folders a task may edit | Tasks |
|---|---|---|
| share | `share/` (with `share/js/capture/`) | L0, L1, L2 |
| kit | `apple/DaylightShareKit/` (both modules) and `apple/Shared/`, which both the iOS and the macOS targets compile (`project.yml`: `GetPage.js` and `Shared/SafariExtension`) | P0-kit, A0, A3, W2-kit |
| ios | `apple/iOS/`, the iOS blocks of `apple/project.yml` | P0-ios, A1, A4 |
| mac | `apple/macOS/`, the macOS blocks of `apple/project.yml` | P0-mac, A2, A5 |
| core | `android/share-core/` | P0-core, K0, K3 |
| android-app | `android/app/` | P0-app, K1, K4, K5, K6 |
| ext | `extension/` | P0-ext, X0, X1 |
| web | `web/` (its tests live in `extension/test/*web*`; that is its only edit there) | P0-web, B0, B1 |
| win | `windows/` | P0-win, WIN0, WIN1 |
| e2e | `e2e/` | E0, E1 |
| server | `server/` | SV0 (W0), the Wave S server changes (4.2) |
| reader | the Reader repository on the Mac mini | R0–R4 |

**CI files.** Several lanes share a workflow file, so jobs are blocks. Each job carries a `# lane: <name>` comment;
a lane edits only its own blocks and appends new ones. The shared parts of each file (triggers, `env`, permissions,
the release step) have one owner:

| File | Job blocks | Owner of the shared parts |
|---|---|---|
| `rx-apple.yml` | kit: `swift test` and `sync.mjs --check` on `GetPage.js` · ios: iPhone builds, XCUITests, the .ipa · mac: Mac builds, the smoke test, the zip | kit |
| `rx-android.yml` | core: `:share-core:test` · android-app: app tests, the APKs | core |
| `rx-extension.yml` | ext: build, tests, zips, `sync.mjs --check` · web: the web build, web tests, the Pages deploy | ext |
| `rx-share.yml`, `rx-windows.yml`, `rx-e2e.yml`, `rx-server.yml` | one lane each: share, win, e2e, server | that lane |

### 6.2 Order

```
Stage A (now, in parallel):  P0 close-outs: P0-core · P0-kit · P0-ios · P0-mac · P0-app · P0-ext · P0-web · P0-win
                             (v1.1 findings closed, CI green, the F27 baseline with Comfort, Lab-off baselines)
                             · L0 · SV0 · R0
Stage B (after L0):          A0 (after P0-kit, SV0) · K0 (after P0-core, SV0) · X0 (after P0-ext)
                             · WIN0 (after P0-win) · L1
Stage C (W0 apps):           A1 (after A0, P0-ios) + A2 (after A0, P0-mac), first in line · K1 (after K0, P0-app)
                             · B0 (after X0, P0-web) · E0 (after K1)
        → device round W0 on Rooted 2: iPhone + Mac + Lab Inbox (F17.4, F00.1, F00.7), and usability pass 1
        → publish the iPhone and Mac W0 builds; only then publish the extension, web and Windows W0 builds
Stage D (W1 ports):          A3 (after A0, L1) · K3 (after K0, L1)
Stage E (W1 apps):           A4 + A5 (after A3; first in line) · X1 (after X0, L1) · K4 + K5 (after K3, K1)
                             · B1 (after B0, X1) · WIN1 (after WIN0, L1) · E1 (after K5)
                             · K6 handover (after K1) · R1 (after K0, R0; with K6 when it exists)
                             · F11's share-sheet paths in A4, A5 and K4: last, after 6.5 Q1
        → device round W1 on Rooted 2 (every F01–F34 device item; R1.1–R1.6), and usability pass 2
Stage F (W2, Wave S):        L2 first; then F06 and F13 (iPhone, Mac and Inbox first); then 4.1 in its order.
                             Wave S once the Worker is deployed: S0, then F02 (iPhone + Mac first), F37, F19, F36
Stage G (W3), then W4:       as in section 4; R2 after L2 + the senders' F06; R3 with F20
```

- **Priority when agents are scarce.** Start tasks in the user's order: iPhone → Mac → Chrome and Safari → Android
  phone → web → DC-1 Inbox → Windows.
- **Releases follow the priority.** CI publishes every iPhone and Mac build. The extension, web and Windows Lab
  builds are built and tested as soon as their cards allow, but they reach the release only after the iPhone and Mac
  builds of the same wave. Otherwise Windows, which depends only on L0, would ship Lab first.
- **Pulled forward.** Two Inbox pieces jump the queue because the iPhone and Mac need them on real devices: K1's
  hello and states (W0), and S0 (the server lane, Wave S).
- **What must not wait.** No task waits for a lane it does not depend on.

### 6.3 Shared files and merge order

- **`apple/project.yml`.** A1 and A4 add only iOS targets, A2 and A5 only macOS targets, each in its own block.
  Whoever merges second rebases; the iPhone usually merges first.
- **`apple/Shared`.** The kit lane owns it (6.1), because both platforms compile it. A change there must keep both
  the iPhone's and the Mac's Lab-off parity. A4 and A5 ask A3 for changes; they never edit it.
- **`android/app`, shared by K4 (sender), K5 (Inbox) and K6 (handover).** Each adds only, in its own blocks:
  - `App.kt`: `Prefs` fields, grouped under a `// Lab: <task>` comment;
  - `AndroidManifest.xml`: new components, and K6's `<queries>` entry;
  - `res/values/strings.xml`: one block per task;
  - `ui/SettingsScreen.kt`: rows inside `LabCard` only.

  K4's workers live in `sender/`, and `Work.kt` belongs to K5. K4 merges before K5. Rebasing on these files must not
  change another task's lines.
- **Capture code.** `share/js/capture/` (`clean-html.js`, Readability 0.6.0) is the one source. Each consumer keeps a
  copy:
  - the extension's build copies the files;
  - `GetPage.js` inlines them between markers (`// BEGIN clean-html` … `// END clean-html`, and the same for
    Readability).

  `node share/js/capture/sync.mjs --check <file>` (or `--write`) compares a copy with the source. `rx-extension.yml`
  and `rx-apple.yml` run `--check` on their own copies. When L changes the source, each consumer lane re-syncs its
  own copy; no lane edits another's.
- **`extension/src/logic.js`** is shared with the web build. X tasks own it. B tasks never edit it; they ask the
  matching X task.
- **Vectors.** Only L tasks edit `share/vectors/*`, and only the server lane edits `server/vectors/*`. A port that
  finds a vector bug files it to the owning lane; it never edits the vector.
- **Copy.** `LAB_TEXT` in `daylight-lab.js` is the source. A new string is added there first (L lane), then ported.

### 6.4 Device rounds and usability passes

After W0 and after W1, and after R1, R2 and R3, the Mac mini session runs the device items of that wave on Rooted 2
with the real ntfy.sh relay:

- iPhone and Mac first, then Android, Chrome, web and Windows (as available);
- the realistic conditions of F01.1: the Inbox in front; in the background with the Reader in front, with "Display
  over other apps" on and off; the screen off with Instant delivery;
- the results, with times, go into DEVICE-CHECKS.md;
- the tablet's library goes back to its recorded baseline afterwards, as in rounds 1 and 2.

**Usability pass (W0 and W1 rounds).** The user does five short tasks on the iPhone and the Mac, unaided. The session
notes the time taken and any wrong turn in DEVICE-CHECKS.md:

1. Find Lab, turn it off, and turn it on again.
2. Tell whether a PDF just sent has reached the Reader.
3. Recover a failed send (the relay forced to answer 413).
4. Find out what the Daylight server is for, and whether it is needed.
5. Send a copied link.

The copy review of ground rule 1 follows the W0 pass.

### 6.5 Decisions for the user

Only Q1 holds anything back: F11's share-sheet paths. Nothing else blocks W0 or W1.

1. **Excerpts before the Lab Reader (blocks F11's share-sheet paths in A4, A5 and K4).** With Documents = Ask, every
   excerpt raises a card or a notice over the Reader and waits for a tap. Choose one:
   - (a) excerpts are documents now, with a one-time "Excerpts wait for a tap on your Daylight for now." and
     grouped notices;
   - (b) only explicit selections (the context menu, Selection mode, a Safari selection, "Send as excerpt") until
     R1's quiet import;
   - (c) no sender excerpts until R1, except the Chrome and Safari context menu and Selection mode.

   Until the user answers, only what all three have in common is built: X1's explicit paths and the libraries'
   excerpt builders (F11).
2. **The Lab Reader's handover.** The Lab Reader takes receiving over from Daylight Share on the lab tablet (5.3.4).
   Alternatively, both could run, with Daylight Share delivering to the main Reader and the Lab Reader to its own
   library (duplicates in two libraries). The plan assumes the handover.
3. **Send back targets (F06, W2).** Every known device (2.4), or the tablet asks which one (FEATURES §6 Q3).
4. **Wave S order.** S0 first (DESIGN 3.1), so that v1 delivery stays an exception. Then F02, big files, as the
   DC-1 owner's first "finally", then F37, F19 and F36.
5. **Per-feature "Use" switches.** The rule is one Lab switch per app. Should What's in Lab rows for features that
   change how sharing behaves (F04, F16, F33, F03's hint) also get a "Use" switch, on by default, so that one
   annoyance does not mean turning off all of Lab? W1 builds only the feature settings "Always show Options before
   sending" and the two notification settings.
6. **Sign the Mac release.** A Developer ID (or team) signature gives the Mac app its App Group. Share › Daylight then
   shares the app's pairing, Lab switch and history, and F04 closes in a second. This needs an Apple Developer
   account and its certificate as repository secrets. Until then the Mac's acceptance runs on the ad-hoc build, and
   What's in Lab says what it lacks.
7. **Daylight Share with Lab on JP4R03005.** The plan reads "Never on JP4R03005" (LAB-DECISIONS) as covering the
   Lab Reader and anything an agent installs. You may install Daylight Share, with Lab on by default, on any DC-1
   yourself (0.6). Is that right, or should Lab stay on the lab tablet only for now?
8. **Small requests to the main Reader.** The biggest tablet-side pains for every DC-1 owner can only be fixed in the
   Reader itself:
   - a PDF opening over what you are reading;
   - the card over the Reader, and the "Display over other apps" permission it needs;
   - a PDF silently dropped by the ImportActivity race.

   Should the Reader session be asked for:
   - (a) R0's race fix;
   - (b) a quiet import entry point for documents that answers with the outcome (the `reader-doc` and `quiet`
     equivalents: import without opening, and report back);
   - (c) keeping the Daylight Share item id with what it saves (for F18)?

   The Lab Reader work proves each one on Rooted 2 first.

---

## 7. Critique log

Revision 2 answers two reviews of revision 1: a product review (21 points) and an engineering review (20 points).
Every point was accepted. Where a review offered alternatives, or a point needed something beyond this file, the
last column says what was chosen and why, in one line.

### 7.1 Product review

| # | Point (section, severity) | Decision | What changed, or why not as suggested |
|---|---|---|---|
| P1 | 12-word excerpt rule (F11, F16; must-fix) | Accepted | `classifyShare` makes an excerpt only for a selection, a text fragment, text with no URL, or ≥ 40 words / 3 sentences that aren't the title; headline + link vectors (F11, F16, 2.8). |
| P2 | Share in place hides late failures (F04, F01; must-fix) | Accepted | Opt-out failure notification on iPhone, Mac and Android; optional "In your Reader ✓" notice; F04.6 forces a 413 after close. |
| P3 | Weak first run with Lab on (1.4, 1.6, W0; must-fix) | Accepted | Short states, one server group, sentences only on tap, F00.7. The one-time note is held instead of the release, so W0 builds still reach testers. |
| P4 | `needs-server` too long (1.6; should-fix) | Accepted | The user's short sentence under controls, with Copy Server code; the long texts and secret names live in the Daylight server section (1.6, 2.6). |
| P5 | `needs-reader-lab` dead end (1.6, F17; should-fix) | Accepted | State removed from W0/W1; the Reader step is not interactive; the `handed` sentence explains itself (2.5). |
| P6 | "Never on JP4R03005" scope (0.6; should-fix) | Accepted | 0.6 limits the rule to the Lab Reader and agent installs; 6.5 Q7 asks the user to confirm. |
| P7 | W0/W1 miss the "finally" list (3.1, 4.1; should-fix) | Accepted | W2 ordered with F06 and F13 first; the F02 entry point in W1; 3.1 explains the order. FEATURES.md is outside this file, so 3.1 records its F06 correction and hands it to the research lane. |
| P8 | Mac-first ships the ad-hoc path (3.1, F04; should-fix) | Accepted | Mac acceptance runs on the ad-hoc build, with its own Share-menu Lab switch and a line on what it lacks. F23's Print menu entry and F29's menu-bar drop join Mac W1. F33 reuses the existing command. A signed release is 6.5 Q6, not a precondition, because it needs the user's Apple account. |
| P9 | Excerpts interrupt the tablet (F11, 6.5 Q1; should-fix) | Accepted | Q1 must be answered before A4, A5 and K4 build F11's share-sheet paths; until then only explicit paths; one-time send line and grouped notices. |
| P10 | Hold vs Later (F15; should-fix) | Accepted | Two actions: Add to Reader and Keep for later (`held`); a swipe also records `held`; `held` ranks above `waiting`. |
| P11 | Dense timeline rows (2.5; should-fix) | Accepted | Three steps in the user's words, no "Relay" or "→"; sentence and step line only on the newest and unfinished rows; no step count in the label; new F01 sentence. |
| P12 | Comfort lost with Lab off; timed send (F27, F04; should-fix) | Accepted | Comfort moves to the baseline. Options shows without a countdown under Comfort, a screen reader, switch access or a setting; that removes the timer rather than stretching it to 5 s. |
| P13 | One switch for many behaviours (1.1; should-fix) | Accepted in part | "Always show Options before sending" added. Per-row "Use" switches go to the user (6.5 Q5), because they may bend the one-switch rule. |
| P14 | Unmeasurable checks (3.2–3.3; should-fix) | Accepted | F04.1, F09.2, F15.1, F27.4, F10.4 and F01.4 rewritten; real-world conditions in F01.1, F26.1 and 6.4; a five-task usability pass at W0 and W1. |
| P15 | No ask for main-Reader fixes (6.5; should-fix) | Accepted | 6.5 Q8 lists R0, a quiet reporting import and keeping the item id. |
| P16 | `needs-inbox` vs `needs-lab-inbox` (1.6; nit) | Accepted | Both texts replaced as suggested; S0 brings DESIGN 14.1 in line. |
| P17 | Link-only hint fires everywhere (F03; nit) | Accepted | Once per device on Android and iPhone, then in Setup check; the Android text no longer points to Safari. |
| P18 | "Turn on" and blind paste (F09, F33; nit) | Accepted | "Open setting" button; every clipboard button shows the host before Send. The hotkeys still send at once, as today, and their notice names the host. |
| P19 | Copy inconsistencies (nit) | Accepted | One F04 card string; Comfort footer; "Optional · …" server row; "Sender sees" in details; test-article line; "final for W0/W1". |
| P20 | Always-visible Send-as control (F10; nit) | Accepted | "Send as: Page ▾", switching to Selection by itself. |
| P21 | Windows ships first; iOS 16 untested (6.2, F04.1; nit) | Accepted | Extension, web and Windows releases wait for the iPhone and Mac; iOS 16 added to F04.1. |
| — | Verdict: Lab-on first run and the DC-1 "finally" gap | Accepted | P3 and P7 above. |

### 7.2 Engineering review

| # | Point (section, severity) | Decision | What changed, or why not as suggested |
|---|---|---|---|
| E1 | No household message budget (2.2.4, 2.8; must-fix) | Accepted | 2.2.7 budget (≤ 144 of 150 a day); Lab frames give way, are spaced 30 s and capped; soak in both modes behind one address. The cap is 30, not 40, to stay under 150. |
| E2 | `x-cap`/`x-orig` dropped by the validators (2.3; must-fix) | Accepted | `extras` from `checkItemHeader`/`ItemHeader.check` in L0, K0 (A0 for parity), carried to `InboxItem` (K5); `labHeaderExtras` vectors. |
| E3 | Ambiguous parse rules (2.2.5; must-fix) | Accepted | Exact algorithm with vectors. Integers are judged by value (1.0 = 1), since no JSON parser here keeps the source form. |
| E4 | Ledger assumes one Inbox (2.2.6; should-fix) | Accepted | Entries per publisher, ties at ≥, 36 h staleness plus 48 h of `lab: 0` repeats, `poll` clamped; vectors for ties and handover. |
| E5 | Server presence vs Lab frames (4.2, 2.6; should-fix) | Accepted | S0's hello is `buildInboxInfo`; `lab: 0` ends presence on the server lane; the server lane stays with Daylight Share after a handover; server tests in SV0 and S0. |
| E6 | 5 s not enforced; private cache key (2.6, 2.7.2; should-fix) | Accepted | `labGate`'s own deadline; `noteError` added by the new SV0 card; `serverState` and `labGate` vectors; `server/pendingMove` in DESIGN 13.1. |
| E7 | `flushNetwork` limits (2.7.1, F07; should-fix) | Accepted | Caps on frames and attachment bytes, v1.1's pass rules, 3-minute spacing; F07.3 with 70 links and 10 × 9 MB. |
| E8 | One-pass `BackgroundPublisher` impossible (F04; should-fix) | Accepted | Two passes; `isDiscretionary = false`; re-send timed from the first part, at once past 170 min; test for parts 3 h apart. |
| E9 | Lanes less independent than claimed (6.1, 6.3; should-fix) | Accepted | Capture code moves to `share/js/capture` with `sync.mjs`; the kit lane owns `apple/Shared`; CI job blocks with owners; K4's workers in `sender/`. |
| E10 | P0 ports without tasks (0.2, 6.2; should-fix) | Accepted | The ports are on the branch now; P0 close-out cards per lane finish them, land the F27 baseline and record the Lab-off baselines. |
| E11 | `GetPage.js` cannot read Lab (F03, F10; should-fix) | Accepted | It returns v1.1's `html` plus `lab` extras and the native side chooses; size caps; F04.2 with an 8 MiB page; F03.5. |
| E12 | Server-lane states pollute the digest (2.2.4, K1; should-fix) | Accepted | Pairing-lane items only; `lane` tag; `LabReporterTest` case. |
| E13 | Return-lane semantics (2.4; should-fix) | Accepted | `x-dev`, delivery per device, a storage prefix per lane, manifests replaced and hourly on change; budget rows. |
| E14 | R1 dependencies, visibility, timing (5.3, 5.7; should-fix) | Accepted | R1 needs K0 + R0 only; `<queries>` on both sides and a safe resume rule; R1.1 timing; in-process import; the package id is confirmed and pinned. |
| E15 | Missing tests; brittle parity tools (2.8, 1.7; should-fix) | Accepted | A v1.0 peer, two-publisher and handover cases, server tests; `ariaSnapshot()` and an `XCUIElement` walk. |
| E16 | True worst-case size (2.2.1; nit) | Accepted | Lone surrogates pinned (2,572 / 2,608 / 3,480 with `app` 60); `flush()` halves a refused batch. |
| E17 | Long `x-orig` (2.3; nit) | Accepted | Left out over 1,024 characters or when it would make the frame large; vector. |
| E18 | State mapping gaps (2.2.3; nit) | Accepted | Unknown status → `handed`; `held` above `waiting`; `LabInbox.record` uses the merge rule; test. |
| E19 | F02 loose ends (2.6, 4.2; nit) | Accepted | `files.tick` reads acks through `onAckHeader`; hosted ids kept by prune; `app` clamped to 60 everywhere, the server's existing value. |
| E20 | CLI concurrency and re-sends (F09; nit) | Accepted | `O_EXCL` lock file and atomic renames; `tick()` on every run; documented. |
| — | Verdict: wire design sound; budget, extras, parsing, ledger, server integration, lanes, R1, tests | Accepted | E1–E20 above. |
