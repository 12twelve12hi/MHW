# Daylight Share Lab: protocol additions

*Normative from L0 (Oct 21, 2026). This file is section 2 of `../LAB-PLAN.md` ("Shared foundations"), copied verbatim
from revision 2 of the plan. From now on this copy is the normative text: a change to the Lab wire, the ledger, the
timeline text or the gate is made here (share lane) first. Section numbers below are the plan's: 2.x are in this file,
and 0.x, 1.x, 3.x–6.x are in `../LAB-PLAN.md`. "PROTOCOL" is `PROTOCOL.md` (revision 1.1), "DESIGN" is
`../server/DESIGN.md`.*

*Section 2.9 (W1's reference functions: smart intake, excerpts, Setup check, Use switches) was added by L1 on Oct 22,
2026, with `vectors/normalise.json`.*

*The JavaScript reference is `js/daylight-lab.js` (2.7.2) with the 2.7.1 changes in `js/daylight-share.js`, and the
vectors are `vectors/lab-vectors.json`, made by `vectors/generate-lab.mjs`. Where the reference had to choose
something this text leaves open, the choice is listed in `README.md` › "Lab (L0)" and pinned by the vectors.*

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
- `Receiver.pollOnce()` returns `limited`: `429` or `413` when the relay refused the poll's ack publish for its
  limits, else `429` when it answered an attachment download with `429`, else `0`. It is the receive side's report
  of "any `429` or `413` from the relay" (2.2.4): the Inbox passes it to `LabInbox.noteRelayLimit` (F17, K1).
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
export const LAB_TEXT = { /* every string of 1.4, 1.6, 2.5 and the 2.6 section, keyed; LAB_TEXT.short holds the
                              short states, LAB_TEXT.serverSection the Daylight server section's own lines */ };
export function needsMessage(state, { app, platform, feature, short = false } = {}) {}
export function serverRowSubtitle(state) {}                            // 1.1: "Optional · Not set up" (heading form)
export function serverFeatureShort(state, headingState) {}             // 1.4: the row's short state, or null
export function serverMovedText(moved) {}                              // 2.6: "Your Daylight server moved to {host}. Use it?"
export function labInboxSeenText(lastSeen, now) {}                     // 2.6: "Lab Inbox last seen {rel}" or the not-yet line
export function aiTodayText(used, cap) {}                              // 2.6: "AI today: US${used} of US${cap}"
export function setupConfirmText(server) {}                            // 2.6: "{host} will get this pairing’s Server code. …"
export function hostLineText(host, fingerprint) {}                     // 2.6: "{host} · {fingerprint}" (one side empty: the other)
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
| `labText` | Every string id → text (a list joined with ","), with the per-platform variants of 1.6 and the short states of 1.4; `serverSection.steps` is the five setup steps as an array of five strings, the form to pin (four contain commas, so the joined form can't be split) |
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


### 2.9 W1 reference functions (L1)

*Added by L1 (Oct 22, 2026). Normative for the W1 ports (A3: `ShareNormaliser`, `Excerpt`; K3: `Normalise`, `Excerpt`).
These rules come from LAB-PLAN F11, F16 and F26 and the user's answers of Oct 22 (6.5 Q1 = b, Q5 = yes); where those
leave room, the choice below is pinned by `vectors/normalise.json` and the `labExcerpt`, `diagnostics`,
`testArticle` and W1 `labText` sections of `vectors/lab-vectors.json`. Every rule is textual (no URL parser, no DOM),
so all three languages agree. **Whitespace** is ECMAScript's `\s`: U+0009–000D, U+0020, U+00A0, U+1680, U+2000–200A,
U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF (Kotlin's and Swift's defaults differ: spell the set out).
**Characters** are Unicode code points. **Percent-decoding** is UTF-8 with `+` left as `+`; an invalid escape or
invalid UTF-8 counts as a failure.*

**2.9.1 Smart intake (F16).** `normaliseShare({text, url, subject, source, clean})` → `{kind, url, title, excerpt,
orig}` (`clean` is true unless it is `false`: F16's Use switch, 2.9.6):

1. **Finding the URL** (`findShareUrl`). Each run of characters other than whitespace, `<`, `>` and `"` that starts
   with `http://` or `https://` (any case), in order: drop a trailing `. , ; : ! ? ' " » ” ’`, or a trailing `)` or
   `]` while the run holds fewer `(` than `)` (`[` than `]`), until neither applies; the first result that passes the
   web URL rule unchanged is the URL.
2. **Link or excerpt** (`classifyShare`). The URL is `url` when it passes the web URL rule, else the one found in
   `text`; `rest` is `text` without the found URL's characters, trimmed. **Except for a selection given with its page
   URL** (`source` is `selection` and `url` passes the web URL rule: a Safari selection, "Send as excerpt"): the found
   URL is taken out only when it equals that URL (`url` trimmed, character for character); otherwise `rest` is all of
   `text`, trimmed, so a link inside the selection stays in the excerpt, and a selection that is only a link is an
   excerpt of that link. (*Changed Oct 22 after review: the found URL was always taken out, so "Visit
   https://a.example/x" with the page URL became "Visit".*) Chrome on Android's shared selection has no `url`, so its
   URL is still taken out. Then, in order: `source` is `selection` →
   `excerpt` of `rest` (`note` without a URL; `link` when nothing is left, `none` when there is no URL either), where,
   when the URL's fragment holds `:~:text=` (Chrome on Android shares a selection as `"…"` + line feed + URL with a
   text fragment), `rest` first loses one pair of surrounding quotes (`"…"`, `“…”`, `'…'`, `‘…’`, `«…»`, `„…“`) and,
   when that leaves nothing, is the fragment's text (`textFragmentText`: the first `text=` directive after `:~:`,
   split on `,`, a first part ending in `-` and a last part starting with `-` dropped when more than one part is left,
   each part percent-decoded (kept as it is when that fails) and trimmed, empty parts dropped, joined with ` … `); no
   URL → `note` of `rest` (`none` when empty); otherwise `link`. Under 6.5 Q1 = (b) only an explicit selection makes
   an excerpt: **a text fragment alone does not** (Google adds them to result links, so "Title" + line feed +
   URL`#:~:text=…` is an ordinary headline + link share, and keeps its title), and **there is no word-count rule**
   (plan rule 4, 40 words or 3 sentences, is off), so every headline + link share is a link. (*Changed Oct 22 after
   review: an earlier draft of this section made any text-fragment URL an excerpt.*)
3. **Cleaning** (`cleanShareUrl`), for every kind with a URL, unless `clean` is false (then the URL stays as found or
   given, and `orig` is null): up to 5 unwrap steps, each result kept only when it
   passes the web URL rule (and differs), then tracking removal. Host comparisons are on the lowercased host
   (`authority` after the last `@`, without the port); "host is D" means equal to D or ending in `.D`.
   - `(www.)?google(.xx){1,2}` with a path starting `/amp/s/` → `https://` + the rest (path, query and fragment);
     path `/url` → the first of the parameters `q`, `url` whose decoded value passes the web URL rule;
   - a host ending in `.cdn.ampproject.org`: path `/c/s/…` or `/v/s/…` → `https://…`; `/c/…` → `http://…`;
   - `l.facebook.com` or `lm.facebook.com` with path `/l.php` → parameter `u`; `l.instagram.com` with path `/` or
     empty → `u`; `www.linkedin.com` or `linkedin.com` with path `/safety/go` (or `/safety/go/`) → `url`;
   - `open.substack.com` with path `/pub/<pub>/p/<slug>[/…]` (`<pub>` of `A-Z a-z 0-9 -`) →
     `https://<pub lowercased>.substack.com/p/<slug>[/…]`, query and fragment kept;
   - tracking parameters, compared by their raw name (before `=`, not decoded, case-sensitive): every name starting
     `utm_`, the list `TRACKING_PARAMS`, and per site `TRACKING_BY_SITE` (`si` on youtube.com, youtu.be and
     open.spotify.com; `s` and `t` on twitter.com and x.com; `smid` and `smtyp` on nytimes.com; `r`, `triedRedirect`
     and `showWelcome` on hosts ending in `.substack.com`). When none is present the URL is returned byte for byte.
     Otherwise the query is rebuilt from the remaining non-empty pieces, in order, joined with `&`, and loses its `?`
     when nothing is left; scheme, authority, path and fragment are untouched.
4. **Title** (links only): `subject` through `cleanTitle` when not empty, else `shareTitle(rest)`: the empty pairs
   `()`, `[]`, `<>`, `""`, `“”`, `‘’`, `«»` (only whitespace inside) become a space; whitespace runs become one space;
   then until nothing changes: whitespace, `- – — : | ·` and the quotes `" ' “ ” ‘ ’ « » „` are trimmed from both ends,
   `. , ; ! ?` from the start, and `. , ; ! ?` from the end when a space precedes them; then `cleanTitle`. Empty →
   null. Excerpts and notes have `title` null and their text in `excerpt`.
5. **`orig`** = the URL as found or given when the cleaned URL differs and it is at most `X_ORIG_MAX` = 1,024
   characters, else null.
6. **Apple News** (`isAppleNewsUrl`: host is `apple.news`) stays as it is in `normaliseShare`. iPhone and Mac fetch it
   once (ephemeral session, no cookies, 3 s) and pass the page to `extractAppleNewsTarget(html)`: the string literal
   argument of the first `redirectToUrlAfterTimeout(` followed by optional whitespace and a quote, with `\uXXXX`,
   `\xXX` and `\c` escapes undone, when it passes the web URL rule; else, after the first `<body` followed by
   whitespace or `>`, the first `<a …>` tag (read as tags are in 2.9.3) whose `href` (quoted or not, character references `&amp; &lt; &gt; &quot;
   &#39; &apos;` and numeric ones undone) passes the web URL rule; else null. Then `normaliseShare` on the result.

**2.9.2 Writing the header fields (2.3).** `buildItemFrames` takes `item.extras` (`labHeaderFields`): `x-cap` only
when it is one of the four values, `x-orig` only when it passes the web URL rule (trimmed) and is at most 1,024
characters. Both go on **part 0 only**. If part 0's frame is large with `x-orig` and small without it, `x-orig` is left
out. `built.extras` says what part 0 carries; without extras the frames are exactly v1.1's. The Sender keeps the
requested extras on the row (`row.extras`, only when there are any), so every re-send writes the same fields.

**2.9.3 Excerpts (F11).** `excerptItem({text, html, url, pageTitle, site, app, date})` → the item to send, or null when
`text` (trimmed) is empty. Both forms carry `extras: {'x-cap': 'excerpt'}`.

- **With a source URL** (passes the web URL rule): `kind: 'file'`, `mime: 'text/html'`, `name` =
  `excerptFileName(text)`, `url` = the source URL when it already holds a text fragment, else `textFragment(url,
  text)`, `title` = `excerptTitle`, `content` = `excerptHtml`.
- **Without one**: `mime: 'text/markdown'`, `name` = `excerptFileName(text, {note: true})`, `title` = `excerptTitle`
  without a page title, `content` = `excerptMarkdown`.
- `excerptFileName`: the first 6 whitespace-separated words joined with one space, in "Excerpt - {words}.html" (or
  "Note - {words}.md"), through `safeFileName`; no words → "Excerpt.html" ("Note.md").
- `excerptTitle`: the first line (split on CRLF, CR or LF) that has text, whitespace runs as one space, trimmed; over
  100 characters it is cut to 100, trailing whitespace removed, and `…` added. Then "“{line}” · {page title}" (page
  title through `cleanTitle`), "“{line}”" without one, the page title alone without a line; through `cleanTitle`.
- `textFragment(url, text)`: the URL without its fragment, then `#:~:text=` and the first 8 words joined with one space,
  UTF-8 percent-encoded except `A-Z a-z 0-9 _ . ! ~ * ' ( )`. The URL unchanged when there are no words, the text
  cannot be encoded (a lone surrogate), or the result is over 4,096 characters or fails the web URL rule.
- `excerptDate(date)`: `YYYY-MM-DD` (fields checked as rule D checks them) → "22 October 2026"; a number of ms or a
  Date → the same from its local date; anything else → "".
- `excerptHtml`: exactly `<!doctype html><html><head><meta charset="utf-8"><title>{title}</title></head><body><article>`,
  a line feed, then `<p>{header}</p><blockquote>{selection}</blockquote></article></body></html>`. `{title}` is
  `excerptTitle`. The source is the URL without its fragment directive (from `:~:` on, and without the `#` when nothing
  precedes `:~:`). `{header}` joins with ` · `: `<a href="{source}">{page title, else the site, else the source}</a>`;
  the site (`site` through `cleanTitle`, else the source's host without a leading `www.`) when it differs from the
  link's text; the date when there is one. Text is escaped `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`; attributes also
  `"` → `&quot;`. `{selection}` is `sanitizeExcerptHtml(html)` when `html` has non-whitespace, else
  `excerptTextHtml(text trimmed)`, followed by `<p>(Excerpt trimmed to 50,000 characters.)</p>` when cut.
- `sanitizeExcerptHtml(html, maxChars = 50,000)` → `{html, trimmed}`:
  1. remove comments (`<!--` to the first `-->`, or to the end), then every `<!…>` and `<?…>` (to the next `>`, or the
     end);
  2. for each name of `EXCERPT_DROP` in order, remove (ignoring case) each `<name` followed by whitespace, `/` or `>`,
     up to the next `>`, and everything after it to the first `</name` + optional whitespace + `>`, or to the end (an
     opening tag with no `>` after it stays, and becomes text in step 3). Scan once, left to right (the reference's
     `dropElement`): once an opening tag has no `>` after it, no later one can, so the pass ends there; a backtracking
     regular expression for this step is quadratic on `<script ` repeated;
  3. tags are `<`, an optional `/`, a name (`[A-Za-z][A-Za-z0-9-]*`, as long as possible: no name character follows
     it), then any run of characters other than `<`, `>`, `"` and `'`, or of whole `"…"` / `'…'` strings with no `<`
     in them, then `>` (so scanning a tag never passes a `<`, and a name is not tried again at shorter lengths: it
     stays linear). Between tags is text: each character is copied and counted,
     except `&` (a character reference `&name;`, `&#digits;` or `&#xhex;` of at most 32, 7 and 6 characters is copied
     and counts as one; any other `&` becomes `&amp;`), `<` (`&lt;`) and `>` (`&gt;`). When `maxChars` characters have
     been copied and any text remains, the rest of the input is dropped and `trimmed` is true;
  4. tag names are lowercased; `EXCERPT_AS_P` become `p`; names outside `EXCERPT_TAGS` are dropped, their text kept.
     `<br>` (any attributes, any `/`) is written `<br>`; `</br>` is dropped. An `a` keeps `href` only when its value
     (the first attribute named `href`, in any case; quoted with `"` or `'`, or unquoted) with character references
     undone passes the web URL rule; it is written `<a href="…">` (attribute-escaped), else `<a>`. Every other kept tag
     is written with no attributes and pushed on a stack of open elements. A closing tag closes the innermost open
     element of that name and every element opened after it (writing their closing tags), and is dropped when no such
     element is open. At the end, every open element is closed, innermost first.
- `excerptTextHtml(text, maxChars)`: CRLF and CR become LF; cut to `maxChars` characters (`trimmed`); lines that are
  only whitespace separate paragraphs; each paragraph is `<p>` + its lines text-escaped and joined with `<br>` + `</p>`.
- `excerptMarkdown({text, app, date})`: the text with CRLF and CR as LF, trimmed; over 50,000 characters it is cut to
  50,000 and followed by a blank line and "(Excerpt trimmed to 50,000 characters.)". Then a blank line and "— shared
  from {app} on {date}" ("— shared on {date}" without an app, "— shared from {app}" without a date, nothing without
  either), then a line feed.

**2.9.4 Setup check (F26).**

- `testArticle({id, device})` → `{id, kind: 'page', url: 'https://daylight.invalid/test/' + id, title, content,
  extras: {'x-cap': 'test'}}`. `title` = "Test article from {device}" (device through `cleanName`, default "Send to
  Daylight"). `content` = `<!doctype html><html><head><meta charset="utf-8"><title>{title}</title><meta
  name="dl:capture" content="test"></head><body><article><h1>{heading}</h1>` + `<p>{pN}</p>` for `LAB_TEXT.testArticle`
  p1 to p6 in order + `</article></body></html>` (text-escaped; no spaces between the tags; one string).
- `redactDiagnostics(text)`, in this order: `daylightserver://` and what follows up to whitespace, `"`, `'`, `<` or
  `>` (any case) → `[server code]`; `SERVER-` (case-sensitive, at a word boundary) and the following run of
  `A-Z a-z 0-9 -` → `[server code]`; a scheme (the whole run of `A-Z a-z 0-9 + . -` before `://`: no such character
  before it, and it may be empty: `(?<![A-Za-z0-9+.-])[A-Za-z0-9+.-]*`) + `://` + what follows up to whitespace,
  `"`, `'`, `<` or `>` → `[url]` (*changed Oct 22 after review: a scheme starting at every word boundary was quadratic
  on `AAAA-` repeated; the run redacts at least as much*); `www.` (any case, at a word boundary) + at least one character up to
  the same stops → `[url]`; `dls-` + 32 hex (any case, word boundaries) → `[topic]`; 4 base32 characters followed by
  six groups of an optional `-` and 4 more (any case, word boundaries) → `[code]`.
- `activityEvent({time, type, id, kind, status, http})` keeps only `{time, type, id8 (the id's first 8 characters),
  kind, status, http}`: no title, URL, name or `from` ever enters the log. `appendActivity` keeps the last 200.
  `activityLine(e)`: ISO time, type, id8, kind, status and http joined with spaces, `-` for an empty field (and for
  `http` 0).
- `diagnosticsReport({app, version, platform, lab, caps, checkedIn, rows, relay, log, now})`: the lines of
  `LAB_TEXT.diagnostics` in order (heading; app; Lab on/off; caps joined with ", " or "nothing heard"; the check-in as
  ISO time and its relative time, or "never"; the outbox counts "sending n · sent n · delivered n · failed n ·
  expired n"; the relay "ntfy.sh" when it normalises to `https://ntfy.sh`, else "custom relay"; "Recent events, oldest
  first:" and the last 50 activity lines, or "none"), joined with line feeds, a final line feed, all through
  `redactDiagnostics`.

**2.9.5 Inbox lines (F03, F11) and item details (2.3).** `inboxKindLine({kind, extras, size, from})`: `x-cap`
`excerpt` → "Excerpt"; `test` → "Test article"; `kind` url → "Link (the Reader downloads it)"; page → "Clean
article" for `clean`, else "Page as you saw it"; file → "Document · {formatMB(size)} MB"; then " · from {from}" when
`from` (through `cleanName`) is not empty. `cleanedFromText(orig)` → "Cleaned from {host}" with the authority's host
and port (lowercased, no user info), or null when `orig` fails the web URL rule.

**2.9.6 Use switches (6.5 Q5).** The rows of `USE_FEATURES` (F03, F04, F08, F10, F16, F33) in What's in Lab carry a
**Use** switch, on by default, with the footer `LAB_TEXT.use.footers[id]` and the accessibility label "Use {feature
name}". `labUseOn(settings, feature)` is false when Lab is off, true for a feature without a switch, else true unless
its switch is off; a missing key is on. Stores, next to `lab`: Apple `dls.labUse.<id>` (Bool), Android `labUse.<id>`,
JS `settings.labUse[<id>]`. Turning a Use switch off keeps that feature's own settings, as turning Lab off does.

Each switch gates exactly this, and nothing else; the rest of the feature follows the Lab switch alone (*added Oct 22
after review*):

| Row | `labUseOn(settings, id)` false means | Not gated (follows Lab alone) |
|---|---|---|
| F03 Pages as you see them | No "Only the link came through" line on the share card (F03.3: 6.5 Q5 names only "F03's hint"). Setup check still lists the line. | The capture: with Lab on, pages always go through `clean-html.js` with `x-cap: "seen"` (iPhone sends `lab.cleanHtml`, the extension calls `cleanHtml`), so turning the switch off never sends scripts or form contents. The footer says so. |
| F04 Share in place | Share › Daylight waits until the item is sent before closing, as v1.1 does. | Options and "Always show Options before sending". |
| F08 Your Daylight in the share sheet | Android publishes no `daylight` share shortcut, and removes the one it published (as Lab off does). | — |
| F10 Send as | No Send as choice, Clean article (Readability), thin-page check or Review: a page goes as the F03 capture. | F11's explicit selections (context menu, Selection mode, a Safari selection) and F34's right-click items, which the user picks one by one. |
| F16 Clean links | `normaliseShare({…, clean: false})` at every entry point: the URL goes as found or given (no unwrapping, no tracking removal, no `x-orig`), and iPhone and Mac do not fetch apple.news pages. | Finding the URL, link or excerpt (`classifyShare`), and titles. |
| F33 Send copied link | No "Send copied link" chip (iPhone, Android) and no "Paste and send" button (Chrome, Safari, web). | The Mac and Windows clipboard command, which the user runs and which offers nothing: it keeps its Lab label and host preview. |

The command line has no Use switches: it is always Lab (2.9.7).

**2.9.7 The command line (F09).** `share/js/bin/daylight-send.mjs`, built into one file by `share/js/bin/build.mjs`;
`../SEND-API.md` is its manual and the list of every entry point.
