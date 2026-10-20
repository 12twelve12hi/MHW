# Daylight Share protocol v1.1: decision record

Status: decided, ready to implement. Revision 2: rewritten after two critiques of revision 1 (robustness;
simplicity and product). Section 8 lists every point they raised and what was done with it.

Scope: `reader-experiment/share` (spec, JS reference, mock relay, tests and vectors), `reader-experiment/android`
(share-core and the app), `reader-experiment/apple` (DaylightShareKit and the app UI), `reader-experiment/extension`
and `reader-experiment/web`.

Inputs: the adversarial review (29 confirmed findings), the platform builders' notes (a)–(f), the two critiques, the
ntfy docs (publish.md limits table, subscribe API replay rules, config.md) and the ntfy server source the reviewers
checked (`server_server.go` `handleBodyAsAttachment`, `handleFile`; `message_cache.go`).

---

## 1. Summary

**What is broken.** Version 1 assumes ntfy.sh takes 15 MB attachments. It takes 2 MB each and 20 MB per IP address at a
time. With `CHUNK = 12 MiB`, every page or file whose encoded form is over about 2 MB gets `413`, and the sender then
re-uploads it about once an hour for a week. Several other bugs make delivery unreliable:

- download failures are treated as "expired";
- the 5-second cursor overlap skips slow uploads;
- acks expire before senders that run rarely can read them;
- a 200-id ack turns into an attachment;
- the outbox drops undelivered rows.

There are also security and interop gaps. Deep links pair without asking. The JS receiver follows any attachment URL
with no size cap and inflates without a bound. File names and URLs are validated differently by each implementation.

**What changes.**

1. **One size for every relay.** Senders cut content into 1,900,544-byte chunks and send items of up to **9 MB**
   (9,000,000 bytes before compression). Every frame is then at most 1,966,116 bytes, under ntfy.sh's 2 MB. Two
   copies of the largest item fit in ntfy.sh's 20 MB. There are no per-relay limits, no new link parameters and no
   access token.
2. **Failures are classified, and slow ones are bounded.** The five statuses stay. A failed row carries an error code
   that picks the wait and the sentence:
   - `network` (no connection, 408, 429, 5xx) retries fast;
   - `full` (413) and `refused` (any other 4xx) retry after 185 minutes;
   - the third slow failure in a row ends the row as "Not delivered" with a sentence.

   A re-send pass stops at the first 429 and sends no more attachments after a 413. Attachment re-sends wait until the
   earlier copy has expired: 185 minutes twice, then every 12 hours.
3. **Receiving is robust.**
   - Only 404/410 count as expired, and those are remembered so they are not asked for again.
   - 429, 5xx and network errors hold the cursor. The cursor overlap is 30 minutes.
   - The Daylight stores an item before it remembers or acks it. A failed store costs one download per re-send, not
     one per poll.
   - Acks carry at most 70 ids and are always messages. The Daylight re-publishes a digest of recent ids every 11
     hours and after any failed ack.
   - Parts it already holds are not downloaded again.
4. **Inputs are checked the same way everywhere.**
   - One URL rule, one safe-file-name rule (with a UTF-8 byte cap) and one relay-normalising rule, each pinned by
     vectors.
   - Headers are capped at 64 KiB. Inflating is bounded. Attachment downloads are restricted and capped.
   - A pairing that arrives by link must be confirmed. The outbox follows one rule when the pairing changes.
5. **One status vocabulary.** Every app shows the same labels, sentences and buttons (2.5). The library generates them
   from the row, and vectors pin them.

**What stays.** The wire format is unchanged: magic, nonce, AES-GCM, AAD, header fields, `v: 1`, topics, keys, link
parameters, the small/large frame split and the ack format. Every v1.0 sender and receiver interoperates with every
v1.1 one. All changes are constants, validation and local state.

**What gets worse.** Under v1.0, a self-hosted relay could carry files of up to 64 MiB. v1.1 senders send at most 9 MB
to any relay (2.2).

**Compatibility at a glance.**

| | v1.0 receiver (Inbox) | v1.1 receiver |
|---|---|---|
| **v1.0 sender** | as today | works; its 12 MiB frames still fail on ntfy.sh (a sender bug, fixed by upgrading the sender) |
| **v1.1 sender** | works: frames ≤ 1,966,116 bytes and ≤ 5 parts are within every v1.0 download cap; v1.1 file names are safe under v1.0 rules; v1.1 senders still read a v1.0 Daylight's 200-id ack attachments | works |

---

## 2. Constants and shared rules

### 2.1 Constants

All sizes are in bytes. "Wire" means it affects what other implementations must accept.

| Name | v1.0 | v1.1 | Wire? | Used by |
|---|---|---|---|---|
| `CHUNK` | 12,582,912 | **1,900,544** (29 × 65,536) | no: receivers accept any chunk that fits `MAX_ATTACHMENT` | senders |
| `MAX_ITEM` (replaces `MAX_ENCODED`, 67,108,864 encoded) | — | **9,000,000** bytes of content before compression (the header's `size`) | no | senders |
| `MAX_DECODED` | implicit 268,435,456 | 268,435,456: the largest file `size` a receiver accepts; a page's `size` must be ≤ `MAX_PAGE_HTML` | yes | receivers |
| `MAX_HEADER` | 65,536 in all three, not in the spec | 65,536, in the spec; senders never seal a longer header | yes | all |
| `MAX_ATTACHMENT` | Kotlin 12,713,984 (`CHUNK` + 128 KiB); Swift 16 MiB; JS none | **12,713,984** as a literal (not derived from `CHUNK`), for inbox and ack downloads | yes | receivers, ack readers |
| `MAX_POLL_RESPONSE` | Kotlin 64 MiB; JS and Swift none | 67,108,864 | no | all |
| `MAX_ACK_IDS` | 200 | **70** | yes | Daylight |
| `CURSOR_OVERLAP` | 5 s | **1,800 s** (inbox and ack cursors) | no | all |
| `RESEND_MESSAGE` | 11 h | 11 h | no | senders |
| `ATTACHMENT_WAIT` (replaces `RESEND_ATTACHMENT`, 150 min) | — | **185 min**: the re-send wait of an item with an attachment frame in its fast phase, and the wait after `full` or `refused` | no | senders |
| `RESEND_FAST_WINDOW` | — | 6 h: an attachment item re-sends after `ATTACHMENT_WAIT` while `lastPublish − created < 6 h` (so twice), then after `RESEND_SLOW` | no | senders |
| `RESEND_SLOW` | — | 12 h | no | senders |
| network backoff | 1 min × min(60, 2^attempts) | unchanged; `attempts` now counts failed attempts since the last success | no | senders |
| `SLOW_FAIL_LIMIT` | — | 3: the third `full`/`refused` attempt in a row makes the row `expired` | no | senders |
| `SENDING_STALE` | Swift only: 15 min | 15 min everywhere, from `attemptStarted` | no | senders |
| `OUTBOX_EXPIRY` | 7 d | 7 d | no | senders |
| `CONTENT_KEEP` | JS: dropped at expiry; Kotlin: 14 d after `created`; Swift: 30 d | 14 d after `created` everywhere | no | senders |
| `OUTBOX_MAX_ROWS` | 200 rows of any status | 200, counting only finished rows (`delivered`, `expired`); pending rows are never dropped | no | senders |
| request timeouts | JS none | JS: 60 s for polls and message publishes, 1,800 s for attachment uploads and downloads. Kotlin and Swift keep theirs. | no | JS |
| `SEEN_TTL` | 14 d after first seen | 14 d after the latest sighting | no | receivers |
| `SEEN_MSG_TTL` | 2 d (the spec said 1 d) | 2 d | no | receivers |
| `INCOMPLETE_TTL` | Kotlin: 24 h; JS: none | 24 h | no | receivers |
| `DIGEST_INTERVAL` / `DIGEST_WINDOW` / `DIGEST_MAX_IDS` | — | 11 h / 8 d / 280 | no | the Inbox (Kotlin) |
| safe file name | 120 units / no byte cap / extension ≤ 10 including the dot | 120 UTF-16 units / **200 UTF-8 bytes** / extension of **1–10 units after the dot** | yes (vectors) | all |
| `MAX_PARTS`, `MAX_URL`, `MAX_TITLE`, `MAX_NAME`, `MAX_PAGE_HTML`, `SMALL_FRAME_B64_MAX` | 16, 4096, 300, 60, 8,388,608, 3800 | unchanged | yes | all |

Dropped from revision 1 (section 8): the link parameters `k`, `lf`, `lt`, `relayLimits` and its formula,
`MAX_SENDER_HEADER`, `STALE_AFTER`, `PENDING_ACKS_MAX`, `MAX_ACK_ATTACHMENT`, `FULL_WAIT` and the `rejected` status.

### 2.2 Decisions

**Largest item: 9 MB, for every relay.** Senders refuse content whose `size` (bytes before compression) is over
9,000,000, before reading or copying it, with one sentence users can predict: "Files can be up to 9 MB."

- Pages are at most 8 MiB of HTML, so a page always fits. Larger pages already go as their link.
- Text files over 9 MB that would have fitted after compression are refused. That is rare for a reader. v1.0 could not
  send anything over about 2 MB on ntfy.sh anyway.
- Senders use `deflate-raw` only when it makes the body smaller, so the encoded length is never over 9,000,000 either.

**Why not per-relay limits.** Revision 1 read the relay's limits in the Inbox and carried them in the pairing link
(`lf`, `lt`). That helped only non-default relays, and only senders paired by link. A sender that typed the code fell
back to guessed limits. On exactly the small relays the scheme was for, that loops on `413`. A fixed chunk works on any
relay that takes 2 MB attachments. The Inbox's relay check proves this with a real full-size upload (finding 21). Unknown
link parameters are already ignored, so per-relay limits can come later without a wire change.

**Access token: not in v1.1.** No finding needs it. It would be the one interop break: a v1.0 sender cannot use such a
relay. It would also put a credential in URLs, which ntfy, proxy and CDN logs keep. The relay check refuses a relay that
needs a login, with a sentence.

**Replays older than 14 days: an accepted risk.** Revision 1 refused new items whose `sent` was more than 13 days old.
That made delivery depend on device clocks: a phone whose clock was 13 days slow could never deliver, and nothing told
the user. It also refused a v1.0 sender's "Try again". The attack it blocked gains nothing: a replayed frame cannot be
read or changed, so the worst outcome is a duplicate article. v1.1 keeps the cheap part (an id is refreshed on every
sighting) and documents the rest (spec §5).

**Five statuses, not six.** `sending`, `sent`, `delivered`, `failed` and `expired` stay. The row's `errorCode` says
which failure it was, which wait applies and which sentence is shown.

- A failure that might clear by itself stays `failed`, so the item heals when the relay is fixed.
- The third slow failure in a row ends the row as `expired`, so nothing loops for a week.

### 2.3 Arithmetic

```
frame bytes   = 4 (magic) + 12 (nonce) + 4 (header length) + H (header) + C (chunk) + 16 (tag) = C + H + 36
largest frame = 1,900,544 + 65,536 + 36 = 1,966,116 ≤ 2,000,000     (33,884 to spare, even with the largest header
                                                                     any receiver accepts)
parts         = ceil(9,000,000 / 1,900,544) = 5
one copy      ≤ 9,000,000 + 5 × (65,536 + 36) = 9,327,860
two copies    ≤ 18,655,720 ≤ 20,000,000                           (1,344,280 to spare)
```

ntfy.sh gives its limits as "2 MB" and "20 MB". We read them as decimal, the smaller reading. Real headers are far
below 64 KiB. The largest measured is 14,036 bytes: a 4096-unit URL of CJK characters, 300 emoji in the title, a
200-byte name and 60 emoji in `from`. The sender therefore needs no header cap of its own.

**Why the largest item must fit twice.** ntfy counts attachments against the uploader until they expire (3 h). Two
copies can overlap in three cases:

- a half-finished upload is retried;
- "Try again" comes right after a send;
- a v1.0 sender re-sends at 150 min.

v1.1's own re-sends wait 185 min, so in normal running only one copy is stored.

**`MAX_ATTACHMENT` stays 12,713,984** (= 12,582,912 + 131,072), so v1.1 receivers still take v1.0 senders' 12 MiB
frames. Kotlin defines it today as `Limits.CHUNK + 128 KiB`. It must become a literal, or the new `CHUNK` would shrink
it to 2,031,616.

**Re-send cadence.** Take an item with an attachment frame that is never acked. It is published at 0, 3 h 05 min,
6 h 10 min and 18 h 10 min, then every 12 h:

- 16 publishes in 7 days, at most 4 on any day (v1.0: 67, about 10 a day);
- for a 9 MB file, 144 MB over the week and at most 36 MB on day 1.

A message-only item is published every 11 h: at most 3 a day.

**Daily quotas on ntfy.sh, for a queue.** Each IP address gets, per day:

- 250 messages;
- 200 MB of attachment traffic: uploads, plus each download, which is also charged to the uploader.

A phone and the Daylight on the same home Wi-Fi share them. With the Daylight off, on any day:

```
messages ≈ Σ over items (publishes that day × parts) + the Daylight's acks and digests (≤ 20)
bytes    ≈ Σ over items with an attachment frame (publishes that day × encoded size)
publishes per day: an attachment item ≤ 4 on its first day, 2 after; a message-only item ≤ 3
```

**Example.** On day 1, the user shares 30 pages of 0.3 MB and two 9 MB PDFs, and the Daylight is off.

- Day 1: 30 × 4 + 2 × 4 × 5 = 160 messages, and 30 × 4 × 0.3 + 2 × 4 × 9 = 108 MB.
- Each later day: 80 messages and 54 MB.
- At v1.0's cadence, day 1 is about 400 messages, over the limit.

These are upper bounds. The 27 MB shared at once is over the 20 MB allowed at a time, so a few items first wait as
`full`.

**Going over a quota is handled, not prevented.** A pass stops at the first `429` and sends no attachment after a
`413` (2.4). An exhausted quota therefore costs one refused request per pass, not one per item. ntfy resets the message
count at 00:00 UTC. Until then a `429` retries with the network backoff, which grows to hourly.

The request limit also applies: a burst of 60 requests, then one every 5 s. Each frame and each attachment download is
one request.

### 2.4 Sender rules (the same in JS, Kotlin and Swift)

Outbox row fields: `id, kind, title, url, name, mime, size, sent, created, status, errorCode, attempts, slowFails,
lastPublish, attemptStarted, attachment, error, delivered`.

- New in v1.1: `errorCode` and `slowFails` everywhere, and `attemptStarted` in JS and Kotlin (Swift already has it).
- `error` keeps technical detail such as "HTTP 503" for logs. It is never shown.
- A field missing from a row saved by v1.0 reads as `''` or `0`.

```
publish answer → error code (RelayClient.publish throws ShareError with .code and .status; .status 0 = network):
  network error, timeout, 408, 5xx   in-call retries after 1 s, 2 s and 4 s (or Retry-After, at most 60 s);
                                     then 'network'
  429                                no in-call retry; 'network'; the pass publishes nothing more (stopAll)
  413                                'full'; the pass publishes no more attachment frames (stopAttachments)
  any other 4xx (400, 401, 403, 404, 405, …)    'refused'

attempt(row):                        // under the outbox lock; frames are rebuilt from the stored content
  row.status = sending; row.attemptStarted = now; save
  publish the frames in part order; after each accepted frame: row.attemptStarted = now; save
  all accepted:  status = sent; errorCode = ''; attempts = 0; slowFails = 0
  a frame fails: later frames are not published
                 status = failed; errorCode = code; attempts += 1
                 slowFails = (code is full or refused) ? slowFails + 1 : 0
                 if slowFails ≥ 3: status = expired (errorCode kept)
  row.lastPublish = now; save            // every wait below counts from lastPublish, the end of the last attempt

send(item):                          // a share
  size > 9,000,000: refuse at once with ShareError('too-large', sentence of 2.5); nothing is stored
  save the row: status sending, created = now, attemptStarted = now
  store the content copy; if that fails (a browser storage quota), keep no copy and go on
  attempt(row)

resendDue():                         // one pass, oldest row first; pass = {stopAll: false, stopAttachments: false}
  for each row that is not delivered:
    expired:                 if now − created > 14 d, drop its content; next row
    now − created > 7 d:     status = expired; errorCode = ''; content kept; next row
    due when:
      sending                now − (attemptStarted, else lastPublish, else created) ≥ 15 min
      sent, no attachment    now − lastPublish ≥ 11 h
      sent, attachment       now − lastPublish ≥ (lastPublish − created < 6 h ? 185 min : 12 h)
      failed, network        now − lastPublish ≥ 1 min × min(60, 2^attempts)
      failed, full/refused   now − lastPublish ≥ 185 min
    not due:                 next row
    pass.stopAll, or (pass.stopAttachments and row.attachment):  next row (not attempted, nothing changes)
    kind is not url and no content is stored:      status = expired; errorCode = 'gone'; next row
    size > 9,000,000 (a row saved by v1.0):        status = expired; errorCode = 'too-large'; drop content; next row
    attempt(row); on a 429 set pass.stopAll, on a 413 set pass.stopAttachments

retry(id):                           // the "Retry now" and "Try again" buttons
  failed:                            attempt now
  expired with errorCode '', 'full' or 'refused':
                                     created = now; attempts = 0; slowFails = 0; errorCode = ''; then as in resendDue
                                     (no content → expired/gone; size > 9,000,000 → expired/too-large; else attempt).
                                     The header, including sent, is not changed.
  anything else:                     no change (a sending, sent or delivered row is never uploaded again by a tap)

checkAcks():
  poll the ack topic with the download outcomes and cursor rule of 2.6 (senders keep no seenMsgs)
  for each acked id whose row is not delivered: status = delivered; delivered = now; errorCode = ''; drop content

tick():                              checkAcks (errors ignored), then resendDue

save (every write):
  keep every sending, sent and failed row; fill the room up to 200 with the newest delivered and expired rows;
  drop the stored content of every row left out

pairing change:
  same secret (a new relay or name):  keep the outbox; later attempts use the new relay
  different secret:                   delete every row, all stored content and the ack cursor
```

The 185-minute anchors work like this:

- **Re-send.** Every frame of an attempt expires 3 h after its request started, and that start is before
  `lastPublish`. So at `lastPublish` + 185 min, every earlier copy has expired, with 5 minutes' margin for the relay's
  expiry sweep.
- **After a 413.** Everything this sender had stored on the relay when it got the 413 was uploaded before
  `lastPublish`. It has expired by the same time.

### 2.5 Shared status and copy

Every surface shows a row through one library function, which returns `{label, sentence, action}`:

- JS `describeRow(row, now)`;
- Kotlin `RowText.of(row, now)`;
- Swift `RowText(row:now:)`.

The `statusText` vectors pin the output. Sizes use `formatMB(bytes)` = ceil(bytes / 100,000) / 10, printed without a
trailing `.0`. For example, 9,000,001 → "9.1", 12,000,000 → "12" and 14,200,000 → "14.2".

| Row | Label | Sentence | Button (`action`) |
|---|---|---|---|
| `sending` | Sending… | — | — |
| `sent`, created less than 24 h ago | Sent · waiting for your Daylight | — | — |
| `sent`, older | Sent · waiting for your Daylight | Your Daylight hasn't picked this up yet. It is sent again twice a day. | — |
| `delivered` | Delivered ✓ | Saved on your Daylight. | — |
| `failed` / `network` | Waiting to send | Couldn't send right now. It will try again by itself. | Retry now (`retry-now`) |
| `failed` / `full` | Waiting to send | A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours. | — |
| `failed` / `refused` | Waiting to send | The relay set on your Daylight turned this down. It will try again in about 3 hours. | — |
| `expired` | Not delivered | Your Daylight didn't pick this up within a week. Is it on and online? | Try again (`try-again`) |
| `expired` / `full` | Not delivered | Too much was sent from this network for hours, so it stopped trying. Try again later. | Try again |
| `expired` / `refused` | Not delivered | The relay set on your Daylight keeps turning this down. Check that setting on your Daylight, then try again. | Try again |
| `expired` / `too-large` | Not delivered | Too big to send. Files can be up to 9 MB; this one is 14.2 MB. | — |
| `expired` / `gone` | Not delivered | This is no longer stored on this device. Share it again. | — |

Every row also has "Remove". The word "relay" appears only where it names a setting the user can find.

Typography: the tables in this record are written with ASCII apostrophes. The apps show every sentence in this
section and in finding 21 with ’ (U+2019), as in "Couldn’t" and "can’t", and with "…" (U+2026), "·" (U+00B7) and "✓"
(U+2713). The `statusText` vectors pin the exact strings.

Messages at share time (sender apps):

| When | Message |
|---|---|
| the item is over 9 MB (nothing is queued) | Too big to send. Files can be up to 9 MB; this one is 14.2 MB. |
| the extension sent a PDF's link instead | The PDF is over 9 MB, so its link was sent. |
| a page over 8 MiB was sent as its link (unchanged) | The page is larger than 8 MB, so its link was sent. |
| Android or Apple cannot copy the file into the outbox | This device is out of space, so it can't send this. |
| after any share | the row's label, then its sentence if it has one, e.g. "Waiting to send. Couldn't send right now. It will try again by itself." |
| a link with the same secret was applied | Pairing updated: now sending through relay.example.org. (or "Pairing updated." when the relay did not change) |

The Daylight Inbox (Kotlin `InboxScreen`):

| Condition | Sentence |
|---|---|
| the last store failed (shown until a store succeeds) | Your Daylight is out of space, so new items can't be saved. Free some space. |
| a poll, or a download in it, got `429` or `413` | Too much has gone through this network for now. New items will arrive later. |
| a poll failed with a network error | Offline. New items will arrive when this Daylight is back online. |
| a poll got any other error status | The relay isn't working right now (error 502). It will keep trying. |
| the relay check failed | the check's sentence (finding 21). On Save the relay is not saved; in the background the sentence is a warning. |

### 2.6 Receiver rules

The JS receiver implements everything below except the lines marked (Kotlin). Senders' `checkAcks` uses only the
download rule, the outcomes and the cursor.

```
download(entry with attachment):
  URL is not https: and not the relay's own origin (scheme, host, port)       → junk
  Content-Length > 12,713,984, or the body grows past it while reading       → junk
  2xx                                                                        → frame
  404 or 410                                                                 → expired
  429                                                                        → retry, and every later attachment
                                                                               entry in this answer is retry, without
                                                                               a request
  anything else (5xx, another status, network error, timeout, reset mid-body)→ retry
entry without attachment: base64 of `message` → frame; not base64 → junk

pollOnce():                                   // under the receiver lock
  load state: since, seenItems, seenMsgs, incomplete, (Kotlin) partMsgs, lastDigest
  prune: seenItems older than 14 d; seenMsgs older than 2 d; incomplete older than 24 h, with their held parts;
         (Kotlin) partMsgs older than 2 d
  answer = poll(inboxTopic, since, read at most 64 MiB); do not download an entry whose id is in seenMsgs, nor
           (Kotlin) one whose id is in partMsgs while its item is still held
  held = none
  for each entry:
    not downloaded           nothing (a held part's time is already in incomplete)
    junk or expired          seenMsgs[id] = now
    retry                    held = min(held, entry.time)
    frame:
      not a valid frame                       seenMsgs[id] = now
      its item id is in seenItems             seenItems[item] = now; seenMsgs[id] = now; ack the item
      bad header, or integrity fails          seenMsgs[id, and the item's other part messages] = now; drop held parts
      a part of an incomplete item            incomplete[item] = min(incomplete[item], entry.time); partMsgs[id] = item
      completes the item → accept(item):
        returns                 seenItems[item] = now; the item's messages are handled; remove incomplete[item];
                                ack the item
        throws                  the item's messages are handled; remove incomplete[item]; storeError = message
                                (the id is not remembered and not acked; the item comes back with the next re-send)
  held = min(held, every time in incomplete)
  if the answer had message lines:
    c = max(0, min(newest time in the answer, held) − 1800)
    since = (nothing held and since is a number > c) ? since : c
  save state
  acks = this poll's ids; (Kotlin) when now − lastDigest ≥ 11 h, add the digest: ids in seenItems with
         0 ≤ now − seen ≤ 8 d, newest first, at most 280, not already in this poll's acks
  publish them in frames of at most 70 ids; stop at the first failure; never throw
  (Kotlin) if the digest went out: lastDigest = now; if any ack failed: lastDigest = 0; save
  return {items, acked, ackError, storeError}
```

"The item's messages are handled" means the message that completed it plus every message that carried one of its
parts. Kotlin knows them from `partMsgs`. JS keeps them in memory next to the held parts.

Kotlin's live path (`handleLive`) applies the same per-entry rules. `InboxRepo` publishes its acks. When that publish
fails, it calls `receiver.ackFailed()`, which sets `lastDigest = 0`.

---

## 3. Decisions per finding

Abbreviations for "Touches":

- **JS**: `share/js/daylight-share.js`;
- **Mock**: `share/js/mock-relay.mjs`;
- **T/V**: JS tests and vectors (`share/js/test/*.mjs`, `share/vectors/generate.mjs`, `test-vectors.json`,
  `live-ntfy.mjs`);
- **Ext**: the extension;
- **Web**: the web sender;
- **Kc**: Kotlin share-core;
- **And**: the Android app;
- **Sw**: DaylightShareKit;
- **AUI**: the Apple app UI (`DaylightShareUI`, the iOS and macOS apps and their share extensions).

Overlaps, handled once:

- Findings 1, 2, 7, 9, 22 and note (f) are one sizing/413/re-send problem. Sizing is under 1, the 413 policy under 7
  (22 points there), the re-send timing under 9 ((f) points there), and the spec and the mock defaults under 2.
- 4 and 8 (download failures): under 4.
- 15 and 18 (cursor overlap): under 15.
- 19 and 29 (ack size): under 29.
- 12, 25 and 26 (safe file names): one algorithm, under 12. 25 and 26 add vectors.
- 16 and note (c) (outbox cap): under 16.
- 6 and the content-keeping part of 5: under 6.

### Finding 1 — [blocker] The default relay rejects every page or file over ~2 MB

**Decision: fix**, with one chunk size and one item limit for every relay (2.2, 2.3).

**After the change.**

- `CHUNK = 1,900,544`. `MAX_ITEM = 9,000,000` applies to the content's `size`, before compression.
- `buildItemFrames` / `ItemBuilder.prepare` throw `ShareError('too-large', "Too big to send. Files can be up to 9 MB;
  this one is 14.2 MB.")` when `size > MAX_ITEM`. Nothing is queued.
- Every surface checks the size **before reading or copying** the content: the extension's PDF fetch, the web page's
  file input, Android `copyIn` and the Apple share extensions. The extension sends the PDF's link instead, as it already
  does above its cap.
- Re-sends rebuild frames with the new chunk. A v1.0 row whose `size` is over 9 MB becomes `expired` / `too-large` the
  first time it is due (2.4).
- The 413 handling and the daily limits are under finding 7 and section 2.3.

**Touches:** JS, T/V, Ext, Web, Kc, And (`copyIn`; `MAX_RAW` goes), Sw, AUI.

### Finding 2 — [blocker] The spec's 15 MB attachment limit for ntfy.sh is wrong

**Decision: fix.**

- The spec (§2.3, §3.1, §3.5 new, §4) states the real ntfy.sh limits and the fixed sizes.
- The mock relay's defaults become ntfy.sh's (`attachmentMaxBytes = 2,000,000`,
  `visitorAttachmentTotalBytes = 20,000,000`), so every existing test runs under them.
- `live-ntfy.mjs`:
  - sends a 4,000,000-byte random "PDF" (3 parts) and checks it arrives byte for byte;
  - checks that a 2,100,000-byte PUT comes back to `fetch` as status `413`;
  - checks that `GET https://ntfy.sh/v1/account` still reports `attachment_file_size ≥ 2,000,000` and
    `attachment_total_size ≥ 20,000,000`. This is a canary: CI fails loudly if ntfy.sh lowers them. No client reads
    `/v1/account`.

**Touches:** spec, Mock, T/V, Kc (`MockRelay` flags), Sw tests (`FakeRelay` answers 413 over 2,000,000 per PUT).

### Finding 3 — [major/security] A pairing deep link silently re-pairs a sender with an attacker's Daylight

**Decision: fix.**

**After the change** (spec §1.3, "Confirmation").

- A pairing that arrives from **outside the app** is applied only after the user confirms. That covers a QR code
  scanned with the system camera, a tapped `daylightshare://` link and the web sender's `#pair=`. The confirmation
  shows:
  - the title "Pair with Anjan's Daylight?" (from `n`, or "a Daylight");
  - "Code starts E4AY. Check it matches the code on your Daylight." (the first group of the code);
  - the relay host, when it is not ntfy.sh;
  - when this device already sends to a Daylight with a **different secret**: "This replaces <current name>. Items not
    yet delivered to it will not be sent." The button then reads "Switch"; otherwise it reads "Pair".
- A link whose secret equals the current pairing's is applied without asking. That covers a re-scan, a new name or a
  new relay. The notice names the relay when it changed: "Pairing updated: now sending through relay.example.org."
- A code typed, pasted or scanned **on the app's own pairing screen** asks only when it would replace a pairing with
  a different secret, using the same "This replaces …" text.
- **The outbox follows one rule on every platform** (spec §3.3):
  - same secret: keep the outbox, and pending items go via the new relay. This is how a fixed relay heals stuck items.
  - different secret: delete every row and its content.
  
  Today the extension and Apple wipe everything when only the relay changes. Android keeps the old secret's outbox
  dormant in its own directory.

**Touches:**

- And:
  - `MainActivity.handleLink` sets `pendingPair` for every role, and the dialog in `Root()` gets the texts above;
  - `pairSender` is called only from the dialog, or directly for the same secret;
  - `SenderRepo.pair` deletes `outbox/<old inboxTopic>` when the secret changes.
- AUI:
  - `AppModel.handleOpen` puts the parsed pairing into a `pendingPairing` published property, and the UI shows a
    confirmation sheet;
  - `pair(_:)` from `PairView` checks for replacement;
  - `-DLSPairLink` launch arguments stay silent, because they are CI-only.
- Sw: `SharedStore.pair` removes the outbox only when the secret differs.
- Web: `pairFromParam` asks with `confirm()` even when unpaired ("Pair this page with X? Code starts E4AY…").
- Ext:
  - `pair` clears the outbox only when the code differs;
  - the popup's pairing field asks when replacing a different secret;
  - `pairFromApp` (the Safari containing app) stays silent.
- JS gets the helper `samePairingSecret(a, b)`.

### Finding 4 — [major/state] A temporary attachment download failure is treated as "expired" (with finding 8)

**Decision: fix.**

**After the change** (spec §3.2; the rules in 2.6). `RelayClient.poll` classifies every attachment download:

| Outcome | Entry | Effect |
|---|---|---|
| 2xx, body ≤ cap | `frame` | decode as usual |
| 404 or 410 | `expired` | handled: remembered for 2 days and not requested again; the cursor may pass it |
| URL not allowed, or `Content-Length` / body over 12,713,984 | `junk` | handled: never downloaded again |
| 429 | `retry` | **stop downloading** for the rest of this poll: every later attachment entry in the answer is `retry` without a request |
| 5xx, any other status, network error, timeout, reset mid-body (the body read is inside the same try) | `retry` | not handled; holds the cursor |

- `Receiver.pollOnce`, Kotlin `Receiver.handle` and every sender's `checkAcks` hold the cursor at the earliest
  `retry` time (finding 15).
- The next poll lists the message again and retries the download. Retries stop when it downloads, or when it becomes
  a `404` after the relay drops it (3 h).
- An expired attachment never comes back, and re-sends use new message ids. Remembering a `404` therefore costs nothing
  and saves a refused request per poll while the cursor is held.

**Touches:** JS, T/V, Kc (`RelayMessage` outcome fields; `RelayClient.download` returns an outcome rather than
`null`), And (live path: a `retry` message from the stream holds the cursor the same way), Sw (`poll` outcomes;
`checkAcks` holds the ack cursor).

### Finding 5 — [major/state] Acks last only 12 h and are re-published only when a re-send arrives

**Decision: fix**, in four parts.

1. **Digest (the Kotlin Inbox).** At a poll, when `now − lastDigest ≥ 11 h`, the Daylight adds a digest to the poll's
   acks: every id it remembers with a seen time within the last 8 days (0 ≤ now − seen ≤ 8 d), newest first, at most
   280 (4 frames). `lastDigest = now` only after those frames were published. Any ack failure sets `lastDigest = 0`, so
   the next poll (≤ 15 min) re-publishes the missed ids.
   - With ntfy.sh's 12 h message cache and 11 h spacing, a digest is always on the relay while the Daylight is on.
   - A sender that runs once in its 7-day window sees its ack, because `tick()` runs `checkAcks` before `resendDue`.
   - Cost: at most 4 messages per 11 h.
2. **Acks are always messages** (finding 29), so they live 12 h, not 3 h.
3. **Seen times are refreshed** on every duplicate (finding 11), so re-sends within the window never deliver twice.
4. **"Try again" keeps the id and the header**, `sent` included. If the Daylight still remembers the id, it acks it
   and does not deliver it again.

The remaining case is accepted. A user who taps "Try again" more than 14 days after the Daylight last saw the item gets
it delivered again. They asked for it.

The JS receiver has no digest. It runs only in tests and demos; its acks are repeated when the sender re-sends.

**Touches:** Kc (`ReceiverState.lastDigest`, `Receiver.pollOnce`, `Receiver.ackFailed`), And (`InboxRepo.handleLive`
calls `ackFailed`), Kotlin tests (`digestReachesARareSender`, `ackFailureTriggersDigestAtNextPoll`). Senders: none.

### Finding 6 — [major/state] Expiring a row deletes its content, so "Try again" on an expired page or file does nothing

**Decision: fix.**

**After the change.**

- `resendDue` marks a row `expired` and **keeps** its content.
- Content is dropped:
  - on `delivered`;
  - when the user removes the row;
  - when the row is evicted (finding 16);
  - for `expired` rows, at `now − created > 14 d`, during `resendDue`;
  - for a v1.0 row over 9 MB, when it becomes `expired` / `too-large`.
- `retry(id)` on a non-url row without content makes it `expired` / `gone` ("This is no longer stored on this
  device. Share it again."). On a row with content it publishes with `created = now` and the original header.

**Touches:** JS (`resendDue`, `retry`), Kc (`retry`; `prune` already uses 14 d), Sw (purge after 14 d instead of 30 d),
Ext/Web/And/AUI (rows through `describeRow`/`RowText`).

### Finding 7 — [major/state] 413 is retried every 60 min or less for 7 days (with findings 22, 1)

**Decision: fix with error codes and a bound, not a terminal status.** ntfy answers `413` (41301, "attachment too
large, or bandwidth limit reached") for three causes: the per-file limit, the per-visitor total and the daily
bandwidth. v1.1 never publishes a frame larger than 1,966,116 bytes, so on a relay that meets §3.5 a `413` always means
one of the other two, both of which clear.

**After the change** (spec §3.1 and §3.3; the rules in 2.4). The first failing answer of an attempt sets the row:

| Answer | status / errorCode | Next automatic try |
|---|---|---|
| network error, timeout, 408, 5xx (after the in-call retries) | `failed` / `network` | 1 min × min(60, 2^attempts) |
| 429 (no in-call retry) | `failed` / `network` | 1 min × min(60, 2^attempts); this pass publishes nothing more |
| 413 | `failed` / `full` | 185 min; this pass publishes no more attachment frames |
| any other 4xx (400, 401, 403, 404, 405, …) | `failed` / `refused` | 185 min |
| the third `full`/`refused` in a row | `expired` / same code | none; "Try again" starts over |

- **Worst cases.**
  - A relay that refuses everything costs 3 refused requests, then the row stops.
  - A relay that stays full costs at most 3 attempts. Each can upload up to 4 accepted frames (about 7.9 MB) before
    the refused one, so about 24 MB in all. v1.0 measured 172 attempts and 344 MB with 2 MB frames.
  - No row shows "about 3 hours" for more than about 6 hours.
- A user can heal a `refused` row by fixing the relay setting on the Daylight and re-scanning the code: the same secret
  keeps the outbox (finding 3), and the next try goes to the new relay.
- `RelayClient.publish` throws `ShareError` with `.code` (`network`, `full`, `refused`) and `.status` (0 for network).
- A self-hosted Go ntfy without a proxy answers an over-limit PUT before reading the body and then closes the
  connection. Some clients then see a reset instead of the `413`. That case falls to `network`: it is retried sooner
  but stays safe. The mock gets that mode and the live check pins what ntfy.sh does (section 5).

**Touches:** JS, Mock, T/V, Kc (`OutboxRow.errorCode`, `slowFails`; `RelayException` gets a code), And, Sw
(`OutboxRow.errorCode`, `slowFails`; `ShareError.status`), AUI, Ext, Web (all through `describeRow`/`RowText`).

### Finding 8 — [major/transport] A transient attachment download failure (429, 5xx, timeout) is handled as if expired

**Decision: fix, see finding 4.** The two extra points of finding 8:

- **Part 0 fails while parts 1–4 succeed.** The retry entry's time holds the cursor below part 0. In Kotlin, parts
  1–4 are kept as held parts (finding 17) and are not downloaded again.
- **Stop after a 429.** Further downloads in the same poll would only add to the 60-request burst the Daylight shares
  with the phone.

**Touches:** as finding 4.

### Finding 9 — [major/transport] Re-sending at 150 min while the first copy is kept for 180 min doubles storage (with note f)

**Decision: fix.**

**After the change** (spec §3.3 step 3; the rules in 2.4):

- **`sent` with an attachment frame:** the next try is at `lastPublish + 185 min` while
  `lastPublish − created < 6 h`, which gives two re-sends. After that it is `lastPublish + 12 h`. At +185 min every
  earlier copy has expired (2.4), so only one copy is stored.
- **`sent` with messages only:** 11 h, unchanged. The message cache keeps 12 h, and a small overlap of messages costs
  nothing.
- **A week with the Daylight off** now costs 16 uploads of the item: 144 MB for a 9 MB file, at most 36 MB on day 1.
  v1.0 made 67 uploads (about 600 MB). Section 2.3 gives the formula for a queue.
- **The delay this adds:** after the first 6 hours, a Daylight that comes back gets the item at the next re-send, at
  most 12 h later. The row's sentence says so after a day: "It is sent again twice a day."
- **Overlaps v1.1 cannot avoid** (retries of half-uploaded items, "Try again", v1.0 senders) are covered by the
  two-copy margin of section 2.3.

Not done (section 7): storing `attachment.expires` from publish answers, and keeping a sender's live bytes below
20 MB.

**Touches:** JS, Kc, Sw, T/V (timing tests).

### Finding 10 — [minor/security] Decompression bomb: the JS receiver inflates completely before checking `size`

**Decision: fix.**

**After the change** (spec §2.3).

- Receivers decode `enc` as a stream, stop with `integrity` as soon as the output exceeds `size`, and never hold
  more than `size` bytes.
- `checkItemHeader` refuses `size` > 8,388,608 for `page` and > 268,435,456 for `file`.
- Senders refuse anything over 9,000,000 (finding 1).

JS:

```js
export async function inflateRaw(bytes, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const out = []; let total = 0;
  for (;;) {
    let r;
    try { r = await reader.read(); } catch { throw new ShareError('integrity', 'bad deflate data'); }
    if (r.done) break;
    total += r.value.length;
    if (total > limit) { await reader.cancel().catch(() => {}); throw new ShareError('integrity', 'size mismatch'); }
    out.push(r.value);
  }
  return concat(...out);
}
```

`Reassembler.add` calls `inflateRaw(encoded, header.size)`. Kotlin `decodeVerify` and Swift
`RawDeflate.decompress(_:limit:)` already stop early; they only gain the page/file `size` caps in their header checks.

**Touches:** JS, T/V (`invalidItems` vectors), Kc (`ItemHeader.check`), Sw (`ItemHeader.validated`).

### Finding 11 — [minor/security] An old frame replayed after the 14-day dedupe window is accepted as new

**Decision: fix the duplicate part; accept the replay** (2.2).

**After the change** (spec §3.2 "Deduplication", §5 "Replays").

- On storing a new item, and on every duplicate, set `seen[id] = now`, using the receiver's own clock. Prune when
  `now − seen[id] > 14 d`. A sender's re-sends within its 7 days therefore never deliver twice, however late the acks.
- Nothing parses or checks `sent`. A frame replayed more than 14 days after the Daylight last saw the item is
  delivered again. The relay can neither read nor change it, so the worst outcome is a duplicate article. Spec §5
  states this.
- The `badHeaders` vectors, which all carry `sent: ""`, get a valid `sent`, so that each one fails for the reason its
  name gives.

**Touches:** JS and Kc (`Receiver`: refresh on duplicates), T/V, spec.

### Finding 12 — [minor/security] Safe file names are limited to 120 UTF-16 units, not bytes (with 25, 26)

**Decision: fix**, with one algorithm in all three languages (spec §5).

```
safeFileName(name, fallback = "document"):
  1. Remove lone surrogates (UTF-16 code units D800–DFFF not part of a pair). Swift strings cannot hold any.
  2. Split on runs of "/" and "\".
  3. In each segment:
       a. replace each run of control characters (\p{Cc}: U+0000–001F, U+007F–009F) and of : * ? " < > | with " ";
       b. replace each run of JS whitespace (\t \n \v \f \r space U+00A0 U+1680 U+2000–200A U+2028 U+2029 U+202F
          U+205F U+3000 U+FEFF) with " ";
       c. remove every leading character that is "." or JS whitespace;
       d. trim JS whitespace at both ends.
  4. Drop empty segments; join with one space. Empty -> fallback.
  5. If the result is longer than 120 UTF-16 code units or 200 UTF-8 bytes:
       ext  = from the last "." to the end, if that "." is not the first character and 1–10 UTF-16 units follow it;
              else "".
       base = the rest. Remove whole code points from the end of base (never half a surrogate pair) until
              base + ext is at most 120 UTF-16 units and at most 200 UTF-8 bytes.
       result = base + ext.
```

- **Step 3 in each language.**
  - JS: `seg.replace(/[\p{Cc}:*?"<>|]+/gu, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+/, '').trim()`.
  - Kotlin: `trimStart { it == '.' || isJsWhitespace(it) }`, then `jsTrim`.
  - Swift: drop first scalars while they are `"."` or `isJSWhitespace`, then `jsTrim`.
- **Why 200 bytes and not 255.** ext4 and f2fs allow 255 bytes per name. The Inbox, the Reader and FileProvider
  sometimes add " (2)" or similar, and 200 leaves room.
- **Why the Inbox keeps the name.** It stores the file under the safe name. The Reader gets the name through
  FileProvider's `DISPLAY_NAME`, which is the file name, so a fixed internal name would lose it.
- **A defence in `InboxRepo.accept`.** If creating or moving the file throws, it stores it as `document` plus `ext` (or
  `document`) and keeps the display name in the item row.

**Touches:** JS, Kc (`Text.safeFileName`), Sw (`ShareText.safeFileName`), And (`InboxRepo.accept` fallback), T/V
(`fileNames`, new `fileNamesUtf16`).

### Finding 13 — [minor/security] The JS receiver follows attachment.url to any host and buffers it all

**Decision: fix.**

**After the change** (spec §3.2; 2.6).

- An attachment is downloaded only if its URL is `https:` (any host), or has the relay's own origin (scheme, host,
  port). The second case covers plain-`http` local relays.
- **Download cap: 12,713,984 bytes**, for inbox and ack downloads alike.
  - A `Content-Length` over the cap is junk, with no read.
  - Otherwise the client reads with a byte counter and stops past the cap: JS `r.body.getReader()`; Kotlin
    `readCapped` (already); Swift streams with a `URLSession` data delegate or `bytes(for:)` and the same counter,
    rather than checking `d.count` afterwards.
- A disallowed URL or an over-cap body is `junk` (finding 4 table).
- Poll answers are read the same way, capped at 64 MiB. Over the cap, the poll fails with `ShareError('relay')`.
- The relay check (finding 21) refuses a relay whose attachment URLs this rule would refuse.

**Touches:** JS, Kc (`RelayClient.download`: origin rule; `MAX_ATTACHMENT` as a literal), Sw (`poll`: origin rule,
streaming cap, 64 MiB answer cap), T/V (the mock answering a foreign `attachment.url`).

### Finding 14 — [minor/state] Receiver records items as seen before the ack goes out or the item is stored

**Decision: fix**, making JS match Kotlin, with a cheaper failure path for both.

**After the change** (spec §3.4; 2.6).

- JS `Receiver` takes `accept: async ({header, content}) => void`. The default does nothing.
- `accept` runs before the id is remembered or acked.
- **If `accept` throws** (a full disk):
  - the item's messages are marked handled, so they are not downloaded again;
  - its id is not remembered and it is not acked;
  - the poll returns `storeError`.

  The item comes back with the sender's next re-send, which is at most 4 downloads a day instead of one per 15-minute
  poll. The Inbox shows "Your Daylight is out of space, so new items can't be saved. Free some space." until a store
  succeeds.
- State is saved **before** acks are published. Ack publishing never throws. `pollOnce` returns
  `{items, acked, ackError, storeError}`.
- Kotlin: an ack failure (poll or live) sets `lastDigest = 0`, so the next poll publishes the digest, which includes
  the missed ids (finding 5). There is no separate pending-ack list.
- `InboxRepo.accept` is idempotent by id. If the app crashed between storing an item and saving the receiver state,
  the next poll stores it again. If the id is already in the Inbox list, it is not queued for the Reader a second time.

**Touches:** JS, Kc (`Receiver`: accept-failure path, `Result.ackError`/`storeError`, `ackFailed()`), And
(`InboxRepo.handleLive`, `accept`, Inbox sentences), T/V.

### Finding 15 — [minor/state] The time cursor skips any attachment whose upload took more than 5 s (with 18)

**Decision: fix with a wider time overlap.** No id cursor.

**After the change** (spec §3.2 "Cursor"; 2.6). The rule is the same for the inbox cursor and every sender's ack cursor:

```
if the answer has no message lines: cursor unchanged
held   = earliest time among: incomplete items (persisted), retry entries of this poll
c      = max(0, min(newest message time in the answer, held) − 1800)
cursor = (nothing held and the previous cursor is a number > c) ? previous : c
```

- **1,800 s covers slow uploads:** a 1.97 MB frame down to about 9 kbit/s. The JS sender aborts an attachment upload
  after 1,800 s, so its uploads never outlast the overlap. Anything slower, from Kotlin or Swift, is still delivered by
  the 185-min re-send.
- **The cost** is re-listing up to 30 min of JSON lines per poll. Handled messages are not downloaded again.
- **§3.2's reason for banning id cursors was wrong.** The spec now says that current ntfy replays the whole retained
  history for an unknown id. Time is kept because holding the cursor at an incomplete item's first part needs a time.
- The mock relay stamps `time` at request start (finding 20).

**Touches:** JS (`Receiver.pollOnce`, `Sender.checkAcks`), Kc (`Receiver.handle`, `Outbox.checkAcks`), Sw
(`checkAcks`), Mock, T/V.

### Finding 16 — [minor/state] The 200-row outbox cap drops the oldest rows whatever their status (with note c)

**Decision: fix** (the verifier's version).

**After the change.** On every save:

1. Keep every row with status `sending`, `sent` or `failed`, however many there are. The 7-day expiry shrinks the
   list again, so new shares are never refused.
2. Fill the room left up to 200 with the newest `delivered` and `expired` rows.
3. Delete the stored content of every row dropped: the JS `outbox/<id>` key, the Kotlin `content/<id>.enc` and the
   Swift `outbox/<id>.bin`.

**Touches:** JS (`_saveRow`), Kc (`Outbox.saveRow`), Sw (`OutboxStore.update`), T/V.

### Finding 17 — [minor/state] Parts of an incomplete item are downloaded again on every poll

**Decision: fix in Kotlin (the Daylight Inbox); fix only the memory growth in JS.**

**After the change** (spec §3.2 "Handled messages"; 2.6).

- **Kotlin** keeps `partMsgs: {msgId: itemId}`, persisted, because parts are on disk in `spool/parts/<id>/` and survive
  restarts. It applies one derived rule: do not download a message in `partMsgs` while its item is still held by the
  reassembler (`Reassembler.isPending`). The cursor stays held at the item's first part through `incomplete`.
  - When an item completes, fails its check or cannot be stored, all its messages become handled (`seenMsgs`).
  - When an item is given up after 24 h, its parts are deleted, so its messages are downloaded again if they are ever
    listed again.
  - `partMsgs` entries are pruned after 2 days, like `seenMsgs`.

  There is no other bookkeeping.
- **JS** keeps parts and their message ids in memory. `Reassembler.prune(24 h)` drops pending items older than that,
  which fixes the memory growth. The JS receiver still downloads held parts again at each poll. It runs only in tests
  and demos, so that is accepted.

**Touches:** Kc (`ReceiverState.partMsgs`, `Receiver`, `Reassembler.isPending`), JS (`Reassembler.prune`), Kotlin tests
(`heldPartsAreNotDownloadedAgain`).

### Finding 18 — [minor/transport] The time cursor permanently skips an attachment that finishes uploading late

**Decision: fix, see finding 15.** That covers the ack cursor too, and the mock's time stamp (finding 20).

### Finding 19 — [minor/transport] An ack with 79 or more ids is published as an attachment

**Decision: fix, see finding 29.**

### Finding 20 — [minor/transport] The mock relay differs from ntfy exactly where the bugs are

**Decision: fix what the fixed bugs need.** The full list is in section 5.2. In short:

- ntfy.sh defaults (2,000,000 per attachment, 20,000,000 live per visitor, expiring after 3 h on the mock clock);
- a real 413: a `Content-Length` pre-check and a drain, never `req.destroy()`, plus an `early413` mode that answers
  before reading and closes the connection, as a Go ntfy server without a proxy does;
- `attachments: false` (400 40014);
- `time` stamped at request start, plus `X-Mock-Hold`;
- hooks: `failDownload`, `failPublish(status)`, a movable clock, `downloadsById`, a visitor header.

Not added: ntfy's `since=<id>` semantics, `/v1/account`, token mode, and the daily message, bandwidth and request
counters. No client code branches on them, and `failPublish` produces their answers (`429`, `413`).

**Touches:** Mock, T/V, Kc (`MockRelay.start` flags).

### Finding 21 — [minor/transport] 'Any ntfy-compatible server works' is false for pages and files

**Decision: fix.**

**After the change.**

- **Spec §3.5 "Requirements":**
  - anyone can publish and read without a login;
  - messages are kept at least 12 hours;
  - attachments of at least 2,000,000 bytes are accepted (`base-url` and `attachment-cache-dir` set,
    `attachment-file-size-limit` ≥ `2M`);
  - `base-url` is `https://` or the relay's own origin, and the Daylight can reach it.
- **Relay check in the Inbox** (spec §3.4; Kotlin `RelayProbe`), run when the user saves a relay other than ntfy.sh:
  1. `PUT {relay}/dls-probe-<16 random hex>` with **1,966,116 random bytes** (the largest frame a sender makes),
     `Filename: probe.bin`, `Firebase: no` and `Cache: yes`. Expect `200` with `attachment.url`.
  2. `attachment.url` passes the download rule (finding 13), and a GET of it from the Daylight returns the same bytes.
- **Sentences** for each step that fails. The relay is **not saved** if any step fails:

  | Failure | Sentence |
  |---|---|
  | unreachable | Couldn't reach that relay. Check the address and your connection. |
  | `413` | This relay only takes small files. Its attachment limit must be at least 2 MB. |
  | `400` | This relay doesn't accept files. Use ntfy.sh, or turn on attachments on the server. |
  | `401` / `403` | This relay needs a login. Send to Daylight can't use relays that need a login yet. |
  | another status | That relay answered with an error (HTTP 502). Try again later. |
  | step 2 | Your Daylight can't download files from this relay. Check the server's base-url. |
- **A relay saved before 1.1** is checked once in the background, recorded in `Prefs.inboxRelayChecked`. A failure
  shows the sentence as a warning on the Inbox screen. A background check **never** changes the saved relay or the
  pairing link. A network failure leaves it unchecked, to try again at the next start.
- **Senders:** a `400`, `401`, `403`, `404` or `405` on publish is `refused`. The sender retries it slowly and stops
  after 3 attempts (finding 7).

**Touches:** Kc (`RelayProbe`), And (`SettingsScreen`: an async save with the probe; `App` start: the one-time
background check; `InboxScreen` warning), Mock (`attachments: false`, `early413`), Kotlin tests.

### Finding 22 — [minor/interop] On 413 the spec says 'report it, do not retry', but the code re-uploads for 7 days

**Decision: fix, see finding 7.** The spec's "do not retry" is replaced by the §3.1 table. Tests assert:

- no automatic re-upload within 185 min of a `413`;
- after the third slow failure, none at all until "Try again".

### Finding 23 — [minor/interop] No vector or test splits a deflate-raw stream across parts

**Decision: fix** (the verifier's version).

- `generate.mjs` builds the text item with `chunkSize: 16`, which gives 3 parts, and asserts
  `1 < textBuilt.frames.length <= 8`.
- The vector is renamed "text file, deflate-raw, 3 parts (chunk 16)". An out-of-order item `[2, 0, 1]` of the same
  frames is added.
- `protocol.test.mjs` "fresh frames round trip" adds a deflate case with `chunkSize: 64` on `'# t\n'.repeat(3000)`
  and asserts `frames.length > 1`.

**Touches:** T/V, Kc and Sw vector tests (no code change).

### Finding 24 — [minor/interop] What counts as a valid url is unspecified, and JS webUrl sends the raw input

**Decision: fix differently.** There is one textual rule, the same for senders and receivers in all three languages,
and it returns the trimmed input unchanged. There is no WHATWG parsing and no canonicalisation: only JS has a WHATWG
parser, and canonicalising in one language would make what is sent differ per platform.

```
webUrl(raw):
  s = JS-trim(raw)
  null if s is empty or longer than 4096 UTF-16 code units
  null if s contains any JS-whitespace character or \p{Cc} character
  null unless lowercase(s) starts with "http://" or "https://"
  rest      = s after "://"
  authority = rest up to the first "/", "?" or "#"
  hostport  = authority after its last "@"
  if hostport starts with "[":   host = hostport up to and including the first "]" (null if there is none);
                                 what follows "]" must be empty, or ":" followed by zero or more ASCII digits
  else:                          host = hostport up to its first ":"; what follows that ":" must be zero or more
                                 ASCII digits
  null if host is empty, starts with ".", or contains any of  < > ^ | \
  return s
```

- **Where the rule comes from.** It is v1.0's Kotlin rule, which is also the Reader's SAVE_PAGE rule, plus three
  things: the port must be digits, the host cannot contain `<>^|\`, and both are checked the same way in all three
  languages.
- **What it rejects:** `https:/example.com`, `https:example.com`, `https:\\example.com\story`,
  `https://.example.com/` and `https://example.com\story`.
- **Nothing real is lost.** Receivers using it reject nothing that a browser, a share sheet or a deployed sender
  produces from a real page. JS v1.0 could send the first three; Kotlin v1.0 receivers already rejected them.
- `findUrl` and the web page's `normalizeUserUrl` use it, so the user sees "That isn't a web address" at once.
- The relay URL has its own rule (note e).

**Touches:** JS (`webUrl` drops `new URL()`), Kc (`Text.webUrl`: port digits, host characters), Sw (`webURL`:
leading-dot check, first-colon port rule), T/V (`urls` vectors), Web (tests of `normalizeUserUrl`).

### Finding 25 — [minor/interop] safeFileName: JS and spec disagree on leading dots

**Decision: fix, see finding 12** (step 3c). The vectors are `'. .hidden' → 'hidden'`,
`'.. ..profile' → 'profile'` and `'x/ . .bashrc' → 'x bashrc'`.

### Finding 26 — [minor/interop] safeFileName length rule is ambiguous; the 120 cut splits surrogate pairs

**Decision: fix, see finding 12** (step 5: 1–10 units after the dot, whole code points only). The vectors are:

- `'x'×150 + '.webarchive'` → `'x'×109 + '.webarchive'`;
- `'a'×115 + '😀'×5 + '.pdf'` → `'a'×115 + '.pdf'`;
- the NBSP, control and lone-surrogate cases in section 5.1.

### Finding 27 — [minor/interop] The 'receiver restart between parts' test doesn't test the cursor hold-back

**Decision: fix.**

- **JS `relay.test.mjs` "large file in several parts survives a receiver restart between parts"**:
  1. Publish parts 0–1 and poll.
  2. `advance(60_000)`, publish an unrelated url item and poll.
  3. Assert `(await storage.get('inboxSince')) <= Math.floor(t0 / 1000) − 1800`.
  4. Restart the Receiver, `advance(60_000)`, publish parts 2–3 and poll.
  5. Assert the file is delivered byte for byte.
- **Kotlin `partsArrivingAcrossPollsHoldTheCursor`:** the same, using the mock's `/__mock/clock` control.

A mutant that drops the hold must fail both.

**Touches:** T/V, Kotlin tests.

### Finding 28 — [minor/interop] An undocumented 64 KiB header cap

**Decision: fix.**

- **Spec §2:** `len(headerJson) ≤ 65,536`. A receiver ignores a frame with a longer header. §2.1 says "x- fields must
  be small; the whole header must stay within 64 KiB".
- **Sealing:** `encryptFrame` / `FrameCodec.seal` / `Frame.seal` throw on a header over 65,536 bytes. With today's
  clamped fields that cannot happen (the largest is 14,036 bytes, section 2.3). A sender needs no tighter cap, because
  any header up to 65,536 bytes keeps a frame within 1,966,116 bytes.
- **Vectors:** a seal vector with a header of exactly 65,536 bytes opens; an `invalidFrames` vector with 65,537 is
  refused.

**Touches:** JS, Kc (`FrameCodec`), Sw (`Frame`), T/V.

### Finding 29 — [minor/interop] MAX_ACK_IDS = 200 conflicts with the small-frame limit (with 19)

**Decision: fix.** `MAX_ACK_IDS = 70`, and every ack frame must be a small frame.

Measured with the JS library, with 60 emoji in `from` (the worst case `cleanName` allows, 240 bytes):

| ids | frame bytes | base64 characters | small? |
|---|---|---|---|
| 70 | 2,798 | 3,732 | yes |
| 71 | 2,833 | 3,780 | yes |
| 72 | 2,868 | 3,824 | no |

- With `from = "Daylight"`, up to 78 ids fit. None of the three implementations escapes non-ASCII in JSON, so the
  sizes are identical across them.
- The builders slice ids into frames of 70. There is no size-driven splitting loop: the constant is proven for the
  worst `from`, and the `acks` vectors and a test pin it.
- Senders still read ids from any ack frame, including the attachment-sized ones a v1.0 Daylight sends, up to
  `MAX_ATTACHMENT`.

**Touches:** JS, Kc (`Limits.MAX_ACK_IDS`, `Receiver.publishAcks`), Sw (`DLS.maxAckIDs`), T/V (`acks` vectors).

### Note (a) — `Sender._saveRow` is read-modify-write; make the library serialise

**Decision: fix in all three, on the store rather than the object.**

- **JS:** `Sender` and `Receiver` serialise on a promise-chain lock **per storage object**. A module-level `WeakMap`
  is keyed by the storage adapter, with one chain for senders and one for receivers. Two `Sender` instances on one
  storage, such as the extension's cached sender before and after a pairing change, therefore also serialise.
  - `send`, `checkAcks`, `resendDue`, `retry`, `remove` and `tick` run under the sender lock; `pollOnce` runs under
    the receiver lock.
  - Internally they call unlocked helpers, so `tick → resendDue → attempt` cannot deadlock.
  - Every `fetch` has a timeout (60 s; 1,800 s for attachment uploads and downloads), so a hung request on a half-open
    connection cannot hold the lock forever.
  - The extension's and web page's own locks stay. They are harmless.
- **Kotlin:** `Outbox` and `Receiver` lock on `FileLocks.of(storeFile)`, one lock object per canonical path, instead of
  `@Synchronized`. `SenderRepo.outbox()` keys its object on the pairing link, and `InboxRepo.receiver()` keys its
  object on the pairing. Both build a new object on the same files when the relay or name changes, while the old
  object may still be running in `Live` or `SyncWorker`.
- **Swift:** `OutboxStore` already coordinates file access across processes.

This also closes the three races the review refuted as unreachable: two overlapping `pollOnce`, two outbox writers,
and a tick during `send`.

**Touches:** JS, Kc, T/V (concurrency tests), Kotlin tests (two objects on one directory).

### Note (b) — `Sender.send()` aborts when the content copy hits a storage quota

**Decision: fix in JS.** Kotlin and Swift publish from the stored file, so they must store it first. A full disk
there is a share error: "This device is out of space, so it can't send this."

**After the change.**

- `send()` saves the row, then tries `storage.set('outbox/' + id, …)`. On failure it logs, keeps no copy and **still
  publishes once**.
- When such a non-url row's re-send comes due, the existing path makes it `expired` / `gone` ("This is no longer
  stored on this device. Share it again."). `checkAcks` can still mark it `delivered`. No new flag or code is needed.
- The extension's `areaStorage` and the web page's `localStorageAdapter` stop swallowing `outbox/` write errors, so the
  library sees them.

**Touches:** JS, Ext (`core.js` `areaStorage`), Web (`web-storage.js`), T/V.

### Note (c) — trimming the outbox at 200 rows leaves content behind

**Decision: fix, see finding 16.**

### Note (d) — the page body's charset is unspecified

**Decision: fix.**

- Spec §2.2: the `page` body is the HTML as **UTF-8 without a byte-order mark**. All senders already encode it that
  way (JS `TextEncoder`, Swift `Data(html.utf8)`).
- A `<meta charset>` inside may name another encoding, because the HTML is the browser's DOM serialised. Receivers
  decode the body as UTF-8 regardless.
- The Daylight Inbox writes `page.html` with `<meta charset="utf-8">` inserted, after the sha256 check, so a Reader that
  sniffs the encoding gets UTF-8. If the text, after an optional BOM and whitespace, starts with `<!doctype` (any
  case), the tag goes right after that declaration's `>`. Otherwise it goes at the very start.

**Touches:** spec, And (`InboxRepo.accept`), Android unit test.

### Note (e) — JS `normalizeRelay('ftp://x')` returns `'https://ftp//x'`

**Decision: fix in all three** (Kotlin has the same bug: it prefixes `https://` to anything not starting with
`http(s)://`). One textual rule (spec §1.3), pinned by the `relays` vectors:

1. Trim JS whitespace. Empty → `https://ntfy.sh`.
2. If the input starts with a scheme (`^[A-Za-z][A-Za-z0-9+.-]*://`), the scheme must be `http` or `https` (any case),
   else it is an error: "The relay must be an http(s) address." With no scheme, `https://` is added.
3. Drop the query, the fragment and the user info (up to the last `@` of the authority).
4. The host is required and lowercased. It must be ASCII letters, digits, `-` and `.`, or a bracketed IPv6 address.
   An internationalised name is an error; enter it in punycode.
5. The port must be digits. It is dropped when it is the default (443 for https, 80 for http).
6. A path with a `.` or `..` segment is an error. Trailing slashes are removed.

"The default relay" means the normalised relay equals `https://ntfy.sh`. With this rule that string comparison is
reliable in every language.

**Touches:** JS, Kc (`Relay.normalize`), Sw (`normalizeRelay`: IDN and dot segments), T/V.

### Note (f) — re-sending large attachments at 150 min while the first copy lives 180 min doubles quota use

**Decision: fix, see finding 9** (185 min twice, then 12 h) and section 2.3 (the two-copy margin).

---

## 4. Spec changes (PROTOCOL.md)

Line numbers refer to PROTOCOL.md as of this record. Each block quotes the old text and gives the new text.

### Title and design goals

Old (L1): `# Daylight Share protocol, version 1`

New:

```markdown
# Daylight Share protocol, version 1 (revision 1.1)
```

Add after the intro paragraph (after L4):

```markdown
Revision 1.1 changes no byte on the wire (frames, headers, topics, keys and the pairing link are those of 1.0, and `v`
stays `1`); it fixes sizes, validation and behaviour. See `CHANGES-v1.1.md` for the reasons.
```

Old (L8-10):

> - **No accounts and no server of our own.** Frames travel through an [ntfy](https://ntfy.sh) server (default
>   `https://ntfy.sh`, free, no sign-up). Any ntfy-compatible server works, including a self-hosted one with longer
>   retention.

New:

```markdown
- **No accounts and no server of our own.** Frames travel through an [ntfy](https://ntfy.sh) server (default
  `https://ntfy.sh`, free, no sign-up). A self-hosted ntfy server works too if it is open to everyone and accepts
  attachments of at least 2 MB (3.5).
```

Old (L12-14):

> - **Store and forward with acknowledgements.** ntfy.sh keeps messages for 12 hours and attachments for 3 hours. The
>   Daylight acknowledges every item it receives; a sender re-publishes anything still unacknowledged before the relay
>   forgets it, for up to 7 days. Re-publishing is safe: the Daylight deduplicates by item id.

New:

```markdown
- **Store and forward with acknowledgements.** ntfy.sh keeps messages for 12 hours and attachments for 3 hours, and
  takes attachments of up to 2 MB, 20 MB per sender at a time. The Daylight acknowledges every item it receives; a
  sender re-publishes anything still unacknowledged once the relay has forgotten it (or is about to), for up to
  7 days. Re-publishing is safe: the Daylight deduplicates by item id.
```

### §1.3 Pairing link

Old (L55-59):

> - `r` is present only when the relay is not `https://ntfy.sh`. A relay URL is `https://` (or `http://` for local
>   testing) with no trailing slash, no query and no fragment.
> - `n` is a display name for the Daylight ("Anjan's Daylight"), at most 60 characters.
> - Unknown parameters are ignored. Senders accept the link, the typed code, or the code with dashes.
> - Apps register the `daylightshare` scheme, so scanning the QR code with a phone camera opens the app and pairs.

New (the link format in L51-53 is unchanged):

```markdown
- `r` is present only when the relay is not `https://ntfy.sh`. It is the normalised relay URL
  (`vectors/test-vectors.json` > `relays`):
  1. Trim whitespace. Empty means `https://ntfy.sh`.
  2. A scheme other than `http` or `https` (any case) is an error, never turned into `https://…`. With no scheme,
     `https://` is added.
  3. The query, the fragment and any user info are dropped.
  4. The host is required and lowercased: ASCII letters, digits, `-` and `.`, or a bracketed IPv6 address
     (internationalised names in punycode).
  5. A port must be digits; the default port (443 for https, 80 for http) is dropped.
  6. A path with a `.` or `..` segment is an error; trailing slashes are removed.
- `n` is a display name for the Daylight ("Anjan's Daylight"), at most 60 characters.
- Unknown parameters are ignored. Senders accept the link, the typed code, or the code with dashes.
- **Confirmation.** Apps register the `daylightshare` scheme. A pairing that arrives from outside the app (a QR code
  scanned with the phone's camera, a tapped link, the web sender's `#pair=`) takes effect only after the user
  confirms on a screen that shows the Daylight's name, the first group of the code ("Code starts E4AY") and the relay
  host when it is not ntfy.sh. When this device already sends to a Daylight with a different secret, the screen says
  that it replaces it and that items not yet delivered to it will not be sent.
- A link with the same secret as the current pairing (a re-scan, a new name or relay) applies without asking; the app
  says "Pairing updated", naming the new relay when it changed. A code typed, pasted or scanned on the app's own
  pairing screen asks only when it would replace a pairing with a different secret. What happens to the outbox is in
  3.3.
```

### §2 Frames

After L83 (`plaintext = u32be(len(headerJson)) || headerJson (UTF-8 JSON object) || body (bytes, may be empty)`) add:

```markdown
`len(headerJson)` is at most 65,536 bytes; a receiver ignores a frame with a longer header, and a sender never seals
one. A frame is therefore at most `chunk + 65,572` bytes.
```

### §2.1 Item header

Old (L96): ``| `url` | string | url, page | The `http(s)` address (at most 4096 characters). Optional for `file` (where it came from). |``

New: ``| `url` | string | url, page | The address; it must pass the web URL rule (section 4). Optional for `file` (where it came from). |``

Old (L98): ``| `name` | string | file | File name with extension, e.g. `"paper.pdf"`; no `/` or `\` |``

New: ``| `name` | string | file | File name with extension, e.g. `"paper.pdf"`, made safe as in section 5 (at most 120 UTF-16 code units and 200 UTF-8 bytes) |``

Old (L100): ``| `size` | number | page, file | Length of the whole content in bytes, after decoding (before compression) |``

New: ``| `size` | number | page, file | Length of the whole content in bytes, after decoding (before compression): at most 8,388,608 for `page` and 268,435,456 for `file`; senders send at most 9,000,000 |``

Old (L109): `Receivers ignore unknown fields. Senders may add fields with an `x-` prefix.`

New:

```markdown
Receivers ignore unknown fields. Senders may add small fields with an `x-` prefix; the whole header must stay within
65,536 bytes.
```

### §2.2 Kinds

Old (L116-119):

> - **`page`**: a web page as the user saw it. The body is the page's HTML (`document.documentElement.outerHTML` from
>   the user's browser, so paywalled and logged-in pages work), usually `deflate-raw` encoded. `url` is the page's
>   address; the Reader uses the HTML instead of downloading it. Senders send `url` instead when the HTML is larger
>   than 8 MiB (the Reader's cap).

New:

```markdown
- **`page`**: a web page as the user saw it. The body is the page's HTML (`document.documentElement.outerHTML` from
  the user's browser, so paywalled and logged-in pages work) as UTF-8 without a byte-order mark, usually `deflate-raw`
  encoded. A `<meta charset>` inside may name another encoding (it is the browser's DOM); receivers decode the body as
  UTF-8 regardless. `url` is the page's address; the Reader uses the HTML instead of downloading it. Senders send
  `url` instead when the HTML is larger than 8 MiB (the Reader's cap).
```

Old (L120-121):

> - **`file`**: a document: PDF, EPUB, DOCX, Markdown, HTML, plain text and so on. The body is the file. `deflate-raw`
>   is allowed but pointless for PDF and EPUB; senders compress only text types.

New:

```markdown
- **`file`**: a document: PDF, EPUB, DOCX, Markdown, HTML, plain text and so on. The body is the file. `deflate-raw`
  is allowed but pointless for PDF and EPUB; senders compress only text types, and use `deflate-raw` only when it
  makes the body smaller.
```

### §2.3 Chunking

Old (L125-129):

> Let `encoded` = the body after `enc` (the whole thing). If it is longer than `CHUNK = 12 MiB` (12,582,912 bytes),
> split it into consecutive chunks of `CHUNK` bytes (the last may be shorter), at most 16 parts. Frame `i` carries chunk
> `i` with `part = i` and `parts = n`; every part repeats the full header. The receiver collects all parts of an `id`,
> concatenates the chunks in `part` order, decodes `enc`, and checks `size` and `sha256`. Senders refuse content whose
> encoded length exceeds 64 MiB.

New:

```markdown
Senders refuse content whose `size` (before compression) is over 9,000,000 bytes, before reading it where they can.
Let `encoded` = the body after `enc` (the whole thing; never longer than the content). If it is longer than
`CHUNK = 1,900,544` bytes, split it into consecutive chunks of `CHUNK` bytes (the last may be shorter): at most 5
parts. Frame `i` carries chunk `i` with `part = i` and `parts = n`; every part repeats the full header. An item that is
not split carries no `part`/`parts`. Every frame is at most 1,966,116 bytes (3.5).

The receiver accepts up to 16 parts of up to 12,582,912 bytes each (senders before 1.1 used 12 MiB chunks). It
collects all parts of an `id`, concatenates the chunks in `part` order and only then decodes `enc`: a `deflate-raw`
stream runs across part boundaries, so parts are never decoded one at a time. It decodes as a stream and stops with an
integrity error as soon as the output exceeds `size`, so it never holds more than `size` bytes; then it checks `size`
and `sha256`.
```

### §2.4 Ack header

Old (L137-138):

> Body empty. `ids` lists items the Daylight has received completely and stored (at most 200 per frame). The Daylight
> acks again whenever it sees an item it already has, so a sender that missed an ack gets another one after it re-sends.

New:

```markdown
Body empty. `ids` lists items the Daylight has received completely and stored: at most 70 per frame, so that every
ack frame is a small frame (3.1) with any `from` of up to 60 characters, kept as a message (12 hours on ntfy.sh) and
never as an attachment (3 hours). The Daylight acks again whenever it sees an item it already has, and re-publishes a
digest of the ids it has seen in the last 8 days at least every 11 hours and after any failed ack (3.4), so a sender
that missed an ack gets another one. Senders read `ids` from any ack frame, whatever its size (Daylights before 1.1
sent up to 200 per frame).
```

### §3.1 Publish

Old (L153-157):

> - **Large frame**: `PUT {relay}/{topic}` with the raw frame as the body and the headers `Filename: dls1.bin` and
>   `Message: dls1`. ntfy stores it as an attachment (at most 15 MB on ntfy.sh, kept 3 hours).
>
> A `2xx` answer means the relay has it. On `429` wait (honour `Retry-After` when present, else 10 s) and retry; on
> `413` the frame is too large for this relay (report it, do not retry).

New:

```markdown
- **Large frame**: `PUT {relay}/{topic}` with the raw frame as the body and the headers `Filename: dls1.bin` and
  `Message: dls1`. ntfy stores it as an attachment (at most 2 MB on ntfy.sh, kept 3 hours).

A `2xx` answer means the relay has it. Otherwise the item's attempt stops at that frame, and the answer decides what
happens next (3.3):

| Answer | Meaning | Retried in the call | Item becomes |
|---|---|---|---|
| network error, timeout, `408`, `5xx` | unreachable or busy | after 1 s, 2 s, 4 s (or `Retry-After`, at most 60 s) | `failed` (network) |
| `429` | rate limit or daily message limit | no | `failed` (network); this re-send pass publishes nothing more |
| `413` | this address's attachment storage or daily bandwidth is used up (ntfy answers 41301 for the per-file limit, the storage total and the bandwidth limit alike; senders never exceed the per-file limit of a relay that meets 3.5) | no | `failed` (full); this pass publishes no more attachments |
| any other `4xx` (`400`, `401`, `403`, `404`, `405`, …) | the relay refuses the request (attachments off, a login needed, a wrong address) | no | `failed` (refused) |
```

### §3.2 Receive

Old (L161-179): the whole block from the `GET {relay}/{topic}/json?poll=1&since=<cursor>` code block to "Senders read
the ack topic the same way."

New:

````markdown
```
GET {relay}/{topic}/json?poll=1&since=<cursor>
```

The answer is one JSON object per line; a receiver reads at most 64 MiB of it and treats a longer answer as a failed
poll. For each line with `"event": "message"`:

- If it has `attachment`, the frame is at `attachment.url`. Download it only if that URL is `https://`, or has the
  relay's own origin (scheme, host and port); any other URL is junk. Download at most 12,713,984 bytes: a larger
  `Content-Length` is junk without reading, and the read stops past the limit (junk). The outcome:
  - `2xx`: the body is the frame.
  - `404` or `410`: the attachment has expired; skip the message (the sender re-sends with a new message).
  - `429`: the relay is limiting this address. Do not download any more attachments in this poll: this message and
    every later attachment message in the answer are retry messages.
  - anything else (`5xx`, another status, a network error, a timeout, a connection reset while reading): a retry
    message.
- Else the frame is `base64decode(message)`. A message that is not valid base64 is junk.

Then decode the frame (section 2) and, for the inbox, feed it to the reassembler.

**Handled messages.** A message is handled when it has been decoded into a stored item, a duplicate or junk, when its
attachment has expired, or when it carried a part of an item that has since completed (stored or not) or failed its
check. Receivers remember handled ntfy message ids for 2 days and do not download them again. A retry message and a
message holding a part of an incomplete item are not handled. A receiver may skip downloading a message whose part it
still holds; it keeps holding the cursor at that item's first part.

**Cursor.** `cursor` is `all` the first time, then a Unix time in seconds. After each poll:

- if the answer had no message lines, the cursor stays;
- else `held` = the earliest `time` of anything still needed: the first part of every incomplete item (remembered
  across polls, given up 24 hours after its first part) and every retry message of this poll;
- `cursor = max(0, min(newest time in the answer, held) − 1800)`; when nothing is held, a numeric cursor never moves
  backwards.

The 30 minutes matter: ntfy stamps a message's `time` when its upload *starts* and lists it only when the upload has
finished, so a slow attachment can appear after messages stamped later than it. Re-listing costs one JSON line per
message; handled messages are not downloaded again. (A message id would also work as a cursor: ntfy replays the whole
retained history for an id it does not know, or no longer knows. Receivers use times because holding the cursor at an
incomplete item's first part needs a time.)

**Deduplication.** Receivers deduplicate by item `id`: when an item is stored, and whenever a duplicate arrives, they
remember its id with the current time, and forget it 14 days after the last sighting, so polling with `since=all` is
always safe and re-sends never deliver twice.

Senders read the ack topic with the same rules (download rule and limit, retry messages, cursor).
````

Old (L181-183, live delivery): unchanged, plus one sentence at the end:

```markdown
A message from the stream is handled exactly like one from a poll (download outcomes, holds, cursor).
```

### §3.3 Sender behaviour

Old (L187-199): the whole section body.

New:

```markdown
A sender keeps an **outbox** in persistent storage: for each item, its id, header, the content (frames are rebuilt
with fresh nonces on every publish), when it was created and last published, its status (`sending`, `sent`,
`delivered`, `failed` or `expired`) and, for `failed` and `expired`, why. Changes to one outbox happen one at a time.

1. **Share.** Refuse an item at once, with a sentence, when its content is over 9,000,000 bytes before compression.
   Otherwise store it (`sending`) and publish every frame in part order. All accepted: `sent`. Otherwise the first
   failing answer decides (3.1) and later frames are not published: `failed`, with the reason `network`, `full` or
   `refused`. A sender that cannot keep a copy of the content (a browser storage quota) still publishes once.
2. **Acks.** Read the ack topic (3.2) right after sending, again ~30 s later if the app is still running, and whenever
   the app or extension runs. An ack listing the id makes the item `delivered`, from any status; its content is then
   dropped and a small history row is kept.
3. **Re-send** (same id, same header, fresh nonces) an item that is not delivered when its next try is due. Every wait
   counts from the end of the item's last attempt:
   - `sent`, every frame a message: after 11 hours (ntfy.sh keeps messages 12 hours);
   - `sent`, some frame an attachment: after 185 minutes while the last attempt ended less than 6 hours after the
     share (so twice), then after 12 hours. ntfy.sh keeps attachments 3 hours, so the earlier copy is gone first;
   - `failed` (network): after 1 minute × min(60, 2^n), n = failed attempts since the last success;
   - `failed` (full or refused): after 185 minutes. The third such failure in a row makes the item `expired`;
   - `sending`: only after 15 minutes without progress (the process publishing it was stopped).
   A re-send pass publishes nothing more after a `429`, and no more attachment frames after a `413`. An item without a
   stored copy is not re-sent: when it is due it becomes `expired`.
4. **Expiry.** 7 days after the share, an item not delivered becomes `expired`; offer "Try again". The content of
   `expired` items is kept until 14 days after the share, then dropped. "Try again" publishes the item again with the
   same id and header and a new 7 days; without stored content it tells the user to share it again.
5. **History.** Keep every `sending`, `sent` and `failed` item. Keep at most 200 items in all by dropping the oldest
   `delivered` and `expired` ones, with their content.
6. **Pairing changes.** Pairing again with the same secret (a new relay or name) keeps the outbox; later attempts go
   through the new relay. Pairing with a different secret deletes the outbox.

Phones and browsers run this when they can (Android: WorkManager; iOS: on launch, on share and with background app
refresh; Chrome: `chrome.alarms`; Mac: a timer while the app runs).
```

### §3.4 Receiver behaviour (the Daylight Inbox)

Old (L203-214): steps 1-4.

New:

```markdown
1. Poll the inbox topic when the app starts, every 15 minutes in the background (Android WorkManager), and live while
   the app is open or "Instant delivery" is on.
2. Decode and reassemble (2.3). Verify `size` and `sha256`.
3. Store the item durably. Only then remember its id (3.2) and ack it. If storing fails (a full disk), the item's
   messages are still marked handled, but its id is not remembered and it is not acked: it arrives again with the
   sender's next re-send. The Inbox tells the user that the Daylight is out of space.
4. Ack every complete item of the poll, new or already seen (2.4). An ack that fails never loses an item: at the next
   poll after a failed ack, and at least every 11 hours, the Daylight also publishes a digest of the ids it has
   remembered in the last 8 days, newest first, at most 280.
5. Hand the item to the Daylight Reader (`com.daylightcomputer.reader`):
   - `url`: `Intent("com.daylightcomputer.reader.action.SAVE_PAGE")` with `EXTRA_TEXT` = url and
     `com.daylightcomputer.reader.extra.TITLE` = title.
   - `page`: the same, plus the HTML as a `content://` URI (the Inbox's FileProvider) in `ClipData` with MIME
     `text/html` and `FLAG_GRANT_READ_URI_PERMISSION`. The Inbox stores it with `<meta charset="utf-8">` inserted right
     after a leading `<!doctype …>` (or at the very start when there is none), so a reader that sniffs the encoding
     gets UTF-8. The Reader reads at most 8 MiB within 5 s.
   - `file`: `Intent.ACTION_SEND` with `type` = mime, `EXTRA_STREAM` = a `content://` URI, `EXTRA_TITLE`/`EXTRA_SUBJECT`
     = title, `FLAG_GRANT_READ_URI_PERMISSION`, package `com.daylightcomputer.reader`.
   If the Reader is not installed, the item stays in the Inbox, which can open it with any app. An item whose id is
   already in the Inbox is not handed over a second time.

**Relay check.** Before the Inbox saves a relay other than `https://ntfy.sh`, it checks it, and does not save it when a
step fails:

1. `PUT {relay}/dls-probe-<16 random hex digits>` with 1,966,116 random bytes (the largest frame a sender makes) and
   `Filename: probe.bin`: the answer must be `200` with an `attachment.url`. (`413`: the attachment limit is under
   2 MB. `400`: attachments are off. `401`/`403`: the relay needs a login.)
2. `attachment.url` must pass the download rule (3.2), and downloading it from the Daylight must return the same bytes.

A relay saved before revision 1.1 is checked once in the background; a failure shows a warning and never changes the
saved relay or the pairing code.
```

### §3.5 Relay requirements and limits (new section)

```markdown
### 3.5 Relay requirements and limits

**Requirements.** The relay is an ntfy server (or compatible) that anyone can publish to and read from without logging
in, that keeps messages for at least 12 hours, and that accepts attachments of at least 2,000,000 bytes. On ntfy that
means `base-url` and `attachment-cache-dir` are set, `attachment-file-size-limit` is at least `2M`, and `base-url` is
the relay's own address or an `https://` address that the Daylight can reach. ntfy.sh qualifies.

**Sizes.** Every sender uses the same sizes on every relay: chunks of 1,900,544 bytes and items of at most 9,000,000
bytes before compression, so at most 5 parts. A frame is then at most 1,900,544 + 65,536 + 36 = 1,966,116 bytes,
under ntfy.sh's 2 MB per attachment, and two copies of the largest item (at most 18,655,720 bytes with the largest
headers) fit in its 20 MB per sender, so a retry that overlaps the first copy still fits.

**ntfy.sh's other limits**, per IP address (a phone and a Daylight on the same home network share them): 250 messages
a day (each frame is one message); 200 MB of attachment traffic a day, where an attachment counts when it is uploaded
and again each time it is downloaded, both against the uploader; and a burst of 60 requests, then one every 5 seconds.
Going over gives `429` or `413`, handled as in 3.1 and 3.3.
```

### §4 Limits

Old (L220-229): the whole table.

New:

```markdown
| | Limit |
|---|---|
| URL | 4096 UTF-16 code units; see "Web URL" below |
| Title | 300 code points |
| Names (`from`, `n`) | 60 code points |
| File name | 120 UTF-16 code units and 200 UTF-8 bytes (section 5) |
| Header JSON | 65,536 bytes |
| Item a sender sends | 9,000,000 bytes before compression ("9 MB") |
| Page HTML | 8 MiB (8,388,608) decoded, the Reader's cap; larger pages go as `url`; receivers refuse a larger `size` |
| File a receiver accepts | 268,435,456 bytes decoded |
| Chunk | 1,900,544 bytes sent; up to 12,582,912 accepted (senders before 1.1) |
| Parts | 16 accepted; a sender needs at most 5 |
| Frame a sender publishes | at most 1,966,116 bytes |
| Attachment download | 12,713,984 bytes |
| Poll answer | 64 MiB |
| Ack ids per frame | 70 |
| Cursor overlap | 1,800 s |
| Remembered item ids | 14 days after the last sighting |
| Remembered message ids | 2 days |
| Incomplete items | given up 24 hours after their first part |
| Outbox | expiry 7 days; content kept 14 days after the share; 200 finished items |
| ntfy.sh | messages up to 4,096 bytes, kept 12 h; attachments up to 2 MB each and 20 MB per address at a time, kept 3 h; per address and day: 250 messages and 200 MB of attachment traffic; requests: a burst of 60, then one every 5 s |

**Web URL.** A `url` (and anything a sender sends as one) passes this rule, which returns the trimmed input
unchanged; senders and receivers apply the same rule (`vectors/test-vectors.json` > `urls`):

1. Trim JS whitespace. Refuse if empty or longer than 4096 UTF-16 code units, or if it contains any JS whitespace or
   control character (`\p{Cc}`).
2. It must start with `http://` or `https://` (any case).
3. The authority is what follows `://` up to the first `/`, `?` or `#`; the host part is what follows its last `@`.
4. If the host part starts with `[`, the host runs to the first `]` (refuse if there is none) and what follows must be
   empty, or `:` and zero or more ASCII digits. Otherwise the host runs to the first `:`, and what follows that `:`
   must be zero or more ASCII digits.
5. Refuse an empty host, a host starting with `.`, or a host containing any of `< > ^ | \`.
```

### §5 Security notes

Old (L233-242): the whole list.

New:

```markdown
- The relay learns: two random topic names, frame sizes and timing, and the sender's and receiver's IP addresses.
- Anyone with the pairing code can send to and read from the inbox. "Reset pairing" on the Daylight makes a new
  secret; every sender must pair again.
- A pairing that arrives by link is applied only after the user confirms (1.3), so a link from someone else cannot
  silently redirect what this device sends.
- A receiver treats everything in a frame as untrusted input: it validates the header (`checkItemHeader` in the JS),
  accepts only URLs that pass the web URL rule (section 4), clamps strings, sanitises the file name, decodes with a
  size bound (2.3), downloads attachments only from https or the relay's own origin and only up to the size limit
  (3.2), and never forwards anything except through the Reader's own untrusted-input entry points.
- **Replays.** The relay keeps copies of frames. It cannot read or change them, but it can publish one again. Within
  14 days of the Daylight's last sighting of an item, a replay is only acked again. After that, the item is delivered
  again: a duplicate in the Reader, nothing more. This is accepted; a check on `sent` would make delivery depend on
  device clocks.
- Safe file name (`vectors/test-vectors.json` > `fileNames`, `fileNamesUtf16`): remove lone surrogates; split on `/`
  and `\`; in each segment turn each run of control characters and `: * ? " < > |` into one space, turn each run of
  whitespace into one space, drop leading dots and spaces, trim; drop empty segments; join with one space; empty ->
  `document`. If the result is over 120 UTF-16 code units or 200 UTF-8 bytes: keep the extension (from the last `.`,
  if that is not the first character and 1-10 UTF-16 units follow it) and remove whole code points from the end of
  the rest until both limits hold.
- Nonces are random 96-bit values; at the volumes here the collision risk is negligible.
```

---

## 5. Test and vector changes

### 5.1 Vectors (`share/vectors/generate.mjs` → `test-vectors.json`)

All new groups are deterministic. Ports run every group. The one exception: Swift skips `fileNamesUtf16`, because
Swift strings cannot hold lone surrogates.

| Group | Change |
|---|---|
| `pairing` | Unchanged. |
| `codeParsing` | Add "look-alike digits 0 and 1": secret = first 16 bytes of SHA-256(`vector-lookalike-5`), code `V5NHVYBMSZPOPZIDLP2OP6P54VLA`, input `V5NHVY8MSZP0PZ1DLP20P6P54VLA`. |
| `relays` (new) | `{input, expect}` or `{input, error: "relay"}`. Expected results: `''`→`https://ntfy.sh`; `ntfy.sh`→`https://ntfy.sh`; `https://ntfy.sh/`→`https://ntfy.sh`; `https://NTFY.sh:443`→`https://ntfy.sh`; `HTTPS://Relay.Example.org:443/ntfy//`→`https://relay.example.org/ntfy`; `http://192.168.1.10:8080`→same; `relay.example.org:8443/`→`https://relay.example.org:8443`; `https://relay.example.org/ntfy?x=1#y`→`https://relay.example.org/ntfy`; `https://user:pw@relay.example.org`→`https://relay.example.org`; `http://[::1]:8080/`→`http://[::1]:8080`. Errors: `ftp://x`; `https://`; `https://relay.example.org/a/../ntfy`; `https://relay.example.org/./ntfy`; `https://bücher.example/`; `https://relay.example.org:84a/`. |
| `sizing` (new) | `{chunk: 1900544, maxItem: 9000000, largestFrame: 1966116}` and cases `{size, parts}` / `{size, error: "too-large"}`: 1 → 1; 1,900,544 → 1; 1,900,545 → 2; 9,000,000 → 5; 9,000,001 → too-large. |
| `urls` (new) | `{input, expect}` (`expect` null = refused). Refused: `https:/example.com/story`, `https:example.com/story`, `https:\\example.com\story`, `https://.example.com/story`, `https://example.com:8a/x`, `https://a.b:1:2/`, `https://example.com/a b`, `https://[::1`, `javascript:alert(1)`, `https://`, `https://?q=1`, `https://exa\|mple.com/`, `https://example.com\story`, `https://example.com/` + U+0000, `https://example.com/` + U+00A0 + `x`, a 4097-unit URL. Accepted unchanged: `https://example.com:99999/x`, `HTTPS://EXAMPLE.COM/A`, `https://bücher.de/`, `https://user:pw@example.com/`, `https://[::1]:8080/`, `https://example.com:/x`, `https://example.com/` + U+200B + `x`, a 4096-unit URL. Trimmed: `' https://example.com/x '` → `https://example.com/x`. |
| `seal` | Add "header of exactly 65,536 bytes": `{"v":1,"x-pad":"aaa…"}` padded to 65,536 bytes, empty body, nonce label `header-max`. |
| `invalidFrames` | Add "header of 65,537 bytes" (the same, one byte longer, sealed directly). |
| `items` | Rename the text item to "text file, deflate-raw, 3 parts (chunk 16)" with `chunkSize: 16` (assert `1 < frames.length <= 8`). Add "text file, deflate-raw, parts out of order" with frames `[2, 0, 1]`. |
| `invalidItems` (new) | Frames that decrypt and pass header checks but must fail reassembly with `integrity`, without inflating more than `size`: (1) "deflate bomb": `enc: deflate-raw`, `size: 10`, body = deflate-raw of 1,048,576 zero bytes; (2) "size too small": identity body of 20 bytes, `size: 10`; (3) "sha256 mismatch". Each is `{name, framesHex, error: "integrity"}`. |
| `badHeaders` | Give every existing entry `sent: "2026-10-17T22:00:00.000Z"`. Add "page size over 8 MiB" (`size: 8388609`) and "file size over 256 MiB" (`size: 268435457`). |
| `fileNames` | Add: `'. .hidden'`→`'hidden'`; `'.. ..profile'`→`'profile'`; `'x/ . .bashrc'`→`'x bashrc'`; `'a'×115 + '😀'×5 + '.pdf'`→`'a'×115 + '.pdf'`; `'x'×150 + '.webarchive'`→`'x'×109 + '.webarchive'`; `'x'×150 + '.properties1'`→`'x'×120`; `'日本語のファイル名'×12 + '.pdf'`→ 65 CJK characters + `'.pdf'` (199 bytes); `'한국어파일이름'×15 + '.epub'`→ 65 Hangul characters + `'.epub'` (200 bytes); `'a' + U+00A0 + U+3000 + 'b' + U+FEFF + '.pdf'`→`'a b .pdf'`; `'a' + U+0000 + 'b' + U+007F + 'c' + U+0085 + 'd.pdf'`→`'a b c d.pdf'`; `'report.'`→`'report.'`; `'...'`→`'document'`. |
| `fileNamesUtf16` (new) | `{inputUtf16: [code units], expect}`: `[97, 0xD83D, 98, 46, 112, 100, 102]` (`a` + lone high surrogate + `b.pdf`) → `'ab.pdf'`; a lone low surrogate the same way. |
| `acks` (new) | `{name, idLabels, from, sent, headerJson, frameLength, small}` with ids = the first 32 hex digits of SHA-256(`ack-id-<i>`) and `from` = 60 × U+1F600: 70 ids → 2,798 / small; 71 → 2,833 / small; 72 → 2,868 / not small. |
| `statusText` (new) | `{name, row: {kind, status, errorCode, size, created}, now, label, sentence, action}`, one case for every row of the 2.5 table (12 cases, including `sent` 23 h and 25 h old, and `too-large` with `size: 14200000` → "this one is 14.2 MB"). Plus `formatMB`: 9,000,001 → "9.1"; 12,000,000 → "12"; 14,200,000 → "14.2". |
| `notes` | Describe the new groups. Say that `sizing`, `acks` and `statusText` check arithmetic, serialisation and copy, not crypto. |

### 5.2 Mock relay (`share/js/mock-relay.mjs`)

Options, with the matching CLI flags for the Kotlin `MockRelay.start(...)`:

| Option | Default | CLI | Behaviour |
|---|---|---|---|
| `attachmentMaxBytes` | 2,000,000 | `--attachment-max` | per-file limit |
| `visitorAttachmentTotalBytes` | 20,000,000 | `--visitor-total` | live attachment bytes per visitor, charged to the uploader, freed 3 h (mock clock) after the upload started |
| `attachments` | true | `--no-attachments` | false → every attachment publish answers `400 {code: 40014}` |
| `early413` | false | `--early-413` | answer an over-limit PUT's `413` before reading the body, then close the connection (a Go ntfy server without a proxy in front) |
| `control` | false | `--control` | enables the `/__mock/*` endpoints and the `X-Mock-*` request headers below |

Behaviour fixes:

1. **413 like ntfy.** If `Content-Length` is over the per-file limit, or over the visitor's remaining total, answer
   `413 {code: 41301, http: 413, error: "attachment too large, or bandwidth limit reached"}` and drain the body with
   `req.resume()` (unless `early413`). Otherwise read the whole body, and answer the same 413 at the end if it is over a
   limit. Never call `req.destroy()`.
2. **Time at request start.** `const t = nowSec()` before reading the body. The message is appended to the topic
   list (and becomes visible to polls) only after the body is read.
3. **Visitor** = the `X-Mock-Visitor` header (with `control`), else the remote address.
4. **Test hooks** (with `control`; JS tests can also pass functions):
   - `failDownload(id, n) → status | 'reset' | null` (`POST /__mock/fail-downloads?count=&status=`);
   - `failPublish(topic, n, isAttachment) → status | null` (`POST /__mock/fail-publish?count=&status=&topic=`), which
     covers `429`, `400`, `403`, `404`, `405` and a quota `413`;
   - `X-Mock-Hold: <ms>` on a publish keeps the message invisible for that long after its body is read;
   - `POST /__mock/clock?offsetSec=` moves the mock's clock;
   - `state.downloadsById` counts downloads per attachment.

### 5.3 JS tests (`share/js/test`)

`protocol.test.mjs`:

- all new vector groups, with `describeRow` run against `statusText`;
- `inflateRaw(bomb, 10)` rejects with `integrity`, and a counter on the stream shows it read less than 70 KiB of
  output;
- `buildItemFrames`:
  - a 9,000,000-byte PDF → 5 frames, each ≤ 1,966,116 bytes;
  - 9,000,001 bytes → `too-large` with "9.1 MB" in the message;
  - a 9,000,001-byte text file → `too-large` (the limit is on `size`, though it compresses);
- `encryptFrame` with a 65,537-byte header throws;
- `buildAckFrame` with 70 ids and the 60-emoji `from` is small;
- `normalizeRelay` errors;
- the multi-part deflate round trip (finding 23).

`relay.test.mjs`. The mock runs with ntfy.sh defaults; the clock is injected.

1. "a 5 MB PDF goes in 3 parts and arrives".
2. "413: failed/full, no publish before 185 min, then sent" (visitor total 3,000,000; a second file while the first
   is live).
3. "three full in a row → expired/full; Try again starts over and sends".
4. "early 413: the row ends failed, and the pass publishes no further attachment". Node's `fetch` may report `full`
   or `network` here; the test records which, and `live-ntfy.mjs` pins what ntfy.sh does.
5. "400 → failed/refused, retried after 185 min, the third → expired/refused; a url item still goes"
   (`attachments: false`).
6. "a v1.0 row over 9 MB becomes expired/too-large when due, its content is dropped and nothing is published".
7. "a download 429 / 503 / reset holds the cursor; the item arrives at the next poll", and "after a 429 no further
   attachment is fetched in that poll" (`downloadsById`).
8. "an expired attachment (404) lets the cursor pass and is requested once over three polls".
9. "a late-landing attachment is not skipped": PUT with `X-Mock-Hold: 500`; during the hold, `advance(60_000)`,
   publish a link and poll; after it, poll again; the PDF arrives.
10. Finding 27's restart test (section 3, finding 27).
11. "accept() throwing → storeError, not acked, its messages not downloaded at the next poll; after the sender's
    185-min re-send with a working accept, delivered".
12. "an ack publish failure (`failPublish` on the ack topic) → items still returned, with ackError; nothing thrown".
13. "a duplicate 13 days later is acked, not delivered"; "15 days after the last sighting it is delivered again" (this
    documents the accepted replay).
14. "Try again on an expired file sends it (content kept) with the original `sent`"; "after 14 days Try again →
    expired/gone".
15. "the outbox cap keeps pending rows and drops the content of evicted finished rows" (201+ rows).
16. "a quota error on the content copy still sends once; when the re-send is due the row becomes expired/gone".
17. "concurrent `send()` and `tick()` on one Sender, and on two Senders sharing one storage, lose no rows and publish
    each item once" (note a).
18. "re-send timing: publishes at 0, 185 and 370 min, then every 12 h" (count publishes over 3 days).
19. "the pass stops: after a 429 nothing more is published in that `resendDue`; after a 413 no attachment goes but a
    due url item does".
20. "a v1.0-style 150-id ack attachment is still read by `checkAcks`".
21. "a fetch that never answers is aborted (timeouts injected small) and the lock is released".
22. "retry() on a sent row publishes nothing".

`live-ntfy.mjs`: a 4,000,000-byte file (3 parts) plus the existing three items; a 2,100,000-byte PUT comes back to
`fetch` as `413` (a `200` means ntfy.sh raised its limit: log it, do not fail); the `/v1/account` canary
(finding 2); keep the CORS preflight check.

### 5.4 Kotlin tests (`android/share-core/src/test`)

- `VectorsTest`: the new groups (`relays`, `sizing`, `urls`, `fileNames` + `fileNamesUtf16`, `invalidItems`, `acks`,
  `statusText`, the `seal`/`invalidFrames` header sizes, `badHeaders`).
- `RelayTest`:
  - rename `attachmentsResendAfter150MinutesAndExpireAfter7Days` →
    `attachmentsResendTwiceAt185MinutesThenEvery12Hours`;
  - extend `partsArrivingAcrossPollsHoldTheCursor` (finding 27, mock `--control` clock);
  - add:
    - `downloadFailureHoldsTheCursor`;
    - `expiredAttachmentIsNotRequestedAgain`;
    - `relayFullWaits185MinutesThenGivesUp`;
    - `refusedIsRetriedSlowlyThenExpires`;
    - `passStopsAfter429`;
    - `heldPartsAreNotDownloadedAgain` (with a new `Receiver` instance on the same files);
    - `acceptFailureWaitsForTheResend`;
    - `digestReachesARareSender` (the receiver polls every 15 min of mock time; the sender ticks at 13 h, 26 h, …; the
      row is `delivered` before day 7 and was re-sent at most twice);
    - `ackFailureTriggersDigestAtNextPoll`;
    - `outboxCapKeepsPendingRows`;
    - `twoOutboxObjectsOnOneDirectoryLoseNoRows`;
    - `twoReceiversOnOneStateFileDeliverOnce`;
    - `relayProbe` (passes; `413` at 2 MB; attachments off; a foreign `attachment.url`);
  - keep `javascriptSenderToKotlinReceiver` / `kotlinSenderToJavascriptReceiver`, now with a 5 MB file.
- `MockRelay.start` passes the new flags.

### 5.5 Android app tests (`android/app/src/test`)

- `InboxRepo.accept`:
  - stores a CJK-named PDF (byte-capped name);
  - falls back to `document.pdf` when the file system refuses the name (simulated with a stub `File` factory);
  - given the same id twice, queues it for the Reader once.
- `page.html` gets the `<meta charset="utf-8">` after a doctype, and at the start without one.
- `RoutesTest`: a `daylightshare://pair` intent never pairs without the dialog when the secret differs; the same
  secret applies directly and keeps the outbox.
- `SenderRepo`:
  - `copyIn` refuses a 9,000,001-byte stream with the sentence before copying when the size is known, and stops at
    9,000,001 bytes when it is not;
  - pairing with a different secret deletes the old outbox directory.
- `ScreensSmokeTest`: the relay save shows the probe's sentences; the Inbox shows the 2.5 sentences.

### 5.6 Swift tests (`apple/DaylightShareKit/Tests`)

- `VectorTests`: the new groups (`fileNamesUtf16` skipped), including `statusText` against `RowText`.
- `SenderTests`:
  - `testResendAfterElevenHoursThenExpireAndTryAgain` asserts that Try again keeps `sent` and that the content is kept
    until day 14;
  - add `testAttachmentResendTiming`, `testRelayFullWaitsThenExpires`, `testRefusedIsSlow`, `testPassStopsAfter429`,
    `testOutboxCapKeepsPendingRows`, `testAckCursorHoldsOnRetry`, `testRetryOnSentDoesNothing`;
  - `testTooLargeIsReported` uses 9,000,001 bytes;
  - `FakeRelay` answers 413 over 2,000,000 per PUT.
- `ShareUITests`:
  - a deep link with a different secret sets `pendingPairing` and does not pair;
  - the same secret pairs and keeps the outbox.

### 5.7 Extension and web tests

- `extension/test/unit/logic.test.mjs`: `statusInfo` follows `describeRow` for every 2.5 row.
- `core.test.mjs`:
  - a 10 MB PDF on ntfy.sh sends the link with the note "The PDF is over 9 MB, so its link was sent.";
  - an `outbox/` write that throws still sends once;
  - pairing with the same code and a new relay keeps the outbox; a different code clears it and asks first.
- `web-logic.test.mjs`: `normalizeUserUrl('https:/example.com')` → null.
- `web.e2e.mjs`:
  - `#pair=` on an unpaired page asks first;
  - a 9,000,001-byte file is refused before it is read.
- `build.test.mjs`: the bundled `daylight-share.js` equals the share copy.

---

## 6. Per-platform checklists

Each list names every change for its platform, in the order to make them. The shared rules are written out once in
this document, and every list uses them:

- 2.1: constants;
- 2.4: the sender pseudo-code;
- 2.5: the copy table;
- 2.6: the receiver pseudo-code;
- section 4: the spec text, including the URL and relay rules;
- 5.1: the vectors.

The numbers in brackets are findings, the letters are notes.

### 6.1 JS reference (`share/js/daylight-share.js`)

1. Constants:
   - `CHUNK = 1900544`;
   - remove `MAX_ENCODED` and `RESEND_ATTACHMENT_MS`;
   - add `MAX_ITEM = 9000000`, `MAX_DECODED = 268435456`, `MAX_HEADER = 65536`, `MAX_ATTACHMENT = 12713984`,
     `MAX_POLL_RESPONSE = 67108864`, `CURSOR_OVERLAP_S = 1800`, `ATTACHMENT_WAIT_MS = 185 * 60000`,
     `RESEND_FAST_WINDOW_MS = 6 * 3600000`, `RESEND_SLOW_MS = 12 * 3600000`, `SLOW_FAIL_LIMIT = 3`,
     `SENDING_STALE_MS = 15 * 60000`, `CONTENT_KEEP_MS = 14 * 86400000`, `SEEN_MSG_TTL_MS = 2 * 86400000`,
     `INCOMPLETE_TTL_MS = 86400000`, `OUTBOX_MAX_ROWS = 200`, `TIMEOUT_SHORT_MS = 60000`,
     `TIMEOUT_LONG_MS = 1800000`;
   - set `MAX_ACK_IDS = 70`. [1, 2, 9, 13, 15, 29]
2. `normalizeRelay`: the §1.3 rule (scheme check before adding `https://`, ASCII host, digits-only port, no dot
   segments). [e]
3. `webUrl`: the §4 rule. No `new URL()`. [24]
4. `safeFileName`: the finding 12 algorithm. [12, 25, 26]
5. `formatMB(bytes)` and `tooBigMessage(size)` ("Too big to send. Files can be up to 9 MB; this one is X MB."). [1]
6. `inflateRaw(bytes, limit)`: streaming with a bound (finding 10). [10]
7. `encryptFrame`: throw `ShareError('header', …)` when the header JSON is over 65,536 bytes. [28]
8. `buildItemFrames`:
   - throw `ShareError('too-large', tooBigMessage(size))` when the content is over `MAX_ITEM`;
   - keep the page message for HTML over `MAX_PAGE_HTML`;
   - chunk = `opts.chunkSize ?? CHUNK`;
   - drop the `MAX_ENCODED` check. [1]
9. `buildAckFrame`: slices to 70 (the constant). [29]
10. `checkItemHeader`: page `size` ≤ `MAX_PAGE_HTML`; file `size` ≤ `MAX_DECODED`; `url` via the new `webUrl`. `sent`
    stays a clamped string. [10, 24]
11. `Reassembler`:
    - `inflateRaw(encoded, header.size)`;
    - keep the first-part time and the message ids per pending item;
    - add `prune(maxAgeMs)`, `isPending(id)` and `drop(id)`. [10, 17]
12. `RelayClient({relay, fetch, timeouts})`:
    - every request gets `AbortSignal.timeout`: 60 s, or 1,800 s for a large-frame PUT and attachment GETs;
    - `publish`: the 2.4 answer mapping; throws `ShareError` with `.code` (`network`, `full`, `refused`) and `.status`
      (0 for network);
    - `poll(topic, since, {skip})`: read the answer with a 64 MiB cap; apply the 2.6 download rule; entries carry
      `frame`, `expired`, `junk`, `retry` or `skipped`. [4, 7, 13, a]
13. `Sender`:
    - a lock per storage object (module `WeakMap`) around `send`, `checkAcks`, `resendDue`, `retry`, `remove` and
      `tick`, with unlocked internal helpers [a];
    - new row fields `errorCode`, `slowFails`, `attemptStarted`;
    - exactly the 2.4 pseudo-code: `send`, `_attempt`, `resendDue` with the pass object, `retry`, `checkAcks`,
      `_saveRow` with the cap, `tick`;
    - the content copy in try/catch [b];
    - `remove(id)` drops the row and its content. [6, 7, 9, 15, 16, 22, b, c]
14. `describeRow(row, now)` → `{label, sentence, action}`: the 2.5 table. [S5]
15. `samePairingSecret(a, b)`. [3]
16. `Receiver({…, accept})`:
    - the receiver lock (per storage object);
    - 2.6 without the Kotlin lines, with persisted `incomplete` and in-memory part message ids;
    - returns `{items, acked, ackError, storeError}`;
    - `reassembler.prune(INCOMPLETE_TTL_MS)` each poll. [4, 5, 11, 14, 15, 17]
17. Header comment: "Version 1 (revision 1.1)". `PROTOCOL_VERSION` stays `1`.

### 6.2 Mock relay, tests, vectors (`share/js/mock-relay.mjs`, `share/js/test`, `share/vectors`, `live-ntfy.mjs`)

1. Implement section 5.2. Update the header comment and the CLI help. [20]
2. `generate.mjs`: section 5.1, including `assert(1 < textBuilt.frames.length && textBuilt.frames.length <= 8)`.
   Regenerate `test-vectors.json`. [11, 23, 24, 25, 26, 28, 29, e]
3. Tests: section 5.3. [all]
4. `live-ntfy.mjs`: section 5.3. [2]
5. `package.json` version → `1.1.0`.

### 6.3 Extension (`reader-experiment/extension`)

1. Rebuild so `src/daylight-share.js` is the new reference copy (`build.mjs`).
2. `logic.js`:
   - `MAX_PDF = MAX_ITEM` (import `MAX_ITEM` instead of `MAX_ENCODED`);
   - `NOTES['pdf-too-large']` = "The PDF is over 9 MB, so its link was sent.";
   - `statusInfo(row)` maps `describeRow(row, Date.now())` to `{label, tone, retry, hint}`:
     - tones: busy for `sending` and `failed`, sent for `sent`, ok for `delivered`, bad for `expired`;
     - the button comes from `action` ("Retry now" or "Try again"); there is none otherwise;
     - `hint` = `sentence`. [6, 7, S5, S6]
3. `core.js`:
   - `areaStorage` rethrows `outbox/` write errors [b];
   - `sendPdf`: over `MAX_PDF`, send the link with `'pdf-too-large'` (as today); with no link, throw the library's
     too-large message [1];
   - `pair`: clear the outbox only when the code differs, not when only the relay changes [S7]. When the popup's
     pairing field would replace a different code, return `{needsConfirm: {current, next}}` without pairing, as
     `needsPermission` does [3]. With the same code and a new relay, return `{updated: true, relay}` for the notice;
   - `pairFromApp` stays silent (the user's own app).
4. `popup.js`:
   - `resultMessage` shows the row's label and sentence from `describeRow`, instead of "Couldn't reach the relay (…)";
   - show the confirmation for `needsConfirm` ("This replaces <name>. Items not yet delivered to it will not be
     sent.", button "Switch");
   - show "Pairing updated…" for `updated`.
5. README and store texts: "Files and PDFs up to 9 MB."
6. Manifest `version` → `1.1.0`.

### 6.4 Web sender (`reader-experiment/web`)

1. Rebuild (`build.mjs`).
2. `web-storage.js`: `localStorageAdapter.set` rethrows `outbox/` errors. [b]
3. `app.js`:
   - `pairFromParam` asks with `confirm()` also when unpaired: "Pair this page with <name>? Code starts E4AY." plus
     the relay host when it is not ntfy.sh, and "This replaces <current>…" when the code differs. The same code keeps
     the outbox; a different code clears it [3, S7];
   - `sendFile`: when `file.size > ds.MAX_ITEM`, refuse with `ds.tooBigMessage(file.size)` before reading the file [1];
   - `describe()` and the row list use `describeRow`: label, sentence, and a button only when `action` is set
     ("Retry now" / "Try again"). [6, 7, S5, S6]
4. `web-logic.js` needs no change (`normalizeUserUrl` inherits the new `webUrl`). Add the test.
5. README: "Files up to 9 MB." SHORTCUT.md unchanged (`#pair=` now asks once).

### 6.5 Kotlin share-core (`android/share-core/.../core`)

1. `Limits` (`Pairing.kt`):
   - `CHUNK = 1_900_544`;
   - remove `MAX_ENCODED` and `RESEND_ATTACHMENT_MS`;
   - add `MAX_ITEM = 9_000_000L`, `MAX_DECODED = 268_435_456L`, `MAX_POLL_RESPONSE = 64L shl 20`,
     `CURSOR_OVERLAP_S = 1800L`, `ATTACHMENT_WAIT_MS = 185L * 60_000`, `RESEND_FAST_WINDOW_MS = 6L * 3_600_000`,
     `RESEND_SLOW_MS = 12L * 3_600_000`, `SLOW_FAIL_LIMIT = 3`, `SENDING_STALE_MS = 15L * 60_000`,
     `CONTENT_KEEP_MS = 14L * 86_400_000`, `INCOMPLETE_TTL_MS = 86_400_000L`, `DIGEST_INTERVAL_MS = 11L * 3_600_000`,
     `DIGEST_WINDOW_MS = 8L * 86_400_000`, `DIGEST_MAX_IDS = 280`;
   - `MAX_ACK_IDS = 70`;
   - in `Relay.kt`, `MAX_ATTACHMENT = 12_713_984L` as a literal. Today it is `Limits.CHUNK + 128 KiB`, which would
     shrink to 2,031,616 and refuse v1.0 senders' frames. [1, 13, 29]
2. `Relay.normalize`: the §1.3 rule. [e]
3. `Text.webUrl` (port digits, host characters, the first `:`), `Text.safeFileName` (finding 12) and `Text.formatMB`.
   [12, 24, 25, 26]
4. `FrameCodec.seal`: throw over 65,536 header bytes. `ItemHeader.check`: page `size` ≤ 8 MiB, file `size` ≤
   `MAX_DECODED`. [10, 28]
5. `ItemBuilder.prepare`:
   - refuse `size > MAX_ITEM` with `ShareException("too-large", tooBigMessage(size))`;
   - chunk `Limits.CHUNK` unless a test passes `chunkSize`;
   - no other size check. [1]
6. `AckHeader.frame`: slices to 70. [29]
7. `RelayClient`:
   - `publish` with the 2.4 answer mapping: no in-call retry for 429 or other 4xx; `RelayException(status, code)`;
   - `download(url, cap)` returns `Frame | Expired | Junk | Retry`, with the origin rule;
   - `poll` reads at most `MAX_POLL_RESPONSE` and marks every later attachment entry `Retry` after a 429;
   - `RelayMessage(id, time, frame, skipped, expired, junk, retry)`;
   - the live stream's messages are classified the same way. [4, 7, 8, 13]
8. `FileLocks.of(file)`: one lock object per canonical path, in a `ConcurrentHashMap`. `Outbox` and `Receiver`
   synchronise on their store file's lock instead of `@Synchronized`. [a]
9. `ReceiverState`: add `partMsgs` and `lastDigest`. `Receiver`:
   - exactly 2.6, including the Kotlin lines;
   - `handleLive` applies the same per-entry rules;
   - add `ackFailed()`, which sets `lastDigest = 0`;
   - `Result(items, ackIds, ackError, storeError)`;
   - `pollOnce` never throws because of acks;
   - prune with `INCOMPLETE_TTL_MS`;
   - `Reassembler.isPending(id)`. [4, 5, 11, 14, 15, 17]
10. `Outbox`:
    - new row fields `errorCode`, `slowFails`, `attemptStarted`;
    - exactly the 2.4 pseudo-code (`add`/`publish` as `send`, `attempt`, `resendDue` with the pass, `retry`,
      `checkAcks`, `saveRow` with the cap deleting `content/<id>.enc`, `remove`);
    - `hasPending()` = any `sending`/`sent`/`failed` row.

    The 15-minute `sending` rule fixes the add/publish race: a fresh `sending` row is not due. [6, 7, 9, 15, 16, 22]
11. `RowText.of(row, now)` → `(label, sentence, action)`: the 2.5 table. [S5]
12. `RelayProbe.check(relay, http)` → `null`, or `ShareException("relay", sentence)` (the finding 21 steps and
    sentences). [21]
13. The `MockRelay` test helper passes the new flags. `UrlConnectionHttp` is unchanged.

### 6.6 Android app (`android/app/.../com/daylight/share`)

1. `ui/MainActivity.handleLink`:
   - parse; if `app.sender.pairing()?.secret` equals the link's, apply it with `app.sender.pair(p)` and the notice
     "Pairing updated: now sending through <host>." (or "Pairing updated.");
   - else set `pendingPair`, for every role.

   The dialog:
   - title "Pair with ${name}?";
   - text "Code starts ${first group}. Check it matches the code on your Daylight.", plus the relay host when it is
     not ntfy.sh, plus "This replaces ${current}. Items not yet delivered to it will not be sent." when replacing,
     plus the existing Inbox-role sentence;
   - buttons "Pair" or "Switch", and "Cancel". [3]
2. `sender/SenderRepo`:
   - `pair(p)`: when the secret differs from the current one, delete `outbox/<old inboxTopic>` (rows and content)
     [S7];
   - `outbox()` stays keyed as today; the share-core lock is per file now [a];
   - `copyIn`:
     - read `OpenableColumns.SIZE` first and refuse over `MAX_ITEM` with the library's message;
     - when the size is unknown, copy with a cap of `MAX_ITEM + 1` bytes and refuse past it;
     - a failed copy (disk full) says "This device is out of space, so it can't send this.";
     - remove `MAX_RAW`. [1, b]
3. `ui/SettingsScreen` (Inbox role): "Save relay" runs `RelayProbe.check` off the main thread.
   - On failure: show the sentence and keep the old relay.
   - On success: store `Prefs.inboxRelay` and refresh the pairing (the QR code changes: "Scan the code again on your
     phones.").
   - Sender role: changing the relay keeps the outbox (same secret). [21]
4. `App` start: for a custom Inbox relay saved before 1.1, with no `Prefs.inboxRelayChecked`, run the probe once in the
   background.
   - Its result only sets a warning shown on `InboxScreen`.
   - Record the check, unless it failed with a network error.
   - Never change the saved relay or the link. [21]
5. `inbox/InboxRepo`:
   - `handleLive`: when `publishAcks` fails, call `receiver.ackFailed()`;
   - `pollOnce`: map failures to the 2.5 Inbox sentences, and keep `storeError` as the out-of-space sentence until an
     item is stored;
   - `accept`:
     - if the id is already in the list, return without queueing it again;
     - wrap the move in try/catch and fall back to `document` + ext;
     - for `page`, write `page.html` with the `<meta charset="utf-8">` insertion. [5, 12, 14, d]
6. `ui/SenderScreen` and `Components`:
   - rows through `RowText`: the label, the sentence, and a button only for `retry-now` ("Retry now") or `try-again`
     ("Try again"), so there is no Retry on `sent` rows any more;
   - the share-result message (`SenderScreen` line 68) uses the same. [6, 7, S5, S6]
7. `ui/InboxScreen`: the 2.5 Inbox sentences replace "Offline: The relay answered 429." [S16]
8. `Work.SyncWorker` and `inbox/Live`: no change beyond the share-core API.
9. README: "Files up to 9 MB."

### 6.7 Swift kit (`apple/DaylightShareKit/Sources/DaylightShareKit`)

1. `Constants.swift` (`DLS`):
   - `chunk = 1_900_544`;
   - replace `maxEncoded` with `maxItem = 9_000_000`, and remove `resendAttachment`;
   - add `maxDecoded = 268_435_456`, `maxAttachment = 12_713_984`, `maxPollResponse = 64 << 20`,
     `cursorOverlap = 1800`, `attachmentWait = 185 * 60`, `resendFastWindow = 6 * 3600`, `resendSlow = 12 * 3600`,
     `slowFailLimit = 3`, `sendingStale = 15 * 60`, `contentKeep = 14 * 86400`;
   - `maxAckIDs = 70`;
   - `maxHeaderBytes` is already 65,536;
   - `ShareError` gets `public let status: Int` (default 0). [1, 13, 29]
2. `Text.swift`:
   - `webURL`: the leading-dot check, the port after the **first** `:` (zero or more digits), the host characters;
   - `safeFileName`: leading dots and spaces together, an extension of 1–10 units after the dot, the 200-byte UTF-8
     cap with whole-scalar removal;
   - `normalizeRelay`: refuse IDN hosts and dot segments;
   - add `formatMB`. [12, 24, 25, 26, e]
3. `Frame.swift`:
   - `Frame.seal` throws over 65,536 header bytes;
   - `ItemBuilder.prepare`: refuse `size > maxItem` with the too-big message, replacing the 64 MB and parts checks;
   - chunk `DLS.chunk`. [1, 28]
4. `Header.swift`: `ItemHeader.validated` checks page `size` ≤ 8 MiB and file `size` ≤ `maxDecoded`. `AckHeader`
   caps at 70. [10, 29]
5. `RelayClient`:
   - `publish` with the 2.4 answer mapping;
   - `poll` streams the answer with a 64 MiB cap;
   - the download rule with a streaming size cap (a data delegate or `bytes(for:)`), replacing the check on `d.count`
     afterwards;
   - outcomes on `RelayMessage`; after a 429 the rest of the answer is `retry`. [4, 7, 13]
6. `Sender.swift` (`ShareSender`):
   - exactly the 2.4 pseudo-code;
   - `checkAcks`: hold on `retry` entries, `ackSince = max(0, min(newest, held) − 1800)`;
   - `resendDue`: purge `expired` content 14 d after `created` (was 30 d);
   - `retry`: keeps `header.sent`; resets `created`, `attempts` and `slowFails` for `expired`; does nothing on `sent`.
     [6, 7, 9, 15, 22]
7. `Outbox.swift`:
   - `OutboxRow` gets `errorCode: String` and `slowFails: Int` (`decodeIfPresent`, default `""` / `0`);
   - `canRetry` is replaced by `RowText.action`;
   - `OutboxStore.update` applies the cap of finding 16 (keep `sending`/`sent`/`failed`; the newest finished rows up to
     200; remove the body files of dropped rows). [16]
8. `NativeMessaging.swift`, `SharedStore.pair`: remove the outbox only when the secret differs, not when only the
   relay changes. [S7]
9. `RowText(row:now:)` → `label`, `sentence`, `action`: the 2.5 table, in the kit so the UI and the share extensions
   use it. [S5]

### 6.8 Apple UI (`DaylightShareUI`, iOS/macOS apps, share extensions)

1. `AppModel.handleOpen` for `daylightshare://`:
   - parse;
   - same secret → `store.pair(p)` and the banner "Pairing updated…";
   - else set `@Published var pendingPairing: Pairing?`.

   Views (`Views.swift`, `HomeView`, `MacViews`) show a confirmation sheet with the texts of spec §1.3. "Pair" or
   "Switch" calls `confirmPairing()`. `-DLSPairLink` stays silent (CI). [3]
2. `AppModel.pair(_:)` (typed, pasted or scanned in `PairView`): if a pairing with a different secret exists, return a
   `needsConfirmation` result and let `PairView` show the same sheet. [3]
3. `AppModel.setRelay`: keeps the outbox (kit item 8).
4. History rows, banners and the share extension's result use `RowText`: label, sentence, and a button only for its
   action. The share extension's "Not sent yet" becomes the row's label and sentence. [6, 7, S5, S6]
5. `ShareExtension.swift` and the macOS share extension: before loading a file, read its size (`fileSizeKey` on the
   file URL) and refuse over `DLS.maxItem` with the kit's message. A web page over 8 MiB goes as its link (unchanged).
   [1]
6. The Safari web extension uses the JS `extension` build (6.3). The `NativeMessaging` pairing from the app stays
   silent (it is the user's own app).

---

## 7. Not done (decided against)

| Item | Why not |
|---|---|
| **Per-relay limits** (`lf`/`lt` in the link, `/v1/account`, a sizing formula) | Helps only self-hosted relays, only for senders paired by link, and adds a way to fail on small relays. Self-hosters lose files over 9 MB. Unknown link parameters are ignored, so this can come later without a wire change. |
| **An ntfy access token** | Not a fix for any finding. It would be the one interop break, and it puts a credential in URLs. Deferred. |
| **Refusing new items with an old `sent`** (finding 11) | It makes delivery depend on device clocks, and fails silently. The replay it blocks yields a duplicate article. Accepted risk, documented in spec §5. |
| **Keeping a sender's live attachment bytes below 20 MB** (finding 9, verifier point 2) | Needs per-frame expiry bookkeeping in three languages. The per-pass circuit breaker and the 185-min `full` wait bound the waste to one partly uploaded item per pass, and the receiver no longer re-downloads its parts. |
| **Keeping a completed item and retrying the store** (robustness critique) | A rare case (a full disk) that would need a third spool state with persisted headers. Waiting for the sender's re-send costs ≤ 4 downloads a day, and the Inbox tells the user. |
| **A daily re-send budget per sender** | The queue formula (2.3) shows a realistic day stays under ntfy.sh's quotas, and the circuit breaker makes going over cheap. |
| **Probing a saved relay daily** | A 2 MB upload and download a day for a rare change. The sender gives up after 3 refused attempts with a sentence that points at the relay setting. |
| **Polling the old relay after the Inbox changes relay** | Changing the relay already shows "Scan the code again on your phones", and senders that do so keep their outbox (same secret). |
| **Storing `attachment.expires` from publish answers** | A relay with longer retention gets re-sends earlier than it needs, which is harmless and simpler than per-frame tracking. |
| **The digest and part skipping in the JS receiver** | It runs only in tests and demos. The Kotlin Inbox is the only production receiver. |
| **A size-driven splitting loop for acks** | 70 ids are proven for the worst `from`, and vectors pin it. |
| **A foreground shortcut for the 12-hour re-send** | Adds a parameter in three languages for a rare case. The row's sentence says the item is sent again twice a day. |
| **An id cursor** | It works on ntfy, but holding the cursor at incomplete items needs times. |
| **Resuming half-uploaded items part by part** | The two-copy margin makes the overlap safe. It can be added later without a spec change. |
| **WHATWG canonicalisation or ASCII-only URLs** | Only JS has the parser, and receivers must keep accepting v1.0 senders' non-ASCII URLs. |
| **Swift receiver code** | None exists beyond the test reassembler. Swift gets only the header checks and `checkAcks`. |

---

## 8. Critique log

Every point of the two critiques of revision 1, with what was done.

### 8.1 Robustness critique

| # | Severity | Point | Decision |
|---|---|---|---|
| R1 | must-fix | Any 413 counts as "full" with no limit; a wrong F (a link without `lf`, a proxy's body limit, limits lowered later) loops for a week | **Accepted, differently.** One fixed chunk removes the wrong-F cases from links. The Inbox check PUTs a real 1,966,116-byte frame, which catches a proxy limit. The third slow failure in a row ends the row (`SLOW_FAIL_LIMIT`), which bounds limits lowered later. The probe halving and the daily re-check were rejected: there is no F to advertise any more. |
| R2 | should-fix | The 185-min cadence is costed for one item, not a queue | **Accepted.** 185 min only twice, then 12 h, and the queue formula with an example (2.3). A daily budget was rejected (section 7). |
| R3 | should-fix | Nothing stops a re-send pass after a 429 or a 413 | **Accepted.** `stopAll` after a 429, `stopAttachments` after a 413, and no in-call retries for any 429 (2.4). |
| R4 | should-fix | 404/410 attachments are requested again on every poll | **Accepted.** They are handled and remembered for 2 days (finding 4). |
| R5 | should-fix | A failed store re-downloads the item on every poll | **Accepted, differently.** The item's messages become handled, so it comes back only with the sender's re-send (≤ 4 a day), and the Inbox says it is out of space. Keeping and retrying the completed item was rejected (section 7). |
| R6 | should-fix | The 8,192-byte header claim is false (14,036 bytes with a CJK URL) | **Accepted, differently.** `MAX_SENDER_HEADER` and the `header` share error are gone. With the fixed chunk, any header up to 65,536 bytes fits, and the two-copy arithmetic uses 64 KiB headers (2.3). |
| R7 | should-fix | The JS locks wrap fetches with no timeout | **Accepted.** 60 s / 1,800 s `AbortSignal` timeouts (note a). |
| R8 | should-fix | Kotlin locks are per object, but new objects are made on the same files | **Accepted.** `FileLocks` per canonical path, and a test with two objects on one directory (note a). |
| R9 | should-fix | A future `sent` sorts first in every digest | **Resolved by removal.** Seen times are the Daylight's own `now`; nothing uses `sent`. The digest window is defined as 0 ≤ now − seen ≤ 8 d. |
| R10 | should-fix | What a failed startup relay check does is unspecified | **Accepted.** A background check only warns and never changes the saved relay or link; only Save refuses (finding 21). |
| R11 | should-fix | Verifier point 2 of finding 9 (live bytes below T) is neither adopted nor listed | **Listed under Not done**, with the reason (section 7). |
| R12 | nit | `sent` parsing grammar differs per language | **Moot.** `sent` is no longer parsed or checked. |
| R13 | nit | The `lf`/`lt` grammar is undefined | **Moot.** `lf`/`lt` are dropped. |
| R14 | nit | Timing anchors are ambiguous | **Accepted.** Every wait counts from `lastPublish`, the end of the last attempt; `sending` is stale 15 min after `attemptStarted` (refreshed per accepted frame), else `lastPublish`, else `created` (2.4). |
| R15 | nit | "One frame of ≤ 2 MB per attempt" was wrong for a partly full relay | **Corrected.** At most 3 attempts of up to 4 accepted frames, about 24 MB in all (finding 7). |
| R16 | nit | Held parts from builds with different chunk sizes mix | **Rejected.** With one fixed chunk, two builds of an item with the same part count have the same chunk size (v1.0's 12 MiB and v1.1's chunk give the same count only for single-frame items). Anything else fails the sha256 check and recovers with the re-send. |
| R17 | nit | ntfy.sh detection by string differs per port | **Accepted.** The relay rule refuses dot segments and IDN hosts, so normalised strings compare reliably; vectors pin both (note e). |
| R18 | nit | The `chunkSize` default parameters let a caller fall back silently | **Rejected.** Moot: the default is the one chunk size. |
| R19 | nit | The mock drains before a 413; Go ntfy answers early and closes | **Accepted.** `early413` mock mode, and the live check that ntfy.sh's 413 reaches `fetch` (5.2, 5.3). |
| R20 | nit | The 400 sentence is wrong for url items; 405 counts as busy | **Accepted.** Every other 4xx is `refused`, with a neutral sentence (2.5). |
| R21 | nit | A crash between accept and saving state hands the item to the Reader twice | **Accepted.** `InboxRepo.accept` is idempotent by id (finding 14). |
| R22 | nit | A silent same-secret relay change; senders never told when the Inbox moves | **Accepted in part.** The notice names the relay. Polling the old relay was rejected (section 7). |
| R23 | nit | The web URL rule doesn't say whether an empty port is allowed | **Accepted.** "Zero or more ASCII digits" (finding 24). |

### 8.2 Simplicity and product critique

| # | Severity | Point | Decision |
|---|---|---|---|
| S1 | must-fix | Per-relay limits (`lf`/`lt`, `/v1/account`, the formula, the fallbacks) are a third of the change for little benefit | **Accepted.** One `CHUNK`, one `MAX_ITEM`; the relay check is a full-size PUT and GET (2.2, finding 21). |
| S2 | must-fix | The access token is a new feature and the only interop break | **Accepted.** Deferred (2.2, section 7). |
| S3 | must-fix | The stale-`sent` refusal causes silent non-delivery | **Accepted.** Dropped; seen refresh kept; replay documented as an accepted risk (finding 11). |
| S4 | should-fix | The new `rejected` status costs three state machines and five UIs, and stops healing | **Accepted.** Five statuses; slow `failed`, which heals; combined with R1, the third slow failure ends as `expired` with its code (2.4). |
| S5 | should-fix | No shared status vocabulary; "relay" in user copy | **Accepted.** The 2.5 table, generated by `describeRow`/`RowText` and pinned by `statusText` vectors; "relay" appears only where it names a setting. |
| S6 | should-fix | Try again is offered on rows that will send by themselves | **Accepted.** Buttons only for `retry-now` (network failures) and `try-again` (expired); `retry()` on a sent row does nothing. |
| S7 | should-fix | Pairing changes treat the outbox differently per platform | **Accepted.** Same secret keeps it, a different secret deletes it, everywhere (2.4, finding 3). |
| S8 | should-fix | `pendingAcks` and the digest duplicate each other; ack sizing is done twice | **Accepted.** An ack failure sets `lastDigest = 0`; no `pendingAcks`; `MAX_ACK_IDS = 70` with no splitting loop. |
| S9 | should-fix | `partMsgs` has five removal triggers | **Accepted.** One derived rule (skip while the item is held), age pruning, and every message of a finished item becomes handled (finding 17). |
| S10 | should-fix | The JS receiver gets receiver-only features that only Kotlin uses | **Accepted.** The digest and part skipping are Kotlin only; the rare-sender test moved to Kotlin. |
| S11 | should-fix | The mock gains features no client branches on | **Accepted.** Kept the 413 checks, time at start, hold, `failDownload`, `failPublish`, clock and `downloadsById`; plus R19's `early413` (5.2). |
| S12 | should-fix | The limit users see is on encoded size, so it is unpredictable | **Accepted.** The limit is on `size` before compression, checked before reading or copying; Android `copyIn` checks first (finding 1). |
| S13 | nit | Two header caps | **Accepted.** Only `MAX_HEADER` (65,536) remains; no sender cap (finding 28). |
| S14 | nit | Duplicate constants (`FULL_WAIT`, `MAX_ACK_ATTACHMENT`, `MAX_POLL_RESPONSE`), and `copy`/`nocopy` | **Accepted.** One `ATTACHMENT_WAIT`, one download cap, Kotlin's 64 MiB poll cap everywhere; a failed copy uses the existing `gone` path (note b). |
| S15 | nit | After day 1, a user may wait 12 h with no way to hurry it | **Accepted as copy.** The `sent` row says "It is sent again twice a day." The foreground shortcut was rejected (section 7). |
| S16 | should-fix | The Daylight has no plain sentences for new conditions | **Accepted.** Inbox sentences for out of space, 429/413, offline and relay errors (2.5). |
