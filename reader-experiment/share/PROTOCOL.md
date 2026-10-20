# Daylight Share protocol, version 1 (revision 1.1)

How "Send to Daylight" apps (iPhone, Android phone, Mac, Chrome, Safari) get links, web pages and files onto a
Daylight DC-1, where the Daylight Inbox hands them to the Daylight Reader.

Revision 1.1 changes no byte on the wire (frames, headers, topics, keys and the pairing link are those of 1.0, and `v`
stays `1`); it fixes sizes, validation and behaviour. See `CHANGES-v1.1.md` for the reasons.

Design goals:

- **No accounts and no server of our own.** Frames travel through an [ntfy](https://ntfy.sh) server (default
  `https://ntfy.sh`, free, no sign-up). A self-hosted ntfy server works too if it is open to everyone and accepts
  attachments of at least 2 MB (3.5).
- **End-to-end encrypted.** The relay sees random topic names and AES-256-GCM ciphertext, never a URL, title or file.
- **Store and forward with acknowledgements.** ntfy.sh keeps messages for 12 hours and attachments for 3 hours, and
  takes attachments of up to 2 MB, 20 MB per sender at a time. The Daylight acknowledges every item it receives; a
  sender re-publishes anything still unacknowledged once the relay has forgotten it (or is about to), for up to
  7 days. Re-publishing is safe: the Daylight deduplicates by item id.
- **Simple enough to implement four times** (JavaScript, Kotlin, Swift, plus tests): SHA-256, AES-GCM, raw DEFLATE,
  base32 and base64 are the only primitives.

The JavaScript reference implementation is `js/daylight-share.js`. Every implementation must pass
`vectors/test-vectors.json`.

---

## 1. Pairing

The Daylight Inbox generates the pairing secret once and shows it as a QR code and as a typed code. Every sender
stores the same secret. Whoever holds the secret can send to that Daylight and read what is sent to it, so the code
is shown only on the Daylight and stored only in the senders' private storage.

### 1.1 Secret

`secret` = 16 bytes from a cryptographically secure random generator.

### 1.2 Pairing code (typed form)

```
check  = SHA-256(secret)[0]                       (1 byte)
code   = BASE32(secret || check)                  (17 bytes -> 28 characters, RFC 4648 alphabet A-Z 2-7, no padding)
shown  = code in groups of 4 joined by "-"        e.g. "MZXW-6YTB-OI6Q-...-AB2Q" (7 groups)
```

Parsing a typed code (be forgiving, then strict):

1. Uppercase it. Remove spaces, `-`, `_` and `.`.
2. Map look-alikes: `0` -> `O`, `1` -> `I`, `8` -> `B`.
3. It must be exactly 28 characters of `A-Z2-7`, else **invalid**.
4. Decode 17 bytes (the 4 trailing bits of the last character are ignored).
5. `check` must equal `SHA-256(first 16 bytes)[0]`, else **invalid** ("check the code for a typo").

### 1.3 Pairing link (QR code)

```
daylightshare://pair?c=<code, 28 chars, no dashes>[&r=<relay URL, percent-encoded>][&n=<Daylight name, percent-encoded>]
```

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

### 1.4 Derived values

`||` is byte concatenation; labels are ASCII.

```
key        = SHA-256("dlshare/v1/key"   || secret)                        32 bytes, AES-256-GCM key
inboxTopic = "dls-" + lowercase hex(SHA-256("dlshare/v1/inbox" || secret))[0:32]   36 characters
ackTopic   = "dls-" + lowercase hex(SHA-256("dlshare/v1/ack"   || secret))[0:32]   36 characters
```

---

## 2. Frames

A frame is the unit stored on the relay. Every frame is one ntfy message.

```
frame     = magic || nonce || ciphertext
magic     = ASCII "DLS1"                          4 bytes
nonce     = 12 random bytes (never reused with the same key)
ciphertext= AES-256-GCM(key, nonce, plaintext, aad) including the 16-byte tag at the end
aad       = ASCII "dlshare/v1/inbox" for frames on the inbox topic, "dlshare/v1/ack" on the ack topic
plaintext = u32be(len(headerJson)) || headerJson (UTF-8 JSON object) || body (bytes, may be empty)
```

`len(headerJson)` is at most 65,536 bytes; a receiver ignores a frame with a longer header, and a sender never seals
one. A frame is therefore at most `chunk + 65,572` bytes.

A receiver silently ignores any message that is not a valid frame (wrong magic, bad tag, bad header): topics are
public, so junk is possible.

### 2.1 Item header (inbox topic)

| Field | Type | Required | Meaning |
|---|---|---|---|
| `v` | number | yes | `1` |
| `id` | string | yes | Item id: 16 random bytes, lowercase hex (32 chars). The same for every part and every re-send. |
| `kind` | string | yes | `"url"`, `"page"` or `"file"` (2.2) |
| `url` | string | url, page | The address; it must pass the web URL rule (section 4). Optional for `file` (where it came from). |
| `title` | string | no | Display title, at most 300 characters |
| `name` | string | file | File name with extension, e.g. `"paper.pdf"`, made safe as in section 5 (at most 120 UTF-16 code units and 200 UTF-8 bytes) |
| `mime` | string | page, file | `"text/html"` for page; the file's MIME type for file |
| `size` | number | page, file | Length of the whole content in bytes, after decoding (before compression): at most 8,388,608 for `page` and 268,435,456 for `file`; senders send at most 9,000,000 |
| `sha256` | string | page, file | Lowercase hex SHA-256 of the whole decoded content |
| `enc` | string | no | Body encoding: `"identity"` (default) or `"deflate-raw"` (RFC 1951, no zlib or gzip wrapper) |
| `part` | number | no | 0-based index of this frame's chunk (default 0) |
| `parts` | number | no | Number of chunks (default 1, at most 16) |
| `sent` | string | yes | When the user shared it, ISO 8601 UTC with milliseconds, e.g. `"2026-10-17T22:00:00.000Z"` |
| `from` | string | no | Sender device name, e.g. `"iPhone"`, at most 60 characters |
| `app` | string | no | Sender app and version, e.g. `"ios/1.0.3"`, `"chrome/1.0.0"` |

Receivers ignore unknown fields. Senders may add small fields with an `x-` prefix; the whole header must stay within
65,536 bytes.

### 2.2 Kinds

- **`url`**: a link and nothing else. The body is empty. The Daylight saves it with the Reader's read-later, which
  downloads the article itself. Use it when the sender cannot see the page (a link shared from an app, a link
  in a context menu).
- **`page`**: a web page as the user saw it. The body is the page's HTML (`document.documentElement.outerHTML` from
  the user's browser, so paywalled and logged-in pages work) as UTF-8 without a byte-order mark, usually `deflate-raw`
  encoded. A `<meta charset>` inside may name another encoding (it is the browser's DOM); receivers decode the body as
  UTF-8 regardless. `url` is the page's address; the Reader uses the HTML instead of downloading it. Senders send
  `url` instead when the HTML is larger than 8 MiB (the Reader's cap).
- **`file`**: a document: PDF, EPUB, DOCX, Markdown, HTML, plain text and so on. The body is the file. `deflate-raw`
  is allowed but pointless for PDF and EPUB; senders compress only text types, and use `deflate-raw` only when it
  makes the body smaller.

### 2.3 Chunking

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

### 2.4 Ack header (ack topic)

```json
{"v": 1, "kind": "ack", "ids": ["<item id>", "..."], "sent": "2026-10-17T22:01:00.000Z", "from": "Daylight"}
```

Body empty. `ids` lists items the Daylight has received completely and stored: at most 70 per frame, so that every
ack frame is a small frame (3.1) with any `from` of up to 60 characters, kept as a message (12 hours on ntfy.sh) and
never as an attachment (3 hours). The Daylight acks again whenever it sees an item it already has, and re-publishes a
digest of the ids it has seen in the last 8 days at least every 11 hours and after any failed ack (3.4), so a sender
that missed an ack gets another one. Senders read `ids` from any ack frame, whatever its size (Daylights before 1.1
sent up to 200 per frame).

---

## 3. Transport over ntfy

`relay` is the base URL (default `https://ntfy.sh`). `topic` is `inboxTopic` or `ackTopic`.

### 3.1 Publish

Every publish sends the header `Firebase: no` (ntfy.sh would otherwise forward the message to Google's push service
for its own Android app) and `Cache: yes`.

- **Small frame** (`len(base64(frame)) <= 3800`): `POST {relay}/{topic}` with `Content-Type: text/plain` and the body
  `base64(frame)` (standard alphabet, with `=` padding, no line breaks). ntfy stores it as the message text.
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

### 3.2 Receive

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

**Live delivery** (optional): keep `GET {relay}/{topic}/json?since=<cursor>` open (without `poll=1`). The server sends
one line per new message and `{"event":"keepalive"}` lines about every 45 s. Reconnect with backoff (2 s doubling to
60 s) and resume from the cursor. Browsers can use `{relay}/{topic}/sse?since=<cursor>` instead.
A message from the stream is handled exactly like one from a poll (download outcomes, holds, cursor).

### 3.3 Sender behaviour

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

### 3.4 Receiver behaviour (the Daylight Inbox)

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

---

## 4. Limits

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

## 5. Security notes

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
