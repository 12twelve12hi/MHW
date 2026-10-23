# DaylightShareKit: Lab (W0, W1)

The kit's Lab layer (LAB-PLAN 1, 2; cards A0 and A3). The apps' README (`../README.md`) covers the package as a whole;
this page is what the iPhone and Mac lanes need to put Lab on screen. With `dls.lab` off nothing here shows but the
switch. Wave 1 (A3) is [below](#wave-1-a3).

## DaylightShareKit

| File | What it is |
| --- | --- |
| `Lab.swift` | The protocol's constants (`Lab.level`, caps, states, ranks, limits), `LabInboxInfo`, `LabState`, and `LabFrame`: `build` (the builder's refusals) and `parse`, exactly LAB-PROTOCOL 2.2.5 (rule I, rule D, the 64-entry and 16-cap reads). Lab headers are read with `JSONValue`, a strict JSON parser whose numbers behave like `JSON.parse`'s. |
| `LabLedger.swift` | The sender's ledger (2.2.6): per publisher (`android`, `reader-lab`, `other`) its Lab state, app, caps, poll and check-in; item states by the merge rule; bounded to 1000, pruned to 200. Stored as `lab.json` beside the outbox and removed with it when the phone pairs with another Daylight. `LabLedger(outbox:).hook()` is the sender's `onAckHeader`. |
| `LabText.swift`, `LabStrings.swift` | Every Lab string. `LabStrings.swift` is generated from LAB_TEXT (`share/js/daylight-lab.js`) by `scripts/lab-strings.mjs`; CI runs it with `--check`. A new string goes into LAB_TEXT first (share lane), then `node scripts/lab-strings.mjs`. |
| `LabRowText.swift` | A history row's Lab label and sentence (2.5 rules 1–5), `LabSettings` (the switch: on when never set; `-DLSLab 0|1`). |
| `LabTopics.swift` | The Lab topics (`dlshare/v1/<name>`). |
| `LabGate.swift` | The gate (1.5): Lab, paired, the Inbox's cap, the local check, the server raced against 5 s (→ `OFFLINE`), built. |
| `LabCenter.swift` | Everything the screens ask, off the main thread: the server probe (cached), What's in Lab's overview, the server section, the setup link, the server address, and every pairing change: `pair(_:)` (locks the old pairing's server first, 2.6 "Re-pairing"), `unpair()`, and the re-pairing follow-up `repaired()` / `repairSeen()`. |
| `Server/` | The Daylight server client, W0 subset (2.6): `ServerCode` (Server code, derivation, `ServerBox`, `ServerConfig`, setup link: `SETUP_HOST`, `parseSetupLink`, `deriveSetupToken`), `ServerMessages` (states, error texts, `noteError`'s mapping), `DaylightServer` (discovery on the config topic, the TOFU pin and move, status cached 10 min, `setup(link:)`, the manual address, notices). |

Other changes: `ItemHeader.extras` (`x-cap`, `x-orig` on part 0, 2.3), `ShareSender(onAckHeader:)` (every decrypted
ack frame's header, before its ids count), `SharedStore` keys `dls.lab`, `dls.labNoteShown` and `dls.labRepaired` (the
re-pairing follow-up), and Lab frame purposes in `FramePurpose`.

**Updates keep Lab (1.2, 1.3).** When a build with the App Group first finds it (the ad-hoc Mac app updated to the
Developer ID one), `SharedStore.migrate` moves, paired or not, this device's settings (`dls.comfort`, `dls.lab`,
`dls.labNoteShown`, `dls.deviceName`), each when the group has none of its own. When the group has no pairing, a pairing
moves with everything that belongs to it: `dls.labRepaired`, `outbox.json` and `outbox/`, `lab.json` (the ledger, beside
the ack cursor) and `server.json` (the pin, config and notices); an unpaired Mac's `server.json` (Unpair keeps the pin
and notices) moves when the group has none. A group with a pairing of its own keeps its server state. Tested in
`StorageResolutionTests.testAnUpdateIntoTheGroupKeepsLabAndComfort`.

**Re-pairing (2.6, DESIGN 3.4 and 12.7).** Every pairing change goes through `LabCenter.pair(_:)`: with another secret,
a server that knows the old pairing (a pin, or a typed Server address) gets `POST /v1/admin/lock` with the old token
first, Lab on or off, waiting at most 10 s; the typed address and the cached status go (the pin stays: it tells
pairing-mismatch); then `SharedStore.pair`; and when a server was known, `dls.labRepaired` keeps the follow-up (the
`locked` text, the new Server code with Copy, `RERUN_HELP`, OK) until OK or a ready answer. The kit already routes
`AppModel` (Pair, Switch, a new relay, `-DLSPairLink`), `ShareExtensionModel` and the Safari handler's `setPairing`
(which answers `serverLocked: true`) through it, and `AppModel.unpair()` through `LabCenter.unpair()` (a typed address
is forgotten, nothing is locked). Nothing for the app lanes to call.

## DaylightShareUI

- `AppModel.lab` is a `LabModel` (observable; reads and writes off the main thread). `AppModel.refresh()` prunes the
  ledger to the outbox. The status dump (`-DLSStatusDump`, `debug-status.json`) adds `lab`, `caps` and `labStates`.
- `LabSettingsSection(lab:)`: the first section of Settings (switch with identifier `lab-switch`, its footer, and while
  on "What’s in Lab ›" and "Daylight server ›"). Its rows are navigation links: the settings need a `NavigationStack`.
- `WhatsInLabView(lab:footer:useSwitch:onOpen:onOpenSetting:)`: short states only; the server group is always listed
  and never greyed; a tap runs the gate and shows its one sentence (`LabNote`). The ad-hoc Mac passes
  `footer: LabText.adHocMac`; `useSwitch` is for W1's Use switches.
- `ServerSettingsView(lab:)`: the server section, where setup happens. *Set up with a link* asks first
  (`SetupLinkQuestion`): Set up reads the link and sends nothing; the question names that link's own address
  (`LabText.setupConfirmText`); **Use it** sends that link, never what the field holds by then, and a field that holds
  another link takes the question away (identifier `lab-setup-question`).
- **The re-pairing follow-up.** After Switch, while Lab is on, the window presents it from `appSheets`
  (`AppModel.Presented.repaired`, `LabRepairedSheet`); swiped away, it stays at the top of `LabSettingsSection` until
  OK. `LabRepairedNote(repaired:onOK:)` is public, for a lane that wants it on its main screen too (as the extension's
  send view): show it while `model.lab.repaired` is non-nil, with `onOK: model.dismissRepaired`. A re-pairing made in
  the Share or Safari extension shows in the app's Settings › Lab when they share storage.
- What's in Lab opens with the cached states (`LabModel.openOverview()`: the overview without the network, then with
  it), so a server answer under 10 minutes old shows at once.
- `LabGateButton`, `LabNote`, `LabFirstRunNote` (shows only when `LabModel.noteEnabled`: false in W0), `TimelineRow`
  (W0: label and sentence). A tap shows a local or cached answer's note at once; "Checking your Daylight server…"
  shows (and is said) only for a server feature whose gate is still waiting after 150 ms, as in the JS ports
  (`GateTap`). Each tap's note is a new view, so it is said again.
- **The ad-hoc Mac's Share menu card has its own Lab switch, in the kit** (1.1, F00's Mac edge case): A2 needs no kit
  change for it. `ShareExtensionModel.showsCardLabSwitch` is true on the Mac whenever the card shows its own settings
  (no App Group: the released ad-hoc zip), and the card's settings then start with a `Toggle` named `LabText.lab`
  (identifier `lab-switch`, nothing else carries it), `LabText.switchFooter` under it, then Comfort. It is on by
  default: the card's first start writes `dls.lab = true` in its own storage when the key is missing, and
  `setLab(_:)` saves it there through `LabSettings`. With the App Group the card reads the app's switch (`model.lab`)
  and shows none; the iPhone's card never shows one. `ShareCardSample` cards take Lab from `-DLSLab` (on when not
  given), so the Mac's `needs-pairing` walk sees the switch off. Anything the Mac lane wants under the card's switch
  while it is on goes in `ShareExtensionView(model:labRows:)` (an `AnyView`, nil by default).

## Wave 1 (A3)

The W1 logic is ported from the JS reference (`share/js/daylight-lab.js`, LAB-PROTOCOL 2.9) and pinned to its vectors;
the screens are shared pieces the iPhone and Mac lanes (A4, A5) place. **Everything is opt-in:** with Lab off, and in
a build that turns none of it on, every share, row and frame is v1.1's (the parity baselines and `ShareCardSample` are
unchanged; A3 added no sample cases).

### DaylightShareKit

| File | What it is |
| --- | --- |
| `JSText.swift` | JS-exact text helpers the ports share: Unicode scalars (not Characters), JS `\s`, ASCII `\b` and case folding, code-point equality (`JSText.same`), `decodeURIComponent`, entities, attribute and tag scanners. No `NSRegularExpression`. |
| `ShareNormaliser.swift` | Smart intake (F16, F11 rule 3): `normalise(text:url:subject:source:clean:)` (the JS `normaliseShare`), `classify` (Q1: only an explicit selection is an excerpt; text with no link is a note; a text-fragment link alone stays a link), `cleanShareURL`, `shareTitle`, `findShareURL`, `extractAppleNewsTarget`, and `normaliseFetchingAppleNews` (one ephemeral fetch: 3 s, no cookies, 2 MB; `x-orig` is the apple.news link). |
| `Excerpt.swift` | F11's excerpt documents: `item(text:html:url:pageTitle:site:app:date:)` → HTML or Markdown note (`x-cap: "excerpt"`), with names, dates, text fragments and `sanitize`. |
| `SetupCheck.swift` | F26: `testArticle(id:device:)` (`x-cap: "test"`, `https://daylight.invalid/test/<id>`), `redact` (`redactDiagnostics`), `ActivityEvent` (with `http`), `diagnosticsReport`. |
| `ActivityLog.swift` | The activity log (`lab-activity.json` beside the outbox, last 200 events; removed with the pairing's files). |
| `LabPreferences.swift` | The Use switches (`dls.labUse.<id>`, missing = on; `inUse(_:)` = Lab on and the switch on) and each W1 setting: Always show Options, Tell me when a send fails / it's in my Reader, quick sends, Review before sending, the once-only lines, Send as per site (500 hosts), `shareSheetUsed`, `testArticleID`. Moved into the App Group with the other device settings. |
| `LabShare.swift` | How a Lab share becomes an item: `PageCapture` (GetPage.js's `lab` object), `LabShare.pageInput` (Page as you see it → `x-cap: "seen"`, Clean article → `"clean"`, Link only, Selection → excerpt), `linkInput` / `textInput` (F16 with `x-orig`), `excerptInput`, `copiedLink` (F33, with its host), `defaultMode`, `thinText`, `reviewStats`. |
| `Sender.swift` (changes) | `send(_:compress:defer:)` (F07: stored as failed/network, "Waiting for connection"), `flushNetwork(maxFrames:maxAttachmentBytes:)` (30 frames, 18 MB, oldest first, a 413 stops the pass's attachments), `OutboxRow.http`, `liveBackgroundAttempts` (a row in a background upload is not stale). |
| `OfflineQueue.swift` | F07: `OfflineQueue` (an actor) on a `NetworkPathSource` (`SystemPathSource` = `NWPathMonitor`): defers while offline, flushes on reconnect, passes ≥ 3 min apart. |
| `FrameFileBuilder.swift` | F04: an item's frames written to files in two passes from a file read in 64 KiB pieces (never all of it in memory), equal byte for byte to `ItemBuilder`'s. |
| `BackgroundPublisher.swift` | F04: `start(_:file:pairing:…)` builds the frames and starts background uploads (`com.daylight.share.bg`, task label `<id>:<part>:<attempt>`); `complete(description:status:error:)` reads each answer (parts may finish up to 170 min apart; stale answers are ignored); `BackgroundUploadSession` is the system session (`handleEvents` for the iPhone app delegate). |
| `FailureNotices.swift` | F04's notices: "Couldn't send ‘{title}’ to {name}" (not for the network), the quiet "In your Reader ✓: {title}" (opt-in), `askIfNeeded()` (once, in the app, after a share in place), `localCheck()` → `needs-notifications`. |
| `Frame.swift` (changes) | `ItemInput.extras` → header extras on part 0; `x-orig` is left out when it alone would make part 0 a large frame. |

### DaylightShareUI

- **The share sheet** (`ShareExtensionModel.labFeatures: LabShareFeatures`, all off by default). A lane turns on what
  its build has: `smartIntake` (F03, F10, F11, F16 through `labInput(for:)`), `shareInPlace` (F04's card, when F04 is
  in use), `backgroundPublishing` (hand the uploads to `BackgroundUploadSession` and close; needs the App Group) and
  `linkOnlyHint` (F03.3, iPhone). Lab off ignores all of them.
- **Share in place** (`ShareInPlace.swift`): `ShareInPlaceCardView` ("Sending to {name}", Options for 1.5 s, then it
  sends), `OptionsSheet` (Send as with the thin check, Send as excerpt, Send the link instead), `ReviewView` (the page
  with JavaScript off and in grey, words and size, an editable title). No countdown with Comfort, VoiceOver or Switch
  Control, Always show Options or Review (`ShareInPlace.waitsForSend`; tests set `assistiveOverride`).
- **The timeline** (F01, 2.5): `HistoryRowView(row:lab:showsDetail:onRetry:)` with `LabModel.rowText(_:)` and
  `TimelineRow.showsDetail(_:isNewest:)` (sentence and step line on the newest row and rows that are not final; the step
  line is hidden from VoiceOver), `CheckInHeader(lab:)`. `AppModel` announces "In your Reader ✓, {title}" when the
  ledger confirms `reader` (`Announcer.readerChanges`) and passes them to `AppModel.notices` when set.
- **The queue** (F07): `QueueSection(rows:onCancel:)` ("Waiting to send ({n})", Cancel). The app calls
  `AppModel.startOfflineQueue(path: SystemPathSource())` once; with Lab on, `AppModel.send` defers while offline.
- **Setup check** (F26): `SetupCheckView(app:lines:appName:version:)` with the app's `SetupCheckLine`s (each unmet one
  with its button or Show steps), Send a test article (`AppModel.sendTestArticle()`; ticks Delivered and In your
  Reader), `ActivityLogView`, Copy diagnostics (`AppModel.diagnostics`, redacted).
- **The copied link** (F33): `PasteChip(app:)` (iPhone: `PasteButton`, then "Send {host} to {name}?") and
  `CopiedLinkConfirm` / `AppModel.copiedLink(_:)` for the Mac's Send copied link button.
- **Use switches** (6.5 Q5): `WhatsInLabView(lab:useSwitch: lab.useSwitch(features:))` and `LabModel.settingBinding`
  for each feature's own settings.

### For A4 and A5 (wiring)

- iPhone app delegate: `application(_:handleEventsForBackgroundURLSession:completionHandler:)` →
  `BackgroundUploadSession.handleEvents`; set its `onComplete` to `BackgroundPublisher.complete` (with
  `FailureNotices(center: SystemNoticeCenter.shared, prefs:)`), and call `FailureNotices.askIfNeeded()` when the app
  opens. On each tick, set `ShareSender.liveBackgroundAttempts` to `BackgroundPublisher.liveAttempts()`.
- F04's local check for What's in Lab and the gate: `FailureNotices.localCheck()`.
- Setup check's lines are the app's (iPhone: paired, `shareItem` from `LabPreferences.shareSheetUsed`, Safari
  extension with steps only, notifications, background app refresh; Mac: Share menu, Safari extension, login item,
  Print menu, notifications).

### Not in the kit

- iOS share extensions cannot open other apps: the link-only line has no Open in Safari button on the card (the plan
  puts that action on the app's history row, A4).
- `PasteButton` draws its own label; the chip shows "Send copied link" beside it.

## Tests

`LabVectorTests` (every section of `share/vectors/lab-vectors.json`; the W1 sections are listed as A3's),
`ServerVectorTests` (`server/vectors`, the W0 subset), `LabLedgerTests`, `DaylightServerTests` (the client's flows on a
stub network, re-pairing and Unpair included), `AppModelTests` (Switch locks the old server and presents the
follow-up; Lab off shows nothing; the Share extension and the Safari handler lock too), `StorageResolutionTests` (the
move into the App Group keeps Lab), `LabViewTests` (What's in Lab's cached states first; the setup link's question
names the link Use it sends) and `LabSkewTests` (F17: Swift's sender with and without the ledger against the JS reference as the
Daylight through the mock relay, v1.0 and v1.1 peers, a Lab Inbox, two publishers in either order, Lab turned off).
The skew suite drives `../scripts/e2e-receiver.mjs`, whose Lab options are:

```
node e2e-receiver.mjs <relay> <code> [--peer v1.0|v1.1] [--lab [--state <s>] [--app <app>] [--caps a,b]
                                      [--hello <app> [--hello-caps a,b]] [--lab-off]]
```

W1 (A3): `NormaliseVectorTests`, `ExcerptVectorTests` and `SetupCheckVectorTests` (the `normalise`, `labExcerpt` and
`diagnostics` vectors, the rows' `http`), `LabShareTests`, `OfflineQueueTests` (an injected path monitor; 70 links in
three passes; 9 MB files under 18 MB a pass; a 413), `FrameFileBuilderTests` (frames equal `ItemBuilder`'s;
`testANineMegabyteFileStaysUnderFortyMegabytes` on macOS), `BackgroundCompletionTests` (parts hours apart, stale
answers, 413, the notices), `ShareInPlaceTests` (the card, Options, no countdown for people who need more time, the
thin check, Review, the once-only line, Lab off) and `GetPageScriptTests` (GetPage.js in WebKit: `html` is v1.1's and
the page is untouched; the clean copy has no scripts, on* attributes or form contents; Clean article; the selection).
CI also checks GetPage.js's copies of `share/js/capture/` with `sync.mjs --check`.
