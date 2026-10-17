# Building the Inbox into the Daylight Reader

Today the Daylight runs two apps: **Daylight Share** (the Inbox) receives items and hands each one to the **Daylight
Reader** through the Reader's public entry points. This works with any Reader build that has them, but it is two
apps, a "Saved" card pops over whatever is on screen, and Android's limits on starting activities from the
background mean the Inbox needs "Display over other apps" (or a tap on a notification).

This note is the plan for the Reader receiving directly. Class names refer to the Reader's source (the public
snapshot is `a12k-a2b/daylight-reader` at 0.27.843; the live code has moved on, so check each name).

## What the user sees

- **Settings > Reading features > Send from other devices** (off until turned on): a switch, a one-line privacy note
  ("Encrypted on your phone or computer; passes through ntfy.sh; only this Daylight can read it"), the pairing QR code
  and typed code, **Reset pairing**, and under Advanced the relay URL.
- Items arrive in the library like any read-later save or import, with a small "from iPhone" source line (the item's
  `from`), no card over the screen, and the same "Saved" line the read-later queue already shows when the library
  opens (`ReadLaterLines.queueDone`).

## How it fits

| Piece | Where | Notes |
|---|---|---|
| Protocol | `:share-core` (pure Kotlin/JVM) from `reader-experiment/android/share-core`, vendored like `third_party/showme-client` | Pairing, frames, reassembly, relay client. Already JVM-tested against `share/vectors/test-vectors.json`. |
| Poller | `RemoteInboxWorker` (WorkManager periodic, 15 min, network-constrained) + a poll in `ReadLaterUpkeep.onLibraryShown` | Cursor, seen ids and pending parts in the Reader's store (a small table, or `user_prefs`-style keys); never synced. |
| Links and pages | `ReadLaterCenter.saver(c).save(SavedItem(url, title, source = VIA_REMOTE), html)` | The same path SAVE_PAGE takes after `SavePageIntent.parse`, in process: no Intent, no FileProvider, the same 4 KB URL / 8 MB HTML caps. Add `SavedItem.VIA_REMOTE = "remote"` to `DIRECT` and give it its own switch instead of `fromBrowser`. |
| Files | `ImportStager` (copy + SHA-256) then the import pipeline, as for open-with | `Sniffer` decides the format from the bytes, not from the sender's `mime`. |
| Ack | `:share-core` publishes acks after the store commits | Senders stop re-sending. |
| Untrusted input | CONTRACTS 0.13 rules | Every header field is untrusted: URL http(s) only, clamped strings, safe file name, size and sha256 checked before staging. |

## Moving from the standalone Inbox

If both receive with the same pairing, items land twice. The Reader's settings screen should say so when Daylight
Share is installed in the Inbox role and offer to **take over its pairing**: Daylight Share can expose its pairing
to the Reader only (a signature-or-explicit-package `ContentProvider` read, or the user scanning its QR code with
the Reader's own "Pair" screen). After the takeover Daylight Share stops receiving.

## Tests

- JVM: the shared vectors; a fake relay (the protocol's mock relay or an in-JVM one) for poll, reassembly across
  restarts, dedupe and acks; `SavedItem.VIA_REMOTE` through `ReadLaterSaver` with fake ports.
- Device journey: pair, send a link, a page and a PDF from `share/js` on the Mac, see three new rows in
  `ShellReceiver` `count`, and an ack on the sender.
