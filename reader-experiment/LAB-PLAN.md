# Lab plan: how to build the Lab version of Send to Daylight

*Written 2026-10-20 for the agents that build the Lab version. It turns `research/FEATURES.md` (69 features in waves)
and the user's rules in `LAB-DECISIONS.md` into work that independent agents can do without guessing. Other inputs:
`share/PROTOCOL.md` rev 1.1 and `share/CHANGES-v1.1.md`, `server/DESIGN.md` and `server/README.md`,
`DEVICE-CHECKS.md`, `READER-INTEGRATION.md`, the app READMEs and the Daylight Reader's public snapshot
(`a12k-a2b/daylight-reader` 0.27.843; the live Reader has moved on, so check every Reader class name before editing).*

**How to use it.** Sections 1 and 2 are binding for every task. Section 3 specifies Waves 0 and 1 feature by
feature. For each feature it gives the common rules, then the UI, behaviour, edge cases, acceptance checks (`[ ]`,
with IDs) and automated tests for each platform. Section 3.5 has one task card per folder: pick a card, read what it
cites, build it, and stop when its "Done when" list passes. Section 4 lists the later waves, section 5 the Reader-side
work, and section 6 the schedule.

---

## 0. Ground rules

1. **Copy is final.** Every user-visible string in this plan is the text to ship, written with ASCII apostrophes
   where a table needs them. Apps show ’ … · ✓ → (U+2019, U+2026, U+00B7, U+2713, U+2192) exactly as protocol v1.1
   does (CHANGES-v1.1 2.5). `{braces}` are template slots. The vectors (2.8) pin every string, so the apps cannot
   drift apart.
2. **Prerequisite P0: protocol v1.1 everywhere.** Today only the JS reference (`share/js`) and the Windows app (which
   copies it) are at v1.1. `android/share-core` still has 12 MiB chunks and 200-id acks, and `apple/DaylightShareKit`
   is also v1.0. The extension and the web sender still use `MAX_ENCODED` (64 MB). Their checklists are
   CHANGES-v1.1 §6.3–6.8. A Lab task in `android/`, `apple/`, `extension/` or `web/` builds on that folder's v1.1
   port. The same agent may do the port first, as its own commit and PR. Lab code calls the v1.1 row text (`describeRow`,
   `RowText.of`, `RowText(row:now:)`) and never re-implements it. The fixes under review from DEVICE-CHECKS (cb57057,
   0e90108, and the Inbox's `FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK` document hand-off workaround) are part
   of P0.
3. **Wire rule.** `v` stays `1`. Lab adds only `x-` header fields, ack-topic frames whose `ids` is empty, and new
   derived topics with their own AAD (2.1). Every v1.0 and v1.1 peer keeps working, and CI proves it (2.8).
4. **One task, one folder** (6.1). A task edits only the folders its card names. Shared files follow 6.3.
5. **Platform names.** *iPhone* (and *iPad*: the same app) = `apple/iOS` + `apple/Shared`. *Mac* = `apple/macOS`.
   *Chrome* and *Safari* = the extension in `extension/` (Safari's build ships inside the Apple apps). *Web* =
   `web/`. *Android phone* and *DC-1 Inbox* = `android/app` in its two roles. *Windows* = `windows/`. *JS reference* =
   `share/js`. *Lab Reader* = the side-by-side Reader copy on the lab tablet (section 5).
6. **Devices.** Lab builds of the Reader go only to the lab tablet "Rooted 2" (JP4R01422). Nothing is ever installed
   on JP4R03005. Nothing is merged into the main Reader or shipped without the user (LAB-DECISIONS).

---

## 1. The Lab switch

### 1.1 Where it lives

Each app has exactly one **Lab** switch, at the top of its settings. While Lab is on, the switch has three rows under
it: **What’s in Lab ›**, **Daylight server ›** and **Comfort**. With Lab off, only the switch shows.

| App | Place |
|---|---|
| iPhone, iPad | Settings sheet (`SettingsView`, `iOS/App/HomeView.swift`): a new first section "Lab". The share sheet item follows the app's switch through the App Group (1.2). |
| Mac | Settings window (`MacSettingsView`, `macOS/App/MacViews.swift`): a new first section "Lab". The Share menu item follows the app through the App Group. Ad-hoc builds have no App Group, so their Share menu item always behaves as Lab on. The menu bar item gets no Lab row. |
| Safari extension (Mac, iPhone) | Its popup › ⋯ settings, first row. It is its own app for this purpose: the extension code keeps its own storage. |
| Chrome extension | Popup › ⋯ settings, first row. "What’s in Lab" and "Daylight server" open the extension page `lab.html`. |
| Android phone | Settings screen (`ui/SettingsScreen.kt`, sender role): a top card "Lab". `ShareActivity` follows it. |
| DC-1 Inbox | The same settings screen in the Inbox role: a top card "Lab". "Daylight server" shows the server lane (Wave S). |
| Web sender | Settings panel, first row. |
| Windows | ⋯ › Settings, first row. |

### 1.2 Default and persistence

| Platform | Keys | Store |
|---|---|---|
| iPhone, iPad, Mac | `dls.lab`, `dls.labNoteShown`, `dls.comfort` (Bool), added to `SharedStore.Key` | `SharedStore` defaults: the App Group suite once it is resolved, else the process's own (`SharedStore.swift`) |
| Android (both roles) | `lab`, `labNoteShown`, `comfort` | `Prefs` (`App.kt`, SharedPreferences `daylight-share`) |
| Chrome, Safari | `lab`, `labNoteShown`, `comfort` fields of the existing `settings` object | `storage.local` |
| Web | the same fields of `settings` | IndexedDB `kv` (`web-storage.js`) |
| Windows | the same fields of `settings` | the app's JSON store (`bridge.js`) |

- **A missing key means on.** The first start of a build with Lab writes `lab = true` when the key is missing. It
  then shows the one-time note (1.6) until it is dismissed (`labNoteShown = true`). This applies to fresh installs and
  upgrades alike.
- The switch belongs to the app and the device. It is never synced and never in a pairing link. Pairing, unpairing,
  re-pairing and updates leave it as it is; an uninstall loses it, and a fresh install starts it on again.
- **One reading.** UI and background code read the flag through one accessor: `LabSettings.isOn` (Swift),
  `Prefs.lab` with a `StateFlow` (Kotlin), and `labOn(storage)` with `storage.onChanged` (JS). The Apple apps post
  `SharedStore.postChange()` when it changes, so the app and its extensions agree. While `SharedStore` is still
  resolving, the value is `true`, and views update once storage settles.

### 1.3 What turns off with it

With Lab off, every screen, string and flow is the last non-Lab build's. Neither the v1.1 fixes nor the F27
accessibility baseline are Lab features.

| Lab off does this | Lab off never does this |
|---|---|
| Hides every Lab control: rows, menu entries, the Options window, the timeline's step line and check-in header, the "Daylight server" section and "What’s in Lab" (the switch row stays). | Deletes the pairing, the outbox, history, the Lab ledger (2.2.6), the server pin and notices, or any Lab feature's own settings. They return when Lab is turned on. |
| Stops Lab background work. The Inbox sends one last hello with `lab: 0` (2.2.4), then no hellos and no state frames. Return-lane polling (W2) stops, connectivity-triggered sending (F07) falls back to v1.1 back-off, and the F08 shortcut is removed. | Changes sending. Items already queued keep their `x-` fields and go out as stored. |
| F09: URL-scheme `send` links, App Intents and the Android `SEND_URL` intent answer "Turn on Lab in {app} to use this." Pairing links still work. | Stops recording Lab frames read from the ack topic. The ledger keeps learning, invisibly, so turning Lab on shows correct states at once. |

### 1.4 What's in Lab

A list with one row per Lab feature this app has in this build. Each row has the name, one sentence and the state in
words: **Ready**, or the needs-setup sentence (1.5). Tapping a row opens the feature, or runs its gate. The list's
header line is the Inbox's Lab state: "Your Daylight: Lab on · checked in 4 min ago" (2.5), or the `needs-inbox`
sentence. Names and sentences, shared by every app:

| Feature | Name | Sentence | Apps |
|---|---|---|---|
| F01 | Delivery timeline | See each item reach the relay, your Daylight and the Reader. | all senders |
| F03 | Pages as you see them | Pages go as you see them, logged-in parts included, without scripts or form contents. | iPhone, Chrome, Safari |
| F04 | Share in place | Share › Daylight closes in a second; Options lets you choose how it goes. | iPhone, Mac, Android, Chrome, Safari |
| F07 | Works offline | Items shared offline wait here and go as soon as you’re back online. | all senders |
| F08 | Your Daylight in the share sheet | Your Daylight appears next to your contacts when you share. | Android |
| F09 | Shortcuts and automation | Send from Shortcuts, Siri, scripts and other apps. | iPhone, Mac, Android, Windows, web |
| F10 | Send as | Choose page, clean article, link or selection. | iPhone, Chrome, Safari |
| F11 | Send a selection | Send just the passage you selected, with its source. | iPhone, Mac, Android, Chrome, Safari |
| F15 | Arrival notices | See what arrived and from where, and act on it. | DC-1 Inbox |
| F16 | Clean links | Removes tracking from links and finds the real article. | all senders |
| F26 | Setup check | Checks your setup and sends a test article. | all apps |
| F27 | Comfort | Larger text and buttons, more contrast, no motion. | all apps |
| F33 | Send copied link | Send a link you copied with one tap. | all senders |
| F34 | More right-click choices | Send a page, clean article, link, selection or an image’s page from the right-click menu and shortcuts. | Chrome, Safari |
| F37 | Summaries with Claude | Short summaries and answers about what you send, using your Claude key. | iPhone, Mac, Chrome, Safari, web, Android |
| F19 | Email-in address | Forward newsletters and documents to your Daylight by email. | iPhone, Mac, Chrome, web, Android |
| F36 | Feeds and daily digest | Follow feeds; new articles arrive one by one or in a morning digest. | iPhone, Mac, Chrome, web, Android |
| F02 | Files over 9 MB | Big PDFs and books go through your Daylight server. | iPhone, Mac, Android, Chrome, web, Windows |

The four server features (F37, F19, F36, F02) are listed from Wave 0, as LAB-DECISIONS requires. Until a platform
builds one (Wave S, 4.2), its gate ends in the state `later` when the server is ready.

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
    permission), **Turn on** (a setting in this app), **Copy Server code** (`needs-server`) or **Allow** (site access
    in the extension).
- **Server states.** A cached status that is 10 minutes old or less answers at once. Otherwise the note first says
  "Checking your Daylight server…" for at most 5 s, then shows the state. A network failure gives `OFFLINE`.
- What's in Lab shows each feature's current state without a tap. It uses cached states and refreshes the server
  status when the list opens.

### 1.6 Copy

**Lab switch and note**

| Where | Text |
|---|---|
| Section title and switch | Lab |
| Switch footer | New features we’re trying out. Turn Lab off for the plain app; nothing you sent is lost. |
| One-time note (button **OK**) | Lab is on. New features to try are in Settings › Lab, where you can turn it off. |
| List title | What’s in Lab |
| A feature with nothing missing | Ready |
| Comfort switch, footer | Comfort · Larger text and buttons, more contrast, no motion. |
| Answer from an automation entry with Lab off | Turn on Lab in {app} to use this. |

`{app}` is "Send to Daylight" on Apple, the extension, the web sender and Windows, and "Daylight Share" on Android.

**Needs-setup states.** This extends the style of CHANGES-v1.1 2.5 and adds to DESIGN 14.1.

| State | Decided by | Message | Button |
|---|---|---|---|
| `needs-pairing` | app: not paired | Pair with your Daylight first: open Daylight Share on the Daylight and scan or type its code here. | — |
| `needs-inbox` | app: no fresh Lab hello carrying the feature's capability (2.2.6) | Needs Lab on your Daylight. Update Daylight Share on the Daylight and turn on Lab there. | — |
| `needs-reader-lab` | app: no `reader-doc` (or the feature's) capability | Needs the Lab copy of the Daylight Reader, which is only on the lab tablet for now. | — |
| `needs-notifications` | app: OS permission off | Needs notifications for {app}. Turn them on in {path}. | Open Settings |
| `needs-quick-sends` | app: setting off (F09) | Quick sends from other apps are off. Turn on “Allow quick sends from other apps” in Lab settings. | Turn on |
| `needs-site-access` | extension: host permission | Needs access to this site. Choose Allow when your browser asks. | Allow |
| `needs-server`, `pairing-mismatch`, `server-outdated`, `app-outdated`, `locked`, `needs-key`, `needs-domain`, `needs-r2`, `needs-lab-inbox`, `needs-paid`, `OFFLINE`, `error` | app or server (2.6) | Exactly `STATE_MESSAGES[state]` from `server/client/daylight-server.js` (DESIGN 14.1), or the server's own `message` for `error` | `needs-server`: Copy Server code |
| `later` | app: the server answers ready, this app lacks the feature yet | Your Daylight server is ready. {feature} comes to this app in a later Lab update. | — |

`{path}` for notifications:

| Platform | `{path}` |
|---|---|
| iPhone | Settings › Notifications › Send to Daylight |
| Mac | System Settings › Notifications › Send to Daylight |
| Android | Settings › Apps › Daylight Share › Notifications |
| Windows | Settings › System › Notifications › Send to Daylight |

`needs-inbox` and the server's `needs-lab-inbox` are different states. The first means Daylight Share on the DC-1
has no Lab. The second means the server's delivery lane has not heard from a Lab Inbox. Both messages stay as written.

### 1.7 Test hooks (test builds and launch arguments only)

| Platform | Hook |
|---|---|
| Apple | Launch arguments `-DLSLab 0\|1` and `-DLSComfort 0\|1`; `debug-status.json` gains `lab`, `caps` and `labStates` |
| Android | The debug setup link gains `lab=0\|1` |
| Extension | The `chrome-test` build reads a seeded `settings.lab` |
| Web | `?lab=0\|1`, honoured only when the page is served from `127.0.0.1` |
| Windows | `--e2e-lab 0\|1` in test mode; the status file gains `lab` |

**Lab-off parity test (F00, every app).** With Lab off, the accessibility tree of each main screen must equal a
baseline recorded from the last non-Lab build of the same app. The tree is element types, labels and values, in
order:

- Apple: XCUITest `debugDescription` filtered to type and label;
- Android: the Compose semantics tree in Robolectric;
- extension, web and Windows: Playwright `page.accessibility.snapshot()`.

Baselines live next to the tests (`…/lab-off-baseline/*.json`) and are re-recorded only together with a matching
non-Lab change. Pixel screenshots are uploaded as CI artifacts for review, not compared.

---

## 2. Shared foundations

### 2.1 Compatibility rules (binding)

1. `v` stays `1`. Frames, keys, the inbox and ack topics and the pairing link are unchanged.
2. Lab adds only:
   - item header fields named `x-…` (2.3);
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
7. `LAB_LEVEL = 1`. A later incompatible change to a Lab structure raises it, and readers ignore structures of a
   level above theirs.

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
| `app` | ASCII string, ≤ 40 characters (readers clamp anything longer) | `android/<versionName>` (Daylight Share) or `reader-lab/<versionName>` (the Lab Reader) |
| `caps` | array of ≤ 16 tokens, each `/^[a-z0-9-]{1,16}$/` | 2.2.2 |
| `poll` | ISO 8601 UTC with milliseconds | When the Inbox last polled the inbox topic successfully |
| `live` | boolean | Instant delivery has a connection open now |

`x-st` is optional and holds at most **24** entries `{i, s, t}`:

- `i` is an item id (32 lowercase hex);
- `s` is a state token (2.2.3);
- `t` is when the Inbox reached that state, in Unix **seconds**.

**Size.** Take the worst case: `from` of 60 four-byte code points, `app` of 40, 16 caps of 16 characters, and 24
entries with 7-character states. The header is then at most 2,455 bytes, the frame 2,491 bytes and its base64 3,324
characters, under 3,800. `buildLabFrame` refuses more than 24 entries and checks `isSmallFrame`, and a vector pins
the worst case.

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
| `waiting` | 1 | Waits for a tap on the Daylight | The item is first announced (notification or card) |
| `held` | 1 | Kept in the Inbox on purpose | **Hold** is chosen (F15) |
| `inbox` | 1 | Stays in the Inbox: no Reader takes it | Kept in the Inbox (`no_reader`, `no_route`) |
| `handed` | 2 | Handed to the Reader, which did not confirm | Status `sent`, `ok` or `no_answer`. Today that is every document, and a refused `SAVE_PAGE` that was retried as a shared link. |
| `failed` | 2 | The Reader tried and could not add it | Lab Reader import failure (R1) |
| `queued` | 3 | In the Reader's read-later queue; downloads when online | `SAVE_PAGE` status `queued` |
| `reader` | 4 | In the Reader's library | `SAVE_PAGE` status `saved` or `duplicate`; the Lab Reader's import done, or already on the shelf |

These are the Inbox's own log statuses (`HandoffActivity.start`/`done`, README "Debug builds"), mapped: `saved`,
`duplicate` → `reader`; `queued` → `queued`; `sent`, `ok`, `no_answer` → `handed`; `no_reader`, `no_route` →
`inbox`.

**2.2.4 When the Inbox publishes.**

- **States.**
  - `LabInbox.record(id, s, t)` persists an entry; for the same id, a later entry replaces an unpublished one.
  - `LabInbox.flush()` publishes pending entries, oldest first, in frames of at most 24. It runs:
    - after every poll or live batch, once its acks are out;
    - at the end of every hand-off run (`HandoffActivity`'s `finally`);
    - otherwise 2 s after the last `record`.
  - With no network, `flush()` schedules the WorkManager one-time job `lab-flush` with a `CONNECTED` constraint.
  - A failed publish keeps the entries. At most 500 pending entries are kept; the oldest go first.
- **Hello.** A hello is a Lab frame with no `x-st`. It goes out:
  - when Lab is turned on;
  - when `caps` or `app` changed since the last Lab frame;
  - at any flush when the last Lab frame is more than 11 hours old (so at most 3 a day while idle).

  Every frame that carries states also carries `x-inbox` and counts as a hello. When Lab is turned off, the Inbox
  sends one frame with `lab: 0` and `caps: []`, then nothing.
- **State digest.** With the v1.1 11-hourly ack digest, the Inbox republishes the latest state of every item whose
  state changed in the last 48 hours: at most 48 entries (2 frames), newest first. A sender that missed a frame
  catches up. For this, `LabInbox` keeps every published entry `{id, s, t}` for 48 hours in its store, next to the
  pending ones and the time of the last Lab frame.
- **Order.** No order relative to acks is needed. A sender keeps states for ids it has not seen acked and uses them
  only once the row is delivered (2.2.6).
- **Budget.** Idle: at most 3 hellos a day, plus 1 per Lab toggle. Busy: about one state frame per hand-off batch,
  plus at most 2 digest frames every 11 hours. The soak test checks it (2.8).

**2.2.5 Parsing**, the same in every implementation and pinned by the `labParse` vectors:

```
parseLabAck(header) -> {inbox: Info | null, states: [{id, s, t}]}           never throws
  header.kind != "ack"                       -> {null, []}
  ids missing, not an array, or not empty    -> {null, []}      Lab fields count only on frames with ids []
  x-inbox is an object whose lab is an integer 0..99:
      app  : string -> first 40 code points, else ""
      caps : array -> strings matching /^[a-z0-9-]{1,16}$/, first 16, duplicates removed; else []
      poll : string matching /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/ -> ms since epoch; else null
      live : true only for the JSON value true
    else inbox = null
  x-st is an array: its first 64 entries, each kept only when it is an object with
      i matching /^[0-9a-f]{32}$/, s one of the 7 tokens of 2.2.3, and t an integer with 0 <= t <= 4102444800
```

**2.2.6 Sender ledger (`LabLedger`).** It records every ack-topic message that decrypts, whether Lab is on or off,
through the Sender's `onAckHeader` hook (2.7.1). It stores:

| Key (JS storage; a `lab.json` file next to the outbox in Kotlin and Swift) | Content |
|---|---|
| `lab/inbox` | The last `Info`, plus `at` = that message's relay `time` in ms. Only a message with a later `at` replaces it. |
| `lab/heard` | The latest relay time (ms) of any ack-topic message that decrypted: an ack or a Lab frame |
| `lab/states` | id → `{s, t}`. A new entry replaces the stored one when its rank is higher, or when the ranks are equal and its `t` is later. Pruned to ids still in the outbox, at most 200. |

- **Pairing changes.** A different secret removes every `lab/*` key with the outbox (`applyPairingChange`). The same
  secret keeps them.
- **Derived values.**
  - `inboxLab()` = `inbox` exists, `inbox.lab ≥ 1` and `now − inbox.at ≤ 14 days`.
  - `hasCap(t)` = `inboxLab()` and `caps` contains `t`.
  - `checkedIn()` = the later of `heard` and `inbox.poll`, or null.
  - `state(id)` is shown only for rows whose status is `delivered`.
- **No row says Delivered without an ack.** An ack frame listing the id is the only way into `delivered`; states
  never change a row's status.

### 2.3 Item header fields (W1) and reserved names

| Field | Value | On kinds | Meaning | Written by | Read by |
|---|---|---|---|---|---|
| `x-cap` | `"seen"`, `"clean"`, `"excerpt"` or `"test"` | page, file | How the content was made: the page as rendered (F03), a Readability article (F10), a selection excerpt (F11), the setup test article (F26) | extension, iPhone share extension, Android, Mac Services, CLI | Lab Inbox row line (F03, F11) |
| `x-orig` | a URL passing the web URL rule | url, page | The URL as shared, when `normaliseShare` changed it (F16) | every sender, Lab on | Lab Inbox item details ("Cleaned from {host}") |

Senders add these only with Lab on. Inboxes ignore an unknown value, and an `x-orig` that fails the web URL rule.
**Reserved** (no other use): `x-note`, `x-tags`, `x-dest`, `x-private`, `x-to`, `x-rk`, `x-anchor`, `x-item`,
`x-inbox`, `x-st`, and the server's `x-origin` and `x-about`.

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
  `{inboxTopic, ackTopic, "dlshare/v1/inbox", "dlshare/v1/ack"}`. The return lane reuses the protocol's `Sender` (on
  the Daylight) and `Receiver` (on phones and computers) unchanged, with its own topics and AADs. Frames, chunking,
  the outbox, re-sends, acks, dedupe and every limit of PROTOCOL 2–4 apply as they are.
- **Return items** are ordinary item headers (PROTOCOL 2.1) plus two fields:
  - `x-rk`: `"share"` (the user shared it on the DC-1, F06), `"marks"` (R2), `"queue"` (R3) or `"reading"` (R4);
  - `x-to`: optional, one device's `from` name; absent means every device.

  `marks`, `queue` and `reading` are `kind: "file"` with the MIME types `application/vnd.daylight.marks+json`,
  `…queue+json` and `…reading+json` (5.4–5.6). A device acks every return item it reads, even one whose `x-rk` it
  does not know (it drops that one). With `x-to` set, the Daylight's return outbox counts only the named device's ack
  (by the ack's `from`).
- **Control frames** (W3) are reserved: `{v:1, kind:"cmd", id, cmd, args, sent, from}`, acked on `controlAckTopic`.
- **AADs.** The protocol module's `aadFor` becomes an explicit map: `inbox`, `ack`, `lab-return`, `lab-return-ack`,
  `lab-control`, `lab-control-ack`. An unknown purpose throws `ShareError('purpose')`, as DESIGN 17.2 asks. The
  vectors pin the derived topics and one sealed return frame from W0, so every port derives them identically before
  they are used.

### 2.5 Delivery timeline text

`describeLabRow(row, now, ctx)`, where `ctx = {lab, inboxLab, hasCap, state, online}`, returns
`{label, sentence, action, steps, stepLine, stepIndex}`. Rules in order:

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
| `held` | Held on your Daylight | It waits in Daylight Share until you add it to the Reader. |
| `inbox` | In Daylight Share on your Daylight | No Reader on your Daylight takes this, so it waits in Daylight Share. |
| `handed` | Handed to the Reader | Your Daylight passed it to the Daylight Reader. |
| `failed` | Not added to the Reader | The Reader couldn’t open this. It waits in the inbox on your Daylight. |
| `queued` | In your Reader’s queue | The Reader will download it when your Daylight is online. |
| `reader` | In your Reader ✓ | Saved in the Daylight Reader. |

Delivered rows have no action button; every row can be removed.

**Step line.** There are four steps: "This device", "Relay", "Daylight", "Reader". Each has a mark: `✓` done, `…`
under way, `!` stopped, `→` passed on without confirmation, or nothing (not reached). Steps are joined with ` · `,
for example `This device ✓ · Relay ✓ · Daylight ✓ · Reader …`.

| Row | Marks (device, relay, Daylight, Reader) | `stepIndex` |
|---|---|---|
| `sending`; offline waiting | … , , , | 1 |
| `failed`, `expired` | ! , , , | 1 |
| `sent` | ✓ , ✓ , … , | 3 |
| Delivered with no state; `waiting`; `held` | ✓ , ✓ , ✓ , … | 4 |
| `handed` | ✓ , ✓ , ✓ , → | 4 |
| `inbox`, `failed` (state) | ✓ , ✓ , ✓ , ! | 4 |
| `queued`, `reader` | ✓ , ✓ , ✓ , ✓ | 4 |

The row's accessibility label is `{label}. {sentence} Step {stepIndex} of 4.` The step line itself is hidden from
screen readers, because the label says it. The marks are glyphs and words, never colour alone.

**Check-in header** (Lab on, paired; above the history): "Your Daylight checked in {rel}."

- `{rel}` is "just now" under 60 s, "{m} min ago" under 60 minutes, "{h} h ago" under 48 hours, else "{d} days ago".
- With no check-in yet: "Your Daylight hasn’t checked in since this device paired."
- It comes from `checkedIn()` (2.2.6). With a v1.1 Inbox it still works, from ack times. It never blocks sending.

**Faster checks while something is in flight.** While the app or popup is visible and a delivered row from the last
10 minutes has no final state (`reader`, `queued`, `inbox`, `failed`, `held`), the sender reads the ack topic every
30 s instead of its normal interval.

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
| a call | `409 NEEDS_KEY` | `needs-key` | Set the cached `features[feature]` to it; show |
| a call | `409 NOT_CONFIGURED` with `missing` holding `DAYLIGHT_EMAIL_DOMAIN`, `R2` or `DAYLIGHT_SERVER_CODE` | `needs-domain`, `needs-r2` or `needs-server` | Cache; show |
| a call | `409 NEEDS_LAB_INBOX` | `needs-lab-inbox` | Cache; show |
| a call | `429 RATE_LIMITED`, `AI_BUSY`, `AI_QUEUE_FULL` | stays ready | Show the server's message and wait `retryAfter` |

**Lab feature → server feature key.** Summaries with Claude → `ai` (`pdf` when the source is a PDF). Email-in address
→ `email`. Feeds and daily digest → `feeds`. Files over 9 MB → `files`. "Also send the result to my Daylight" →
`deliver`.

**The "Daylight server" section (W0)** shows:

- the state ("Ready" or its message);
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
  `lockBeforeRepair`, `notice`, `markNoticeShown`;
- `STATE_MESSAGES`, `ERROR_MESSAGES`, `errorMessage`, `localMessage`, `noticeText`;
- the storage keys of DESIGN 13.1.

They must pass `server-vectors.json` › `derived`, `serverCodeParsing`, `frames` (config) and `negative` (config
parts). Wave S adds the rest.

### 2.7 JS reference additions, then the ports

**2.7.1 `share/js/daylight-share.js`** (protocol module). These changes are wire-neutral, and `test-vectors.json`
must not change:

- `aadFor` becomes the explicit map of 2.4; an unknown purpose throws.
- `new Sender({…, onAckHeader})`: called as `onAckHeader(header, {time, msgId})` for every decrypted ack-topic frame
  whose `kind` is `ack`, inside `_checkAcks`, before rows are updated. Its exceptions are caught and logged.
- `Sender.send(item, {defer = false})` (F07): with `defer`, the row is stored as `failed` with error code `network`,
  `attempts: 0` and `lastPublish: now`. Nothing is published; the content is stored as usual.
- `Sender.flushNetwork({max = 30})` (F07): attempts every `failed`/`network` row now, oldest first, whatever its
  back-off, at most `max` rows, stopping at a 429. Returns the rows it attempted.
- `applyPairingChange` also removes every `lab/*` key when the secret differs.
- W2 (L2): `Sender` and `Receiver` take `lane` (2.4).

**2.7.2 New `share/js/daylight-lab.js`.** No dependencies but `daylight-share.js`. The extension, web and Windows
builds copy it, as they copy the protocol module. W0 exports:

```js
export const LAB_LEVEL = 1;
export const CAPS = { st: 'st', tap: 'tap', readerLink: 'reader-link', capKind: 'cap-kind', readerDoc: 'reader-doc', quiet: 'quiet' };
export const LAB_STATES = ['waiting', 'held', 'inbox', 'handed', 'failed', 'queued', 'reader'];
export const STATE_RANK = { waiting: 1, held: 1, inbox: 1, handed: 2, failed: 2, queued: 3, reader: 4 };
export const MAX_ST_PER_FRAME = 24, HELLO_EVERY_MS = 11 * 3600e3, STATE_DIGEST_WINDOW_MS = 48 * 3600e3,
             STATE_DIGEST_MAX = 48, INBOX_STALE_MS = 14 * 86400e3, PENDING_MAX = 500;
export function buildInboxInfo({ lab, app, caps, poll, live }) {}      // clamps as 2.2.5
export async function buildLabFrame(keys, { inbox, states = [], from, sent, nonce }) {}   // throws if >24 or not small
export function parseLabAck(header) {}                                  // 2.2.5
export class LabLedger { constructor({ storage, now }) {} async record(header, { time }) {} async inbox() {}
  async inboxLab() {} async hasCap(token) {} async checkedIn() {} async state(id) {} async prune(ids) {} }
export function labHook(ledger) {}                                     // -> onAckHeader for the Sender
export function describeLabRow(row, now, ctx) {}                       // 2.5
export function checkedInText(ms, now) {}                              // 2.5
export const LAB_TEXT = { /* every string of 1.6 and 2.5, keyed */ };
export function needsMessage(state, { app, platform, feature } = {}) {}
export async function labGate(feature, ctx) {}                         // -> {ready, state, message}
export async function deriveLabTopics(secret) {}                       // 2.4
export class LabInbox { constructor({ storage, relay, keys, info, from, now }) {}   // the Inbox side, for the JS
  record(id, s, t) {} async flush() {} async labTurnedOn() {} async labTurnedOff() {} async digest() {} }
export class LabInboxSim { constructor({ receiver, labInbox, stateFor }) {} async pollOnce() {} }  // tests: a Lab Daylight
```

- `LabInbox` is the reference for Kotlin's. Tests and the Apple e2e receiver use it as the Daylight.
- `LabInboxSim.pollOnce()` runs `receiver.pollOnce()` and then records, for each new item, `stateFor(header)`. The
  default is `reader` for url and page, `handed` for file; `waiting` is available as a test option. Then it flushes.
- `labGate(feature, ctx)` checks, in order: Lab is on; paired (`needs-pairing`); the feature's required capability
  (`needs-inbox` or `needs-reader-lab`); its permission or setting (supplied by the app as `ctx.local(feature)`);
  then the server state (`ctx.server.state(key)`) for server features; then `later` when `ctx.built(feature)` is
  false.

W1 additions (L1): `normaliseShare`, `extractAppleNewsTarget`, `classifyShare`, `excerptHtml`, `excerptMarkdown`,
`excerptFileName`, `textFragment`, `testArticle`, `redactDiagnostics`, and the W1 strings in `LAB_TEXT`. Then the CLI
`share/js/bin/daylight-send.mjs` (F09).

**2.7.3 Ports.** Same names, same behaviour, same vectors:

| JS | Swift (`DaylightShareKit`) | Kotlin (`share-core`, package `com.daylight.share.core.lab`) |
|---|---|---|
| `buildInboxInfo` / Info | `LabInboxInfo` | `LabInboxInfo` |
| `buildLabFrame`, `parseLabAck` | `LabFrame.build`, `LabFrame.parse` | `LabFrame.build`, `LabFrame.parse` |
| `LabLedger` | `LabLedger` (file `lab.json` next to the outbox state, coordinated like `OutboxStore`) | `LabLedger` (`lab.json` in `FileOutboxStore.dir`) |
| `describeLabRow`, `checkedInText`, `LAB_TEXT`, `needsMessage` | `LabRowText(row:now:ctx:)`, `LabText` | `LabRowText.of(row, now, ctx)`, `LabText` |
| `deriveLabTopics` | `LabTopics.derive(secret:)` | `LabTopics.derive(secret)` |
| `LabInbox` | — | `LabInbox` (pure JVM: the Daylight Share Inbox and the Lab Reader vendor the same class) |
| Sender hook | `ShareSender(…, onAckHeader:)` | `Outbox(…, onAckHeader = …)` |
| W1: `normaliseShare`, excerpt builders | `ShareNormaliser`, `Excerpt` | `Normalise`, `Excerpt` |
| server W0 subset (2.6) | `DaylightServer`, `ServerCode`, `ServerMessages` (folder `Server/`) | package `…core.server` |

### 2.8 Vectors and CI

**`share/vectors/lab-vectors.json`**, generated by `share/vectors/generate-lab.mjs` from the JS with fixed nonces, for
the protocol vectors' secret:

| Section | Holds |
|---|---|
| `labTopics` | The four derived topics (2.4) and one sealed return frame |
| `labFrames` | A hello, a frame with 3 states and the worst-case frame of 2.2.1, each with nonce, base64 frame, header JSON and its expected parse |
| `labParse` | At least 25 headers: valid; junk caps; bad ids; ids not empty with `x-st` (ignored); unknown state; out-of-range `t`; missing `x-inbox`; `lab: 0`; 70 entries (first 64 read) → expected `{inbox, states}` |
| `labLedger` | Sequences of (header, relay time) → the expected state per id, and `inboxLab`, `hasCap` and `checkedIn` at a given `now` (equal rank, later `t`; lower rank ignored; stale hello) |
| `labRowText` | (row, now, ctx) → `{label, sentence, action, stepLine, stepIndex}` for every row of 2.5 and the v1.1 fall-throughs |
| `labText` | Every string id → text, with the per-platform variants of 1.6 |
| `v1Safety` | The `labFrames` frames as a v1.1 ack reader sees them: no ids. Kotlin's and Swift's `VectorTests` also assert `idsOf` / `ids(in:)` = `[]` and no delivered row. |

**W1 additions:**

- `share/vectors/normalise.json`: at least 40 cases (F16);
- a `labExcerpt` section: selection inputs → HTML, Markdown, file name and URL (F11);
- a `diagnostics` section: a log fixture → its redacted text (F26).

**CI:**

- **`rx-share.yml`.** `node --test share/js/test/*.test.mjs` gains `lab.test.mjs`, `lab-skew.test.mjs`,
  `normalise.test.mjs` and `cli.test.mjs`. The vectors are regenerated and `git diff --exit-code` must find no
  change.
- **F17 skew suite.**
  - JS (`lab-skew.test.mjs`): {v1.1 Sender, Lab Sender} × {v1.1 Receiver, `LabInboxSim`} × {url, page, file}. Every
    item is delivered; Lab states appear only when both sides are Lab; a v1.1 Sender never throws on Lab frames;
    `describeRow` is unchanged against a v1.1 Receiver.
  - Kotlin `LabSkewTest`: the Kotlin `Outbox` with `LabLedger` against the JS Receiver with and without
    `LabInboxSim`, and the Kotlin `Receiver` with `LabInbox` against the JS Sender with and without the ledger. It
    uses the existing node interop through the mock relay.
  - Swift `LabSkewTests`: Swift's sender against `apple/scripts/e2e-receiver.mjs`, with and without its new `--lab`
    flag.
- **Soak** (in `lab-skew.test.mjs`): 7 simulated days on the mock relay with ntfy.sh's limits. 30 items a day, the
  Inbox polling every 15 min, hellos, states and digests. No 429, and the Daylight publishes at most 60 messages a day.

---

## 3. Wave 0 and Wave 1

### 3.1 What is in each wave, per platform

| Platform | Wave 0 | Wave 1 |
|---|---|---|
| iPhone, iPad | F00 (with the server section), F17, F27 | F01, F03, F04, F07, F08, F09, F10, F11, F16, F26, F33 |
| Mac | F00 (with the server section), F17, F27 | F01, F04, F07, F08, F09, F11, F16, F26, F33 |
| Chrome, Safari | F00, F17, F27 | F01, F03, F04, F07, F10, F11, F16, F26, F33, F34 |
| Android phone | F00, F17, F27 | F01, F03, F04, F07, F08, F09, F11, F16, F26, F33 |
| Web sender | F00, F17, F27 | F01, F07, F09, F16, F26, F33 |
| DC-1 Inbox | F00, F17 (hello and states), F27 | F01 (states complete), F03 and F11 (row lines), F15, F26 |
| Windows | F00, F17, F27 | F01, F07, F08, F09, F16, F26, F33 |

iPhone and Mac land first in each wave. The DC-1 Inbox's W0 part (hello and states) runs at the same time, in its own
folder, because the iPhone's and the Mac's timelines need a Lab Inbox to show anything on a real device. Its W1 UI
work (F15 and the rest) follows the Android phone, as the user's order says.

### 3.2 Wave 0

#### F00 Lab switch, What's in Lab, needs-setup notes, Daylight server section

**Common.** Section 1 and 2.6. Every app gets one Lab settings block, a What's in Lab list, a `LabNote` component and
the server section (the Inbox gets the server-lane version in Wave S).

| Platform | UI and behaviour | Edge cases |
|---|---|---|
| iPhone, iPad | In `DaylightShareUI`: `LabSettingsSection` (switch, footer, rows), `WhatsInLabView` (a `List`), `ServerSettingsView`, the `LabNote` view modifier and `LabGate` (async). The one-time note is a banner at the top of `HomeView`. The share extension reads `SharedStore.lab`; with Lab off it is exactly v1.1. On iPad the settings sheet works at every split width. | Storage still resolving: treat Lab as on and re-render on `.daylightShareChanged`. Not paired: the server section shows `needs-pairing`. |
| Mac | The same components in `MacSettingsView`; the one-time note in the main window. | Ad-hoc builds: the Share menu item has no access to the app's setting and behaves as Lab on (README "Pairing once"). |
| Android phone | `Prefs.lab` with a `StateFlow`; a `LabCard` at the top of `SettingsScreen`; `ui/LabScreen.kt` (What's in Lab and the server section); a `LabNote` composable; the one-time note as a card on `SenderScreen`. `ShareActivity` reads `Prefs.lab`. | Role switch: the Lab flag is shared by both roles. |
| DC-1 Inbox | The same card in the Inbox role, and the note on `InboxScreen`. What's in Lab lists the Inbox's features. The server row shows `needs-server` until Wave S. | Lab off sends the `lab: 0` hello (F17). |
| Chrome, Safari | The popup's settings row; `src/lab.html` with `src/lab-page.js` (What's in Lab and the server section); `src/lab-ui.js` (`labNote(el, msg)`, `aria-live`). Server calls run in the service worker (DESIGN 13.2). | The host permission for the Worker is requested at the first server tap; a refusal gives `needs-site-access`. |
| Web | A settings row, a What's in Lab dialog and a server panel; `web/web-lab.js`. `build.mjs` copies `daylight-lab.js`, `daylight-server.js` and the extension's `lab-ui.js`. | The shared github.io origin warning stays (README). |
| Windows | A settings row and panels in `src/app.js`; `src/lab.js`. The build copies `daylight-lab.js` and `daylight-server.js`. Tauri's CSP `connect-src` gains `https://*.workers.dev` and the relay. | — |

**Acceptance (all apps):**

- [ ] **F00.1** On a fresh install, Lab is on and the one-time note shows once. An upgrade from the last non-Lab build
  does the same, keeping the pairing and history.
- [ ] **F00.2** With Lab off, each main screen's accessibility tree equals the non-Lab baseline (1.7).
- [ ] **F00.3** Tapping each Lab feature in a needs-setup state shows exactly its sentence under the control. The
  control is not greyed out, and a screen reader announces the sentence.
- [ ] **F00.4** Queue an item offline, turn Lab off, go back online: the item is sent. History, pairing and server pin
  are all still there.
- [ ] **F00.5** For the vector pairing, the Server code shown equals `server-vectors.json` › `derived`, and Copy puts
  it on the clipboard (every sender).
- [ ] **F00.6** With no server deployed, "Summaries with Claude" shows the `needs-server` sentence within 5 s (online),
  or the `OFFLINE` sentence (offline).

**Automated:**

| Platform | Tests |
|---|---|
| Apple | `swift test`: `LabTextVectorTests`, `ServerVectorTests`; XCUITest `LabOffParityTests` (iPhone and Mac), `LabNoteTests` (stubbed gate states) |
| Android | Robolectric `LabOffParityTest` (semantics trees, both roles), `LabNoteTest`, `PrefsLabTest` (missing key → on, note once) |
| Extension, web | `test/unit/lab.test.mjs`; Playwright `test/e2e/lab.e2e.mjs`: popup and `lab.html` with Lab on and off, parity snapshots, notes for stubbed states |
| Windows | `test/unit/lab.test.mjs`; `windows.e2e.mjs` gains a Lab-off status snapshot |

#### F17 Capability hello and version-skew safety

**Senders (every app).**

- Wire `LabLedger` through `onAckHeader` (2.2.6) and persist it.
- What's in Lab's header shows the Inbox's Lab state.
- Features that depend on the Inbox gate on capabilities. In W1 that is only the timeline's Reader step: `st` decides
  whether "On your Daylight ✓" or "Delivered ✓" shows, and tapping a document's Reader step without `reader-doc`
  shows `needs-reader-lab`.

**DC-1 Inbox (W0, needed by every sender's W1).**

- `inbox/LabReporter.kt` wires share-core's `LabInbox` into `InboxRepo`, `Handoff` and `HandoffActivity`. Its store is
  `files/inbox/lab-<inboxTopic>.json`.
- It records:
  - `waiting` when `Handoff.notifyWaiting` (or the card) first announces an item;
  - the final state of every hand-off in `HandoffActivity.done` and in each kept-in-Inbox path, mapped as in 2.2.3;
  - nothing for `mark(…, "started")`.
- It flushes after `pollOnce` and `handleLive` (after acks) and in `HandoffActivity`'s `finally`.
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

**Automated:** the vectors and the skew suite (2.8). Android: share-core `LabInboxTest` (record, coalesce, flush in 24s,
hello cadence, the `lab: 0` frame, pending cap, digest) and Robolectric `LabReporterTest` (2.2.3's mapping for every
hand-off path). e2e (`rx-e2e.yml`): `inbox-e2e.sh` reads Lab frames with `e2e/sender.mjs` and asserts `reader` for the
page and `handed` for the PDF.

#### F27 Accessibility baseline, plus a Lab comfort mode

**Baseline (not Lab, every build).**

- Every control has a label.
- Status labels wrap instead of truncating at 200% text (Dynamic Type, Android font scale, browser zoom).
- Status changes are announced: "Delivered", "In your Reader".
- Typed-code pairing is always available.
- States are shown in words and glyphs, never colour alone.

**Comfort (Lab switch).**

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
- [ ] **F27.4** Comfort on: no label is truncated at the narrowest supported width (iPad one-third split, 360 dp
  phone, 360 px popup).

**Automated:** `@axe-core/playwright` (pinned) in `extension/test/e2e/a11y.e2e.mjs`, also run against the Windows
`dist/index.html` with a fake bridge; the XCUITest audits; Compose accessibility checks.

### 3.3 Wave 1: features

#### F01 Honest delivery timeline

**Common.** `describeLabRow`, the step line and the check-in header (2.5); `LabLedger` (2.2.6); failure sentences
from v1.1 with **Retry now** / **Try again**; faster checks while an item is in flight (2.5).

| Platform | UI | Behaviour, edge cases |
|---|---|---|
| iPhone, iPad, Mac | A `TimelineRow` in `DaylightShareUI`: title, label, sentence and step line (caption style); the check-in header above History. | Background app refresh runs `tick()`, so the ledger updates; rows refresh on `.daylightShareChanged`. |
| Android phone | `SenderScreen` rows from `LabRowText.of` and the header. | WorkManager's periodic job feeds the ledger. |
| Chrome, Safari | Popup rows and the header. Toolbar badge: `…` sending, `✓` delivered, `!` error, and a new `⌛` for an item waiting for a tap (`waiting` or `held`). | The badge shows the state of the most recent row. |
| Web | Rows and header. | Only while the page is open. |
| Windows | Window rows (`logic.js` `rowView` → `describeLabRow`) and the header; a toast "In your Reader: {title}" for `reader` states while the window is hidden. | — |
| DC-1 Inbox | Records and publishes states (F17). Each row in the Inbox's own list gains the line "Sender sees: {label}" (the same text as the sender). | — |

**Acceptance:**

- [ ] **F01.1** A link sent while the Lab Inbox is open shows "In your Reader ✓" on the sender within 30 s of
  "On your Daylight ✓" (CI e2e, plus one run on Rooted 2 per sender family).
- [ ] **F01.2** With the Inbox's Documents set to Ask, a PDF shows "Waiting for a tap on your Daylight". After the
  notice is tapped, the sender shows "Handed to the Reader" at its next ack check ("In your Reader ✓" when the Lab
  Reader receives, R1).
- [ ] **F01.3** The header shows "Your Daylight checked in N min ago". With the Daylight off, sends still go out.
- [ ] **F01.4** Every failed row has one sentence naming the cause and a Retry button. No row says Delivered or In
  your Reader without an ack listing its id (unit test over the outbox state machine and the ledger).
- [ ] **F01.5** Against a v1.1 Inbox, rows read Sent / Delivered ✓ exactly as today (skew suite).
- [ ] **F01.6** VoiceOver and TalkBack read "{label}. {sentence} Step N of 4."

**Automated:** the `labRowText` vectors in JS, Swift and Kotlin. The extension e2e uses `LabInboxSim` for
`reader`, `waiting` → `handed`, and a v1.1 Receiver. Apple: `EndToEndTests` with `e2e-receiver.mjs --lab`. Android:
Robolectric `SenderTimelineTest`. Windows e2e: the status file shows `In your Reader ✓`. `rx-e2e`: the states
published by the real Inbox.

#### F03 Send the page as you see it, and say when only a link came through

**Common.**

- **`extension/src/clean-html.js`**, the single source, is run on `document.documentElement.cloneNode(true)`, never
  on the live page. It:
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
| Chrome, Safari | `inject.js` calls `cleanHtml` before returning the capture. | Pages over 8 MiB after cleaning still go as links (unchanged). PDF tabs are not affected. |
| iPhone, iPad | `apple/Shared/ShareExtension/GetPage.js` inlines `clean-html.js` between the markers `// BEGIN clean-html` and `// END clean-html`, and applies it. When a share from another app carries only a URL (no page from `GetPage.js`), the share card shows: "Only the link came through. If this needs your login, open it in Safari and share from there." | iOS share extensions cannot open other apps, so the history row for that item gets an **Open in Safari** action in the app instead. The line shows at most once per host in 30 days (`lab/linkHintHosts`, 200 hosts). |
| Android phone | Chrome shares only the title and URL. Once per host in 30 days, the card shows: "Only the link came through. For pages behind a login, send from the browser extension on a computer or from Safari on an iPhone." | — |
| DC-1 Inbox | Each row gets a line under its title: "Page as you saw it" (`page` with `x-cap` `seen` or none), "Clean article", "Excerpt", "Test article", "Link (the Reader downloads it)" (`url`), or "Document · {MB} MB". Then " · from {from}". | An unknown `x-cap` is shown as if it were absent. |

**Acceptance:**

- [ ] **F03.1 (Chrome)** A Playwright fixture page that shows text only with a login cookie arrives with that text in
  the received HTML.
- [ ] **F03.2 (Chrome, Safari, iPhone)** The sent HTML has no `<script>` except JSON-LD, no `on*` attribute and no
  form value. Unit test: a fixture with a token in a hidden input, `onclick`, a password field and textarea text.
- [ ] **F03.3 (iPhone)** Sharing a URL from Notes shows the "Only the link came through" line. Sharing a page from
  Safari never shows it.
- [ ] **F03.4 (Inbox)** Every row states its kind line, and TalkBack reads it.

**Automated:**

- `extension/test/unit/clean-html.test.mjs`, plus a check that `GetPage.js`'s inlined copy equals `clean-html.js`
  byte for byte between the markers (run in `rx-extension.yml` and `rx-apple.yml`);
- e2e F03.1;
- Robolectric `InboxRowLineTest`.

#### F04 Share in place: done in a second, never opens the app

**Common.**

- Tapping Daylight shows a card "Sending to {name}" (`{name}` = the pairing's `n`, else "your Daylight") with an
  **Options** button for 1.5 s.
- Doing nothing sends with the last-used choices. Tapping Options stops the countdown, shows the choices and a
  **Send** button.
- The publish starts when the countdown ends or Send is tapped. The card closes within 2.5 s of the tap.
- The OS and the outbox finish the upload.
- **Options in W1:** Send as (F10, where available), Review (F10), and "Send the link instead". Nothing from W2.

| Platform | UI and behaviour | Edge cases |
|---|---|---|
| iPhone, iPad, Mac (with an App Group) | New `BackgroundPublisher` in the kit, for the share extension's first attempt:<br>1. Build the item's frames into App Group files (`bg/<id>-<part>.body`: base64 text for small frames, raw for large) by streaming. Read the source with `FileHandle` in `CHUNK`-sized pieces, hash with CryptoKit's incremental `SHA256`, and seal each part. Never hold the whole file.<br>2. Save the row `sending` with `bgAttempt` (UUID) and `bgParts`.<br>3. Start one `uploadTask(with:fromFile:)` per frame on `URLSessionConfiguration.background("com.daylight.share.bg")` with `sharedContainerIdentifier` = the App Group and `timeoutIntervalForResource` = 24 h. `taskDescription` = `"<id>:<part>:<attempt>"`; headers as PROTOCOL 3.1.<br>4. Close.<br>The app handles completions in `application(_:handleEventsForBackgroundURLSession:)` (iOS) or at launch (Mac). All parts 2xx → `sent`. Otherwise classify as PROTOCOL 3.1 → `failed` / `expired` as v1.1's `attempt()`, and cancel the attempt's other tasks. Then delete the body files. | Frames of one attempt go concurrently. Receivers are order-independent (PROTOCOL 2.3), and a failure cancels the rest, which stands in for "later frames are not published". A `sending` row with live tasks for its `bgAttempt` is not stale (checked with `getAllTasks` once per tick). With no tasks after 15 min, the v1.1 staleness rule applies. Re-sends run in the app as today. Peak memory for a 9 MB PDF stays under 60 MB. Ad-hoc Mac builds (no App Group) publish in the extension as today; the card stays until "Sent". |
| Android phone | `ShareActivity` is translucent. The card reads "Queued for {name}" with an **Options** chip for 1.5 s. The content is copied into the outbox while the grant lives. Then an expedited `OneTimeWorkRequest` `send-<id>` (`setExpedited(RUN_AS_NON_EXPEDITED_WORK_REQUEST)`, `CONNECTED`) is enqueued, and the activity finishes within 1 s of the countdown's end. Options holds: an editable title, and for text with a link, "Send as excerpt" / "Send link". | Inbox role: unchanged message. Process death during the countdown: nothing is queued, and the next share works (no half rows). |
| Chrome, Safari | New setting "Send when I click the toolbar button" (Lab, off by default). When on, the popup opens with the countdown card. The service worker owns the timer (`scheduleSend(tabId, mode, 1500)`), so closing the popup still sends. Options cancels it. | Pages the extension cannot read: the card says the link will be sent. |

**Acceptance:**

- [ ] **F04.1 (iPhone)** From Safari, Notes and Files, the share sheet closes no later than 2.5 s after tapping
  Daylight, and the host app scrolls right after. Run on iOS 17, 18 and 26.
- [ ] **F04.2 (iPhone)** A 9 MB PDF shared from Files keeps the extension under 60 MB peak (Instruments). The item
  reaches "Sent" after the extension has closed, with the app not running.
- [ ] **F04.3 (Mac, team-signed)** The same as F04.1 from Safari, Finder and Preview.
- [ ] **F04.4 (Android)** The share activity finishes within 1 s of the countdown. The upload completes after the app
  is swiped away.
- [ ] **F04.5 (all)** Options stops the countdown and shows the choices. Doing nothing sends with the last-used
  choices.

**Automated:**

- Swift: `FrameFileBuilderTests` (frames from a file equal `buildItemFrames` for the same nonces; the resident
  memory delta for a 9 MB file is under 40 MB); `BackgroundCompletionTests` (a fake delegate drives 2xx, 413, 429
  and a network error into the v1.1 row states; stale attempt ids are ignored).
- XCUITest share-extension timing (the extension's `debug-status` logs open and close times).
- Robolectric `ShareActivityTimingTest` (fake clock).
- Extension unit test for `scheduleSend` and cancel.

#### F07 Offline-first outbox

**Common.**

- **Connectivity.** iPhone and Mac: `NWPathMonitor`. Android: `ConnectivityManager.NetworkCallback`. JS:
  `navigator.onLine` and the `online` / `offline` events.
- **Sharing while offline** uses `send(item, {defer: true})` (2.7.1). The row reads "Waiting for connection" (2.5).
- **Coming back online** calls `flushNetwork()`: rows go oldest first, at most 30 frames a pass, stopping at a 429.
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
- [ ] **F07.3** Twenty links queued offline go out in order with no 429, against the mock relay with ntfy.sh's burst
  limits.

**Automated:** JS `flushNetwork` and `defer` tests; the extension e2e (`context.setOffline`); Swift `OfflineQueueTests`
(an injected path monitor); Robolectric `OfflineFlushTest`; Windows unit test.

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
  - It is published to the release as `daylight-send.mjs`, and documented in `share/SEND-API.md`, the one list of every
    entry point.

| Platform | UI and behaviour |
|---|---|
| iPhone, iPad, Mac | App Intents in the app target: `SendLinkIntent(url, title?)`, `SendTextIntent(text)`, `SendFileIntent(file: IntentFile)` and `GetDeliveryStatusIntent(delivery)`. Each send returns a `DeliveryEntity {id, status, label}` (`label` from `describeLabRow`). `openAppWhenRun = false`. An `AppShortcutsProvider` phrase: "Send to Daylight with \(.applicationName)". The docs show Action button and Back Tap setups. |
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
- [ ] **F09.2** The Siri phrase works on a device.
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
- **Clean article** runs Mozilla Readability 0.6.0 (Apache-2.0, vendored as `extension/src/vendor/Readability.js`) on a
  clone. The result is wrapped as
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
| Chrome, Safari | A segmented control in the popup. Review opens `src/review.html`. |
| iPhone, iPad | Options in the share extension, for Safari pages. `GetPage.js` also inlines Readability and returns `{html, cleanHtml, words, cleanWords, selectionHtml, selectionText, title, url}`. Review uses a `WKWebView` with `allowsContentJavaScript = false`. |

**Acceptance:**

- [ ] **F10.1** On Readability's test pages plus ten news fixtures, Clean article keeps at least 90% of the expected
  body text and drops navigation and footers.
- [ ] **F10.2** A page with under 150 extracted words shows the thin warning. Choosing Send full page sends the page
  HTML.
- [ ] **F10.3** The chosen mode is remembered per site across browser restarts.
- [ ] **F10.4** Review renders within 1 s for a 1 MB page, and the edited title is the title sent.

**Automated:** `extension/test/unit/readability.test.mjs` (fixtures under `test/fixtures/articles/`); e2e for the
modes and Review; an XCTest for `GetPage.js` in a `WKWebView` host on fixture pages.

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
- **`classifyShare(text, url)`:** shared text that still has 12 or more words once its URL is removed is an excerpt.
  Otherwise the share is a link.
- **For now, excerpts follow the Inbox's Documents setting,** so with Ask they wait for a tap. With the Lab Reader
  (R1) they arrive quietly.

| Platform | UI |
|---|---|
| Chrome, Safari | The "Send selection to Daylight" context menu (macOS Safari and Chrome) and the Selection mode (every build, including iPhone Safari, which has no context menus). |
| iPhone, iPad | A Safari share with a selection uses `GetPage.js`'s selection. Text from other apps goes through `classifyShare`. |
| Mac | `NSServices` "Send to Daylight" for text, URLs and files (`macOS/App/Services.swift`, `Info.plist` `NSServices` with `NSSendTypes` `public.utf8-plain-text`, `public.url` and `public.file-url`). Text goes through `classifyShare`. |
| Android phone | `ACTION_SEND` `text/plain` goes through `classifyShare`. Chrome's "Share" of a selection, which carries a `#:~:text=` link, becomes an excerpt with that URL. |
| DC-1 Inbox | The row title is the header's `title`; the kind line reads "Excerpt" (F03). |

**Acceptance:**

- [ ] **F11.1** Selecting a paragraph and choosing Send selection delivers one item that shows the quote, the source
  link and the date in the Reader. The full article is not sent.
- [ ] **F11.2** Text with no URL arrives as a Markdown document the Reader opens.
- [ ] **F11.3** Excerpt HTML contains only the allowed tags, and a selection over 50,000 characters is cut with the
  note (unit tests and `labExcerpt` vectors).
- [ ] **F11.4** An excerpt of a page already in the Reader is a new document, not "already in your library".

**Automated:** `labExcerpt` vectors in JS, Swift and Kotlin; extension e2e for the context menu; Robolectric for the
Android share path; Swift tests for the Services handler.

#### F15 Arrival notices with actions, and Inbox health (DC-1 Inbox)

**Settings** (Lab, Inbox screen):

- "Arrival notices": **Off**, **Quiet** (default) or **Alert**. Quiet uses the new channel "Arrivals" at
  `IMPORTANCE_LOW`; Alert uses the new channel "Arrivals (alert)" at `IMPORTANCE_HIGH`.
- "Quiet hours" (off; 22:00–07:00 when on): arrivals are posted with `setSilent(true)`.

**Items that wait for a tap** keep the v1.1 "New items" behaviour (channel, card, announced once). Lab adds three
actions:

- **Add to Reader**: the tap, as today;
- **Hold**: the state `held`. The item stays in the Inbox, marked "Held", until **Add to Reader**;
- **Later**: the existing dismiss.

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

- [ ] **F15.1** Every arrival posts one notice (grouped when several), and its actions work. TalkBack reads the title
  and the source.
- [ ] **F15.2** Stopping the service from Android's Task Manager shows the warning card on the next open, and the
  notice within 15 minutes.
- [ ] **F15.3** Lab Inbox screens render their final state with animations disabled, and no state is shown by colour
  alone.
- [ ] **F15.4** Hold makes the sender show "Held on your Daylight", and Add to Reader then gives "In your Reader ✓"
  for a link.

**Automated:** Robolectric `ArrivalNoticesTest` (the channels, grouping, actions → hand-off / `held` / dismiss, quiet
hours); `HealthTest` (a fake heartbeat and clock); emulator e2e for Hold → `held` on the ack topic.

#### F16 Smart intake: unwrap Apple News, AMP, Substack and tracking links

`normaliseShare({text, url, subject})` returns `{url, title, excerpt, orig}`. It is pure, and every app uses it at
every entry point while Lab is on.

1. **URL.** `url` when it passes the web URL rule. Otherwise the first http(s) URL in `text` (`findUrl`), with
   trailing `. , ; : ! ? ' " » ” ’` removed, and a trailing `)` or `]` removed when unbalanced.
2. **Title.** `subject` when it is not empty. Otherwise `text` with the URL removed, whitespace collapsed, and leading
   and trailing `- – — : | ·` and quotes trimmed, through `cleanTitle`. When 12 or more words remain, they become
   `excerpt` and the title is null (F11).
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
6. **`orig`** = the input URL when the result differs; it is sent as `x-orig`.

**Acceptance:**

- [ ] **F16.1** At least 40 vectors pass in JS, Kotlin and Swift: an Apple News text share (parser fixture), a
  Substack app link, AMP, `utm_*`, a Facebook redirect, a plain URL, parentheses, trailing punctuation.
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
  checklist then follows it along the timeline and ticks "Delivered" and "In your Reader".
- **"Activity log"**: the last 200 events, `{time, type, id8, kind, status, http}`.
- **"Copy diagnostics"**: the app version, platform, Lab on, caps seen, last check-in, outbox counts by status, the
  relay as "ntfy.sh" or "custom relay", and the last 50 log events, all passed through `redactDiagnostics`. That
  replaces URLs with `[url]`, 28-character base32 codes with `[code]`, `dls-` plus 32 hex with `[topic]`, and
  `SERVER-…` and `daylightserver://…` with `[server code]`. Titles, names and `from` are never logged.

| Platform | Checks |
|---|---|
| iPhone, iPad | Paired; share item used at least once (else the steps to add it from "More"); Safari extension (steps only, since iOS cannot detect it); notifications; background app refresh |
| Mac | Share menu extension and Safari extension state (the app already reads the Safari one); start at login |
| Android phone | Notifications; battery optimisation exemption |
| DC-1 Inbox | Notifications and the "New items" channel at high importance; Display over other apps; battery optimisation; Instant delivery; a Reader installed that answers `SAVE_PAGE`; the Reader's read-later not refused lately. Instead of a test send: **Test the Reader hand-off**, which hands the bundled test article to the Reader through the normal hand-off and shows the result. |
| Chrome, Safari | Pinned button (Chrome: `action.getUserSettings().isOnToolbar`); shortcut set (`commands.getAll`); site access (`permissions.contains`) |
| Web | Installed as an app (`display-mode: standalone`); storage persisted (`navigator.storage.persisted()`) |
| Windows | The Send to shortcut exists; start at login; the hotkey is registered; notifications |

**Acceptance:**

- [ ] **F26.1** The test article reaches the Reader from every app, and the checklist ticks Delivered and In your
  Reader.
- [ ] **F26.2** Copied diagnostics contain no URL, title, pairing code, topic or Server code (unit test on a fixture
  log, plus the `diagnostics` vectors).
- [ ] **F26.3** Each unmet check has a button that opens the right settings screen.

**Automated:** the `redactDiagnostics` vectors in all three languages; per-app UI tests for each check's state.

#### F33 Send the copied link

| Platform | UI and behaviour |
|---|---|
| iPhone, iPad | On becoming active, `UIPasteboard.general.hasURLs` (no paste alert) shows a chip. The chip is a SwiftUI `PasteButton(payloadType: URL.self)` labelled "Send copied link"; it reads only on tap. |
| Mac | When `NSPasteboard.general.types` includes a URL type (the content is not read), a "Send copied link" button shows; a click reads it. |
| Android phone | On resume, `primaryClipDescription` only. On API 31+, show the chip when `getConfidenceScore(TextClassifier.TYPE_URL) ≥ 0.5`, or the MIME type is `text/uri-list`. Read on tap. |
| Chrome, Safari, Web, Windows | A "Paste and send" button, always shown, reads the clipboard on click. A non-URL gives "No link on the clipboard." |

All of them run `normaliseShare` on what they read.

**Acceptance:**

- [ ] **F33.1** Copy a link in Safari and open the app: the chip appears with no iOS paste alert, and tapping it
  sends the link.
- [ ] **F33.2** No chip appears for a non-URL clipboard. On Android 13, no "pasted from" toast appears before the
  tap.

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

### 3.4 What W0 and W1 deliberately do not do

- No note, tags or destination fields (F12, W2).
- No return topic polling (F06, W2).
- No LAN transfers (F13, W2).
- No server feature UI beyond the gate and the `later` state (Wave S).
- No Reader-side change: the Lab Reader is section 5. Its R0 fix and R1 inbox may land during W1; senders need no
  change to show the Lab Reader's states.

### 3.5 Task cards

Every card: build on P0 for that folder; keep the folder's CI green; update its README (Lab section, test hooks);
show the strings exactly as `LAB_TEXT` gives them; and **Done when** includes the parity test (F00.2) for every app
the card touches.

**L0 · `share/` · W0 · JS reference**

- **Depends on:** nothing.
- **Builds:**
  - 2.7.1 (`aadFor`, `onAckHeader`, `defer`, `flushNetwork`, `lab/*` removal);
  - `share/js/daylight-lab.js` (2.7.2, W0 list);
  - `share/vectors/generate-lab.mjs` and `lab-vectors.json` (2.8);
  - `share/js/test/lab.test.mjs` and `lab-skew.test.mjs` with the soak;
  - `share/LAB-PROTOCOL.md`: section 2 of this plan, copied verbatim and kept as the normative text from then on;
  - a pointer from `share/README.md`.
- **CI:** `rx-share.yml` (2.8).
- **Done when:** the vectors are regenerated with no diff to `test-vectors.json`, and the skew and soak tests pass.

**L1 · `share/` · W1 · JS reference**

- **Depends on:** L0.
- **Builds:**
  - `normaliseShare`, `extractAppleNewsTarget`, `classifyShare`, `excerptHtml`, `excerptMarkdown`,
    `excerptFileName`, `textFragment`, `testArticle`, `redactDiagnostics` and the W1 `LAB_TEXT`;
  - `share/vectors/normalise.json` and the `labExcerpt` and `diagnostics` sections;
  - `share/js/bin/daylight-send.mjs` with `cli.test.mjs`;
  - `share/SEND-API.md`;
  - `rx-share.yml` publishes `daylight-send.mjs` to the release.
- **Done when:** F09.4, F16.1 (JS) and F26.2 (JS) pass.

**A0 · `apple/DaylightShareKit` · W0 · Swift port and shared UI**

- **Depends on:** L0, P0 (Swift v1.1).
- **Builds:**
  - `Lab.swift` (`LabInboxInfo`, `LabFrame`, `LabLedger`), `LabText.swift`, `LabTopics.swift`;
  - `ShareSender(onAckHeader:)`; `SharedStore.Key` `dls.lab`, `dls.labNoteShown`, `dls.comfort`;
  - `Server/` (the 2.6 W0 subset);
  - in `DaylightShareUI`: `LabSettingsSection`, `WhatsInLabView`, `ServerSettingsView`, `LabNote`, `LabGate`,
    `TimelineRow` (W0: label and sentence only), `ComfortModifier`;
  - tests: `LabVectorTests`, `ServerVectorTests`, `LabLedgerTests`, `LabSkewTests`;
  - `apple/scripts/e2e-receiver.mjs --lab`.
- **Done when:** the vectors pass, `swift test` is green and the skew suite passes.

**A1 · `apple/iOS`, `apple/Shared` · W0 · iPhone and iPad**

- **Depends on:** A0.
- **Builds:** F00, F17 and F27 for the iPhone (3.2): settings section, note, What's in Lab, server section with the
  Server code, the share extension following `dls.lab`, Comfort, and the XCUITest parity and accessibility audits;
  `-DLSLab`.
- **Done when:** F00.1–6, F17.2, F17.4 (device) and F27.1–4 (iPhone parts) pass.

**A2 · `apple/macOS` · W0 · Mac**

- **Depends on:** A0. Runs in parallel with A1.
- **Builds:** as A1 for the Mac window, the Settings window and the Share menu extension.
- **Done when:** as A1, for the Mac.

**K0 · `android/share-core` · W0 · Kotlin port**

- **Depends on:** L0, P0 (Kotlin v1.1).
- **Builds:**
  - package `core.lab`: `LabInboxInfo`, `LabFrame`, `LabLedger`, `LabInbox`, `LabText`, `LabTopics`;
  - `Outbox(onAckHeader)`;
  - package `core.server` (the 2.6 W0 subset);
  - tests: `LabVectorsTest`, `ServerVectorsTest`, `LabInboxTest`, `LabSkewTest`.
- **Done when:** `./gradlew :share-core:test` is green, with the vectors and skew suite.

**K1 · `android/app` · W0 · Android, both roles**

- **Depends on:** K0.
- **Builds:**
  - `Prefs.lab`, `labNoteShown` and `comfort`; `LabCard`, `LabScreen`, `LabNote`; Comfort;
  - the sender's ledger via `onAckHeader`;
  - the Inbox's `inbox/LabReporter.kt` (F17: records, flush, hello, the `lab: 0` frame, the log lines);
  - the debug link's `lab=`;
  - Robolectric `LabOffParityTest`, `LabReporterTest`, `PrefsLabTest`.
- **Done when:** F00 (Android parts), F17.1–3 and F27 (Android parts) pass.

**X0 · `extension/` · W0 · Chrome and Safari**

- **Depends on:** L0, P0 (extension v1.1).
- **Builds:**
  - `build.mjs` copies `daylight-lab.js` and `daylight-server.js`;
  - `src/lab.js` (service worker: Lab state, ledger, gate, server);
  - `src/lab-ui.js`, `src/lab.html`, `src/lab-page.js`;
  - the popup settings row and note; Comfort;
  - `test/unit/lab.test.mjs`, `test/e2e/lab.e2e.mjs`, `test/e2e/a11y.e2e.mjs`.
- **Done when:** F00, F17 and F27 (extension parts) pass.

**B0 · `web/` · W0 · web sender**

- **Depends on:** X0 (it uses `extension/src/lab-ui.js` and `logic.js` through the build).
- **Builds:** `web/web-lab.js`, the settings row, What's in Lab, the server panel, Comfort; tests in
  `extension/test/{unit,e2e}/web-lab*`.
- **Done when:** F00, F17 and F27 (web parts) pass.

**WIN0 · `windows/` · W0 · Windows**

- **Depends on:** L0.
- **Builds:** `build.mjs` copies the two modules; `src/lab.js`; the settings row and panels; Comfort; the CSP; the
  `--e2e-lab` flag; unit and e2e tests.
- **Done when:** F00, F17 and F27 (Windows parts) pass in `rx-windows.yml`.

**E0 · `e2e/`, `.github/workflows/rx-e2e.yml` · W0**

- **Depends on:** K1.
- **Builds:** `e2e/sender.mjs` reads Lab frames (`lab-states <id…>`); `inbox-e2e.sh` asserts the hello and the states
  for page, link and PDF, and runs a second pass with `docs=ask`: `waiting`, then a root tap through
  `HandoffActivity`, then `handed`.
- **Done when:** F17.1 runs on the emulator.

**A3 · `apple/DaylightShareKit` · W1**

- **Depends on:** A0, L1.
- **Builds:**
  - `ShareNormaliser` (with the Apple News fetch), `Excerpt`, `classifyShare`, `testArticle`, `redactDiagnostics`;
  - `ShareSender` `defer` and `flushNetwork`;
  - `BackgroundPublisher` and `FrameFileBuilder` (F04);
  - `TimelineRow` with the step line and check-in header;
  - shared UI pieces: `QueueSection`, `SetupCheckView`, `ActivityLogView`, `PasteChip`, `OptionsSheet`, `ReviewView`;
  - tests: `NormaliseVectorTests`, `ExcerptVectorTests`, `FrameFileBuilderTests`, `BackgroundCompletionTests`,
    `OfflineQueueTests`.

**A4 · `apple/iOS`, `apple/Shared` · W1 · iPhone and iPad**

- **Depends on:** A3, A1.
- **Builds:**
  - F01, F03 (`GetPage.js` with clean-html and Readability inlined, the link-only line), F04, F07, F08, F09 (App
    Intents in `iOS/App/Intents/`, the scheme), F10, F11, F16, F26, F33;
  - `project.yml`: iOS targets only;
  - XCUITests for share-extension timing, intents, the paste chip and the audits.
- **Done when:** the iPhone acceptance items F01–F33, and a device round on an iPhone with Rooted 2.

**A5 · `apple/macOS` · W1 · Mac**

- **Depends on:** A3, A2. Runs in parallel with A4.
- **Builds:** F01, F04 (team-signed builds; ad-hoc fallback), F07, F08, F09 (intents and scheme), F11 (Services),
  F16, F26, F33; `project.yml`: macOS targets only.
- **Done when:** the Mac acceptance items, and a device round with Rooted 2 (on the Mac mini).

**X1 · `extension/` · W1 · Chrome and Safari**

- **Depends on:** X0, L1.
- **Builds:** F01 (rows, badge `⌛`), F03 (`clean-html.js`), F04 (the click-to-send setting), F07 (`dls-offline`),
  F10 (Readability, `review.html`), F11, F16, F26, F33, F34 (menus, commands, omnibox).
- **Done when:** the Chrome and Safari acceptance items; `safari.test.mjs` is green.

**K3 · `android/share-core` · W1**

- **Depends on:** K0, L1.
- **Builds:** `Normalise`, `Excerpt`, `classifyShare`, `testArticle`, `redactDiagnostics`, `Outbox` `defer` and
  `flushNetwork`, `LabRowText` steps; the vector tests.

**K4 · `android/app` · W1 · Android phone** (sender packages `sender/`, `ui/SenderScreen.kt`)

- **Depends on:** K3, K1.
- **Builds:** F01, F03 (the hint), F04, F07, F08 (`Shortcuts.kt`, `shortcuts.xml`), F09 (`AutomationActivity`),
  F11, F16, F26, F33.
- **Done when:** the Android-phone acceptance items.

**K5 · `android/app` · W1 · DC-1 Inbox** (packages `inbox/`, `ui/InboxScreen.kt`, `Work.kt`)

- **Depends on:** K3, K1. It may run in parallel with K4 under 6.3.
- **Builds:** F01 (the "Sender sees" line), F03 and F11 (row lines; the cap `cap-kind`), F15, F26 (checks, the
  Reader hand-off test).
- **Done when:** the Inbox acceptance items, and E1's emulator steps.

**B1 · `web/` · W1**

- **Depends on:** B0, X1.
- **Builds:** F01, F07 (Background Sync), F09 (bookmarklet), F16, F26, F33.

**WIN1 · `windows/` · W1**

- **Depends on:** WIN0, L1.
- **Builds:** F01 (rows, toast), F07, F08 (toast name), F09 (scheme in `args.rs`), F16, F26, F33.

**E1 · `e2e/`, `rx-e2e.yml` · W1**

- **Depends on:** K5.
- **Builds:** the e2e steps for F08 (shortcut listed), F15 (Hold → `held`), F11 (an excerpt imports as a new
  document), F26 (the Reader hand-off test).

---

## 4. Waves 2, S, 3 and 4

"Needs" means: **none** (companion apps and the Inbox only), **Reader** (a Reader change, section 5) or **server**
(the Daylight server deployed, plus the extra it names).

### 4.1 Wave 2

| Feature | Needs | Depends on | What it takes |
|---|---|---|---|
| L2 Return lane (infrastructure) | none | L0 (2.4) | `lane` in JS `Sender` and `Receiver`, then Kotlin and Swift; vectors; skew tests. It comes first in W2. |
| F06 Send back from the DC-1 | none | L2 | The Inbox role's share-target `activity-alias` "Send to my phone or Mac" (the phone role keeps "Send to Daylight"); the Daylight's return outbox; senders poll the return topic with the ack-topic rules and show "From your Daylight" (Open, Save, Share); the cap `return`. User question 3 (6.5) decides the target devices. |
| F12 Note, tags, destination | none (filing into collections: Reader) | F04's Options; caps `note`, `dest`, `hold` | `x-note` (≤ 280), `x-tags` (≤ 8 × 40), `x-dest` (`now`, `quiet`, `hold`, `stack`); the Inbox shows and filters them and puts "Note from {from}: …" at the top of pages; senders gate `hold` and `stack` on caps (`needs-inbox`). |
| F13 Big files on the same Wi-Fi | none | F17 (`lan` in `x-inbox`), F04 | The Inbox's LAN listener (`PUT /dls/v1/frame`, `GET /dls/v1/have`, `/dls/v1/ping`), rate limits; native senders upload 12 MiB frames directly; a new state `needs-same-wifi`. |
| F22 Tabs as one issue | none | F10 | An EPUB in the extension (fflate) and on Mac and Windows; epubcheck in CI. |
| F23 Print to Daylight | none | — | A Mac PDF Service; an Android `PrintService`. |
| F24 Image diet | none | F10 | Image budgets in `inject.js` and `GetPage.js`. Reader check: `data:` images in saved pages. |
| F29 Mac power moves | none | F09, F11 | Menu-bar drop, a watched folder, a Quick Action, the front browser tab. Windows: a watched folder. |
| F30 Scan to PDF | none | — | VisionKit (iPhone); ML Kit Document Scanner (Android). |
| F31 Chrome Reading List | none | F16, F32 | The optional `readingList` permission; throttled; a ledger. |
| F32 Already sent | none | F16 | A local history keyed by canonical URL and SHA-256. |
| F41 Android tile and `PROCESS_TEXT` | none | F11, F33 | A `TileService`; `PROCESS_TEXT`. |
| F42 iPhone controls and widgets | none | F01, F33 | `ControlWidgetButton`; widgets read the App Group outbox and ledger. |
| F48 Verified delivery, private items | none | F01 | The hash shown on both ends; `x-private`. |
| F50 iPad layout | none | — | `NavigationSplitView`; drag and drop. |
| F51 No lock-in | none | — | Export history (JSON, CSV) and the pairing (behind device authentication); a "Your data" page. |

### 4.2 Wave S (server lane; starts once the Worker is deployed, alongside W2)

| Feature | Needs | Depends on | What it takes |
|---|---|---|---|
| S0 The Inbox's server lane | server | K0, the server deployed | DESIGN 5.5: poll `itemTopic` with `openBox('item')`, ack on the server ack topic with `sealBox('ack')`, and hello with `x-inbox`; Kotlin ports of `sealBox`, `openBox` and `buildServerItemFrames` (tests). Recommended first (DESIGN 3.1), so that v1 delivery stays an exception. |
| F37 Summaries with Claude | server + `ANTHROPIC_API_KEY` | W0 gate | `ai.summarize`, `explain` and `ask` UI, iPhone and Mac first (Swift port of `ai`), then the extension and web (the module as it is), then Android. The first-use notice. The AI cap editable in the server section. |
| F02 Files over 9 MB | server + R2 | F04's `BackgroundPublisher` (iPhone) | `files.sendLarge` with the hosted outbox; iPhone uploads from files with a background session; Chrome uploads from an extension page, never from the service worker. |
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
  - Installed only on Rooted 2 (JP4R01422), as the side-by-side copy `com.daylightcomputer.readerexperiment` that is
    already there (DEVICE-CHECKS).
  - Never on JP4R03005; never merged or shipped without the user.
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
  Lab (K0, K3), plus `VERSION`, `PATCHES.md` and `tools/share/sync-core.sh`, the same pattern as
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
  Rooted 2 (lab copy), nor on the emulator (snapshot build). The fix is offered to the Reader session for the main
  app, at the user's discretion.

### 5.3 R1 · Built-in inbox with quiet import and "In your Reader" confirmation

Package `com.daylightcomputer.reader.labs.share`:

| Class | What it does |
|---|---|
| `ShareInbox` | The coordinator, scoped to `AppContainer`. It holds the pairing (from the handover, or its own new one); a share-core `Receiver` (`FileReceiverStore` at `files/share-inbox/receiver-<topic>.json`, `Reassembler` spooling to `files/share-inbox/spool`, `RelayClient` with user agent `DaylightReaderLab/<versionName>`); and a share-core `LabInbox` (`files/share-inbox/lab.json`). Its `accept()` stores durably and returns (store before ack, PROTOCOL 3.4): content to `files/share-inbox/items/<id>/` and a row in `files/share-inbox/items.json` with state `stored`. The ack means "On your Daylight". |
| `ShareInboxWorker` | Unique periodic WorkManager work "share-inbox", every 15 min, `CONNECTED`: `pollOnce`, then process stored items, then `LabInbox.flush()`. |
| `ShareProcessor` | Turns stored items into library documents with **no activity**:<br>• `url` and `page`: `ReadLaterCenter.saver(c).save(SavedItem(url, title, source = SavedItem.VIA_REMOTE), html)` in process (the same caps as `SAVE_PAGE`: 4 KB URL, 8 MiB HTML).<br>• `file`: the new `ImportStager.stageFile(file, name, mime, sha256)` (moves the reassembled, already verified file into staging; `Sniffer` decides the format from the bytes), then `ImportWork.enqueueImport(app, staged)`, observing its `WorkInfo`. |
| `ShareLive` | While `ProcessLifecycleOwner` is STARTED and `labs.shareInstant` is on: the ntfy JSON stream, handled like a poll. No foreground service, no "Display over other apps". |
| `ShareStates` | Maps outcomes to Lab states (2.2.3) and records them in `LabInbox`. |
| `ShareInboxProvider` | Exported; authority `<applicationId>.shareinbox`. `call("receiving")` → `{receiving: Boolean}`, answered only to the package `com.daylight.share`. |
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
   `{code, relay, name}`. It does so only while armed, and only to the calling package
   `com.daylightcomputer.readerexperiment` or `com.daylightcomputer.reader.<suffix>` (`getCallingPackage()`).
3. Daylight Share then sets `receivingElsewhere = <package>`. It stops polling, the live connection and Instant
   delivery, sends a `lab: 0` hello, and shows: "Daylight Reader (lab) receives for this Daylight now." with
   **Receive here again**.
4. Before each would-be poll, Daylight Share asks the Reader's `ShareInboxProvider.call("receiving")`. When the answer
   is false, or the package is gone, it resumes by itself. **Receive here again** is offered only when the Reader
   says false.
5. Without Daylight Share installed, the Lab Reader can make its own pairing (QR code and typed code), as
   READER-INTEGRATION describes.

**5.3.5 UI** (Settings › Labs › Send to Daylight):

- the switch "Receive from your phone and computer";
- the privacy line from READER-INTEGRATION;
- the status: "Last checked {rel}";
- **Take over from Daylight Share**, shown when it is installed;
- "This Daylight’s code" (QR and typed code), only for a pairing the Reader made;
- **Reset pairing**;
- Advanced: the relay.

**Acceptance R1** (Rooted 2 with the Mac mini; senders are the Mac app and `daylight-send` on the Mac):

- [ ] **R1.1** After the handover, `daylight-send --wait-for reader --json` exits 0 within 2 minutes for a link, a
  page and a 3 MB PDF. The lab copy's `ShellReceiver count` grows by 3.
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
- `ShareProcessorTest`: fake `ReadLaterPorts` and `ImportWork`; each `SaveResult` and `ImportOutcome` → its state;
- `QuietImportTest` (Robolectric): after a link, a page and a file are processed,
  `shadowOf(app).nextStartedActivity == null`;
- `HandoverTest` (Robolectric, with a fake provider on each side).

### 5.4 R2 · Highlights and notes back to phones (F05; needs W2's L2 and the senders' "From your Daylight")

- **Triggers.** `MarksOutbound` runs when a document closes (`ReaderActivity.onStop`) or the screen turns off,
  debounced 60 s.
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
- **When.** Debounced 60 s after a change; at most once every 15 minutes; and when the library is shown.
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
  an hour.
- Phones extend the F01 line: "Opened Tue · 62% read · Finished".
- **Acceptance:** with the switch off nothing is sent (a relay-log check); with it on, the iPhone shows the progress
  within an hour of closing the document.

### 5.7 Order of the Reader work

| Task | After | Notes |
|---|---|---|
| R0 | now | Independent of every companion task |
| R1 | K0 and K3 (share-core with Lab and W1), K6 (handover) | |
| R2 | L2 and the senders' W2 "From your Daylight" | |
| R3 | L2; the phones' read-only list comes with W3's F20 | |
| R4 | R2 | |

Every R task ends with a device round on Rooted 2, written into DEVICE-CHECKS.md.

---

## 6. Build schedule

### 6.1 Lanes: who owns which folder

| Lane | Folders a task may edit | Tasks |
|---|---|---|
| share | `share/` and `rx-share.yml` | L0, L1, L2 |
| kit | `apple/DaylightShareKit/` (both modules) | P0-kit, A0, A3, W2-kit |
| ios | `apple/iOS/`, `apple/Shared/`, the iOS blocks of `apple/project.yml`, `rx-apple.yml` iOS jobs | A1, A4 |
| mac | `apple/macOS/`, the macOS blocks of `apple/project.yml`, `rx-apple.yml` macOS jobs | A2, A5 |
| core | `android/share-core/` | P0-core, K0, K3 |
| android-app | `android/app/` and `rx-android.yml` | K1, K4, K5, K6 |
| ext | `extension/` and `rx-extension.yml` | P0-ext, X0, X1 |
| web | `web/` (its tests live in `extension/test/*web*`; that is its only edit there) | B0, B1 |
| win | `windows/` and `rx-windows.yml` | WIN0, WIN1 |
| e2e | `e2e/` and `rx-e2e.yml` | E0, E1 |
| server | `server/` | Wave S changes only, if any |
| reader | the Reader repository on the Mac mini | R0–R4 |

### 6.2 Order

```
Stage A (now, in parallel):  L0 · R0 · P0-core · P0-kit · P0-ext            (P0 per CHANGES-v1.1 §6)
Stage B (after L0):          A0 (after P0-kit) · K0 (after P0-core) · X0 (after P0-ext) · WIN0 · L1
Stage C (W0 apps):           A1 + A2 (after A0; first in line) · K1 (after K0) · B0 (after X0) · E0 (after K1)
        → device round W0 on Rooted 2: iPhone + Mac + Lab Inbox (F17.4, F00.1)
Stage D (W1 ports):          A3 (after A0, L1) · K3 (after K0, L1)
Stage E (W1 apps):           A4 + A5 (after A3; first in line) · X1 (after X0, L1) · K4 + K5 (after K3, K1)
                             · B1 (after B0, X1) · WIN1 (after WIN0, L1) · E1 (after K5)
                             · K6 handover (after K1) · R1 (after K0, K3, K6, R0)
        → device round W1 on Rooted 2 (every F01–F34 device item; R1.1–R1.6)
Stage F (W2):                L2 first, then the W2 ports and apps in the same lane order;
                             Wave S once the Worker is deployed (S0 Inbox lane first, then F37 on iPhone + Mac)
Stage G (W3), then W4:       as in section 4; R2 after L2 + the senders' F06; R3 with F20
```

- **Priority when agents are scarce.** Start tasks in the user's order: iPhone → Mac → Chrome and Safari → Android
  phone → web → DC-1 Inbox → Windows.
- **Pulled forward.** Two Inbox pieces jump the queue because the iPhone and Mac need them on real devices: K1's
  hello and states (W0), and S0 (the server lane, Wave S).
- **What must not wait.** No task waits for a lane it does not depend on.

### 6.3 Shared files and merge order

- **`apple/project.yml`.** A1 and A4 add only iOS targets, A2 and A5 only macOS targets, each in its own block.
  Whoever merges second rebases; the iPhone usually merges first.
- **`android/app`, shared by K4 (sender), K5 (Inbox) and K6 (handover).** Each adds only, in its own blocks:
  - `App.kt`: `Prefs` fields, grouped under a `// Lab: <task>` comment;
  - `AndroidManifest.xml`: new components;
  - `res/values/strings.xml`: one block per task;
  - `ui/SettingsScreen.kt`: rows inside `LabCard` only.

  K4 merges before K5. Rebasing on these files must not change another task's lines.
- **`extension/src/logic.js`** is shared with the web build. X tasks own it. B tasks never edit it; they ask the
  matching X task.
- **Vectors.** Only L tasks edit `share/vectors/*`. A port that finds a vector bug files it to the L lane; it never
  edits the vector.
- **Copy.** `LAB_TEXT` in `daylight-lab.js` is the source. A new string is added there first (L lane), then ported.

### 6.4 Device rounds

After W0 and after W1, and after R1, R2 and R3, the Mac mini session runs the device items of that wave on Rooted 2
with the real ntfy.sh relay:

- iPhone and Mac first, then Android, Chrome, web and Windows (as available);
- the results, with times, go into DEVICE-CHECKS.md;
- the tablet's library goes back to its recorded baseline afterwards, as in rounds 1 and 2.

### 6.5 Decisions for the user (none blocks W0 or W1)

1. **Excerpts as documents.** Until the Lab Reader's quiet import, an excerpt is a document. With Documents = Ask it
   waits for a tap (F11). OK?
2. **The Lab Reader's handover.** The Lab Reader takes receiving over from Daylight Share on the lab tablet (5.3.4).
   Alternatively, both could run, with Daylight Share delivering to the main Reader and the Lab Reader to its own
   library (duplicates in two libraries). The plan assumes the handover.
3. **Send back targets (F06, W2).** Every paired device, or the tablet asks which one (FEATURES §6 Q3).
4. **Server lane first.** S0 is recommended as the first Wave S task, ahead of the rest of the DC-1 Lab work
   (DESIGN 3.1).
