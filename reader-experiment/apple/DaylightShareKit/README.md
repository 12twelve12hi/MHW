# DaylightShareKit: Lab (W0)

The kit's Lab layer (LAB-PLAN 1, 2, card A0). The apps' README (`../README.md`) covers the package as a whole; this
page is what the iPhone and Mac lanes need to put Lab on screen. With `dls.lab` off nothing here shows but the switch.

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
Developer ID one), `SharedStore.migrate` moves this device's settings (`dls.comfort`, `dls.lab`, `dls.labNoteShown`)
into the group when the group has none of its own, and, with a pairing the group lacks, everything that belongs to it:
the device name, `dls.labRepaired`, `outbox.json` and `outbox/`, `lab.json` (the ledger, beside the ack cursor) and
`server.json` (the pin, config and notices). Tested in `StorageResolutionTests.testAnUpdateIntoTheGroupKeepsLabAndComfort`.

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
- `ServerSettingsView(lab:)`: the server section, where setup happens.
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
  while it is on goes in `ShareExtensionView(model:labRows:)` (an `AnyView`, nil by default). Note: the apps' README
  (`../README.md`, "The Lab switch") still tells A2 to put the switch into `cardSettings` itself; it is there now.

## Tests

`LabVectorTests` (every section of `share/vectors/lab-vectors.json`; the W1 sections are listed as A3's),
`ServerVectorTests` (`server/vectors`, the W0 subset), `LabLedgerTests`, `DaylightServerTests` (the client's flows on a
stub network, re-pairing and Unpair included), `AppModelTests` (Switch locks the old server and presents the
follow-up; Lab off shows nothing; the Share extension and the Safari handler lock too), `StorageResolutionTests` (the
move into the App Group keeps Lab), `LabViewTests` (What's in Lab's cached states first) and `LabSkewTests` (F17: Swift's sender with and without the ledger against the JS reference as the
Daylight through the mock relay, v1.0 and v1.1 peers, a Lab Inbox, two publishers in either order, Lab turned off).
The skew suite drives `../scripts/e2e-receiver.mjs`, whose Lab options are:

```
node e2e-receiver.mjs <relay> <code> [--peer v1.0|v1.1] [--lab [--state <s>] [--app <app>] [--caps a,b]
                                      [--hello <app> [--hello-caps a,b]] [--lab-off]]
```
