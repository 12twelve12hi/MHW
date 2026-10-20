# Real-device checks

Run by a Claude session on the Mac mini, with the lab DC-1 ("Rooted 2", JP4R01422) as the Daylight, its main
Daylight Reader (`com.daylightcomputer.reader`), and the real ntfy.sh relay. Test items were removed afterwards and
the tablet's library was back at its recorded baseline both times.

## Round 1 (Oct 20)

| Sender | Item | Send to hand-off | Result |
|---|---|---|---|
| Command-line sender | page | ~7.6 s | In the Reader |
| Command-line sender | link | ~6 s | In the Reader |
| Command-line sender | PDF | ~1 s | In the Reader |
| Command-line sender | page, sent while the Reader was in front (nobody touched the tablet) | ~6 s | In the Reader |
| Mac app | PDF | late (see below) | In the Reader |
| Mac app | link | ~6.5 s | In the Reader |

Every hand-off went to `com.daylightcomputer.reader`, never to the side-by-side `com.daylightcomputer.readerexperiment`.

Found:
- **Mac app hangs at launch on macOS 15.** The app checks its App Group container on the main thread. Its ad-hoc
  signature and un-prefixed group trigger the "would like to access data from other apps" prompt, so the app waits
  until someone clicks Allow. Fixed: the container is never touched on the main thread, and ad-hoc builds use no
  App Group (commit 0e90108, under review).
- **A PDF that arrives while the Reader is in front waits** until the Inbox is opened. Fixed: the Inbox now notifies
  at once, and "Add quietly to the library" hands documents over as SEND_MULTIPLE, which shows the library instead of
  opening the PDF (commit cb57057, under review).
- Not verified: the Mac app's "Delivered" history, because of the hang. Added to its CI smoke test.

## Round 2 (Oct 20)

| Sender | Item | Send to hand-off | Sender shows |
|---|---|---|---|
| Android phone app (Android 14 emulator, typed code, system share sheet) | link | ~8 s | Delivered ✓ |
| Android phone app | PDF | ~3 s | Delivered ✓ |
| Chrome extension 1.0.4 (release zip in Chromium, optional `<all_urls>` granted) | page | ~7 s | Delivered ✓ |
| Chrome extension | PDF | ~3 s | Delivered ✓ |
| Chrome extension | link | ~6 s | Delivered ✓ |
| Web sender | link | ~7 s | Delivered ✓ |
| Web sender | PDF | ~4 s | Delivered ✓ |

Found:
- **A PDF was handed off but never imported (once in three tries).**
  - **What happened:** the Inbox logged `send_file status=sent` and the sender showed Delivered ✓, but the Reader
    reopened the previous document instead.
  - **Cause, in the Reader:** its ImportActivity (singleTask) collects navigation only while resumed. The earlier
    import's "open the document" event was still pending when the new share arrived through `onNewIntent`. That
    stale event reopened document 1 and finished the activity, which dropped the new file. Reported to the Reader
    session on the Mac mini, with a suggested fix and test.
  - **Workaround in the Inbox (protocol port):** start document hand-offs with `FLAG_ACTIVITY_NEW_TASK |
    FLAG_ACTIVITY_CLEAR_TASK`, space them out, and batch them.
  - **Lab:** report "In your Reader ✓" separately from "On your Daylight ✓" where the Reader confirms the save. It
    does for links and pages; for documents, only the Reader-side Lab inbox can.
- **The web sender says "up to 64 MB",** but ntfy.sh takes about 2 MB until protocol v1.1. v1.1 sets one 9 MB
  limit and shared wording for every app (protocol port).
