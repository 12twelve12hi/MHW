# Daylight Share protocol

How the "Send to Daylight" apps get links, pages and files to a Daylight through an ntfy relay, end-to-end encrypted.

| Path | What it is |
|---|---|
| `PROTOCOL.md` | The spec: version 1, revision 1.1 |
| `CHANGES-v1.1.md` | Why revision 1.1 changed what it did, finding by finding |
| `NTFY-FACTS.md` | What ntfy.sh measurably does where the protocol depends on it |
| `js/daylight-share.js` | The JavaScript reference implementation (one module, no dependencies); the extension and the web sender ship a copy |
| `js/mock-relay.mjs` | A stand-in for ntfy with ntfy.sh's limits, for tests and demos (`node js/mock-relay.mjs --help`) |
| `js/live-ntfy.mjs` | A live round trip through ntfy.sh, run by CI |
| `vectors/test-vectors.json` | The vectors every implementation must pass, made by `vectors/generate.mjs` |
| `LAB-PROTOCOL.md` | **Lab** (normative): hello and item-state frames on the ack topic, header extras, the return and control lanes, the timeline text, the gate, vectors and CI. Section 2 of `../LAB-PLAN.md`, kept here from L0 on |
| `js/daylight-lab.js` | The Lab reference (one module; it imports only `daylight-share.js`): parser, ledger, timeline text, `LAB_TEXT`, `labGate`, `LabInbox` |
| `vectors/lab-vectors.json` | The Lab vectors every port must pass, made by `vectors/generate-lab.mjs` (deterministic: CI requires no diff) |
| `js/test/fixtures/` | The v1.0 (b48752b) and v1.1 (bb8ccfa) references as they shipped: the old peers of the skew suite. Never edited |

```sh
node --test js/test/*.test.mjs   # unit, mock-relay, Lab, skew and soak tests (the soak takes about 40 s)
node vectors/generate.mjs        # regenerate the vectors after changing the library
node vectors/generate-lab.mjs    # regenerate the Lab vectors after changing daylight-lab.js
node js/live-ntfy.mjs            # needs network access to ntfy.sh
```

## Lab (L0)

The Lab additions are wire-neutral: `v` stays 1, a Lab frame is an ack frame whose `ids` is `[]`, and v1.0 and v1.1
peers ignore it (the skew suite runs the shipped v1.0 and v1.1 modules against Lab peers). `LAB-PROTOCOL.md` is the
spec; `test-vectors.json` did not change.

**`daylight-share.js` (2.7.1), backward compatible:**

- `aadFor(purpose)` is an explicit map (`inbox`, `ack`, `lab-return`, `lab-return-ack`, `lab-control`,
  `lab-control-ack`); `sealFrame`, `encryptFrame` and `decryptFrame` throw `ShareError('purpose')` for any other
  purpose instead of falling back to the inbox AAD. New constants `PURPOSE_LAB_*`, `LAB_STORAGE_KEYS`, `X_CAP_VALUES`.
- `checkItemHeader(h)` adds `extras` (`itemHeaderExtras`: `x-cap` when it is `seen`, `clean`, `excerpt` or `test`;
  `x-orig` when it passes `webUrl`, trimmed; part 0 only). `Reassembler.add` returns `{header, content, msgIds,
  extras}` with `extras` moved out of `header`; `Receiver` passes `extras` to `accept()` and in `items`.
- `new Sender({…, onAckHeader})`: `onAckHeader(header, {time, msgId})` for every decrypted ack-topic frame of kind
  `ack`, in poll order, before rows change; `time` is the relay time in **seconds**; errors are caught and logged.
- `send(item, {defer: true})` stores the row as `failed`/`network` with `attempts` 0 and publishes nothing.
  `flushNetwork({maxFrames = 30, maxAttachmentBytes = 18_000_000})` sends those rows oldest first with
  `resendDue`'s pass rules (F07).
- `applyPairingChange` also removes `LAB_STORAGE_KEYS` (and any other `lab/` key when the storage has `keys()`) when
  the secret changes.
- `Receiver.pollOnce()` also returns `limited`: 429 or 413 when the relay refused an ack publish for its limits.

**`daylight-lab.js` (2.7.2, W0 list):** `buildInboxInfo`, `buildLabFrame`, `parseLabAck` (2.2.5 exactly),
`LabLedger` (per publisher; `snapshot()` reads it all at once) and `labHook`, `describeLabRow`, `labRowA11yLabel`,
`wantsFastChecks`, `checkedInText`, `inboxLabText`, `LAB_TEXT`, `needsMessage`, `labGate`, `deriveLabTopics`,
`LabInbox` and `LabInboxSim`. The extension, web and Windows builds copy it next to `daylight-share.js`; every export is
a single `export const|function|class`, which their classic bundle needs (a test checks it).

**Choices the reference made where LAB-PROTOCOL leaves room** (the vectors pin them; ports follow):

- `LabLedger.record(header, {time})` takes the relay time in seconds and stores ms; it ignores a header whose `kind`
  is not `ack` (`heard` included). It keeps at most 1,000 states between `prune()` calls (the lowest `t` go first);
  `prune(ids)` keeps 200. `caps()` is sorted.
- `describeLabRow`: rule 5 needs `inboxLab` and `hasCap('st')` (F17); `ctx.hasCap` may be a function or a token list
  (absent: `inboxLab` alone decides). Rows of rules 1 and 4 have `final: false`, so their sentence shows as in v1.1.
  "Waiting for connection" has no button. `ctx.state` may be `{s, t}` or a bare token.
- `labGate` returns `{ready, state, message, short, button}`. With Lab off: `state: 'lab-off'` and "Turn on Lab in
  {app} to use this.". Only F01 needs an Inbox capability (`st`). A feature may be named by its id or by a server key
  (`labGate('files')`). An unknown server state is `error`. When the 5 s deadline decides `OFFLINE`, the message comes
  from `ctx.serverMessage` (pass the server module's `localMessage`); `daylight-lab.js` never imports the server module.
- `needsMessage`: the server's states take the server module's text (`message`); `needs-notifications` on a platform
  without a settings path (Chrome, Safari, web) is the first sentence alone.
- `LabInbox` (storage key `lab/out`): one frame per `flush()`; the order is the `lab: 0` frame, digest frames, states,
  then a due hello. The 30 s spacing and giving way apply to every Lab frame; the daily cap counts hellos and state
  frames only. `record()` beats both the pending and the last published entry for the id, and does nothing while Lab
  is off; turning Lab off drops pending states. `buildLabFrame` writes `lab` 0-99 (99 for the worst-case vector).
- `flushNetwork`: a pass always takes its first row, so a row over the caps cannot block the queue; rows older than
  7 days are left to `resendDue`.

**Test hooks.** `startMockRelay({...NTFY_SH_LIMITS})` (or `--ntfy-limits`) turns on ntfy.sh's per-visitor request,
message and bandwidth buckets; `state.publishLog` and `state.limited` record what passed and what got a 429.
`LabInboxSim` is a Lab Daylight for tests (`reader` for links and pages, `handed` for files unless `stateFor` says
otherwise). The soak (`lab-skew.test.mjs`) prints its daily message counts; CI copies them to the run summary.

## Changelog

### 1.1 (revision 1.1 of protocol version 1)

No byte on the wire changes: v1.0 and v1.1 senders and receivers work with each other. What changed:

- **Sizes for ntfy.sh's real limits** (2 MB per attachment, 20 MB per sender): chunks of 1,900,544 bytes, items of at
  most 9,000,000 bytes before compression ("Files can be up to 9 MB"), so every frame is at most 1,966,116 bytes.
  Receivers still accept v1.0's 12 MiB chunks.
- **Relay answers are classified**: `network` (retried with backoff), `full` (413) and `refused` (other 4xx), both
  retried after 185 minutes and given up after the third in a row. A re-send pass stops after a 429 and sends no
  attachment after a 413. Attachment items are re-sent at 185 minutes twice, then every 12 hours.
- **Receiving is robust**: download outcomes (expired, junk, retry), a 30-minute cursor overlap, a cursor held at
  incomplete items and failed downloads, the item stored before it is remembered or acked, acks of at most 70 ids
  (always a message), a 12,713,984-byte download cap, a bounded inflate, a 64 MiB poll cap.
- **One rule each**, pinned by vectors, for web URLs, relay URLs and safe file names (now also capped at 200 UTF-8
  bytes), and one status vocabulary for every app (`describeRow`).
- **Pairing by link asks first**; the same secret keeps the outbox, a different one deletes it.
- **The mock relay behaves like ntfy.sh** by default and has test hooks; the vectors gained `relays`, `sizing`,
  `urls`, `invalidItems`, `fileNamesUtf16`, `acks`, `statusText`, `formatMB` and `pairingConfirmation`.
- **After review** (no wire change): the relay rule refuses whitespace or control characters inside, a host that does
  not start with a letter or digit, and an IPv6 zone id, and compares the default port as text (`:0443` stays); the
  library names a relay by `relayHost()` (host and port, as text) and has `applyPairingChange()` for the outbox rule;
  `attemptStarted` is saved after every accepted frame, the last included; the mock's per-file limit defaults to
  the 2,000,000 bytes PROTOCOL 3.5 promises; the live check counts only accepted frames; 29 more tests pin the
  cursor holds, caps, answer mapping, counters, retry rules, pass breakers and locks.

#### Notes for ports (Kotlin, Swift, the extension and the web sender)

- **Copy.** Every user-facing sentence uses ’ (U+2019), "…", "·" and "✓", including the ones no vector pins (the
  Inbox sentences, the relay check's sentences, the share-time messages). The record's tables use ASCII for
  legibility (CHANGES-v1.1 2.5).
- **Vectors.** `formatMB` is its own top-level group (not inside `statusText`). `sizing` also carries `maxHeader`.
  `statusText` has 14 cases: the 12 rows of 2.5 plus a `failed` and an `expired` row saved by v1.0, which have no
  `errorCode` (read it as `''`; the failed one shows "Retry now"). `pairingConfirmation` (11 cases) pins what an app
  does with an incoming pairing: its `relay` inputs are raw (normalise them first), a relay is named by the
  normalised relay's host and port as text (`relay.example.org:8443`, `[::1]:8080`; Kotlin's `URI.host` and Swift's
  `URL.host` drop the port, so do not use them), secrets are compared on all 16 bytes, and the copy is "Sends
  through <host>.", "Pair with <name or 'a Daylight'>?" and "This replaces <name or 'your current Daylight'>. …".
  The web sender's `confirm()` (CHANGES-v1.1 6.4) is "Pair this page with <name>?" followed by the same `lines`.
- **Relays.** The `relays` vectors pin the edge cases a URL parser would decide differently (see their note).
- **Mock relay.** Defaults: 2,000,000 bytes per attachment, 20,000,000 per visitor; pass `--attachment-max 2097152`
  to mirror ntfy.sh exactly. `since=<message id>` is kept from the v1.0 mock and now answers an unknown id with
  everything, as ntfy.sh does; no client uses id cursors.
- **Pairing change.** `applyPairingChange(storage, current, next)` is the outbox rule of PROTOCOL 3.3 step 6 under
  the sender lock: the same secret keeps the outbox, another secret (or none before) deletes `outbox`, every
  `outbox/<id>` and `ackSince`.

#### JS API changes from 1.0 (`js/daylight-share.js`)

- Constants: `CHUNK` 12,582,912 → 1,900,544; `MAX_ACK_IDS` 200 → 70. Removed `MAX_ENCODED`, `RESEND_ATTACHMENT_MS`.
  Added `MAX_ITEM`, `MAX_DECODED`, `MAX_HEADER`, `MAX_ATTACHMENT`, `MAX_POLL_RESPONSE`, `CURSOR_OVERLAP_S`,
  `ATTACHMENT_WAIT_MS`, `RESEND_FAST_WINDOW_MS`, `RESEND_SLOW_MS`, `SLOW_FAIL_LIMIT`, `SENDING_STALE_MS`,
  `CONTENT_KEEP_MS`, `OUTBOX_MAX_ROWS`, `SEEN_MSG_TTL_MS`, `INCOMPLETE_TTL_MS`, `TIMEOUT_SHORT_MS`, `TIMEOUT_LONG_MS`.
- `ShareError(code, message, reason, status = 0)` gains `.status`. Publish errors are `network` (no answer, with
  `status` 0, or 408, 429 or 5xx), `full` (413) or `refused` (any other 4xx), no longer `too-large`/`relay`.
- New: `formatMB`, `tooBigMessage`, `samePairingSecret`, `pairingConfirmation`, `relayHost`, `applyPairingChange`,
  `describeRow`.
- Changed: `normalizeRelay` (textual rule; errors instead of guessing), `webUrl` (textual rule, no `new URL()`),
  `safeFileName` (200 UTF-8 bytes, leading dots, extension rule), `inflateRaw(bytes, limit)` (bounded; throws
  `integrity`), `encryptFrame` (throws `header` over 65,536 bytes), `buildItemFrames` (`too-large` over `MAX_ITEM`
  before compression; `MAX_ENCODED` check gone), `buildAckFrame` (70 ids), `checkItemHeader` (page/file `size` caps).
- `Reassembler({now})`: `add(header, body, {time, msgId})` returns `{header, content, msgIds}`; new `isPending`,
  `drop`, `prune`; integrity errors carry `msgIds`.
- `RelayClient({relay, fetch, timeouts: {short, long}, retryDelaysMs})`: `publish` follows the 3.1 table (no in-call
  retry for 429); `poll` returns `{id, time, attachment, outcome, frame}` with `outcome` `frame`, `skipped`,
  `expired`, `junk` or `retry`, applies the download rule and caps, and throws `network` or `relay`.
- `Sender({…, timeouts, retryDelaysMs})`: rows gain `errorCode`, `slowFails`, `attemptStarted` (`list()` fills them
  in for v1.0 rows); `send` refuses over 9 MB without storing anything and publishes once even when the content copy
  fails; `retry(id)` re-sends `failed` rows, restarts `expired` ones with code `''`/`full`/`refused`, and returns any
  other row unchanged; `resendDue()` returns the rows it attempted; new `remove(id)`; every method takes a lock shared
  by all Senders on the same storage object.
- `Receiver({…, accept, timeouts, retryDelaysMs})`: `pollOnce()` returns `{items, acked, ackError, storeError}`,
  never throws because of acks, and keeps `incomplete` in storage.
- Mock relay: `startMockRelay` gains `visitorAttachmentTotalBytes`, `attachments`, `early413`, `control`,
  `failDownload`, `failPublish`; `state` gains `visitors`, `downloadsById`; `attachmentMaxBytes` defaults to
  2,000,000 (was 15 MiB).

### 1.0

The first version.
