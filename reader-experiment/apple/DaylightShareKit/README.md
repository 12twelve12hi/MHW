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
| `LabCenter.swift` | Everything the screens ask, off the main thread: the server probe (cached), What's in Lab's overview, the server section, the setup link, the server address, `lockBeforeRepair()`. |
| `Server/` | The Daylight server client, W0 subset (2.6): `ServerCode` (Server code, derivation, `ServerBox`, `ServerConfig`, setup link: `SETUP_HOST`, `parseSetupLink`, `deriveSetupToken`), `ServerMessages` (states, error texts, `noteError`'s mapping), `DaylightServer` (discovery on the config topic, the TOFU pin and move, status cached 10 min, `setup(link:)`, the manual address, notices). |

Other changes: `ItemHeader.extras` (`x-cap`, `x-orig` on part 0, 2.3), `ShareSender(onAckHeader:)` (every decrypted
ack frame's header, before its ids count), `SharedStore` keys `dls.lab` and `dls.labNoteShown`, and Lab frame purposes
in `FramePurpose`.

## DaylightShareUI

- `AppModel.lab` is a `LabModel` (observable; reads and writes off the main thread). `AppModel.refresh()` prunes the
  ledger to the outbox. The status dump (`-DLSStatusDump`, `debug-status.json`) adds `lab`, `caps` and `labStates`.
- `LabSettingsSection(lab:)`: the first section of Settings (switch with identifier `lab-switch`, its footer, and while
  on "What’s in Lab ›" and "Daylight server ›"). Its rows are navigation links: the settings need a `NavigationStack`.
- `WhatsInLabView(lab:footer:useSwitch:onOpen:onOpenSetting:)`: short states only; the server group is always listed
  and never greyed; a tap runs the gate and shows its one sentence (`LabNote`). The ad-hoc Mac passes
  `footer: LabText.adHocMac`; `useSwitch` is for W1's Use switches.
- `ServerSettingsView(lab:)`: the server section, where setup happens.
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
- Apps call `lab.center.lockBeforeRepair()` before they re-pair.

## Tests

`LabVectorTests` (every section of `share/vectors/lab-vectors.json`; the W1 sections are listed as A3's),
`ServerVectorTests` (`server/vectors`, the W0 subset), `LabLedgerTests`, `DaylightServerTests` (the client's flows on a
stub network) and `LabSkewTests` (F17: Swift's sender with and without the ledger against the JS reference as the
Daylight through the mock relay, v1.0 and v1.1 peers, a Lab Inbox, two publishers in either order, Lab turned off).
The skew suite drives `../scripts/e2e-receiver.mjs`, whose Lab options are:

```
node e2e-receiver.mjs <relay> <code> [--peer v1.0|v1.1] [--lab [--state <s>] [--app <app>] [--caps a,b]
                                      [--hello <app> [--hello-caps a,b]] [--lab-off]]
```
