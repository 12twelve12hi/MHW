# Community voice: what people want and hate when getting reading material onto a reading device

Angle assigned: "be the voice of the community" by mining Reddit (r/kindle, r/ereader, r/remarkable, r/Onyx_Boox, r/supernote,
r/DaylightComputer, r/readwise, r/instapaper, r/selfhosted, r/productivity, r/apple, r/androidapps), Hacker News, MobileRead,
app-store and Chrome Web Store reviews, and YouTube. Then produce the top 25 wants and top 15 frustrations with counts and verbatim
quotes plus URLs.

Project: "Send to Daylight" companions (iPhone, Android, Mac, Chrome, Safari, web sender, DC-1 Inbox) feeding the Daylight Reader.
Compiled: 2026-10-20.

---------------------------------------------------------------------------
## 0. READ FIRST: this run could NOT do the assigned research. This file is a re-analysis of other agents' notes.
---------------------------------------------------------------------------

**Nothing in this file was retrieved by me from Reddit, Hacker News, MobileRead, an app store, the Chrome Web Store, or YouTube.**
I did not read a single community page myself. What follows is a secondhand synthesis. Please weigh it accordingly.

What I tried, and what happened:

| Attempt | Result |
|---|---|
| WebSearch x5 (Daylight DC-1 on Reddit, r/DaylightComputer, HN Daylight launch, reMarkable article workflows, etc.) | Every call refused: "this turn's web search budget is used up (limit: 200 WebSearch calls per turn, shared by every agent in it)". The swarm spent the shared budget before I started. Zero successful searches. |
| WebFetch: daylightcomputer.com, chromewebstore.google.com (Send to Kindle reviews), www.mobileread.com, apps.apple.com, docs.readwise.io, play.google.com, hn.algolia.com | All failed: `getaddrinfo ENOTFOUND`. |
| Proxy status endpoint (`$HTTPS_PROXY/__agentproxy/status`) | Shows `connect_rejected ... gateway answered 403 to CONNECT (policy denial ...)` for chromewebstore.google.com, addons.mozilla.org, www.mobileread.com (05:12 UTC today). These are policy denials; the proxy README says not to retry or route around them. I did not. |
| Workarounds I deliberately did NOT use | HN Algolia API via curl (it is a search engine), redlib/Reddit mirrors, web.archive.org, "reader" proxies, search engines through curl. The budget notice forbids these. The task text suggested HN Algolia and redlib; I skipped both for that reason. |

What I did instead: read all eight sibling research files already in this folder and re-organized their user-voice material around the
question this angle asks (what do people say they want, and what do they hate). The siblings themselves were also network-starved
(most had only GitHub reachable), so the evidence base is:

| Sibling file (all in `/home/user/MHW/reader-experiment/research/raw/`) | Code | What its "user voice" really is |
|---|---|---|
| `mobile-share-patterns.md` | MSP | GitHub issue comments (Karakeep, Omnivore, Tailscale, LocalSend, Immich, Zotero iOS, paperless-mobile), read by that agent via WebFetch |
| `cross-device-transfer.md` | XDT | GitHub issues (LocalSend, PairDrop, Tailscale, GSConnect, RQuickShare, NearDrop), with reaction counts |
| `send-to-kindle-kobo-pocketbook.md` | STK | GitHub issues and READMEs (KOReader, Calibre-Web, KindleEar, send2ereader, bookorbit, ...) |
| `browser-clippers.md` | BCL | GitHub issues (Obsidian Clipper, SingleFile, MarkDownload, Zotero Connector, Omnivore, Karakeep) |
| `newsletters-rss-automation.md` | NRA | GitHub issues (Omnivore, Karakeep, KOReader, Miniflux, FreshRSS, CWA) plus project files |
| `read-later-apps.md` | RLA | WebSearch snippets: HN, MobileRead, MPU Talk, TechCrunch, Kobo/Instapaper coverage (unopened pages) |
| `readwise-reader.md` | RWR | WebSearch snippets: Readwise docs, HN, redlib Reddit mirrors, AlternativeTo, blogs (unopened pages) |
| `eink-tablets.md` | EIT | Almost entirely background knowledge plus relays of the above; it states it has no fresh sources |

### Evidence tags used below
- **[GH]** A user or maintainer comment on a public GitHub issue. A sibling agent read the thread via WebFetch, which returns a small-model
  summary, so quotes are "as returned": likely verbatim, not guaranteed. Skews to developers, self-hosters and open-source users.
- **[SN]** A quote reproduced by a search-tool snippet in a sibling run. The page was never opened by anyone. Treat the wording as unverified.
- **[DOC]** Vendor docs/README/changelog relayed (what a product does, not what users say).
- **[LOCAL]** A file in this repo or the Daylight Reader source snapshot, as relayed by a sibling.
- **[INF]** My inference. Not evidence.
- Each item also carries the sibling code (MSP, XDT, ...) it came through. I did not open any cited URL myself.

### How to read "signal"
Counts are **the number of distinct evidence items (separate issue threads, posts, or independent sources) cited across the sibling
notes**, plus the largest reaction count seen. They are NOT a survey of a corpus and NOT mention frequency on Reddit. Rubric:
VERY STRONG = 6+ distinct items across 3+ products, or one thread with 30+ reactions plus corroboration; STRONG = 4-5 items or a
thread with 15+ reactions; MODERATE = 2-3 items; WEAK = 1 item or inference. If most of the evidence is [SN] rather than [GH], I
downgrade one level and say so. The audience skew (GitHub-active developers and self-hosters) probably over-weights automation,
self-hosting and "how it works" asks, and under-weights what average Kindle/Kobo/Daylight owners want.

### What is missing (nobody has done these yet)
No Reddit thread bodies. No HN comment bodies beyond snippets. No MobileRead threads beyond three URLs. No App Store / Play / Chrome Web Store
review text. No YouTube transcripts. And, importantly, no forum, Discord, YouTube or review evidence about how Daylight DC-1 owners
actually get content onto the device (section 4). A follow-up run with search budget and network access should use the to-do list in section 7.
To continue, the user can send a follow-up message after this one, or raise `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`.

Conflicts between siblings worth knowing: (1) whether Instapaper's *scheduled* Kindle digests, or only single sends, became Premium-only on
2026-02-19 is unresolved (RLA: outlets say both; one source says digests stay free); (2) Tailscale issue #8626 is "22 thumbs-up" in MSP and
"27 reactions" in XDT (probably thumbs-up vs total); (3) Pocket's data-deletion date is 2025-10-08 in RLA (citing Mozilla support) but "after the
Nov 12 2025 export deadline" in RWR, so treat the exact date as unverified; (4) Omnivore's export deadline is 15 Nov 2024 in most sources, 16 Nov in TechCrunch.

---------------------------------------------------------------------------
## 1. Summary table: top 25 wants
---------------------------------------------------------------------------

Ordered by my judgment of (signal x fit for Send to Daylight). "Signal" uses the rubric above. "Needs" is for the Daylight build.

| # | Want | Signal (items; max reactions) | Quality | Needs |
|---|---|---|---|---|
| 1 | Honest delivery receipts with distinct states and failure reasons | VERY STRONG (14 items; 22-27 reactions on Tailscale #8626) | GH | companion+inbox |
| 2 | Share in place: never launch the main app, confirm instantly | STRONG (5; n/a) | GH | companion-only |
| 3 | Works offline: send-later outbox and offline reading | VERY STRONG (7; 23 on Karakeep #2401) | GH + SN | companion-only |
| 4 | My devices directly in the share sheet and context menus | STRONG (4; n/a) | GH | companion-only |
| 5 | Clean article extraction, with a preview and a thin-content warning | STRONG (7; n/a) | mostly SN | companion-only |
| 6 | Paywalled/logged-in pages work (send what the browser rendered) | VERY STRONG (8; 6 on Karakeep #1167) | GH + SN + DOC | companion-only |
| 7 | Tags, note, destination at save time without blocking one-click | VERY STRONG (6 threads; 14 on wallabag #675) | GH | companion+inbox |
| 8 | Scheduled digest ("morning stack") with TOC and no repeats | VERY STRONG (10+; 36 on Omnivore #2142) | GH + SN | companion+inbox / server |
| 9 | Send just the selection or highlight (and highlight on the live web) | STRONG (5; 14 on Obsidian #181) | GH | companion+inbox |
| 10 | Email-in address for newsletters and forwarded documents | MODERATE (5, mostly tracker titles) + owner-stated interest | GH titles + LOCAL | server |
| 11 | PDFs stay PDFs; big files just arrive | VERY STRONG (9; 39 on LocalSend #384) | GH | server (Worker/R2) |
| 12 | Round trip: highlights, progress and read-status come back | VERY STRONG (7; 15 on KOReader #7143) | GH + DOC | reader-change |
| 13 | RSS/feeds delivered to the device | STRONG (7; 12 on Karakeep #333) | GH | companion+inbox / server |
| 14 | Background receive with an actionable notification | VERY STRONG (7; 55 votes on a LocalSend discussion) | GH | companion+inbox |
| 15 | Links arrive as links; clipboard handoff, not .txt/.url files | VERY STRONG (7; 36 on Tailscale #4896) | GH | companion+inbox |
| 16 | Smart intake: Apple News/Substack/X threads/YouTube resolved properly | STRONG (7; 12 on Karakeep #1468) | GH | companion-only |
| 17 | Bundle many tabs/items into one document with chapters | MODERATE (5 user items; 6+ products ship it) | GH + DOC | companion-only |
| 18 | Persistent pairing by code/QR, no account, trusted-device auto-accept | VERY STRONG (7; 67 on NearDrop #152) | GH | companion-only (exists) |
| 19 | One-keystroke send and a full context menu | STRONG (7; low reactions) | GH | companion-only |
| 20 | "Already sent" indicator / duplicate warning | STRONG (5; 13 on Omnivore #2747) | GH | companion-only |
| 21 | Automation surface: Shortcuts with return value, URL scheme, CLI, API, IFTTT | VERY STRONG (8; 34-36 on Tailscale #2504 / LocalSend CLI) | GH + SN | companion-only |
| 22 | Ownership: export, no lock-in, no surprise paywall, privacy | VERY STRONG (8; mostly SN) | SN + GH | product posture |
| 23 | E-ink/Live-Paper reading ergonomics (page turn, contrast, less motion) | MODERATE (6, all secondhand) | SN + DOC | reader-change |
| 24 | Image diet: WebP/AVIF fixed, size-capped, grayscale-friendly | MODERATE (5) | GH | companion-only |
| 25 | Scan paper to a clean PDF | WEAK-MODERATE (2 threads, one project) | GH | companion-only |

---------------------------------------------------------------------------
## 2. The 25 wants, with verbatim quotes and URLs
---------------------------------------------------------------------------

### 1. Honest delivery receipts with distinct states and failure reasons
Signal: VERY STRONG. 14 distinct items across Tailscale, LocalSend, Immich, Amazon Send to Kindle, KindleEar, Obsidian Clipper, Calibre-Web-Automated,
Zotero iOS. Top reaction: Tailscale #8626 (22 thumbs-up per MSP; 27 per XDT), open since July 2023, still reproduced Aug 2026.
- "The file shows up in downloads, but there is no notification." (jstebbins, Jan 2024) [GH, MSP] https://github.com/tailscale/tailscale/issues/8626
- "the fact that no notification shows up at all on Android devices is really confusing." (clari7744, May 2025) [GH, MSP] same URL
- "This was originally reported more than 2 years ago and it's still an issue on Android." (drm-nz, Sep 2025) [GH, MSP] same URL
- "Immich should not claim the upload succeeded when it actually didn't." (server returned 500 while app notified success) [GH, MSP] https://github.com/immich-app/immich/issues/2531
- iOS Shortcut "reports success but the file arrives empty" (0 bytes), while Share -> Tailscale worked [GH, MSP, excerpt] https://github.com/tailscale/tailscale/issues/18537
- "The command provided no feedback and took several minutes to complete." [GH, XDT] https://github.com/tailscale/tailscale/issues/3621
- Real Amazon rejection mail: "...could not be delivered due to E999 - Send to Kindle Internal Error: mastering-cardano-v1.0.0.epub  We apologize for the inconvenience." [GH, STK] https://github.com/input-output-hk/mastering-cardano/issues/47
- "Delivery to the device is not tracked; Amazon's later rejection mail is the user's to read." [GH-AI summary, STK; weaker] https://github.com/tiilyat/omakindle/issues/7
- After 'Save file...' in Zen/Safari "there's no visual indication/change that it has worked" [GH, BCL] https://github.com/obsidianmd/obsidian-clipper/issues/744
- PocketBook's service mails back saying the message "does not contain documents" after the sender app showed success [GH, STK] https://github.com/crocodilestick/Calibre-Web-Automated/issues/1309
Daylight idea: four states users can see (queued on phone, accepted by relay, received by tablet, opened in Reader) with reasons and Retry. Ask for
notification permission right after the first send (Android 13+ default-off).

### 2. Share in place: never launch the main app, confirm instantly
Signal: STRONG. 5 distinct items (Karakeep #237 with duplicate #1984, #3018; Omnivore #3335, #2230; Obsidian #634). Karakeep #237 is still being commented on Sep 2026.
- "When I hoard something via the Android share menu, I get the black "Hoarded!" screen and then the mobile app opens." (DominikBritz) [GH, MSP] https://github.com/karakeep-app/karakeep/issues/237
- "I mean my point of hoarding is to read it later - seeing the app is unnecessary." (DominikBritz) [GH, MSP] same URL
- "It should probably display a toast message or a toolbar, like Pocket has." (lucius346346) [GH, MSP] same URL
- "Still very relevant in 2026 — sharing from the Android share sheet still launches the full Karakeep app." (zjw2018SS, Sep 9, 2026) [GH, MSP] same URL
- "Currently, when sharing content to Karakeep via the iOS share sheet, the app itself is opened every time." [GH, MSP] https://github.com/karakeep-app/karakeep/issues/1984
- iOS share extension saves but "leaves originating app frozen/unresponsive" on iOS 26 (Safari, Facebook; maintainer blames the cross-platform share library; open, labelled high priority) [GH, MSP, paraphrase] https://github.com/karakeep-app/karakeep/issues/3018
- "with the Chrome extension I need to do one extra click to save it, which is kind of annoying" [GH, MSP] https://github.com/omnivore-app/omnivore/issues/3335
- dairefagan wants "a small toast/banner at the bottom of the screen for a few seconds without a dismiss button." [GH, MSP, described] https://github.com/omnivore-app/omnivore/issues/2230
- Obsidian clipper on iOS 27: the top blue checkmark merely dismisses without saving; user "dismiss[es], rather than save[s]" often [GH, BCL] https://github.com/obsidianmd/obsidian-clipper/issues/634
Daylight idea: true native iOS Share Extension and Android share-target Activity that finish in under a second with a HUD/toast; no React-Native/Expo share shim.

### 3. Works offline: send-later outbox and offline reading
Signal: VERY STRONG. 7 items. Karakeep #2401 has 23 reactions (17 thumbs-up, 5 hearts), approved but open.
- Sharing with the server unreachable "just kind of... spins... and tries to connect"; one user "had to put links into a text file" during a 3-day outage [GH, MSP, partly paraphrase] https://github.com/karakeep-app/karakeep/issues/2401
- "I was just on a flight and disappointed this wasn't already a thing." (June 2026) [GH, MSP] same URL
- "It would be amazing if I could bypass the need for Instapaper or a dedicated server" and an offline queue that "automatically sends it to the server whenever a connection is next made" [GH, STK] https://github.com/bookorbit/bookorbit/issues/1732
- Instapaper "rock solid for offline reading"; "couldn't find any other options which can be read offline, support Android and have a reasonable free tier" [SN, RLA] https://news.ycombinator.com/item?id=44068524 and https://news.ycombinator.com/item?id=44597668
- Pocket: "about half of the articles would not load offline" (2019 rant, re-affirmed 2023) [SN, RLA] https://news.ycombinator.com/item?id=36649740
- Raindrop: offline reading requested since Oct 2023; a commenter says requested "for six years" [SN, RLA] https://better.raindrop.io/feature-requests/p/offline-support-reading-viewing
- Immich uploads only worked foreground; maintainer closed "working as expected"; reporter noted Ente uploads in background on the same phone [GH, MSP] https://github.com/immich-app/immich/issues/30391
Daylight idea: accept the share instantly into a local outbox, retry for a week (already in the protocol), and show queued items in the app.

### 4. My devices directly in the share sheet and context menus
Signal: STRONG. 4 items.
- "It'd be nice if I could have the favorites show up directly in the share sheet, and be able to one click share without needing to swap apps and confirm send etc." (iOS, Apr 2026) [GH, MSP] https://github.com/localsend/localsend/issues/3014
- User who "moved from PushBullet to LocalSend" says the one missing feature is targets in the share menu (Pushbullet put devices at the top of the share dialog) [GH, MSP, paraphrase] https://github.com/localsend/localsend/issues/2351
- "Baking support for Windows 11 Context Menus is now desperately needed for Send via Taildrop feature." (open since June 2023) [GH, XDT] https://github.com/tailscale/tailscale/issues/8509
- Wants "share the file, tap on Tailscale, tap on 'Connect', tap on the device." instead of leaving the share pane to fix a connection [GH, MSP, desired flow] https://github.com/tailscale/tailscale/issues/9444
Daylight idea: Android Sharing Shortcut "Daylight DC-1 (Rooted 2)" in the top row; iOS/macOS share tiles; Chrome right-click menu.

### 5. Clean article extraction, with a preview and a thin-content warning
Signal: STRONG, downgraded because most praise is [SN]. 7 items across Omnivore, Matter, Readwise, Obsidian, send2ereader.
- Omnivore: "best parser and typography I've seen among many read-later apps" [SN, RLA] https://news.ycombinator.com/item?id=37890742 (also https://news.ycombinator.com/item?id=39812380)
- Matter: "near flawless at extracting article text"; "much more pleasant UI/UX than Instapaper or Pocket" [SN, RLA] https://talk.macpowerusers.com/t/any-one-using-matter-in-view-to-replace-instapaper-and-pocket-etc/27034
- Readwise: "parses almost always correctly" (Doug Belshaw) [SN, RWR] https://archive.dougbelshaw.com/thought-shrapnel/no-breathless-whispering-of-mark/
- Complaint: "Note ... is empty at all of our local newspaper articles" (Firefox) [GH, BCL] https://github.com/obsidianmd/obsidian-clipper/issues/484 ; Safari crash "Unable to initialize page content: null is not an object (evaluating 'item["@type"]')" https://github.com/obsidianmd/obsidian-clipper/issues/949
- "It would be awesome if send2ereader would also accept an URL as an input, not just file upload." [GH, STK] https://github.com/daniel-j/send2ereader/issues/52
- Obsidian docs: the extractor (Defuddle) "can be overly conservative and remove content that you want to keep" [DOC, BCL] https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Obsidian%20Web%20Clipper/Troubleshoot%20Web%20Clipper.md
Daylight idea: Readability/Defuddle on the sender, a reader-preview and "send full page instead" when the extraction looks thin.

### 6. Paywalled/logged-in pages work: send what the browser rendered
Signal: VERY STRONG. 8 items; six products implement it (Readwise, Matter, Instapaper bookmarklet, Wallabagger, SingleFile, TabTome), which is itself a signal.
- Matter Chrome review: "It handles paywalled articles better than any other extension I've tried." [SN, RLA] https://extensionauditor.com/scan/matter-knjbgabkeojmfdhindppcmhhfiembkeb
- HN: "Instapaper is absurdly far ahead of Pocket" (on paywalled content) [SN, RLA] https://news.ycombinator.com/item?id=44597668
- Karakeep "fetches its own copy with a headless Chrome rather than pulling from the browser, so pages that need a login can produce a broken snapshot" [SN, RLA; from the HN Karakeep threads, exact item not specified] https://news.ycombinator.com/item?id=43681408 (also 44064701, 44068524)
- Karakeep #1167: users want per-tab cookie sharing so the server can scrape logged-in pages (6 thumbs-up, open, untriaged) [GH, BCL] https://github.com/karakeep-app/karakeep/issues/1167
- Readwise docs call the extension "the most robust way to save" because it captures what the browser rendered [DOC, RWR] https://docs.readwise.io/reader/docs/saving-content
- Readwise mobile caveat: "Saving from Safari is the best way to save documents to Reader on mobile because iOS gives our app access to the underlying content in addition to the URL." [DOC, RWR] https://docs.readwise.io/reader/docs/faqs/parsing
- A third-party add-on exists because thin saves are common: "Readwise Full Content" re-opens stubs in a background tab with your session [DOC, RWR] https://addons.mozilla.org/de/android/addon/readwise-full-content/
Daylight idea: this is natural for an E2E relay (the relay cannot fetch pages anyway). Make "send rendered DOM" the default in Chrome/Safari/Mac, and ask iOS Safari for page content, not just the URL.

### 7. Tags, note, destination at save time without blocking one-click
Signal: VERY STRONG. 6 user threads plus 3 products' docs. wallabag #675 has 14 thumbs-up.
- "+1 When I save a lot of articles, later retrieval is faster when they are tagged at once." / "+1 Pocket does have a pretty useful mechanism for such feature." [GH, MSP] https://github.com/wallabag/android-app/issues/675
- "we should not have to leave the browser to add labels" (dairefagan); "I suspect most people don't want to interrupt their reading to tag" (macdonaldster) [GH, MSP] https://github.com/omnivore-app/omnivore/issues/2230
- "While saving a new page/pdf, there is no option to create a new tag which isnt already created." [GH, BCL] https://github.com/omnivore-app/omnivore/issues/2366
- Zotero users asked for "a drop-down list of existing tags in web clipper a la Evernote" and a note field; both shipped June 2025 [GH, BCL] https://github.com/zotero/zotero-connectors/issues/310 and https://github.com/zotero/zotero-connectors/issues/376
- Wallabagger #334: tag autocomplete should "show proposed tag after three letters" instead of auto-adding (to allow new tags) [GH, BCL] https://github.com/wallabag/wallabagger/issues/334
- Docs of Readwise (bar with tags, note, move-to-section), Instapaper (banner with tags/folder/archive), Raindrop (collection + tags) [DOC, RWR/RLA]
Daylight idea: a non-blocking bar AFTER the send (destination: read now / later / folder; tags with create-new; one-line note), mirrored in share sheets. Needs a protocol field.

### 8. Scheduled digest ("morning stack") with a contents page and no repeats
Signal: VERY STRONG. 10+ items. Highest single: Omnivore #2142 (36 thumbs-up, 18 comments; closed "not planned" 2024-11-18).
- "Same feature as with Instapaper. But it would be better if, Omnivore could convert docs to cleaner format and having the option to send either a compilations or a specific doc (with or without cover image) to Kindle." [GH, NRA] https://github.com/omnivore-app/omnivore/issues/2142
- "I really love Instapaper and use it a lot. Especially the send to kindle feature" [SN, RLA] https://news.ycombinator.com/item?id=17706597
- HN on the Instapaper digest: "emailing the .mobi file with your top saved articles to your Kindle once a day ... a personal newspaper with its own contents page" [SN, RLA]
- Miniflux #228 (8 thumbs-up, closed "not planned" 2026-01-05): "We will make AZW3 file from unread items and send it by mail every day for example." [GH, NRA] https://github.com/miniflux/v2/issues/228
- Calibre-Web-Automated auto-send: "this is definitely a core function missing"; "expected this behavior and [was] disappointed to find it missing after setup" [GH, NRA] https://github.com/crocodilestick/Calibre-Web-Automated/issues/156 and https://github.com/crocodilestick/Calibre-Web-Automated/issues/211 (shipped v4.0.0, 2026-01-31)
- FreshRSS #2516: wanted "mobi or just html file from the unread article so that we can send the file to kindle" [GH, NRA] https://github.com/FreshRSS/FreshRSS/issues/2516
- HN titles: "I turned my Kindle into my own personal newspaper" and "Turn your read later folder into a physical book" [SN titles, RLA] https://news.ycombinator.com/item?id=47541969
- Repeats are the pain (see frustration 7): "it includes the same articles in the daily packages lots of times." https://www.mobileread.com/forums/showthread.php?p=4545848 [SN, RLA]
- Self-hosted digest machines exist because vendors do not ship it: KindleEar (~2.9k stars), Calibre-News-Delivery, OughtGather, kindle-daily-digest [GH, NRA/STK]
Daylight idea: build the issue on the tablet from items already received (no server), chapters per article, dated cover, "send now", skip empty days, a ledger so nothing repeats.

### 9. Send just the selection or highlight (and highlight on the live web)
Signal: STRONG. 5 items.
- Omnivore #2817 "highlight directly from a website": "Would love to help testing as this is my exact workflow." (mdbraber); sharing just a highlight on iOS is "the last missing piece of their mobile read-it-later workflow" (HealsCodes, Apr 2024) [GH, BCL; second is quoted fragment of a description] https://github.com/omnivore-app/omnivore/issues/2817
- Obsidian #181 "Annotate highlights" (14 thumbs-up) [GH, BCL] https://github.com/obsidianmd/obsidian-clipper/issues/181
- Obsidian #268: "Green Highlights - Conclusive Facts / Yellow - Examples / Blue - Questions / Pink - The Premium post-it note worthy quote. Underlines - Titles / Subtitles" and "Currently, I'm using glasp.co and exporting out per webpage .md files weekly for this purpose." [GH, BCL] https://github.com/obsidianmd/obsidian-clipper/issues/268
- Obsidian #111 "import highlights" (11 thumbs-up + 4 rockets), shipped in v1.7.1 [GH, BCL] https://github.com/obsidianmd/obsidian-clipper/issues/111
Daylight idea: "send selection with source link and an optional note" as a first-class item the Reader pre-renders as a highlight.

### 10. Email-in address for newsletters and forwarded documents
Signal: MODERATE (5 items, mostly tracker titles), plus the project owner has already said it would be "really incredible" (DECISIONS 27, relayed by EIT) [LOCAL].
- "one might not want to give those out to newsletters to let them perceive identity of the user." and "the prefix should be allowed to be customisable and not tied to the username." (ashutoshsaboo) [GH, NRA] https://github.com/omnivore-app/omnivore/issues/2198
- Maintainer reply: "letting it be user editable means it becomes another attack vector, so we have to think through all the security aspects" [GH, NRA] same URL
- Failure classes visible as Omnivore tracker titles: #218 "Auto confirm email subscriptions"; #1375 "Forwarded newsletter emails not being saved"; #2801 "Handle text only newsletters"; #4240 "Email Newsletter Missing Newlines"; #1653 "Allow access to recently received emails" [GH titles, NRA] https://github.com/omnivore-app/omnivore/issues
- "Add URL via email" (send an URL as the subject), implemented Apr 2023 [GH, MSP] https://github.com/omnivore-app/omnivore/issues/1829
- Readwise's two-address model (library vs feed) [DOC, RWR] https://docs.readwise.io/reader/docs/faqs/email-newsletters
Daylight idea: random, revocable, never user-name-derived addresses; separate "read" and "news" addresses; sender allowlist; show the not-E2E notice the first time (LAB-DECISIONS).

### 11. PDFs stay PDFs; big files just arrive
Signal: VERY STRONG. 9 items. LocalSend #384 "faster large transfers" has 39 reactions.
- "PDFs arrive as PDFs unless the user asks for conversion" (Kindle Scribe user; wants a per-recipient option "off by default") [GH, STK] https://github.com/bookorbit/bookorbit/issues/1442
- Always sending "convert" "breaks PDF's, which get converted to kindle format in a weird way, throwing out images and formatting"; "necessary for scribe devices" [GH, STK] https://github.com/bookorbit/bookorbit/issues/1205
- "I'd like to clip a lot of PDFs from arxiv" (Obsidian clipper cannot clip PDFs) [GH, BCL] https://github.com/obsidianmd/obsidian-clipper/issues/646
- Scribe users want PDF bookmarks so a sent PDF shows an expandable table of contents [GH, STK] https://github.com/cjus/cjus-skills/issues/62
- "the slow speed is caused by the inefficient HTTPS implementation" (LocalSend #384; reports of 20 MB/s on 5 GHz, "51 kbps" Windows to Android in 2026, "With encryption off, I get 103MB/s.") [GH, XDT] https://github.com/localsend/localsend/issues/384
- "When the browser runs out of RAM the site crashes and is often simply reloaded." (PairDrop; iOS Safari ~200 MB cap) [GH, XDT] https://github.com/schlagmichdoch/PairDrop/issues/120
- Amazon size cliffs: a ~134 MB EPUB failed, ~98 MB failed via web despite a 200 MB claim, under 50 MB worked after images were shrunk [GH, STK] https://github.com/input-output-hk/mastering-cardano/issues/47
- reMarkable: PDF handling is clumsy ("Adjust view" crops margins by hand; two-column PDFs stay painful) [SN, EIT] https://borednbookless.com/reading-pdfs-on-remarkable-2/
- [LOCAL] Our own relay: ntfy.sh accepts at most 2 MiB per attachment (measured 2026-10-20); the protocol doc's 64 MiB file claim is wrong until a Worker/R2 path exists. A 100 MB textbook PDF cannot go through public ntfy.sh today (EIT, from `share/NTFY-FACTS.md`).
Daylight idea: never force-convert PDFs; "keep layout / reflow" choice; chunked, resumable large-file path through the planned Worker.

### 12. Round trip: highlights, progress and read-status come back
Signal: VERY STRONG. 7 items. KOReader #7143 (annotations to Wallabag) has 15 reactions, open since 2021.
- "if we could sync via any of those APIs and sync read/unread/starred status bidirectionally then I'd die a happy man." (HammyHavoc) [GH, NRA] https://github.com/koreader/koreader/issues/9937 (9 thumbs-up)
- "Unfortunately two way highlight syncing is not possible" (because the Reader API lacks location data) [DOC, NRA] https://github.com/Endle/readwisereader
- Readwise's own words: highlights made on Kindle do not sync back [DOC, RWR] https://docs.readwise.io/reader/docs/faqs/exporting
- Boox NeoReader: "annotation export format is unusable for getting back to the highlighted location in another app" [SN, EIT] https://christiantietze.de/posts/2023/05/boox-neoreader-annotation-export-is-meh/
- InstaKobo: "Read your Instapaper articles on Kobo, and sync reading progress and highlights back." [DOC, STK] https://github.com/voidberg/instakobo
- Kobo books synced via Instapaper/Google Drive have annotations "unreachable through the current backup feature" [GH, STK] https://github.com/janlarres/kobo-utilities/issues/41
- Outbound sharing of saved items requested and closed Jul 2026 [GH, MSP] https://github.com/karakeep-app/karakeep/issues/1188
Daylight idea: this is the pen tablet's differentiator. Highlights, ink pages and finished-status return to the phone/Mac (reader change; built by the Mac mini session behind the Reader's own Labs switch).

### 13. RSS/feeds delivered to the device
Signal: STRONG. 7 items. Karakeep #333 "produce an RSS feed" 12 thumbs-up; #833 8 thumbs-up.
- "One of the biggest things that I use is RSS." and "I'd like to be able to point something like this to my Reddit feed"; maintainer: "This is happening in the next release!" (2024) [GH, NRA] https://github.com/karakeep-app/karakeep/issues/202
- Users also want their saved queue exposed as an RSS feed so other readers can pull it [GH, NRA] https://github.com/karakeep-app/karakeep/issues/333
- KOReader NewsDownloader is the proof of demand, with its pain: re-downloads deleted items (#5320), crashes on Kindle PW7 (#14831), no read-state sync (#9937) [GH, NRA]
- MacStories' Federico Viticci tried Reader as RSS client and "decided to go all-in with Reader as my read-later app (at least for now)" [SN, RWR] https://club.macstories.net/posts/using-readwise-reader-as-my-rss-client
- Miniflux has 30 "save to" integrations and no e-reader target; Kindle request closed "not planned" [GH, NRA] https://github.com/miniflux/v2/issues/228
Daylight idea: feeds as a source into the same queue/ledger as manual sends; per-feed limit, full-text vs summary, seed-without-delivering on first subscribe. Tablet polls (like KOReader) or the Worker cron.

### 14. Background receive with an actionable notification
Signal: VERY STRONG. 7 items. A LocalSend discussion on background/auto receive totals 55 votes (XDT, with related threads 21 and 10).
- "I would like the web app to be always online in the background so that it sends a notification that someone is trying to send me something then I can accept." / "Airdrop on Apple does not need receiving device to be inside an app to receive." [GH, XDT] https://github.com/schlagmichdoch/PairDrop/issues/479
- "I cannot seem to be able to run the app in the background" [GH, XDT] https://github.com/localsend/localsend/issues/2153
- "It doesn't work in the background; you have to open the app for it to automatically accept and save the data." [GH, XDT] https://github.com/localsend/localsend/issues/3326
- Tailscale Android no-notification thread, see want 1 (22-27 reactions) https://github.com/tailscale/tailscale/issues/8626
- Notifications should carry actions: "Add a `copy` action on notification" [GH, XDT] https://github.com/Martichou/rquickshare/issues/182
- Battery is why people turn listeners off: "Device runtime cut by half running tailscale always on." (2021); "This continues to be a crippling issue for many" (2024) (76 reactions, locked) [GH, XDT] https://github.com/tailscale/tailscale/issues/3363
Daylight idea: a foreground-service Inbox on the DC-1 (we control the image) with its own notification channel and Open / Dismiss actions; show "last seen" for the tablet in the senders.

### 15. Links arrive as links; clipboard handoff, not .txt/.url files
Signal: VERY STRONG. 7 items. Tailscale #4896 has 36 thumbs-up; its Oct 2026 fix still delivers `.url`/`.inetloc` files on desktops.
- "share text on phone, open file, copy to clipboard has 200% more steps than share text" [GH, MSP; XDT words it "takes far more steps than share text"] https://github.com/tailscale/tailscale/issues/4896
- "It would be nice to have the history page replaced by a conversation page." and complaint that received text is saved as a .txt [GH, XDT] https://github.com/localsend/localsend/issues/462
- Auto-open link / copy text "to my eyes would make the app simply perfect" [GH, XDT] https://github.com/Martichou/rquickshare/issues/245
- NearDrop: "Can't receive text and links on Mac" and "Add text share support" [GH titles, XDT] https://github.com/grishka/NearDrop/issues
- Sharing links "from one tailscale app to another would make this app more than essential" (#4996, 13 reactions; shipped Oct 2026) [GH, XDT] https://github.com/tailscale/tailscale/issues/4996
Daylight idea: a link must arrive as a link and open as a page in the Reader; Inbox shows Open / Copy.

### 16. Smart intake: Apple News, Substack, X threads, YouTube
Signal: STRONG. 7 items.
- "On iOS/iPadOS, sharing to Hoarder from Apple News, saves the headline and link to article as plain text." (benbrooks; same from Amazon app, Reddit, Brave, Firefox iOS) [GH, MSP] https://github.com/karakeep-app/karakeep/issues/956
- Le Monde: "the saved item is just a plain text note with text and a link" and "Hoarder never scraps it, considering it's just a note." [GH, MSP] https://github.com/karakeep-app/karakeep/issues/948
- Substack iOS shares "capture referral overlay instead of article"; wanted "resolve the appropriate article URL before the initial crawler fetch" [GH, MSP] https://github.com/karakeep-app/karakeep/issues/3134
- "the value of the tweet is the threat [thread], not the first post" (12 thumbs-up) [GH, MSP] https://github.com/karakeep-app/karakeep/issues/1468 ; clipper captures only loaded tweets: https://github.com/obsidianmd/obsidian-clipper/issues/264
- YouTube transcripts "always saved in English" when an auto-dubbed track exists; English transcripts rose from ~2% of clips before 4 Sep to 54% after [GH, BCL] https://github.com/obsidianmd/obsidian-clipper/issues/957
Daylight idea: a share-intake normalizer on every sender: typed URL first, unwrap Apple News/Substack/tracking, thread mode, transcript with original-language caption.

### 17. Bundle many tabs/items into one document with chapters
Signal: MODERATE as user voice (5 items, low reactions), but six products ship it (Matter, TabTome, content-collector, percollate, SingleFile, MarkDownload).
- "It would be great if one can also click the icon to select and save several articles in several tabs into Obsidian." [GH, BCL] https://github.com/obsidianmd/obsidian-clipper/issues/83
- "Raindrop-style Tab-Bankruptcy ... put them in a specific folder / a new folder with the date or just dump in home" [GH, BCL] https://github.com/karakeep-app/karakeep/issues/2795 and https://github.com/karakeep-app/karakeep/issues/1710
- Matter bulk send "merges the articles into an ebook, with each article as its own chapter" [DOC, RLA] https://www.getmatter.com/updates/send-to-kindle
- Omnivore #2142 asks for "compilations" (see want 8). HN title "Turn your read later folder into a physical book" [SN, RLA]
Daylight idea: multi-select in the extension/Mac app; "send these N as one issue"; per-tab results; partial failure does not abort.

### 18. Persistent pairing by code/QR, no account, trusted-device auto-accept
Signal: VERY STRONG. 7 items. NearDrop #152 has 67 reactions (QR fix). send2ereader has ~1.1k stars. Our pairing already matches this pattern.
- "Often I wish I could read article found on phone on my E-ink Koreader device." and "I dream about click 'send to Koreader'." (mwoz123) [GH, STK] https://github.com/koreader/koreader/issues/3630
- BookDrop/send2ereader: "Download links appear on the device within seconds." (4-character key + QR from the e-reader's own browser) [DOC, STK] https://github.com/eitan12345om/book-drop
- PairDrop: "Pairing is persistent." [DOC, XDT] https://github.com/schlagmichdoch/PairDrop
- "The connection and negotiation takes time and you have to sit glued to mac waiting for notification to accept." [GH, XDT] https://github.com/grishka/NearDrop/issues/117
- After the QR flow: "that worked perfectly! I hope it will be put in the README soon" [GH, XDT] https://github.com/grishka/NearDrop/issues/152
- An auto-accept fork: "perfect... Rather simple changes that make the entire experience perfect." [GH, XDT] https://github.com/Martichou/rquickshare/issues/224
- Kobo owners treated Pocket as "one of the selling points for Kobo ereaders" and "something other brands didn't have built-in"; Kobo's replacement uses a code/QR link [SN, RLA/EIT] https://blog.the-ebook-reader.com/2025/07/12/pocket-support-has-ended-on-kobos-without-any-alternatives/
Daylight idea: keep the pair-once QR/code; paired devices auto-accept; an optional guest key (5-minute idle, 1-hour max) for a computer you do not own.

### 19. One-keystroke send and a full context menu
Signal: STRONG (7 items, low reaction counts).
- "It is not supported to save via context menu just like Pocket or readerwise extension." Maintainer: "the simplest way to save with the extension is the keyboard shortcut" [GH, BCL] https://github.com/omnivore-app/omnivore/issues/3143
- MarkDownload wanted a "Quick save button - save file in default location" [GH, BCL] https://github.com/deathau/markdownload/issues/21
- SingleFile #1215: shortcut/icon for "Save selection"; maintainer: "I agree that's a desirable feature" [GH, BCL] https://github.com/gildas-lormeau/SingleFile/issues/1215
- Obsidian #472 "Quick Clip shortcut should respect save behavior" (6 thumbs-up) [GH, BCL] https://github.com/obsidianmd/obsidian-clipper/issues/472
- Instapaper Firefox add-on reviews: Ctrl+I conflicts with italics in editors [SN, RLA] https://addons.mozilla.org/en-US/firefox/addon/instapaper-official/reviews/1635603/
- Safari cannot rebind: "Safari does not support editing hotkeys." [DOC, BCL] https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Obsidian%20Web%20Clipper/Clip%20web%20pages.md
Daylight idea: toolbar click = send; shortcuts for page / selection / link / tabs; Safari gets an in-app menu and toolbar action instead.

### 20. "Already sent" indicator / duplicate warning
Signal: STRONG (5 items). Omnivore #2747 has 13 thumbs-up (closed "not planned" in a 2026 batch cleanup).
- Wants a hint for already-added pages, citing Raindrop's checkmark, and clicking to open the existing item rather than re-adding [GH, BCL] https://github.com/omnivore-app/omnivore/issues/2747
- "cannot quickly determine if the page you are currently on is already hoarded" (7 thumbs-up; shipped as an opt-in badge Nov 2025) [GH, BCL] https://github.com/karakeep-app/karakeep/issues/486
- Open the existing bookmark instead of showing the new-bookmark form, to avoid "accidentally re-saving" (Sep 2026) [GH, MSP] https://github.com/karakeep-app/karakeep/issues/3082
- "Indicate if the current URL is referenced in Obsidian" [GH, BCL] https://github.com/obsidianmd/obsidian-clipper/issues/112
Daylight idea: a local, hashed send-history on the sender (the relay never sees content). Opt-in; the privacy debate in #2747 shows users accept hashing.

### 21. Automation surface: Shortcuts with a return value, URL scheme, CLI, API, IFTTT
Signal: VERY STRONG. 8 items. Tailscale #2504 (34 thumbs-up) and LocalSend CLI #11 (36 reactions).
- After Shortcuts support shipped it "made tailscale on iOS so much more powerful" [GH, MSP] https://github.com/tailscale/tailscale/issues/2504
- "When adding a URL to Omnivore using Shortcuts; there is no return value." Maintainer: "Updated this in the last TestFlight build." [GH, MSP] https://github.com/omnivore-app/omnivore/issues/3898
- Omnivore's Shortcuts action "didn't work when sharing from NetNewsWire" (8 thumbs-up) [GH, MSP] https://github.com/omnivore-app/omnivore/issues/2264
- "Add shortcuts for iOS so that one can chain automations" [GH, MSP] https://github.com/karakeep-app/karakeep/issues/2892
- "Pocket's TWO BIG features were recommended articles and integration with IFTTT" (HN 2025 comment; RLA does not give the item ID) [SN, RLA]
- Headless/CLI mode (36 reactions, shipped in LocalSend 1.18) [GH, XDT] https://github.com/localsend/localsend/issues/11
- Readwise CLI with `--json` and a read-only mode so an agent "cannot silently re-enable write access" [DOC, NRA] https://github.com/readwiseio/readwise-cli
Daylight idea: App Intents action returning an honest result, `daylight://send?url=`, Mac CLI, bookmarklet, Raycast. Zapier/IFTTT needs the Worker and is plaintext there.

### 22. Ownership: export, no lock-in, no surprise paywall, privacy
Signal: VERY STRONG but mostly [SN] (8 items). It is the emotional core of every Pocket/Omnivore migration thread.
- "I loved Pocket. I used it nearly daily." [SN, RLA] https://news.ycombinator.com/item?id=44065481
- "still bitter about them acquiring and shutting down Omnivore" (HN 2025 comment; RLA does not give the item ID; the Omnivore shutdown thread it cites is https://news.ycombinator.com/item?id=41985118) [SN, RLA]
- GoodLinks: "simpler than Pocket, Reeder, or Instapaper, with no social network attached, no subscription, and no full-blown RSS reader" [SN, RLA] https://talk.macpowerusers.com/t/why-use-goodlinks-already-have-reeder-and-pocket/24711
- "I use Raindrop.io and Karakeep wired up together. Total cost is under $30/year." [SN, RLA] https://news.ycombinator.com/item?id=44073350
- "The current pricing of Readwise seems like it will not be attractive to the 99% ..." [SN, RWR] https://news.ycombinator.com/item?id=44068545
- KOReader send-from-phone: "Depending on where this server is located, I'd see privacy problems here." (silberzwiebel) [GH, STK] https://github.com/koreader/koreader/issues/3630
- Obsidian clipper reward: "Your data is not collected, and we do not gather any usage metrics." [DOC, BCL]
Daylight idea: E2E, no account, no subscription, open export, documented protocol. Say it plainly in the app.

### 23. E-ink/Live-Paper reading ergonomics (page turn, contrast, less motion)
Signal: MODERATE (6 items, all secondhand; reader-side, not a companion feature).
- r/daylightcomputer user: page sliding "feels like doomscrolling rather than reading a book"; wants a whole-page-turn gesture [SN via redlib mirror, RWR; relayed, unverified] https://redlib.hbubli.cc/r/daylightcomputer/new
- Boox: "often misses swipe gestures to turn pages" (TechRadar Boox Go 6 review) [SN, EIT] https://www.techradar.com/tablets/ereaders/onyx-boox-go-6-review
- Boox NeoReader slow on large annotated PDFs [SN, EIT] https://help.boox.com/hc/en-us/community/posts/34857991656724-Page-switching-slow-on-large-heavily-annotated-pdfs
- reMarkable refresh latency "a full second or so" is "the dominant complaint across reMarkable reviews" [LOCAL-2ND, EIT]
- Readwise E-ink mode options (reduce motion, high contrast, volume-button paging, tap-to-turn) [DOC, RWR] https://docs.readwise.io/reader/docs/faqs/eink
- Kindle double-tap page turn "frustrating to use" [SN, EIT] https://blog.the-ebook-reader.com/2025/08/28/the-kindles-double-tap-page-turn-feature-is-frustrating-to-use/
Daylight idea: reader-change only; keep as input for the Mac mini session. For the Inbox, tap-to-turn and high-contrast rendering of received articles.

### 24. Image diet: WebP/AVIF fixed, size-capped, grayscale-friendly
Signal: MODERATE (5 items, GH).
- kindle-send open issues: ".webp images not displayed on Kindle"; "Inconsistent handling of missing images" [GH, STK] https://github.com/nikhil1raghav/kindle-send/issues
- Kobo Instapaper: webp images show a placeholder (MobileRead user) [SN, RLA] https://www.mobileread.com/forums/showthread.php?t=372113
- Amazon E999 on image-heavy EPUBs; maintainer: "related to the image sizes, so we need to resizing them for Kindle." [GH, STK] https://github.com/input-output-hk/mastering-cardano/issues/47
- send2ereader "[Feature Request] allow images in .png and .jpg formats" [GH, STK] https://github.com/daniel-j/send2ereader/issues
- Browser-side pushers resolve lazy images, convert WebP/AVIF to JPEG, cap at 1600 px, offer "no images" mode [DOC, BCL] https://github.com/manabubannai/kindle-send-chrome
Daylight idea: downscale/grayscale/recompress before upload (also dodges relay size limits).

### 25. Scan paper to a clean PDF
Signal: WEAK-MODERATE (2 threads from one project; largely my inference for a grayscale tablet).
- "the PDFs are so compressed that Paperless had some problems recognizing them" (Drexel2k) [GH, MSP] https://github.com/astubenbord/paperless-mobile/issues/322
- "Most scans lack contrast and look blurry in comparison with most 'scanner' apps." (goncalossilva) [GH, MSP] same URL
- Users are content to scan elsewhere and share ("FairScan -> Share with -> paperless already works") [GH, MSP] https://github.com/astubenbord/paperless-mobile/issues/657
Daylight idea: VisionKit/ML Kit scan with an "optimize for e-paper" contrast filter; also accept PDFs shared from any scanner app.

### Wants just outside the top 25 (signal noted)
- Text-to-speech with the text kept visible: Matter's HD TTS "the best one I've ever tested in 16 years of writing about apps" (MacStories) [SN, RLA] https://www.macstories.net/stories/macstories-selects-2025-recognizing-the-best-apps-of-the-year/ ; Omnivore "Love the text-to-speech option that allows the text to remain visible as the audio is played" [SN] https://talk.macpowerusers.com/t/omnivore-a-new-read-it-later-app/36583 ; Reader TTS lacked continuous playback [SN, RWR] https://news.ycombinator.com/item?id=38720882. Reader-side. MODERATE.
- AI summaries/auto-tag: split. Praised in Readwise reviews [SN, RWR]; Raindrop's AI organization suggestions "were not useful and setup took more time than expected" (paying subscriber) [SN, RLA] https://chromewebstore.google.com/detail/raindropio/ldgfbffkinooeloadekpmfoklnobpien/reviews . Also: a digest pipeline silently died when an LLM quota ran out [GH, NRA] https://github.com/taruncherukurigit/kindle-daily-digest . Never gate delivery on AI.
- Automatic cleanup after reading (finished articles removed/archived, no re-download): KOReader #5320 https://github.com/koreader/koreader/issues/5320 (open since 2019).
- Per-site rules/templates: Obsidian triggers; Karakeep #2831 https://github.com/karakeep-app/karakeep/issues/2831
- Preferences/tag vocabulary syncing across Mac/iPhone/Chrome: Obsidian #174, 17 thumbs-up, the top open request [GH, BCL] https://github.com/obsidianmd/obsidian-clipper/issues/174
- Native Mac Share-sheet: "The MacOS Safari extension works pretty well in MacOS Safari, but it hasn't a MacOS Share-Sheet" [GH, MSP] https://github.com/karakeep-app/karakeep/issues/1625

---------------------------------------------------------------------------
## 3. The 15 top frustrations, with quotes and URLs
---------------------------------------------------------------------------

Ordered by combined signal across products.

### F1. Silent failure and false "success"
Signal: VERY STRONG (14 items; see want 1). Success is reported while nothing arrived or the file is empty.
- "Email successfully sent" means only SMTP acceptance; Amazon rejects after acceptance and the user gets a later email (E999, E016) [GH + FAQ, STK] https://raw.githubusercontent.com/kovidgoyal/calibre/master/manual/faq.rst and https://github.com/cdhigh/KindleEar/issues/741
- "Immich should not claim the upload succeeded when it actually didn't." https://github.com/immich-app/immich/issues/2531
- iOS Shortcut "reports success but the file arrives empty" https://github.com/tailscale/tailscale/issues/18537 ; "[Android] share-intent files arrive as 0 bytes at receiver" (title) https://github.com/localsend/localsend/issues/3574
- Stale "Finished" screen swallows the next share until you tap Done https://github.com/localsend/localsend/issues/3197
- "Without this, Amazon drops the email silently." (readeck-paperboy README) https://github.com/vsgusev/readeck-paperboy [GH, NRA]

### F2. The receiver must be running, notifications don't appear, and always-on listeners drain battery
Signal: VERY STRONG (7 items; 22-27 reactions, 76 on the battery thread). See want 14 for quotes.
https://github.com/tailscale/tailscale/issues/8626 ; https://github.com/schlagmichdoch/PairDrop/issues/479 ; https://github.com/localsend/localsend/issues/3326 ; https://github.com/tailscale/tailscale/issues/3363
Also Xiaomi/MIUI: the OS "seems to prevent the Tailscale app from accepting incoming TCP connections", so the sender sees "peer is offline" [GH, MSP].

### F3. "Can't see my device": discovery fails on real networks
Signal: VERY STRONG for LAN tools (6+ items; reactions 59, 67, 33, 27). A cloud relay avoids it entirely.
- Windows reserves port 53317: "It's both frustrating and disheartening to see users resorting to manually opening ports in Windows" (adam-ah); "This is not very reliable. Even though 53317 is in the list of excludedportrange" (user1823) (59 reactions, open since Feb 2023) [GH, XDT] https://github.com/localsend/localsend/issues/125
- "a certain kind of public WiFi that doesn't allow device discovery" breaks the app while "AirDrop still works"; "my University WiFi doesn't allow device discovery" (27 reactions) [GH, XDT] https://github.com/localsend/localsend/issues/850
- "my PC never shows up on the list of devices on Android."; "Rarely do my Windows computers show as Taildrop targets." (33 reactions) [GH, XDT] https://github.com/tailscale/tailscale/issues/14393
- "Can't send from Mac to a Samsung device after the Quick Share update" (67 reactions) [GH, XDT] https://github.com/grishka/NearDrop/issues/152
- "Can't send to rquickshare from Pixel 10 Pro since AirDrop update." (11 reactions); "Since AirDrop compatibility was added to Quick Share, enabling Quick Share turns off Wi-Fi." (17) [GH, XDT] https://github.com/Martichou/rquickshare/issues/425 and https://github.com/Martichou/rquickshare/issues/358
- Phones and PCs "can't see each other" (VPN, firewall; 138 KB thread, unresolved) [GH, XDT] https://github.com/GSConnect/gnome-shell-extension-gsconnect/issues/1758

### F4. The Amazon/email plumbing tax and format roulette
Signal: VERY STRONG (8+ items; one thread 42 comments).
- Calibre FAQ: "Amazon's EPUB intake is very flawed, they will reject a number of EPUB files that work everywhere else."; "Amazon recently started sending confirmation emails that you have to click on"; "Google recently deliberately broke their email sending protocol (SMTP) support" [DOC/FAQ, STK] https://raw.githubusercontent.com/kovidgoyal/calibre/master/manual/faq.rst
- Amazon notice: "starting August 2022, you'll no longer be able to send MOBI (.mobi, .azw) files to your Kindle library." Every tool that emailed MOBI broke at once (42-comment thread) [GH, STK] https://github.com/janeczku/calibre-web/issues/2393
- "currently is really hard to find a SMTP e-mail without paying for a service or having to do several tweaks."; "The e-mail is limited to 50MB size" [GH, NRA] https://github.com/crocodilestick/Calibre-Web-Automated/issues/307
- Antivirus "block calibre from opening a connection to send email" (Calibre FAQ) and an antivirus footer broke delivery [STK]
- Kindle Scribe users: "PDFs arrive as PDFs unless the user asks for conversion" (see want 11)

### F5. Services die, get paywalled, or kill their integrations
Signal: VERY STRONG (9 items). Dates: Omnivore hosted service shut 2024-11-15 after ~2 weeks' notice; Pocket read-only 2025-07-08, API off 2025-11-12, data deleted 2025-10-08; Instapaper Send to Kindle to Premium 2026-02-19 (RLA).
- "I loved Pocket. I used it nearly daily." https://news.ycombinator.com/item?id=44065481 [SN]
- "still bitter about them acquiring and shutting down Omnivore" [SN, RLA]
- Omnivore export reportedly usable only with ElevenReader: "exports for Pocket, Instapaper, etc are not offered" [SN, RLA; one of the HN/Lemmy/MacRumors shutdown threads] https://news.ycombinator.com/item?id=41985118
- Kobo owners: Pocket was "one of the selling points for Kobo ereaders" and "something other brands didn't have built-in"; after a month with Instapaper-on-Kobo one commenter went back "to KOreader and Wallabag" [SN, RLA/EIT] https://blog.the-ebook-reader.com/2025/07/22/kobos-getting-instapaper-integration-pocket-articles-import/
- Instapaper Send to Kindle paywall: reaction split between "I'd pay for quality" and "resented paying for previously free feature" [PRESS, RLA] https://www.androidpolice.com/your-amazon-kindle-is-losing-yet-another-free-feature/ ; https://www.pocket-lint.com/instapaper-send-to-kindle-going-behind-paywall/
- Vendor "not planned" closures: Omnivore #2142 (36 thumbs-up) and Miniflux #228 (8) [GH, NRA]
- Price as a barrier: "most expensive read-later app" (3P) and the HN pricing quote in want 22 [SN, RWR]

### F6. Thin or empty extraction, and server-side fetchers that can't see what you see
Signal: STRONG (6+ items).
- Readwise docs: apps like NYT/Medium "aggressively block read-it-later apps", so a share from them may give "only the naked URL" [DOC, RWR] https://docs.readwise.io/reader/docs/faqs/parsing
- "Note ... is empty at all of our local newspaper articles" https://github.com/obsidianmd/obsidian-clipper/issues/484
- Infinite scroll/X threads: "SingleFile can only save what is present in the page." (maintainer, closed not planned Aug 2026) https://github.com/gildas-lormeau/SingleFile/issues/1931 ; clipper saved the first 4 of a 7-tweet thread https://github.com/obsidianmd/obsidian-clipper/issues/264
- Karakeep headless-Chrome snapshots break on login pages (want 6)
- Readwise users: "no 'regenerate parse'" (AlternativeTo) [SN, RWR] https://alternativeto.net/software/readwise-reader/about

### F7. Digest repeats, re-downloads and clutter
Signal: STRONG (4+ items).
- "I currently use the free Instapaper feature that sends 10 saved articles to my Kindle each day. But it's a bit annoying as it includes the same articles in the daily packages lots of times." https://www.mobileread.com/forums/showthread.php?p=4545848 [SN, RLA]
- KOReader: "it will re-download any articles you have tried to delete until they have 'fallen' off the end of the RSS feed. This leads to the news folder filling up with old stuff" (open since 2019) https://github.com/koreader/koreader/issues/5320 [GH, NRA]
- Per-article files clutter the Kindle library; HN is split between one item per article and a weekly compilation [SN, RLA]
- Older: Kindle Touch digests had an unusable table of contents and files couldn't be deleted from the device (MobileRead 2011) [SN, RLA]

### F8. Round trips are one-way (annotations and read-state don't come back)
Signal: VERY STRONG (7 items; 15 reactions on KOReader #7143). Quotes in want 12.
https://github.com/koreader/koreader/issues/7143 ; https://github.com/Endle/readwisereader ; https://christiantietze.de/posts/2023/05/boox-neoreader-annotation-export-is-meh/

### F9. Layout and format degradation (silent fixed-layout, mojibake, forced PDF conversion)
Signal: STRONG (6 items).
- Amazon E016: delivered with original layout "because its formatting is incompatible with Kindle's reflowable layout" so EPUB news arrives "as PDF-style pages", text can't be resized, "tiny on a 7-inch screen" (open, 26 comments, Sep 30 - Oct 19, 2026) [GH, STK] https://github.com/cdhigh/KindleEar/issues/741
- Books looked fine but arrived with "â€™️" "where I think there should be an apostrophe"; "1 out of 5 eBooks wouldn't send"; users "asked for this to be built in, since the manual steps add many clicks" [GH, STK] https://github.com/janeczku/calibre-web/issues/2508
- Forced "convert" "breaks PDF's ... throwing out images and formatting" https://github.com/bookorbit/bookorbit/issues/1205
- ".webp images not displayed on Kindle" https://github.com/nikhil1raghav/kindle-send/issues

### F10. Size cliffs and slow, non-resumable big transfers
Signal: STRONG (6 items; 39 reactions on LocalSend #384).
- LocalSend: "51 kbps" Windows to Android; "With encryption off, I get 103MB/s." https://github.com/localsend/localsend/issues/384
- PairDrop: 300-400 KB/s on mobile; iOS Safari ~200 MB cap; a 4.4 GB send still failing Apr 2026 [GH, XDT] https://github.com/schlagmichdoch/PairDrop/issues/120 and https://github.com/schlagmichdoch/PairDrop/issues/44
- Amazon: ~98-134 MB EPUBs fail; email cap 50 MB https://github.com/input-output-hk/mastering-cardano/issues/47
- NearDrop comment (Apr 2024): "it only can send around 5MB or 10MB at top" [GH, XDT] https://github.com/grishka/NearDrop/issues
- [LOCAL] ntfy.sh 2 MiB attachment cap hits our own relay (EIT/NRA)

### F11. Setup burden and fragile DIY glue
Signal: STRONG (7 items).
- Wallabag: "self hosting is beyond the skills of ordinary users"; "app quite buggy and site fairly clunky", "design dated" [SN, RLA] https://news.ycombinator.com/item?id=44694980
- Wallabako needs KoboRoot.tgz + config and a "fake USB connection" tap; its author found it "a bit hacky" [GH/blog, RLA] https://anarc.at/blog/2022-05-06-wallabako-1.4.0-released/
- KOReader Wallabag plugin: ~50-character credentials edited in a Lua file; "Wallabag stops downloading after a few articles" (41 comments) [GH, STK] https://github.com/koreader/koreader/issues/14147
- send2ereader (hosted): "502 bad gateway on website; :((((", "Website not working correctly in Kindle browser" [GH titles, STK] https://github.com/daniel-j/send2ereader/issues
- KoboCloud: "Due to a change in Dropbox website, the public folder method does not work anymore." [DOC, STK] https://github.com/fsantini/KoboCloud
- "Your computer needs to be on for this job to run." (Reddit-to-Kindle) [DOC, NRA] https://github.com/jstriblet/Reddit-to-Kindle

### F12. Updates and OS changes silently break pairing and clients
Signal: STRONG (6 items; 63 comments on GSConnect #1932).
- KDE Connect Android 1.33.0 stopped pairing with GSConnect: "Can reproduce exactly. What the heck."; "I can't pair any device." [GH, XDT] https://github.com/GSConnect/gnome-shell-extension-gsconnect/issues/1932
- Pixel 10 Quick Share/AirDrop interop broke LAN receivers (want F3 links)
- Amazon backend change: stkclient 0.2.0 (2026-10-12) "Migrate delivery to the Kindle Docs API" broke clients; earlier HTTP 403 "Failed to validate DeviceInfoToken" [GH, STK] https://github.com/maxdjohnson/stkclient/issues
- "Amazon may change or block the undocumented API at any time." (KindBeamer) https://github.com/jooray/kindbeamer
- LocalSend 1.18.x needed compat hotfixes ("Fixes compatibility with v1.17.0 and earlier") [DOC, XDT] https://github.com/localsend/localsend/releases
- Kobo re-syncs its config and overwrites a custom endpoint (readeckobo) [DOC, RLA] https://codeberg.org/eleith/readeckobo

### F13. Stripped-down "native" integrations and thin official extensions
Signal: MODERATE-STRONG (6 items).
- Kobo + Instapaper: only the main list syncs; no tags, highlights, notes, videos or PDFs; no folders; emailed-in items don't appear [DOC, RLA] https://help.kobo.com/hc/en-us/articles/33359968957463
- Amazon's own Chrome extension is "buggy" and "breaks because it depends on Amazon's authenticated web endpoints" (claim by a competing extension's README; unverified) [DOC, BCL] https://github.com/manabubannai/kindle-send-chrome
- Raindrop extension: "popup slow to open, save button missing, 'buggy'" [SN, RLA]
- Matter on Mac: "Matter's share extension has been broken on and off again" (MacStories reviewer) [SN, RLA]
- Readwise isn't an app on Kindle/Kobo; Kindle copies don't get highlights back [DOC, RWR]
- Third-party Chrome extensions exist because Instapaper's official one is thin [SN, RLA]

### F14. Safari/iOS friction
Signal: MODERATE-STRONG (7 items).
- Safari asks "Do you want to allow this website to open 'Obsidian.app'?" on every clip (per site) https://github.com/obsidianmd/obsidian-clipper/issues/306
- Pinned tab without extension permission: "This page cannot be clipped" https://github.com/obsidianmd/obsidian-clipper/issues/345
- iOS 27 save button hidden by the keyboard; blank popups on iOS/iPadOS https://github.com/obsidianmd/obsidian-clipper/issues/634 ; /815 ; /997
- Instapaper missing from the iOS share sheet until enabled; Readwise: if Reader is missing from the share menu, "restart your device" [DOC/SN, RLA/RWR]
- No right-click "add to highlights" in Safari https://github.com/obsidianmd/obsidian-clipper/issues/850
- Safari extension settings don't sync across Mac/iPhone/iPad https://github.com/obsidianmd/obsidian-clipper/issues/174

### F15. Trust and privacy: who can read it, and who is allowed to push to me
Signal: MODERATE (5 items).
- PairDrop: a web page cannot prove its own code; "You need to trust this URL/server." (open since Oct 2023) [GH, XDT] https://github.com/schlagmichdoch/PairDrop/issues/180
- Taildrop: a macOS .command file "appeared directly in Downloads without recipient approval or a visible notification"; user asks for "explicit acceptance, clear sender identity, notifications" [GH, XDT] https://github.com/tailscale/tailscale/issues/15670
- "Depending on where this server is located, I'd see privacy problems here." [GH, STK] https://github.com/koreader/koreader/issues/3630
- Readwise extension reviews: collects user data, requires login [SN, RWR] https://en-US.add-ons.mozilla.com/en-US/firefox/addon/readwise-highlighter/reviews/
- Auto-accept needs device verification: maintainer on RQuickShare #224: "it won't be enabled by default... there's no real verification of the device." [GH, XDT] https://github.com/Martichou/rquickshare/issues/224

### Frustrations just outside the top 15
Slow/heavy clients (Pocket web "dog-slow", extension "using ~1.5 cores", https://news.ycombinator.com/item?id=36649740 ; Linkwarden 500-950 MB RAM, https://news.ycombinator.com/item?id=43856801 ; Raindrop popup slow). AI features that disappoint (Raindrop AI "not useful"; G2 "AI tagging errors... manual sorting more efficient", https://g2.com/products/raindrop-io/reviews?page=2). Sync lag (Matter "occasional delays before new saves appear"; Instapaper Android "slow syncing"). Platform exclusion (Matter has no Android: HN "dealbreaker for some", https://news.ycombinator.com/item?id=44597668 ; GoodLinks Apple-only). Needing the internet to save (Raindrop: "An internet connection is required to sync changes and save new bookmarks"). Android OEM kill-switches (MIUI/HyperOS).

---------------------------------------------------------------------------
## 4. What the community says about the Daylight DC-1 specifically (thin)
---------------------------------------------------------------------------

I found no first-hand evidence. All of it is relayed, and the Reddit item is a mirror snippet.
- r/daylightcomputer (via redlib mirror; unverified): sliding pages "feels like doomscrolling rather than reading a book"; wants whole-page turns. https://redlib.hbubli.cc/r/daylightcomputer/new [SN, RWR]
- Readwise's own docs name the Daylight as an e-ink target for Reader (E-ink Mode; Daylight "has a very high refresh rate so it does not auto-turn-off motion reduction"). https://docs.readwise.io/reader/docs/faqs/eink [DOC, RWR]
- Reviews pointed at but unopened: https://max.pm/posts/daylight_dc1/ ; https://lu.is/2025/01/reading-in-2024-tools/ (bought a DC-1 after trying Boox; praises the warm screen) ; https://www.techradar.com/tablets/the-daylight-dc-1-is-an-exciting-cross-between-a-kindle-and-an-ipad-with-an-lcd-screen-that-looks-like-e-ink ; HN "Thoughts on Daylight Computer" https://news.ycombinator.com/item?id=43098318 ; Daylight support https://support.daylightcomputer.com/getting-started [SN/INF, EIT/RWR]
- [LOCAL] The Reader owner's own asks: email-in "really incredible" (DECISIONS 27); no library sync yet; highlights leave only via the share sheet; no RSS/import yet (LB-52, LB-53). 
- [INF, EIT] A DC-1 owner who finds an article on a phone today opens the link on the tablet by hand, messages it to themselves, or uses a Play-store read-later app. That gap is what the companions fill. Nothing here confirms it with owners.

---------------------------------------------------------------------------
## 5. Products that appear in the community evidence
---------------------------------------------------------------------------

| Product | Platforms | Status (as relayed) | Best known / loved for |
|---|---|---|---|
| Readwise Reader | iOS, Android (incl. e-ink mode for Boox/Daylight), web, Mac/Windows, Chrome/Firefox/Safari | Active, "Public Beta", ~$9.99/mo annual | Everything-in-one inbox, rendered-page capture, highlights loop, Send-to-Kindle digest |
| Instapaper | iOS, Android, web, Chrome/Firefox/Safari, Kindle (email), Kobo (native) | Active; new web + Instapaper 10 (Jul 2026); Send to Kindle Premium since 2026-02-19 | Offline reliability, Kindle digests, paywalled capture |
| Matter | iOS, iPad, web, Chrome/Safari/Firefox (no Android) | Active | Parsing, HD TTS, bulk send as one ebook |
| GoodLinks | iOS, iPadOS, macOS, Vision (Apple-only) | Active (4.1 on 2026-10-12) | No subscription, Shortcuts/URL scheme, iCloud sync |
| Raindrop.io | iOS, Android, web, Mac, browsers | Active | Collections, Unsorted inbox, duplicate checkmark; no offline reading |
| Wallabag | web, Android, extensions; KOReader plugin | Active; iOS app ownership changed | Open source, tagging rules, e-reader bridges |
| Karakeep (ex-Hoarder) | iOS, Android, web, Chrome/Firefox/Safari | Active (0.34.0, 2026-10-17) | Self-host, LLM tagging, RSS ingest; share-sheet friction |
| Readeck | web, extension, PWA | Active | Readable output, EPUB/OPDS, Kobo bridges |
| Linkwarden | web, iOS, Android, extension | Active | Archives, mobile apps (Nov 2025) |
| Pocket | -- | Shut down (read-only 2025-07-08; API off 2025-11-12) | One-click, huge integration ecosystem, Kobo built-in |
| Omnivore | -- | Hosted app shut 2024-11-15 (ElevenLabs acqui-hire); self-host remains | Parser/typography, Obsidian sync, free |
| Amazon Send to Kindle | Email, web, desktop apps, Kindle apps, Chrome ext | Active; backend changes Oct 2026 | Universal reach; weak web-article quality, silent failures |
| Kobo + Instapaper | Kobo firmware | Since Aug 2025 (replaced Pocket) | Native code/QR link; stripped-down sync |
| KOReader (+ plugins) | Kindle, Kobo, PocketBook, Android, reMarkable | Very active (~30k stars) | Wallabag/Readeck/Instapaper/NewsDownloader/LocalSend plugins |
| send2ereader / BookDrop | Any e-reader browser | Active (~1.1k stars); hosted outages | Zero-install key + QR pairing from the device browser |
| Calibre / Calibre-Web(-Automated) | Desktop/server | Active | Share-by-email, ingest + auto-send, recipes |
| KindleEar | Self-hosted | Active (~2.9k stars) | Daily RSS/recipe magazines to Kindle |
| Read on reMarkable | Chrome ext, mobile share | Active | One click: article or PDF, arrives writable (BG/BCL) |
| Boox (BooxDrop/Send2Boox) | Android e-ink | Active | Any Android app + LAN drop (EIT, background knowledge) |
| Supernote | e-ink | Active | Browse & Access LAN drop (EIT, background knowledge) |
| LocalSend | iOS, Android, Mac, Windows, Linux | Active (1.18.2) | AirDrop-like LAN send; share-sheet, favorites, CLI |
| Tailscale Taildrop | All | Active | OS-integrated send; notification/target-list pain |
| PairDrop / Snapdrop | Browser/PWA | Active | Persistent pair by 6-digit code/QR |
| KDE Connect / GSConnect | Android, Linux, iOS | Active | Share files/URLs, notification sync |
| Quick Share / NearDrop / RQuickShare / AirDrop | Android, Mac, Windows | Active; Pixel 10 interop (2026) | Nearby send; discovery fragility |
| Pushbullet / Join | Android, browser, desktop | Stagnant (Pushbullet) | Devices in the share sheet; "push this page to my phone" |
| Obsidian Web Clipper | Chrome, Firefox, Safari, Edge | Very active (v1.7.1, Jul 2026) | Templates, Reader mode, persistent highlighter |
| SingleFile | Chrome, Firefox, Edge, Safari | Active | Faithful single-file page snapshot |
| Send to KOReader (Tsukumi233) | Android app + KOReader patch | New (2026-10-08) | "Send to Kindle, but for KOReader" over WebDAV |
| Daylight DC-1 | Android 13 LivePaper tablet | Active | Fast reflective screen; Reader app with ink |

---------------------------------------------------------------------------
## 6. My read of the pattern (INFERENCE, not evidence)
---------------------------------------------------------------------------

1. The community's loudest, most corroborated complaint across every transfer product is not missing features, it is **not knowing whether it worked**
   (F1, F2, F3 together carry the largest reaction counts: 22-27, 59, 67, 76). Send to Daylight already has E2E receipts and a relay that
   avoids LAN discovery; making the four states visible and the tablet notification reliable would be the strongest differentiator.
2. **Wants 2, 3, 4, 14, 15** (in-place share, outbox, devices in share sheet, background notification, links as links) are all
   companion-side and cheap relative to their evidence weight.
3. **Round-trip** (want 12) and **big files** (want 11) are the two biggest competitive gaps and both need work outside the companions
   (Reader change; Worker/R2). The relay's 2 MiB cap is a hard blocker for PDFs.
4. **Ownership and no-surprise-paywall** (want 22, F5) is the emotional layer under every migration thread; E2E + no account + documented
   protocol is a genuine promise to make.
5. Developer and self-hoster skew: automation, tagging rules, RSS and self-hosting appear stronger here than they would among average
   Kindle/Kobo owners. Expect the average DC-1 owner to care most about wants 1, 2, 5, 6, 11, 14, 15.

---------------------------------------------------------------------------
## 7. To-do for a follow-up run with network access and search budget
---------------------------------------------------------------------------

Priority threads/queries (none attempted successfully):
1. Reddit: r/DaylightComputer ("how do you get articles on", "Reader", "Instapaper", "Readwise", "send"), r/kindle and r/ereader ("send articles to Kindle", "Send to Kindle broken", "Instapaper digest"), r/remarkable ("Read on reMarkable", "send articles"), r/Onyx_Boox (BooxDrop, Push Read), r/supernote, r/readwise (Kobo, e-ink, bug threads), r/instapaper (Kindle paywall, Kobo), r/selfhosted (Karakeep, Wallabag, Readeck, send2ereader, KindleEar).
2. Hacker News (by item ID, from sibling notes): 43098318 (Daylight), 34006202 and 34156055 (Readwise Reader), 44068545 and 44066353 (Readwise price/Kobo), 44597668 and 44073347 (Pocket alternatives), 41985118 (Omnivore shutdown), 17706597 (Instapaper Kindle), 38720882 (Reader TTS), 44694980 (Wallabag/Readeck), 43681408 (Karakeep), 47541969 (Kindle newspaper).
3. MobileRead: https://www.mobileread.com/forums/showthread.php?p=4545848 (Instapaper digest repeats), ?t=372113 (KOReader Instapaper plugin), ?p=4432915 (Readwise-Kobo buggy), ?p=4523064 (eReaditLater).
4. Store reviews: App Store and Play for Readwise Reader (id1567599761), Instapaper (id288545208), Matter, Karakeep, Send to Kindle; Chrome Web Store reviews for Amazon Send to Kindle (cgdjpilhipecahhcilnafpblkieebhea), Read on reMarkable, Readwise Highlighter, Instapaper, Raindrop.
5. YouTube: "GoodLinks Made Me Cancel My Readwise Subscription" https://www.youtube.com/watch?v=OqEbHuvHSOc ; "Readwise vs Instapaper" https://www.youtube.com/watch?v=6nanSmYZP0U ; Readwise Reader e-ink review (AI summary at https://lilys.ai/en/notes/lilysai-20260829/readwise-reader-eink-improved) ; Daylight DC-1 reading/article workflow videos; "best way to send articles to reMarkable".
6. Re-verify every quote tagged [SN] and spot-check every [GH] quote before using it in user-facing copy.

---------------------------------------------------------------------------
## 8. Source index (URLs cited above; NONE opened by me)
---------------------------------------------------------------------------

GitHub issues/READMEs (read by sibling agents):
https://github.com/tailscale/tailscale/issues/8626 , /3363 , /3621 , /4896 , /4996 , /8509 , /9444 , /14393 , /15670 , /17988 , /18200 , /18537 , /2504
https://github.com/localsend/localsend/issues/11 , /125 , /384 , /462 , /850 , /2153 , /2351 , /3014 , /3197 , /3326 , /3574
https://github.com/schlagmichdoch/PairDrop/issues/44 , /120 , /180 , /479 ; https://github.com/schlagmichdoch/PairDrop
https://github.com/grishka/NearDrop/issues/117 , /152 ; https://github.com/Martichou/rquickshare/issues/182 , /224 , /245 , /358 , /425
https://github.com/GSConnect/gnome-shell-extension-gsconnect/issues/1758 , /1932
https://github.com/karakeep-app/karakeep/issues/49 , /202 , /237 , /333 , /486 , /948 , /956 , /1167 , /1188 , /1468 , /1625 , /1984 , /2401 , /2795 , /1710 , /2831 , /2892 , /3018 , /3082 , /3134
https://github.com/omnivore-app/omnivore/issues/1829 , /2142 , /2198 , /2230 , /2264 , /2366 , /2747 , /2817 , /3143 , /3335 , /3898
https://github.com/obsidianmd/obsidian-clipper/issues/83 , /111 , /112 , /174 , /181 , /264 , /268 , /306 , /345 , /472 , /484 , /634 , /646 , /744 , /815 , /850 , /949 , /957 , /997
https://github.com/koreader/koreader/issues/3630 , /5320 , /7143 , /9937 , /14147
https://github.com/miniflux/v2/issues/228 ; https://github.com/FreshRSS/FreshRSS/issues/2516
https://github.com/crocodilestick/Calibre-Web-Automated/issues/156 , /211 , /307 , /1309
https://github.com/janeczku/calibre-web/issues/2393 , /2508 ; https://github.com/cdhigh/KindleEar/issues/741
https://github.com/bookorbit/bookorbit/issues/1205 , /1442 , /1732 ; https://github.com/cjus/cjus-skills/issues/62
https://github.com/input-output-hk/mastering-cardano/issues/47 ; https://github.com/tiilyat/omakindle/issues/7
https://github.com/daniel-j/send2ereader/issues , /52 ; https://github.com/eitan12345om/book-drop
https://github.com/immich-app/immich/issues/2531 , /30391 ; https://github.com/wallabag/android-app/issues/675 ; https://github.com/wallabag/wallabagger/issues/334
https://github.com/zotero/zotero-connectors/issues/310 , /376 ; https://github.com/astubenbord/paperless-mobile/issues/322 , /657
https://github.com/gildas-lormeau/SingleFile/issues/1215 , /1931 ; https://github.com/deathau/markdownload/issues/21
https://github.com/janlarres/kobo-utilities/issues/41 ; https://github.com/maxdjohnson/stkclient/issues ; https://github.com/jooray/kindbeamer ; https://github.com/manabubannai/kindle-send-chrome ; https://github.com/nikhil1raghav/kindle-send/issues ; https://github.com/fsantini/KoboCloud ; https://github.com/voidberg/instakobo ; https://github.com/Endle/readwisereader ; https://github.com/vsgusev/readeck-paperboy ; https://github.com/jstriblet/Reddit-to-Kindle ; https://github.com/taruncherukurigit/kindle-daily-digest ; https://github.com/readwiseio/readwise-cli
https://raw.githubusercontent.com/kovidgoyal/calibre/master/manual/faq.rst ; https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Obsidian%20Web%20Clipper/ (Clip%20web%20pages.md, Troubleshoot%20Web%20Clipper.md)

Search-snippet sources (unopened by anyone):
https://news.ycombinator.com/item?id=17706597 , 34006202 , 34156055 , 36649740 , 37890742 , 38720882 , 39812380 , 41985118 , 43098318 , 43856801 , 44064701 , 44065481 , 44066353 , 44068524 , 44068545 , 44073347 , 44073350 , 44597668 , 44694980 , 47541969
https://www.mobileread.com/forums/showthread.php?p=4545848 , ?t=372113 , ?p=4432915
https://talk.macpowerusers.com/t/any-one-using-matter-in-view-to-replace-instapaper-and-pocket-etc/27034 , /t/why-use-goodlinks-already-have-reeder-and-pocket/24711 , /t/omnivore-a-new-read-it-later-app/36583
https://blog.the-ebook-reader.com/2025/07/12/pocket-support-has-ended-on-kobos-without-any-alternatives/ , /2025/07/22/kobos-getting-instapaper-integration-pocket-articles-import/ , /2025/08/28/the-kindles-double-tap-page-turn-feature-is-frustrating-to-use/
https://www.androidpolice.com/your-amazon-kindle-is-losing-yet-another-free-feature/ ; https://www.pocket-lint.com/instapaper-send-to-kindle-going-behind-paywall/ ; https://www.techradar.com/tablets/ereaders/onyx-boox-go-6-review
https://christiantietze.de/posts/2023/05/boox-neoreader-annotation-export-is-meh/ ; https://borednbookless.com/reading-pdfs-on-remarkable-2/ ; https://help.boox.com/hc/en-us/community/posts/34857991656724-Page-switching-slow-on-large-heavily-annotated-pdfs
https://extensionauditor.com/scan/matter-knjbgabkeojmfdhindppcmhhfiembkeb ; https://chromewebstore.google.com/detail/raindropio/ldgfbffkinooeloadekpmfoklnobpien/reviews ; https://g2.com/products/raindrop-io/reviews?page=2 ; https://better.raindrop.io/feature-requests/p/offline-support-reading-viewing
https://alternativeto.net/software/readwise-reader/about ; https://archive.dougbelshaw.com/thought-shrapnel/no-breathless-whispering-of-mark/ ; https://club.macstories.net/posts/using-readwise-reader-as-my-rss-client ; https://www.macstories.net/stories/macstories-selects-2025-recognizing-the-best-apps-of-the-year/
https://redlib.hbubli.cc/r/daylightcomputer/new ; https://max.pm/posts/daylight_dc1/ ; https://lu.is/2025/01/reading-in-2024-tools/ ; https://www.techradar.com/tablets/the-daylight-dc-1-is-an-exciting-cross-between-a-kindle-and-an-ipad-with-an-lcd-screen-that-looks-like-e-ink
Docs relayed: https://docs.readwise.io/reader/docs/saving-content , /faqs/parsing , /faqs/exporting , /faqs/eink , /faqs/email-newsletters ; https://help.kobo.com/hc/en-us/articles/33359968957463 ; https://www.getmatter.com/updates/send-to-kindle ; https://anarc.at/blog/2022-05-06-wallabako-1.4.0-released/ ; https://codeberg.org/eleith/readeckobo

Project files relayed: `/home/user/MHW/reader-experiment/LAB-DECISIONS.md` (Lab rules, Worker plan), `README.md`, `share/NTFY-FACTS.md` (2 MiB attachment cap), Daylight Reader `DECISIONS.md` item 27 (email-in "really incredible").
