# Daylight Share protocol v1.1: decision record

Status: decided, ready to implement. Scope: `reader-experiment/share` (spec, JS reference, mock relay, tests and vectors),
`reader-experiment/android` (share-core and the app), `reader-experiment/apple` (DaylightShareKit and the app UI),
`reader-experiment/extension` and `reader-experiment/web`.

Inputs: the adversarial review (29 confirmed findings), the platform builders' notes (a)-(f), the ntfy docs
(publish.md limits table, subscribe API replay rules, config.md) and the ntfy server source the reviewers checked
(`server_server.go` `handleBodyAsAttachment`, `handleFile`, `handleAccountGet`, `readAuthHeader`;
`message_cache.go` `ResolveMarker`/`MessagesAfterMarker`).

---

## 1. Summary

**What is broken.** Version 1 assumes ntfy.sh takes 15 MB attachments. It takes 2 MB each and 20 MB per IP address at a
time. With `CHUNK = 12 MiB`, every page or file whose encoded form is over about 2 MB gets `413`, and the sender then
re-uploads it about once an hour for a week. Several other bugs make delivery unreliable: download failures are
treated as "expired", the 5-second cursor overlap skips slow uploads, acks expire before senders that run rarely can
read them, and the 200-id ack batch turns into an attachment. There are also security and interop gaps: deep links
pair without asking, the JS receiver follows any attachment URL with no size cap and inflates without a bound, old
frames can be replayed, and file names and URLs are validated differently by each implementation.

**What changes.**

1. **Sizes come from the relay.** Chunk size and largest item are worked out from two numbers, F (largest
   attachment) and T (attachment bytes one sender may keep on the relay at once). For ntfy.sh, F = 2,000,000 and
   T = 20,000,000, giving 1,900,544-byte chunks and items of up to **9 MB** (encoded). For other relays the Daylight
   Inbox checks the relay and writes F and T into the pairing link (`lf`, `lt`). An optional ntfy **access token**
   (`k`) lets paid ntfy.sh tiers and protected servers work.
2. **Failures are classified.** A `413` within the per-file limit means "relay full": wait 185 min. Other `4xx`
   answers make the row `rejected`, a new status that is never retried by itself. Re-sends of items with
   attachments wait until the earlier copy has expired (185 min), and after the first day they slow to every 12 h.
3. **Receive is robust.** Only `404`/`410` count as expired. `429`, `5xx` and network errors hold the cursor. The
   cursor overlap is 30 min. Parts already stored are not downloaded again. Items are stored before they are marked
   seen, ack failures are retried, and the Daylight re-publishes an ack digest every 11 h. Acks carry at most 70 ids
   and are always messages, never attachments.
4. **Inputs are checked the same way everywhere.** There is one URL rule, one safe-file-name rule (with a UTF-8 byte
   cap) and one relay-normalising rule, each pinned by vectors. Headers are capped (64 KiB accepted, 8 KiB built).
   Inflating is bounded. Replays are refused using `sent`. Attachment downloads are restricted and size-capped. A
   pairing that arrives by link must be confirmed by the user.

**What stays.** The wire format is unchanged: magic, nonce, AES-GCM, AAD, header fields, `v: 1`, topics, keys,
small/large frame split and the ack format. Every v1.0 sender and receiver still interoperates with v1.1. The one
exception is narrow: a v1.0 sender cannot use a relay that requires the new token. All other changes are constants,
validation and local state.

**Compatibility at a glance.**

| | v1.0 receiver (Inbox) | v1.1 receiver |
|---|---|---|
| **v1.0 sender** | as today | works; old 12 MiB frames still fail on ntfy.sh (sender-side bug, fixed by upgrading the sender); a "Try again" on an item whose `sent` is over 13 days old and whose id the Daylight has forgotten is refused (not acked) |
| **v1.1 sender** | works: frames ≤ 1,966,116 bytes and ≤ 16 parts are within v1.0's 12 MiB + 128 KiB download cap; v1.1 file names are already safe under v1.0 rules | works |

`lf`/`lt`/`k` in a v1.1 link are ignored by v1.0 senders. Unknown parameters were already ignored.

---

## 2. New and changed constants

### 2.1 Table

All sizes are in bytes. "Wire" means it affects what other implementations must accept.

| Name | v1.0 | v1.1 | Wire? | Where |
|---|---|---|---|---|
| `CHUNK` | 12,582,912 | **removed**: replaced by `chunk(F)` (2.3); `CHUNK_MAX = 12,582,912` is the upper bound | no (receivers accept any chunk ≤ `CHUNK_MAX`) | senders |
| `MAX_ENCODED` | 67,108,864 | **removed**: replaced by `maxEncoded(F, T)` (2.3); `MAX_ENCODED_CAP = 64,000,000` | no | senders |
| `MAX_DECODED` (new name for v1.0's implicit `MAX_ENCODED × 4`) | 268,435,456 | 268,435,456 (file `size` cap); `page` `size` ≤ `MAX_PAGE_HTML` | yes (receivers) | all |
| `FRAME_OVERHEAD` | (implicit) | 36 = 4 magic + 12 nonce + 4 header length + 16 tag | yes | all |
| `MAX_HEADER` | 65,536 in JS/Kotlin/Swift, not in the spec | 65,536, now in the spec | yes | receivers |
| `MAX_SENDER_HEADER` | none | 8,192 (largest item header a sender builds) | no | senders |
| `NTFYSH_FILE_LIMIT` / `NTFYSH_TOTAL_LIMIT` | none | 2,000,000 / 20,000,000 | no | senders |
| `NTFY_DEFAULT_FILE_LIMIT` / `NTFY_DEFAULT_TOTAL_LIMIT` | none | 15,000,000 / 100,000,000 (ntfy's server defaults; used for a custom relay whose link has no `lf`/`lt`) | no | senders |
| `MIN_FILE_LIMIT` / `MIN_TOTAL_LIMIT` | none | 1,000,000 / 4,000,000 (smallest `lf`/`lt` accepted in a link or by the relay check) | no | all |
| `MAX_ATTACHMENT` (download cap) | Kotlin only: 12,713,984; JS none; Swift 16 MiB | 12,713,984 = `CHUNK_MAX` + 131,072 everywhere; ack attachments 1,048,576 | yes | receivers, ack readers |
| `MAX_POLL_RESPONSE` | Kotlin 64 MiB, JS/Swift none | 16,777,216 (ntfy caps a replay at 10 MB per topic) | no | all |
| `MAX_ACK_IDS` | 200 | **70**, and every ack frame must be small | yes | Daylight |
| `CURSOR_OVERLAP` | 5 s | **1,800 s** (inbox and ack cursors) | no | receivers, senders |
| `RESEND_MESSAGE` | 11 h | 11 h | no | senders |
| `RESEND_ATTACHMENT` | 150 min | **185 min** during the first 24 h after the share | no | senders |
| `RESEND_ATTACHMENT_SLOW` | none | 12 h after the first 24 h | no | senders |
| `FULL_WAIT` | none | 185 min (next try after a `413` within the per-file limit) | no | senders |
| `FAILED_BACKOFF` | 1 min × min(60, 2^attempts) | unchanged | no | senders |
| `SENDING_STALE` | Swift only: 15 min | 15 min everywhere | no | senders |
| `OUTBOX_EXPIRY` | 7 d | 7 d | no | senders |
| `CONTENT_KEEP` | JS: dropped at expiry; Kotlin: 14 d after `created`; Swift: 30 d | 14 d after `created` everywhere | no | senders |
| `OUTBOX_MAX_ROWS` | 200 rows of any status | 200, counting only finished rows (`delivered`, `expired`, `rejected`) | no | senders |
| `SEEN_TTL` | 14 d after first seen | 14 d after `max(now, sent)` of the latest sighting | no | receivers |
| `STALE_AFTER` | none | 13 d (= `SEEN_TTL` − 1 d): a new id whose `sent` is older is refused | yes (behaviour) | receivers |
| `SEEN_MSG_TTL` | 2 d | 2 d | no | receivers |
| `INCOMPLETE_TTL` | Kotlin: 24 h; JS: none | 24 h everywhere | no | receivers |
| `DIGEST_INTERVAL` / `DIGEST_WINDOW` / `DIGEST_MAX_IDS` | none | 11 h / 8 d / 280 | no | Daylight |
| `PENDING_ACKS_MAX` | none | 280 | no | Daylight |
| `SAFE_NAME_MAX_UNITS` / `SAFE_NAME_MAX_BYTES` / `SAFE_EXT_MAX` | 120 / none / 10 including the dot (JS, Kotlin) | 120 UTF-16 units / **200 UTF-8 bytes** / **10 after the dot** | yes (vectors) | all |
| `MAX_PARTS`, `MAX_URL`, `MAX_TITLE`, `MAX_NAME`, `MAX_PAGE_HTML`, `SMALL_FRAME_B64_MAX` | 16, 4096, 300, 60, 8,388,608, 3800 | unchanged | yes | all |

### 2.2 Decisions

**Largest file on ntfy.sh: 9 MB encoded (9,000,000 bytes).** PDFs and EPUBs are not compressed, so "9 MB" is what the
user sees for them. Text, HTML and Markdown compress, so larger raw files fit. Pages are at most 8 MiB of HTML, and
after deflate that is well under 9 MB. Anything larger is refused before it is queued: "That file is larger than
9 MB, the most your Daylight's relay can carry." The extension and the web page send the link instead when there is
one, as they already do for PDFs over the old cap.

**Other relays get their own numbers, and the sender learns them from the pairing link.** No limits request is made
at send time. The order is:

1. The link carries `lf=<F>&lt=<T>`. The Daylight Inbox writes these only after its relay check (3.4 of the new
   spec), which reads `GET {relay}/v1/account`. ntfy answers it anonymously ("Allowed by anonymous" in
   `server_server.go`) with `limits.attachment_file_size` and `limits.attachment_total_size`.
2. No `lf`/`lt`, and the relay is `https://ntfy.sh`: F = 2,000,000, T = 20,000,000.
3. No `lf`/`lt`, and the relay is something else (a link from a v1.0 Inbox): ntfy's documented server defaults,
   F = 15,000,000, T = 100,000,000. This gives a 12 MiB chunk and a 49 MB largest item, which keeps v1.0's
   behaviour on self-hosted relays.

Why not fetch `/v1/account` from every sender? It would add a request, a cache, a fallback and a CORS question for
the web page on three platforms, and the answer only matters when the relay is not ntfy.sh. The Inbox is the one
place where a custom relay is entered (and where finding 21 needs a check anyway), so it is done once, in Kotlin.

**Access token: yes, minimal.** The link carries `k=<ntfy access token>`. Every request to the relay's origin
(publish, poll, stream, `/v1/account`) adds the query parameter `auth=<base64url-nopad("Bearer " + token)>`. ntfy's
`readAuthHeader` decodes `auth` with `base64.RawURLEncoding` and treats it exactly like an `Authorization` header.

- *Why a query parameter and not the header:* the web sender is a page on another origin. ntfy answers preflights
  with `Access-Control-Allow-Headers: *`, and the CORS `*` wildcard never covers `Authorization`. The extension only
  has host permission for ntfy.sh. One mechanism that works in every client is simpler than two.
- *What it buys:* paid ntfy.sh tiers (higher limits, read by the Inbox's relay check with the token) and
  self-hosted servers with `auth-default-access: deny-all`.
- *Cost:* the token is in the QR code, like the pairing secret. §5 tells self-hosters to scope it to `dls-*`. A
  v1.0 sender cannot use a token-protected relay.
- Attachment downloads never carry the token: ntfy's `/file/<id>` needs no auth, and attachment URLs may be on
  another host.

### 2.3 Formulas and arithmetic

```
frame bytes         = 4 (magic) + 12 (nonce) + 4 (header length) + H (header) + C (chunk) + 16 (tag) = C + H + 36
MAX_HEADER          = 65,536        largest header any receiver accepts
MAX_SENDER_HEADER   = 8,192         largest item header a v1.1 sender builds

chunk(F)      = min(12,582,912, floor((F − 65,572) / 65,536) × 65,536)          65,572 = MAX_HEADER + 36
maxEncoded(F, T) = 1,000,000 × min( 64,
                                    floor(16 × chunk(F) / 1,000,000),
                                    floor((floor(T / 2) − 131,648) / 1,000,000) )  131,648 = 16 × (8,192 + 36)
```

**ntfy.sh (F = 2,000,000, T = 20,000,000).** ntfy.sh's limits are given as "2 MB" and "20 MB". We read them as
decimal, which is the smaller reading. If ntfy parses `2M` as 2 MiB (2,097,152), there is only more margin.

```
chunk         = floor((2,000,000 − 65,572) / 65,536) × 65,536 = floor(1,934,428 / 65,536) × 65,536 = 29 × 65,536
              = 1,900,544
largest frame = 1,900,544 + 65,536 + 36 = 1,966,116 ≤ 2,000,000   (even with the largest header any receiver accepts;
                                                                    33,884 to spare)
              with a real sender header (≤ 8,192): ≤ 1,908,772
maxEncoded    = 1,000,000 × min(64, floor(30,408,704 / 1e6) = 30, floor((10,000,000 − 131,648) / 1e6) = 9) = 9,000,000
parts         = ceil(9,000,000 / 1,900,544) = 5 (≤ 16)
one copy      = 9,000,000 + 5 × (8,192 + 36) = 9,041,140
two copies    = 18,082,280 ≤ 20,000,000   (1,917,720 left for other items in the same 3 hours)
two copies with 64 KiB headers = 2 × (9,000,000 + 5 × 65,572) = 18,655,720 ≤ 20,000,000
```

Why the largest item must fit twice: ntfy counts attachments against the uploader's total until they expire (3 h).
Two copies can overlap: a retry after a half-finished upload re-publishes every part, "Try again" can come right
after a send, and v1.0 senders re-send at 150 min while the first copy lasts 180 min. With 9 MB those still fit.
v1.1's own automatic re-send waits 185 min (3.3), so in normal running only one copy is ever stored.

**Other cases the vectors pin (`relayLimits`).**

| F | T | chunk | maxEncoded | parts | 2 copies (8 KiB headers) |
|---|---|---|---|---|---|
| 2,000,000 (ntfy.sh) | 20,000,000 | 1,900,544 | 9,000,000 | 5 | 18,082,280 |
| 2,097,152 (`2M` as MiB) | 20,971,520 | 1,966,080 | 10,000,000 | 6 | 20,098,736 |
| 15,000,000 (ntfy default) | 100,000,000 | 12,582,912 | 49,000,000 | 4 | 98,065,824 |
| 15,728,640 | 104,857,600 | 12,582,912 | 52,000,000 | 5 | 104,082,280 |
| 1,000,000 (minimum) | 4,000,000 (minimum) | 917,504 | 1,000,000 | 2 | 2,032,912 |
| 100,000,000 | 1,000,000,000 | 12,582,912 | 64,000,000 | 6 | 128,098,736 |

`CHUNK_MAX` stays at v1.0's 12 MiB so that v1.0 receivers can download every v1.1 frame. Kotlin's v1.0 cap is
`CHUNK + 128 KiB` = 12,713,984, and the largest v1.1 frame is 12,582,912 + 65,572 = 12,648,484.

**Other ntfy.sh limits (no code; documented and handled through 429/413).** These are per IP address, and a phone
and the Daylight on the same home Wi-Fi share them.

- 250 messages a day. Each frame is one message, so a 9 MB file uses 5. Acks and digests use about 10 to 20 a day.
- 200 MB of attachment traffic a day. An attachment counts once when uploaded and once more each time it is
  downloaded, and **both are charged to the uploader** (`handleFile` charges `m.Sender`). That is roughly 100 MB of
  files a day per home. Poll replays count against the poller, which is why parts already stored are no longer
  downloaded again (finding 17).
- A burst of 60 requests, then one every 5 s.

---

## 3. Decisions per finding

Abbreviations for "Touches": **JS** = `share/js/daylight-share.js`; **Mock** = `share/js/mock-relay.mjs`;
**T/V** = JS tests and vectors (`share/js/test/*.mjs`, `share/vectors/generate.mjs`, `test-vectors.json`,
`live-ntfy.mjs`); **Ext** = extension; **Web** = web sender; **Kc** = Kotlin share-core; **And** = Android app;
**Sw** = DaylightShareKit; **AUI** = Apple app UI (`DaylightShareUI`, iOS/macOS apps and share extensions).

Overlaps, handled once:

- Findings 1, 2, 7, 9, 22 and note (f) are one sizing/413/re-send problem. Sizing is under 1, the 413 policy under 7
  (22 points there), re-send timing under 9 ((f) points there), and the spec and mock defaults under 2.
- 4 and 8 (download failures): under 4.
- 15 and 18 (cursor overlap): under 15.
- 19 and 29 (ack size): under 29.
- 12, 25 and 26 (safe file names): one new algorithm, under 12. 25 and 26 add vectors.
- 16 and note (c) (outbox cap): under 16.
- 6 and the content-keeping part of 5: under 6.

### Finding 1 — [blocker] The default relay rejects every page or file over ~2 MB

**Decision: fix**, with the relay-derived limits in section 2.

**After the change.**

- `relayLimits(pairing)` returns `{fileLimit F, totalLimit T, chunk, maxEncoded}` using the 2.2 order. It is a pure
  function of `(relay, lf, lt)`.
- `buildItemFrames` / `ItemBuilder.prepare` take `chunk` and `maxEncoded` from it. A test override `chunkSize` still
  wins. They throw `ShareError('too-large', …)` when `encoded.length > maxEncoded` or a file's `size > MAX_DECODED`.
  The message names the limit: `"That file is larger than 9 MB, the most your Daylight's relay can carry."`, where
  the MB figure is `floor(maxEncoded / 1,000,000)`.
- Nothing is queued for a refused item.
- Re-sends rebuild frames with the current limits. A v1.0 row whose content is over `maxEncoded` becomes
  `rejected` / `too-large` the first time it is due (7).
- The 413 handling and the 250/day limit are covered under 7 and section 2.3.

**Touches:** JS, T/V, Ext (PDF cap from `limits.maxEncoded`, page falls back to the link on `too-large`), Web
(pre-check `file.size` against `limits.maxEncoded` for non-text types and against `MAX_DECODED` for all), Kc, And
(size messages; `MAX_RAW` stays 256 MiB as `MAX_DECODED`), Sw, AUI (share extensions pre-check file size before
loading).

### Finding 2 — [blocker] The spec's 15 MB attachment limit for ntfy.sh is wrong

**Decision: fix.** The spec (§2.3, §3.1, §3.5 new, §4) states the real ntfy.sh limits and the formulas. The mock
relay's defaults become ntfy.sh's (`attachmentMaxBytes = 2,000,000`, `visitorAttachmentTotalBytes = 20,000,000`),
so every existing test runs under ntfy.sh's limits. `live-ntfy.mjs` sends a 4,000,000-byte random "PDF" (3 parts
at 1,900,544), checks it arrives byte for byte, and checks that `GET https://ntfy.sh/v1/account` reports
`attachment_file_size ≥ 2,000,000` and `attachment_total_size ≥ 20,000,000` (the check fails loudly if ntfy.sh
lowers them).

**Touches:** spec, Mock, T/V, Kc (`MockRelay` passes new CLI flags), Sw tests (`FakeRelay` enforces 2,000,000 per
PUT).

### Finding 3 — [major/security] A pairing deep link silently re-pairs a sender with an attacker's Daylight

**Decision: fix.**

**After the change** (spec §1.3, "Confirmation").

- A pairing that arrives from **outside the app** is applied only after the user confirms. That covers a QR code
  scanned with the system camera, a tapped `daylightshare://` link, and the web sender's `#pair=`. The confirmation
  screen shows:
  - title: "Pair with Anjan's Daylight?" (`n`, or "a Daylight");
  - the first group of the code: "Code starts E4AY". Tell the user to compare it with the Daylight's screen;
  - the relay host, when it is not ntfy.sh;
  - when this device already sends to a Daylight with a **different secret**: "This replaces <current name>. Items
    not yet delivered to it will not be sent." The button reads "Switch". Otherwise it reads "Pair".
- A link whose secret equals the current pairing's secret is applied without asking: a re-scan, or a new name,
  relay, token or limits. A notice "Pairing updated." is shown.
- A code typed, pasted or scanned **on the app's own pairing screen** asks only when it would replace a pairing with
  a different secret, using the same "This replaces …" text.

**Touches:**

- And: `MainActivity.handleLink` sets `pendingPair` for every role, and the dialog in `Root()` gets the texts above.
  `pairSender` is only called from the dialog, or directly for the same secret.
- AUI: `AppModel.handleOpen` puts the parsed pairing into a `pendingPairing` published property, and the UI shows a
  confirmation sheet. `pair(_:)` from `PairView` checks for replacement. `-DLSPairLink` launch arguments stay
  silent, because they are CI-only.
- Web: `pairFromParam` asks with `confirm()` when unpaired too ("Pair this page with X? Code starts E4AY…").
- Ext: the popup's pairing field asks when replacing a different secret. `pairFromApp` (the Safari containing app)
  stays silent.
- JS gets a helper `samePairingSecret(a, b)`. Spec §1.3.

### Finding 4 — [major/state] A temporary attachment download failure is treated as "expired" (with finding 8)

**Decision: fix.**

**After the change** (spec §3.2). `RelayClient.poll` classifies every attachment download:

| Outcome | Entry | Effect |
|---|---|---|
| 2xx, body ≤ cap | `frame` | decode as usual |
| 404 or 410 | `expired: true` | skipped; the cursor may pass it; not remembered as handled |
| URL not allowed (§3.2 rule), or `Content-Length` / body over the cap | `junk: true` | remembered as handled; never downloaded again |
| 429 | `retry: true` | **stop downloading** for the rest of this poll: every later attachment entry in the same answer is `retry: true` without a request |
| 5xx, any other status, network error, timeout, reset mid-body (the body read is inside the same try) | `retry: true` | not handled; holds the cursor |

`Receiver.pollOnce`, Kotlin `Receiver.handle` and every sender's `checkAcks` add the `time` of each `retry` entry
to the held times. The cursor becomes `max(0, min(newest, earliest held) − 1800)` (finding 15), so the next poll
lists the message again and retries the download. A retry entry is never added to `seenMsgs`. Retries stop when it
downloads, or when it turns into a `404` after the relay drops it (3 h).

**Touches:** JS, T/V, Kc (`RelayMessage.retry`, `RelayClient.download` returns an outcome rather than `null`), And
(live path: a `retry` message from the stream holds the cursor the same way), Sw (`poll` returns `retry`;
`checkAcks` holds the ack cursor).

### Finding 5 — [major/state] Acks last only 12 h and are re-published only when a re-send arrives

**Decision: fix**, with four parts.

1. **Digest** (spec §3.4 step 5). At each background `pollOnce`, if `now − lastDigest ≥ 11 h`, the Daylight adds a
   digest to the poll's acks. The digest is every id in `seenItems` whose seen time is within the last 8 days,
   newest first, at most 280 (4 frames). `lastDigest = now` only after those frames were published. Ids are deduped
   against the poll's own acks. An empty digest is skipped. With ntfy.sh's 12 h message cache and 11 h spacing, a
   live digest is always on the relay while the Daylight is on. A sender that runs once in its 7-day window sees its
   ack, because `tick()` runs `checkAcks` before `resendDue`. Cost: at most 4 messages per 11 h.
2. **Acks are always messages** (finding 29), so they live 12 h, not 3 h.
3. **Seen time is refreshed** on every duplicate (finding 11), so re-sends inside the 14 days never deliver twice.
4. **"Try again" on an expired row sends a new `sent`** (finding 11). The id is unchanged, so if the Daylight still
   remembers it, it acks it and does not deliver it again.

The remaining case is accepted: a user who taps "Try again" more than 14 days after the Daylight last saw the item
gets it delivered again. They asked for it.

**Touches:** JS (`Receiver`: `lastDigest`, digest), Kc (`ReceiverState.lastDigest`, `Receiver.pollOnce`), And (none
beyond share-core: `SyncWorker` already calls `pollOnce` every 15 min; `Live` calls `handleLive`, which does not send
digests), T/V (the 13-hour sender test in section 5). Senders: none.

### Finding 6 — [major/state] Expiring a row deletes its content, so "Try again" on an expired page or file does nothing

**Decision: fix.**

**After the change.**

- `resendDue` marks a row `expired` and **keeps** its content.
- Content is dropped:
  - on `delivered`;
  - when the user removes the row;
  - when the row is evicted (finding 16);
  - for `expired` and `rejected` rows, at `now − created > 14 d`, during `resendDue`.
- `retry(id)` on a non-url row without content leaves it `expired` with `errorCode = 'gone'` and
  `error = "This item is no longer kept on this device. Share it again."`. On a row with content it publishes with
  `created = now`, `sent = now`, `status = 'sending'`, `attemptStarted = now`.

**Touches:** JS (`resendDue`, `retry`, `_prune`), Kc (`retry` sets the new `sent` and `created`; `prune` already
uses 14 d), Sw (`resendDue` purge 30 d → 14 d after `created`; `retry` sets the new `sent`), Ext/Web/And/AUI (show
`row.error` for `expired` rows when present).

### Finding 7 — [major/state] 413 is retried every 60 min or less for 7 days (with findings 22, 1)

**Decision: fix differently from "every 413 is terminal".** ntfy answers `413` (41301, "attachment too large, or
bandwidth limit reached") for three causes: the per-file limit, the per-visitor total, and the daily bandwidth.
Only the first never clears.

**After the change** (spec §3.1 table). The first failing answer of a publish sets the row:

| Answer | status / errorCode | Next automatic try | Sentence shown |
|---|---|---|---|
| network error or timeout (after the in-call retries 1 s/2 s/4 s) | `failed` / `network` | 1 min × min(60, 2^attempts) | "Couldn't reach the relay. It will try again by itself." |
| 429, 408, 5xx, any status not listed below (after in-call retries honouring `Retry-After` ≤ 60 s) | `failed` / `busy` | 1 min × min(60, 2^attempts) | "The relay is busy. It will try again by itself." |
| 413 for a frame ≤ F | `failed` / `full` | 185 min after this attempt (every attachment it counted against has expired by then) | "The relay is full right now. It will try again in about 3 hours." |
| 413 for a frame > F (only legacy rows) | `rejected` / `too-large` | never | "This is too big for your Daylight's relay (up to 9 MB). Send the link instead." |
| 400 | `rejected` / `no-files` | never | "Your Daylight's relay doesn't accept files or pages. Links still work." |
| 401, 403 | `rejected` / `access` | never | "The relay turned this device away. Pair again with your Daylight." |
| 404 | `rejected` / `address` | never | "The relay address doesn't work. Pair again with your Daylight." |

- `rejected` is a new terminal status. `resendDue` skips it. "Try again" works: it rebuilds with the current limits
  and either sends or is rejected again at once. `checkAcks` can still turn it into `delivered`.
- The worst case with a permanently full relay is one attempt every 185 min. Each attempt stops at the first `413`,
  with at most one frame of ≤ 2 MB sent on ntfy.sh. That is about 54 attempts in a week, compared with 172 attempts
  of 12 MiB measured in the finding.
- `RelayClient.publish` throws `ShareError` with `.status` set (HTTP status, 0 for network). The Sender maps it with
  the table above, comparing the failing frame's length with `limits.fileLimit`.

**Touches:** JS, Mock (real 413 behaviour, finding 20), T/V, Kc (`Status.REJECTED`, `OutboxRow.errorCode`,
`RelayException.status` already exists), And (`SenderScreen` texts), Sw (`OutboxRow.Status.rejected`, `errorCode`),
AUI, Ext (`statusInfo`: `rejected` → label "Not sent", tone bad, retry true, hint `row.error`; `failed` with
`full` → label "Waiting", tone busy), Web (`describe`, same labels).

### Finding 8 — [major/transport] A transient attachment download failure (429, 5xx, timeout) is handled as if expired

**Decision: fix, see finding 4.** The two extra points of finding 8:

- **Part 0 failing while parts 1–5 succeed.** The retry entry's time holds the cursor below part 0, and parts 1–5
  are kept as held parts (finding 17), so they are not downloaded again.
- **Stop after a 429.** Further downloads in the same poll would only add to the 60-request burst the Daylight
  shares with the phone.

**Touches:** as finding 4.

### Finding 9 — [major/transport] Re-sending at 150 min while the first copy is kept for 180 min doubles storage (with note f)

**Decision: fix.**

**After the change** (spec §3.3 step 3):

- `sent` with an attachment: next try at `lastPublish + 185 min` while `now − created < 24 h`, else
  `lastPublish + 12 h`. `lastPublish` is set after the last frame is accepted. Every frame's expiry is its request
  start + 3 h ≤ `lastPublish` + 3 h, so at +185 min all earlier copies have expired, with 5 min margin for the
  relay's expiry sweep. Only one copy is stored.
- `sent`, messages only: 11 h, unchanged. The message cache is 12 h, and a small overlap of messages costs nothing.
- A week with the Daylight off now costs about 8 + 12 = 20 uploads of the item (9 MB → 180 MB over 7 days, ≤ 72 MB
  on the worst day) instead of 67 at v1.0's 150 min (about 600 MB).
- The delay this adds: after the first day, a Daylight that comes back gets the item at the next re-send, at most
  12 h later. That is acceptable for a week-old share.
- The halving in `maxEncoded` (section 2.3) still covers the overlaps v1.1 cannot avoid: retries of half-uploaded
  items, "Try again", and v1.0 senders.

Not done: storing `attachment.expires` from publish answers. A custom relay with longer attachment retention gets
re-sends earlier than it needs. That is harmless, because its T is bigger, and it is simpler than per-frame expiry
tracking.

**Touches:** JS, Kc, Sw, T/V (resend timing tests).

### Finding 10 — [minor/security] Decompression bomb: the JS receiver inflates completely before checking `size`

**Decision: fix.**

**After the change** (spec §2.3).

- Receivers decode `enc` as a stream, stop with `integrity` as soon as the output exceeds `size`, and never hold
  more than `size` bytes.
- `checkItemHeader` refuses `size` > 8,388,608 for `page` and > 268,435,456 for `file`.
- Senders refuse files whose decoded size is over 268,435,456.

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
`RawDeflate.decompress(_:limit:)` already stop early. They only gain the page/file `size` caps in header checks.

**Touches:** JS, T/V (an `invalidItems` vector), Kc (`ItemHeader.check`), Sw (`ItemHeader.validated`).

### Finding 11 — [minor/security] An old frame replayed after the 14-day dedupe window is accepted as new

**Decision: fix** (the verifier's version).

**After the change** (spec §3.2 "Deduplication and freshness", §3.4 step 3).

- `sent` is required. It must match `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$` and parse; otherwise the
  header is bad. All v1.0 senders always set it. The JS reference, Kotlin `Bytes.isoTime` and Swift
  `isoTimestamp` all produce `…T22:00:00.000Z`.
- On storing a new item, and on every duplicate, set `seen[id] = max(now, parse(sent))`. Prune when
  `now − seen[id] > 14 d`.
- A frame whose id is **not** in `seen` and whose `now − parse(sent) > 13 d` is junk: added to `seenMsgs`, not
  stored, **not acked**. Not acking keeps the sender's row honest: it does not turn into "Delivered" for something
  the Daylight refused.
- Any frame that could still pass the age check has its id in `seen`. The id was seen at or after `sent`, and is
  kept 14 days after that, which is longer than 13. So a replay is at most re-acked, never re-delivered.
- "Try again" on an expired row sets `sent = now` (finding 6).

The badHeaders vectors, which all carry `sent: ""`, get a valid `sent`. Two new badHeaders cover a missing and a
non-ISO `sent`.

**Touches:** JS (`checkItemHeader`, `Receiver`), Kc (`ItemHeader.check`, `Receiver.handle`, `Bytes.parseIsoTime`),
Sw (`ItemHeader.validated`, used by the Swift reassembler in tests), T/V.

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

JS step 3: `seg.replace(/[\p{Cc}:*?"<>|]+/gu, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+/, '').trim()`.
Kotlin: `trimStart { it == '.' || isJsWhitespace(it) }` then `jsTrim`. Swift: drop first scalars while `"."` or
`isJSWhitespace`, then `jsTrim`.

Why 200 bytes and not 255: ext4/f2fs allow 255 bytes per name. The Inbox, the Reader and FileProvider sometimes add
" (2)" or similar, and 200 leaves room.

The Inbox keeps using the safe name as the stored file name. The Reader gets the name through FileProvider's
`DISPLAY_NAME`, which is the file name, so a fixed internal name would lose it. `InboxRepo.accept` adds a defence:
if creating or moving the file throws, it stores it as `document` plus `ext` (or `document`) and keeps the display
name in the item row.

**Touches:** JS, Kc (`Text.safeFileName`), Sw (`ShareText.safeFileName`), And (`InboxRepo.accept` fallback), T/V
(`fileNames`, new `fileNamesUtf16`).

### Finding 13 — [minor/security] The JS receiver follows attachment.url to any host and buffers it all

**Decision: fix.**

**After the change** (spec §3.2).

- An attachment is downloaded only if its URL is `https:` (any host), or has the relay's own origin (scheme, host,
  port), which covers plain-`http` local relays.
- Download cap: inbox 12,713,984 bytes; ack topic 1,048,576 bytes.
- A `Content-Length` over the cap means junk, with no read. Otherwise the client reads with a byte counter and
  cancels past the cap: JS `r.body.getReader()`; Kotlin `readCapped` (already); Swift streams with a `URLSession`
  data delegate (or `bytes(for:)`) and the same counter, rather than checking `d.count` afterwards.
- Disallowed URL or over cap → `junk` (finding 4 table).
- Poll answers are capped at 16 MiB, read the same way. Over the cap, the poll fails with `ShareError('relay')`.
- No `auth` parameter is ever added to attachment URLs.
- The relay check (§3.4) refuses a relay whose `base-url` gives URLs this rule would refuse.

**Touches:** JS, Kc (`RelayClient.download`: origin rule; `poll`: 64 MiB → 16 MiB), Sw (`poll`: origin rule,
streaming cap), T/V (mock answering a foreign `attachment.url`).

### Finding 14 — [minor/state] Receiver records items as seen before the ack goes out or the item is stored

**Decision: fix**, making JS match Kotlin, plus pending acks for both.

**After the change.**

- JS `Receiver` takes `accept: async ({header, content}) => void`. The default does nothing.
- `pollOnce` calls `await accept(done)` before setting `seen[id]` and `seenMsgs`. If `accept` throws, the item is not
  handled: its first message time is held for this poll and its held-part entries are cleared, so the parts are
  downloaded again (finding 17). It is not acked.
- State is saved **before** acks are published. Ack publishing is in try/catch and never throws.
- Ids that were not published go to the persisted `pendingAcks` (at most 280, oldest dropped). They are added to
  the next poll's acks.
- `pollOnce` returns `{items, acked, ackError}` (`ackError` is a message or `''`).
- Kotlin: the same `pendingAcks`. `InboxRepo.handleLive`'s ack failure path calls a new
  `Receiver.queueAcks(ids)` instead of only logging.
- Spec §3.4 states the order: store → mark seen → ack.

**Touches:** JS, Kc (`ReceiverState.pendingAcks`, `Receiver.publishAcks` returns the unsent ids), And
(`InboxRepo.handleLive`), T/V.

### Finding 15 — [minor/state] The time cursor skips any attachment whose upload took more than 5 s (with 18)

**Decision: fix with a wider time overlap (option A).** No id cursor.

**After the change** (spec §3.2 "Cursor"), the same for the inbox cursor and for every sender's ack cursor:

```
if the answer has no message lines: cursor unchanged
held   = earliest time among: incomplete items (persisted), retry entries of this poll,
         items whose accept() failed in this poll
c      = max(0, min(newest message time in the answer, held) − 1800)
cursor = (nothing held and the previous cursor is a number > c) ? previous : c
```

- 1,800 s covers an upload of a 1.9 MB frame down to about 9 kbit/s, and a 12 MiB frame down to about 56 kbit/s.
  Anything slower is still delivered by the 185-min re-send.
- The cost is re-listing up to 30 min of JSON lines per poll. Handled messages are not downloaded again.
- §3.2's reason for banning id cursors was wrong. The spec now says that current ntfy replays the whole retained
  history for an unknown id, and v2.11 did the same (`messagesSinceID` falls back to `sinceAllMessages`). Time is
  kept because holding the cursor at an incomplete item's first part needs a time.
- The mock relay stamps `time` at request start (finding 20). No sender upload timeout is added.

**Touches:** JS (`Receiver.pollOnce`, `Sender.checkAcks`), Kc (`Receiver.handle`, `Outbox.checkAcks`), Sw
(`checkAcks`), Mock, T/V.

### Finding 16 — [minor/state] The 200-row outbox cap drops the oldest rows whatever their status (with note c)

**Decision: fix** (verifier's version).

**After the change.** On every save:

1. Keep every row with status `sending`, `sent` or `failed`, however many there are. The 7-day expiry shrinks the
   list again, so new shares are never refused.
2. Fill the room left up to 200 with the newest `delivered`, `expired` and `rejected` rows.
3. Delete the stored content of every row dropped.

The JS `outbox/<id>` key, the Kotlin `content/<id>.enc` and the Swift `outbox/<id>.bin` are all covered.

**Touches:** JS (`_saveRow`), Kc (`Outbox.saveRow`), Sw (`OutboxStore.update`), T/V.

### Finding 17 — [minor/state] Parts of an incomplete item are downloaded again on every poll

**Decision: fix.**

**After the change** (spec §3.2 "Handled messages").

- A receiver remembers, per incomplete item, the earliest part time. This is persisted as `incomplete:
  {itemId: timeSec}` and already exists in Kotlin.
- It also remembers which ntfy message ids hold parts it has stored (`partMsgs: {msgId: itemId}`). It does not
  download those again, and it keeps holding the cursor at the item's earliest part.
- `partMsgs` entries are removed:
  - when the item completes (they move to `seenMsgs`);
  - when it fails integrity (they move to `seenMsgs` as junk);
  - when `accept` fails (removed outright, so the parts are downloaded again);
  - when the part count changes;
  - when the item is given up after 24 h.
- **Kotlin** persists `partMsgs`, because parts are on disk in `spool/parts/<id>/` and survive restarts. If the spool
  directory of an item is missing at poll time, that item's `partMsgs` entries are dropped first.
- **JS** keeps parts in memory, so it keeps `partMsgs` in memory too and persists only `incomplete`. After a
  restart, parts are downloaded again once, with the cursor held, which is correct.
- JS `Reassembler.prune(maxAgeMs = 24 h)` drops pending items older than that. This fixes the memory growth.

**Touches:** JS, Kc (`ReceiverState.partMsgs`, `Receiver`, `Reassembler.isPending`), T/V (download-count test).

### Finding 18 — [minor/transport] The time cursor permanently skips an attachment that finishes uploading late

**Decision: fix, see finding 15.** That covers the ack cursor too, and the mock's time stamp (finding 20).

### Finding 19 — [minor/transport] An ack with 79 or more ids is published as an attachment

**Decision: fix, see finding 29.**

### Finding 20 — [minor/transport] The mock relay differs from ntfy exactly where the bugs are

**Decision: fix.** The full list of mock changes is in section 5.2. In short:

- ntfy.sh defaults (2,000,000 per attachment, 20,000,000 per visitor).
- A real 413: Content-Length pre-check and drain, never `req.destroy()`.
- `time` stamped at request start.
- ntfy's `since=<id>` semantics.
- Per-visitor storage, bandwidth (charged to the uploader), daily messages and an optional request bucket.
- `/v1/account`, attachments-off and token modes.
- Test hooks for failing downloads, holding an upload, moving the clock and choosing the visitor.

**Touches:** Mock, T/V, Kc (`MockRelay.start` flags).

### Finding 21 — [minor/transport] 'Any ntfy-compatible server works' is false for pages and files

**Decision: fix.**

**After the change.**

- **Spec §3.5 "Requirements":** the relay must accept attachments (`base-url` and `attachment-cache-dir`).
  `base-url` must be `https://` or the relay's own origin, and reachable from the Daylight.
- **Relay check in the Inbox** (spec §3.4), run when the user saves a relay other than ntfy.sh, or any token, and
  once at startup for a saved custom relay without stored limits:
  1. `GET {relay}/v1/account` (+`auth`): read F and T. A 404 (ntfy before 2.0) leaves them unknown.
  2. `PUT {relay}/dls-probe-<16 random hex>` with body `dls-probe` (9 bytes), `Filename: probe.bin`,
     `Firebase: no`, `Cache: yes` (+`auth`): expect 200 with `attachment.url`.
  3. `attachment.url` passes the §3.2 download rule, and a GET of it from the Daylight returns the 9 bytes.
  4. If known: F ≥ 1,000,000 and T ≥ 4,000,000.
- **Sentences** for each step that fails. The relay is **not saved** if any step fails:
  - unreachable: "Couldn't reach that relay. Check the address and your connection."
  - 400 at step 2: "This relay doesn't accept files. Use ntfy.sh, or turn on attachments on the server."
  - 401/403: "This relay needs an access token."
  - step 3: "Your Daylight can't download files from this relay. Check the server's base-url."
  - step 4: "This relay's file limits are too small."
- On success the link carries `r`, `k` (if any), and `lf`, `lt` (if known).
- **Senders:** a `400` on publish → `rejected` / `no-files` (finding 7).

**Touches:** JS (`probeRelay(relay, {token, fetch})` as the reference), Kc (`RelayProbe`), And (`SettingsScreen`:
Inbox relay save is async with the probe and an "Access token (optional)" field; `Prefs.inboxToken`,
`Prefs.inboxLimits`; `InboxRepo.ensurePairing` builds the link with `k`/`lf`/`lt`), Mock (`attachments: false`,
`/v1/account`), T/V.

### Finding 22 — [minor/interop] On 413 the spec says 'report it, do not retry', but the code re-uploads for 7 days

**Decision: fix, see finding 7.** The spec's "do not retry" is replaced by the §3.1 table. A test asserts that no
automatic re-upload happens within 185 min of a `413`, and none at all after a `rejected`.

### Finding 23 — [minor/interop] No vector or test splits a deflate-raw stream across parts

**Decision: fix** (verifier's version).

- `generate.mjs` builds the text item with `chunkSize: 16`, which gives 3 parts. It asserts
  `1 < textBuilt.frames.length <= 8`.
- The vector is renamed "text file, deflate-raw, 3 parts (chunk 16)". An out-of-order item `[2, 0, 1]` of the same
  frames is added.
- `protocol.test.mjs` "fresh frames round trip" adds a deflate case with `chunkSize: 64` on `'# t\n'.repeat(3000)`
  and asserts `frames.length > 1`.

**Touches:** T/V, Kc and Sw vector tests (no code change).

### Finding 24 — [minor/interop] What counts as a valid url is unspecified, and JS webUrl sends the raw input

**Decision: fix differently.** There is one textual rule, the same for senders and receivers in all three languages,
and it returns the trimmed input unchanged. There is no WHATWG parsing and no canonicalisation: only JS has a WHATWG
parser, and canonicalising in one language would make "sent" differ per platform.

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
                                 what follows "]" must be empty or ":" followed by ASCII digits only
  else:                          host = hostport up to its first ":"; what follows that ":" must be ASCII digits only
  null if host is empty, starts with ".", or contains any of  < > ^ | \
  return s
```

- This is v1.0's Kotlin rule, which is also the Reader's SAVE_PAGE rule, plus three things: the port must be digits,
  the host cannot contain `<>^|\`, and both are checked the same way in all three languages. It rejects
  `https:/example.com`, `https:example.com`, `https:\\example.com\story`, `https://.example.com/` and
  `https://example.com\story`.
- Receivers using it reject nothing that a browser, a share sheet or a deployed sender produces from a real page.
  JS v1.0 could send the first three; Kotlin v1.0 receivers already rejected them.
- `findUrl` and the web page's `normalizeUserUrl` use it, so the user sees "That isn't a web address" at once.
- The relay URL is a separate rule (note e).

**Touches:** JS (`webUrl` drops `new URL()`), Kc (`Text.webUrl`: port digits, host characters), Sw (`webURL`:
leading-dot check, first-colon port rule), T/V (`urls` vectors), Web (tests of `normalizeUserUrl`).

### Finding 25 — [minor/interop] safeFileName: JS and spec disagree on leading dots

**Decision: fix, see finding 12** (step 3c). The vectors are `'. .hidden' → 'hidden'`, `'.. ..profile' →
'profile'` and `'x/ . .bashrc' → 'x bashrc'`.

### Finding 26 — [minor/interop] safeFileName length rule is ambiguous; the 120 cut splits surrogate pairs

**Decision: fix, see finding 12** (step 5: 1–10 units after the dot, whole code points only). The vectors are
`'x'×150 + '.webarchive'` → `'x'×109 + '.webarchive'`, `'a'×115 + '😀'×5 + '.pdf'` → `'a'×115 + '.pdf'`, and the NBSP,
control and lone-surrogate cases in section 5.1.

### Finding 27 — [minor/interop] The 'receiver restart between parts' test doesn't test the cursor hold-back

**Decision: fix.**

- **JS `relay.test.mjs` "large file in several parts survives a receiver restart between parts":**
  1. Publish parts 0–1 and poll.
  2. `advance(60_000)`, publish an unrelated url item and poll.
  3. Assert `(await storage.get('inboxSince')) <= Math.floor(t0 / 1000) − 1800`.
  4. Restart the Receiver, `advance(60_000)`, publish parts 2–3 and poll.
  5. Assert the file is delivered byte for byte.
- **Kotlin `partsArrivingAcrossPollsHoldTheCursor`:** the same, using the mock's `/__mock/clock` control.

A mutant that drops the hold must fail both.

**Touches:** T/V, Kc tests.

### Finding 28 — [minor/interop] An undocumented 64 KiB header cap

**Decision: fix.**

- Spec §2: `len(headerJson) ≤ 65,536`. A receiver ignores a frame with a longer header. Senders build item headers
  of at most 8,192 bytes, and §2.1 says "x- fields must be small".
- `sealFrame` / `FrameCodec.seal` / `Frame.seal` throw on a header over 65,536 bytes.
- `buildItemFrames` / `ItemBuilder.prepare` throw `ShareError('header', 'That item has too much information to
  send.')` over 8,192. With today's clamped fields that cannot happen: the worst case measured is 6,986 bytes, with a
  4096-character URL, 300 emoji in the title, a 200-byte name, 100 control characters in `mime` and 60 emoji in
  `from`.
- Vectors: a seal vector with a header of exactly 65,536 bytes opens; an invalidFrames vector with 65,537 is refused.

**Touches:** JS, Kc (`FrameCodec`), Sw (`Frame`), T/V.

### Finding 29 — [minor/interop] MAX_ACK_IDS = 200 conflicts with the small-frame limit (with 19)

**Decision: fix.** `MAX_ACK_IDS = 70`, and every ack frame must be small.

Measured with the JS library: 60 emoji in `from` (the worst case allowed by `cleanName`, 240 bytes) gives

| ids | frame bytes | base64 characters | small? |
|---|---|---|---|
| 70 | 2,798 | 3,732 | yes |
| 71 | 2,833 | 3,780 | yes |
| 72 | 2,868 | 3,824 | no |

With `from = "Daylight"`, up to 78 ids fit. None of the three implementations escapes non-ASCII in JSON, so the
sizes are identical across them.

The new builder is `buildAckFrames(keys, ids, opts) → frame[]`: take up to 70 ids, build, and while the frame is not
small, move the last id to the next batch. The old `buildAckFrame` / `AckHeader.frame` keep their signature and
slice to 70.

Senders still read ids from any ack frame, including the attachment-sized ones a v1.0 Daylight sends, capped at
1,048,576 bytes.

**Touches:** JS, Kc (`Limits.MAX_ACK_IDS`, `Receiver.publishAcks`), Sw (`DLS.maxAckIDs`), T/V (`acks` vectors).

### Note (a) — `Sender._saveRow` is read-modify-write; make the library serialise within one instance

**Decision: fix in JS.**

- `Sender` and `Receiver` each hold a promise-chain lock (`serial()`, as in `extension/src/core.js`). The public
  methods `send`, `checkAcks`, `resendDue`, `retry`, `remove` and `tick` run under the Sender's lock; `pollOnce`
  runs under the Receiver's.
- Internally they call unlocked `_checkAcks`, `_resendDue` and `_retry`, so `tick → resendDue → retry` cannot
  deadlock.
- The extension's and the web page's own locks stay. They are harmless.
- This also closes the three refuted-as-unreachable races (two overlapping `pollOnce`, two outbox writers, a tick
  during `send`) for any future caller.
- Kotlin `Outbox` and `Receiver` are already `@Synchronized`. Swift `OutboxStore` already locks and coordinates.

**Touches:** JS, T/V (concurrency test).

### Note (b) — `Sender.send()` aborts when the content copy hits a storage quota

**Decision: fix in JS.** (Kotlin and Swift publish from the stored file and must store it first. A full disk there
is a share error: "Your phone is out of space.")

**After the change.**

- `send()` stores the row, then tries `storage.set('outbox/' + id, …)`. On failure it sets `row.copy = false`,
  logs, and **still publishes once**.
- When such a non-url row's re-send comes due, it becomes `expired` / `nocopy` with "This device couldn't keep a
  copy to send again. Share it again." `checkAcks` can still mark it `delivered`.
- The extension's `areaStorage` and the web page's `localStorageAdapter` stop swallowing `outbox/` write errors, so
  the library sees them. Their comments move into the library.

**Touches:** JS, Ext (`core.js` `areaStorage`), Web (`web-storage.js`), T/V.

### Note (c) — trimming the outbox at 200 rows leaves content behind

**Decision: fix, see finding 16.**

### Note (d) — the page body's charset is unspecified

**Decision: fix.**

- Spec §2.2: the `page` body is the HTML as **UTF-8 without a byte-order mark**. All senders already encode it that
  way (JS `TextEncoder`, Swift `Data(html.utf8)`).
- A `<meta charset>` inside may name another encoding, because it is the browser's DOM serialised. Receivers decode
  the body as UTF-8 regardless.
- The Daylight Inbox writes `page.html` with `<meta charset="utf-8">` inserted. If the text, after an optional BOM
  and whitespace, starts with `<!doctype` (any case), it goes right after that declaration's `>`; otherwise at the
  very start. This way a Reader that sniffs the encoding gets UTF-8. It is done after the sha256 check.

**Touches:** spec, And (`InboxRepo.accept`), T/V (Android unit test only).

### Note (e) — JS `normalizeRelay('ftp://x')` returns `'https://ftp//x'`

**Decision: fix in JS and Kotlin** (Kotlin has the same bug: it prefixes `https://` to anything not starting with
`http(s)://`).

All three apply Swift's rule. Trim; empty → default. If the input matches `^[a-z][a-z0-9+.-]*://` (case-insensitive)
and the scheme is not http(s), throw "The relay must be http(s)."; else add `https://` when there is no scheme.
Then: the host is required; the host is lowercased; the default port, user info, query and fragment are dropped;
trailing slashes are removed. The `relays` vectors pin this. IDN relay hosts are not covered: enter them in
punycode.

**Touches:** JS, Kc (`Relay.normalize`), T/V.

### Note (f) — re-sending large attachments at 150 min while the first copy lives 180 min doubles quota use

**Decision: fix, see finding 9** (185 min, then 12 h after the first day) and section 2.3 (halving).

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
Revision 1.1 changes no byte on the wire (frames, headers, topics and keys are those of 1.0, and `v` stays `1`); it
fixes limits, validation and behaviour. See `CHANGES-v1.1.md` for the reasons.
```

Old (L8-10):

> - **No accounts and no server of our own.** Frames travel through an [ntfy](https://ntfy.sh) server (default
>   `https://ntfy.sh`, free, no sign-up). Any ntfy-compatible server works, including a self-hosted one with longer
>   retention.

New:

```markdown
- **No accounts and no server of our own.** Frames travel through an [ntfy](https://ntfy.sh) server (default
  `https://ntfy.sh`, free, no sign-up). A self-hosted ntfy server works too if it accepts attachments (3.5); one that
  needs a login works with an ntfy access token carried in the pairing link.
```

Old (L12-14):

> - **Store and forward with acknowledgements.** ntfy.sh keeps messages for 12 hours and attachments for 3 hours. The
>   Daylight acknowledges every item it receives; a sender re-publishes anything still unacknowledged before the relay
>   forgets it, for up to 7 days. Re-publishing is safe: the Daylight deduplicates by item id.

New:

```markdown
- **Store and forward with acknowledgements.** ntfy.sh keeps messages for 12 hours and attachments for 3 hours, and
  takes attachments of up to 2 MB, 20 MB per sender at a time. The Daylight acknowledges every item it receives; a
  sender re-publishes anything still unacknowledged when the relay has forgotten it (or is about to), for up to
  7 days. Re-publishing is safe: the Daylight deduplicates by item id.
```

### §1.3 Pairing link

Old (L51-59):

> ```
> daylightshare://pair?c=<code, 28 chars, no dashes>[&r=<relay URL, percent-encoded>][&n=<Daylight name, percent-encoded>]
> ```
>
> - `r` is present only when the relay is not `https://ntfy.sh`. A relay URL is `https://` (or `http://` for local
>   testing) with no trailing slash, no query and no fragment.
> - `n` is a display name for the Daylight ("Anjan's Daylight"), at most 60 characters.
> - Unknown parameters are ignored. Senders accept the link, the typed code, or the code with dashes.
> - Apps register the `daylightshare` scheme, so scanning the QR code with a phone camera opens the app and pairs.

New:

````markdown
```
daylightshare://pair?c=<code, 28 chars, no dashes>[&r=<relay URL>][&n=<Daylight name>][&k=<access token>][&lf=<bytes>&lt=<bytes>]
```

Values are percent-encoded as `application/x-www-form-urlencoded` with spaces as `%20`; parameters are written in the
order c, r, n, k, lf, lt.

- `r` is present only when the relay is not `https://ntfy.sh`. A relay URL is normalised: `https://` added when no
  scheme is given; any other scheme than `http`/`https` is an error (never turned into `https://…`); host lowercased;
  default port, user info, query and fragment dropped; no trailing slash. (`vectors/test-vectors.json` > `relays`.)
- `n` is a display name for the Daylight ("Anjan's Daylight"), at most 60 characters.
- `k` is an ntfy access token for the relay (3.5): 1-128 characters from `A-Z a-z 0-9 . _ ~ -`. Any other value makes
  the link invalid.
- `lf` and `lt` are the relay's per-file attachment limit and per-sender attachment total, in bytes (decimal digits),
  as measured by the Daylight Inbox's relay check (3.4). They are used only when both are present and
  1,000,000 ≤ `lf` ≤ 10^12 and 4,000,000 ≤ `lt` ≤ 10^15; otherwise both are ignored.
- Unknown parameters are ignored. Senders accept the link, the typed code, or the code with dashes.
- **Confirmation.** Apps register the `daylightshare` scheme. A pairing that arrives from outside the app (a QR code
  scanned with the phone's camera, a tapped link, the web sender's `#pair=`) takes effect only after the user
  confirms on a screen that shows the Daylight's name, the first group of the code ("Code starts E4AY") and the relay
  host when it is not ntfy.sh, and, when this device already sends to a Daylight with a different secret, says that
  it replaces it and that items not yet delivered to it will not be sent. A link with the same secret as the current
  pairing (a re-scan, a new name, relay, token or limits) applies without asking. A code typed, pasted or scanned on
  the app's own pairing screen asks only when it would replace a pairing with a different secret.
- Changing the relay by hand on a sender drops `k`, `lf` and `lt`.
````

### §2 Frames

After L83 (`plaintext = u32be(len(headerJson)) || headerJson (UTF-8 JSON object) || body (bytes, may be empty)`) add:

```markdown
`len(headerJson)` is at most 65,536 bytes; a receiver ignores a frame with a longer header. Senders build item headers
of at most 8,192 bytes. A frame is therefore at most `chunk + 65,536 + 36` bytes.
```

### §2.1 Item header

Old (L96): ``| `url` | string | url, page | The `http(s)` address (at most 4096 characters). Optional for `file` (where it came from). |``

New: ``| `url` | string | url, page | The address; it must pass the web URL rule (section 4). Optional for `file` (where it came from). |``

Old (L98): ``| `name` | string | file | File name with extension, e.g. `"paper.pdf"`; no `/` or `\` |``

New: ``| `name` | string | file | File name with extension, e.g. `"paper.pdf"`, made safe as in section 5 (at most 120 UTF-16 code units and 200 UTF-8 bytes) |``

Old (L100): ``| `size` | number | page, file | Length of the whole content in bytes, after decoding (before compression) |``

New: ``| `size` | number | page, file | Length of the whole content in bytes, after decoding (before compression): at most 8,388,608 for `page`, 268,435,456 for `file` |``

Old (L105): ``| `sent` | string | yes | When the user shared it, ISO 8601 UTC with milliseconds, e.g. `"2026-10-17T22:00:00.000Z"` |``

New: ``| `sent` | string | yes | When the user shared it (or last pressed "Try again"), ISO 8601 UTC with milliseconds, e.g. `"2026-10-17T22:00:00.000Z"`. Receivers refuse a header whose `sent` does not match `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$`. |``

Old (L109): `Receivers ignore unknown fields. Senders may add fields with an `x-` prefix.`

New:

```markdown
Receivers ignore unknown fields. Senders may add small fields with an `x-` prefix; the whole header must stay within
8,192 bytes.
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
  `url` instead when the HTML is larger than 8 MiB (the Reader's cap) or its encoded form is larger than the relay's
  largest item (3.5).
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
Let `encoded` = the body after `enc` (the whole thing). If it is longer than `chunk`, split it into consecutive chunks
of `chunk` bytes (the last may be shorter), at most 16 parts. `chunk` comes from the relay's limits (3.5): 1,900,544
bytes on ntfy.sh, never more than 12,582,912. Frame `i` carries chunk `i` with `part = i` and `parts = n`; every part
repeats the full header. An item that is not split carries no `part`/`parts`. Senders refuse content whose encoded
length is over the relay's largest item (3.5; 9,000,000 bytes on ntfy.sh) or whose decoded length is over
268,435,456 bytes.

The receiver collects all parts of an `id`, concatenates the chunks in `part` order and only then decodes `enc`: a
`deflate-raw` stream runs across part boundaries, so parts are never decoded one at a time. It decodes as a stream and
stops with an integrity error as soon as the output exceeds `size`, so it never holds more than `size` bytes; then it
checks `size` and `sha256`. Receivers accept any chunk size up to 12,582,912 bytes.
```

### §2.4 Ack header

Old (L137-138):

> Body empty. `ids` lists items the Daylight has received completely and stored (at most 200 per frame). The Daylight
> acks again whenever it sees an item it already has, so a sender that missed an ack gets another one after it re-sends.

New:

```markdown
Body empty. `ids` lists items the Daylight has received completely and stored: at most 70 per frame, and every ack
frame must be a small frame (3.1), so that it is kept as a message (12 hours on ntfy.sh) and never as an attachment
(3 hours). 70 ids fit with any `from` of up to 60 characters; a builder whose frame is still too large moves ids to the
next frame until it fits. The Daylight acks again whenever it sees an item it already has, and every 11 hours it
re-publishes a digest of the ids it has seen in the last 8 days (3.4), so a sender that missed an ack gets another
one. Senders read `ids` from any ack frame, whatever its size (Daylights before 1.1 sent up to 200 per frame).
```

### §3 Transport over ntfy (intro)

Old (L144): ``` `relay` is the base URL (default `https://ntfy.sh`). `topic` is `inboxTopic` or `ackTopic`. ```

New:

```markdown
`relay` is the base URL (default `https://ntfy.sh`). `topic` is `inboxTopic` or `ackTopic`. When the pairing has an
access token, every request to the relay's origin carries it (3.5).
```

### §3.1 Publish

Old (L148-157):

> Every publish sends the header `Firebase: no` (ntfy.sh would otherwise forward the message to Google's push service
> for its own Android app) and `Cache: yes`.
>
> - **Small frame** (`len(base64(frame)) <= 3800`): `POST {relay}/{topic}` with `Content-Type: text/plain` and the body
>   `base64(frame)` (standard alphabet, with `=` padding, no line breaks). ntfy stores it as the message text.
> - **Large frame**: `PUT {relay}/{topic}` with the raw frame as the body and the headers `Filename: dls1.bin` and
>   `Message: dls1`. ntfy stores it as an attachment (at most 15 MB on ntfy.sh, kept 3 hours).
>
> A `2xx` answer means the relay has it. On `429` wait (honour `Retry-After` when present, else 10 s) and retry; on
> `413` the frame is too large for this relay (report it, do not retry).

New:

```markdown
Every publish sends the header `Firebase: no` (ntfy.sh would otherwise forward the message to Google's push service
for its own Android app) and `Cache: yes`.

- **Small frame** (`len(base64(frame)) <= 3800`): `POST {relay}/{topic}` with `Content-Type: text/plain` and the body
  `base64(frame)` (standard alphabet, with `=` padding, no line breaks). ntfy stores it as the message text (kept
  12 hours on ntfy.sh).
- **Large frame**: `PUT {relay}/{topic}` with the raw frame as the body and the headers `Filename: dls1.bin` and
  `Message: dls1`. ntfy stores it as an attachment (kept 3 hours on ntfy.sh). A sender never publishes a frame larger
  than the relay's per-file limit F (3.5).

A `2xx` answer means the relay has it. Otherwise the first failing frame decides what happens to the item (3.3):

| Answer | Meaning | Item becomes |
|---|---|---|
| network error or timeout | | retried in the call after 1 s, 2 s, 4 s; then `failed` (network) |
| `429`, `408`, `5xx`, or a status not listed here | rate-limited or busy | retried in the call up to 3 times, waiting `Retry-After` (at most 60 s) or 10 s × attempt; then `failed` (busy) |
| `413`, frame ≤ F | this sender's attachment storage or daily bandwidth is used up (ntfy answers 41301 for the per-file limit, the storage total and the bandwidth limit alike) | `failed` (full); next try 185 minutes later |
| `413`, frame > F | the frame can never fit | `rejected` (too large) |
| `400` | the relay takes no attachments (40014) or refuses the request | `rejected` |
| `401`, `403` | the relay wants a (valid) access token | `rejected` |
| `404` | wrong relay address | `rejected` |
```

### §3.2 Receive

Old (L161-179): the whole block from the `GET {relay}/{topic}/json?poll=1&since=<cursor>` code block to "Senders read
the ack topic the same way."

New:

````markdown
```
GET {relay}/{topic}/json?poll=1&since=<cursor>
```

The answer is one JSON object per line; a receiver reads at most 16 MiB of it (ntfy caps a replay at 10 MB per topic)
and treats a longer answer as a failed poll. For each line with `"event": "message"`:

- If it has `attachment`, the frame is at `attachment.url`. Download it only if that URL is `https://`, or has the
  relay's own origin (scheme, host and port); any other URL is junk. Download at most 12,713,984 bytes (1,048,576 on
  the ack topic): a larger `Content-Length` is junk without reading, and the read stops past the limit (junk).
  Never send the access token with it. The outcome:
  - `2xx`: the body is the frame.
  - `404` or `410`: the attachment has expired; skip the message (the sender re-sends).
  - `429`: the relay is limiting this device. Do not download any more attachments in this poll: this message and
    every later attachment message in the answer are retry messages.
  - anything else (`5xx`, another status, a network error, a timeout, a connection reset while reading): a retry
    message.
- Else the frame is `base64decode(message)`. A message that is not valid base64 is junk.

Then decode the frame (section 2) and, for the inbox, feed it to the reassembler.

**Handled messages.** A message is handled when it has been decoded into a stored item, a duplicate or junk. Receivers
remember handled ntfy message ids for 2 days and do not download them again. A retry message, a skipped (expired)
message and a message holding a part of an incomplete item are not handled. A receiver may also skip downloading a
message whose part it still holds (in memory or on disk); it keeps holding the cursor at that item's first part.

**Cursor.** `cursor` is `all` the first time, then a Unix time in seconds. After each poll:

- if the answer had no message lines, the cursor stays;
- else `held` = the earliest `time` of anything still needed: the first part of every incomplete item (remembered
  across polls, given up 24 hours after its first part), every retry message of this poll, every item of this poll
  that could not be stored;
- `cursor = max(0, min(newest time in the answer, held) − 1800)`; when nothing is held, a numeric cursor never moves
  backwards.

The 30 minutes matter: ntfy stamps a message's `time` when its upload *starts* and lists it only when the upload has
finished, so a slow attachment can appear after messages stamped later than it. Re-listing costs one JSON line per
message; handled messages are not downloaded again. (A message id would also work as a cursor: ntfy replays the whole
retained history for an id it does not know, or no longer knows. Receivers use times because holding the cursor at
an incomplete item's first part needs a time.)

**Deduplication and freshness.** Receivers deduplicate by item `id`: when an item is stored, and whenever a duplicate
arrives, they remember its id with the time `max(now, sent)` and forget it 14 days after that time, so polling with
`since=all` is always safe. A frame whose id is not remembered and whose `sent` is more than 13 days old is junk: not
stored and not acked. (A copy of a frame taken from the relay can then never be delivered a second time: while it is
young enough to pass, its id is still remembered.)

Senders read the ack topic with the same rules (download rule and limits, retry messages, cursor).
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
with fresh nonces on every publish), when it was last published and its status: `sending`, `sent`, `delivered`,
`failed`, `rejected` or `expired`. Changes to the outbox from one process happen one at a time.

1. **Share.** Refuse an item at once, with a sentence, when its encoded length is over the relay's largest item (3.5)
   or a file's decoded length is over 268,435,456. Otherwise store it (`sending`) and publish every frame in part
   order. All accepted: `sent`. Otherwise the first failing answer decides (3.1): `failed` (network, busy or full) or
   `rejected`. A sender that cannot keep a copy of the content for re-sending (a browser storage quota) still
   publishes once, and marks the item as having no copy.
2. **Acks.** Read the ack topic (3.2) right after sending, again ~30 s later if the app is still running, and whenever
   the app or extension runs. An ack listing the id makes the item `delivered`, from any status. Its content is then
   dropped and a small history row is kept.
3. **Re-send** (same id, same header, fresh nonces) an item that is not delivered when its next try is due:
   - `sent`, every frame a message: 11 hours after the last publish (ntfy.sh keeps messages 12 hours);
   - `sent`, some frame an attachment: 185 minutes after the last publish during the first 24 hours after the share,
     then 12 hours after the last publish (ntfy.sh keeps attachments 3 hours; re-sending only after the earlier copy
     has expired keeps one copy on the relay);
   - `failed` (network or busy): 1 minute × min(60, 2^attempts) after the last attempt;
   - `failed` (full): 185 minutes after the last attempt;
   - `sending`: only after it has been `sending` for 15 minutes (the process publishing it was stopped);
   - `rejected`: never by itself.
   An item without a stored copy is not re-sent: when its re-send is due it becomes `expired`.
4. **Expiry.** 7 days after the share, an item not delivered becomes `expired`; offer "Try again". The content of
   `expired` and `rejected` items is kept until 14 days after the share, then dropped. "Try again" publishes the item
   again with the same id, `sent` set to now and a new 7 days; without stored content it tells the user to share it
   again.
5. **History.** Keep every `sending`, `sent` and `failed` item. Keep at most 200 items in all by dropping the oldest
   `delivered`, `expired` and `rejected` ones, with their content.

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
3. Drop as junk a new item whose `sent` is more than 13 days old (3.2).
4. Store the item durably. Only then remember its id and mark its messages handled. If storing fails (a full disk),
   the item is not handled: it holds the cursor and is downloaded again at the next poll.
5. Ack every complete item of the poll (new or already seen), batched (2.4). An ack that cannot be published is kept
   and published with the next poll's acks; an ack failure never loses items. At background polls, when the last
   digest is 11 hours old or more, also publish a digest: the ids remembered within the last 8 days, newest first, at
   most 280.
6. Hand the item to the Daylight Reader (`com.daylightcomputer.reader`):
   - `url`: `Intent("com.daylightcomputer.reader.action.SAVE_PAGE")` with `EXTRA_TEXT` = url and
     `com.daylightcomputer.reader.extra.TITLE` = title.
   - `page`: the same, plus the HTML as a `content://` URI (the Inbox's FileProvider) in `ClipData` with MIME
     `text/html` and `FLAG_GRANT_READ_URI_PERMISSION`. The Inbox stores it with `<meta charset="utf-8">` inserted right
     after a leading `<!doctype …>` (or at the very start when there is none), so a reader that sniffs the encoding
     gets UTF-8. The Reader reads at most 8 MiB within 5 s.
   - `file`: `Intent.ACTION_SEND` with `type` = mime, `EXTRA_STREAM` = a `content://` URI, `EXTRA_TITLE`/`EXTRA_SUBJECT`
     = title, `FLAG_GRANT_READ_URI_PERMISSION`, package `com.daylightcomputer.reader`.
   If the Reader is not installed, the item stays in the Inbox, which can open it with any app.

**Relay check.** Before the Inbox uses a relay other than `https://ntfy.sh`, or any relay with an access token, it
checks it, and does not save it when a step fails:

1. `GET {relay}/v1/account`: `limits.attachment_file_size` is F and `limits.attachment_total_size` is T (3.5). A `404`
   (ntfy before 2.0) leaves them unknown.
2. `PUT {relay}/dls-probe-<16 random hex digits>` with the 9-byte body `dls-probe` and `Filename: probe.bin`: the
   answer must be `200` with an `attachment.url`. (`400`: attachments are off. `401`/`403`: a token is needed.)
3. `attachment.url` must pass the download rule (3.2), and downloading it from the Daylight must return the 9 bytes.
4. When known, F ≥ 1,000,000 and T ≥ 4,000,000.

The pairing link then carries `r`, `k` (if any) and, when known, `lf` = F and `lt` = T (1.3).
```

### §3.5 Relay requirements, limits and access tokens (new section)

```markdown
### 3.5 Relay requirements, limits and access tokens

**Requirements.** The relay must keep messages for at least 12 hours and accept attachments: on ntfy that means
`base-url` and `attachment-cache-dir` are set, and `base-url` is the relay's own address or an `https://` address that
the Daylight can reach. ntfy.sh qualifies.

**Limits.** Two numbers describe a relay: F, the largest attachment it accepts, and T, the attachment bytes one sender
may keep on it at once (ntfy: `attachment-file-size-limit` and `visitor-attachment-total-size-limit`). A sender takes
them from its pairing:

1. the link has valid `lf` and `lt` (1.3): F = `lf`, T = `lt`;
2. else the relay is `https://ntfy.sh`: F = 2,000,000, T = 20,000,000;
3. else (ntfy's server defaults): F = 15,000,000, T = 100,000,000.

From them:

    chunk        = min(12,582,912, floor((F − 65,572) / 65,536) × 65,536)
    largest item = 1,000,000 × min(64, floor(16 × chunk / 1,000,000), floor((floor(T / 2) − 131,648) / 1,000,000))

(65,572 = the largest header a receiver accepts plus 36 bytes of magic, nonce, length and tag; 131,648 =
16 parts × (8,192 + 36).) A frame is then never larger than F, whatever its header, and two copies of the largest item
fit in T, so a re-send or retry that overlaps the first copy still fits. On ntfy.sh: chunk 1,900,544 bytes, largest
item 9,000,000 bytes ("9 MB"), at most 5 parts. (`vectors/test-vectors.json` > `relayLimits`.)

ntfy.sh also allows, per IP address (a phone and a Daylight on the same home network share them): 250 messages a day
(each frame is one message); 200 MB of attachment traffic a day, where an attachment counts when it is uploaded and
again each time it is downloaded, both against the uploader; and a burst of 60 requests, then one every 5 seconds.
Going over gives `429` or `413`, handled as in 3.1.

**Access token.** A relay that needs a login (a paid ntfy.sh tier, a self-hosted server with
`auth-default-access: deny-all`) is used with an ntfy access token, carried in the pairing link as `k`. Every request
to the relay's origin (publish, poll, stream, `/v1/account`) then carries the query parameter `auth=<A>`, where A is the
unpadded base64url encoding of the ASCII text `Bearer ` followed by the token; ntfy reads it like an `Authorization`
header. (A query parameter, not the header: a web page can send `Authorization` to another origin only after a CORS
preflight, and ntfy's `Access-Control-Allow-Headers: *` does not cover it.) Attachment downloads never carry it.
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
| Header JSON | 65,536 bytes accepted; senders build item headers of at most 8,192 |
| Page HTML | 8 MiB (8,388,608) decoded, the Reader's cap; larger pages go as `url`; receivers refuse a larger `size` |
| File | 256 MiB (268,435,456) decoded |
| Item, encoded | the relay's largest item (3.5): 9,000,000 on ntfy.sh; never more than 64,000,000 |
| Chunk | from the relay's limits (3.5): 1,900,544 on ntfy.sh; never more than 12,582,912 |
| Parts | 16 |
| Attachment download | 12,713,984 bytes (1,048,576 on the ack topic) |
| Poll answer | 16 MiB |
| Ack ids per frame | 70, and the frame must be small |
| Cursor overlap | 1,800 s |
| Remembered item ids | 14 days after the last sighting; new items whose `sent` is over 13 days old are refused |
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
   empty or `:` and ASCII digits. Otherwise the host runs to the first `:`, and what follows that `:` must be ASCII
   digits only.
5. Refuse an empty host, a host starting with `.`, or a host containing any of `< > ^ | \`.
```

### §5 Security notes

Old (L233-242): the whole list.

New:

```markdown
- The relay learns: two random topic names, frame sizes and timing, the sender's and receiver's IP addresses, and the
  access token when there is one.
- Anyone with the pairing code can send to and read from the inbox. "Reset pairing" on the Daylight makes a new
  secret; every sender must pair again.
- A pairing that arrives by link is applied only after the user confirms (1.3), so a link from someone else cannot
  silently redirect what this device sends.
- The access token is in the QR code, like the secret. On a self-hosted server, give it to a user that can only read
  and write `dls-*` topics (`ntfy access <user> 'dls-*' rw`).
- A receiver treats everything in a frame as untrusted input: it validates the header (`checkItemHeader` in the JS),
  accepts only URLs that pass the web URL rule (section 4), clamps strings, sanitises the file name, decodes with a
  size bound (2.3), downloads attachments only from https or the relay's own origin and only up to the size limit
  (3.2), refuses stale new items (3.2), and never forwards anything except through the Reader's own untrusted-input
  entry points.
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

All new groups are deterministic. Ports run every group. The only exception: Swift skips `fileNamesUtf16`, because
Swift strings cannot hold lone surrogates.

| Group | Change |
|---|---|
| `pairing` | Unchanged. |
| `pairingLinks` (new) | `{name, secretHex, relay, nameIn, token, fileLimit, totalLimit, link}`: write the link and parse it back. Cases: (1) ntfy.sh, no extras → `daylightshare://pair?c=…`; (2) relay + name (today's `linkWithRelayAndName`); (3) relay + name + `k=tk_AgQdq7mVBoFD37zQVN29RhuMzNIz2` + `lf=2097152&lt=20971520` (order c, r, n, k, lf, lt); (4) ntfy.sh + token only. Also `authParam`: `{token: "tk_AgQdq7mVBoFD37zQVN29RhuMzNIz2", auth: "QmVhcmVyIHRrX0FnUWRxN21WQm9GRDM3elFWTjI5Umh1TXpOSXoy"}`. |
| `codeParsing` | Add "look-alike digits 0 and 1": secret = first 16 bytes of SHA-256(`vector-lookalike-5`), code `V5NHVYBMSZPOPZIDLP2OP6P54VLA`, input `V5NHVY8MSZP0PZ1DLP20P6P54VLA`. Add link cases: `k=has space` → error `token`; `lf=500&lt=20000000` → parses, `fileLimit`/`totalLimit` absent; `lf=2000000` without `lt` → both absent. |
| `relays` (new) | `{input, expect}` or `{input, error: "relay"}`: `''`→`https://ntfy.sh`; `ntfy.sh`→`https://ntfy.sh`; `https://ntfy.sh/`→`https://ntfy.sh`; `HTTPS://Relay.Example.org:443/ntfy//`→`https://relay.example.org/ntfy`; `http://192.168.1.10:8080`→same; `relay.example.org:8443/`→`https://relay.example.org:8443`; `https://relay.example.org/ntfy?x=1#y`→`https://relay.example.org/ntfy`; `https://user:pw@relay.example.org`→`https://relay.example.org`; `http://[::1]:8080/`→`http://[::1]:8080`; `ftp://x`→error; `https://`→error. |
| `relayLimits` (new) | `{relay, lf?, lt?, fileLimit, totalLimit, chunk, maxEncoded, maxParts}` for the six rows of section 2.3, plus `https://ntfy.sh` with no params and `https://relay.example.org` with no params (→ 15,000,000 / 100,000,000 / 12,582,912 / 49,000,000). |
| `urls` (new) | `{input, expect}` (`expect` null = refused). Refused: `https:/example.com/story`, `https:example.com/story`, `https:\\example.com\story`, `https://.example.com/story`, `https://example.com:8a/x`, `https://a.b:1:2/`, `https://example.com/a b`, `https://[::1`, `javascript:alert(1)`, `https://`, `https://?q=1`, `https://exa\|mple.com/`, `https://example.com\story`, `https://example.com/` + U+0000, `https://example.com/` + U+00A0 + `x`, a 4097-unit URL. Accepted unchanged: `https://example.com:99999/x`, `HTTPS://EXAMPLE.COM/A`, `https://bücher.de/`, `https://user:pw@example.com/`, `https://[::1]:8080/`, `https://example.com:/x`, `https://example.com/` + U+200B + `x`, a 4096-unit URL. Trimmed: `' https://example.com/x '` → `https://example.com/x`. |
| `seal` | Add "header of exactly 65,536 bytes": `{"v":1,"x-pad":"aaa…"}`, padded to 65,536 bytes, empty body, nonce label `header-max`. |
| `invalidFrames` | Add "header of 65,537 bytes" (the same, one byte longer, sealed directly). |
| `items` | Rename the text item to "text file, deflate-raw, 3 parts (chunk 16)" with `chunkSize: 16` (assert `1 < frames.length <= 8`). Add "text file, deflate-raw, parts out of order" with frames `[2, 0, 1]`. |
| `invalidItems` (new) | Frames that decrypt and pass header checks but must fail reassembly with `integrity`, without inflating more than `size`: (1) "deflate bomb": `enc: deflate-raw`, `size: 10`, body = deflate-raw of 1,048,576 zero bytes; (2) "size too small": identity body of 20 bytes, `size: 10`; (3) "sha256 mismatch". Each is `{name, framesHex, error: "integrity"}`. |
| `badHeaders` | Give every existing entry `sent: "2026-10-17T22:00:00.000Z"`. Add: "missing sent"; "sent not ISO" (`"yesterday"`); "page size over 8 MiB" (`size: 8388609`); "file size over 256 MiB" (`size: 268435457`). |
| `fileNames` | Add: `'. .hidden'`→`'hidden'`; `'.. ..profile'`→`'profile'`; `'x/ . .bashrc'`→`'x bashrc'`; `'a'×115 + '😀'×5 + '.pdf'`→`'a'×115 + '.pdf'`; `'x'×150 + '.webarchive'`→`'x'×109 + '.webarchive'`; `'x'×150 + '.properties1'`→`'x'×120`; `'日本語のファイル名'×12 + '.pdf'`→ 65 CJK characters + `'.pdf'` (199 bytes); `'한국어파일이름'×15 + '.epub'`→ 65 Hangul characters + `'.epub'` (200 bytes); `'a' + U+00A0 + U+3000 + 'b' + U+FEFF + '.pdf'`→`'a b .pdf'`; `'a' + U+0000 + 'b' + U+007F + 'c' + U+0085 + 'd.pdf'`→`'a b c d.pdf'`; `'report.'`→`'report.'`; `'...'`→`'document'`. |
| `fileNamesUtf16` (new) | `{inputUtf16: [code units], expect}`: `[97, 0xD83D, 98, 46, 112, 100, 102]` (`a` + lone high surrogate + `b.pdf`) → `'ab.pdf'`; a lone low surrogate the same way. |
| `acks` (new) | `{name, ids (count, from the label "ack-id-<i>"), from, sent, headerJson, frameLength, small}`: 70 ids with `from` = 60 × U+1F600 → 2,798 / small; 72 ids → 2,868 / not small. `ackBatches`: 150 ids with that `from` → batch sizes `[70, 70, 10]`. |
| `notes` | Describe the new groups. Say that `relayLimits` and `acks` check arithmetic and serialisation, not crypto. |

### 5.2 Mock relay (`share/js/mock-relay.mjs`)

Options, with the matching CLI flags for the Kotlin `MockRelay.start(...)`:

| Option | Default | CLI | Behaviour |
|---|---|---|---|
| `attachmentMaxBytes` | 2,000,000 | `--attachment-max` | per-file limit |
| `visitorAttachmentTotalBytes` | 20,000,000 | `--visitor-total` | live (unexpired) attachment bytes per visitor, charged to the uploader |
| `visitorDailyBandwidthBytes` | 200,000,000 | `--daily-bandwidth` | uploads and downloads both charged to the uploader, poll replay bytes to the poller; rolling 24 h by the mock clock |
| `visitorDailyMessages` | 250 | `--daily-messages` | each publish counts; over → `429 {code: 42908}` |
| `requestBurst` / `requestRefillSec` | off / 5 | `--request-burst` | token bucket per visitor; empty → `429 {code: 42901}` |
| `attachments` | true | `--no-attachments` | false → every attachment publish answers `400 {code: 40014}` |
| `token` | none | `--token` | requests to topics without a matching `auth` query parameter (or `Authorization` header) → `403 {code: 40301}`; `/file/*` needs none |
| `control` | false | `--control` | enables the `/__mock/*` endpoints and the `X-Mock-*` request headers below |

Behaviour fixes:

1. **413 like ntfy.** If `Content-Length` > the per-file limit, or > the visitor's remaining total, answer
   `413 {code: 41301, http: 413, error: "attachment too large, or bandwidth limit reached"}` and `req.resume()` to
   drain. Otherwise read the whole body. Answer the same 413 at the end if it is over a limit or would exceed the
   daily bandwidth. Never call `req.destroy()`.
2. **Time at request start.** `const t = nowSec()` before reading the body. The message is appended to the topic
   list (and becomes visible to polls) only after the body is read.
3. **`since=<id>` like current ntfy.** For a known id: messages after it in insertion order, plus messages with
   `time >= marker.time` other than the marker. For an unknown or expired id: all retained messages.
4. **`GET /v1/account`:**
   `{limits: {attachment_file_size, attachment_total_size, attachment_expiry_duration, attachment_bandwidth,
   messages}, stats: {attachment_total_size, attachment_total_size_remaining, messages, messages_remaining}}` for the
   calling visitor.
5. **Download bandwidth:** `GET /file/<id>` over the uploader's daily bandwidth → `429 {code: 42905}`.
6. **Visitor** = the `X-Mock-Visitor` header (with `control`), else the remote address.
7. **Test hooks** (with `control`; JS tests can also pass functions):
   - `failDownload(id, n) → status | 'reset' | null` (`POST /__mock/fail-downloads?count=&status=`);
   - `X-Mock-Hold: <ms>` on a publish keeps the message invisible for that long after its body is read;
   - `POST /__mock/clock?offsetSec=` moves the mock's clock;
   - `state.downloadsById` counts downloads per attachment.

### 5.3 JS tests (`share/js/test`)

`protocol.test.mjs`:

- All new vector groups.
- `inflateRaw(bomb, 10)` rejects with `integrity`, and a counter on the stream shows it read less than 70 KiB of
  output.
- `buildItemFrames` with ntfy.sh limits:
  - a 9,000,000-byte PDF → 5 frames, each ≤ 2,000,000 bytes;
  - 9,000,001 bytes → `too-large` with "9 MB" in the message;
  - a 300 MB text file → `too-large` (decoded cap).
- `MAX_SENDER_HEADER` guard; `sealFrame` with a 65,537-byte header throws.
- `buildAckFrames` splits 150 ids into 70/70/10 and every frame is small.
- `relayLimits` for the three rules; `parsePairing` with `k`/`lf`/`lt`; `normalizeRelay('ftp://x')` throws.
- The multi-part deflate round trip (finding 23).

`relay.test.mjs`. The mock runs with ntfy.sh defaults; the clock is injected.

1. "a 5 MB PDF goes in 3 parts and arrives" (5,000,000 / 1,900,544 → 3).
2. "413 within the limit: failed/full, not retried before 185 min, then sent" (visitor total set to 3,000,000; a
   second file while the first is live).
3. "a legacy row bigger than the limit becomes rejected and is never retried automatically" (a row created with
   `chunkSize` 12 MiB under v1.0 rules, then `resendDue` with ntfy.sh limits).
4. "400 attachments off → rejected/no-files" (`attachments: false`).
5. "a download 429 / 503 / reset holds the cursor; the item arrives at the next poll" (`failDownload`). Also
   "after a 429 no further attachment is fetched in that poll" (`downloadsById`).
6. "an expired attachment (404) lets the cursor pass".
7. "a late-landing attachment is not skipped": PUT with `X-Mock-Hold: 500`; during the hold `advance(60_000)`,
   publish a link and poll; after it, poll again; the PDF arrives.
8. Finding 27's restart test (section 3, finding 27).
9. "held parts are not downloaded again": publish 2 of 3 parts, poll 3 times, `downloadsById` = 1 each, then the
   last part completes the item.
10. "accept() throwing → not acked, delivered at the next poll".
11. "ack publish failure → items still returned with ackError, ack published at the next poll" (relay closed for the
    ack only, via `failPublish` hook or a fetch wrapper).
12. "a sender that runs every 13 h sees its ack" (receiver polls every 15 min of mock time with digests; the sender
    ticks at 13 h, 26 h, …; the row is `delivered` before day 7 and has been re-sent at most once).
13. "a new item whose `sent` is 14 days old is neither delivered nor acked"; "a duplicate of a delivered item 13 days
    later is acked (seen refreshed)".
14. "Try again on an expired file sends it (content kept) with a new `sent`"; "after 14 days Try again says
    share it again".
15. "outbox cap keeps pending rows and drops the content of evicted finished rows" (201+ rows).
16. "a quota error on the content copy still sends once; the re-send makes it expired/nocopy".
17. "concurrent `send()` and `tick()` on one Sender lose no rows and publish each item once" (note a).
18. "re-send timing: 185 min in the first day, then 12 h" (count publishes over 3 days).
19. "a v1.0-style 150-id ack attachment is still read by `checkAcks`".
20. "token: every relay request carries `auth`; without it the mock answers 403 and the row is rejected/access".
21. "`probeRelay`: limits read; attachments off → error; foreign `attachment.url` → error".
22. "mock: `since=<unknown id>` replays everything".

`live-ntfy.mjs`: a 4,000,000-byte file (3 parts) plus the existing three items; check `/v1/account` limits
(finding 2); keep the CORS preflight check, adding `Access-Control-Request-Headers` without `authorization`.

### 5.4 Kotlin tests (`android/share-core/src/test`)

- `VectorsTest`: the new groups (`pairingLinks`, `relays`, `relayLimits`, `urls`, `fileNames` + `fileNamesUtf16`,
  `invalidItems`, `acks`, `seal`/`invalidFrames` header sizes, `badHeaders` with `sent`).
- `RelayTest`:
  - rename `attachmentsResendAfter150MinutesAndExpireAfter7Days` → `attachmentsResendAfter185MinutesThenEvery12Hours`;
  - extend `partsArrivingAcrossPollsHoldTheCursor` (finding 27, mock `--control` clock);
  - add `downloadFailureHoldsTheCursor`, `relayFullWaits185Minutes`, `badRequestIsRejected`,
    `heldPartsAreNotDownloadedAgain` (spool + `partMsgs` across a new `Receiver` instance), `digestReachesARareSender`,
    `staleNewItemIsRefused`, `ackFailureIsRetriedNextPoll`, `outboxCapKeepsPendingRows`, `tokenIsSentAsAuthParam`,
    `relayProbe`;
  - keep `javascriptSenderToKotlinReceiver` / `kotlinSenderToJavascriptReceiver`, now with a 5 MB file.
- `MockRelay.start` passes the new flags.

### 5.5 Android app tests (`android/app/src/test`)

- `InboxRepo.accept` stores a CJK-named PDF (byte-capped name) and falls back to `document.pdf` when the file system
  refuses the name (simulated with a stub `File` factory).
- `page.html` gets the `<meta charset="utf-8">` after a doctype, and at the start without one.
- `RoutesTest`: a `daylightshare://pair` intent never pairs without the dialog when the secret differs; the same
  secret applies directly.
- `ScreensSmokeTest`: the settings relay save shows the probe errors.

### 5.6 Swift tests (`apple/DaylightShareKit/Tests`)

- `VectorTests`: the new groups (`fileNamesUtf16` skipped), and `testBadHeadersAreRefused` with the new `sent`
  cases.
- `SenderTests`:
  - `testResendAfterElevenHoursThenExpireAndTryAgain` asserts the new `sent` on Try again and content kept until
    day 14;
  - add `testAttachmentResendTiming`, `testRelayFullWaits`, `testRejectedIsNotRetried`,
    `testOutboxCapKeepsPendingRows`, `testTokenAuthParam`, `testAckCursorHoldsOnRetry`;
  - `testTooLargeIsReported` uses the ntfy.sh limit (9,000,001 bytes);
  - `FakeRelay` answers 413 over 2,000,000 per PUT.
- `ShareUITests`: a deep link with a different secret sets `pendingPairing` and does not pair; the same secret pairs.

### 5.7 Extension and web tests

- `extension/test/unit/logic.test.mjs`: `statusInfo` for `rejected` and for `failed`/`full`. The PDF cap comes from
  the pairing's limits.
- `core.test.mjs`:
  - a 10 MB PDF on ntfy.sh sends the link with the note "The PDF is larger than 9 MB, so its link was sent.";
  - a page whose encoded HTML is over the limit sends the link;
  - an `outbox/` write that throws leaves `copy: false`;
  - relay change in settings drops `k`/`lf`/`lt`.
- `web-logic.test.mjs`: `normalizeUserUrl('https:/example.com')` → null.
- `web.e2e.mjs`: `#pair=` on an unpaired page asks first.
- `build.test.mjs`: the bundled `daylight-share.js` equals the share copy.

---

## 6. Per-platform checklists

Each list can be followed without reading the rest. The numbers in brackets are findings, the letters are notes.

### 6.1 JS reference (`share/js/daylight-share.js`)

1. Constants:
   - remove `CHUNK` and `MAX_ENCODED`;
   - add `CHUNK_MAX = 12582912`, `MAX_ENCODED_CAP = 64000000`, `MAX_DECODED = 268435456`, `FRAME_OVERHEAD = 36`,
     `MAX_HEADER = 65536`, `MAX_SENDER_HEADER = 8192`, `MAX_ATTACHMENT = 12713984`, `MAX_ACK_ATTACHMENT = 1048576`,
     `MAX_POLL_RESPONSE = 16777216`, `CURSOR_OVERLAP_S = 1800`, `RESEND_ATTACHMENT_MS = 185 * 60000`,
     `RESEND_ATTACHMENT_SLOW_MS = 12 * 3600000`, `FULL_WAIT_MS = 185 * 60000`, `SENDING_STALE_MS = 15 * 60000`,
     `CONTENT_KEEP_MS = 14 * 86400000`, `STALE_AFTER_MS = 13 * 86400000`, `INCOMPLETE_TTL_MS = 86400000`,
     `SEEN_MSG_TTL_MS = 2 * 86400000`, `DIGEST_INTERVAL_MS = 11 * 3600000`, `DIGEST_WINDOW_MS = 8 * 86400000`,
     `DIGEST_MAX_IDS = 280`, `PENDING_ACKS_MAX = 280`, `OUTBOX_MAX_ROWS = 200`;
   - set `MAX_ACK_IDS = 70`;
   - add `NTFYSH_LIMITS = {fileLimit: 2000000, totalLimit: 20000000}` and
     `NTFY_DEFAULT_LIMITS = {fileLimit: 15000000, totalLimit: 100000000}`. [1, 2, 9, 13, 15, 29]
2. `relayLimits(pairing)` → `{fileLimit, totalLimit, chunk, maxEncoded}` with the section 2.3 formulas. Add
   `formatLimit(maxEncoded)` → `"9 MB"`. [1]
3. `normalizeRelay`: reject non-http(s) schemes before adding `https://`; require a host. [e]
4. Pairing:
   - `parsePairing` reads `k` (validate `^[A-Za-z0-9._~-]{1,128}$`, else `ShareError('code', 'That pairing link is
     damaged.', 'token')`), and `lf`/`lt` (both valid, else ignored);
   - `pairingLink` writes c, r, n, k, lf, lt;
   - `savePairing`/`loadPairing` keep `token`, `fileLimit`, `totalLimit`;
   - add `samePairingSecret(a, b)`;
   - add `authParam(token)` = base64url without padding of `"Bearer " + token`. [3, 21]
5. `webUrl`: the textual rule of section 3 (finding 24). No `new URL()`. [24]
6. `safeFileName`: the algorithm of finding 12. [12, 25, 26]
7. `inflateRaw(bytes, limit)`: streaming with a bound. [10]
8. `sealFrame`: throw when the header is over 65,536 bytes. `buildItemFrames(keys, item, {chunkSize, limits, …})`:
   - take `chunk` and `maxEncoded` from `limits` (default `relayLimits({relay: DEFAULT_RELAY})`);
   - throw `too-large` over `maxEncoded` (message with `formatLimit`) or over `MAX_DECODED`;
   - throw `header` over 8,192 bytes. [1, 10, 28]
9. `buildAckFrames(keys, ids, opts)` → small frames of ≤ 70 ids; `buildAckFrame` slices to 70. [29]
10. `checkItemHeader`: `sent` required and ISO; page `size` ≤ `MAX_PAGE_HTML`; file `size` ≤ `MAX_DECODED`; `url` via
    the new `webUrl`. [10, 11, 24]
11. `Reassembler`: `inflateRaw(encoded, header.size)`; record `at` per pending item; `prune(maxAgeMs)`;
    `has(id, part)`. [10, 17]
12. `RelayClient({relay, token, fetch})`:
    - add `auth` to every relay URL;
    - `publish` throws `ShareError` with `.status` and returns `{id, time, attachment}`;
    - `poll(topic, since, {skip, maxAttachment})`: read the answer with a 16 MiB cap; apply the attachment URL rule;
      enforce the size cap (Content-Length first, then a byte counter); classify outcomes as
      `frame / expired / junk / retry`, and after a 429 the rest of the poll is `retry`. [4, 13, 21]
13. `probeRelay(relay, {token, fetch})` → `{fileLimit?, totalLimit?}` or `ShareError('relay', sentence)`. [21]
14. `Sender`:
    - a lock around the public methods [a];
    - `this.limits = relayLimits(pairing)`;
    - new row fields `errorCode`, `attemptStarted`, `copy`;
    - `send`: content copy in try/catch [b];
    - `_publish`: the error table of finding 7, comparing the failing frame's length with `fileLimit` [7];
    - `checkAcks`: `MAX_ACK_ATTACHMENT`, retry holds, cursor rule [4, 15];
    - `resendDue`: the timing table of spec §3.3, expiry keeping content, dropping content of expired/rejected rows
      after 14 d [6, 9];
    - `retry`: `sent = now`, `created = now` for expired/rejected, the `gone` error [6, 11];
    - `remove(id)`;
    - `_saveRow`: the cap of finding 16 [16, c].
15. `Receiver({…, accept})`:
    - a lock;
    - persisted `incomplete`, `pendingAcks`, `lastDigest`; in-memory `partMsgs`;
    - skip downloads that are in `seenMsgs` or `partMsgs`;
    - retry holds, accept-failure holds, the cursor rule;
    - `seen[id] = max(now, sent)` on store and on duplicate; stale refusal;
    - acks via `buildAckFrames` with the digest, never throwing;
    - return `{items, acked, ackError}`;
    - `reassembler.prune()` each poll. [4, 5, 11, 14, 15, 17]
16. Header comment: Version "1 (revision 1.1)". `PROTOCOL_VERSION` stays `1`.

### 6.2 Mock relay, tests, vectors (`share/js/mock-relay.mjs`, `share/js/test`, `share/vectors`, `live-ntfy.mjs`)

1. Implement section 5.2. Update the header comment and the CLI. [20]
2. `generate.mjs`: section 5.1, including `assert(1 < textBuilt.frames.length && textBuilt.frames.length <= 8)`.
   Regenerate `test-vectors.json`. [23, 24, 25, 26, 28, 29, 11]
3. Tests: section 5.3. [all]
4. `live-ntfy.mjs`: section 5.3. [2]
5. `package.json` version → `1.1.0`.

### 6.3 Extension (`reader-experiment/extension`)

1. Rebuild so `src/daylight-share.js` is the new reference copy (`build.mjs`).
2. `logic.js`:
   - drop `MAX_PDF = MAX_ENCODED`; core passes `sender.limits.maxEncoded` into the PDF reading;
   - `NOTES['pdf-too-large']` becomes a function of the limit ("The PDF is larger than 9 MB, so its link was
     sent.");
   - `statusInfo`: `rejected` → `{label: 'Not sent', tone: 'bad', retry: true, hint: row.error}`; `failed` with
     `errorCode === 'full'` → `{label: 'Waiting', tone: 'busy', retry: true, hint: row.error}`; `expired` → hint
     `row.error || 'Your Daylight didn’t pick it up within a week'`.
3. `core.js`:
   - `areaStorage` rethrows `outbox/` write errors [b];
   - `sendPdf` uses the limit, and over it falls back to `sendUrl(u, title, 'pdf-too-large')`;
   - page capture: if `sender.send` throws `too-large`, send the URL with the note 'too-large';
   - the relay setting change clears `token`, `fileLimit`, `totalLimit`;
   - `pair` from the popup asks for confirmation when replacing a pairing with a different secret (return
     `{needsConfirm: {current, next}}` to the popup, as `needsPermission` does). [1, 3, 7]
4. `popup.js` `resultMessage`: for `failed` use `row.error`, which is now the plain sentence, instead of "Couldn't
   reach the relay (…)". Show the confirmation for `needsConfirm`.
5. README and store texts: "PDFs up to 9 MB with the default relay".
6. Manifest `version` → `1.1.0`.

### 6.4 Web sender (`reader-experiment/web`)

1. Rebuild (`build.mjs`).
2. `web-storage.js` `localStorageAdapter.set` rethrows `outbox/` errors [b].
3. `app.js`:
   - `pairFromParam` asks also when unpaired, with the code's first group and the relay host [3];
   - `sendFile`: refuse with the plain sentence when `file.size > MAX_DECODED`, or when the file is not a text type
     and `file.size > sender.limits.maxEncoded` [1];
   - `describe()` uses `row.error`, and `rejected` gets the tone 'bad' [7].
4. `web-logic.js` needs no change (`normalizeUserUrl` inherits the new `webUrl`). Add the test.
5. README: "up to 9 MB with the default relay"; SHORTCUT.md unchanged (`#pair=` now asks once).

### 6.5 Kotlin share-core (`android/share-core/.../core`)

1. `Limits`: the constants of 6.1 item 1 (Kotlin names: `CHUNK_MAX`, `MAX_ENCODED_CAP`, `MAX_DECODED`,
   `MAX_SENDER_HEADER`, `MAX_ATTACHMENT`, `MAX_ACK_ATTACHMENT`, `MAX_POLL_RESPONSE`, `CURSOR_OVERLAP_S`,
   `RESEND_ATTACHMENT_MS`, `RESEND_ATTACHMENT_SLOW_MS`, `FULL_WAIT_MS`, `SENDING_STALE_MS`, `CONTENT_KEEP_MS`,
   `STALE_AFTER_MS`, `DIGEST_*`, `PENDING_ACKS_MAX`, `MAX_ACK_IDS = 70`). Add `RelayLimits(fileLimit, totalLimit)`
   with `chunk` and `maxEncoded`, and `RelayLimits.of(pairing)`. [1, 29]
2. `Pairing(secret, relay, name, token = null, fileLimit = null, totalLimit = null)`:
   - `link()` order c, r, n, k, lf, lt;
   - `parse` validates `k` (`ShareException("code", …, "token")`) and `lf`/`lt`;
   - `equals` covers them;
   - add `sameSecret(other)`;
   - `withRelay` drops token and limits. [3, 21]
3. `Relay.normalize`: reject non-http(s) schemes before adding `https://`. [e]
4. `Text.webUrl`: the section 3 rule (port digits, host characters, first `:`). `Text.safeFileName`: the finding 12
   algorithm (lone surrogates, `trimStart('.' or JS whitespace)`, ext 1–10 after the dot, code-point cut, 200 UTF-8
   bytes). [12, 24, 25, 26]
5. `FrameCodec.seal`: throw over 65,536 header bytes. `ItemHeader.check`: `sent` must match the ISO rule and parse
   (`Bytes.parseIsoTime`); page `size` ≤ 8 MiB; file `size` ≤ `MAX_DECODED`. `AckHeader.frames(keys, ids, from,
   sentMs)` splits into small frames of ≤ 70 ids. [10, 11, 28, 29]
6. `ItemBuilder.prepare(item, content, limits, …)`: `chunk` and `maxEncoded` from `limits`; a decoded-size cap; the
   8,192-byte header guard; messages with `formatLimit`. `PreparedItem` keeps its `chunkSize` parameter. [1, 28]
7. `RelayClient(relay, token, http, sleeper)`:
   - `auth` on relay URLs;
   - `poll` with `maxResponseBytes = MAX_POLL_RESPONSE`;
   - `download(url, cap)` returns an outcome (`Frame`, `Expired`, `Junk`, `Retry`) with the origin rule;
   - after a 429, the rest of a poll is `Retry`;
   - `RelayMessage(id, time, frame, skipped, retry, junk)`;
   - `publish` keeps throwing `RelayException(status)`. [4, 8, 13]
8. `RelayProbe.check(relay, token, http)` → `RelayLimits?` or `ShareException("relay", sentence)`. [21]
9. `ReceiverState`: add `partMsgs`, `pendingAcks`, `lastDigest`. `Receiver`:
   - skip `seenMsgs` ∪ `partMsgs`, after dropping `partMsgs` for items whose spool directory is gone;
   - holds (incomplete, retry, accept failure) and the cursor rule with 1,800 s;
   - `seenItems[id] = max(now, sent)`; stale refusal;
   - `partMsgs` lifecycle (finding 17);
   - `pollOnce` saves the state, then publishes this poll's acks + `pendingAcks` + digest via `AckHeader.frames`,
     never throwing for acks (failures go to `pendingAcks`);
   - `queueAcks(ids)` for the live path;
   - `Result(items, ackIds, ackError)`;
   - `prune` with `INCOMPLETE_TTL`. [4, 5, 11, 14, 15, 17]
10. `Status.REJECTED`. `OutboxRow` gets `errorCode` and `attemptStarted`. `Outbox(…, limits = RelayLimits.of(pairing))`:
    - `publish` applies the finding 7 table (the failing frame's length via `prepared.frameLength(part)` vs
      `fileLimit`);
    - `checkAcks`: ack attachments ≤ 1 MiB, retry holds, overlap 1,800 s;
    - `resendDue`: the spec §3.3 timing, `sending` stale after 15 min (fixes the add/publish race), expired rows
      keep content, a legacy row over `maxEncoded` → `rejected`/`too-large`;
    - `retry`: `sent = now`, `created = now` for expired/rejected; `gone` when the content is missing;
    - `saveRow`: the cap of finding 16, deleting `content/<id>.enc` of dropped rows;
    - `hasPending` excludes `rejected`. [6, 7, 9, 16]
11. `UrlConnectionHttp` unchanged. The `MockRelay` test helper passes the new flags.

### 6.6 Android app (`android/app/.../com/daylight/share`)

1. `ui/MainActivity.handleLink`:
   - parse → if `app.sender.pairing()?.sameSecret(p) == true`, apply with `app.sender.pair(p)` and the notice
     "Pairing updated.";
   - else set `pendingPair` (for every role).
   The dialog:
   - title "Pair with ${name}?";
   - text "Code starts ${first group}. Check it matches the code on your Daylight.", plus the relay host when not
     ntfy.sh, plus "This replaces ${current}. Items not yet delivered to it will not be sent." when replacing, plus
     the existing Inbox-role sentence;
   - buttons "Pair"/"Switch" and "Cancel". [3]
2. `sender/SenderRepo`:
   - `setRelay` uses `Pairing.withRelay` (drops token and limits);
   - `copyIn` message "That file is larger than 256 MB." (`MAX_RAW` = `Limits.MAX_DECODED`);
   - the Outbox gets `RelayClient(p.relay, p.token, …)`. [1, 3, 21]
3. `ui/SettingsScreen` (Inbox role):
   - "Save relay" and a new "Access token (optional)" field run `RelayProbe.check` off the main thread and show its
     sentence on failure;
   - on success store `Prefs.inboxRelay`, `Prefs.inboxToken`, `Prefs.inboxFileLimit`, `Prefs.inboxTotalLimit` and
     refresh the pairing;
   - for a saved custom relay without stored limits, `App.onRoleChanged` runs the check once in the background.
   Sender role: changing the relay drops token and limits. [21]
4. `inbox/InboxRepo`:
   - `ensurePairing`/`usePairing`/`refreshPairing` build `Pairing(secret, relay, name, token, lf, lt)` from the
     prefs;
   - `receiver()` passes the token to `RelayClient`;
   - `handleLive` calls `receiver.queueAcks(ids)` when `publishAcks` fails;
   - `pollOnce` logs `ackError`;
   - `accept`: wrap the move in try/catch and fall back to `document` + ext; for `page`, write `page.html` with the
     `<meta charset="utf-8">` insertion. [5, 12, 14, d]
5. `ui/SenderScreen` and `Components`:
   - show `row.error` (the plain sentence) for `failed`, `rejected` and `expired`;
   - label `rejected` "Not sent" and `failed`/`full` "Waiting";
   - "Try again" for `failed`, `rejected` and `expired`. [6, 7]
6. `Work.SyncWorker`: no change (the digest runs inside `pollOnce`). `inbox/Live`: no change beyond the share-core API.
7. README: "Files up to 9 MB with the default relay (ntfy.sh); a self-hosted relay can carry more."

### 6.7 Swift kit (`apple/DaylightShareKit/Sources/DaylightShareKit`)

1. `Constants.swift` (`DLS`):
   - replace `chunk` and `maxEncoded` with `chunkMax = 12_582_912` and `maxEncodedCap = 64_000_000`;
   - add `maxDecoded`, `maxSenderHeader`, `maxAckAttachment = 1_048_576`, `maxAttachment = 12_713_984`,
     `maxPollResponse`, `cursorOverlap = 1800`, `resendAttachment = 185 * 60`, `resendAttachmentSlow = 12 * 3600`,
     `fullWait`, `sendingStale = 15 * 60`, `contentKeep = 14 * 86400`;
   - `maxAckIDs = 70`;
   - add `struct RelayLimits` with `of(pairing)`, `chunk`, `maxEncoded`, `formatted`. [1, 29]
2. `Pairing`:
   - add `token`, `fileLimit`, `totalLimit` (Codable with `decodeIfPresent`);
   - link order c, r, n, k, lf, lt;
   - `parse` validation as in JS;
   - add `sameSecret(_:)`;
   - changing `relay` through `AppModel.setRelay` clears token and limits. [3, 21]
3. `Text.swift`:
   - `webURL`: add the leading-dot check, the port after the **first** `:`, and the host check as specified;
   - `safeFileName`: leading dots and spaces together, ext 1–10 units after the dot, a 200-byte UTF-8 cap with
     whole-scalar removal;
   - `normalizeRelay` already right. [12, 24, 25, 26]
4. `Frame.swift`:
   - `Frame.seal` throws over 65,536 header bytes;
   - `ItemBuilder.prepare(_:compress:limits:)`: `maxEncoded`, decoded cap and header guard, messages via
     `RelayLimits.formatted`;
   - `PreparedItem.partCount(chunkSize:)` callers pass `limits.chunk`;
   - `Reassembler` unchanged. [1, 10, 28]
5. `Header.swift`: `ItemHeader.validated` checks the `sent` ISO rule, page `size` ≤ 8 MiB and file `size` ≤
   `maxDecoded`. `AckHeader` caps at 70; add `AckHeader.frames(keys:ids:from:)` for completeness (only tests use it,
   Swift has no receiver). [10, 11, 29]
6. `RelayClient`:
   - `init(relay:token:session:)` adds `auth`;
   - `publish` throws `ShareError` with a `status` (add `public let status: Int` to `ShareError`, default 0);
   - `poll`: stream the answer with a 16 MiB cap; the attachment origin rule; a streaming size cap; outcomes
     `frame`/`expired`/`junk`/`retry` on `RelayMessage`; after a 429 the rest is `retry`. [4, 7, 13]
7. `Sender.swift` (`ShareSender`):
   - `limits = RelayLimits.of(pairing)`;
   - `publish` maps errors with the finding 7 table into `status` and `errorCode`;
   - `checkAcks`: `maxAttachment: DLS.maxAckAttachment`, a hold on `retry`, `ackSince = max(0, min(maxTime, held) −
     1800)`;
   - `resendDue`: the §3.3 timing, purging content of `expired`/`rejected` rows at 14 d after `created` (was 30 d),
     `.rejected` skipped;
   - `retry`: `row.header.sent = isoTimestamp(now)`, `row.sent` updated, `created = now` for expired/rejected. [6,
     7, 9, 11, 15]
8. `Outbox.swift`:
   - `OutboxRow.Status.rejected`;
   - `errorCode: String?`;
   - `canRetry` includes `rejected`;
   - `OutboxStore.update` applies the cap of finding 16 (keep `sending`/`sent`/`failed`; the newest finished rows up
     to 200; remove the body files of dropped rows). [16]

### 6.8 Apple UI (`DaylightShareUI`, iOS/macOS apps, share extensions)

1. `AppModel.handleOpen`: for `daylightshare://`:
   - parse;
   - same secret → `store.pair(p)` and the banner "Pairing updated.";
   - else set `@Published var pendingPairing: Pairing?`.
   Views (`Views.swift`, `HomeView`, `MacViews`) show a confirmation sheet with the texts of spec §1.3; "Pair"/"Switch"
   calls `confirmPairing()`. [3]
2. `AppModel.pair(_:)` (typed, pasted or scanned in `PairView`): if a pairing with a different secret exists, return
   a `needsConfirmation` result and let `PairView` show the same sheet. [3]
3. `AppModel.setRelay`: clears token and limits (via the kit). [21]
4. `AppModel.send` / `retry` banners and the history rows: show `row.error` for `.failed`, `.rejected` and
   `.expired`; label `.rejected` "Not sent" and `failed`/`full` "Waiting". [6, 7]
5. `ShareExtension.swift` and the macOS share extension: before reading a file into memory, refuse files over
   `DLS.maxDecoded`, and non-text files over `RelayLimits.of(pairing).maxEncoded`, with the kit's sentence; for a
   web page over the limit, send the link. [1]
6. The Safari web extension shares the JS `extension` build (6.3). The `NativeMessaging` pairing from the app stays
   silent (it is the user's own app).

---

### Not done (decided against)

- **Fetching `/v1/account` at send time.** It would add a request and a cache on three platforms. The Inbox's relay
  check plus `lf`/`lt` covers custom relays.
- **An id cursor.** It works on ntfy, but holding the cursor at incomplete items needs times.
- **Resuming half-uploaded items part by part.** The halving in `maxEncoded` makes the overlap safe. It can be added
  later without a spec change.
- **WHATWG canonicalisation or ASCII-only URLs.** Only JS has the parser, and receivers must keep accepting v1.0
  senders' non-ASCII URLs.
- **An upload timeout on senders.** The 30-minute overlap plus the 185-minute re-send cover slow uploads, and a
  timeout would fail 12 MiB chunks on slow links.
- **Swift receiver code.** None exists beyond the test reassembler. Swift only gets the header checks.
