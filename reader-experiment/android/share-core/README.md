# share-core: the Daylight Share protocol in Kotlin

Plain Kotlin/JVM, no Android classes and no dependencies, so the Android app and the Daylight Reader can both embed
it. It follows `share/PROTOCOL.md` (revision 1.1) and, for Lab, `share/LAB-PROTOCOL.md`, under the names of the
JavaScript references (`share/js/daylight-share.js`, `share/js/daylight-lab.js`, `server/client/daylight-server.js`),
and passes their vectors.

```
./gradlew --no-daemon --max-workers=2 -Pdls.skipApp=true :share-core:test   # needs node 22 for the mock relay and JS interop
```

| Package | What |
|---|---|
| `com.daylight.share.core` | The protocol: `Pairing`, `Keys`, `FrameCodec`, `ItemHeader`, `ItemBuilder`, `Reassembler`, `RelayClient`, `Outbox` (sender), `Receiver` (Inbox), `RowText`, `PairingConfirmation`, `RelayProbe` |
| `…core.lab` | Lab (K0, Wave 0): frames, the sender's ledger, the Inbox's hellos and states, the copy, the gate, the timeline text |
| `…core.server` | The Daylight server client, the W0 subset of LAB-PLAN 2.6 |

## Lab (LAB-PLAN K0)

Nothing here changes the wire: Lab frames are ack frames whose `ids` is `[]`, and Lab item fields are `x-` fields.
Every v1.0 and v1.1 peer keeps working (`LabSkewTest`).

**Protocol additions (2.3, 2.7.1).** All backward compatible:

- `ItemHeader.extras`: the Lab item fields `ItemHeader.check` reads from part 0 (`x-cap` when it is `seen`, `clean`,
  `excerpt` or `test`; `x-orig` when it passes the web URL rule; every other `x-` field dropped). `Reassembler`
  carries them (in memory and through the on-disk spool), `Reassembler.Completed.extras` and `Receiver.Result.items`
  hand them on. `toJson()` writes them on part 0 only; an empty map writes nothing, so v1.1 headers are unchanged.
- `Outbox(…, onAckHeader = …)`: an `AckHeaderListener` that sees every decrypted ack-topic frame whose kind is `ack`,
  before rows are updated. What it throws is logged and ignored.
- `Purpose` has the Lab lanes' AADs (`LAB_RETURN`, …) and `Purpose.of(name)`, which throws `ShareException("purpose")`
  for an unknown name.
- `FileOutboxStore.labFile` (`lab.json`) is the sender's ledger; `FileOutboxStore.clear()` (a pairing with another
  secret) removes it with the outbox.

**`core.lab`:**

| Class | Use |
|---|---|
| `Lab` | Constants (`LAB_LEVEL`, caps, state ranks, the 2.2.4 budget), `publisherOf`, rule D `parseTime` |
| `LabInboxInfo`, `LabState`, `LabFrame` | `LabFrame.build` (hellos and state frames, sealed like acks; refuses over 24 states and anything not small) and `LabFrame.parse` (2.2.5 exactly; never throws) |
| `LabLedger` | The sender's ledger, per publisher (2.2.6). `LabLedger.of(outboxStore)`, then `Outbox(…, onAckHeader = ledger.hook())`. `snapshot()` gives `inboxLab`, `caps`, `hasCap`, `checkedIn` and the states; `prune(ids)` with the outbox's ids |
| `LabInbox` | The Inbox side (2.2.4): `record(id, s, t)`, `flush()`, `noteAcksFailed`, `noteRelayLimit`, `notePolled`, `labTurnedOn`, `labTurnedOff`, `digest()` (call it with the v1.1 ack digest), `clear()` |
| `LabText` | Every Lab string (`LabText["switchFooter"]`, …) and its helpers: `needsMessage`, `short`, `button`, `serverRowSubtitle`, `serverFeatureShort`, `serverMovedText`, `setupConfirmText`, `labInboxSeenText`, `aiTodayText`, `checkedInText`, `inboxLabText`, and the W1 ones labText pins (`inboxKindLine`, `cleanedFromText`, `labUseOn`) |
| `LabRowText` | The delivery timeline (2.5): `LabRowText.of(row, now, LabRowText.Context.of(lab, ledger.snapshot(), row.id))` -> label, sentence, action, step line, final, `a11yLabel` |
| `LabGate` | A feature's gate (1.5): `LabGate.run(feature, LabGate.Context(lab, paired, hasCap, local, server, …))`, with the 5 s server deadline. Blocking: call it off the main thread |
| `LabTopics` | The return and control lanes' topics (2.4), for W2 and W3 |

`LabStrings.kt` is generated from `LAB_TEXT`: after the share lane changes a string, run
`node scripts/lab-strings.mjs` (`--check` says whether it is current). Never edit a string here: `LabVectorsTest`
pins every one to `share/vectors/lab-vectors.json`.

**Wiring it into the app (K1).**

- *Sender:* `LabLedger.of(store)` and `onAckHeader = ledger.hook()` on the `Outbox`, whether Lab is on or off. Screens
  read `ledger.snapshot()`: What's in Lab's header is `LabText.inboxLabText(snap.inboxLab, snap.checkedIn, now)`.
- *Inbox:* one `LabInbox` per pairing, its store `FileLabStore(files/inbox/lab-<inboxTopic>.json)`, `info` the current
  hello (`LabInboxInfo(1, "android/<versionName>", caps, live = instantDeliveryOn)`), `schedule` mapped to a delayed
  flush (replacing any earlier one), `log` to the `DaylightShare` tag. After each poll or live batch, once its acks are
  out: `notePolled`, `noteAcksFailed(result.ackError != null)`, `noteRelayLimit(429)` when `result.limited`, `record`
  each item's state (only items of the pairing's inbox topic), then `flush()`. A flush answering `error` with no
  network is the cue for the `lab-flush` job (CONNECTED). Reset pairing: `clear()`.
- *Server:* `DaylightServer(pairing, FileServerStore(file next to the outbox), http)`; discovery runs only with Lab
  on. After a server call fails with a `ServerError`, call `server.noteError(key, err)`. Before re-pairing,
  `lockBeforeRepair()`, Lab on or off.

**`core.server`** (2.6's W0 subset): `ServerCode` (`deriveSeed`, `format`, `parse`, `derive`, `showFingerprint`),
`ServerBox` (config frames), `ServerConfig.check`, `DaylightServer` (`discover`, `confirmMove`, `setManualUrl`,
`clearManualUrl`, `status`, `state`, `request`, `noteError`, `lockBeforeRepair`, `notice`, `markNoticeShown`,
`serverCode`), `ServerMessages` (`STATE_MESSAGES`, `errorMessage`, `localMessage`, `noticeText`, `stateFromStatus`,
`stateFromError`) and the DESIGN 13.1 keys (`ServerKeys`, `server/pendingMove` included). The setup link and the rest
of the client come with Wave S. `ServerConfig.check` reads hosts more strictly than a WHATWG parser (letters, digits,
`-`, `_` and `.`, or a bracketed IPv6 address), which every Worker address passes.

## Tests

| Test | Covers |
|---|---|
| `VectorsTest`, `RelayTest`, `LiveRelayTest` | Protocol 1.1: `share/vectors/test-vectors.json`, the mock relay with ntfy.sh's limits, JS interop both ways, a live round trip (informational) |
| `lab.LabVectorsTest` | Every W0 section of `share/vectors/lab-vectors.json` (constants, labTopics, labFrames, labParse, labLedger, labGate, labHeaderExtras, labRowText, labText, v1Safety). labExcerpt, diagnostics and testArticle are W1 sections for K3; a section no test knows fails `everySectionIsPorted` |
| `server.ServerVectorsTest` | `server/vectors/server-vectors.json` › derived, serverCodeParsing, frames (config), negative, serverState (with what `noteError` does to the cache); discovery, the pin and a move, the status cache, the gate's deadline |
| `lab.LabInboxTest` | 2.2.4 with a fake clock: the merge rule, 24 a frame, 30 s spacing, giving way, the daily cap, halving, hellos, `lab: 0` and its repeats, the pending cap, the digest; the ledger's file and pruning |
| `lab.LabSkewTest` | F17.1 through the mock relay: the Kotlin Lab sender against the v1.0, v1.1 and current JS Receivers and a JS Lab Daylight; the v1.0, v1.1 and Lab JS Senders against the Kotlin Inbox with and without `LabInbox`; two publishers (Kotlin Daylight Share, JS Lab Reader) in both handover orders; Lab extras through the on-disk spool |

The old JS peers are `share/js/test/fixtures/daylight-share-v1.0.js` and `-v1.1.js`; `src/test/js/interop.mjs` drives
them (`MockRelay.jsWith(MockRelay.jsLib("v1.0"), …)`).
