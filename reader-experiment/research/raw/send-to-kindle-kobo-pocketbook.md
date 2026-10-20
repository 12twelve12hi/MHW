# Send to Kindle / Kobo / PocketBook / Tolino + third-party senders: raw research notes

Angle: Amazon Send to Kindle in every form, Kobo (Pocket/Instapaper/Dropbox/Google Drive), PocketBook (Send-to-PocketBook, cloud), Tolino, plus third-party tools (P2K, Calibre, KOReader wireless transfer, KindleEar, SendToReader and relatives).
Written: 2026-10-20. Author: research subagent (Sonnet 5.5). Project: "Send to Daylight" companion apps -> Daylight Reader on the DC-1.

---------------------------------------------------------------------------
## 0. READ THIS FIRST: research conditions and how much to trust this file
---------------------------------------------------------------------------

This run was heavily constrained. Be honest about it downstream.

1. WebSearch was unusable. Every WebSearch call returned "this turn's web search budget is used up (limit: 200 WebSearch calls per turn, shared by every agent in it)". The swarm had already consumed the shared budget before this agent's first query. I did NOT work around this with curl/wget search engines, mirrors, proxies or archives.
2. WebFetch only resolved a few hosts. DNS failed (getaddrinfo ENOTFOUND) for: www.amazon.com, chromewebstore.google.com, help.kobo.com, manual.calibre-ebook.com, en.wikipedia.org, www.mobileread.com, hn.algolia.com, hacker-news.firebaseio.com, apps.apple.com, play.google.com, codeberg.org, www.youtube.com. A single curl to https://www.amazon.com/sendtokindle through the sandbox proxy got "CONNECT tunnel failed, response 403" (blocked by policy; I stopped there).
3. What DID work: github.com pages (repos, issues, issue search, repo search, wiki), raw.githubusercontent.com, and pypi.org (JSON API only). The GitHub MCP file/issue tools were scoped to one unrelated repo, so I used WebFetch on public github.com pages instead.
4. Therefore: NO Reddit, NO Hacker News, NO YouTube, NO MobileRead, NO app-store or Chrome Web Store reviews, NO Amazon/Kobo/PocketBook help pages were read directly. Every "user voice" quote below is from GitHub issues/READMEs, which skews toward developers and self-hosters, not average readers.
5. WebFetch answers come from a small summarizer model, not raw HTML. Quotes are "as returned by the fetch tool"; treat exact wording as likely-but-not-guaranteed verbatim. Re-verify before putting any quote in public copy.

Evidence tags used below:
- [GH] = fetched from a github.com / raw.githubusercontent.com / pypi.org page this session. URL given. Some of these quote Amazon text secondhand (marked "Amazon text via ...").
- [GH-AI] = a GitHub issue that is itself an AI-agent-written research summary (e.g. tiilyat/omakindle). Useful leads, weaker evidence; they explicitly flag "unverified" items.
- [BG] = model background knowledge (training data up to mid-2026). NOT verified this session. Use as hypotheses to confirm, never as facts to ship.

---------------------------------------------------------------------------
## 1. Product inventory and status
---------------------------------------------------------------------------

| Product | Status (as far as verified) | Evidence |
|---|---|---|
| Amazon Send to Kindle: personal @kindle.com email | Active. Formats and limits quoted below. MOBI/AZW no longer accepted since Aug 2022; EPUB accepted. | [GH] janeczku/calibre-web#2393; jackiewoodall/twb#7 |
| Amazon Send to Kindle: apps for PC and Mac | Existed in 2022 (Amazon said it would add EPUB). Current status unverified. | [GH] tbhanson96/news-kindle-fetch#2 |
| Amazon Send to Kindle: Kindle apps on iOS/Android (receive; EPUB support promised 2022) | Active per 2022 notice | [GH] same |
| Amazon Send to Kindle: Chrome extension | Exists on Chrome Web Store, (c) Amazon.com Inc. A competitor claims it "depends on Amazon's authenticated web endpoints" and breaks. | [GH] AALAM98mod100/send-to-kindle-firefox; manabubannai/kindle-send-chrome |
| Amazon Send to Kindle: web (amazon.com/sendtokindle), up to 200 MB | Active. 200 MB claim is quoted by a thread participant as Amazon's text. | [GH] input-output-hk/mastering-cardano#47 |
| Amazon Kindle Scribe + Send to Kindle ("Print Replica" PDFs, notes) | Active. Scribe users care a lot about PDFs staying PDFs. | [GH] bookorbit#1442, #1205; yyolk/parch#557 |
| Kobo: Pocket integration | Pocket service shut down 2025-07-08 (quoted from an issue). | [GH] daniel-j/send2ereader#52 |
| Kobo: Instapaper / "Kobo Google Drive" sync | Referenced as existing Kobo sync sources. Details unverified. | [GH] janlarres/kobo-utilities#41 |
| KoboCloud (unofficial Dropbox/GDrive/Nextcloud/pCloud/Box/Yandex sync scripts) | Active community project, 1.3k stars | [GH] fsantini/KoboCloud |
| InstaKobo (Instapaper -> Kobo kepub, progress+highlights back) | Active, tiny (8 stars) | [GH] voidberg/instakobo |
| PocketBook: Send-to-PocketBook (email to your @pbsync.com address) | Active per extension README | [GH] joaomagfreitas/send-to-pocket-book |
| PocketBook Cloud / app | Not verified this session | [BG] |
| Tolino Cloud (Telekom/T-Systems; partner shops Thalia.de/.at, Buch.de, Hugendubel.de, Buecher.de) | Active; no official public API; community clients exist | [GH] hzulla/tolino-python; cweiske/tolino-api-docs |
| Calibre "Share by email" + wireless device connection | Active | [GH] kovidgoyal/calibre manual/faq.rst; koreader wiki |
| KOReader (+ plugins: calibre, opds, wallabag, readeck, instapaper, send2ebook, localsend, httpinspector, qrclipboard, cloudstorage, newsdownloader, kosync, SSH) | Very active, 30.4k stars | [GH] koreader/koreader |
| KindleEar (RSS/Calibre recipes -> email push to Kindle, v3.2 Nov 2024) | Active, 2.9k stars, 638 issues | [GH] cdhigh/KindleEar |
| send2ereader (daniel-j) and BookDrop fork (eitan12345om) | Active; hosted instance has frequent outages | [GH] |
| kindle-send (Go CLI), web2kindle (Chrome/Firefox ext), kindle-send-chrome (MV3 ext) | Active small projects | [GH] |
| KindBeamer (Flutter; macOS/Linux/Android + browser extension) and stkclient (Python) -- unofficial clients of Amazon's undocumented Send to Kindle web API | Active; stkclient 0.2.0 (2026-10-12) and 0.3.0 (2026-10-13) just shipped, "Migrate delivery to the Kindle Docs API" | [GH] jooray/kindbeamer; maxdjohnson/stkclient; pypi.org/pypi/stkclient/json |
| kindle-epub-fix (fix EPUB encoding for Amazon) | Active, 399 stars | [GH] innocenat/kindle-epub-fix |
| Calibre-Web / Calibre-Web-Automated (send to e-reader email, Kobo sync, KOReader sync, OPDS, magic link login) | Active | [GH] |
| P2K / p2k.co (Pocket -> Kindle via email, Rails app, hourly cron, CC BY-NC) | Pocket is gone, so effectively obsolete | [GH] emiraydin/p2k |
| Omnivore (read-it-later) | Shut down; data deleted 2024-11-15 per README | [GH] agrmohit/omnivore-epub |
| Pocket | Shut down 2025-07-08 | [GH] daniel-j/send2ereader#52 |
| SendToReader (sendtoreader.com) | Could not verify; looks like the same "key shown in e-reader browser" idea as send2ereader | [BG, unverified] |
| Send2KindleBot (Telegram), ebook-sender-bot | Active small bots | [GH] GabrielRF/Send2KindleBot (191 stars) |
| remailable (email to reMarkable) | Active, 139 stars | [GH] |

---------------------------------------------------------------------------
## 2. Amazon Send to Kindle: what the product does (facts)
---------------------------------------------------------------------------

### 2.1 Accepted formats and limits (Amazon text quoted secondhand)
Source: https://github.com/jackiewoodall/twb/issues/7 (a Sept 14, 2024 comment quoting Amazon):
- "Send to Kindle can convert and deliver the following types of documents:" EPUB (.epub), Adobe PDF (.pdf), Microsoft Word (.doc, .docx), Rich Text Format (.rtf), HTML (.htm, .html), Text (.txt), Compressed documents (.zip, .xzip), JPEG/GIF/BMP/PNG images.
- Troubleshooting text: "please ensure the document is not password protected or encrypted"; "Limit attachments to fewer than 25 documents per email."; "Individual file size should be less than 50 MB (before compression in a ZIP file)."
- The issue author adds: "AZW3 cannot be sent-to-kindle."
Source: https://github.com/input-output-hk/mastering-cardano/issues/47: "Send to Kindle supports EPUB files up to 200 MB" (web/app route); email route is 50 MB.

### 2.2 MOBI is dead, EPUB is in (Aug 2022)
Source: https://github.com/janeczku/calibre-web/issues/2393 (42 comments, closed 2022-08-01) and https://github.com/tbhanson96/news-kindle-fetch/issues/2:
- Amazon notice quoted: "starting August 2022, you'll no longer be able to send MOBI (.mobi, .azw) files to your Kindle library."; "Compatible formats now include EPUB (.epub)". Existing MOBI files in libraries unaffected. Amazon's reason: MOBI "doesn't support the newest Kindle document features".
- Earlier note (May 2022): "Beginning in late 2022, Send to Kindle applications will support EPUB (.EPUB) format."; Amazon said it would add EPUB to the free Kindle iOS/Android apps and the Send to Kindle desktop apps for PC and Mac.
- Fallout: every tool that emailed MOBI/AZW3 broke at once (Calibre-Web defaulted to MOBI; 42-comment thread; maintainers shipped EPUB default within ~3 months).

### 2.3 Email route friction (from Calibre's own FAQ)
Source: https://raw.githubusercontent.com/kovidgoyal/calibre/master/manual/faq.rst
- "Amazon's EPUB intake is very flawed, they will reject a number of EPUB files that work everywhere else." Suggested fix: round-trip EPUB -> MOBI/AZW3 -> EPUB to strip advanced formatting and embedded fonts.
- "Many servers (for example, Amazon) block email that does not come from a well known relay." Direct-from-your-machine SMTP does not work.
- "Amazon recently started sending confirmation emails that you have to click on" (approved-sender confirmation).
- "Amazon does not allow email delivery of AZW3 and new style (KF8) MOBI files."
- "Google recently deliberately broke their email sending protocol (SMTP) support"; Calibre recommends GMX or Outlook relays; "calibre automatically restricts itself to sending one book every five minutes"; "Microsoft/GMX can disable your account if you use it to send large amounts of email."
- "some poorly designed antivirus programs block calibre from opening a connection to send email." (Also calibre-web#2393: an antivirus email footer broke delivery.)
- Emailed MOBI is marked a "Personal Document" so the cover shows, but the book lands under Personal Documents instead of Books.
- Calibre's "Email successfully sent" means only SMTP acceptance (GH-AI: https://github.com/tiilyat/omakindle/issues/10, which also reports a MobileRead post that "Amazon rejects after SMTP acceptance").

### 2.4 No real delivery receipt on the email route; failures arrive as emails later
- https://github.com/tiilyat/omakindle/issues/7 [GH-AI]: "A send succeeds when `curl` exits 0 after the server accepts the message (250 to DATA)." and "Delivery to the device is not tracked; Amazon's later rejection mail is the user's to read."
- Real Amazon rejection email (https://github.com/input-output-hk/mastering-cardano/issues/47): "Dear customer, The following document(s), sent at 07:16 AM on Tue, Aug 26, 2025 GMT, could not be delivered due to E999 - Send to Kindle Internal Error: mastering-cardano-v1.0.0.epub  We apologize for the inconvenience." E999 is undefined; users correlated it with image-heavy EPUBs: ~134 MB failed, ~98 MB failed via web, under 50 MB worked after images were shrunk; a maintainer (nahern) said the problem was "related to the image sizes, so we need to resizing them for Kindle."
- Error E016: https://github.com/cdhigh/KindleEar/issues/741 (open, 26 comments, Sep 30 - Oct 19, 2026). Amazon's reply, quoted in thread: the file was delivered with its original layout preserved because "its formatting is incompatible with Kindle's reflowable layout" (E016). Result for the user: EPUB news issues arrive "as PDF-style pages", text can't be resized, tiny on a 7-inch screen. Maintainer's diagnosis: HTML5 tags Kindle doesn't support; KindleEar v2 vs v3 output differences.
- Takeaway: Amazon silently degrades to fixed layout instead of failing; the user finds out by squinting at a tiny page.

### 2.5 The "convert" subject-line trick and PDFs
- https://github.com/bookorbit/bookorbit/issues/1442: "Amazon treats that word as an instruction to convert a PDF into Kindle format". Reporter (Kindle Scribe user): "PDFs arrive as PDFs unless the user asks for conversion"; wants a per-recipient option, "off by default".
- https://github.com/bookorbit/bookorbit/issues/1205: always sending "convert" "breaks PDF's, which get converted to kindle format in a weird way, throwing out images and formatting"; request for a per-device "not convert" option, "necessary for scribe devices".
- stkclient README (https://github.com/maxdjohnson/stkclient): "By default, PDFs keep their original page layout. Setting force_convert=True converts the PDF to Kindle format."
- KindBeamer README: "PDFs can keep their original pages or be reformatted by Amazon, which reflows the text."
- https://github.com/celogeek/go-comic-converter/issues/15 (23 comments): EPUBs sent to a Scribe through Send to Kindle web are converted to AZW3; questions about resolution limits.
- https://github.com/cjus/cjus-skills/issues/62: people want PDF bookmarks so a Scribe sent via Send to Kindle shows an expandable table of contents.

### 2.6 The unofficial web API (what the official apps/extension use) [GH]
- stkclient (PyPI 0.1.0/0.1.1 on 2022-02-09, 0.2.0 on 2026-10-12, 0.3.0 on 2026-10-13): "A Python client for Amazon's Send to Kindle service that can send files larger than the 10 MB email limit." OAuth2 sign-in; list owned devices; send to a device by serial number; explicit `format`. https://pypi.org/pypi/stkclient/json , https://github.com/maxdjohnson/stkclient
- GH-AI (https://github.com/tiilyat/omakindle/issues/3): stkclient issues listed: 2026-05-25 "HTTP 403 'Failed to validate DeviceInfoToken'" for multi-account users; 2026-10-12 "Migrate delivery to the Kindle Docs API" (kd.amazon.com), a breaking change. repo issue #198 "send_file requires a format" closed 2026-10-12 (https://github.com/maxdjohnson/stkclient/issues). Interpretation: Amazon changed its backend this month and community clients are scrambling.
- KindBeamer (https://github.com/jooray/kindbeamer): unofficial replacement for Amazon's Send to Kindle desktop app; "Amazon may change or block the undocumented API at any time." Auth: Amazon OAuth (PKCE) in an embedded browser window; device credentials in OS keychain; "no password is ever stored."

### 2.7 Channels that exist (and what they feel like)
- Email to per-device @kindle.com (universal reach from any mail client; approved-sender list; confirmation email; 50 MB / <25 files).
- Web uploader (amazon.com/sendtokindle) [GH: referenced by go-comic-converter#15 "resend through Send to Kindle for Web"]; apps for PC/Mac (drag-drop); Kindle mobile apps; Chrome extension.
- Third-party clients exist because the official desktop story is thin: KindBeamer (macOS/Linux/Android), sendtokindle (Ubuntu GUI), sendKindle (CLI, archived), kindle-send (Go CLI), Calibre plugin by bookfere (https://github.com/bookfere/Send-to-Kindle-Calibre-Plugin, 158 stars, "send your ebook to Kindle with a desired title").

[BG, unverified this session] Other Send to Kindle facts I believe but could not confirm: web uploader has an "add to library / archive copy" toggle (KindBeamer's "library-copy setting" is consistent with this); personal documents sync last-read position/notes via Whispersync when converted (not for PDFs kept as fixed-layout); Windows print driver ("Send to Kindle" printer); Chrome extension has right-click send selection/page. Re-verify on Amazon's help pages when network allows.

---------------------------------------------------------------------------
## 3. Kobo
---------------------------------------------------------------------------
- Pocket integration on Kobo ended with Pocket (2025-07-08; issue text: "Mozilla will shut down Pocket's services on July 8, 2025", https://github.com/daniel-j/send2ereader/issues/52). [BG] Kobo announced Instapaper as the replacement; confirm.
- Kobo has Instapaper and Google Drive sync sources: "books synced via Kobo Google Drive or Instapaper" (https://github.com/janlarres/kobo-utilities/issues/41) -- and those books' annotations are "unreachable through the current backup feature".
- InstaKobo (https://github.com/voidberg/instakobo): "Read your Instapaper articles on Kobo, and sync reading progress and highlights back." Details: generates kepub per saved article organised by folder; adds series metadata (needs NickelSeries); "A designed cover with the title and source is composited on top" (Instapaper gives no cover/byline, so it fetches Open Graph image + author); reads progress/highlights from KoboReader.sqlite via a private copy; can archive finished articles and remove from device (opt-in); limit 500 (Instapaper API cap); Kobo annotation notes not synced.
- KoboCloud (https://github.com/fsantini/KoboCloud, 1.3k stars): scripts sync Dropbox, Google Drive, NextCloud/OwnCloud, pCloud, Box, Yandex Disk shared folders to a Kobo whenever it syncs; "Due to a change in Dropbox website, the public folder method does not work anymore." Known issue: duplicate books on some firmware.
- Kobo browser is the pairing channel for send2ereader / BookDrop (4-char key + QR; see section 6). kepubify converts EPUB to KEPUB for Kobo typography. Open issue: "Kepubify not working on the newer generation kobo devices (my example is the kobo libra colour)" https://github.com/daniel-j/send2ereader/issues (#76, Aug 2026).
- KOReader on Kobo: instapaper.koplugin issue "Login failed: 1" on Kobo Clara BW https://github.com/ebanDev/instapaper.koplugin/issues/5 (7 comments, Nov 2025); the plugin README lists article download/offline reading as "future work".
- Demand signal: "[Request]" for a clean path from phone to Kobo without a server: https://github.com/bookorbit/bookorbit/issues/1732 "It would be amazing if I could bypass the need for Instapaper or a dedicated server"; a phone-side process that "grabs the url, strips the article, and either on the phone or on the server then turns it into an EPUB"; wants offline queue that "automatically sends it to the server whenever a connection is next made".

---------------------------------------------------------------------------
## 4. PocketBook
---------------------------------------------------------------------------
- Send-to-PocketBook: documents emailed to your PocketBook's `@pbsync.com` address; device downloads and stores the attachment locally. Source: https://github.com/joaomagfreitas/send-to-pocket-book (universal browser extension for Chrome/Firefox/Edge; needs a self-hosted proxy server behind a Cloudflare worker; README install says "tbd").
- Demand signal: a Chrome extension "that sends web articles to your PocketBook as clean EPUBs" was pitched on r/chrome_extensions (secondhand via an auto-generated summary: https://github.com/JustinXai/OpportunityScanner/issues/148; keywords "web to epub pocketbook", "pocketbook clipper alternative"). Weak evidence.
- Failure mode: Calibre-Web-Automated "Send to eReader" shows success, then PocketBook's service mails back saying the message "does not contain documents". "The email should contain the ebook." Intermittent, file-dependent. https://github.com/crocodilestick/Calibre-Web-Automated/issues/1309
- Syncthing runs on PocketBook (community): https://github.com/mikedigriz/Syncthing-for-PocketBook/issues/17 (setup pain on a 623). Nextcloud client for PocketBook: https://github.com/JuanJakobo/Pocketbook-Nextcloud-Client (157 stars).
- Other: PocketBook Cloud (apps + web) [BG, unverified]; omnivore-epub README lists "Kindle and PocketBook" as eReaders that accept email-delivered books with an approved sender.
- plop-reader (Wallabag client for PocketBook) issue: "Troubles downloading items imported to wallabag from pocket" (2017, 10 comments) https://github.com/pmartin/plop-reader/issues/96.

---------------------------------------------------------------------------
## 5. Tolino
---------------------------------------------------------------------------
- Tolino Cloud is run by Telekom/T-Systems and stores purchased books plus users' own uploads; partner stores: Thalia.de, Thalia.at, Buch.de, Hugendubel.de, Buecher.de (https://github.com/hzulla/tolino-python). The README says no official API specs exist ("The author asks Telekom / T-Systems for official API specifications"); the repo was archived because the author no longer owns a Tolino; points to fork tolino-calibre-sync.
- Reverse-engineered docs: https://github.com/cweiske/tolino-api-docs ("Servers the Tolino Vision 3/4 HD talk to (Firmware 14.x)", work in progress, mostly empty headings in the mirror).
- Automations people build: zeit-on-tolino (auto-upload the ZEIT e-paper to Tolino Cloud, uses Selenium) https://github.com/fgebhart/zeit-on-tolino; tolino-upload https://github.com/tobexyz/tolino-upload; pytolino https://github.com/ImamAzim/pytolino; a 2026 Calibre Tolino-cloud sync plugin https://github.com/moritzkeller12-beep/calibre-tolinocloud-Plugin. Reading: the fact that the best path is Selenium scraping says a lot about the lack of an official "send" channel.
- book-drop README says it also works with the Tolino browser: https://github.com/eitan12345om/book-drop

---------------------------------------------------------------------------
## 6. Third-party tools, one by one
---------------------------------------------------------------------------

### 6.1 send2ereader (daniel-j) and BookDrop (fork)
- Concept: open a website in the e-reader's built-in browser; it shows a short key (and QR in BookDrop); you upload from phone/computer using the key; links appear on the device. No account, no cable, no app.
- BookDrop README (https://github.com/eitan12345om/book-drop): "4-character key and a QR code"; "Scan the QR code with a phone to open the upload page with the key filled in, or type the key manually on any computer."; "Download links appear on the device within seconds." Formats: EPUB, MOBI, AZW3, PDF, CBZ, CBR, HTML, TXT, PNG, JPG. Optional: EPUB->KEPUB (kepubify), EPUB->MOBI (KindleGen), PDF margin cropping (pdfCropMargins), Google Books metadata with before/after diff. Limits: 800 MB/file, 1 GB total upload dir, 5 files and 20 URLs per session key, 3 concurrent sessions and 20 key generations per 15 min per IP, keys expire after 5 minutes of inactivity and max 1 hour.
- send2ereader (https://github.com/daniel-j/send2ereader): 1.1k stars, 193 forks, 31 open issues; hosted at send.djazz.se.
- Pain (from issue list https://github.com/daniel-j/send2ereader/issues): server outages ("Bad gateway", "502 bad gateway on website; :((((", "500 internal server error", "send.djazz.se not working!"), device browser problems ("Website not working correctly in Kindle browser", "send.djass.se not opening on Kobo browser", "Cannot download on my kobo", "unable to download files"), key problems ("No key file generated on Kindle", "Upload error - is the key correct?", "Upload now requiring key, failing to upload to server"), and "Long errors when trying epub", "Invalid filetype". Feature requests: "[Feature Request] allow web articles" (#52: "It would be awesome if send2ereader would also accept an URL as an input, not just file upload."), "Drag and drop support", "[Feature Request] Add authentication", "[Feature Request] allow images in .png and .jpg formats".
- Lesson: users love the zero-install key pairing; it is fragile because it is a single public hosted service and relies on weak e-reader browsers. Typos in host names caused real support threads (#58: "I used the wrong URL").

### 6.2 kindle-send (Go CLI, 279 stars)  https://github.com/nikhil1raghav/kindle-send
- `kindle-send send <file|url>`; a text file of links becomes one multi-chapter ebook; webpages -> EPUB -> emailed; Amazon converts to AZW3. Mail timeout default 2 minutes. Also works for Kobo/reMarkable "if they accept ebooks by email". Gmail needs an app password.
- Open issues (7): ".webp images not displayed on Kindle", "Inconsistent handling of missing images", "Bug: Some HTML <pre> elements missing in epub when converting from url", "Encoding conversion - ISO-8859-2 -> UTF-8", "Debug possibility for e-mail dispatch?".

### 6.3 web2kindle (Chrome/Firefox extension)  https://github.com/megaconfidence/web2kindle
- One click; Mozilla Readability extracts article; server builds reflowable EPUB with embedded images (or PDF if layout matters); emailed from web2kindle@confidence.sh to the user's Kindle address (user must add the sender to the approved list). Kindle email stored locally in the browser. "No account, ads, or tracking". Documents cached up to 7 days; Cloudflare Workflows + Resend.

### 6.4 kindle-send-chrome (MV3 extension)  https://github.com/manabubannai/kindle-send-chrome
- Claims official extension "depends on Amazon's authenticated web endpoints" so this one is "a more stable alternative". Email relay (their own, Gmail-based). "Opening the popup IS the send." Background job queue; failures trigger OS notifications; toolbar badge shows in-flight and failed counts; dedicated extractor for X/Twitter threads that bundles consecutive posts into a numbered EPUB; lazy-loaded images resolved; WebP/AVIF converted to JPEG; images resized to stay under a 4.5 MB relay limit; 50 MB per email max; "A local EPUB download remains as a fallback".

### 6.5 KindBeamer (desktop/mobile + extension)  https://github.com/jooray/kindbeamer
- Features: single-window "pre-addressed" send (title, last-used devices, library-copy setting; "Pressing Enter usually sends"); keyboard-first (Enter sends, Esc clears, digits tick devices, A selects all/none); multi-document queue with per-document metadata editing and per-document progress; PDF keep-layout vs reflow; Markdown -> PDF/HTML; macOS: drag-drop, Finder "Open With", dock drop, Services menu, `kindbeamer` CLI; Linux: drag-drop, Open With, CLI `--send`; Android: system share sheet, "Open with", and "Print -> KindBeamer" from any app; monochrome "e-paper styling, inverted at night"; sends to every Kindle and Kindle app on the account (each installation registers as its own device); `--device` flag by name or serial; extension "sends the page you are reading to your Kindle. An article arrives with only the article itself: no menus, sidebars or comments"; extension images scaled to max 1600 px.

### 6.6 kindle-epub-fix  https://github.com/innocenat/kindle-epub-fix (399 stars)
- Single-purpose JS site: adds UTF-8 declaration to EPUBs because Send to Kindle "still assumes ISO-8859-1 encoding if no encoding is specified" which causes "weird formatting errors for special characters". "at no warranty". Calibre-Web-Automated ships an "Enable CWA Kindle EPUB Fixer" option (https://github.com/crocodilestick/Calibre-Web-Automated/issues/1309).
- User pain: https://github.com/janeczku/calibre-web/issues/2508 (15 comments): books looked fine but arrived with "â€™️" "where I think there should be an apostrophe"; fix = EPUB -> AZW3 -> EPUB; "1 out of 5 eBooks wouldn't send"; users "asked for this to be built in, since the manual steps add many clicks".

### 6.7 KindleEar  https://github.com/cdhigh/KindleEar (2.9k stars)
- Self-hosted: RSS/Atom/JSON/web content + 1,000+ built-in Calibre recipes -> epub/mobi with images and TOC (+ mp3 TTS) -> email push on a daily schedule or online "e-ink optimized reader"; multi-user/multi-Kindle; sharing library of feeds; integrations with Evernote, Pocket, Instapaper, wallabag; email forwarding; v3.2 (2024-11-19) added AI summaries, bilingual translation, text-to-speech, and a browser extension for building scraping recipes visually.
- Issues are mostly delivery and rendering: "推送没反应" (push does nothing), "邮件发送正常但亚马逊没有收到内容" (mail sent fine but Amazon did not receive content), #741 (E016 above), recipe breakage when sites change, GAE hosting/memory problems. Feature requests: next/previous links between articles, buttons to jump to TOC (#714, 29 comments), cover (#716).

### 6.8 Calibre (Share by email, wireless device)  
- FAQ details above (section 2.3). For KOReader: wiki (https://github.com/koreader/koreader/wiki/Calibre-wireless-connection) says Calibre's wireless device connection sends books to KOReader on the same LAN; "supports sending documents from your calibre library using a wireless connection"; on first use Calibre may ask for an "Inbox" directory; tip: sync is slow if the file manager keeps refreshing the folder, especially on Android. Page marked deprecated in favour of https://github.com/koreader/koreader/wiki/calibre .
- Calibre's own tracker/comments [GH-AI]: no Send to Kindle web-API code in Calibre; a 2012 maintainer comment: "Someone would have to reverse engineer send to kindle or amazon would have to tell us what APIs it uses." For @kindle.com recipients Calibre replaces subject/body with random ASCII text because Amazon "can't handle non-ascii text".

### 6.9 KOReader wireless/ingest toolbox  https://github.com/koreader/koreader , plugin dir https://github.com/koreader/koreader/tree/master/plugins
- Plugins present: SSH, calibre, cloudstorage (KOReader wiki feature list mentions Dropbox and FTP; WebDAV not verified), httpinspector, newsdownloader, opds, qrclipboard, wallabag, kosync (progress sync), exporter (highlights), and others (37 total). Readeck and instapaper are separate community plugins: https://github.com/iceyear/readeck.koplugin (137 stars), https://github.com/flip-rossi/readeck.koplugin (46 stars), https://github.com/ebanDev/instapaper.koplugin.
- Send2Ebook plugin: "downloads articles saved to an FTP server, using the Send2Ebook PC/Android application"; files auto-removed from server after download; destination dir configurable; wiki last edited 2020. Android app + PC CLI (archived Aug 2023): "PC/Android phone -> gets url -> download -> converts to epub -> stores to server(ftp)". https://github.com/koreader/koreader/wiki/Send2Ebook , https://github.com/mwoz123/send2ebook
- Origin story (the original "send from phone" wish): https://github.com/koreader/koreader/issues/3630 -- mwoz123: "Often I wish I could read article found on phone on my E-ink Koreader device." and "I dream about click 'send to Koreader'." Frenzie wanted "something more generic and multi-platform like Syncthing (or Dropbox)". silberzwiebel (privacy): "Depending on where this server is located, I'd see privacy problems here." and "Would this work from a PC, e.g. as a firefox plugin?" Outcome: implemented July 2018 (#3681) as Android share -> clean HTML -> EPUB -> FTP.
- LocalSend plugin https://github.com/kaikozlov/localsend.koplugin : implements the LocalSend protocol on e-readers (Kindle, Kobo, PocketBook, reMarkable): start a server on the device, send from any LocalSend app on phone/computer; discovery list of nearby devices; optional PIN for incoming transfers; TLS on by default; filter accepted file types and route files to different folders by type; send current book or long-press file; WebRTC experimental; "Reported working" device list; firmware caveats.
- Wallabag plugin: downloads latest articles as individual EPUBs; setup needs username/password/client id/secret (~50 chars each, so users edit settings/wallabag.lua); settings include articles_per_sync, filter_tag, ignore_tags, is_delete_read, is_sync_remote_delete. Page warns config "very likely to change". Reliability issue: "Wallabag stops downloading after a few articles" (#14147, open, 41 comments, Aug 2025) https://github.com/koreader/koreader/issues/14147 .
- News downloader: RSS/Atom into HTML files per feed; `limit`; `download_full_article` "may not always work correctly". https://github.com/koreader/koreader/wiki/News-downloader
- Wiki also has: OPDS support, Advanced WiFi control, SSH, Progress sync, Highlight export, Nextcloud notes, Evernote export, Joplin.

### 6.10 Calibre-Web / Calibre-Web-Automated
- Feature list (https://github.com/janeczku/calibre-web): "Send eBooks to E-Readers with a single click", "Sync Kobo devices with your Calibre library", OPDS feed, shelves, in-browser reading, upload of new books, "'Magic Link' login for easy access on eReaders" (login on a text-input-hostile e-reader browser via a code approved from another device), per-user permissions.
- CWA (https://github.com/crocodilestick/Calibre-Web-Automated): ingest folder auto-converts 27 formats to EPUB by default; "Automatically email new books after ingest" (auto-send with delay); Kobo sync; built-in KOReader progress sync "with automatic book identification"; metadata/cover enforcement so "edits made in the web UI are also written into the book files".
- Pain: Kindle EPUB send quirks (2508 above), PocketBook "does not contain documents" (1309), "Some books don't show the 'Send Epub to e-reader' button" (Feb 2026 comment on #2508).

### 6.11 p2k / Pocket -> Kindle  https://github.com/emiraydin/p2k
- Rails app: Pocket API -> Diffbot/Readability parse -> ImageMagick image compression -> Kindlegen MOBI -> SMTP email, hourly cron. Dead with Pocket and with MOBI.
- omnivore-epub (https://github.com/agrmohit/omnivore-epub): Omnivore library -> one EPUB -> optional SMTP email to Kindle/PocketBook; ebook title/author/cover/description configurable; label exclusions; "Omnivore is shutting down ... data will be deleted on 15 November 2024"; recommends Readeck and Readwise Reader.
- Pattern: read-later services die; people want "articles on my e-ink device" to survive the service.

### 6.12 Other small tools found (stars)
send-to-kindle Telegram bots (Send2KindleBot 191, ebook-sender-bot 65), kindlebox (131, Dropbox folder -> Kindle), ksend (128 CLI), reddit2kindle (36, archived), ttrss-sendtokindle (27), web2kindle (43), MangaPoint (40, "Search, download, crop and convert ... then send it to your device. Xteink, Kindle, Kobo, Boox"), book-drop (24), ai-summary-helper (23, "Fetch and insert AI-generated summaries of web content. Combine with Send To Kindle"), zlib CLI (1,096 stars, includes "send to Kindle" and AI-agent integration), Calibre-News-Delivery (55, GitHub Actions schedule + email). Discovered via https://github.com/search?q=send+to+kindle (698 repos).

---------------------------------------------------------------------------
## 7. What users love (evidence) and what drives them crazy
---------------------------------------------------------------------------

### Love / pull
1. One-tap from the phone to the e-ink device. "Often I wish I could read article found on phone on my E-ink Koreader device." / "I dream about click 'send to Koreader'." (koreader#3630)
2. Zero-account, zero-cable pairing from the e-reader's own browser (key + QR) -- send2ereader 1.1k stars, BookDrop fork. "Download links appear on the device within seconds."
3. Clean article only: "An article arrives with only the article itself: no menus, sidebars or comments" (KindBeamer); Readability-style extraction, images embedded, reflowable EPUB (web2kindle, kindle-send-chrome).
4. Email-from-anywhere reach: every app can email an attachment; Calibre, Calibre-Web, KindleEar, p2k, omnivore-epub, kindle-send all piggyback on it.
5. Keep the original PDF as a PDF when asked (Scribe users: "PDFs arrive as PDFs unless the user asks for conversion").
6. Round trip: highlights and reading progress returning to the source (InstaKobo, wallabag.koplugin, kosync, CWA).
7. Scheduled delivery/news digests (KindleEar 2.9k stars, p2k, Calibre-News-Delivery).
8. Local network transfer with PIN + TLS and per-type routing (LocalSend plugin).
9. Privacy-respecting designs ("Your Kindle email is saved locally in the browser", "No account, ads, or tracking").
10. Auto-ingest + auto-send of new files (CWA "Automatically email new books after ingest").

### Drives them crazy
1. Silent failure after "success": SMTP accepted != delivered; Amazon rejects later by email (omakindle#7/#10; CWA#1309 "does not contain documents").
2. Opaque error codes (E999 "Internal Error", E016 reflow incompatibility) and silent degradation to fixed-layout "PDF-style" pages (KindleEar#741).
3. Format roulette: Amazon's "EPUB intake is very flawed" (Calibre FAQ); MOBI killed overnight in Aug 2022 (calibre-web#2393); AZW3/CBZ/ZIP rejected (MeManga#362: ".cbz and .zip are sent to Kindle even though Send to Kindle rejects them").
4. Encoding mojibake and missing covers (calibre-web#2508, #2393 "EPUB sent successfully, though cover art was missing").
5. Size cliffs: 50 MB email; ~98-134 MB EPUB failed on web despite a 200 MB claim (mastering-cardano#47); the old 10 MB figure for email still shows up in stkclient docs.
6. Email setup tax: approved-sender list, confirmation email, SMTP relay, Gmail app passwords, Google breaking SMTP, rate limits, antivirus blocking, account lockouts (Calibre FAQ).
7. Undocumented API fragility: "Amazon may change or block the undocumented API at any time" (KindBeamer); stkclient v0.2.0 breaking change Oct 12 2026; 403 "Failed to validate DeviceInfoToken"; the official Chrome extension reportedly breaks (kindle-send-chrome).
8. Reliability of hosted pairing services (send2ereader outages) and e-reader browsers that cannot open sites.
9. Read-it-later death: Pocket (2025-07-08), Omnivore (2024-11-15) -> orphaned integrations; flaky replacements ("Login failed: 1" instapaper.koplugin; Wallabag stops after ~7 articles).
10. Third-party sync scripts break when vendors change pages (KoboCloud: "Due to a change in Dropbox website, the public folder method does not work anymore.").
11. Privacy: "Depending on where this server is located, I'd see privacy problems here." (koreader#3630).
12. Fixed-layout PDFs lose images/formatting when auto-converted (bookorbit#1205), and Scribe TOC/bookmark expectations (cjus-skills#62).
13. Repeat/partial-batch send problems: split parts sent sequentially with no checkpoint; retry may resend part 1 (MeManga#245).
14. Too many clicks for known fixes: "asked for this to be built in, since the manual steps add many clicks" (calibre-web#2508).

---------------------------------------------------------------------------
## 8. Feature candidates for Send to Daylight (what to borrow)
---------------------------------------------------------------------------
(Value = my judgement of fit for a pen-first 10.5" grayscale Android tablet with an E2E relay and receipts. "Needs" uses: companion-only / companion+inbox / reader-change / server.)

1. Clean-article mode (Readability -> reflowable EPUB/HTML with embedded images, grayscale-friendly) vs "Original page" mode. companion-only (client-side). High.
2. Per-send "Keep layout" vs "Reflow" toggle, default sensible per file type; never force-convert PDFs. companion-only (+ reader must reflow). High.
3. Receipts with human error taxonomy + pre-flight validation (type, size, encrypted PDF, empty body) before upload; per-item states queued/uploaded/delivered/opened/failed with reason; resend. Our E2E relay already has receipts, this closes the gap Amazon leaves. companion+inbox. High.
4. Silent-degradation guard: Inbox tells the sender if content was received but rendered fixed-layout ("this arrived as a fixed page; reflow unavailable") rather than failing quietly. companion+inbox. Medium.
5. Bundle N items into one issue/volume with TOC (kindle-send "links file -> chapters"; KindleEar). companion-only. Medium-High.
6. Multi-doc queue with metadata edit (title/author/cover) before send; per-document progress. companion-only. Medium.
7. One-click browser extension send with background queue, failure notifications, badge counts, thread extractor, lazy-image resolution, WebP/AVIF->JPEG. companion-only. High.
8. Keyboard-first Mac sender: Services menu, Finder Open With, dock drop, PDF menu in Print dialog, CLI wrapper, "Enter to send", last-used targets pre-selected. companion-only. Medium-High.
9. Android "Print to Daylight" (print service) so any app can send. companion-only. Medium.
10. LAN fast path + LocalSend-compatible receiver in Inbox (discovery, PIN, TLS), so any LocalSend app works with no install; optional per-type routing to Reader folders. companion+inbox (+reader for folders). Medium-High.
11. Guest/one-time drop page with short-lived key (send2ereader/BookDrop semantics: 5-min idle, 1-hour max, per-IP rate limits) for sending from a computer you do not own. server (relay) + inbox. Medium.
12. Image diet for grayscale: downscale/greyscale/recompress before upload to dodge size cliffs and save relay bandwidth (KindBeamer 1600 px; kindle-send-chrome resizes under relay limits). companion-only. Medium.
13. Read-it-later bridge (Readeck/Instapaper/Wallabag) with progress/highlight/archive sync back (InstaKobo, wallabag.koplugin). reader-change/server. Medium-High, but outside the "send" core.
14. Return path: send annotated pages back (flattened PDF, text export) to phone/Mac/email -- the pen is our differentiator and Scribe/InstaKobo show highlights-back is loved. reader-change + inbox. High. [Inferred from Scribe/InstaKobo demand; the specific Scribe export feature is BG.]
15. Email-in address with sender allowlist (and server-side E2E wrapping where possible) for forwarding newsletters/receipts. server. Medium; pitfalls: Amazon's approved-list + confirmation friction.
16. Hot folder / watch folder on Mac and "Daylight" Files provider on iOS (Dropbox/KoboCloud-style). companion-only. Medium.
17. Scheduled digests (RSS, newsletters, saved queue) with optional AI summary page and TTS. server. Medium-Low.
18. Send to collection/folder at send time ("route by type" in LocalSend plugin; KOReader Send2Ebook "customize directory"). companion+inbox+reader-change. Medium.
19. Send to multiple targets (family tablets, several DC-1s) with digit shortcuts. companion-only. Low-Medium.
20. Tolerant ingest: Reader should auto-detect encodings and never reject EPUBs that "work everywhere else" (avoid Amazon's failure). reader-change. Medium.

---------------------------------------------------------------------------
## 9. Gaps: what to re-run when the network and search quota are available
---------------------------------------------------------------------------
- Amazon help: "Send to Kindle" email (personal doc address, approved list, limits), Send to Kindle apps/web/Chrome extension pages, Whispersync/Personal Documents, Kindle Scribe notebook export.
- Chrome Web Store listing for Amazon's Send to Kindle extension: rating, users, last update, recent review text (is it really broken?).
- Reddit: r/kindle, r/kobo, r/ereader, r/pocketbook, r/Boox, r/kindlescribe, r/selfhosted (send2ereader, kindleear, readeck). Hacker News "Send to Kindle", "Pocket shutdown", "Omnivore". MobileRead forums on E016/E999. YouTube reviews of Send to Kindle, KOReader LocalSend, Boox Push.
- Kobo help for Instapaper replacing Pocket; Kobo Dropbox/Google Drive docs; PocketBook "Send-to-PocketBook" help and PocketBook Cloud; Tolino Cloud upload help; Boox "Push & Read"; reMarkable "Read on reMarkable" extension (outside my angle but the closest pen-tablet analogue).
- Product-side check: does the Daylight Reader reflow EPUB/HTML and keep PDFs fixed? That decides items 1-4 in section 8.

---------------------------------------------------------------------------
## 10. Source URLs (every page fetched this session)
---------------------------------------------------------------------------
Repos / READMEs
- https://github.com/cdhigh/KindleEar
- https://github.com/daniel-j/send2ereader , https://raw.githubusercontent.com/daniel-j/send2ereader/master/README.md
- https://github.com/eitan12345om/book-drop
- https://github.com/innocenat/kindle-epub-fix
- https://github.com/megaconfidence/web2kindle
- https://github.com/nikhil1raghav/kindle-send
- https://github.com/manabubannai/kindle-send-chrome
- https://github.com/BkrmDahal/Send-to-Kindle-Chrome-Extension
- https://github.com/AALAM98mod100/send-to-kindle-firefox
- https://github.com/jooray/kindbeamer , https://raw.githubusercontent.com/jooray/kindbeamer/main/README.md
- https://github.com/maxdjohnson/stkclient , https://pypi.org/pypi/stkclient/json , https://github.com/maxdjohnson/stkclient/issues
- https://github.com/fsantini/KoboCloud
- https://github.com/voidberg/instakobo
- https://github.com/ebanDev/instapaper.koplugin
- https://github.com/joaomagfreitas/send-to-pocket-book
- https://github.com/hzulla/tolino-python , https://github.com/cweiske/tolino-api-docs
- https://github.com/emiraydin/p2k
- https://github.com/agrmohit/omnivore-epub
- https://github.com/mwoz123/send2ebook
- https://github.com/kaikozlov/localsend.koplugin
- https://github.com/janeczku/calibre-web , https://github.com/crocodilestick/Calibre-Web-Automated
- https://github.com/Readplace/readplace.com (no Kindle/Kobo delivery features in README)
- https://github.com/koreader/koreader , https://raw.githubusercontent.com/koreader/koreader/master/README.md , https://github.com/koreader/koreader/tree/master/plugins , https://github.com/koreader/koreader/wiki and wiki pages: /Send2Ebook , /Calibre-wireless-connection , /Wallabag , /News-downloader
- https://raw.githubusercontent.com/kovidgoyal/calibre/master/manual/faq.rst
Issues
- https://github.com/daniel-j/send2ereader/issues , /52 , /58
- https://github.com/nikhil1raghav/kindle-send/issues
- https://github.com/cdhigh/KindleEar/issues , /741 , /718
- https://github.com/janeczku/calibre-web/issues/2393 , /2508
- https://github.com/jackiewoodall/twb/issues/7
- https://github.com/tbhanson96/news-kindle-fetch/issues/2
- https://github.com/input-output-hk/mastering-cardano/issues/47
- https://github.com/meellm/MeManga/issues/362 , /245
- https://github.com/tiilyat/omakindle/issues/3 , /7 , /10 [GH-AI]
- https://github.com/koreader/koreader/issues/3630 , /14147
- https://github.com/bookorbit/bookorbit/issues/1732 , /1442 , /1205
- https://github.com/crocodilestick/Calibre-Web-Automated/issues/1309
- https://github.com/wimvdon/reader/issues/113
- https://github.com/janlarres/kobo-utilities/issues/41
- https://github.com/ebanDev/instapaper.koplugin/issues/5
- https://github.com/pabuisson/in-my-pocket/issues/4 (Pocket shutdown thread; no e-reader content)
- https://github.com/JustinXai/OpportunityScanner/issues/148
- https://github.com/yyolk/parch/issues/557 , https://github.com/cjus/cjus-skills/issues/62 , https://github.com/celogeek/go-comic-converter/issues/15
- GitHub repo searches: "send to kindle" (698), "pocketbook cloud", "tolino cloud", "koreader send to device plugin", "kobo", "readeck koreader", "kindbeamer", "InstaKobo", "send to kindle chrome extension"
- GitHub issue searches: "send to kindle" mobi deprecated epub; "send to kindle" 50 MB; kobo instapaper; "Kindle Scribe" "send to kindle"; pocketbook "send to pocketbook"
