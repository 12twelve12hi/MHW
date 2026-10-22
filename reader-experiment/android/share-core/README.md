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

- `Receiver.Result.limitStatus` (the JS `limited`, 2.7.1): 429 or 413 when the relay refused the poll's ack (or
  digest) publish for its limits, else 429 when it answered a download with 429, else 0. The live path's
  `Receiver.sendAcks(ids)` answers an `AckOutcome` (`published`, `error`, `limitStatus`); `publishAcks` and the
  v1.1 `Result.limited` (a download's 429 or 413) are unchanged.
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
| `LabInbox` | The Inbox side (2.2.4): `record(id, s, t)`, `flush()`, `noteAcksFailed`, `noteRelayLimit`, `notePolled`, `labTurnedOn`, `labTurnedOff`, `digest()` (call it with the v1.1 ack digest), `clear()`. `flush` and the three that flush publish (with the pairing's `RelayClient`, up to about 2 minutes): off the main thread. The others only read and write the store and never wait for a publish in flight |
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
  hello, `schedule` mapped to a delayed flush (replacing any earlier one), `log` to the `DaylightShare` tag. The hello
  is `LabInboxInfo(if (Prefs.lab) Lab.LAB_LEVEL else 0, "android/<versionName>", caps, live = instantDeliveryOn)`,
  with `Prefs.lab` read on each call, never a literal 1: a new or cleared store (a new pairing, Reset pairing) starts
  with Lab on exactly when this `lab` is 1 or more, and would then record and publish states while the Inbox's Lab is
  off. The switch sets `Prefs.lab` first, then calls `labTurnedOn()` or `labTurnedOff()` on a worker. With Lab off, the
  calls below are harmless: `record` answers false, `flush` answers "off", and nothing goes but the `lab: 0` frame
  `labTurnedOff()` sends and its repeats. After each poll, once its acks are out: `notePolled`,
  `noteAcksFailed(result.ackError != null)`, `noteRelayLimit(result.limitStatus)`, `record` each item's state (only
  items of the pairing's inbox topic), then `flush()`. A poll that throws: `noteRelayLimit(e.status)` (a
  `RelayException`'s 429). A live batch: `handleLive(msgs)`, then `sendAcks(result.ackIds)` (not `publishAcks`, which
  drops the status), `noteAcksFailed(out.error != null)`, `noteRelayLimit(out.limitStatus)` and
  `noteRelayLimit(result.limitStatus)`, then record and flush. `noteRelayLimit` ignores anything but 429 and 413. A flush
  answering `error` with no network is the cue for the `lab-flush` job (CONNECTED). Reset pairing: `clear()`.
  *Threads:* `record` and the notes are safe from the hand-off (`HandoffActivity.done`): a flush holds the store's lock
  only to choose its frame and to commit it, never while it publishes. `flush`, `labTurnedOn`, `labTurnedOff` and
  `digest` publish: run them on a worker or the poll's thread.
- *Server:* `DaylightServer(pairing, FileServerStore(File(filesDir, "server.json")), http)`: one file for the app,
  outside `FileOutboxStore.dir`. That directory is per pairing (`files/outbox/<inboxTopic>/`) and `clear()` deletes it
  on re-pairing, but the server's pin, the notices shown and the cached config must outlive a pairing change, or
  `pairing-mismatch` (2.6, DESIGN 4.3) can never show. Discovery runs only with Lab on. After a server call fails with
  a `ServerError`, call `server.noteError(key, err)`. Before re-pairing, `lockBeforeRepair()`, Lab on or off; on Unpair
  and with a new pairing, `clearManualUrl()` (a typed address and the cached status are the old server's), as the web
  and Windows builds do.

**`core.server`** (2.6's W0 subset): `ServerCode` (`deriveSeed`, `format`, `parse`, `derive`, `showFingerprint`),
`ServerBox` (config frames), `ServerConfig.check`, `DaylightServer` (`discover`, `confirmMove`, `setManualUrl`,
`clearManualUrl`, `status`, `state`, `request`, `noteError`, `lockBeforeRepair`, `notice`, `markNoticeShown`,
`serverCode`), `ServerMessages` (`STATE_MESSAGES`, `errorMessage`, `localMessage`, `noticeText`, `stateFromStatus`,
`stateFromError`) and the DESIGN 13.1 keys (`ServerKeys`, `server/pendingMove` included). The setup link and the rest
of the client come with Wave S. `ServerConfig.check` accepts no address the JS `checkConfig` refuses, and gives the
same origin for every one it accepts: a numeric host only as a canonical dotted quad (not `0x7f.1`, `1.2.3` or
`2130706433`, which a URL parser rewrites), IPv6 only in its canonical form, an `xn--` label only when it decodes. It
refuses a few the JS accepts (a host starting with `.`, port 0). The typed Server address (`setManualUrl`) refuses a
host the URL parser would rewrite, where the JS stores the rewritten origin. `ServerVectorsTest.hostsMatchWhatwg` runs
both readings against the JS under node.

## Tests

| Test | Covers |
|---|---|
| `VectorsTest`, `RelayTest`, `LiveRelayTest` | Protocol 1.1: `share/vectors/test-vectors.json`, the mock relay with ntfy.sh's limits, JS interop both ways, a live round trip (informational); the ack publish's 429 and 413 in `limitStatus` and `sendAcks` (2.7.1) |
| `lab.LabVectorsTest` | Every W0 section of `share/vectors/lab-vectors.json` (constants, labTopics, labFrames, labParse, labLedger, labGate, labHeaderExtras, labRowText, labText, v1Safety). labExcerpt, diagnostics and testArticle are W1 sections for K3; a section no test knows fails `everySectionIsPorted` |
| `server.ServerVectorsTest` | `server/vectors/server-vectors.json` › derived, serverCodeParsing, frames (config), negative, serverState (with what `noteError` does to the cache); discovery, the pin and a move, the status cache, the gate's deadline; server addresses read as the JS reads them (`src/test/js/server-origins.mjs`) |
| `lab.LabInboxTest` | 2.2.4 with a fake clock: the merge rule, 24 a frame, 30 s spacing, giving way, the daily cap, halving, hellos, `lab: 0` and its repeats, a new or cleared store with Lab off, the pending cap, the digest; `record`, the notes and `clear` during a publish in flight, and two flushes of one file; the ledger's file and pruning |
| `lab.LabSkewTest` | F17.1 through the mock relay: the Kotlin Lab sender against the v1.0, v1.1 and current JS Receivers and a JS Lab Daylight; the v1.0, v1.1 and Lab JS Senders against the Kotlin Inbox with and without `LabInbox`; two publishers (Kotlin Daylight Share, JS Lab Reader) in both handover orders; Lab extras through the on-disk spool; an ack publish answered 429 or 413 makes the Kotlin Daylight give way for the hour |

The old JS peers are `share/js/test/fixtures/daylight-share-v1.0.js` and `-v1.1.js`; `src/test/js/interop.mjs` drives
them (`MockRelay.jsWith(MockRelay.jsLib("v1.0"), …)`).
