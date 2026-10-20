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

```sh
node --test js/test/*.test.mjs   # unit and mock-relay tests
node vectors/generate.mjs        # regenerate the vectors after changing the library
node js/live-ntfy.mjs            # needs network access to ntfy.sh
```

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

### 1.0

The first version.
