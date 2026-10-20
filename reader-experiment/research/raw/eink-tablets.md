# E-ink / pen tablets: content pipelines (raw research notes)

Angle: how reMarkable, Boox, Supernote, Kobo (Elipsa / Libra Colour), Kindle Scribe and the Daylight DC-1 itself get articles,
web pages and PDFs onto the device, which pipeline is most seamless, and what would make a DC-1 owner say "finally".
Project context: "Send to Daylight" companions (iPhone, Android, Mac, Chrome/Safari, web, DC-1 Inbox) feeding the Daylight Reader.
Compiled: 2026-10-20.

## 0. READ FIRST: this run could NOT do live web research

What happened (so the next agent can re-run this angle properly):

- **WebSearch: refused for every query.** All 8 of my first queries returned "this turn's web search budget is used up
  (limit: 200 WebSearch calls per turn, shared by every agent in it)". I ran zero successful searches.
- **WebFetch: dead for every host.** `getaddrinfo ENOTFOUND` for all 9 hosts I tried: support.remarkable.com,
  chromewebstore.google.com, remarkable.com, daylightcomputer.com, www.amazon.com, support.supernote.com, apps.apple.com,
  en.wikipedia.org, help.boox.com. Two sibling notes files report the same.
- **Proxy status probe was denied** by the permission classifier (I tried to read `/root/.ccr/README.md` and call the proxy
  status endpoint). I did not try to get around that.
- **I did not route around the search limit.** The budget notice forbids querying search engines through curl/wget or using
  third-party readers, proxies or archive services. So: no HN Algolia API, no redlib/Reddit mirrors, no web.archive.org,
  no "reader" proxies. (The task text suggested HN Algolia and redlib; given the limit notice I skipped them.)

Consequence: **there are NO fresh web sources and NO verbatim user quotes in this file that I retrieved myself.**
Everything is in one of three evidence tiers. Every claim below carries a tier tag:

| Tag | Meaning | How much to trust |
|---|---|---|
| **[LOCAL]** | I read it in a file in this environment (the repo, or the Daylight Reader source snapshot at `/home/user/a12k-a2b/daylight-reader`). | High: the user can open the same file. |
| **[LOCAL-2ND]** | A prior session's research file in this environment states it and cites a URL. I did NOT open that URL. | Medium: quote/claim as relayed; the cited URL is given so it can be re-checked. |
| **[KNOWLEDGE]** | My own background knowledge (training data, reliable to roughly mid-2026, thinner for recent months). Confidence H / M / L is given per claim. | Unverified this session. Treat as hypotheses to confirm. No URLs are claimed as read. |

A follow-up agent with working network should treat section 9 as its to-do list.

Files read for [LOCAL] / [LOCAL-2ND] material:
- `/home/user/MHW/reader-experiment/README.md`, `LAB-DECISIONS.md`, `READER-INTEGRATION.md`, `share/PROTOCOL.md`, `share/NTFY-FACTS.md`
- `/home/user/a12k-a2b/daylight-reader/README.md`, `DECISIONS.md`, `CONTRACTS.md`
- `.../daylight-reader/research/07-dc1-device-probe.md`, `parity-switching.md`, `gallery-prior-art.md`, `snap-zoom-spec.md`,
  `features-27/survey.md`, `features-27/spec-read-later.md`, `ui-study/read-later.md`, `08-reader-ux-and-design-language.md`
- sibling notes `/home/user/MHW/reader-experiment/research/raw/read-later-apps.md` and `readwise-reader.md`

---

## 1. The Daylight DC-1 today: how do owners get content on?

### 1.1 What the device and Reader are [LOCAL]
- Daylight DC-1: Android 13, 10.5" LivePaper grayscale reflective LCD (1184x1584, 120 Hz), Wacom I2C EMR pen with two buttons.
  Google Play and GMS are present (`com.android.vending`, `com.google.android.gms`), adb install works, 40 third-party apps were
  already sideloaded on the dev unit. Source: `daylight-reader/research/07-dc1-device-probe.md` (device probe of JP4R03005; app
  lists around lines 476-492).
- Installed on the probe units: Chrome 153, Kindle 8.157, Noteshelf, Concepts, Obsidian, Notion, Google Docs/Sheets, Google Drive,
  Xodo (was default PDF handler), Google TTS. Daylight-authored apps: SolOS launcher (40 px taskbar), `com.daylightcomputer.browser`
  (the Daylight Browser), `com.daylightcomputer.paper` (registers `application/pdf` and `image/*` VIEW/SEND on one unit),
  `...sharesheet`, `...paste`, `...controlcenter`, `...screenshot`, `club.daylightcomputer.companion` 0.2.
- WebView is Chromium 101 (Chrome 153 is installed but cannot be the WebView provider). Same file.
- Daylight Reader (0.27.843 source snapshot): PDF (own PDFium build), EPUB (Readium), DOCX/PPTX/Markdown/HTML/TXT converted on
  device, pen ink, highlights/notes, voice notes, My Index, **read-later**, dark mode, two columns. Kindle-format files show
  "not supported yet". Source: `daylight-reader/README.md`, `DECISIONS.md` line ~35.
- Readwise's own docs name the Daylight alongside BOOX as a supported e-ink target for Reader (E-ink Mode). Source [LOCAL-2ND]:
  sibling `readwise-reader.md` section 4 citing https://docs.readwise.io/reader/docs/faqs/eink . Readwise changelog update #12
  (2025-06-19) is cited there as adding E-Ink mode preview for Boox and Daylight.

### 1.2 The ways content reaches the Reader today [LOCAL]
1. **Open-with / share / file picker** for downloaded PDF, EPUB, MD, DOCX, PPTX, HTML, TXT, including unlabelled octet-stream
   downloads (DECISIONS 26, "verified on JP5 on 2026-10-02"). A "Find my books in Downloads" picker exists because Android 11+
   refuses folder grants on Downloads (DECISIONS ~lines 729-740).
2. **Read-later (behind a switch):** share a link (Chrome share sheet puts "Title\nURL" in EXTRA_TEXT), paste a URL in the
   Library, or "Save to Reader" from the **Daylight Browser**, which sends an explicit `SAVE_PAGE` intent carrying the page HTML
   as rendered (so logged-in/paywalled pages work). Spec: `features-27/spec-read-later.md` section 4; intent action
   `com.daylightcomputer.reader.action.SAVE_PAGE`.
3. **Google Play apps** (Readwise Reader, Kindle, Drive, Dropbox etc.) since GMS is present; plus adb/USB for developers.
4. **Send to Daylight (this project):** pair by QR/code, share link/page/file from iPhone, Android, Mac, Chrome, Safari, web;
   E2E encrypted via ntfy.sh; delivery receipts. [LOCAL] `reader-experiment/README.md`.

### 1.3 What a DC-1 owner can NOT do today [LOCAL]
- No email-in / forward-a-newsletter (DECISIONS 27: "needs a small server"; Anjan: "that would also be really incredible").
- No library sync across devices yet (PowerSync plan is a loose end), no desktop companion app other than ours.
- Highlights/notes leave only through the share sheet; automatic notes-to-folder (LB-08), all-notes export (LB-09), Readwise/Notion
  push (LB-59) are Labs ideas, not built. `survey.md` rows F.
- No watched import folder yet ("LE 6"), no RSS yet (LB-53), no Pocket/Instapaper/Matter/Readwise import yet (LB-52).
- **Large files over our current relay:** `share/NTFY-FACTS.md` (measured 2026-10-20): ntfy.sh accepts at most **2 MiB** per
  attachment (2,097,153 bytes refused), ~20 MB per sender IP at a time, 250 messages and 200 MB per visitor per day, attachments
  kept 3 h. This conflicts with `share/PROTOCOL.md` section 4 ("File 64 MiB", "Chunk 12 MiB"), which was written from the docs'
  15 MB figure. **A 100 MB textbook PDF cannot go through public ntfy.sh today.** Every e-ink competitor below handles big PDFs
  through its own cloud or LAN. This is the single biggest gap versus them. (Flag for the protocol v1.1 owner.)

### 1.4 What I could NOT find about "how Daylight owners do it" (honest gap)
No forum, Discord, YouTube or review evidence was retrievable. Pointers cited by sibling notes, unopened by me [LOCAL-2ND]:
- Daylight support site Reader section: https://support.daylightcomputer.com/getting-started
- DC-1 reviews: https://max.pm/posts/daylight_dc1/ ; https://lu.is/2025/01/reading-in-2024-tools/ (bought a DC-1 after trying Boox, praises
  warm screen) ; TechRadar https://www.techradar.com/tablets/the-daylight-dc-1-is-an-exciting-cross-between-a-kindle-and-an-ipad-with-an-lcd-screen-that-looks-like-e-ink
- HN "Thoughts on Daylight Computer" item 43098318 (https://news.ycombinator.com/item?id=43098318).
- r/daylightcomputer: one user said page sliding "feels like doomscrolling rather than reading a book" and wants a whole-page-turn
  gesture (sibling `readwise-reader.md` line 115, via a redlib mirror https://redlib.hbubli.cc/r/daylightcomputer/new ; relayed, unverified).
- Wikipedia: https://en.wikipedia.org/wiki/Daylight_Computer_Co. (says "Live Paper", 60-120 fps, per sibling note).

My inference (flagged as inference, [KNOWLEDGE]-grade): a DC-1 owner who finds an article on a phone currently has to open the
link on the tablet by hand, message it to themselves, or use a Play-store read-later app; that gap is exactly what Send to Daylight fills.

---

## 2. reMarkable (e-ink, pen) [KNOWLEDGE unless tagged; no live sources this run]

What I believe the pipeline is (confidence per item):
- **Cloud account is the spine (H).** Every route goes through the reMarkable cloud (my.remarkable.com) and syncs to the tablet over
  Wi-Fi whenever it is awake. Nothing is "paired" per device; you sign in once.
- **"Read on reMarkable" browser extension (M-H).** Chrome (and Chromium browsers) extension, free, launched around 2022. From a web
  page you click the toolbar button / context menu and choose between a cleaned, reflowable **article** and the page as a
  fixed-layout **PDF**. The article is converted to a reflowable document you can restyle (font, size) on the tablet and write on.
  Details I am unsure of (L): exact format (EPUB vs proprietary), destination folder choice, whether it needs a Connect subscription.
- **Mobile share (M).** iOS/Android reMarkable app shows up in the share sheet to send web pages, PDFs, EPUBs.
- **Desktop app (M-H).** Mac/Windows app: drag-and-drop PDF/EPUB; a "print to reMarkable" route exists on desktop (L-M).
- **Email (M for export, L for import).** Tablet can "send by email" a document as PDF (export). Whether you can email documents
  *to* the tablet is something I am not sure about (L).
- **Cloud drives (M).** Google Drive / Dropbox / OneDrive integration to pull files in and push exports out.
- **Connect subscription (M).** Paid tier; extended cloud retention, screen share and other extras. The free/paid split changed
  over time; verify.
- **Screen Share (M).** Mirror the tablet to the desktop app (presenting/demo).
- **Page tags since OS 3.16 (2024-12-18)** [LOCAL-2ND]: named tags on pages; Reader team cites it for My Index naming reuse.
  Source: https://remarkable.com/blog/remarkable-os-3-16-whats-new . Also OS 3.4 (2023-05-31) "search, read, highlight, repeat":
  https://remarkable.com/blog/software-update-3-4-search-read-highlight-repeat (titles only, as relayed in `survey.md` sources).
- **Community ecosystem (H that they exist):** `rmapi` (CLI for the cloud), `rmfakecloud` (self-hosted replacement cloud). Their
  existence signals demand for scriptable "send to" and for not depending on the vendor cloud.

Pitfalls (what people dislike):
- Refresh latency is "the dominant complaint across reMarkable reviews", "a full second or so" [LOCAL-2ND]:
  `daylight-reader/research/gallery-prior-art.md` section 12 (the DC-1's 120 Hz LCD is the opposite).
- PDF handling is clumsy: "Adjust view" crops margins by hand; two-column PDFs stay painful; cropped view does not scroll or pinch
  [LOCAL-2ND] `snap-zoom-spec.md` line 62, citing https://borednbookless.com/reading-pdfs-on-remarkable-2/ .
- Extension is browser-bound (Chrome/Chromium); subscription pressure and cloud dependence (M, general sentiment, unverified).

What it does best: one click from the browser you are already in, and the result is a reflowable, writable document.

---

## 3. Boox (Onyx; Android e-ink) [KNOWLEDGE unless tagged]

- **It is just Android with Google Play (H).** So Instapaper, Readwise Reader, Kindle, KOReader, Libby, Drive and Dropbox all work.
  Readwise Reader ships an E-ink mode for Boox [LOCAL-2ND, https://docs.readwise.io/reader/docs/faqs/eink]. A reviewer read an entire
  book in Reader on a Boox Poke5 [LOCAL-2ND, https://kadavy.net/blog/posts/boox-poke5-review/]; a Palma setup guide is at
  https://overkill.wtf/palma-setup . Instapaper arrived on the BOOX Palma 2 on 2026-08-11 [LOCAL-2ND, survey row G, "INSTA"].
- **BooxDrop (M).** Built-in transfer: the device shows a local address you open in any browser on the same Wi-Fi to drag files
  onto it, plus a cloud route.
- **Send2Boox / Onyx cloud (M).** Web (send2boox.com) and companion apps push files and "push read" items to the device through
  Onyx's cloud account; a Chrome extension for pushing web pages may exist (L).
- **NeoReader (H it exists).** The built-in reader/annotator. Pitfalls [LOCAL-2ND] from `parity-switching.md` section 2:
  laggy page switching on heavily annotated PDFs (https://help.boox.com/hc/en-us/community/posts/34857991656724-Page-switching-slow-on-large-heavily-annotated-pdfs),
  "annotation export format is unusable for getting back to the highlighted location in another app"
  (https://christiantietze.de/posts/2023/05/boox-neoreader-annotation-export-is-meh/), "often misses swipe gestures to turn pages"
  (TechRadar Boox Go 6 review, https://www.techradar.com/tablets/ereaders/onyx-boox-go-6-review).
- Other sentiment I recall but cannot source (L): privacy/jurisdiction worries about the Onyx cloud, update/firmware churn.

What it does best: flexibility (any Android app) and a local-network drop that needs no account.

---

## 4. Supernote (Nomad / Manta; e-ink, pen) [KNOWLEDGE unless tagged]

- **Browse & Access (M-H).** A toggle on the device runs a small web server on the LAN; open the shown address in a browser on a
  computer to upload/download files. Same idea as BooxDrop, no account.
- **Supernote Partner app (M).** iOS/Android companion for Wi-Fi/cloud transfer of files and notes; whether it has a share-sheet
  "send to Supernote" action is something I am not sure about (L).
- **Cloud sync (M).** Supernote's own cloud plus Dropbox / Google Drive / OneDrive sync built into the device.
- **Digest (M).** Highlight text in PDFs/EPUBs and keep it in a Digest list.
- Closed Android build: no Play Store on the devices (M), so no read-later app; content must arrive as PDF/EPUB.
- Documented PDF handling [LOCAL-2ND]: gesture zoom, PDF trimming, "half page view" (fixed halves)
  https://support.supernote.com/en_US/Tools-Features/epub-and-pdf-documents (as cited in `snap-zoom-spec.md` line 63/115).
- Supernote shipped then removed a handwriting-only antialiasing toggle; reviewers call small text "pixelated"
  [LOCAL-2ND] `daylight-reader/research/text/prior-art.md` line 40, 135 (cites a teddit mirror, low trust).

What it does best: local-first and privacy-friendly; weak at web articles (manual convert to PDF/EPUB).

---

## 5. Kindle Scribe (Amazon) [KNOWLEDGE + LOCAL-2ND]

- **Send to Kindle channels (H):** web uploader (https://www.amazon.com/sendtokindle), email to your `@kindle.com` address (sender must
  be on the Approved Personal Document E-mail list), desktop apps (Windows/Mac), phone share (Kindle app / Send to Kindle).
  A Chrome extension existed historically (L-M that a current one is maintained).
- **Formats (M):** PDF, DOCX, EPUB, TXT, RTF, HTML, images; MOBI support was being withdrawn (L, verify).
- **Scribe-specific (M):** you can write on sent PDFs/documents; notebooks export as PDF by email or via the Kindle app; Scribe 2
  (Oct 2024) added side-panel pen notes in reflowed text, Active Canvas, notebook AI summaries; later firmware added handwriting
  search, "Ask Notebooks", quick notes, and export to Google Drive / OneDrive / OneNote.
  [LOCAL-2ND] rows in `survey.md` cite https://blog.the-ebook-reader.com/2024/10/16/new-kindle-scribe-2-details-summary-not-much-has-changed/
  and https://blog.the-ebook-reader.com/2026/07/24/list-of-new-features-not-available-on-older-kindle-scribes/ .
- **Instapaper digests to Kindle** [LOCAL-2ND] sibling `read-later-apps.md`: daily/weekly compiled document with contents page;
  needs the approved-sender setup; became Premium-only on 2026-02-19 (https://www.pocket-lint.com/instapaper-send-to-kindle-going-behind-paywall/ ,
  https://www.androidpolice.com/your-amazon-kindle-is-losing-yet-another-free-feature/). A MobileRead user complained the free
  digest "includes the same articles in the daily packages lots of times" (https://www.mobileread.com/forums/showthread.php?p=4545848, relayed).
- **Pitfalls:** the approved-sender dance; web pages reflow poorly; a 2026 Kindle update caused sluggish page turns and was pulled
  [LOCAL-2ND] https://www.androidpolice.com/if-your-kindle-has-suddenly-gotten-worse-this-may-be-why/ ; double-tap page turn causes
  accidental turns https://blog.the-ebook-reader.com/2025/08/28/the-kindles-double-tap-page-turn-feature-is-frustrating-to-use/ ;
  Kindle PDF zoom was weak early (no double-tap zoom) [LOCAL-2ND] `snap-zoom-spec.md` line 64.

What it does best: reach (every OS, email, apps) and a huge installed base; the weakest part is web-article quality.

---

## 6. Kobo (Elipsa 2E, Libra Colour) [LOCAL-2ND mostly]

- **No "Send to Kobo".** Reported by the-ebook-reader: Kobo lacks any send-to-device service
  (https://blog.the-ebook-reader.com/2025/07/12/pocket-support-has-ended-on-kobos-without-any-alternatives/, via sibling `read-later-apps.md`).
- **Pocket integration ended; Instapaper replaced it (rollout Aug 2025)** with a **pairing code / QR** flow
  (More > My Articles > Link with Instapaper; enter a code at kobo.com/instapaper or scan the QR) and Wi-Fi sync for offline reading.
  This is the same pairing pattern Send to Daylight uses. Limits [LOCAL-2ND]: only the main list syncs; tags, highlights, notes,
  videos and PDFs do not; no folders; emailed-in items don't appear; webp images show placeholders. Sources:
  https://www.androidauthority.com/kobo-instapaper-integration-roll-out-3592013/ ,
  https://blog.the-ebook-reader.com/2025/08/26/latest-kobo-software-update-adds-instapaper-support/ ,
  https://help.kobo.com/hc/en-us/articles/33359968957463 , https://www.mobileread.com/forums/showthread.php?t=372113 (KOReader plugin).
- User voice (relayed): Kobo owners saw Pocket as "one of the selling points for Kobo ereaders" and "something other brands didn't
  have built-in"; one commenter returned "to KOreader and Wallabag" after a month with Instapaper-on-Kobo. [LOCAL-2ND]
- **Self-hosted bridges that impersonate Instapaper** so the native "My Articles" works: readeckobo, kobodeck (marks read status
  back) [LOCAL-2ND] sibling `read-later-apps.md` lines ~143-144 (https://codeberg.org/eleith/readeckobo ,
  https://pkg.go.dev/github.com/fkaduk/kobodeck). Kobo re-syncs config periodically and can overwrite a custom endpoint.
- **Dropbox integration for books (M, KNOWLEDGE)**; Elipsa/Libra Colour **notebook export** (to email / Dropbox; handwriting-to-text
  on Kobo Advanced notebooks) [LOCAL-2ND] rows in `survey.md` cite help.kobo.com articles 1500001833721, 360062226733 (notebooks),
  29991333812631 (export, updated 2025-11-04) and 43753873356055 (Kobo 2026-09 data-loss incident, updated 2026-09-29; the Reader team
  turned that into "back up before every schema upgrade").

What it does best: a native code/QR link to a read-later service; what it misses: direct send of files/pages/PDFs.

---

## 7. Cross-device lessons from the sibling read-later research that matter for e-ink [LOCAL-2ND]

- Readwise Reader runs on Daylight/Boox and is already a (paid) way to read on the DC-1; our differentiators: no subscription,
  E2E encryption, native Reader, pen workflow (sibling `readwise-reader.md` line 117).
- Pocket's shutdown (read-only 2025-07-08) and Omnivore's (2024-11) taught users to distrust vendor-cloud dependence; the angriest
  complaints were deletion deadlines, dying integrations (Kobo) and unreliability they had tolerated. (sibling `read-later-apps.md`
  "Lesson for Send to Daylight").
- Digest de-duplication (don't re-send delivered items) is an explicit user pain (MobileRead above).
- Read-status round trip is valued by tinkerers (wallabako and kobodeck write "read" back to the server).

---

## 8. Analysis (my judgment, built on the above; confidence reflects the evidence tier)

### 8.1 Which pipeline is the most seamless, and why
Ranking for "I'm on a web page or my phone and want it on my tablet, now":
1. **reMarkable "Read on reMarkable" (M confidence).** One click in the browser you are already in; no per-device pairing (account
   sign-in only); the result is a clean reflowable article OR a fixed PDF you chose; it arrives annotatable. It wins on *capture
   location* (you don't leave the page) and *arrival state* (ready to write on).
2. **Kindle Send to Kindle (H on reach, M on quality).** Widest reach (web, email, apps, desktop), but approved-sender friction and
   poor web-article layout; the Instapaper layer is what makes it feel good.
3. **Boox (M).** Most flexible (full Android + BooxDrop LAN drop), least polished; seamless only if you adopt a third-party app.
4. **Supernote (M).** Honest local-first Browse & Access; articles need manual conversion.
5. **Kobo (H).** Elegant native link to Instapaper (code/QR), but no direct send and PDFs/notes don't sync.

For the DC-1 specifically: it is a full Android tablet with Google Play like Boox, so *plumbing* is easy; what is not solved is
the *seamless* part: capture without leaving the page, arrival in the Reader's own library with ink and highlights ready, big files,
and the return trip (notes back to the phone/Mac). Send to Daylight already matches reMarkable on capture; it trails every
competitor on large files (ntfy 2 MiB) and on return flow.

### 8.2 What would make a DC-1 owner say "finally" (ranked by my judgment)
1. **Big PDFs and books just arrive** (100+ MB, scanned textbooks), with progress and resume. Today impossible over public ntfy.sh.
2. **My notes come home.** Highlights, ink pages and voice-note transcripts return to the phone/Mac (and to Obsidian/Readwise/Drive)
   without opening a share sheet. Boox's weak annotation export and Scribe's export-to-Drive/OneNote show the demand.
3. **Newsletter / email-in address.** The user already called it "really incredible" (DECISIONS 27).
4. **A morning stack.** A scheduled digest of what I saved, de-duplicated, as one document with a contents page (Instapaper-to-Kindle's
   best-loved feature, with its dedup flaw fixed).
5. **Delivered / opened / finished status on my phone**, and a view of what is waiting on the tablet (queue managed from the phone).
6. **Choose how it arrives:** clean article vs the page as I saw it vs PDF with a wide writing margin (Boox/Scribe margin idea) vs
   just the quote I selected; plus a destination collection and a one-line note ("read tonight").
7. **Direct LAN drop with no internet** (BooxDrop / Supernote Browse & Access) as a fallback and for huge files.
8. **Mac niceties:** drag onto the menu-bar icon, watched "Send folder", "Print > PDF > Send to Daylight".
9. **Send back from the DC-1:** a pen page or annotated PDF to my phone/Mac in one tap (reMarkable/Scribe export-by-email analogue).

---

## 9. What a follow-up with working network access should verify (to-do list)

Open and quote (with URL) once WebFetch/WebSearch work:
- reMarkable: support article for "Read on reMarkable" and "Send to reMarkable"; Chrome Web Store listing for the extension (rating,
  review count, recent reviews, what the "article" format is, folder choice); whether email-to-device exists; what Connect includes;
  reMarkable blog posts for OS 3.16 and the mobile-app updates (https://remarkable.com/blog/remarkable-os-3-16-whats-new).
- Boox: help.boox.com articles for BooxDrop, Send2Boox, Push Read; Chrome extension existence; Onyx cloud privacy complaints.
- Supernote: support.supernote.com for Browse & Access, Partner app, Send to Supernote, cloud sync, any browser extension.
- Kindle: https://www.amazon.com/sendtokindle and Amazon help pages for current formats (MOBI status), Chrome extension status, Scribe
  annotating sent docs, notebook export; the-ebook-reader.com posts on Send to Kindle changes 2025-2026.
- Kobo: help.kobo.com pages for Instapaper link, Dropbox, notebook export; the 2026-09 incident (article 43753873356055).
- Daylight: https://support.daylightcomputer.com/getting-started; Daylight forum, Discord recaps, YouTube reviews of "reading articles /
  PDFs on the Daylight"; HN item 43098318; r/daylightcomputer threads about getting articles/PDFs onto the DC-1 (needs a working Reddit path).
- User sentiment with verbatim quotes: r/Remarkable, r/Onyxboox, r/Supernote, r/kindlescribe, MobileRead forums, App Store/Play reviews of
  each companion app, YouTube comparison videos ("best way to send articles to reMarkable").
- Anything marked [KNOWLEDGE] above, especially confidence M/L items.
