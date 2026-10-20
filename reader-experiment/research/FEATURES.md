# Send to Daylight: researched features and the Lab plan

*Written 2026-10-20 from 14 research notes (`research/raw/`). The machine-readable catalogue is `research/features.json`. The rules for the Lab switch are in `../LAB-DECISIONS.md`.*

**About the evidence.** The researchers could not reach Reddit, YouTube, the app stores, the Chrome Web Store, MobileRead or most vendor sites from this environment, and the shared web-search budget ran out early. So almost all user voice below comes from public GitHub issue trackers, READMEs and docs that a researcher opened. Quotes taken from search-result snippets are marked *(search snippet)*; claims nobody opened are marked *(relayed, not opened)*; a few entries summarise a thread instead of quoting it. Nothing first-hand from Daylight DC-1 owners was found. Store ratings and prices are left out because they could not be checked. A ready re-run plan (about 35 searches) is in `raw/followup-first-hand-user-voice-daylight-and-store-reviews.md`, section 7.

## 1. Executive summary: what the best products get right

1. **Capture happens where you are, in one gesture, and then gets out of the way.** Pocket's toast, GoodLinks' Quick Save, Readwise's Alt+R. The most repeated complaint in share-sheet trackers is being thrown into the app after sharing (Karakeep #237). For us: Share > Daylight must finish in about a second and leave you in the source app (F04, F08).
2. **They send what you see, not a URL the server fetches again.** Readwise, Matter and Instapaper win on paywalled and logged-in pages because the browser sends the rendered page. Server crawlers produce broken snapshots. This fits our end-to-end design exactly: the relay can't fetch anything, so the device does (F03, F10).
3. **They tell the truth about delivery.** "Sent" that turns out not to have arrived is the loudest pain across Kindle email (SMTP accepted, rejected later), Taildrop (no notification, open since 2023) and Immich (false success). Our delivery receipts are already a differentiator. Lab extends them to "In your Reader", "Waiting for a tap" and the Daylight's last check-in (F01, F15).
4. **Nothing gets lost, offline included.** Instapaper is loved as "rock solid" offline; Karakeep users stuck on flights ask for an outbox. Queue first, send when possible, never duplicate (F07, F32).
5. **They respect the document.** PDFs stay PDFs (Amazon's forced "convert" and silent fixed-layout E016 are what not to do); images survive (WebP placeholders on Kobo); big files just arrive. Big files are the biggest gap against every pen tablet: ntfy.sh takes 2 MB per file (F13 on the same Wi-Fi now, F02 with the server later).
6. **Organising at save time is optional and light.** A note, a tag, a destination and a remembered default, never a form. People tag at save time when it costs nothing (wallabag #675) and abandon apps that force an editor (F12).
7. **They batch and schedule for calm reading.** Instapaper's Kindle digest, "a personal newspaper with its own contents page", is the best-loved e-reader feature in the research, and its repeats are its best-known flaw. A morning stack built on the tablet needs no server (F14, F22).
8. **They close the loop.** Highlights, notes, progress and "finished" coming back to the phone or Mac is the biggest unmet want for pen tablets (KOReader #4587 open since 2019; ZotFile users stranded by Zotero 7). The DC-1's pen makes this Daylight's differentiator: Lab ships "Send back from the DC-1" now (F06) and the Reader-side automatic return next (F05, F18).
9. **They are scriptable.** Shortcuts with a return value, URL schemes, CLIs and APIs (GoodLinks, Readwise CLI, Taildrop Shortcuts at 34 thumbs-up) turn a send button into a platform (F09).
10. **They never trap the user.** Pocket and Omnivore shut down with weeks of notice; Instapaper moved Kindle sends behind Premium. No account, an open protocol, a self-hostable relay and export are selling points, and we already have most of them (F51).

**Where Send to Daylight stands.** It already matches the best capture path (reMarkable-style one-click send of the page as you see it, from every platform), and its end-to-end delivery receipts beat Amazon's. It trails every pen-tablet competitor on two things: big files (2 MB per file on ntfy.sh, 9 MB per item in protocol v1.1) and the return trip (notes and pen pages back to the phone or Mac).

## 2. Feature catalogue (ranked)

Ranked by value to readers times strength of evidence times fit for a grayscale pen tablet with an end-to-end encrypted relay. **Needs**: *companion-only* (only the sending apps change), *companion+inbox* (the sending apps and the Daylight Share Inbox on the DC-1), *reader-change* (the Daylight Reader must change), *server* (the user's Cloudflare Worker). **Effort**: S (days), M (one to two weeks per platform family), L (more). **Value**: H, M, L. **Lab**: the build wave in section 3, *next* (section 4) or *ask* (section 6).

| # | Feature | Needs | Effort | Value | Lab |
|---|---|---|---|---|---|
| 0 | [Lab switch and "needs setup" messages](#f00) | companion-only | S | H | W0 |
| 1 | [Honest delivery timeline](#f01) | companion+inbox | M | H | W1 |
| 2 | [Big files through the Daylight server](#f02) | server | L | H | next |
| 3 | [Send the page as you see it, and say when only a link came through](#f03) | companion-only | S | H | W1 |
| 4 | [Share in place: done in a second, never opens the app](#f04) | companion-only | M | H | W1 |
| 5 | [Notes come home automatically](#f05) | reader-change | L | H | next |
| 6 | [Send back from the DC-1 to my phone or Mac](#f06) | companion+inbox | M | H | W2 |
| 7 | [Offline-first outbox](#f07) | companion-only | M | H | W1 |
| 8 | [Your Daylight in the share sheet's top row](#f08) | companion-only | S | H | W1 |
| 9 | [Automation: Shortcuts, Siri, URL scheme, Android intent, command line](#f09) | companion-only | M | H | W1 |
| 10 | [Send as: page, clean article, link or selection, with a thin-content check](#f10) | companion-only | M | H | W1 |
| 11 | [Send a selection as an excerpt](#f11) | companion+inbox | S | H | W1 |
| 12 | [Note, tags and "read now / quietly / hold" at send time](#f12) | companion+inbox | M | H | W2 |
| 13 | [Big files on the same Wi-Fi (direct, no server)](#f13) | companion+inbox | L | H | W2 |
| 14 | [Morning stack: one issue with a contents page, never repeating](#f14) | companion+inbox | L | H | W3 |
| 15 | [Arrival notification with actions, and Inbox health](#f15) | companion+inbox | S | H | W1 |
| 16 | [Smart intake: unwrap Apple News, AMP, Substack and tracking links](#f16) | companion-only | S | H | W1 |
| 17 | [Capability hello and version-skew safety](#f17) | companion+inbox | S | H | W0 |
| 18 | [Opened, reading progress and finished, back on the phone](#f18) | reader-change | M | H | next |
| 19 | [Email-in address for newsletters and documents](#f19) | server | L | H | next |
| 20 | ["On your Daylight": see and steer what waits in the Inbox](#f20) | companion+inbox | M | M | W3 |
| 21 | [Manage the Reader's reading queue from the phone](#f21) | reader-change | L | M | next |
| 22 | [Send several tabs or items as one issue](#f22) | companion-only | M | M | W2 |
| 23 | [PDFs stay PDFs, and "Print to Daylight" from any app](#f23) | companion-only | M | M | W2 |
| 24 | [Image diet: self-contained pages tuned for grayscale](#f24) | companion-only | M | M | W2 |
| 25 | [Read-later connectors pulled by the Inbox](#f25) | companion+inbox | M | M | W3 |
| 26 | [Setup coach, test send and diagnostics](#f26) | companion-only | S | M | W1 |
| 27 | [Accessibility baseline, plus a Lab comfort mode](#f27) | companion-only | M | H | W0 |
| 28 | [YouTube videos as readable transcripts](#f28) | companion-only | M | M | W3 |
| 29 | [Mac power moves](#f29) | companion-only | M | M | W2 |
| 30 | [Scan paper to a clean PDF](#f30) | companion-only | M | M | W2 |
| 31 | [Chrome Reading List to Daylight](#f31) | companion-only | S | M | W2 |
| 32 | ["Already sent" notice and duplicate guard](#f32) | companion-only | S | M | W2 |
| 33 | [Send the copied link](#f33) | companion-only | S | M | W1 |
| 34 | [Full browser context menu and keyboard shortcuts](#f34) | companion-only | S | M | W1 |
| 35 | [RSS feeds checked by the Inbox](#f35) | companion+inbox | M | M | W3 |
| 36 | [Server feeds and digests while the tablet sleeps](#f36) | server | M | M | next |
| 37 | [AI summary, "explain this", ask and translate (Claude)](#f37) | server | M | M | next |
| 38 | [Notes into Obsidian, a folder or Readwise from the Mac](#f38) | companion-only | M | M | W3 |
| 39 | [Handwriting to text for returned pages](#f39) | companion-only | M | M | W3 |
| 40 | [Inbox triage and housekeeping](#f40) | companion+inbox | M | M | W3 |
| 41 | [Android Quick Settings tile and "Send to Daylight" in the text-selection menu](#f41) | companion-only | S | M | W2 |
| 42 | [iPhone controls and widgets](#f42) | companion-only | M | M | W2 |
| 43 | [Paper mode for PDFs: crop margins, blank note pages, writing margin](#f43) | companion-only | M | M | W3 |
| 44 | [Send a paper by DOI, arXiv id or PubMed id](#f44) | companion-only | M | M | W3 |
| 45 | [X/Twitter threads as one article](#f45) | companion-only | M | M | W3 |
| 46 | [Guest drop: let someone send to this Daylight once](#f46) | companion+inbox | M | M | W3 |
| 47 | [Import a reading list](#f47) | companion-only | M | M | W3 |
| 48 | [Verified delivery and private items](#f48) | companion+inbox | S | M | W2 |
| 49 | [Pairing fingerprint and safe handling of what arrives](#f49) | companion+inbox | S | M | W3 |
| 50 | [iPad: sidebar layout, drag and drop, keyboard](#f50) | companion-only | S | M | W2 |
| 51 | [No lock-in: export, your own relay, a documented protocol](#f51) | companion-only | S | M | W2 |
| 52 | [Reading aids in the Reader: ruler, spacing, fonts, opt-in emphasis](#f52) | reader-change | M | M | next |
| 53 | [Read aloud on the DC-1](#f53) | reader-change | M | M | next |
| 54 | [LivePaper reading ergonomics: whole-page turns, no motion](#f54) | reader-change | M | M | next |
| 55 | [Open where I stopped reading on the phone](#f55) | reader-change | M | M | next |
| 56 | [Listen on the phone](#f56) | companion-only | M | M | W4 |
| 57 | [Zotero plugin: Send to Daylight, annotations back](#f57) | companion+inbox | L | M | W4 |
| 58 | [Personal webhook for IFTTT, Zapier, Make and n8n](#f58) | server | S | L | next |
| 59 | [Import from Safari Reading List (Mac)](#f59) | companion-only | M | L | W4 |
| 60 | [Keyboard-first quick send and a command palette](#f60) | companion-only | S | L | W4 |
| 61 | [Make scans searchable before sending (OCR)](#f61) | companion-only | M | M | W4 |
| 62 | [arXiv and HTML papers with readable maths](#f62) | companion-only | M | M | W4 |
| 63 | [Warn about fake redactions and hidden metadata before sending](#f63) | companion-only | M | L | W4 |
| 64 | [On-device summary with Apple Intelligence (no key, no server)](#f64) | companion-only | M | M | ask |
| 65 | [Audio edition (server text-to-speech to MP3)](#f65) | server | L | L | next |
| 66 | [Highlight and library sync across devices](#f66) | reader-change | L | M | next |
| 67 | [Watched folder on the tablet](#f67) | companion+inbox | M | L | W4 |
| 68 | [Reading stats](#f68) | reader-change | S | L | next |

<a id="f00"></a>
### 0. Lab switch and "needs setup" messages

`F00` · value **H** · effort **S** · needs **companion-only** · **Lab wave 0** · Foundation

**What it is.** Every companion app gets one **Lab** switch, on by default (new installs, and switched on once by the first update that has it, with a one-line "Lab is on" note). Lab off gives today's app unchanged. Features that need something not yet set up look available and, when tapped, say what is missing and where to add it.

**Who does it best.** This is the user's rule (LAB-DECISIONS.md), not a researched product.

**Pitfalls.** Greyed-out or hidden controls make people forget the feature exists (the user's reason for "on by default").

**Our design.**

- *All apps:* A Lab row at the top of Settings with the switch and a "What's in Lab" list linking to each feature. One shared component renders the needs-setup sentence (texts from LAB-DECISIONS.md and server/DESIGN.md section 14). Lab state is per app and never synced.

<a id="f01"></a>
### 1. Honest delivery timeline

`F01` · value **H** · effort **M** · needs **companion+inbox** · **Lab wave 1** · Delivery

**What it is.** Each sent item shows where it is: **Queued on this device -> On the relay -> On your Daylight -> In your Reader**, or **Waiting for a tap on your Daylight**. The sender shows when the Daylight last checked in. A failure names its cause in one sentence and offers Retry. Today's apps already show Sent / Delivered / Not delivered; this adds the Reader hand-off, the waiting state and last-seen.

**Who does it best.** Nobody does all of it. LocalSend (accept/reject, SHA-256 check, Retry since 1.15.4), Tailscale Taildrop (progress counted from bytes the receiver confirmed, "reportedly offline; trying anyway"), Chrome Send-tab-to-self (received and opened timestamps back to the sender). Amazon's email route has none.

**Evidence people want it.**

- "The file shows up in downloads, but there is no notification." ([tailscale/tailscale#8626](https://github.com/tailscale/tailscale/issues/8626))
- "Immich should not claim the upload succeeded when it actually didn't." ([immich-app/immich#2531](https://github.com/immich-app/immich/issues/2531))

**Pitfalls.** "Accepted by the server" is not "delivered": Calibre's "Email successfully sent" means SMTP took it, and Amazon rejects later (E999) or silently degrades (E016). A presence flag must never block sending (Taildrop's flaky target list, #14393). Stale "Finished" screens swallowed the next share in LocalSend (#3197).

**Our design.**

- *DC-1 Inbox:* After each hand-off, add `x-handoff: {"<id>": "reader" | "tap" | "inbox" | "refused"}` to the next ack frame (ack frames already carry ids; receivers ignore unknown fields). Publish one more ack when a waiting item is tapped. "reader" only when the Reader confirmed the save (SAVE_PAGE returns saved/duplicate); documents report "handed" because the Reader does not confirm imports yet.
- *iPhone, iPad, Mac, Android phone, Windows:* History rows show the step line in words plus a glyph, never by colour alone. Header: "Your Daylight checked in 4 min ago" from the newest ack or hello (F17). Failure sentences come from the v1.1 error codes (network, full, refused, too big).
- *Chrome, Safari, Web sender:* Same rows in the popup and page; the toolbar badge keeps ... / check / ! and gains a "waiting for a tap" glyph.

<a id="f02"></a>
### 2. Big files through the Daylight server

`F02` · value **H** · effort **L** · needs **server** · **Next: needs the Daylight server** · Big files

**What it is.** A 100 MB textbook or scanned PDF just arrives, with a progress bar, resuming if the connection drops. Today ntfy.sh caps attachments at 2 MB, so items over 9 MB cannot be sent at all.

**Who does it best.** reMarkable, Boox and Supernote move big PDFs through their own clouds; Send to Kindle's web/app route claims 200 MB.

**Evidence people want it.**

- "Lost about two hours to a failed copy" ([localsend/localsend#443](https://github.com/localsend/localsend/issues/443))
- "I do not want to use the subscription or the RM cloud ... a lot of manual steps (downloading of the paper, resizing using ghostscript, etc.)" ([GjjvdBurg/paper2remarkable#142](https://github.com/GjjvdBurg/paper2remarkable/issues/142))

**Pitfalls.** ntfy.sh: 2 MB per attachment, 20 MB per sender, 250 messages and 200 MB a day (measured, share/NTFY-FACTS.md). Amazon fails at ~98-134 MB despite its 200 MB claim (E999). Chrome kills an extension service worker when a fetch takes over 30 s. iOS share extensions have far less memory than apps.

**Our design.**

- *Server + all native senders:* As server/DESIGN.md section 6: the sender builds v1 frames with the pairing key (12 MiB chunks, up to 16), PUTs them to the Worker, then announces each with a small `Attach:` message on the inbox topic. Today's Inbox already downloads them. The server stores only ciphertext. iPhone uploads from file with a background URLSession; Chrome uploads from an extension page in chunks, not from the service worker. Until the server exists, Lab shows "Needs the Daylight server" (F00).

**What it would take.** Deploy the Worker with R2 (server/DESIGN.md section 6), confirm the `ntfy-attach` probe (an external Attach: URL is listed and kept 12 h), and add the hosted-upload client module to each sender. No protocol change.

<a id="f03"></a>
### 3. Send the page as you see it, and say when only a link came through

`F03` · value **H** · effort **S** · needs **companion-only** · **Lab wave 1** · Capture

**What it is.** The browser extensions and the iPhone Safari share already send the page's HTML. Lab adds: cleaning the captured HTML of scripts and form values before it leaves the device, and a one-line warning when a share from another app carried only a URL (so a paywalled article would arrive as a stub).

**Who does it best.** Readwise Reader's extension and iOS Safari share ("the most robust way to save"), Matter ("save behind paywalls"), Instapaper's bookmarklet.

**Evidence people want it.**

- "It handles paywalled articles better than any other extension I've tried." ([extensionauditor.com/scan/matter-knjbgabkeojmfdhindppcmh...](https://extensionauditor.com/scan/matter-knjbgabkeojmfdhindppcmhhfiembkeb)) *(search snippet)*
- "the most robust way to save" ([docs.readwise.io/reader/docs/saving-content](https://docs.readwise.io/reader/docs/saving-content))

**Pitfalls.** Apps such as NYT and Medium hand the share sheet only a URL, so the article arrives cut short (Readwise parsing FAQ). Server-side fetching cannot see logged-in pages (Karakeep's headless snapshots). A raw DOM can carry hidden tokens and account names.

**Our design.**

- *Chrome, Safari:* Keep rendered capture as the default. Before sealing, strip `<script>` (except `application/ld+json`), `on*` attributes, `<input>`/`<textarea>` values and hidden form fields.
- *iPhone, iPad:* GetPage.js already returns the HTML from Safari; apply the same cleaning there. When the share has only a URL, show "Only the link came through. If this needs your login, open it in Safari and share from there." with an Open in Safari button.
- *Android phone:* Chrome shares only title + URL. Show the same hint once per domain, pointing to the extension on a computer or Safari on iPhone for logged-in pages.
- *DC-1 Inbox:* Each row says "Page as you saw it" or "Link (the Reader downloads it)".

<a id="f04"></a>
### 4. Share in place: done in a second, never opens the app

`F04` · value **H** · effort **M** · needs **companion-only** · **Lab wave 1** · Capture

**What it is.** Tapping Daylight in a share sheet confirms at once and returns you to what you were reading; the outbox and the operating system finish the upload. Quick Send is the default; an Options button, shown for 1.5 s, opens send-as, note and destination choices (F10, F12).

**Who does it best.** Pocket's toast, GoodLinks' Quick Save, Zotero's iOS share extension.

**Evidence people want it.**

- "I mean my point of hoarding is to read it later - seeing the app is unnecessary." ([karakeep-app/karakeep#237](https://github.com/karakeep-app/karakeep/issues/237))
- "Still very relevant in 2026 — sharing from the Android share sheet still launches the full Karakeep app." ([karakeep-app/karakeep#237](https://github.com/karakeep-app/karakeep/issues/237))

**Pitfalls.** Karakeep's cross-platform share library left the host app frozen on iOS 26 (#3018). Apple: extensions are terminated aggressively and get much less memory than apps, so a big PDF must never be loaded whole in the extension.

**Our design.**

- *iPhone, iPad, Mac:* The share extension encrypts file-to-file into the App Group outbox, starts background URLSession upload tasks (sharedContainerIdentifier), shows "Sending to <Daylight>" with Options for 1.5 s, then closes. Delivery shows later in the app and as a notification. Ad-hoc Mac builds keep their own outbox, as today.
- *Android phone:* Translucent share activity; enqueue an expedited WorkManager job and finish within a second; the card says "Queued for <Daylight>" with an Options chip.
- *Chrome, Safari:* Toolbar click already sends. The popup shows status and never blocks the send.

<a id="f05"></a>
### 5. Notes come home automatically

`F05` · value **H** · effort **L** · needs **reader-change** · **Next: needs a Reader change** · Round trip

**What it is.** Without opening a share sheet, what you marked on the Daylight shows up in the companion apps (and from there in Obsidian, Readwise or a folder): text, note, page or position, the surrounding sentence, and a link that reopens the exact spot in the Reader.

**Who does it best.** Kindle Scribe (export to Drive/OneDrive/OneNote), Readwise's exporters, KOReader's highlight exporter, InstaKobo.

**Evidence people want it.**

- "This would make annotations much more valuable as they are no longer isolated to one system." ([stelzch/zotero.koplugin#13](https://github.com/stelzch/zotero.koplugin/issues/13))
- "if we could sync via any of those APIs and sync read/unread/starred status bidirectionally then I'd die a happy man." ([koreader/koreader#9937](https://github.com/koreader/koreader/issues/9937))

**Pitfalls.** Kindle's export hid or truncated 1,038 of 2,733 highlights; Kobo exports came out of order; Boox's export cannot find the highlight again; Readwise's Obsidian plugin duplicates highlights (#84); a Supernote plugin trusted device-supplied paths (path traversal CVE).

**Our design.**

- *Reader, Inbox, companions:* The Reader keeps highlights with stable ids and emits debounced change batches (on document close and screen-off) to the Inbox; the Inbox sends them on the return topic (F06); companions merge by id with tombstones and order by position in the document.

**What it would take.** Reader: a highlight table with stable ids and an export event (broadcast to com.daylight.share with the batch as a content:// URI), Markdown/JSON format with anchors, and a `daylightreader://open?item=&loc=` deep link. Builds on F06's return topic.

<a id="f06"></a>
### 6. Send back from the DC-1 to my phone or Mac

`F06` · value **H** · effort **M** · needs **companion+inbox** · **Lab wave 2** · Round trip

**What it is.** Anything the Reader (or any app on the DC-1) shares can go back: the Reader's share menu already offers the PDF with ink, a flattened PDF, the original and notes as Markdown (per the Reader's DECISIONS.md as read by the e-ink researcher; verify on Rooted 2). The companions show it under **From your Daylight** with Open, Save and Share.

**Who does it best.** reMarkable (send by email, cloud), Kindle Scribe (notebook export by email), Kobo (notebooks to email or Dropbox).

**Evidence people want it.**

- "a huge shortcoming of the ReMarkable ecosystem" ([remailable/remailable](https://github.com/remailable/remailable))
- "annotation export format is unusable for getting back to the highlighted location in another app" ([christiantietze.de/posts/2023/05/boox-neoreader-annota...](https://christiantietze.de/posts/2023/05/boox-neoreader-annotation-export-is-meh/)) *(relayed, not opened)*

**Pitfalls.** The same 9 MB relay limit applies in this direction. Two directions on one pairing can confuse; label them clearly. File names from the tablet are untrusted input (Supernote CVE).

**Our design.**

- *DC-1 Inbox:* In the Inbox role the app's share target (an activity-alias) is labelled "Send to my phone or Mac"; in the phone role it stays "Send to Daylight". It builds ordinary frames on a new return topic and AAD derived from the secret (label `dlshare/v1/return`), with the usual outbox, re-sends and 9 MB limit; optional `x-to` names one device.
- *iPhone, iPad, Mac, Android phone, Windows:* Poll the return topic with the ack-topic rules (on launch, background refresh, the existing timers); store items under From your Daylight; ack on a return-ack topic; notify "From your Daylight: <name>". Save to Files or a chosen Mac folder (F38).
- *Chrome, Safari, Web sender:* A From your Daylight list in the popup or page with Download.

<a id="f07"></a>
### 7. Offline-first outbox

`F07` · value **H** · effort **M** · needs **companion-only** · **Lab wave 1** · Delivery

**What it is.** Today an offline send ends as "Not delivered" until a retry. Lab makes offline a normal state: the item waits, says so, and leaves when a connection appears, including from the background where the OS allows.

**Who does it best.** Instapaper ("rock solid for offline reading"), Wallabako (syncs when Wi-Fi turns on); requested and not shipped in Karakeep.

**Evidence people want it.**

- "I was just on a flight and disappointed this wasn't already a thing." ([karakeep-app/karakeep#2401](https://github.com/karakeep-app/karakeep/issues/2401))
- "just kind of... spins... and tries to connect" ([karakeep-app/karakeep#2401](https://github.com/karakeep-app/karakeep/issues/2401))

**Pitfalls.** Immich uploaded only in the foreground and called it "working as expected" (#30391). Android user-initiated jobs can be killed from Task Manager without onStopJob.

**Our design.**

- *iPhone, iPad:* NWPathMonitor sets the state; background URLSession tasks wait for connectivity on their own; BGAppRefresh and launch re-check.
- *Android phone:* WorkManager with a network constraint; the queue screen lists waiting items.
- *Mac, Windows:* NWPathMonitor / OS network events while the app runs.
- *Chrome, Safari, Web sender:* `navigator.onLine` plus the `online` event; chrome.alarms; the web sender sends on next open.

<a id="f08"></a>
### 8. Your Daylight in the share sheet's top row

`F08` · value **H** · effort **S** · needs **companion-only** · **Lab wave 1** · Capture

**What it is.** "Anjan's Daylight" shows in the top row of Android's share sheet. iPhone, Mac and Windows already name the Daylight in their share entries; Lab keeps those names current.

**Who does it best.** Pushbullet (historically); Android's Sharing Shortcuts API is the supported route.

**Evidence people want it.**

- "It'd be nice if I could have the favorites show up directly in the share sheet, and be able to one click share without needing to swap apps and confirm send etc." ([localsend/localsend#3014](https://github.com/localsend/localsend/issues/3014))

**Pitfalls.** Android: shortcuts need categories and setLongLived(true), go stale after 30 days without use, and a tap must act directly with no disambiguation screen.

**Our design.**

- *Android phone:* ShortcutManagerCompat.pushDynamicShortcut with a share-target category, long-lived, labelled with the Daylight's name; re-pushed on every send; removed on unpair.
- *iPhone, iPad, Mac, Windows:* Share entries show the paired Daylight's name (from the pairing link's `n`).

<a id="f09"></a>
### 9. Automation: Shortcuts, Siri, URL scheme, Android intent, command line

`F09` · value **H** · effort **M** · needs **companion-only** · **Lab wave 1** · Automation

**What it is.** Other apps, launchers and scripts can send: iOS/macOS Shortcuts and Siri (and so the Action button and Back Tap), `daylightshare://send?url=...`, an Android intent, and `daylight-send` on any computer.

**Who does it best.** GoodLinks (Shortcuts, URL scheme with quick=1, CLI and MCP in 4.1), Readwise CLI (`--json`, read-only mode), Taildrop Shortcuts, LocalSend CLI.

**Evidence people want it.**

- "made tailscale on iOS so much more powerful" ([tailscale/tailscale#2504](https://github.com/tailscale/tailscale/issues/2504))
- "When adding a URL to Omnivore using Shortcuts; there is no return value." ([omnivore-app/omnivore#3898](https://github.com/omnivore-app/omnivore/issues/3898))

**Pitfalls.** A Taildrop Shortcut reported success while delivering 0-byte files (#18537). A URL scheme that sends silently lets any web page push items to your Daylight. Vendor APIs die with the vendor (Pocket).

**Our design.**

- *iPhone, iPad, Mac:* App Intents: Send link (URL, title), Send text, Send file, Send clipboard; each returns a Delivery entity {id, status}; Get delivery status (id). AppShortcutsProvider phrase "Send this to Daylight". Docs show Action button and Back Tap setups.
- *All native apps:* `daylightshare://send?url=&title=` opens a confirmation sheet; `quick=1` skips it only when the user turned on "Allow quick sends from other apps".
- *Android phone:* Explicit intent `com.daylight.share.action.SEND_URL` (EXTRA_TEXT, EXTRA_TITLE) for Tasker and automation apps, behind the same setting.
- *Mac, Windows, Linux:* Publish the command-line sender used in DEVICE-CHECKS as `daylight-send` (share/js): `daylight-send <url|file> [--json] [--wait]`, pairing from a file or environment variable.
- *Web sender:* The existing `?url=&autosend=1` and fragment forms, plus a bookmarklet generator in Settings. One doc, docs/SEND-API.md, lists every entry point.

<a id="f10"></a>
### 10. Send as: page, clean article, link or selection, with a thin-content check

`F10` · value **H** · effort **M** · needs **companion-only** · **Lab wave 1** · Capture

**What it is.** Choose how it arrives: **Page as you see it** (default), **Clean article** (Readability run on the device), **Link only** or **Selection** (F11). The default follows the context: selected text, then a PDF tab, then the page. A check warns "This page looks thin (90 words). Send the full page instead?" An optional Review step shows a grayscale preview with word count, estimated size and an editable title.

**Who does it best.** Obsidian Web Clipper (selection > highlights > template > article), Evernote's clip types, Read on reMarkable (article vs PDF).

**Evidence people want it.**

- "Note in Obsidian is empty at all of our local newspaper articles" ([obsidianmd/obsidian-clipper#484](https://github.com/obsidianmd/obsidian-clipper/issues/484))
- "best parser and typography I've seen among many read-later apps" ([news.ycombinator.com/item](https://news.ycombinator.com/item?id=37890742)) *(search snippet)*

**Pitfalls.** Extractors can be "overly conservative" (Obsidian docs) and fail silently. A forced preview slows every send, so it stays optional. Server-side Readability does not fit the Worker's free 10 ms CPU (measured 40-526 ms), so extraction runs on the device.

**Our design.**

- *Chrome, Safari:* Popup segmented control; Mozilla Readability (Apache-2.0) bundled and run in the tab; clean article sent as a `page` with `<base href>`; choice remembered per site; Review opens an extension page.
- *iPhone, iPad:* Options in the share extension offers the same choices for Safari pages; GetPage.js also returns Readability's output and word count.
- *Reader check:* Find out whether the Reader runs its own extraction on SAVE_PAGE HTML. If it does, Clean article mainly serves the preview and smaller pages, and Page stays the default.

<a id="f11"></a>
### 11. Send a selection as an excerpt

`F11` · value **H** · effort **S** · needs **companion+inbox** · **Lab wave 1** · Capture

**What it is.** Select a passage and send just that: it arrives as a short document with the quote, the source title and link, the date and an optional note, instead of the whole article.

**Who does it best.** Obsidian Web Clipper (selection wins), Omnivore (highlight from a website), Fabric (share highlighted text).

**Evidence people want it.**

- "Would love to help testing as this is my exact workflow." ([omnivore-app/omnivore#2817](https://github.com/omnivore-app/omnivore/issues/2817))
- "share text on phone, open file, copy to clipboard has 200% more steps than share text" ([tailscale/tailscale#4896](https://github.com/tailscale/tailscale/issues/4896))

**Pitfalls.** Taildrop and LocalSend turned shared text into .txt and .url files the user has to open (#4896, LocalSend #462). Safari's extension lacks a selection context menu in some clippers (Obsidian #850).

**Our design.**

- *Chrome, Safari:* Context menu "Send selection to Daylight" and the Selection mode: sanitised HTML (allow-listed formatting tags), sent as `page` with url = source URL plus a `#:~:text=` fragment of the first words, so it is distinct from the full article and points back to the spot.
- *iPhone, iPad, Mac:* Selected text shared from Safari carries the page URL -> the same excerpt page. Text with no URL (Notes, Books) -> a file `Note - <first words>.md`. Mac: Services menu entry.
- *Android phone:* PROCESS_TEXT "Send to Daylight" in the selection menu (F41) and text shares, same rule.
- *DC-1 Inbox:* The row title is the quote's first line.

<a id="f12"></a>
### 12. Note, tags and "read now / quietly / hold" at send time

`F12` · value **H** · effort **M** · needs **companion+inbox** · **Lab wave 2** · Organise

**What it is.** Add "for Friday's meeting", a tag, or choose Read now / Add quietly / Hold without leaving the source app. Quick Send stays one tap and remembers the last destination.

**Who does it best.** Readwise Reader's post-save bar (tags, document note, move to Later/Archive), Instapaper's save banner, Zotero's popup (tag autocomplete and note since June 2025).

**Evidence people want it.**

- "+1 When I save a lot of articles, later retrieval is faster when they are tagged at once." ([wallabag/android-app#675](https://github.com/wallabag/android-app/issues/675))
- "we should not have to leave the browser to add labels" ([omnivore-app/omnivore#2230](https://github.com/omnivore-app/omnivore/issues/2230))

**Pitfalls.** No way to create a new tag (Omnivore #2366); autocomplete that adds the suggestion and blocks new tags (Wallabagger #334); save buttons hidden behind the iOS keyboard (Obsidian #634); Kobo's Instapaper link silently drops tags; trailing spaces in tags (Readwise bug).

**Our design.**

- *Protocol:* Optional header fields `x-note` (up to 280 characters), `x-tags` (up to 8 of 40 characters), `x-dest` ("now" | "quiet" | "hold" | "stack"). Old Inboxes ignore them.
- *All senders:* The F04 Options window (and the extension popup's 1.5 s grace) holds the publish while the user types; Enter creates a new tag, suggestions are added only when chosen; last destination remembered.
- *DC-1 Inbox:* Shows note and tags on the row; filters by tag and by source device; for pages, inserts "Note from iPhone: ..." at the top of the HTML (setting, on by default). `now` hands over at once and opens documents even when Documents = Ask; `quiet` adds quietly; `hold` keeps the item in the Inbox (F40); `stack` goes to the morning stack (F14). Filing into Reader collections is a Reader change (section 4).

<a id="f13"></a>
### 13. Big files on the same Wi-Fi (direct, no server)

`F13` · value **H** · effort **L** · needs **companion+inbox** · **Lab wave 2** · Big files

**What it is.** The no-server answer to "big PDFs just arrive": the Inbox listens on the local network while it is open or Instant delivery is on; native senders upload frames directly and the Inbox acks over the relay as usual.

**Who does it best.** BooxDrop, Supernote Browse & Access, LocalSend, the KOReader LocalSend plugin (PIN, TLS, per-type folders).

**Evidence people want it.**

- "without a cloud service, internet connection, or cable" ([Toricicim/Boox-Send](https://github.com/Toricicim/Boox-Send))
- "Lost about two hours to a failed copy" ([localsend/localsend#443](https://github.com/localsend/localsend/issues/443))

**Pitfalls.** Discovery fails on campus and guest networks with client isolation (LocalSend #850: "my University WiFi doesn't allow device discovery"), Windows reserves ports (#125), Android pauses background servers. Browsers cannot reach a LAN http address from an https page.

**Our design.**

- *DC-1 Inbox:* While Lab is on, on Wi-Fi, and the Inbox is open or Instant delivery is on: listen on a port; put `ip:port` in the encrypted hello (F17); accept `PUT /dls/v1/frame` only for frames that decrypt with the pairing key (anything else 400, rate-limited); `GET /dls/v1/have?id=` lists parts held; ack over the relay.
- *iPhone, iPad, Mac, Android phone, Windows:* For files over 9 MB: if the hello's address is under 15 minutes old and `/dls/v1/ping` answers within 1 s, upload 12 MiB frames directly with progress and resume; otherwise say "Files over 9 MB need your Daylight on the same Wi-Fi (or the Daylight server)." iOS asks for Local Network access in context.
- *Chrome, Safari, Web sender:* Not possible (mixed content and private-network rules); same sentence.

<a id="f14"></a>
### 14. Morning stack: one issue with a contents page, never repeating

`F14` · value **H** · effort **L** · needs **companion+inbox** · **Lab wave 3** · Calm reading

**What it is.** Choose "Add to the morning stack" when sending (or make it the default for links). At 07:00, or when the DC-1 first wakes after it, the Inbox builds one document, a chapter per item, and hands it to the Reader. Send now at any time.

**Who does it best.** Instapaper's Kindle digests ("a personal newspaper with its own contents page"), Readwise Reader's daily/weekly Kindle delivery, Matter's bulk send as one ebook.

**Evidence people want it.**

- "I really love Instapaper and use it a lot. Especially the send to kindle feature" ([news.ycombinator.com/item](https://news.ycombinator.com/item?id=17706597)) *(search snippet)*
- "Same feature as with Instapaper. But it would be better if, Omnivore could convert docs to cleaner format and having the option to send either a compilations or a specific doc ... to Kindle." ([omnivore-app/omnivore#2142](https://github.com/omnivore-app/omnivore/issues/2142))

**Pitfalls.** Instapaper's digest "includes the same articles in the daily packages lots of times" (MobileRead); generation cost made Instapaper put Kindle sends behind Premium; an AI step that hit a quota silently stopped a DIY digest; some people want one file per article, not a compilation.

**Our design.**

- *Senders:* Destination "Morning stack" (`x-dest: "stack"`) and a default per app; the history row says "In tomorrow's stack (07:00)".
- *DC-1 Inbox:* Holds stack items; at the time builds an EPUB 3 (nav contents page, one XHTML chapter per item, scripts stripped, images fetched once and converted to grayscale JPEG up to 1600 px; a link-only item is fetched without cookies and simplified, or listed with title and URL if that fails). Name "Daylight stack - Tue 21 Oct". Hand over with ACTION_SEND; a ledger records every included id. Settings: time, days, maximum items (overflow waits for the next one), Send now, one file vs one item per article.

<a id="f15"></a>
### 15. Arrival notification with actions, and Inbox health

`F15` · value **H** · effort **S** · needs **companion+inbox** · **Lab wave 1** · Delivery

**What it is.** The Daylight tells you what just came and from where, and lets you act on it. A health line ("Last checked 2 min ago · Instant delivery on") explains delays before you wonder.

**Who does it best.** ntfy (priority channels, instant mode), Tailscale 1.104 (tap to open or copy), NearDrop.

**Evidence people want it.**

- "Airdrop on Apple does not need receiving device to be inside an app to receive." ([schlagmichdoch/PairDrop#479](https://github.com/schlagmichdoch/PairDrop/issues/479))
- "Add a `copy` action on notification" ([Martichou/rquickshare#182](https://github.com/Martichou/rquickshare/issues/182))

**Pitfalls.** No notification at all is Taildrop Android's top bug (#8626). Android 13's Task Manager lets users stop foreground services; battery savers kill listeners; auto-opening links without consent is unsafe (RQuickShare maintainer).

**Our design.**

- *DC-1 Inbox:* An "Arrivals" channel (quiet by default) with title, source device and app, and actions Open in Reader / Hold / Dismiss; quiet hours. Never opens anything by itself unless the item is Read now or Documents = Open as they arrive. A health card at the top of the Inbox, and a WorkManager check that notifies when the Instant delivery service was stopped. Lab Inbox screens use no animations and show states in words.

<a id="f16"></a>
### 16. Smart intake: unwrap Apple News, AMP, Substack and tracking links

`F16` · value **H** · effort **S** · needs **companion-only** · **Lab wave 1** · Capture

**What it is.** Shares from Apple News, Substack, AMP pages and apps that send "headline + link" as text arrive as the article itself. Tracking parameters are removed. The same canonical URL drives duplicate detection (F32).

**Who does it best.** Karakeep fixed the text-blob case in 2025; nobody examined handles the Substack referral overlay well.

**Evidence people want it.**

- "On iOS/iPadOS, sharing to Hoarder from Apple News, saves the headline and link to article as plain text." ([karakeep-app/karakeep#956](https://github.com/karakeep-app/karakeep/issues/956))
- "resolve the appropriate article URL before the initial crawler fetch" ([karakeep-app/karakeep#3134](https://github.com/karakeep-app/karakeep/issues/3134))

**Pitfalls.** Bad saves became permanent because links could not be edited (Karakeep #956). Canonicalising is brittle; never lowercase paths or reorder other parameters. The relay cannot fetch anything, so resolution happens on the sending device.

**Our design.**

- *share/js, Kotlin, Swift:* `normaliseShare(text, url?, subject?)`: prefer a typed URL attachment; otherwise the first http(s) URL in the text, with the rest as the title; drop utm_*, fbclid, gclid, mc_cid, mc_eid, igshid, and `r`/`si`-style referral parameters on known hosts; unwrap google.com/amp/s/, AMP caches and l.facebook.com redirects; resolve apple.news links with one request from the device; keep the original in `x-orig` when it changed. Vectors in `share/vectors/normalise.json`.

<a id="f17"></a>
### 17. Capability hello and version-skew safety

`F17` · value **H** · effort **S** · needs **companion+inbox** · **Lab wave 0** · Foundation

**What it is.** Every Lab feature is an `x-` field or a new derived topic that older apps ignore. The Inbox's hello tells senders which Lab features it understands, its last poll time and (F13) its LAN address. Senders show Inbox-dependent features with the "needs" sentence until they see it.

**Who does it best.** KDE Connect (versioned packet types), LocalSend (protocol version field).

**Evidence people want it.**

- "I can't pair any device." ([GSConnect/gnome-shell-extension-gsconnect#1932](https://github.com/GSConnect/gnome-shell-extension-gsconnect/issues/1932))
- "Fixes older devices being unable to add 1.18.0+ devices as favorites." ([localsend/localsend](https://github.com/localsend/localsend/releases))

**Pitfalls.** Silent protocol changes delivered by auto-update stranded KDE Connect users with no way to pair (63-comment thread).

**Our design.**

- *DC-1 Inbox:* Hello = an ack frame with `ids: []` and `x-inbox: {app, lab: true, caps: [...], lastPoll, lan?}` (the shape server/DESIGN.md 5.5 already uses), sent when Lab is turned on, at start, and with the 11-hourly ack digest.
- *All senders:* Cache caps per pairing; Inbox-dependent features say "Needs the Lab Inbox on your Daylight (update Daylight Share and turn Lab on)".
- *CI:* Version-skew suite: Lab and non-Lab senders (JS, Kotlin, Swift) against Lab and v1.1 Inboxes, for url, page and file items and acks.

<a id="f18"></a>
### 18. Opened, reading progress and finished, back on the phone

`F18` · value **H** · effort **M** · needs **reader-change** · **Next: needs a Reader change** · Round trip

**What it is.** After "In your Reader", the history row keeps going: Opened on Tue, 62% read, Finished. Optional "Continue on phone" opens the original near where you stopped.

**Who does it best.** KOReader sync (kosync), Kindle Whispersync, InstaKobo and kobodeck (read status written back), Chrome Send-tab-to-self (opened timestamps).

**Evidence people want it.**

- "I really only want the auto push, so I can spontaneously start reading on my phone" ([koreader/koreader#14527](https://github.com/koreader/koreader/issues/14527))
- "Read your Instapaper articles on Kobo, and sync reading progress and highlights back." ([voidberg/instakobo](https://github.com/voidberg/instakobo))

**Pitfalls.** KOSync's "newer" is by time, not position, so it can move you backwards (#16011); a retry queue dropped a 100% finished mark (#16104); Wi-Fi pop-ups blocked reading (#14527). Reading activity is personal: opt-in.

**Our design.**

- *Reader, Inbox, companions:* The Reader broadcasts opened / progress-at-close / finished with the Daylight Share item id (it needs to keep that id from the hand-off); the Inbox adds `x-reading` to acks; companions extend the F01 line. Throttled, opt-in, never wakes the radio.

**What it would take.** Reader: accept an item id extra on SAVE_PAGE/ACTION_SEND and keep it with the saved item; broadcast reading events to com.daylight.share. Inbox: relay them in acks.

<a id="f19"></a>
### 19. Email-in address for newsletters and documents

`F19` · value **H** · effort **L** · needs **server** · **Next: needs the Daylight server** · Sources

**What it is.** Subscribe newsletters to the address or forward any mail or PDF; it lands in the Reader. Separate "read" and "news" addresses as in Readwise Reader.

**Who does it best.** Readwise Reader (library@ and feed@ addresses), Instapaper, Matter, Kill the Newsletter.

**Evidence people want it.**

- "It would be nice if you just send an URL to your omnivore email that it would work just like adding an URL from the app." ([omnivore-app/omnivore#1829](https://github.com/omnivore-app/omnivore/issues/1829))
- "that would also be really incredible" (reader DECISIONS 27 (the user, relayed in research/raw/eink-tablets.md)) *(relayed, not opened)*

**Pitfalls.** Addresses derived from a username leak identity and attract spam (Omnivore #2198); confirmation mails, text-only newsletters and missing newlines break naive parsers; mail is plaintext to the server (not end-to-end encrypted); on Workers Free the email handler can exceed the 10 ms CPU limit.

**Our design.**

- *Server:* server/DESIGN.md section 7: `daylight-<10 chars>@<domain>`, Email Routing to the Worker, raw mail to R2, one parse per Cron run, delivered on the server lane to the Lab Inbox labelled "From your server". First use says it is not end-to-end encrypted.

**What it would take.** A domain on Cloudflare DNS, R2, and in practice Workers Paid for reliable parsing (followup-verify: free-plan handlers "may exceed these limits and fail").

<a id="f20"></a>
### 20. "On your Daylight": see and steer what waits in the Inbox

`F20` · value **M** · effort **M** · needs **companion+inbox** · **Lab wave 3** · Round trip

**What it is.** A view of what is waiting on the Daylight, managed from the phone. This covers the Inbox's own items; the Reader's library is F21 (Reader change).

**Who does it best.** Calibre-Web's Kobo shelves (web decides what is on the device), Readwise Reader locations; no product found that reorders a device's queue from a phone.

**Evidence people want it.**

- "Goes through your inbox one article at a time and says whether each is worth your time" ([readwiseio/readwise-skills](https://github.com/readwiseio/readwise-skills))
- "When I read a large article from random ones, and then it's difficult to find it to continue reading." ([wallabag/wallabag#8640](https://github.com/wallabag/wallabag/issues/8640))

**Pitfalls.** Calibre-Web: deleting in the web UI "will not cause it to be removed from the device"; commands reach a sleeping device only at its next check-in (ha-koreader); destructive actions need confirmation and undo.

**Our design.**

- *DC-1 Inbox:* After each change (debounced a minute) publish an encrypted manifest of held items (id, title, from, state, size) on a derived state topic; accept command frames (`send-now`, `to-stack`, `remove`) on a control topic, apply them idempotently by command id, ack them.
- *iPhone, iPad, Mac, Android phone, Chrome, Web sender:* An "On your Daylight" list with the actions and "applies when your Daylight next checks in".

<a id="f21"></a>
### 21. Manage the Reader's reading queue from the phone

`F21` · value **M** · effort **L** · needs **reader-change** · **Next: needs a Reader change** · Round trip

**What it is.** Like F20 but for the Reader's own read-later queue: pin "Read next", archive what you will not read, remove (with ink and highlights exported first).

**Who does it best.** Readwise Reader (new/later/shortlist/archive, scriptable), Endle/readwisereader for KOReader (finish -> archived; archived -> removed from device).

**Evidence people want it.**

- "Articles you mark as finished in KOReader are archived in Reader at the next sync" ([Endle/readwisereader](https://github.com/Endle/readwisereader))

**Pitfalls.** The wallabag KOReader plugin deletes articles that merely fall off its 30-item list; destructive steps must wait for an ack and land in a trash.

**Our design.**

- *Reader, Inbox, companions:* The Reader exposes its queue (read-only manifest) and accepts commands from the Inbox; archive keeps the file and ink; remove goes to a 30-day trash.

**What it would take.** Reader: a queue order field, an archive state, a trash, and a command intent the Inbox may call (signature-protected).

<a id="f22"></a>
### 22. Send several tabs or items as one issue

`F22` · value **M** · effort **M** · needs **companion-only** · **Lab wave 2** · Calm reading

**What it is.** Clear a window of tabs into one readable issue instead of N separate items.

**Who does it best.** Matter (bulk send merged into one ebook), TabTome (up to 25 tabs into one EPUB, per-tab results), SingleFile, MarkDownload.

**Evidence people want it.**

- "It would be great if one can also click the icon to select and save several articles in several tabs into Obsidian." ([obsidianmd/obsidian-clipper#83](https://github.com/obsidianmd/obsidian-clipper/issues/83))
- "merges the articles into an ebook, with each article as its own chapter" ([getmatter.com/updates/send-to-kindle](https://www.getmatter.com/updates/send-to-kindle)) *(search snippet)*

**Pitfalls.** One bad tab must not abort the batch; size cliffs (TabTome caps 18 MB, our relay 9 MB); needs host access to read many tabs.

**Our design.**

- *Chrome, Safari:* A checklist of the window's tabs (cross-domain allowed), each captured as page or clean article; an EPUB built in the extension (fflate zip, nav document); skipped tabs listed; estimate shown; over 9 MB offers "drop images" or "split into two".
- *Mac, Windows:* Multi-select of HTML/Markdown files: "one at a time" (default) or "as one issue".

<a id="f23"></a>
### 23. PDFs stay PDFs, and "Print to Daylight" from any app

`F23` · value **M** · effort **M** · needs **companion-only** · **Lab wave 2** · Documents

**What it is.** Any app that can print can send: Print > PDF > Send to Daylight on the Mac, a "Daylight" printer on Android. PDFs always arrive byte-identical with layout intact.

**Who does it best.** KindBeamer (Print -> KindBeamer on Android, keep-layout default), Read on reMarkable (print destination).

**Evidence people want it.**

- "PDFs arrive as PDFs unless the user asks for conversion" ([bookorbit/bookorbit#1442](https://github.com/bookorbit/bookorbit/issues/1442))
- "breaks PDF's ... throwing out images and formatting" ([bookorbit/bookorbit#1205](https://github.com/bookorbit/bookorbit/issues/1205))

**Pitfalls.** Amazon's "convert" subject line destroys figures; macOS PDF Services needs care with the sandbox; Android print plumbing is fiddly.

**Our design.**

- *Mac:* Install a PDF Service ("Send to Daylight" in every Print dialog's PDF menu) that hands the PDF to the app.
- *Android phone:* A PrintService named after the Daylight that writes the PDF and sends it.
- *iPhone, iPad:* A Lab tip: Print > pinch out the preview > Share > Daylight (works today).
- *DC-1 Inbox:* Shows page count and size for documents.

<a id="f24"></a>
### 24. Image diet: self-contained pages tuned for grayscale

`F24` · value **M** · effort **M** · needs **companion-only** · **Lab wave 2** · Capture

**What it is.** Pages arrive complete, with images that work on the DC-1 and without making the item too big for the relay.

**Who does it best.** kindle-send-chrome (WebP/AVIF to JPEG, 1600 px cap, q 0.75), KindBeamer, TabTome (no-images mode).

**Evidence people want it.**

- "converts WebP and AVIF to JPEG, because ... Kindle's converter can't render WebP" ([manabubannai/kindle-send-chrome](https://github.com/manabubannai/kindle-send-chrome))
- "related to the image sizes, so we need to resizing them for Kindle." ([input-output-hk/mastering-cardano#47](https://github.com/input-output-hk/mastering-cardano/issues/47))

**Pitfalls.** Over-compression ruins diagrams; fetching cross-site images needs host permission (the "read all your data" warning); hotlink-protected images fail; the Reader caps page HTML at 8 MiB.

**Our design.**

- *Chrome, Safari, iPhone, iPad:* In the page: resolve `data-src`, `srcset`, `<picture>`; fetch same-origin and CORS images, leave others as remote links unless the optional host permission was granted; re-encode to JPEG (q 0.75, 1600 px) or PNG for line art; grayscale on by default; inline as data: URIs within a 6 MB budget, then drop the largest with a closing note "3 images left out to fit". Setting: Optimised for Daylight / Original / No images.
- *Reader check:* Confirm the Reader shows data: URI images in saved pages.

<a id="f25"></a>
### 25. Read-later connectors pulled by the Inbox

`F25` · value **M** · effort **M** · needs **companion+inbox** · **Lab wave 3** · Sources

**What it is.** Keep using the read-later app you like; tag an article "daylight" there and it lands in the Reader.

**Who does it best.** Kobo's built-in Instapaper link (code/QR pairing), InstaKobo, readeck.koplugin, Endle/readwisereader.

**Evidence people want it.**

- "one of the selling points for Kobo ereaders" ([blog.the-ebook-reader.com/2025/07/12/pocket-support-has-ended...](https://blog.the-ebook-reader.com/2025/07/12/pocket-support-has-ended-on-kobos-without-any-alternatives/)) *(relayed, not opened)*
- "Read your Instapaper articles on Kobo, and sync reading progress and highlights back." ([voidberg/instakobo](https://github.com/voidberg/instakobo))

**Pitfalls.** Kobo's integration syncs only the main list (no tags, highlights, PDFs); APIs die (Pocket's API ended in 2025) or cap results (Instapaper 500); tokens stored in plaintext (omnivore-epub).

**Our design.**

- *DC-1 Inbox:* Sources > Instapaper (API v2 personal token), Readwise Reader (token), Readeck (URL + token): "all unread" or "tagged daylight"; hourly on Wi-Fi plus Check now; items go to the Reader as url (or page when the API returns HTML); ids remembered; optional "archive there once handed over". Token kept with Android Keystore encryption; the screen says this path talks to the service directly.
- *iPhone, Mac:* Paste a token on the phone; it travels to the Inbox in an encrypted control frame, so nobody types it on the tablet.

<a id="f26"></a>
### 26. Setup coach, test send and diagnostics

`F26` · value **M** · effort **S** · needs **companion-only** · **Lab wave 1** · Trust

**What it is.** Gets the share item, extensions and Inbox permissions working on day one, and lets a user hand a useful log to a bug report.

**Who does it best.** Instapaper's and GoodLinks' setup help (share sheet "More", disappearing Safari extension), NetNewsWire 7.1's Activity Log and Account Stats.

**Evidence people want it.**

- "Added Activity Log to Settings. It shows what the app has been doing" ([Ranchero-Software/NetNewsWire](https://github.com/Ranchero-Software/NetNewsWire/releases?page=4))
- "there's no visual indication/change that it has worked" ([obsidianmd/obsidian-clipper#744](https://github.com/obsidianmd/obsidian-clipper/issues/744))

**Pitfalls.** Share extensions vanish silently (GoodLinks' fix needs Terminal; Readwise's needs a restart). Logs must never contain URLs, titles, codes or topic names (Firefox treats URLs as personal data).

**Our design.**

- *iPhone, iPad:* Checklist: paired, share item used at least once (else steps for More), Safari extension (steps; iOS cannot detect it), notifications.
- *Mac:* Share extension and Safari extension state (the app already reads the Safari one), login item.
- *Android phone:* Notifications, battery optimisation.
- *DC-1 Inbox:* Notifications, Display over other apps, battery optimisation, Instant delivery, Reader installed and SAVE_PAGE accepted.
- *Chrome, Safari, Web sender:* Pinned button, shortcut set, site access.
- *All:* "Send a test article" sends a bundled sample page and shows it walk the F01 timeline; Activity log of the last 200 events; Copy diagnostics redacts URLs, titles, codes and topics.

<a id="f27"></a>
### 27. Accessibility baseline, plus a Lab comfort mode

`F27` · value **H** · effort **M** · needs **companion-only** · **Lab wave 0** · Trust

**What it is.** The baseline is not a Lab feature: it ships with Lab off too. Lab adds extras: larger type and targets, higher contrast, reduced motion, and a preview of how an item will look on the DC-1's grayscale screen.

**Who does it best.** Apple HIG and Android accessibility guidance; Thorium Reader for blind and low-vision reading.

**Evidence people want it.**

- "on black-and-white e-ink, a red wash and a gray wash look identical" ([readest/readest#6048](https://github.com/readest/readest/issues/6048))
- "find on average 57% of WCAG issues automatically" ([dequelabs/axe-core](https://github.com/dequelabs/axe-core))

**Pitfalls.** QR-only pairing excludes blind users; auto-dismissing toasts exclude slow readers; colour-only states fail on grayscale; automated checks catch about half the issues.

**Our design.**

- *All apps (baseline):* Labels on every control; Dynamic Type / font scale to 200% without truncating states; live-region announcements for state changes; typed-code pairing always available; status in words and glyphs.
- *All apps (Lab):* Comfort preset toggle; grayscale preview of a page before sending (extension Review, iPhone Options).

<a id="f28"></a>
### 28. YouTube videos as readable transcripts

`F28` · value **M** · effort **M** · needs **companion-only** · **Lab wave 3** · Capture

**What it is.** A video becomes something to read on a grayscale tablet: title, channel, chapters as headings, paragraphs every ~30 s with a timestamp link back to that moment.

**Who does it best.** Readwise Reader (transcript under the video, chapters since Oct 2026), Obsidian Web Clipper (interactive transcript since 1.4.0).

**Evidence people want it.**

- "interactive transcript, scrubbing, and auto-scroll" ([obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper/releases))
- "like Reader for YouTube" ([gummysearch.com/r/readwise](https://gummysearch.com/r/readwise)) *(search snippet)*

**Pitfalls.** Transcripts saved in the wrong language when an auto-dubbed track exists (Obsidian #957, English share jumped to 54%); timestamps as dead text (#785); YouTube page changes break extractors.

**Our design.**

- *Chrome, Safari:* Read the caption track list from the page's player response; prefer the original-language manual track, then original-language auto captions, never translated or dubbed tracks; fetch the timed text in the page; build the article; offer "No transcript available; send the link instead?" when there is none.

<a id="f29"></a>
### 29. Mac power moves

`F29` · value **M** · effort **M** · needs **companion-only** · **Lab wave 2** · Capture

**What it is.** Send from wherever you are on the Mac without opening the window.

**Who does it best.** KindBeamer (keyboard-first window, Services, Finder Open With, CLI), Boox-Send (Finder Quick Action), Booxidian (watched folder with hash dedupe).

**Evidence people want it.**

- "Pressing Enter usually sends" ([jooray/kindbeamer](https://github.com/jooray/kindbeamer))
- "Everything is deduplicated by content hash, so re-scanning a folder never creates duplicates" ([webline/onyx-boox-sync](https://github.com/webline/onyx-boox-sync))

**Pitfalls.** Watched folders need sandbox bookmarks and dedupe; unnotarised apps need "Open Anyway"; Apple Events to browsers need the Automation permission, asked only on first use.

**Our design.**

- *Mac:* Menu-bar item accepts dropped files and links; FSEvents watch on ~/Daylight/Send (moved to Sent/ after Delivered; SHA-256 dedupe); Services "Send to Daylight" for text, URLs and files; Finder Quick Action; "Send front Safari/Chrome tab" (Automation permission on first use); configurable global hotkey (the clipboard link already has one).
- *Windows:* Already has Send to and a hotkey; add the watched folder.

<a id="f30"></a>
### 30. Scan paper to a clean PDF

`F30` · value **M** · effort **M** · needs **companion-only** · **Lab wave 2** · Documents

**What it is.** Handouts, letters and book pages to the DC-1, where the pen can mark them up.

**Who does it best.** Apple's VisionKit scanner, Google ML Kit Document Scanner, dedicated scanner apps.

**Evidence people want it.**

- "Most scans lack contrast and look blurry in comparison with most "scanner" apps." ([astubenbord/paperless-mobile#322](https://github.com/astubenbord/paperless-mobile/issues/322))

**Pitfalls.** Over-compressed scans break OCR and look blurry (same thread); users are happy to scan elsewhere and share, so sharing a PDF from any scanner app must keep working.

**Our design.**

- *iPhone, iPad:* VNDocumentCameraViewController -> grayscale/contrast filter -> PDFKit -> send as a file; optional text layer (F61).
- *Android phone:* ML Kit Document Scanner (Google Play services) -> filter -> PDF -> send.

<a id="f31"></a>
### 31. Chrome Reading List to Daylight

`F31` · value **M** · effort **S** · needs **companion-only** · **Lab wave 2** · Sources

**What it is.** Save to Chrome's Reading List on any device; it shows up on the Daylight while a desktop Chrome with the extension runs.

**Who does it best.** No product found; the stable `chrome.readingList` API (MV3) makes it possible.

**Evidence people want it.**

- "Can we add Read Later smart feed?" ([Ranchero-Software/NetNewsWire#3023](https://github.com/Ranchero-Software/NetNewsWire/issues/3023))

**Pitfalls.** Chrome-only; needs a running desktop browser; must not repeat entries or flood the 250-messages-a-day relay budget.

**Our design.**

- *Chrome:* Optional `readingList` permission; on enabling, choose "only new" or "also the N unread ones"; onEntryAdded -> send as a link (at most 30 an hour); on Delivered, `updateEntry({hasBeenRead: true})` (setting); a local ledger by canonical URL (F16).

<a id="f32"></a>
### 32. "Already sent" notice and duplicate guard

`F32` · value **M** · effort **S** · needs **companion-only** · **Lab wave 2** · Organise

**What it is.** Avoid filling the Reader with the same article twice, without telling any server what you browse.

**Who does it best.** Karakeep (opt-in badge from a local cache, Nov 2025), Raindrop (checkmark).

**Evidence people want it.**

- "cannot quickly determine if the page you are currently on is already hoarded" ([karakeep-app/karakeep#486](https://github.com/karakeep-app/karakeep/issues/486))
- Omnivore #2747 (13 thumbs-up) asks the extension to show that a page is already saved ([omnivore-app/omnivore#2747](https://github.com/omnivore-app/omnivore/issues/2747))

**Pitfalls.** Per-page server lookups leak browsing history; canonicalisation false positives must never block a resend.

**Our design.**

- *All senders:* History keyed by the F16 canonical URL and by SHA-256 for files; extension badge check on a page sent before (opt-in); the share sheet and popup show the notice with Send again; "Remember what I sent" can be turned off.

<a id="f33"></a>
### 33. Send the copied link

`F33` · value **M** · effort **S** · needs **companion-only** · **Lab wave 1** · Capture

**What it is.** The fastest path from "I copied a link" to "it is on my Daylight".

**Who does it best.** Karakeep 0.33 (Clipboard entry in one tap), GoodLinks (quick=1), our Mac and Windows apps (hotkeys).

**Evidence people want it.**

- "saves clipboard contents in a single tap" ([karakeep-app/karakeep](https://github.com/karakeep-app/karakeep/releases/tag/v0.33.1))

**Pitfalls.** iOS shows a paste alert when an app reads another app's clipboard; Android 12+ shows a toast; stale clipboard content is a privacy risk.

**Our design.**

- *iPhone, iPad:* On foreground, `UIPasteboard.hasURLs` (no alert) shows a chip; the content is read through a PasteButton tap only.
- *Android phone:* Check only the ClipDescription on resume (no toast); read on tap.
- *Mac, Windows:* Already present (hotkey); Lab adds the chip in the window.
- *Web sender, Chrome, Safari:* A "Paste and send" button that reads the clipboard on click.

<a id="f34"></a>
### 34. Full browser context menu and keyboard shortcuts

`F34` · value **M** · effort **S** · needs **companion-only** · **Lab wave 1** · Capture

**What it is.** Send exactly what you mean from wherever you right-click or type.

**Who does it best.** MarkDownload (tab, selection, all tabs, link and image as Markdown), SingleFile, Readwise (Alt+R), Chrome's own "Send to your devices" omnibox entry.

**Evidence people want it.**

- "the simplest way to save with the extension is with the keyboard shortcut" ([omnivore-app/omnivore#3143](https://github.com/omnivore-app/omnivore/issues/3143))
- Karakeep #1174: right-clicking an image saved only the image, and "the larger context ... is lost" ([karakeep-app/karakeep#1174](https://github.com/karakeep-app/karakeep/issues/1174))

**Pitfalls.** Shortcut clashes (Instapaper's Ctrl+I vs italics); Safari cannot rebind shortcuts; users want to hide menus (Obsidian #271).

**Our design.**

- *Chrome, Safari:* Menus: Send page / Send clean article / Send link / Send selection / Send this image's page (the page, not the image). `commands`: Alt+Shift+D (exists) and Alt+Shift+S for the selection; others unset by default. Setting to hide entries. Chrome omnibox keyword "dl" sends a typed URL. Safari: mode buttons in the popup instead of rebinding.

<a id="f35"></a>
### 35. RSS feeds checked by the Inbox

`F35` · value **M** · effort **M** · needs **companion+inbox** · **Lab wave 3** · Sources

**What it is.** Follow a handful of blogs on the Daylight without a server: the tablet fetches feeds itself, as KOReader's News Downloader does.

**Who does it best.** KOReader News Downloader (per-feed limit, full text, images, filter element), Readwise Reader's Feed (suggested feeds from saved pages, OPML), Feeder (per-feed filter rules).

**Evidence people want it.**

- "One of the biggest things that I use is RSS." ([karakeep-app/karakeep#202](https://github.com/karakeep-app/karakeep/issues/202))
- "Went from 100% to 54% from 7pm to 3:30pm next day" ([koreader/koreader#14537](https://github.com/koreader/koreader/issues/14537))

**Pitfalls.** Battery drain from radios left on (the quote above); feed parsing failures (.rdf, WordPress) and crashes on low-RAM devices; firehose overload; first subscribe flooding the queue.

**Our design.**

- *DC-1 Inbox:* Sources > Feeds: per feed, "each post as a link" or "into the morning stack", a daily cap (default 3), mute words; hourly WorkManager job on unmetered Wi-Fi with conditional GET; first subscription seeds without delivering.
- *Chrome, Safari:* "Subscribe on Daylight" when the page has `<link rel="alternate" type="application/rss+xml">`, sent as an encrypted control frame.
- *Mac, Web sender:* OPML import.

<a id="f36"></a>
### 36. Server feeds and digests while the tablet sleeps

`F36` · value **M** · effort **M** · needs **server** · **Next: needs the Daylight server** · Sources

**What it is.** Like F35 and F14 but independent of the tablet being awake, for many feeds.

**Who does it best.** KindleEar (1,000+ recipes), Calibre news recipes, Readwise Reader's Feed.

**Evidence people want it.**

- "Your computer needs to be on for this job to run" ([jstriblet/Reddit-to-Kindle](https://github.com/jstriblet/Reddit-to-Kindle))

**Pitfalls.** Readability and EPUB building do not fit the Worker's free 10 ms CPU (measured), so the server sends links or pre-made pages only; recipe/scraper maintenance never ends.

**Our design.**

- *Server:* server/DESIGN.md section 8: feeds in D1, hourly Cron, each post as a `url` item or one daily digest page; the Lab Inbox reads the server lane.

**What it would take.** Deploy the Worker (Cloudflare secrets); full-text extraction would need Workers Paid.

<a id="f37"></a>
### 37. AI summary, "explain this", ask and translate (Claude)

`F37` · value **M** · effort **M** · needs **server** · **Next: needs the Daylight server** · AI

**What it is.** Summaries as the Inbox preview line, "explain this" and translation of foreign-language articles. Off until the key exists; content leaves end-to-end encryption, and the app says so the first time.

**Who does it best.** Readwise Ghostreader (auto-summary and tags, document chat), KindleEar 3.2 (AI summaries, translation).

**Evidence people want it.**

- "low-friction, local, privacy-preserving" ([Ranchero-Software/NetNewsWire#4665](https://github.com/Ranchero-Software/NetNewsWire/issues/4665))
- "A single run could exhaust the subscription's usage window" ([taruncherukurigit/kindle-daily-digest](https://github.com/taruncherukurigit/kindle-daily-digest))

**Pitfalls.** A DIY digest silently failed when its AI step hit a cap: delivery must never wait on AI. Summaries hallucinate; label them as generated.

**Our design.**

- *Server, apps:* server/DESIGN.md section 9: `POST /v1/ai` with ops, the user's ANTHROPIC_API_KEY as a Worker secret, cost ceilings. Lab shows the controls with "Needs a Claude API key" until set.

**What it would take.** The Worker plus the ANTHROPIC_API_KEY secret (server/DESIGN.md section 9).

<a id="f38"></a>
### 38. Notes into Obsidian, a folder or Readwise from the Mac

`F38` · value **M** · effort **M** · needs **companion-only** · **Lab wave 3** · Round trip

**What it is.** The knowledge-base loop power users pay Readwise for, on the user's own Mac.

**Who does it best.** obsidian-kindle-plugin ("later syncs add new highlights without overwriting your edits"), KOBridge (only new highlights on re-export), Readwise's exporters.

**Evidence people want it.**

- "Later syncs add new highlights without overwriting your edits" ([hadynz/obsidian-kindle-plugin](https://github.com/hadynz/obsidian-kindle-plugin))

**Pitfalls.** Readwise's Obsidian plugin exports highlights several times (#84) and Obsidian Sync wiped them (#53); another plugin "deletes and recreates notes"; returned names are untrusted.

**Our design.**

- *Mac:* Pick a folder (security-scoped bookmark). Markdown goes to `<Title>.md` with frontmatter and a managed region between `<!-- daylight:start -->` and `<!-- daylight:end -->`, rewritten in place; PDFs go to Returns/. Optional Readwise push with a token in the Keychain, idempotent by hash.
- *iPhone, iPad:* Save to a remembered Files folder.

<a id="f39"></a>
### 39. Handwriting to text for returned pages

`F39` · value **M** · effort **M** · needs **companion-only** · **Lab wave 3** · Round trip

**What it is.** Margin notes and pen pages become searchable text in the notes folder, with the ink kept as it is.

**Who does it best.** reMarkable handwriting conversion, Booxidian (Apple Vision), Supersidian.

**Evidence people want it.**

- "Good handwriting support" ([SamMorrowDrums/remarkable-mcp](https://github.com/SamMorrowDrums/remarkable-mcp))

**Pitfalls.** Cloud OCR leaks content and costs money; Tesseract "performs poorly on handwriting"; accuracy varies, so mark it "Transcribed, tap to correct".

**Our design.**

- *Mac, iPhone, iPad:* VNRecognizeTextRequest (accurate level) on returned PNG/PDF pages; a sidecar `.md` "Transcribed - tap to correct".
- *Android phone:* ML Kit text recognition on-device, lower expectations.

<a id="f40"></a>
### 40. Inbox triage and housekeeping

`F40` · value **M** · effort **M** · needs **companion+inbox** · **Lab wave 3** · Organise

**What it is.** For people who want to choose on the tablet what goes into the Reader, and to keep the Inbox from growing forever.

**Who does it best.** Readwise Reader's triage (Inbox -> Later / Archive), GoodLinks 3 (auto-delete read items, keep starred), Karakeep's storage display.

**Evidence people want it.**

- "When I read a large article from random ones, and then it's difficult to find it to continue reading." ([wallabag/wallabag#8640](https://github.com/wallabag/wallabag/issues/8640))

**Pitfalls.** Auto-delete without undo surprises people; never delete anything not yet handed to the Reader; pen notes live in the Reader and are never touched.

**Our design.**

- *DC-1 Inbox:* Lab setting "Hold new items in the Inbox" (off by default): actions Read now / Morning stack / Add to Reader / Delete; tabs New, Held, Sent to Reader; search by title, source and tag; Inbox copies removed N days after hand-off (default 30); 30-day trash with Undo; storage bar.

<a id="f41"></a>
### 41. Android Quick Settings tile and "Send to Daylight" in the text-selection menu

`F41` · value **M** · effort **S** · needs **companion-only** · **Lab wave 2** · Capture

**What it is.** One swipe down and a tap sends the copied link; selected text anywhere can go to the Daylight as an excerpt (F11).

**Who does it best.** Note apps (Obsidian, Notesnook) with capture tiles; requested for Karakeep.

**Evidence people want it.**

- Karakeep #3074 asks for a tile that "saves the current clipboard content in a single tap" ([karakeep-app/karakeep#3074](https://github.com/karakeep-app/karakeep/issues/3074))

**Pitfalls.** Tile state drift (Tailscale #2646, 16 thumbs-up); at most two tiles; Android 13+ allows one in-context add prompt; clipboard toasts.

**Our design.**

- *Android phone:* TileService "Send clipboard to Daylight" (unavailable when unpaired; subtitle "Sent 12:41") and "Scan to Daylight" (F30); `requestAddTileService` once, after the first clipboard send; a PROCESS_TEXT activity using F11's rules.

<a id="f42"></a>
### 42. iPhone controls and widgets

`F42` · value **M** · effort **M** · needs **companion-only** · **Lab wave 2** · Capture

**What it is.** Send without hunting for the app, and see at a glance whether the last items arrived.

**Who does it best.** Instapaper 10 (home-screen widgets, July 2026); Apple's control and interactive-widget APIs.

**Evidence people want it.**

- "A control allows your app to execute an action, launch your app to a specific view ... from Control Center, the Lock Screen, or by using the Action button." ([developer.apple.com/tutorials/data/documentation/widget...](https://developer.apple.com/tutorials/data/documentation/widgetkit/creating-controls-to-perform-actions-across-the-system.json))

**Pitfalls.** Controls cannot show a returned value; widget buttons are inactive while locked; reading the clipboard programmatically raises a paste alert, so the control opens a PasteButton screen.

**Our design.**

- *iPhone, iPad:* ControlWidgetButton "Send clipboard to Daylight" (opens a small PasteButton screen) and "Scan to Daylight"; small/medium widget with the last three sends (status glyphs), last check-in, and Paste & send / Scan buttons; a Live Activity only for transfers over 10 s (F13).

<a id="f43"></a>
### 43. Paper mode for PDFs: crop margins, blank note pages, writing margin

`F43` · value **M** · effort **M** · needs **companion-only** · **Lab wave 3** · Documents

**What it is.** Papers prepared for writing on, the way reMarkable users prepare them with paper2remarkable.

**Who does it best.** paper2remarkable (`-b` blank pages, `-c` crop, `-r` right-align).

**Evidence people want it.**

- "Insert a blank page after each page using the -b switch (useful for note taking!)" ([GjjvdBurg/paper2remarkable](https://github.com/GjjvdBurg/paper2remarkable))

**Pitfalls.** Mixed page sizes break some annotation exporters; rasterising loses selectable text; always keep the original.

**Our design.**

- *Mac, iPhone, iPad:* PDFKit page transforms on a copy "<name> (paper mode).pdf".
- *Android phone:* The same with a PDF library (vector transforms, no rasterising).

<a id="f44"></a>
### 44. Send a paper by DOI, arXiv id or PubMed id

`F44` · value **M** · effort **M** · needs **companion-only** · **Lab wave 3** · Documents

**What it is.** Academic reading without the download-rename-share dance.

**Who does it best.** paper2remarkable (arXiv, PMC, OpenReview, Semantic Scholar and more).

**Evidence people want it.**

- "Send to Tablet is another issue. No way of automating that like Zotfile did" ([jlegewie/zotfile#655](https://github.com/jlegewie/zotfile/issues/655))

**Pitfalls.** Link-format fragility (paper2remarkable #7); paywalled publishers; never send an HTML error page saved as .pdf.

**Our design.**

- *iPhone, iPad, Mac, Android phone, Web sender:* The link field recognises `2410.12345`, `10.xxxx/...`, PMID/PMCID; arXiv -> arxiv.org/pdf; DOI -> an open-access lookup (Unpaywall) from the device; download on the device, check the `%PDF` magic bytes, send as a file; otherwise send the landing page with "No open PDF found".

<a id="f45"></a>
### 45. X/Twitter threads as one article

`F45` · value **M** · effort **M** · needs **companion-only** · **Lab wave 3** · Capture

**What it is.** The thread, not its first post, arrives as one readable document. No account linking or API.

**Who does it best.** Readwise ("save thread"), kindle-send-chrome's X extractor, Defuddle's X extractor.

**Evidence people want it.**

- "the value of the tweet is the threat [thread], not the first post" ([karakeep-app/karakeep#1468](https://github.com/karakeep-app/karakeep/issues/1468))

**Pitfalls.** Clippers only see what is in the DOM (Obsidian saved 4 of a 7-post thread, #264); X changes break extractors often.

**Our design.**

- *Chrome, Safari:* Auto-scroll to load the author's replies (cap 100 posts or 20 s), build the article, url = first post; when incomplete say "Got 7 of the thread's posts".

<a id="f46"></a>
### 46. Guest drop: let someone send to this Daylight once

`F46` · value **M** · effort **M** · needs **companion+inbox** · **Lab wave 3** · Capture

**What it is.** A colleague or a borrowed computer can drop a PDF on your Daylight without installing anything or learning your pairing code.

**Who does it best.** send2ereader / BookDrop (4-character key and QR from the e-reader's browser), magic-wormhole (single-use codes).

**Evidence people want it.**

- "Download links appear on the device within seconds." ([eitan12345om/book-drop](https://github.com/eitan12345om/book-drop))
- "Wormhole codes are single-use and do not need to be memorized" ([magic-wormhole/magic-wormhole](https://github.com/magic-wormhole/magic-wormhole))

**Pitfalls.** Hosted pairing sites go down ("502 bad gateway"); short codes need a short life and approval; a web page cannot prove its own code (PairDrop #180), so guest items always need approval.

**Our design.**

- *DC-1 Inbox:* "Let someone send": a fresh temporary secret (its own topics), a QR to the web sender with `#guest=`, valid one hour or 20 items, Approve / Decline per item, then the secret is destroyed.
- *Web sender:* Guest mode: no settings, no history kept, a banner "Sending to <name>'s Daylight as a guest".

<a id="f47"></a>
### 47. Import a reading list

`F47` · value **M** · effort **M** · needs **companion-only** · **Lab wave 3** · Sources

**What it is.** Bring an old read-later backlog to the Daylight without flooding it or the relay.

**Who does it best.** Readwise Reader's importers (Pocket zip, Instapaper, Matter, OPML converted into views).

**Evidence people want it.**

- "Reader automatically converted my previous folders into views" ([club.macstories.net/posts/using-readwise-reader-as-my-r...](https://club.macstories.net/posts/using-readwise-reader-as-my-rss-client)) *(search snippet)*

**Pitfalls.** Instapaper's API returns at most 500 items; Safari auto-unzips Pocket exports; ntfy.sh allows 250 messages a day per address, so a big import must be throttled.

**Our design.**

- *Mac, Web sender:* Preview with counts and duplicates (F16/F32), choose "unread only", send as links at 50 a day by default (or into weekly stacks), progress "120 of 600 sent", resumable after restart; OPML goes to F35.

<a id="f48"></a>
### 48. Verified delivery and private items

`F48` · value **M** · effort **S** · needs **companion+inbox** · **Lab wave 2** · Trust

**What it is.** Proof that the exact file arrived (useful for legal and research documents), and discretion for private browsing.

**Who does it best.** RaioPDF's local-only promise; Firefox Send Tab's per-entry private flag.

**Evidence people want it.**

- "Your files never leave your computer" ([Macrify-LLC/raiopdf](https://github.com/Macrify-LLC/raiopdf))
- "entries is an array of objects holding title, url, and private" ([raw.githubusercontent.com/mozilla-firefox/firefox/main/servic...](https://raw.githubusercontent.com/mozilla-firefox/firefox/main/services/fxaccounts/FxAccountsCommands.sys.mjs))

**Pitfalls.** A hash is not a legal guarantee; say "matches", not "certified". Extensions cannot always tell private mode in Safari.

**Our design.**

- *All senders, DC-1 Inbox:* Show the first 12 hex digits of the SHA-256 on both ends with "Verified" once the Inbox has checked it (it already does).
- *Chrome, Safari:* In an incognito/private window, confirm before sending and set `x-private: true`.
- *DC-1 Inbox:* Private items show "New private item" in notifications and leave Inbox history after hand-off.

<a id="f49"></a>
### 49. Pairing fingerprint and safe handling of what arrives

`F49` · value **M** · effort **S** · needs **companion+inbox** · **Lab wave 3** · Trust

**What it is.** A way to check that two devices really share the same pairing, and a guard against surprises.

**Who does it best.** Signal-style safety numbers (proposed for PairDrop), LocalSend certificate fingerprints, Warpinator's sandboxed incoming folder.

**Evidence people want it.**

- "You need to trust this URL/server." ([schlagmichdoch/PairDrop#180](https://github.com/schlagmichdoch/PairDrop/issues/180))
- "explicit acceptance, clear sender identity, notifications" ([tailscale/tailscale#15670](https://github.com/tailscale/tailscale/issues/15670))

**Pitfalls.** Silent pairing changes broke KDE Connect users; the web sender cannot prove its own code, so label it lower trust.

**Our design.**

- *All apps:* Fingerprint = four words from SHA-256 of the key (vectors), shown in Settings and on the pairing confirmation; a warning when a stored pairing is replaced by something other than the user's own action; the web sender says "web page: trust depends on where it is hosted".

<a id="f50"></a>
### 50. iPad: sidebar layout, drag and drop, keyboard

`F50` · value **M** · effort **S** · needs **companion-only** · **Lab wave 2** · Platform

**What it is.** iPad users get a layout that fits the screen and works with Stage Manager, a keyboard and a pointer.

**Who does it best.** GoodLinks (three-column iPad layout, keyboard shortcuts).

**Evidence people want it.**

- GoodLinks added a three-column iPad layout, widgets and keyboard shortcuts ([macstories.net/reviews/goodlinks-updated-with-thre...](https://www.macstories.net/reviews/goodlinks-updated-with-three-column-ipad-layout-widgets-and-new-keyboard-shortcuts/))

**Pitfalls.** Thin direct evidence of demand; keep it to layout and input, no iPad-only features.

**Our design.**

- *iPad:* NavigationSplitView (History, From your Daylight, On your Daylight, Settings); drop PDFs and links onto the window; drag items out of From your Daylight; Cmd-V sends a copied link; works at one-third split width.

<a id="f51"></a>
### 51. No lock-in: export, your own relay, a documented protocol

`F51` · value **M** · effort **S** · needs **companion-only** · **Lab wave 2** · Trust

**What it is.** After Pocket and Omnivore, people want to know they can leave with their data and that the service cannot vanish under them.

**Who does it best.** GoodLinks (no account, iCloud only), self-hostable wallabag/Readeck/Karakeep.

**Evidence people want it.**

- "I loved Pocket. I used it nearly daily." ([news.ycombinator.com/item](https://news.ycombinator.com/item?id=44065481)) *(search snippet)*
- "they gave us so little time to download" ([pabuisson/in-my-pocket#4](https://github.com/pabuisson/in-my-pocket/issues/4))

**Pitfalls.** Omnivore gave about two weeks and an export usable only with ElevenReader; Pocket deleted data; Instapaper moved Kindle sends behind Premium.

**Our design.**

- *All apps:* Export history (JSON and CSV: time, title, URL, status); export the pairing (code and QR, behind device authentication); a "Your data" page: no account, end-to-end encrypted, link to PROTOCOL.md, how to run your own ntfy (the relay check already exists). Inbox: export its items as a zip.

<a id="f52"></a>
### 52. Reading aids in the Reader: ruler, spacing, fonts, opt-in emphasis

`F52` · value **M** · effort **M** · needs **reader-change** · **Next: needs a Reader change** · Reading

**What it is.** Help for readers who lose their line, have dyslexia or low vision. Not a companion feature; listed so the Reader session sees the evidence.

**Who does it best.** Readest (reading ruler with an explicit e-ink mode, custom fonts), Instapaper 10 (Atkinson Hyperlegible), Thorium.

**Evidence people want it.**

- "it is easy to lose the current line after scrolling or moving the eyes away from the screen. This slows down reading and increases eye strain" ([readest/readest#3011](https://github.com/readest/readest/issues/3011))
- "the reading ruler is fantastic" ([readest/readest#5174](https://github.com/readest/readest/issues/5174))

**Pitfalls.** Readest filed at least 12 ruler bugs in 2026; tints lower contrast on grayscale; Bionic Reading is contested ("It physically hurts my brain" vs "I finally feel like I can read!", KOReader #9109) and maintainers say evidence does not support speed claims, so never on by default.

**Our design.**

- *Daylight Reader:* Behind the Reader's Labs switch: clear-band ruler with an outline (no tint), WCAG 1.4.12 spacing controls, bundled open-licence fonts and custom font import, Bionic as an optional font.

**What it would take.** Reader Labs work by the Mac mini session.

<a id="f53"></a>
### 53. Read aloud on the DC-1

`F53` · value **M** · effort **M** · needs **reader-change** · **Next: needs a Reader change** · Reading

**What it is.** Listen to sent articles on the tablet, continuing from one to the next.

**Who does it best.** Matter (HD voices), Instapaper (AI voices), Readest/Thorium (highlighted read-aloud), Feeder (TTS queue).

**Evidence people want it.**

- "the best one I've ever tested in 16 years of writing about apps" ([macstories.net/stories/macstories-selects-2025-rec...](https://www.macstories.net/stories/macstories-selects-2025-recognizing-the-best-apps-of-the-year/)) *(search snippet)*
- "Right now every sentence gets read with the same flat pacing" ([readest/readest#6412](https://github.com/readest/readest/issues/6412))

**Pitfalls.** No continuous playback and reading newsletter boilerplate (Readwise, HN 2023); stutters at chapter boundaries; focus stolen; the DC-1's speaker quality is unverified.

**Our design.**

- *Daylight Reader:* System TTS (Google TTS is installed on the probe units) with underline/weight highlighting, a queue, resume and skip rules.

**What it would take.** Reader Labs work.

<a id="f54"></a>
### 54. LivePaper reading ergonomics: whole-page turns, no motion

`F54` · value **M** · effort **M** · needs **reader-change** · **Next: needs a Reader change** · Reading

**What it is.** Reading that feels like a book rather than a feed on the DC-1.

**Who does it best.** Readwise Reader's E-ink Mode (names Daylight and BOOX; reduce motion, volume-key paging, later tap-to-turn), Kindle.

**Evidence people want it.**

- "feels like doomscrolling rather than reading a book" ([redlib.hbubli.cc/r/daylightcomputer/new](https://redlib.hbubli.cc/r/daylightcomputer/new)) *(relayed, not opened)*

**Pitfalls.** Boox misses swipe gestures; per-app refresh tuning is fiddly.

**Our design.**

- *Daylight Reader:* Paged mode for read-later articles with tap zones and volume keys, no transitions.
- *DC-1 Inbox:* Already covered for the Inbox's own screens by F15.

**What it would take.** Reader Labs work.

<a id="f55"></a>
### 55. Open where I stopped reading on the phone

`F55` · value **M** · effort **M** · needs **reader-change** · **Next: needs a Reader change** · Round trip

**What it is.** Start an article on the phone, continue it on the Daylight at the same paragraph.

**Who does it best.** Chrome Send-tab-to-self (page context with scroll position, new in M147).

**Evidence people want it.**

- "Text fragment data used for scroll position restoration" ([raw.githubusercontent.com/chromium/chromium/main/components/s...](https://raw.githubusercontent.com/chromium/chromium/main/components/send_tab_to_self/page_context.h))

**Pitfalls.** Rewritten or dynamic pages break fragment matching; fall back to the top silently.

**Our design.**

- *Senders + Reader:* Extension and iPhone share compute the topmost visible text fragment and add `x-anchor`; the Inbox passes it on; the Reader scrolls to it.

**What it would take.** Reader: accept an anchor extra on SAVE_PAGE and scroll to it. Sender capture is small and can ship with it.

<a id="f56"></a>
### 56. Listen on the phone

`F56` · value **M** · effort **M** · needs **companion-only** · **Lab wave 4** · Reading

**What it is.** Hear the article on a walk, then read the rest on the Daylight.

**Who does it best.** Matter, Instapaper, Omnivore (text stayed visible while playing).

**Evidence people want it.**

- continuous playback across articles and skipping newsletter boilerplate (HN 2023 request) ([news.ycombinator.com/item](https://news.ycombinator.com/item?id=38720882))

**Pitfalls.** Delivered items keep only a history row today, so the app must keep the article text (small, capped) for Listen; paywalled voices disappoint.

**Our design.**

- *iPhone, iPad, Android phone:* Keep plain text (up to 200 KB per item, 7 days) when Listen is on; AVSpeechSynthesizer / Android TTS; queue in history order; resume.

<a id="f57"></a>
### 57. Zotero plugin: Send to Daylight, annotations back

`F57` · value **M** · effort **L** · needs **companion+inbox** · **Lab wave 4** · Documents

**What it is.** The ZotFile "send to tablet / get from tablet" loop that academics lost with Zotero 7.

**Who does it best.** ZotFile (unmaintained, 4,379 stars), zotero-remarkable-sync and zotRm (2026, experimental).

**Evidence people want it.**

- "Send to Tablet is another issue. No way of automating that like Zotfile did" ([jlegewie/zotfile#655](https://github.com/jlegewie/zotfile/issues/655))

**Pitfalls.** "Bugs can reorder, corrupt, or delete annotations and files" (zotero-remarkable-sync README); duplicates when two computers sync; "_annotated_annotated" copies (ZotFile #226).

**Our design.**

- *Zotero (Mac, Windows, Linux):* A Zotero 7 plugin using share/js: tag-driven send, attach returned annotated PDFs as a new attachment next to the original, dedupe by item key and file hash, never delete.

<a id="f58"></a>
### 58. Personal webhook for IFTTT, Zapier, Make and n8n

`F58` · value **L** · effort **S** · needs **server** · **Next: needs the Daylight server** · Automation

**What it is.** Glue to services that cannot run our apps.

**Who does it best.** Pocket's IFTTT integration, Readwise's IFTTT feed, Karakeep's API.

**Evidence people want it.**

- "Pocket's TWO BIG features were recommended articles and integration with IFTTT" ([news.ycombinator.com/item](https://news.ycombinator.com/item?id=44597668)) *(search snippet)*

**Pitfalls.** Plaintext at the Worker (not end-to-end); tokens leak; needs rate limits.

**Our design.**

- *Server:* A `/v1/send` route with a per-user bearer token, size cap and rate limit, delivered on the server lane.

**What it would take.** The Worker.

<a id="f59"></a>
### 59. Import from Safari Reading List (Mac)

`F59` · value **L** · effort **M** · needs **companion-only** · **Lab wave 4** · Sources

**What it is.** Clear a long Safari Reading List onto the Daylight.

**Who does it best.** No product reads it; apps only add to it.

**Evidence people want it.**

- "Whenever I use an item's share sheet to add it to the Safari Reading List, iOS asks if I want to allow NNW to do this" ([Ranchero-Software/NetNewsWire#3634](https://github.com/Ranchero-Software/NetNewsWire/issues/3634))

**Pitfalls.** Needs Full Disk Access and a private file format Apple can change; iPhone cannot read it at all.

**Our design.**

- *Mac:* Read the Reading List from Safari's bookmarks file after the user grants access; checkbox preview; local ledger; never write to Safari.

<a id="f60"></a>
### 60. Keyboard-first quick send and a command palette

`F60` · value **L** · effort **S** · needs **companion-only** · **Lab wave 4** · Capture

**What it is.** For keyboard users: send without the mouse.

**Who does it best.** KindBeamer, Readwise Reader (Cmd/Ctrl-K).

**Evidence people want it.**

- "Enter sends, Esc clears or closes, digits tick devices" ([jooray/kindbeamer](https://github.com/jooray/kindbeamer))

**Pitfalls.** Discoverability; avoid clashing global shortcuts.

**Our design.**

- *Mac:* A hotkey opens a small panel prefilled with the clipboard link or front tab.
- *Web sender:* Cmd/Ctrl-K palette: send link, send file, recent items.

<a id="f61"></a>
### 61. Make scans searchable before sending (OCR)

`F61` · value **M** · effort **M** · needs **companion-only** · **Lab wave 4** · Documents

**What it is.** Scanned chapters and court records become searchable on the Daylight.

**Who does it best.** OCRmyPDF, RaioPDF (offline OCR).

**Evidence people want it.**

- "adds an OCR text layer to scanned PDF files, allowing them to be searched or copy-pasted" ([ocrmypdf/OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF))

**Pitfalls.** Slow and failure-prone on long files ("OCR error after 390+ pages", Stirling-PDF #6925); signed PDFs break; keep the original.

**Our design.**

- *Mac, iPhone, iPad, Android phone:* Per-send "Make searchable" with progress and Cancel; the result is a copy.

<a id="f62"></a>
### 62. arXiv and HTML papers with readable maths

`F62` · value **M** · effort **M** · needs **companion-only** · **Lab wave 4** · Documents

**What it is.** Read papers reflowed on the tablet instead of as tiny two-column PDFs.

**Who does it best.** ar5iv / arXiv HTML (no ebook export).

**Evidence people want it.**

- "My dream is to read scientific papers on my kindle, but most of the tools out there render papers very poorly." ([dginev/ar5iv#56](https://github.com/dginev/ar5iv/issues/56))

**Pitfalls.** MathML support returned to Chrome only in 109; the DC-1 WebView is 101.

**Our design.**

- *Chrome, Safari, Mac:* Fetch the arXiv HTML version, render MathML to SVG with MathJax on the sender, send as a page; fall back to the PDF.

<a id="f63"></a>
### 63. Warn about fake redactions and hidden metadata before sending

`F63` · value **L** · effort **M** · needs **companion-only** · **Lab wave 4** · Documents

**What it is.** A guard for lawyers and journalists who send redacted documents.

**Who does it best.** Free Law Project's X-Ray, pdf-redactor, RaioPDF.

**Evidence people want it.**

- "Manual redact is only putting a layer over the text but if you copy and paste the text is still there" ([Stirling-Tools/Stirling-PDF#4641](https://github.com/Stirling-Tools/Stirling-PDF/issues/4641))

**Pitfalls.** Heuristic only; never present it as a guarantee.

**Our design.**

- *Mac:* PDFKit check for text under filled rectangles; warn, never block.

<a id="f64"></a>
### 64. On-device summary with Apple Intelligence (no key, no server)

`F64` · value **M** · effort **M** · needs **companion-only** · **Not scheduled: needs your decision** · AI

**What it is.** A summary that keeps end-to-end encryption and needs no API key. It departs from the user's "AI = Claude with my key" decision, so it waits for a yes.

**Who does it best.** Requested for NetNewsWire ("no accounts, no API keys").

**Evidence people want it.**

- "low-friction, local, privacy-preserving" ([Ranchero-Software/NetNewsWire#4665](https://github.com/Ranchero-Software/NetNewsWire/issues/4665))

**Pitfalls.** Only newer devices; some users want no AI at all ("By design, NetNewsWire stays very far away from algorithms and from AI.").

**Our design.**

- *iPhone, iPad, Mac:* Foundation Models in the share extension or app, behind its own Lab toggle, labelled as generated.

**What it would take.** A decision from the user (section 6).

<a id="f65"></a>
### 65. Audio edition (server text-to-speech to MP3)

`F65` · value **L** · effort **L** · needs **server** · **Next: needs the Daylight server** · Reading

**What it is.** Podcast-style listening of saved articles.

**Who does it best.** ElevenReader, Speechify, NaturalReader (not researched first-hand).

**Pitfalls.** Needs a TTS provider key that is not Claude; content leaves end-to-end encryption; cost per article.

**Our design.**

- *Server:* A Worker route behind the needs-setup message.

**What it would take.** A TTS provider choice and key from the user.

<a id="f66"></a>
### 66. Highlight and library sync across devices

`F66` · value **M** · effort **L** · needs **reader-change** · **Next: needs a Reader change** · Round trip

**What it is.** The foundation for a library that lives on more than the tablet.

**Who does it best.** syncery.koplugin (three-way merge, tombstones), AnnotationSync (trash bin), highlightsync.

**Evidence people want it.**

- "surfaced for you to resolve, never dropped silently" ([d0nizam/syncery.koplugin](https://github.com/d0nizam/syncery.koplugin))

**Pitfalls.** AnnotationSync #87: one new highlight produced 31 false deletions that propagated everywhere; never infer deletes from diffs.

**Our design.**

- *Reader (+ sync service):* Records {id, item, anchor, text, note, updated, deleted_at}; explicit tombstones; per-field merge.

**What it would take.** The Reader's library-sync plan (PowerSync, a loose end in the Reader project).

<a id="f67"></a>
### 67. Watched folder on the tablet

`F67` · value **L** · effort **M** · needs **companion+inbox** · **Lab wave 4** · Sources

**What it is.** Another way in for people who already sync folders.

**Who does it best.** KoboCloud (Dropbox, Drive, Nextcloud), Syncthing on PocketBook, ReadEra watched folders.

**Evidence people want it.**

- "something more generic and multi-platform like Syncthing (or Dropbox)" ([koreader/koreader#3630](https://github.com/koreader/koreader/issues/3630))

**Pitfalls.** Android 11+ refuses folder grants on Download/; polling drains battery; duplicates.

**Our design.**

- *DC-1 Inbox:* A SAF tree grant on a non-Download folder; WorkManager check hourly; SHA-256 dedupe; hand-off like relay items.

<a id="f68"></a>
### 68. Reading stats

`F68` · value **L** · effort **S** · needs **reader-change** · **Next: needs a Reader change** · Reading

**What it is.** A small dashboard on the phone or Mac.

**Who does it best.** KoShelf, KOBridge (local dashboard), ha-koreader sensors.

**Evidence people want it.**

- "keeps a local copy, so you can view it while the Kindle is off" ([danihrndzld/KOBridge](https://github.com/danihrndzld/KOBridge))

**Pitfalls.** KoInsight was archived; server-side stats raised privacy objections.

**Our design.**

- *Companions:* Computed from F18's events; no server; CSV export.

**What it would take.** F18.

## 3. The Lab feature set

Everything here is buildable now without a server and without changing the Daylight Reader: it is *companion-only* or *companion+inbox*. Within each wave, build in the user's priority order: **iPhone and Mac first, then Chrome, Android phone, web sender and the DC-1 Inbox** (the Inbox half of a companion+inbox feature ships with its first sender). Windows follows the Mac where a feature applies.

### 3.1 Rules every Lab feature must pass

- Behind the app's one Lab switch (F00). Lab on by default. With Lab off the app behaves exactly like the last non-Lab build (screenshot diff in UI tests).
- A Lab feature whose prerequisite is missing stays visible and, when tapped, says in one sentence what is missing and where to add it (LAB-DECISIONS.md).
- Wire compatibility: only `x-` header fields and new derived topics; a v1.1 non-Lab Inbox and non-Lab senders keep working (the F17 version-skew suite runs in CI for every Lab change).
- Nothing new leaves the device unencrypted. Any path that is not end-to-end encrypted (a read-later service token, a direct service fetch) says so the first time it is used.
- Respect ntfy.sh's budget: 250 messages and 200 MB a day per address, 2 MB per file. Every automated sender (imports, feeds, reading-list mirrors) is throttled and soak-tested against the mock relay with those limits.
- No state is shown by colour alone (the DC-1 is grayscale). Every new control has a VoiceOver/TalkBack label and survives 200% text.
- The same feature uses the same words in every app (one string table per feature, as protocol v1.1 did for statuses).
- Every Lab feature has an entry in the in-app "What's in Lab" list with one sentence on what it does.

### 3.2 Waves at a glance

**Wave 0 (foundations):** [F00](#f00) Lab switch and "needs setup" messages; [F17](#f17) Capability hello and version-skew safety; [F27](#f27) Accessibility baseline, plus a Lab comfort mode.

**Wave 1 (biggest wins):** [F01](#f01) Honest delivery timeline; [F03](#f03) Send the page as you see it, and say when only a link came through; [F04](#f04) Share in place: done in a second, never opens the app; [F07](#f07) Offline-first outbox; [F08](#f08) Your Daylight in the share sheet's top row; [F09](#f09) Automation: Shortcuts, Siri, URL scheme, Android intent, command line; [F10](#f10) Send as: page, clean article, link or selection, with a thin-content check; [F11](#f11) Send a selection as an excerpt; [F15](#f15) Arrival notification with actions, and Inbox health; [F16](#f16) Smart intake: unwrap Apple News, AMP, Substack and tracking links; [F26](#f26) Setup coach, test send and diagnostics; [F33](#f33) Send the copied link; [F34](#f34) Full browser context menu and keyboard shortcuts.

**Wave 2:** [F06](#f06) Send back from the DC-1 to my phone or Mac; [F12](#f12) Note, tags and "read now / quietly / hold" at send time; [F13](#f13) Big files on the same Wi-Fi (direct, no server); [F22](#f22) Send several tabs or items as one issue; [F23](#f23) PDFs stay PDFs, and "Print to Daylight" from any app; [F24](#f24) Image diet: self-contained pages tuned for grayscale; [F29](#f29) Mac power moves; [F30](#f30) Scan paper to a clean PDF; [F31](#f31) Chrome Reading List to Daylight; [F32](#f32) "Already sent" notice and duplicate guard; [F41](#f41) Android Quick Settings tile and "Send to Daylight" in the text-selection menu; [F42](#f42) iPhone controls and widgets; [F48](#f48) Verified delivery and private items; [F50](#f50) iPad: sidebar layout, drag and drop, keyboard; [F51](#f51) No lock-in: export, your own relay, a documented protocol.

**Wave 3:** [F14](#f14) Morning stack: one issue with a contents page, never repeating; [F20](#f20) "On your Daylight": see and steer what waits in the Inbox; [F25](#f25) Read-later connectors pulled by the Inbox; [F28](#f28) YouTube videos as readable transcripts; [F35](#f35) RSS feeds checked by the Inbox; [F38](#f38) Notes into Obsidian, a folder or Readwise from the Mac; [F39](#f39) Handwriting to text for returned pages; [F40](#f40) Inbox triage and housekeeping; [F43](#f43) Paper mode for PDFs: crop margins, blank note pages, writing margin; [F44](#f44) Send a paper by DOI, arXiv id or PubMed id; [F45](#f45) X/Twitter threads as one article; [F46](#f46) Guest drop: let someone send to this Daylight once; [F47](#f47) Import a reading list; [F49](#f49) Pairing fingerprint and safe handling of what arrives.

**Wave 4 (stretch):** [F56](#f56) Listen on the phone; [F57](#f57) Zotero plugin: Send to Daylight, annotations back; [F59](#f59) Import from Safari Reading List (Mac); [F60](#f60) Keyboard-first quick send and a command palette; [F61](#f61) Make scans searchable before sending (OCR); [F62](#f62) arXiv and HTML papers with readable maths; [F63](#f63) Warn about fake redactions and hidden metadata before sending; [F67](#f67) Watched folder on the tablet.

Why this order: Wave 1 fixes the top complaints in the research (silent delivery, being thrown into the app, lost offline sends, junk shares) and adds the cheap high-value capture paths. Wave 2 brings the two big gaps that need no server: the return trip (F06) and big files on the same Wi-Fi (F13), plus send-time organisation. Wave 3 adds sources and calm reading (morning stack, feeds, connectors) on top of the Inbox features from Wave 2. Wave 4 is useful but narrower.

### 3.3 Per app

#### iPhone

- **W0**
  - [F00](#f00) Lab switch and "needs setup" messages
  - [F17](#f17) Capability hello and version-skew safety
  - [F27](#f27) Accessibility baseline, plus a Lab comfort mode
- **W1**
  - [F01](#f01) Honest delivery timeline
  - [F03](#f03) Send the page as you see it, and say when only a link came through
  - [F04](#f04) Share in place: done in a second, never opens the app
  - [F07](#f07) Offline-first outbox
  - [F08](#f08) Your Daylight in the share sheet's top row
  - [F09](#f09) Automation: Shortcuts, Siri, URL scheme, Android intent, command line
  - [F10](#f10) Send as: page, clean article, link or selection, with a thin-content check
  - [F11](#f11) Send a selection as an excerpt
  - [F16](#f16) Smart intake: unwrap Apple News, AMP, Substack and tracking links
  - [F26](#f26) Setup coach, test send and diagnostics
  - [F33](#f33) Send the copied link
- **W2**
  - [F06](#f06) Send back from the DC-1 to my phone or Mac
  - [F12](#f12) Note, tags and "read now / quietly / hold" at send time
  - [F13](#f13) Big files on the same Wi-Fi (direct, no server)
  - [F23](#f23) PDFs stay PDFs, and "Print to Daylight" from any app
  - [F24](#f24) Image diet: self-contained pages tuned for grayscale
  - [F30](#f30) Scan paper to a clean PDF
  - [F32](#f32) "Already sent" notice and duplicate guard
  - [F42](#f42) iPhone controls and widgets
  - [F48](#f48) Verified delivery and private items
  - [F51](#f51) No lock-in: export, your own relay, a documented protocol
- **W3**
  - [F14](#f14) Morning stack: one issue with a contents page, never repeating
  - [F20](#f20) "On your Daylight": see and steer what waits in the Inbox
  - [F25](#f25) Read-later connectors pulled by the Inbox
  - [F38](#f38) Notes into Obsidian, a folder or Readwise from the Mac
  - [F39](#f39) Handwriting to text for returned pages
  - [F43](#f43) Paper mode for PDFs: crop margins, blank note pages, writing margin
  - [F44](#f44) Send a paper by DOI, arXiv id or PubMed id
  - [F49](#f49) Pairing fingerprint and safe handling of what arrives
- **W4**
  - [F56](#f56) Listen on the phone
  - [F61](#f61) Make scans searchable before sending (OCR)

#### iPad

Same app and extensions as the iPhone; everything in the iPhone list applies. iPad-specific work: F50 iPad: sidebar layout, drag and drop, keyboard (W2).

#### Android phone

- **W0**
  - [F00](#f00) Lab switch and "needs setup" messages
  - [F17](#f17) Capability hello and version-skew safety
  - [F27](#f27) Accessibility baseline, plus a Lab comfort mode
- **W1**
  - [F01](#f01) Honest delivery timeline
  - [F03](#f03) Send the page as you see it, and say when only a link came through
  - [F04](#f04) Share in place: done in a second, never opens the app
  - [F07](#f07) Offline-first outbox
  - [F08](#f08) Your Daylight in the share sheet's top row
  - [F09](#f09) Automation: Shortcuts, Siri, URL scheme, Android intent, command line
  - [F11](#f11) Send a selection as an excerpt
  - [F16](#f16) Smart intake: unwrap Apple News, AMP, Substack and tracking links
  - [F26](#f26) Setup coach, test send and diagnostics
  - [F33](#f33) Send the copied link
- **W2**
  - [F06](#f06) Send back from the DC-1 to my phone or Mac
  - [F12](#f12) Note, tags and "read now / quietly / hold" at send time
  - [F13](#f13) Big files on the same Wi-Fi (direct, no server)
  - [F23](#f23) PDFs stay PDFs, and "Print to Daylight" from any app
  - [F30](#f30) Scan paper to a clean PDF
  - [F32](#f32) "Already sent" notice and duplicate guard
  - [F41](#f41) Android Quick Settings tile and "Send to Daylight" in the text-selection menu
  - [F48](#f48) Verified delivery and private items
  - [F51](#f51) No lock-in: export, your own relay, a documented protocol
- **W3**
  - [F14](#f14) Morning stack: one issue with a contents page, never repeating
  - [F20](#f20) "On your Daylight": see and steer what waits in the Inbox
  - [F39](#f39) Handwriting to text for returned pages
  - [F43](#f43) Paper mode for PDFs: crop margins, blank note pages, writing margin
  - [F44](#f44) Send a paper by DOI, arXiv id or PubMed id
  - [F49](#f49) Pairing fingerprint and safe handling of what arrives
- **W4**
  - [F56](#f56) Listen on the phone
  - [F61](#f61) Make scans searchable before sending (OCR)

#### Mac

- **W0**
  - [F00](#f00) Lab switch and "needs setup" messages
  - [F17](#f17) Capability hello and version-skew safety
  - [F27](#f27) Accessibility baseline, plus a Lab comfort mode
- **W1**
  - [F01](#f01) Honest delivery timeline
  - [F04](#f04) Share in place: done in a second, never opens the app
  - [F07](#f07) Offline-first outbox
  - [F08](#f08) Your Daylight in the share sheet's top row
  - [F09](#f09) Automation: Shortcuts, Siri, URL scheme, Android intent, command line
  - [F11](#f11) Send a selection as an excerpt
  - [F16](#f16) Smart intake: unwrap Apple News, AMP, Substack and tracking links
  - [F26](#f26) Setup coach, test send and diagnostics
  - [F33](#f33) Send the copied link
- **W2**
  - [F06](#f06) Send back from the DC-1 to my phone or Mac
  - [F12](#f12) Note, tags and "read now / quietly / hold" at send time
  - [F13](#f13) Big files on the same Wi-Fi (direct, no server)
  - [F22](#f22) Send several tabs or items as one issue
  - [F23](#f23) PDFs stay PDFs, and "Print to Daylight" from any app
  - [F29](#f29) Mac power moves
  - [F32](#f32) "Already sent" notice and duplicate guard
  - [F48](#f48) Verified delivery and private items
  - [F51](#f51) No lock-in: export, your own relay, a documented protocol
- **W3**
  - [F14](#f14) Morning stack: one issue with a contents page, never repeating
  - [F20](#f20) "On your Daylight": see and steer what waits in the Inbox
  - [F25](#f25) Read-later connectors pulled by the Inbox
  - [F35](#f35) RSS feeds checked by the Inbox
  - [F38](#f38) Notes into Obsidian, a folder or Readwise from the Mac
  - [F39](#f39) Handwriting to text for returned pages
  - [F43](#f43) Paper mode for PDFs: crop margins, blank note pages, writing margin
  - [F44](#f44) Send a paper by DOI, arXiv id or PubMed id
  - [F47](#f47) Import a reading list
  - [F49](#f49) Pairing fingerprint and safe handling of what arrives
- **W4**
  - [F57](#f57) Zotero plugin: Send to Daylight, annotations back
  - [F59](#f59) Import from Safari Reading List (Mac)
  - [F60](#f60) Keyboard-first quick send and a command palette
  - [F61](#f61) Make scans searchable before sending (OCR)
  - [F62](#f62) arXiv and HTML papers with readable maths
  - [F63](#f63) Warn about fake redactions and hidden metadata before sending

#### Chrome

- **W0**
  - [F00](#f00) Lab switch and "needs setup" messages
  - [F17](#f17) Capability hello and version-skew safety
  - [F27](#f27) Accessibility baseline, plus a Lab comfort mode
- **W1**
  - [F01](#f01) Honest delivery timeline
  - [F03](#f03) Send the page as you see it, and say when only a link came through
  - [F04](#f04) Share in place: done in a second, never opens the app
  - [F07](#f07) Offline-first outbox
  - [F10](#f10) Send as: page, clean article, link or selection, with a thin-content check
  - [F11](#f11) Send a selection as an excerpt
  - [F16](#f16) Smart intake: unwrap Apple News, AMP, Substack and tracking links
  - [F26](#f26) Setup coach, test send and diagnostics
  - [F33](#f33) Send the copied link
  - [F34](#f34) Full browser context menu and keyboard shortcuts
- **W2**
  - [F06](#f06) Send back from the DC-1 to my phone or Mac
  - [F12](#f12) Note, tags and "read now / quietly / hold" at send time
  - [F22](#f22) Send several tabs or items as one issue
  - [F24](#f24) Image diet: self-contained pages tuned for grayscale
  - [F31](#f31) Chrome Reading List to Daylight
  - [F32](#f32) "Already sent" notice and duplicate guard
  - [F48](#f48) Verified delivery and private items
  - [F51](#f51) No lock-in: export, your own relay, a documented protocol
- **W3**
  - [F14](#f14) Morning stack: one issue with a contents page, never repeating
  - [F20](#f20) "On your Daylight": see and steer what waits in the Inbox
  - [F28](#f28) YouTube videos as readable transcripts
  - [F35](#f35) RSS feeds checked by the Inbox
  - [F45](#f45) X/Twitter threads as one article
  - [F49](#f49) Pairing fingerprint and safe handling of what arrives
- **W4**
  - [F62](#f62) arXiv and HTML papers with readable maths

#### Safari

Same code as the Chrome extension (Mac and iPhone). Safari cannot rebind shortcuts, has no Reading List or side-panel API, and asks for site access per site.

- **W0**
  - [F00](#f00) Lab switch and "needs setup" messages
  - [F17](#f17) Capability hello and version-skew safety
  - [F27](#f27) Accessibility baseline, plus a Lab comfort mode
- **W1**
  - [F01](#f01) Honest delivery timeline
  - [F03](#f03) Send the page as you see it, and say when only a link came through
  - [F04](#f04) Share in place: done in a second, never opens the app
  - [F07](#f07) Offline-first outbox
  - [F10](#f10) Send as: page, clean article, link or selection, with a thin-content check
  - [F11](#f11) Send a selection as an excerpt
  - [F16](#f16) Smart intake: unwrap Apple News, AMP, Substack and tracking links
  - [F26](#f26) Setup coach, test send and diagnostics
  - [F33](#f33) Send the copied link
  - [F34](#f34) Full browser context menu and keyboard shortcuts
- **W2**
  - [F06](#f06) Send back from the DC-1 to my phone or Mac
  - [F12](#f12) Note, tags and "read now / quietly / hold" at send time
  - [F22](#f22) Send several tabs or items as one issue
  - [F24](#f24) Image diet: self-contained pages tuned for grayscale
  - [F32](#f32) "Already sent" notice and duplicate guard
  - [F48](#f48) Verified delivery and private items
  - [F51](#f51) No lock-in: export, your own relay, a documented protocol
- **W3**
  - [F14](#f14) Morning stack: one issue with a contents page, never repeating
  - [F28](#f28) YouTube videos as readable transcripts
  - [F35](#f35) RSS feeds checked by the Inbox
  - [F45](#f45) X/Twitter threads as one article
  - [F49](#f49) Pairing fingerprint and safe handling of what arrives
- **W4**
  - [F62](#f62) arXiv and HTML papers with readable maths

#### Web sender

- **W0**
  - [F00](#f00) Lab switch and "needs setup" messages
  - [F17](#f17) Capability hello and version-skew safety
  - [F27](#f27) Accessibility baseline, plus a Lab comfort mode
- **W1**
  - [F01](#f01) Honest delivery timeline
  - [F07](#f07) Offline-first outbox
  - [F09](#f09) Automation: Shortcuts, Siri, URL scheme, Android intent, command line
  - [F16](#f16) Smart intake: unwrap Apple News, AMP, Substack and tracking links
  - [F26](#f26) Setup coach, test send and diagnostics
  - [F33](#f33) Send the copied link
- **W2**
  - [F06](#f06) Send back from the DC-1 to my phone or Mac
  - [F12](#f12) Note, tags and "read now / quietly / hold" at send time
  - [F32](#f32) "Already sent" notice and duplicate guard
  - [F48](#f48) Verified delivery and private items
  - [F51](#f51) No lock-in: export, your own relay, a documented protocol
- **W3**
  - [F14](#f14) Morning stack: one issue with a contents page, never repeating
  - [F20](#f20) "On your Daylight": see and steer what waits in the Inbox
  - [F35](#f35) RSS feeds checked by the Inbox
  - [F44](#f44) Send a paper by DOI, arXiv id or PubMed id
  - [F46](#f46) Guest drop: let someone send to this Daylight once
  - [F47](#f47) Import a reading list
  - [F49](#f49) Pairing fingerprint and safe handling of what arrives
- **W4**
  - [F60](#f60) Keyboard-first quick send and a command palette

#### DC-1 Inbox

- **W0**
  - [F00](#f00) Lab switch and "needs setup" messages
  - [F17](#f17) Capability hello and version-skew safety
  - [F27](#f27) Accessibility baseline, plus a Lab comfort mode
- **W1**
  - [F01](#f01) Honest delivery timeline
  - [F03](#f03) Send the page as you see it, and say when only a link came through
  - [F11](#f11) Send a selection as an excerpt
  - [F15](#f15) Arrival notification with actions, and Inbox health
  - [F26](#f26) Setup coach, test send and diagnostics
- **W2**
  - [F06](#f06) Send back from the DC-1 to my phone or Mac
  - [F12](#f12) Note, tags and "read now / quietly / hold" at send time
  - [F13](#f13) Big files on the same Wi-Fi (direct, no server)
  - [F23](#f23) PDFs stay PDFs, and "Print to Daylight" from any app
  - [F48](#f48) Verified delivery and private items
  - [F51](#f51) No lock-in: export, your own relay, a documented protocol
- **W3**
  - [F14](#f14) Morning stack: one issue with a contents page, never repeating
  - [F20](#f20) "On your Daylight": see and steer what waits in the Inbox
  - [F25](#f25) Read-later connectors pulled by the Inbox
  - [F35](#f35) RSS feeds checked by the Inbox
  - [F40](#f40) Inbox triage and housekeeping
  - [F46](#f46) Guest drop: let someone send to this Daylight once
  - [F49](#f49) Pairing fingerprint and safe handling of what arrives
- **W4**
  - [F67](#f67) Watched folder on the tablet

#### Windows (follows the Mac)

- **W0**
  - [F00](#f00) Lab switch and "needs setup" messages
  - [F17](#f17) Capability hello and version-skew safety
  - [F27](#f27) Accessibility baseline, plus a Lab comfort mode
- **W1**
  - [F01](#f01) Honest delivery timeline
  - [F07](#f07) Offline-first outbox
  - [F08](#f08) Your Daylight in the share sheet's top row
  - [F09](#f09) Automation: Shortcuts, Siri, URL scheme, Android intent, command line
  - [F16](#f16) Smart intake: unwrap Apple News, AMP, Substack and tracking links
  - [F26](#f26) Setup coach, test send and diagnostics
  - [F33](#f33) Send the copied link
- **W2**
  - [F06](#f06) Send back from the DC-1 to my phone or Mac
  - [F12](#f12) Note, tags and "read now / quietly / hold" at send time
  - [F13](#f13) Big files on the same Wi-Fi (direct, no server)
  - [F22](#f22) Send several tabs or items as one issue
  - [F29](#f29) Mac power moves
  - [F32](#f32) "Already sent" notice and duplicate guard
  - [F48](#f48) Verified delivery and private items
  - [F51](#f51) No lock-in: export, your own relay, a documented protocol
- **W3**
  - [F14](#f14) Morning stack: one issue with a contents page, never repeating
  - [F49](#f49) Pairing fingerprint and safe handling of what arrives
- **W4**
  - [F57](#f57) Zotero plugin: Send to Daylight, annotations back

### 3.4 Acceptance criteria, wave by wave

Each criterion is written so a developer can automate it and a tester can check it by hand. Tags in brackets limit a criterion to one app; otherwise it applies to every app listed for the feature. The rules in 3.1 apply to all of them.

#### Wave 0 (foundations)

**F00 Lab switch and "needs setup" messages** (companion-only, effort S). Apps: iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender, DC-1 Inbox.

- [ ] Fresh install of each app: Lab is on. Upgrading from a build without Lab: Lab is on and a one-time note says so.
- [ ] With Lab off, every screen, string and flow matches the last non-Lab build (screenshot diff in each app's UI tests).
- [ ] Tapping a Lab feature whose prerequisite is missing shows exactly one sentence naming the missing piece and where to add it; the control is not greyed out (UI test per needs-setup state).
- [ ] Turning Lab off never deletes data: queued items still send and history stays.

**F17 Capability hello and version-skew safety** (companion+inbox, effort S). Apps: DC-1 Inbox, iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender.

- [ ] Every sender/Inbox combination in the matrix delivers url, page and file items and gets acks; Lab-only states appear only when both sides are Lab.
- [ ] A sender that has never seen a hello shows Inbox-dependent features with the "Needs the Lab Inbox" sentence.
- [ ] Hello frames are small messages (under 3,800 base64 characters) and at most three a day plus one per Lab toggle.

**F27 Accessibility baseline, plus a Lab comfort mode** (companion-only, effort M). Apps: iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender, DC-1 Inbox.

- [ ] axe-core reports no violations on the web sender and extension popups (CI).
- [ ] Android Accessibility Test Framework checks run in the Robolectric suite; XCUITest accessibility audits pass on the main iPhone and Mac screens.
- [ ] A recorded VoiceOver and TalkBack run of pair -> send -> delivered passes each release, with the state change announced.

#### Wave 1 (biggest wins)

**F01 Honest delivery timeline** (companion+inbox, effort M). Apps: iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender, DC-1 Inbox.

- [ ] A link sent while the Lab Inbox is open shows "In your Reader" on the sender within 30 s of "On your Daylight" (mock-relay e2e test in CI, plus one run on Rooted 2).
- [ ] With the Inbox's Documents set to Ask, a PDF shows "Waiting for a tap on your Daylight"; after the notification is tapped the sender shows "Handed to the Reader" at its next ack check.
- [ ] The sender shows "Your Daylight checked in N min ago" from the newest ack/hello. With the Daylight off, sends still go out (presence never blocks).
- [ ] Every failed row has one sentence naming the cause and a Retry button. No row ever says Delivered without an ack listing its id (unit test over the outbox state machine).
- [ ] Against a non-Lab v1.1 Inbox the rows show Sent / Delivered exactly as today (version-skew suite, F17).

**F03 Send the page as you see it, and say when only a link came through** (companion-only, effort S). Apps: iPhone, iPad, Android phone, Chrome, Safari, DC-1 Inbox.

- [ ] [Chrome] A Playwright fixture page that shows text only with a login cookie arrives with that text in the received HTML.
- [ ] [Chrome, Safari, iPhone] Sent HTML has no `<script>` except JSON-LD, no `on*` attributes and no form values (unit test with a token in a hidden input).
- [ ] [iPhone] Sharing a URL from Notes shows the "Only the link came through" line with Open in Safari; sharing a page from Safari never shows it.
- [ ] [Inbox] Every row states "Page as you saw it" or "Link", and TalkBack reads it.

**F04 Share in place: done in a second, never opens the app** (companion-only, effort M). Apps: iPhone, iPad, Android phone, Mac, Chrome, Safari.

- [ ] [iPhone] From Safari, Notes and Files the share sheet closes no later than 2.5 s after tapping Daylight (1.5 s Options window included), and the host app scrolls immediately afterwards, on iOS 17, 18 and 26.
- [ ] [iPhone] Sharing a 9 MB PDF from Files keeps the extension under 60 MB peak memory (Instruments) and the item reaches "On the relay" after the extension has closed.
- [ ] [Android] The share activity finishes within 1 s; the upload completes after the app is swiped away.
- [ ] Tapping Options inside the window stops the countdown and shows the choices; doing nothing sends with the last-used choices.

**F07 Offline-first outbox** (companion-only, effort M). Apps: iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender.

- [ ] In flight mode, sharing from each app shows "Waiting for connection" (not "Not delivered"); with the network back the item goes within a minute while the app runs, and on iPhone/Android also with the app closed within the OS's background window.
- [ ] The queue shows waiting items with Cancel and a count.
- [ ] Twenty links queued offline go out in order without a 429 against the mock relay configured with ntfy.sh's burst limits.

**F08 Your Daylight in the share sheet's top row** (companion-only, effort S). Apps: Android phone, iPhone, iPad, Mac, Windows.

- [ ] [Android 13 and 14] After one send, sharing a link from Chrome shows the Daylight's name in the Direct Share row; tapping it sends with no other screen and the item appears in history.
- [ ] Unpair removes the shortcut; the shortcut id survives an app update.

**F09 Automation: Shortcuts, Siri, URL scheme, Android intent, command line** (companion-only, effort M). Apps: iPhone, iPad, Mac, Android phone, Windows, Web sender.

- [ ] A Shortcut "Send link to Daylight" returns an entity with an id and status "sent"; "Get delivery status" returns "delivered" after the Daylight acks.
- [ ] The Siri phrase works on a device.
- [ ] The URL scheme shows the confirmation sheet unless both `quick=1` and the setting are on; a test web page cannot send silently.
- [ ] `daylight-send https://example.com --json` prints {"id":..., "status":"sent"} and exits 0; with `--wait` it exits 0 when delivered and 2 on timeout.
- [ ] An empty or unreadable file passed to Send file fails with a sentence and is never sent as 0 bytes.

**F10 Send as: page, clean article, link or selection, with a thin-content check** (companion-only, effort M). Apps: Chrome, Safari, iPhone, iPad.

- [ ] On Readability's test pages plus ten news fixtures, Clean article keeps at least 90% of the expected body text and drops navigation and footers.
- [ ] A page with under 150 extracted words shows the thin warning; choosing full page sends the page HTML.
- [ ] The chosen mode is remembered per site across browser restarts.
- [ ] Review renders within 1 s for a 1 MB page and the edited title is the title sent.

**F11 Send a selection as an excerpt** (companion+inbox, effort S). Apps: Chrome, Safari, iPhone, iPad, Mac, Android phone, DC-1 Inbox.

- [ ] Selecting a paragraph and choosing Send selection delivers one item that shows the quote, the source link and the date in the Reader; the full article is not sent.
- [ ] Text with no URL arrives as a Markdown document the Reader opens.
- [ ] Excerpt HTML contains only allow-listed tags (unit test) and selections over 50,000 characters are trimmed with a note saying so.

**F15 Arrival notification with actions, and Inbox health** (companion+inbox, effort S). Apps: DC-1 Inbox.

- [ ] Every arrival posts one notification (grouped when several) whose three actions work; TalkBack reads the title and source.
- [ ] Stopping the service from Android's Task Manager shows the warning card on next open and a notification within 15 minutes.
- [ ] Lab Inbox screens render their final state with animations disabled, and no state is shown by colour alone.

**F16 Smart intake: unwrap Apple News, AMP, Substack and tracking links** (companion-only, effort S). Apps: iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender.

- [ ] At least 40 vectors (Apple News text share, Substack app link, AMP, utm, Facebook redirect, plain URL) pass in JS, Kotlin and Swift.
- [ ] Sharing from Apple News on an iPhone sends the article URL, not a text note.
- [ ] A URL whose only change is removed tracking parameters is otherwise byte-identical.

**F26 Setup coach, test send and diagnostics** (companion-only, effort S). Apps: iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender, DC-1 Inbox.

- [ ] The test article reaches the Reader from every app and the checklist ticks Delivered and In your Reader.
- [ ] Copied diagnostics contain no URL, title, pairing code or topic (unit test on a fixture log).
- [ ] Each unmet check has a button that opens the right system settings screen.

**F33 Send the copied link** (companion-only, effort S). Apps: iPhone, iPad, Android phone, Mac, Windows, Web sender, Chrome, Safari.

- [ ] Copy a link in Safari, open the app: the chip appears with no iOS paste alert; tapping sends the link.
- [ ] No chip appears for a non-URL clipboard; on Android 13 no "pasted from" toast appears before the tap.

**F34 Full browser context menu and keyboard shortcuts** (companion-only, effort S). Apps: Chrome, Safari.

- [ ] Each menu entry sends the right kind (one e2e test per entry).
- [ ] Shortcuts are listed at chrome://extensions/shortcuts; "dl example.com/story" in the omnibox sends the link; hiding entries removes them.

#### Wave 2

**F06 Send back from the DC-1 to my phone or Mac** (companion+inbox, effort M). Apps: DC-1 Inbox, iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender.

- [ ] On the DC-1, Reader > Share > "Send to my phone or Mac" with a 5 MB annotated PDF: the file appears in the iPhone app's From your Daylight within a minute of opening the app, and its SHA-256 matches.
- [ ] Notes exported as Markdown arrive as a .md the iPhone can Share and the Mac can open.
- [ ] An item over 9 MB is refused on the DC-1 with the standard sentence.
- [ ] Returned file names pass the safe-file-name vectors; a name containing "../" is saved inside the app's folder.
- [ ] The phone install shows only "Send to Daylight" and the Inbox install only "Send to my phone or Mac" in the share sheet.
- [ ] The Inbox item shows "Sent" then "Received by <device>"; a non-Lab sender ignores the return topic.

**F12 Note, tags and "read now / quietly / hold" at send time** (companion+inbox, effort M). Apps: iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender, DC-1 Inbox.

- [ ] A note typed on the iPhone shows on the Inbox row and, for a page, as the first line of the article in the Reader.
- [ ] Tag chips filter the Inbox list; tags are trimmed; a new tag can be created from the keyboard.
- [ ] Read now on a PDF opens it in the Reader on arrival with Documents = Ask; Add quietly adds it without opening.
- [ ] A non-Lab v1.1 Inbox receives the same item normally (version-skew suite).
- [ ] With no interaction, Quick Send publishes 1.5 s after the tap with the last destination.

**F13 Big files on the same Wi-Fi (direct, no server)** (companion+inbox, effort L). Apps: DC-1 Inbox, iPhone, iPad, Mac, Android phone, Windows.

- [ ] A 120 MB PDF from the Mac to the DC-1 on the same Wi-Fi reaches the Reader with a matching SHA-256 and visible progress, in under 3 minutes on a home network.
- [ ] Dropping Wi-Fi mid-transfer and restoring it resumes without re-uploading completed parts.
- [ ] A frame not sealed with the pairing key gets 400 and is not stored; more than 50 bad requests a minute get 429.
- [ ] On another network the sender shows the sentence within 3 s and does not hang.
- [ ] The port is closed when Instant delivery is off and the Inbox is not open.

**F22 Send several tabs or items as one issue** (companion-only, effort M). Apps: Chrome, Safari, Mac, Windows.

- [ ] Ten open tabs become one EPUB with ten chapters and a contents page; a tab that cannot be read (chrome://) is listed as skipped and the rest still arrive.
- [ ] The size estimate is shown before sending; over 9 MB the user can drop images or split.
- [ ] The EPUB passes epubcheck.

**F23 PDFs stay PDFs, and "Print to Daylight" from any app** (companion-only, effort M). Apps: Mac, Android phone, iPhone, iPad, DC-1 Inbox.

- [ ] [Mac] Print > PDF > Send to Daylight from TextEdit delivers a PDF with the same page count.
- [ ] [Android] Printing a Chrome page to the Daylight printer delivers a PDF.
- [ ] Delivered PDFs match the sender's SHA-256.

**F24 Image diet: self-contained pages tuned for grayscale** (companion-only, effort M). Apps: Chrome, Safari, iPhone, iPad.

- [ ] A fixture page with 20 lazy WebP images shows all of them in the Reader with the tablet offline after delivery, and the page is at most 6 MB.
- [ ] The grayscale and No images settings take effect; the budget note appears when images are dropped.

**F29 Mac power moves** (companion-only, effort M). Apps: Mac, Windows.

- [ ] A PDF dropped on the menu-bar icon is sent.
- [ ] A file saved into ~/Daylight/Send is sent once and moved to Sent/ after Delivered; saving the same bytes again does not resend.
- [ ] The Services entry appears for selected text in TextEdit and the Quick Action in Finder.

**F30 Scan paper to a clean PDF** (companion-only, effort M). Apps: iPhone, iPad, Android phone.

- [ ] Scanning five pages produces one PDF of at most 2 MB at the default quality that opens in the Reader with five readable pages.
- [ ] Cancelling leaves no item behind.

**F31 Chrome Reading List to Daylight** (companion-only, effort S). Apps: Chrome.

- [ ] An entry added to the Reading List in Chrome on Android reaches the DC-1 within 15 minutes while desktop Chrome runs, and is marked read after delivery.
- [ ] Turning the setting off stops it; no entry is sent twice.

**F32 "Already sent" notice and duplicate guard** (companion-only, effort S). Apps: iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender.

- [ ] Sending the same URL (or a tracking-parameter variant) twice within 30 days shows the notice before the second send; the same file bytes too.
- [ ] With "Remember what I sent" off, nothing is stored (storage inspection).

**F41 Android Quick Settings tile and "Send to Daylight" in the text-selection menu** (companion-only, effort S). Apps: Android phone.

- [ ] The tile sends the clipboard URL without opening the app on Android 13 and 14 and shows the result as its subtitle.
- [ ] The add-tile prompt appears once after the first clipboard send and never again after a refusal.
- [ ] Selecting text in Chrome shows "Send to Daylight" and sends an excerpt.

**F42 iPhone controls and widgets** (companion-only, effort M). Apps: iPhone, iPad.

- [ ] The controls appear in the Control Center gallery and require unlock from the Lock Screen; the flow never shows a paste alert.
- [ ] The widget reflects a status change within a minute while the app runs.

**F48 Verified delivery and private items** (companion+inbox, effort S). Apps: iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender, DC-1 Inbox.

- [ ] The hash shown on the sender and the Inbox match for the same item.
- [ ] An incognito send asks first; the private item's notification has no title and the item leaves Inbox history after hand-off.

**F50 iPad: sidebar layout, drag and drop, keyboard** (companion-only, effort S). Apps: iPad.

- [ ] Dragging a PDF from Files onto the app sends it; Cmd-V on the main screen sends a copied link.
- [ ] At one-third split width no state label is truncated.

**F51 No lock-in: export, your own relay, a documented protocol** (companion-only, effort S). Apps: iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender, DC-1 Inbox.

- [ ] Exports open in a spreadsheet; exporting the pairing requires Face ID, Touch ID or the device passcode.
- [ ] Switching to a self-hosted ntfy that passes the relay check keeps working end to end.

#### Wave 3

**F14 Morning stack: one issue with a contents page, never repeating** (companion+inbox, effort L). Apps: DC-1 Inbox, iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender.

- [ ] Three pages and two links sent to the stack before 07:00 arrive as one EPUB with five contents entries at 07:00 (or the first wake after), and none arrives on its own.
- [ ] No item appears in two stacks, across restarts and sender re-sends of the same id (ledger test).
- [ ] No stack is made on a day with nothing held.
- [ ] The EPUB passes epubcheck and its contents links work in the Reader.
- [ ] Send now builds the stack at once.

**F20 "On your Daylight": see and steer what waits in the Inbox** (companion+inbox, effort M). Apps: DC-1 Inbox, iPhone, iPad, Mac, Android phone, Chrome, Web sender.

- [ ] An item held on the DC-1 appears on the iPhone within 2 minutes; Send now from the iPhone hands it to the Reader at the Inbox's next poll (seconds with Instant delivery).
- [ ] Commands are idempotent (a double tap acts once) and Remove asks first and goes to the Inbox trash (F40).

**F25 Read-later connectors pulled by the Inbox** (companion+inbox, effort M). Apps: DC-1 Inbox, iPhone, iPad, Mac.

- [ ] With a test Instapaper account, tagging an article "daylight" makes it arrive in the Reader within an hour (or at once with Check now), never twice.
- [ ] Removing the token stops polling; the token never appears in logs or diagnostics.

**F28 YouTube videos as readable transcripts** (companion-only, effort M). Apps: Chrome, Safari.

- [ ] Three fixture videos (manual captions, auto captions, chapters) produce articles in the original language with chapter headings and working timestamp links.
- [ ] A video without captions offers to send the link.

**F35 RSS feeds checked by the Inbox** (companion+inbox, effort M). Apps: DC-1 Inbox, Chrome, Safari, Mac, Web sender.

- [ ] Subscribing to a fixture feed delivers nothing at first; a new entry arrives after the next hourly poll.
- [ ] The daily cap and mute words hold; RSS 1.0 (rdf), Atom and WordPress fixtures parse.
- [ ] `dumpsys jobscheduler` shows at most one feed job an hour and none off Wi-Fi.

**F38 Notes into Obsidian, a folder or Readwise from the Mac** (companion-only, effort M). Apps: Mac, iPhone, iPad.

- [ ] Returning notes for the same document twice updates one file and keeps text the user added outside the managed region.
- [ ] File names are sanitised; a Readwise push is not repeated on re-export.

**F39 Handwriting to text for returned pages** (companion-only, effort M). Apps: Mac, iPhone, iPad, Android phone.

- [ ] On a fixture set of handwritten pages the transcript reaches at least 80% word accuracy on the Mac.
- [ ] A network monitor shows no traffic during recognition; the original file is unchanged.

**F40 Inbox triage and housekeeping** (companion+inbox, effort M). Apps: DC-1 Inbox.

- [ ] In hold mode an arriving item does not reach the Reader until an action is taken.
- [ ] Delete moves to the trash and Undo restores it; retention never removes an item that was not handed to the Reader.
- [ ] The storage bar is within 5% of the Inbox directory's size.

**F43 Paper mode for PDFs: crop margins, blank note pages, writing margin** (companion-only, effort M). Apps: Mac, iPhone, iPad, Android phone.

- [ ] A 10-page fixture with "blank page after each" arrives with 20 pages and selectable text.
- [ ] Crop reduces the white margin (bounding-box test); the sender's original file is unchanged.

**F44 Send a paper by DOI, arXiv id or PubMed id** (companion-only, effort M). Apps: iPhone, iPad, Mac, Android phone, Web sender.

- [ ] Fixtures for an arXiv id, a DOI with an open copy and a DOI without one behave as described; the file name follows the pattern.
- [ ] A non-PDF response is never sent as a PDF.

**F45 X/Twitter threads as one article** (companion-only, effort M). Apps: Chrome, Safari.

- [ ] A fixture DOM of a 12-post thread produces 12 posts in order with replies by others excluded.
- [ ] A timeout ends gracefully with the count.

**F46 Guest drop: let someone send to this Daylight once** (companion+inbox, effort M). Apps: DC-1 Inbox, Web sender.

- [ ] A guest sends a PDF from a laptop via the QR; the tablet shows Approve; Decline discards it.
- [ ] After an hour or Stop, further guest sends are not received; the guest secret cannot read the main pairing's topics.

**F47 Import a reading list** (companion-only, effort M). Apps: Mac, Web sender.

- [ ] A 600-row Pocket CSV sends 50 a day by default with a progress line; duplicates are skipped; a restart resumes.
- [ ] A seven-day soak against the mock relay with ntfy.sh limits produces no 429.

**F49 Pairing fingerprint and safe handling of what arrives** (companion+inbox, effort S). Apps: iPhone, iPad, Android phone, Mac, Windows, Chrome, Safari, Web sender, DC-1 Inbox.

- [ ] The fingerprint vectors pass in JS, Kotlin and Swift and the same words show on every app for one pairing.
- [ ] Fuzzed file names never escape the receiving app's directory.

#### Wave 4 (stretch)

**F56 Listen on the phone** (companion-only, effort M). Apps: iPhone, iPad, Android phone.

- [ ] A sent article plays from the history row, continues to the next and resumes after interruption; turning Listen off deletes the kept text.

**F57 Zotero plugin: Send to Daylight, annotations back** (companion+inbox, effort L). Apps: Mac, Windows.

- [ ] Tagging an item @daylight sends its PDF once; the annotated PDF returned from the DC-1 attaches beside the original; running twice creates no duplicates.

**F59 Import from Safari Reading List (Mac)** (companion-only, effort M). Apps: Mac.

- [ ] With access granted, unread entries appear in a preview; sending the chosen ones uses the import throttle (F47); nothing in Safari changes.

**F60 Keyboard-first quick send and a command palette** (companion-only, effort S). Apps: Mac, Web sender.

- [ ] The panel opens with the hotkey, Enter sends, Esc closes; the palette works without a mouse and with a screen reader.

**F61 Make scans searchable before sending (OCR)** (companion-only, effort M). Apps: Mac, iPhone, iPad, Android phone.

- [ ] A 20-page scan becomes text-searchable in the Reader; Cancel leaves the original to be sent unchanged.

**F62 arXiv and HTML papers with readable maths** (companion-only, effort M). Apps: Chrome, Safari, Mac.

- [ ] Three fixture papers arrive with every equation visible in the Reader; a failure sends the PDF instead.

**F63 Warn about fake redactions and hidden metadata before sending** (companion-only, effort M). Apps: Mac.

- [ ] A fixture with a fake redaction triggers the warning; a properly redacted file does not.

**F67 Watched folder on the tablet** (companion+inbox, effort M). Apps: DC-1 Inbox.

- [ ] A PDF copied into the watched folder reaches the Reader within the next check, once.

## 4. Next: features that need the Reader or the server

These stay out of the companion Lab builds until their prerequisite exists. Per LAB-DECISIONS.md, server and AI features still appear in Lab with the "needs" sentence; Reader features are built by the Mac mini session in the side-by-side Reader copy behind the Reader's own Labs switch, on the lab tablet (Rooted 2) only.

### 4.1 Reader changes

| Feature | What the Reader would need |
|---|---|
| [F05](#f05) Notes come home automatically | Reader: a highlight table with stable ids and an export event (broadcast to com.daylight.share with the batch as a content:// URI), Markdown/JSON format with anchors, and a `daylightreader://open?item=&loc=` deep link. Builds on F06's return topic. |
| [F18](#f18) Opened, reading progress and finished, back on the phone | Reader: accept an item id extra on SAVE_PAGE/ACTION_SEND and keep it with the saved item; broadcast reading events to com.daylight.share. Inbox: relay them in acks. |
| [F21](#f21) Manage the Reader's reading queue from the phone | Reader: a queue order field, an archive state, a trash, and a command intent the Inbox may call (signature-protected). |
| [F52](#f52) Reading aids in the Reader: ruler, spacing, fonts, opt-in emphasis | Reader Labs work by the Mac mini session. |
| [F53](#f53) Read aloud on the DC-1 | Reader Labs work. |
| [F54](#f54) LivePaper reading ergonomics: whole-page turns, no motion | Reader Labs work. |
| [F55](#f55) Open where I stopped reading on the phone | Reader: accept an anchor extra on SAVE_PAGE and scroll to it. Sender capture is small and can ship with it. |
| [F66](#f66) Highlight and library sync across devices | The Reader's library-sync plan (PowerSync, a loose end in the Reader project). |
| [F68](#f68) Reading stats | F18. |

**Reader-side halves of Lab features** (each Lab feature works without them; these make it complete):

- **F01:** Confirm document imports back to the Inbox with the item id, so PDFs show "In your Reader" too; and fix the ImportActivity bug that dropped a share arriving while an earlier import's "open" event was pending (DEVICE-CHECKS.md, round 2).
- **F10:** Tell the companions whether SAVE_PAGE HTML is run through the Reader's own article extraction (it decides whether "Clean article" or "Page" should be the default).
- **F12:** Accept note, tags and collection extras on SAVE_PAGE and ACTION_SEND, file items into collections and show the note; a deep link to open a just-saved page for "Read now".
- **F06:** A "Send back to my phone or Mac" item at the top of the Reader's share menu, and an optional automatic return of notes when a document is finished (with F05).
- **F14:** Optionally show stacks as their own collection.
- **F24:** Confirm that data: URI images render in saved pages within the 8 MiB cap.
- **READER-INTEGRATION.md:** The Inbox built into the Reader, which removes the "Display over other apps" workaround and the second app.

### 4.2 Daylight server (Cloudflare Worker)

| Feature | What it would take |
|---|---|
| [F02](#f02) Big files through the Daylight server | Deploy the Worker with R2 (server/DESIGN.md section 6), confirm the `ntfy-attach` probe (an external Attach: URL is listed and kept 12 h), and add the hosted-upload client module to each sender. No protocol change. |
| [F19](#f19) Email-in address for newsletters and documents | A domain on Cloudflare DNS, R2, and in practice Workers Paid for reliable parsing (followup-verify: free-plan handlers "may exceed these limits and fail"). |
| [F36](#f36) Server feeds and digests while the tablet sleeps | Deploy the Worker (Cloudflare secrets); full-text extraction would need Workers Paid. |
| [F37](#f37) AI summary, "explain this", ask and translate (Claude) | The Worker plus the ANTHROPIC_API_KEY secret (server/DESIGN.md section 9). |
| [F58](#f58) Personal webhook for IFTTT, Zapier, Make and n8n | The Worker. |
| [F65](#f65) Audio edition (server text-to-speech to MP3) | A TTS provider choice and key from the user. |
| "Clean this link for me" (server-side article extraction) | Workers Paid: Readability measured 40-526 ms of CPU against the free plan's 10 ms (followup-verify section 5). Extraction stays on the devices. |

Everything here follows `server/DESIGN.md`: deploy from GitHub Actions once `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `DAYLIGHT_SERVER_CODE` exist; Claude features also need `ANTHROPIC_API_KEY`; R2 for files and mail. Content sent for AI or email-in is not end-to-end encrypted and the apps say so the first time.

## 5. Do not copy

Pitfalls the research says to avoid, with where they were seen.

- **Saying "sent" or "success" when the server merely accepted it.** Calibre's "Email successfully sent" (SMTP only), Amazon rejecting later with E999, Immich reporting success on a 500 (#2531), a Taildrop Shortcut "succeeding" with 0-byte files (#18537). Only an ack listing the id is "Delivered".
- **Opening the main app after a share, or freezing the host app.** Karakeep #237 and #3018 (a cross-platform share library on iOS 26). Use native share extensions and translucent activities.
- **Forcing a form on every save, or autocomplete that adds tags by itself.** Omnivore #2366, Wallabagger #334, Obsidian #634 (save button hidden behind the keyboard).
- **Digests that repeat items, or re-downloading what the user deleted.** Instapaper's free digest "includes the same articles in the daily packages lots of times" (MobileRead); KOReader #5320. Keep a ledger.
- **Deleting things the user did not delete.** The wallabag KOReader plugin removes items that fall off its 30-item list; AnnotationSync #87 turned one new highlight into 31 deletions across devices; Calibre-Web's late shelf sync archived books. Never infer deletes from diffs; destructive actions need an ack, confirmation and a trash.
- **Converting PDFs the user did not ask to convert, or degrading layout silently.** Amazon's "convert" subject and its silent E016 fixed-layout fallback (KindleEar #741, bookorbit #1205/#1442).
- **Colour as the only signal.** "On black-and-white e-ink, a red wash and a gray wash look identical" (Readest #6048). The DC-1 is grayscale.
- **Bionic Reading or any reading aid on by default.** Strong opposite reactions in KOReader #9109; maintainers found no evidence for speed claims (Readest #6235). Optional, per user, one tap off.
- **Fetching logged-in pages on a server, or running article extraction on the free Worker.** Karakeep's broken headless snapshots; Readability does not fit 10 ms of CPU. Capture and extract on the device.
- **Reading the clipboard silently or in the background.** iOS paste alerts, Android 12+ toasts, and stale clipboard content sent by mistake. Check metadata, read on a tap.
- **Asking a server whether a page was already saved.** It leaks browsing history (the Omnivore #2747 debate); Karakeep shipped its badge from a local cache, opt-in.
- **Requiring "read and change all your data on all websites".** It slows Chrome Web Store review and scares users. Keep `activeTab` plus optional, per-site host access.
- **Auto-accepting from unknown senders or auto-opening links.** RQuickShare's maintainer refused auto-accept without device verification (#224); Taildrop #15670 dropped a file "without recipient approval". Paired devices are trusted; guests always need Approve.
- **Changing the protocol or pairing silently in an update.** KDE Connect 1.33 broke pairing for everyone (GSConnect #1932, 63 comments). Version every Lab change and test the skew.
- **Shutting down or paywalling with little notice.** Omnivore gave about two weeks and an ElevenReader-only export; Pocket deleted data; Instapaper moved Kindle sends behind Premium. Keep the protocol open, the relay replaceable and the history exportable.
- **Building on undocumented vendor APIs.** Amazon moved Send to Kindle to a new API on 13 Oct 2026 and broke stkclient's low-level calls; "Amazon may change or block the undocumented API at any time" (KindBeamer).
- **Email-in addresses derived from a name.** They leak identity and attract spam (Omnivore #2198). Random and revocable.
- **Letting an AI step block delivery.** A DIY digest silently stopped when its AI quota ran out (kindle-daily-digest). Deliver first, summarise if you can.
- **Long uploads in places the OS kills.** Chrome kills an extension service worker when a fetch takes over 30 s; iOS share extensions have far less memory than apps. Chunk uploads, run them from a page or a background URLSession, stream files from disk.
- **Promising iPhone web share targets.** Safari does not support Web Share Target (WebKit bug 194593). On iPhone the share path is the native extension or a Shortcut.
- **Stating stale limits.** The web sender still says "up to 64 MB" and PROTOCOL.md's older text said 15 MB attachments. ntfy.sh takes 2 MB per file; say 9 MB per item everywhere.
- **Shallow "integrations" that drop data without saying so.** Kobo's Instapaper link syncs only the main list, with no tags, highlights, notes, PDFs or folders, and a user went back to KOReader after a month. If something is not carried, say so.
- **Battery-hungry listeners the user did not choose.** "Device runtime cut by half running tailscale always on" (Tailscale #3363, 76 reactions); KOReader's feeds left Wi-Fi on. Instant delivery stays a visible choice; background jobs are hourly and Wi-Fi-only.
- **Rotating or partial progress messages.** PairDrop users disliked messages that switch every 5 s (#122). Show percent, speed and time left together, only for transfers longer than about 10 s.
- **Shortcuts that clash with editing keys.** Instapaper's Ctrl+I fought with italics. Keep Alt/Option+Shift combinations and let users change them.
- **Screen mirroring and Android chat bubbles.** No evidence of demand for a reading companion, real battery and complexity costs.

## 6. Questions for you

1. **Lab on for people who already have the app?** I assumed yes: the first update with Lab switches it on once and says so. Say if you would rather keep it off for existing installs.
2. **Morning stack (F14):** default off, 07:00, at most 15 items? Should the Daylight fetch link-only items itself (no cookies) so they are readable in the stack, or list them as links?
3. **Send back (F06):** should an item sent from the Daylight go to every paired phone and computer, or should the tablet ask which one?
4. **On-device summaries (F64):** your rule is "AI = Claude with my key". Apple Intelligence can summarise on the iPhone or Mac with no key and no server, keeping end-to-end encryption. Add it as a second option, or keep AI Claude-only?
5. **Read-later connectors (F25):** OK for the DC-1 Inbox to talk to Instapaper or Readwise directly with a token stored on the tablet? It does not touch our relay, but it is not our end-to-end path.
6. **More user voice:** the researchers could not reach Reddit, YouTube or the app stores. When the search quota resets, should I re-run that part (the plan is ready) before Wave 2 starts?

## Sources

Raw notes, each with its own source index: `raw/readwise-reader.md`, `raw/read-later-apps.md`, `raw/send-to-kindle-kobo-pocketbook.md`, `raw/eink-tablets.md`, `raw/cross-device-transfer.md`, `raw/browser-clippers.md`, `raw/mobile-share-patterns.md`, `raw/newsletters-rss-automation.md`, `raw/highlights-roundtrip.md`, `raw/community-voice.md`, and the four follow-ups (`raw/followup-first-hand-user-voice-daylight-and-store-reviews.md`, `raw/followup-uncovered-products-and-platform-scorecards.md`, `raw/followup-underserved-user-groups-and-accessibility.md`, `raw/followup-verify-gating-claims-and-conflicts.md`). Current apps and limits: `../README.md`, `../share/PROTOCOL.md`, `../share/NTFY-FACTS.md`, `../server/DESIGN.md`, `../DEVICE-CHECKS.md`.
