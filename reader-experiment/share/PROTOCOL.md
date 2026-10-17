# Daylight Share protocol, version 1

How "Send to Daylight" apps (iPhone, Android phone, Mac, Chrome, Safari) get links, web pages and files onto a
Daylight DC-1, where the Daylight Inbox hands them to the Daylight Reader.

Design goals:

- **No accounts and no server of our own.** Frames travel through an [ntfy](https://ntfy.sh) server (default
  `https://ntfy.sh`, free, no sign-up). Any ntfy-compatible server works, including a self-hosted one with longer
  retention.
- **End-to-end encrypted.** The relay sees random topic names and AES-256-GCM ciphertext, never a URL, title or file.
- **Store and forward with acknowledgements.** ntfy.sh keeps messages for 12 hours and attachments for 3 hours. The
  Daylight acknowledges every item it receives; a sender re-publishes anything still unacknowledged before the relay
  forgets it, for up to 7 days. Re-publishing is safe: the Daylight deduplicates by item id.
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

- `r` is present only when the relay is not `https://ntfy.sh`. A relay URL is `https://` (or `http://` for local
  testing) with no trailing slash, no query and no fragment.
- `n` is a display name for the Daylight ("Anjan's Daylight"), at most 60 characters.
- Unknown parameters are ignored. Senders accept the link, the typed code, or the code with dashes.
- Apps register the `daylightshare` scheme, so scanning the QR code with a phone camera opens the app and pairs.

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

A receiver silently ignores any message that is not a valid frame (wrong magic, bad tag, bad header): topics are
public, so junk is possible.

### 2.1 Item header (inbox topic)

| Field | Type | Required | Meaning |
|---|---|---|---|
| `v` | number | yes | `1` |
| `id` | string | yes | Item id: 16 random bytes, lowercase hex (32 chars). The same for every part and every re-send. |
| `kind` | string | yes | `"url"`, `"page"` or `"file"` (2.2) |
| `url` | string | url, page | The `http(s)` address (at most 4096 characters). Optional for `file` (where it came from). |
| `title` | string | no | Display title, at most 300 characters |
| `name` | string | file | File name with extension, e.g. `"paper.pdf"`; no `/` or `\` |
| `mime` | string | page, file | `"text/html"` for page; the file's MIME type for file |
| `size` | number | page, file | Length of the whole content in bytes, after decoding (before compression) |
| `sha256` | string | page, file | Lowercase hex SHA-256 of the whole decoded content |
| `enc` | string | no | Body encoding: `"identity"` (default) or `"deflate-raw"` (RFC 1951, no zlib or gzip wrapper) |
| `part` | number | no | 0-based index of this frame's chunk (default 0) |
| `parts` | number | no | Number of chunks (default 1, at most 16) |
| `sent` | string | yes | When the user shared it, ISO 8601 UTC with milliseconds, e.g. `"2026-10-17T22:00:00.000Z"` |
| `from` | string | no | Sender device name, e.g. `"iPhone"`, at most 60 characters |
| `app` | string | no | Sender app and version, e.g. `"ios/1.0.3"`, `"chrome/1.0.0"` |

Receivers ignore unknown fields. Senders may add fields with an `x-` prefix.

### 2.2 Kinds

- **`url`**: a link and nothing else. The body is empty. The Daylight saves it with the Reader's read-later, which
  downloads the article itself. Use it when the sender cannot see the page (a link shared from an app, a link
  in a context menu).
- **`page`**: a web page as the user saw it. The body is the page's HTML (`document.documentElement.outerHTML` from
  the user's browser, so paywalled and logged-in pages work), usually `deflate-raw` encoded. `url` is the page's
  address; the Reader uses the HTML instead of downloading it. Senders send `url` instead when the HTML is larger
  than 8 MiB (the Reader's cap).
- **`file`**: a document: PDF, EPUB, DOCX, Markdown, HTML, plain text and so on. The body is the file. `deflate-raw`
  is allowed but pointless for PDF and EPUB; senders compress only text types.

### 2.3 Chunking

Let `encoded` = the body after `enc` (the whole thing). If it is longer than `CHUNK = 12 MiB` (12,582,912 bytes),
split it into consecutive chunks of `CHUNK` bytes (the last may be shorter), at most 16 parts. Frame `i` carries chunk
`i` with `part = i` and `parts = n`; every part repeats the full header. The receiver collects all parts of an `id`,
concatenates the chunks in `part` order, decodes `enc`, and checks `size` and `sha256`. Senders refuse content whose
encoded length exceeds 64 MiB.

### 2.4 Ack header (ack topic)

```json
{"v": 1, "kind": "ack", "ids": ["<item id>", "..."], "sent": "2026-10-17T22:01:00.000Z", "from": "Daylight"}
```

Body empty. `ids` lists items the Daylight has received completely and stored (at most 200 per frame). The Daylight
acks again whenever it sees an item it already has, so a sender that missed an ack gets another one after it re-sends.

---

## 3. Transport over ntfy

`relay` is the base URL (default `https://ntfy.sh`). `topic` is `inboxTopic` or `ackTopic`.

### 3.1 Publish

Every publish sends the header `Firebase: no` (ntfy.sh would otherwise forward the message to Google's push service
for its own Android app) and `Cache: yes`.

- **Small frame** (`len(base64(frame)) <= 3800`): `POST {relay}/{topic}` with `Content-Type: text/plain` and the body
  `base64(frame)` (standard alphabet, with `=` padding, no line breaks). ntfy stores it as the message text.
- **Large frame**: `PUT {relay}/{topic}` with the raw frame as the body and the headers `Filename: dls1.bin` and
  `Message: dls1`. ntfy stores it as an attachment (at most 15 MB on ntfy.sh, kept 3 hours).

A `2xx` answer means the relay has it. On `429` wait (honour `Retry-After` when present, else 10 s) and retry; on
`413` the frame is too large for this relay (report it, do not retry).

### 3.2 Receive

```
GET {relay}/{topic}/json?poll=1&since=<cursor>
```

`cursor` is `all` the first time, then a Unix time in seconds: the `time` of the newest message handled, minus 5
(overlap is harmless; see deduplication below). Never use a message id as the cursor: once that message has expired
from the cache, ntfy may return nothing for it. While an item is incomplete (some parts not seen yet), the cursor must
not pass the `time` of its earliest part. The answer is one JSON object per line. For each line with
`"event": "message"`:

- If it has `attachment`, download `attachment.url` (a plain `GET`; it may be on another path or host). That is the
  frame. An attachment that has expired (`404`) is skipped: the sender will re-send.
- Else the frame is `base64decode(message)`. A message that is not valid base64 is skipped.

Then decode the frame (section 2) and, for the inbox, feed it to the reassembler.

Receivers deduplicate by item `id` (remember ids for at least 14 days), so polling with `since=all` is always safe.
They may also remember handled ntfy message ids (for a day) to skip downloading the same attachment twice; a message
holding a part of an incomplete item is not "handled" yet. Senders read the ack topic the same way.

**Live delivery** (optional): keep `GET {relay}/{topic}/json?since=<cursor>` open (without `poll=1`). The server sends
one line per new message and `{"event":"keepalive"}` lines about every 45 s. Reconnect with backoff (2 s doubling to
60 s) and resume from the cursor. Browsers can use `{relay}/{topic}/sse?since=<cursor>` instead.

### 3.3 Sender behaviour

A sender keeps an **outbox** in persistent storage: for each item, its id, header summary, the encrypted frames (or
enough to rebuild them: frames can be re-encrypted with fresh nonces), when it was last published and its status.

1. Publish every frame of the item. Status `sent`.
2. Check the ack topic (poll with `since=all` or a cursor) right after sending, again ~30 s later if the app is still
   running, and whenever the app or extension runs. An ack listing the id -> status `delivered`. The outbox may then
   drop the frames and keep a small history row.
3. **Re-send** an item that is not delivered when its last publish is older than `RESEND_ATTACHMENT = 150 min` (any
   frame was an attachment) or `RESEND_MESSAGE = 11 h` (all frames were messages). Same id, same header, new nonces.
4. Stop after 7 days (status `expired`, offer "Try again").

Phones and browsers run this when they can (Android: WorkManager; iOS: on launch, on share and with background app
refresh; Chrome: `chrome.alarms`; Mac: a timer while the app runs).

### 3.4 Receiver behaviour (the Daylight Inbox)

1. Poll the inbox topic when the app starts, every 15 minutes in the background (Android WorkManager), and live while
   the app is open or "Instant delivery" is on.
2. Decode and reassemble. Verify `size` and `sha256`. Store the item in app storage.
3. Publish an ack for every complete item (new or already seen) in that poll, batched.
4. Hand the item to the Daylight Reader (`com.daylightcomputer.reader`):
   - `url`: `Intent("com.daylightcomputer.reader.action.SAVE_PAGE")` with `EXTRA_TEXT` = url and
     `com.daylightcomputer.reader.extra.TITLE` = title.
   - `page`: the same, plus the HTML as a `content://` URI (the Inbox's FileProvider) in `ClipData` with MIME
     `text/html` and `FLAG_GRANT_READ_URI_PERMISSION`. The Reader reads at most 8 MiB within 5 s.
   - `file`: `Intent.ACTION_SEND` with `type` = mime, `EXTRA_STREAM` = a `content://` URI, `EXTRA_TITLE`/`EXTRA_SUBJECT`
     = title, `FLAG_GRANT_READ_URI_PERMISSION`, package `com.daylightcomputer.reader`.
   If the Reader is not installed, the item stays in the Inbox, which can open it with any app.

---

## 4. Limits

| | Limit |
|---|---|
| URL | 4096 characters, `http://` or `https://` |
| Title | 300 characters |
| Page HTML | 8 MiB decoded (the Reader's cap); larger pages go as `url` |
| File | 64 MiB encoded (ntfy.sh keeps at most 100 MB of attachments per sender address at a time) |
| Chunk | 12 MiB (ntfy.sh allows 15 MB per attachment) |
| Parts | 16 |
| Ack ids per frame | 200 |
| ntfy.sh retention | messages 12 h, attachments 3 h; requests: a burst of 60, then one every 5 s per address |

## 5. Security notes

- The relay learns: two random topic names, frame sizes and timing, and the sender's and receiver's IP addresses.
- Anyone with the pairing code can send to and read from the inbox. "Reset pairing" on the Daylight makes a new
  secret; every sender must pair again.
- A receiver treats everything in a frame as untrusted input: it validates the header (`checkItemHeader` in the JS),
  accepts only `http`/`https` URLs, clamps strings, sanitises the file name, and never forwards anything except
  through the Reader's own untrusted-input entry points.
- Safe file name: split on `/` and `\`; in each segment turn control characters and `: * ? " < > |` into spaces,
  collapse whitespace, trim, drop leading dots; drop empty segments; join with one space; empty -> `document`; over
  120 characters -> cut, keeping an extension of up to 10 characters. (`vectors/test-vectors.json` > `fileNames`.)
- Nonces are random 96-bit values; at the volumes here the collision risk is negligible.
