# Follow-up: uncovered products, platform built-ins and per-platform scorecards (PARTIAL: no web search was possible)

Angle: the missing product families (Apple, Google, Edge, Firefox built-ins; RSS clients; Substack/Medium; Libby; Notion/Obsidian capture; listen-first apps) and a ranked scorecard per platform (iPhone, Android, Chrome/Edge/Firefox extension, Mac app, cross-device handoff).
Project: "Send to Daylight" companions feeding the Daylight Reader on the DC-1. Compiled 2026-10-20 by the follow-up agent (Sonnet 5.5).

---------------------------------------------------------------------------
## 0. READ FIRST: what this run could and could not do

**WebSearch was refused on every call.** I made 4 attempts (standard mode, one with allowed_domains for macstories.net, 9to5mac.com, theverge.com, androidpolice.com) and all returned: "this turn's web search budget is used up (limit: 200 WebSearch calls per turn, shared by every agent in it)". I did not work around it (no curl to search engines, no readers, proxies or archives). So the plan of ~35 standard searches produced **0 search snippets**.

Consequences, stated plainly:

1. **There are zero [SNIPPET-ONLY] items in this file.** Nothing came from a search result.
2. **No store ratings or rating counts were gathered for any product.** App Store, Play, Chrome Web Store and AMO are policy-denied or do not resolve. Every "rating" cell in the scorecards says NOT GATHERED, except figures a sibling file had already relayed, which I tag [SIB-RELAYED] and did not open.
3. **No MacStories / 9to5Mac / Android Police / Verge / Wirecutter / YouTube review was read.** "Praised features" in the scorecards are therefore either from product source/docs I opened, from GitHub issue threads I opened, from sibling notes, or from my own recall (tagged [KNOWLEDGE-UNVERIFIED]). They are NOT reviewer quotes.
4. The rankings below are **provisional judgements**, not review-derived rankings. I say how confident I am on each row.

Evidence tags used in this file (I added two to the two you asked for, because the honest answer needed them):

| Tag | Meaning |
|---|---|
| [OPENED] | I fetched the page or file this run (WebFetch of a github.com page, or curl of raw.githubusercontent.com) and the fact comes from that text. Raw files fetched with curl are verbatim. WebFetch pages were summarised by a small model; quotes shown in quotation marks are the ones it returned (it caps quotes at ~125 characters), so treat them as near-verbatim. |
| [SNIPPET-ONLY] | A search-result snippet. **None this run.** |
| [SIB-RELAYED] | Stated in a sibling notes file in this folder. I read that file, not the source. Weakest of the sourced tags. |
| [KNOWLEDGE-UNVERIFIED] | From my own memory (training data through ~mid 2026). No URL. May be outdated or wrong. Use only as a to-verify list. Confidence H/M/L given where it matters. |

What worked: github.com pages (WebFetch) and raw.githubusercontent.com (curl). That is why the opened evidence is dominated by open-source projects: Chromium, Firefox, NetNewsWire, Capy Reader, Feeder, FeedMe, Read You, Omnivore and Obsidian's help docs. Those are real and recent (several touched this week), and Chromium/Firefox source is the strongest possible evidence of what Chrome and Firefox actually do.

What failed (exact):

| Attempt | Result |
|---|---|
| WebSearch x4 | Budget refusal, every time |
| WebFetch hn.algolia.com (HN API) | `getaddrinfo ENOTFOUND hn.algolia.com` |
| WebFetch reederapp.com, www.macstories.net, goldenhillsoftware.com, elevenreader.io | `getaddrinfo ENOTFOUND` for all four |
| WebFetch developer.apple.com/documentation/foundation/nsuseractivity | Page body not rendered (JS); the tool returned only the title and then answered from its own memory. I do NOT count this as opened. |
| `gh api` (GH_TOKEN invalid; repo access gated, "use add_repo") | 403 for every repo. I did not call add_repo: these repos are not needed to write a research file and add_repo mints credentials. WebFetch of github.com HTML worked instead. |
| github.com/MicrosoftDocs/Edge-Enterprise, GoogleChrome/chrome-extensions-samples reading-list sample, obsidian-help "Obsidian Mobile" folder | 404 (wrong paths or repos not public); Edge policy docs therefore not opened |
| api.github.com (unauthenticated) | 403 "GitHub access ... not enabled for this session" |

What would unblock the rest (user's call): raise `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` or start a turn with a fresh budget, then run the query pack in section 9. Allowing apps.apple.com / play.google.com / chromewebstore.google.com / addons.mozilla.org would add the rating cells. The user said to retry every six hours; the next orchestrator pass should rerun section 9 first.

---------------------------------------------------------------------------
## 1. What I actually opened (source index with what each gave)

### 1.1 Chromium source (Chrome built-ins). Strongest evidence in this file.
- https://github.com/chromium/chromium/tree/main/components/send_tab_to_self (directory) and raw files: README.md, features.h, features.cc, entry_point_display_reason.h, page_context.h, received_tab_forms_filler.h, outgoing_tab_form_field_extractor.h under https://raw.githubusercontent.com/chromium/chromium/main/components/send_tab_to_self/
- https://raw.githubusercontent.com/chromium/chromium/main/components/sync/protocol/send_tab_to_self_specifics.proto
- https://raw.githubusercontent.com/chromium/chromium/main/ui/accessibility/accessibility_features.h and .cc (Reading Mode flags)
- https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/extensions/api/reading_list.webidl (chrome.readingList API)
- https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/extensions/api/_permission_features.json (readingList permission: stable, extension, MV3 minimum)
- https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/extensions/api/page_capture.json (chrome.pageCapture.saveAsMHTML)
- https://github.com/chromium/chromium/tree/main/components/reading_list (only `core/` and `ios/` dirs; no README)

### 1.2 Mozilla source (Firefox built-ins)
- https://raw.githubusercontent.com/mozilla-firefox/firefox/main/services/fxaccounts/FxAccountsCommands.sys.mjs (Send Tab)
- https://raw.githubusercontent.com/mozilla-firefox/firefox/main/toolkit/components/reader/ReaderMode.sys.mjs (Reader View)
- https://github.com/mozilla-firefox/firefox/tree/main/toolkit/components/narrate (Narrate files only: Narrator, NarrateControls, VoiceSelect)

### 1.3 RSS / reader apps (GitHub repos, releases, issues)
- NetNewsWire: https://github.com/Ranchero-Software/NetNewsWire , /releases , /releases?page=4 , issues /3023 /1873 /1551 /4665 /4400 /3634 /3664 and issue-list queries (share extension; open issues by reactions; "reading list")
- Capy Reader: https://github.com/jocmp/capyreader , /releases , /releases/tag/2026.10.1213 , /issues/568 , /issues/1298 , issue list by reactions
- Feeder: https://github.com/spacecowboy/Feeder , /releases , issue list by reactions
- FeedMe: https://github.com/seazon/FeedMe/releases , /releases/tag/4.12.0 , issue list by reactions
- Read You: https://github.com/ReadYouApp/ReadYou , /issues/144 , issue list by reactions
- Omnivore: https://github.com/omnivore-app/omnivore (README)

### 1.4 Capture apps (docs in GitHub)
- Obsidian mobile docs (verbatim via curl): https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Getting%20started/Mobile%20app.md , .../en/Obsidian/Obsidian%20for%20iOS%20and%20iPadOS.md , .../en/Obsidian/Obsidian%20for%20Android.md

### 1.5 Other
- https://github.com/google/nearby (README only: Nearby Connections / Presence / Embedded; says nothing about the Quick Share app; "not an officially supported Google product")

---------------------------------------------------------------------------
## 2. Findings by product family

### 2.1 Chrome (built-ins) [OPENED unless tagged]

**Send tab to self ("Send to your devices")**
- README: "Send Tab To Self is a component providing necessary APIs for sending tabs between devices in Chrome." Started for Android and Desktop, goal all platforms.
- The sync entry (`SendTabToSelfSpecifics`) carries: guid, title, url, shared time, sender device name, `target_device_sync_cache_guid`, `opened` (bool), `notification_dismissed`, and new timestamps the **receiving device writes back for the sender to see**: `received_time` (M148), `opened_time` (M148), `activated_time` (M151, set when the user actually activates the tab). So Chrome tracks sent / received / opened / activated per tab, the same shape as our receipts.
- **`page_context` (M147) carries scroll position and form-field values to the target device.** Scroll position is stored as a Text Fragment (`text_start`, optional `text_end`, `prefix`, `suffix`, "used for scroll position restoration"). Form fields are extracted per origin via Autofill, with `IsSensitiveFieldType` excluding passwords and other sensitive types, and restored by `ReceivedTabFormsFiller` on the target. From M149 the page context is sent as `encrypted_page_context` unless custom-passphrase encryption is on.
- Also carried (behind flags): back/forward **navigation history** (`kSendTabToSelfPropagateNavigationHistory`, off by default), **multi-tab share** (`kSendTabToSelfMultiTabShare`, off).
- Entry-point states (`EntryPointDisplayReason`): offer feature / offer sign-in / offer re-auth / **inform no target device** ("the entry point should inform the user they can enjoy the feature by signing in on other devices"). A QR-code promo in the desktop bubble when no devices exist is behind `kSendTabToSelfNoTargetDeviceQrCode` (off).
- Flags worth noting for design (defaults as of this source): "Send to your device" in the **Omnibox context menu** (`kSendTabToSelfExtraEntryPoints`, ON); iOS **share sheet lists target devices as individual actions** (`kSendTabToSelfIOSShareSheetDeviceList`, off); iOS **tab reminders**, scheduled push notification, default offset 24 h (`kIOSTabReminders`, off); Android **physical double-tap gesture sends the tab** (`kSendTabToSelfGesture`, off); Android **dynamic shortcuts for other syncing devices** (Direct Share; `kSendTabToSelfDynamicShortcuts`, off); Android notification **opens the native app** if one exists (`kSendTabToSelfOpenNativeApp`, off); received tabs auto-open in the background even from the Tab Grid on mobile (`kSendTabToSelfSupportAutoOpenInTabGrid`, off).
- What I could not establish: which of these are live for stable users today. The `page_context.h` header is copyright 2026, so this is current work.
- Takeaway: Chrome's Send-tab sends a **URL (plus now position/form state)**, not the rendered page, not a PDF, no offline copy, no Reader library. That is the gap Lab fills. But Chrome is converging on the same ideas as our receipts, so do not claim receipts as a unique selling point.

**Reading Mode (a.k.a. Read Anything)** (accessibility_features.h/.cc)
- `kReadAnythingWithReadability` ON: "Enable ReadabilityJS as the distillation source for Reading Mode" (same Readability family as Firefox, Instapaper-style).
- ON: `kReadAnythingLineFocus` (line focus), `kReadAnythingOmniboxChip` (address-bar chip entry point).
- Off/experimental: Read Aloud phrase highlighting (`kReadAnythingReadAloudPhraseHighlighting`), improved Read Aloud (`kImprovedReadAloud`), translate entry point, improved UI, printing distilled content (`kImmersiveReadAnythingPrint`: "Immersive Reading Mode itself has launched and is not gated by a feature flag").

**chrome.readingList extension API** (reading_list.webidl)
- Methods: `addEntry({url,title,hasBeenRead})`, `removeEntry({url})`, `updateEntry({url,title?,hasBeenRead?})`, `query({url?,title?,hasBeenRead?})`; events `onEntryAdded`, `onEntryRemoved`, `onEntryUpdated`. An entry has `url, title, hasBeenRead, lastUpdateTime, creationTime`.
- Permission `readingList`: stable channel, extensions only, **Manifest V3 minimum**. Comment in the IDL: "read from and modify the items in the Reading List".
- Implication: our Chrome extension can mirror the user's Chrome Reading List (which syncs to Chrome on Android and iOS) into Daylight and flip `hasBeenRead` when the Reader finishes it. This is feasible today. [new candidate N2]

**chrome.pageCapture.saveAsMHTML(tabId)** returns the tab as an MHTML Blob. Useful as the "page as I saw it" snapshot route (works with logged-in pages, since it is the live tab).

### 2.2 Firefox (built-ins) [OPENED]
- **Send Tab is end-to-end encrypted** through Firefox Accounts: each device holds a key pair and auth secret in `device.sendTabKeys`; the public bundle is wrapped with the Sync "oldsync" key so the FxA server "can theoretically never retrieve the send tab keys"; payload encrypted with aes128gcm. The server sees an opaque `{ encrypted }`.
- Payload: `entries: [{title, url, private}]` plus an optional `current` index; the code warns "If you add any plaintext items to this payload, please carefully consider the privacy implications of revealing that data to the FxA server." URLs are treated as PII and only logged at trace level.
- Sender gets a per-device result: `{succeeded, failed}` with an error per failed device. Incompatible or unkeyed targets are recorded as failed rather than silently skipped.
- Receiver: classifies each command as `poll`, `push-missed` or `push`; rejects unsafe URI schemes (`INVALID_SHAREABLE_SCHEMES`); and **debounces**: "We debounce multiple incoming tabs so we show a single notification."
- Reader View (ReaderMode.sys.mjs): extraction runs in a worker; keeps some classes (`caption`, `sr-only`, `wp-caption`, `hidden`) so reader CSS can use them; computes **language and reading time as a range** (`readingTimeMinsSlow` / `readingTimeMinsFast`, per-language characters-per-minute); plain-text documents are wrapped into paragraphs; there is a node-count parse limit (`PARSE_ERROR_TOO_MANY_ELEMENTS`). No timeout in the module.
- Narrate (read-aloud in Reader View): directory has Narrator, NarrateControls, VoiceSelect (voice picker). Docs not opened.
- Firefox has no browser Reading List on desktop [KNOWLEDGE-UNVERIFIED, M]; Firefox for iOS has one [KNOWLEDGE-UNVERIFIED, M].

### 2.3 Apple built-ins (Safari Reading List and Reader, Books, News, Handoff, Universal Clipboard)
Opened evidence is thin and comes from NetNewsWire's tracker:
- [OPENED] The iOS Reading List add path is the system API behind a permission prompt: NetNewsWire issue #3634 (tewe, 28 Jul 2022): "Whenever I use an item's share sheet to add it to the Safari Reading List, iOS asks if I want to allow NNW to do this." Maintainer vincode-io: "It isn't possible as far as I know" (to approve permanently). Closed "not planned". https://github.com/Ranchero-Software/NetNewsWire/issues/3634
- [OPENED] The same path can fail silently: NNW #4400 (pyrmont, 12 Nov 2024): "Since at least iOS 18, NetNewsWire on iOS stops being able to send RSS items to Safari's Reading List ... will not bring up the system prompt ... will instead fail silently ... If I force quit the app and then relaunch, it starts working normally." Maintainer could not reproduce on iOS 18.7 (16 Sep 2025); reporter moved to Tab Groups instead and closed it (17 Sep 2025). https://github.com/Ranchero-Software/NetNewsWire/issues/4400
- [OPENED] Reading List is how NNW users save a single article: #3664 (closed 26 Aug 2022), Brent Simmons: "For me it appears in the Share menu as Add to Reading List." https://github.com/Ranchero-Software/NetNewsWire/issues/3664
- [OPENED] NNW #2070 "Add keyboard shortcut for 'Add to Reading List'" is still open (6 comments, opened 13 May 2020).
- [OPENED] Reader View exists as a toolbar button in NNW iOS 7.1.2 ("a Reader View button switched to an SF Symbol", Jul 2026) and NNW's README says its special developer build has no Reader View "because of" unshareable API keys (inference: Reader View depends on a keyed, probably hosted, extraction service). https://github.com/Ranchero-Software/NetNewsWire
- Everything else on Apple built-ins is [KNOWLEDGE-UNVERIFIED]; see the baseline table in section 6 for the list with confidence levels.

### 2.4 Microsoft Edge (Collections, Drop, Immersive Reader)
**Not opened.** The Edge policy docs repo path I tried returned 404, and learn.microsoft.com does not resolve. All of this is [KNOWLEDGE-UNVERIFIED]:
- Immersive Reader (H): reading view with Read Aloud (neural voices, widely praised as the best free browser TTS), text size/spacing/themes, **Line Focus** (1/3/5 lines), grammar tools (syllables, parts of speech), picture dictionary, translation.
- Collections (M): sidebar collections that sync across Edge desktop and mobile; export to Word/Excel.
- Drop (M-L): sidebar chat-with-yourself for files and notes across Edge desktop and mobile, backed by OneDrive. I am not sure it still ships; verify.
- Edge mobile "Continue on PC" / send-to-device (M-L).

### 2.5 RSS clients

**Opened (real release dates, features and demand):**

| App | Platform / price (opened) | Latest release seen | What the notes/issues show |
|---|---|---|---|
| NetNewsWire | iOS + Mac, free, MIT open source (README) | iOS 7.2 (7221) 11 Oct 2026 (App Store submission 15 Oct); Mac 7.2 14 Oct 2026; Mac 7.2.1b1 pre-release 18 Oct | 7.2: unread-count display setting, column timeline layout, more sort options, feed discovery on pages, footnotes for Substack-style articles, honors `instapaper_ignore`. 7.1 (iOS 26 Jun 2026, Mac 25 Jun): Activity Log, Current Activity, Account Stats, "Dinosaurs" (feeds that have not published in N months), iCloud deletes done optimistically. Sync accounts seen: iCloud, Feedly, Inoreader, FreshRSS (Reader API). |
| Capy Reader | Android 11+, free, GPL-3.0, ~1.4k stars; Google Play, F-Droid, IzzyOnDroid, GitHub; sync Feedbin, FreshRSS, Miniflux + local | 2026.10.1213 on 19 Oct 2026 | **"E Ink paging, page keys, reduced motion"** (#2265); "E Ink immersive mode across articles" (#2283); mercury-parser 0.1.2; "mallet to flatten article HTML" (#2245); Media3 audio mini-player; inline video enclosures; client-certificate (mTLS) login. |
| Feeder | Android, free, local-only (README: "does NOT sync with usual remote backends"), ~3.1k stars | 2.24.0 on 10 Oct 2026 | Per-feed article **filtering rules** (2.24.0); on-device **local translation** (Bergamot, 2.21.0 / 2.23.0); TTS queue ("Reset TTS queue on article switch and resume same article only"); audio player for media attachments; max article download raised from 1 MB to 3 MB; export format re-importable. |
| FeedMe | Android, freemium (premium full-article translation; issue #115 "Adjustment of purchase strategy") | 4.12.4 on 17 Oct 2026 | "FeedMe Neo" mobilizer: "uses different technologies to capture full text and supports account login"; local AI models, "Embedded" AI on Android AICore with no model download (4.12.4); starred export to CSV/JSON/Markdown; two-way layout sync with Folo; Karakeep sharing fix; pull-up to mark as read. |
| Read You | Android (Compose), free, GPL-3.0, ~7.6k stars | not gathered | README features: "Read aloud", "Android widget", "Article readability optimization", "Full content parse for original articles", multi-account, OPML; sync via Fever, Google Reader API, FreshRSS, Miniflux, TTRSS, Inoreader, Feedly, Feedbin. |

**Not opened [KNOWLEDGE-UNVERIFIED]:** Feedly (web + iOS + Android, free tier then paid; Leo AI; boards; M), Inoreader (web + iOS + Android; rules, filters, Active Search, newsletters, saved pages, highlights; M), Reeder new (iOS/Mac/iPad by Silvio Rizzi; one unified timeline of feeds, podcasts, social, video; M), Unread (Golden Hill; iOS/Mac; M), Fiery Feeds (iOS/Mac; very customisable; M), Lire (iOS/Mac; L). I cannot give dates, ratings or prices for these.

**User demand signals from the trackers [OPENED]** (these are the best "what people want from a reader app" data I have):
- NetNewsWire open issues by thumbs-up: lead-image thumbnails in the list #1551 (**50**), regex filters #1864 (32), proxy support #478 (20), tt-rss #388 (18), Nextcloud News #2247 (17), **"Can we add 'Read Later' smart feed?" #3023 (16)**, content-based filtering #4406 (12), **iOS "Cache images for off-line reading" #1873 (12)**, local AI summary #4665 (10), Media RSS #4132 (9).
- #1873 (open since Mar 2020; commits "Add offline article-image caching behind a setting" linked 2 Jul and 14 Jul 2026): vangeliis: "We don't have wifi in the tunnels so having everything cached on the phone makes it so much easier." bricep: "image caching is a must-have" for subway and flight commutes.
- #3023 Read Later (opened 19 Apr 2021): @thefranke: read-later RSS feeds "cannot delete articles with that workflow from it again" and Pocket's feed lacked full content; he switched to Wallabag "because it provides full article content in its RSS stream". @kevinm6 just stars articles because "since I use iCloud, it syncs between all my devices."
- #4665 local summary: Brent Simmons, 12 Nov 2025: "By design, NetNewsWire stays very far away from algorithms and from AI. (And from money!)"; a requester (totalsoda, 28 Jun 2026) frames it as "low-friction, local, privacy-preserving", "no accounts, no API keys".
- #1551 thumbnails: top-voted open request; commenter Nevarro (8 Jul 2026): the missing feature "is keeping them from switching from News Explorer"; Brent (8 Jul 2026) says he will likely build it himself.
- Capy Reader #568 read-it-later integration: closed "not planned" 1 Jun 2025; maintainer: "now that Pocket is gone", only Wallabag or Readeck would be possible; he is building a separate Readeck client ("Buoy"). #1298 TTS via the system engine: closed "not planned" 28 Mar 2026; request quoted from discussion #1137: "But Feeder has an option to read an article aloud using the phones built-in TTS engine ... I would love to have the best of both worlds with Capy."
- Read You #144 "Swipe left and right to switch articles" (since Jul 2022): "This is the one feature I miss from inoreader." (BundleOfJoysticks); maintainer: "swiping left and right to switch between articles seems quite weird as a primary action" (accidental triggers while scrolling). Also top requests: Nextcloud News API (#8), built-in podcast/YouTube player (#297), detect RSS from a site URL (#626).
- Feeder top requests: FreshRSS sync #866, sub-folders/tags #475/#409, image zoom #391/#1004, load all images with the article for offline #438, automatic OPML backup #931.

### 2.6 Obsidian mobile capture (and Notion) [Obsidian OPENED, Notion KNOWLEDGE]
Obsidian docs, verbatim from the repo (Obsidian 1.13+/1.14+ and iOS 18+/26+):
- **Share Sheet with "Locations"** (needs Obsidian 1.13.0+, iOS/iPadOS 18+): tap Share, pick Obsidian, **choose a Location**, review/edit the captured content, Save. A Location is a user-defined preset: vault + behaviour (New note in a folder / Daily note append-or-prepend / Bookmarked note / existing Note / New bookmark) + optional template + bookmark group + "Whether shared links capture **Full Text** or only the **URL**". Docs suggest "saving articles to an inbox, appending quotes to your daily note, or adding links to bookmarks". Works "with apps like YouTube and other social networks".
- Share templates have placeholders `{{title}} {{author}} {{description}} {{domain}} {{favicon}} {{image}} {{published}} {{site}} {{url}} {{wordCount}}` plus date/time.
- **Quick Capture** (Obsidian 1.14+, iOS 26+): Lock Screen, Control Center and Home Screen widgets, and Shortcuts, save text "without waiting for your vault to load"; capture locations; "If Live Activities are enabled, the quick capture note also appears on the Lock Screen and, on supported iPhone models, in the Dynamic Island."
- Shortcuts actions: Quick Capture, Open Bookmark, Open New Note, Open Daily Note, **Capture to Daily Note** and **Capture to Bookmark** ("without opening the Obsidian app"), Get Bookmarked Note, Get Daily Note, Search Vault, **Bookmark Link**, Open Obsidian. Siri: "Capture using Obsidian", "Capture to Obsidian". Spotlight quick actions: New Note, Search, Daily Note.
- Android: widgets (Open Note, New Note, Search, Daily Note, Open Obsidian) which "are static, and do not show any previews"; **Quick Settings tiles** (Android 7+; only one of each type); app shortcuts (Open note, Daily note; "not configurable" in 1.11). No Android share-target documentation in these pages (not claimed either way).
- Notion mobile capture [KNOWLEDGE-UNVERIFIED, M]: iOS/Android share extension ("Add to Notion"), widgets, Action Button, web clipper in Chrome/Safari; saves a page into a chosen database. I did not open anything.

### 2.7 Substack, Medium, Libby/OverDrive, Notion [all KNOWLEDGE-UNVERIFIED]
- Substack app (M): offline saved posts, "Listen" audio on posts, share. NNW 7.2 added "footnote support for Substack-style articles" [OPENED], which shows Substack article markup is a known parsing edge case.
- Medium app (M): lists, offline reading of lists, "Listen to this story", friend links to bypass the member paywall (relevant to paywall handling: a shared friend link works without login).
- Libby/OverDrive (M-H): US libraries only for "Read with Kindle" (borrow in Libby, delivered by Amazon to a Kindle). Libby installs as an Android app (the sibling DC-1 note says the DC-1 has Google Play and sideloading) so a DC-1 can run Libby directly; library books are DRM-bound, so Send to Daylight should not try to carry them.

### 2.8 Listen-first apps [KNOWLEDGE-UNVERIFIED unless tagged]
- Omnivore [OPENED]: README: "Omnivore is now a completely Self-Hosted application. The Cloud application was deprecated in November of 2024." Listed feature "Text to speech (iOS only)". The README does not mention ElevenLabs; the ElevenLabs acquisition/ElevenReader link is from memory (M).
- ElevenReader (ElevenLabs; iOS/Android; M): imports PDFs, EPUBs, articles/URLs; AI voices; free tier. Speechify (iOS/Android/Mac/Chrome/web; M): subscription; celebrity voices; page reading in the browser; scanning; widely criticised for upsell [L]. Voice Dream Reader (iOS/Android/Mac; M): accessibility favourite, many voices, Bookshare, document formats. NaturalReader (web/Chrome/mobile; M): free tier plus paid, OCR. None of these were opened.
- Open-source RSS apps show how much "listen" people want: Feeder ships TTS with queue handling; Read You lists "Read aloud"; Capy Reader's TTS request was declined but a fork implemented it (comment by mjhfunctionalashtanga, 7 Jul 2026: "I implemented TTS in a fork.") [OPENED].

---------------------------------------------------------------------------
## 3. Per-platform scorecards (PROVISIONAL)

How to read these: Rank is my judgement of "best for seamless cross-device reading/saving", weighted toward fit with Send to Daylight. **Rating column = NOT GATHERED unless a sibling relayed a number** (tagged). "Praised" lists what the opened sources/trackers or sibling notes support; items from memory are tagged. I could not read a single reviewer, so none of the "praised" items are reviewer quotes. Confidence: H/M/L for the rank.

### 3.1 iPhone
| # | Product | Store rating / count | Last release | Price | Praised features (with evidence tag) | Rank confidence |
|---|---|---|---|---|---|---|
| 1 | Readwise Reader | 4.6 / 532 reviews [SIB-RELAYED from a 2026 3P review, https://www.asianefficiency.com/productivity/readwise-reader-review/] | not gathered | No free tier; Full plan about $9.99/mo billed annually or $12.99 monthly [SIB-RELAYED] | Share sheet capture that can use the Safari page content; highlights that export (Obsidian etc.); feed + newsletter + PDF in one library; MacStories' Viticci "all-in" on it [SIB-RELAYED] | M |
| 2 | GoodLinks | NOT GATHERED | not gathered | $9.99 one-time plus optional $4.99 annual feature upgrade [SIB-RELAYED] | Share sheet with Quick Save, iCloud sync, Shortcuts/URL scheme [SIB-RELAYED]; Apple-only | M-L |
| 3 | NetNewsWire | NOT GATHERED | iOS 7.2 (7221), 11 Oct 2026 [OPENED] | Free, open source [OPENED] | Reading List add from the share menu [OPENED]; iCloud/Feedly/Inoreader/FreshRSS accounts [OPENED]; fast, no AI, no money (maintainer quote above) [OPENED]. Weaknesses users list: no read-later smart feed (16 thumbs), image cache for offline still open (12) [OPENED] | M |
| also | Reeder (new), Unread, Fiery Feeds, Instapaper, Matter, Safari Reading List (built-in) | NOT GATHERED | not gathered | not gathered | Widely discussed on MacStories-type sites [KNOWLEDGE-UNVERIFIED, M]. **Reeder in particular might belong in the top 3; I had no data to place it.** | L |

### 3.2 Android phone
| # | Product | Store rating / count | Last release | Price | Praised features | Rank confidence |
|---|---|---|---|---|---|---|
| 1 | Readwise Reader (Android) | NOT GATHERED | not gathered | as above | Same library as iPhone; cross-device is the point [SIB-RELAYED] | L-M |
| 2 | Instapaper (Android) | 4.6 / about 12.8k ratings [SIB-RELAYED, chrome-stats/APKMirror aggregate] | not gathered | Free; Premium about $7.99/mo or $59.99-$79.99/yr (conflicting) [SIB-RELAYED]; Kindle sends Premium-only since 19 Feb 2026 per press [SIB-RELAYED, unresolved] | Offline reliability, ecosystem [SIB-RELAYED]; complaints: slow sync, PDF sync gaps [SIB-RELAYED] | M |
| 3 | Capy Reader | NOT GATHERED | 2026.10.1213, 19 Oct 2026 [OPENED] | Free, GPL-3.0 [OPENED] | **E Ink paging, page keys, reduced motion, E Ink immersive mode** [OPENED]; syncs Feedbin/FreshRSS/Miniflux [OPENED]; best match to the DC-1 of anything I opened | M for the DC-1, L overall |
| also | Feeder (offline, TTS, local translation, filters; 2.24.0, 10 Oct 2026 [OPENED]); Read You (~7.6k stars, widest sync support [OPENED]); FeedMe (4.12.4, 17 Oct 2026, local AI, login-capable full text [OPENED]); Inoreader, Feedly [KNOWLEDGE-UNVERIFIED]; Karakeep/Wallabag apps [SIB-RELAYED] | NOT GATHERED | see left | free / freemium | see section 2.5 | M |

### 3.3 Browser extension (Chrome / Edge / Firefox)
| # | Product | Store rating / count | Last release | Price | Praised features | Rank confidence |
|---|---|---|---|---|---|---|
| 1 | Obsidian Web Clipper (Chrome, Firefox, Edge, Safari) | NOT GATHERED | not gathered | Free | Templates with variables, highlighter, reader/interpreter modes [SIB-RELAYED; sibling opened the GitHub docs] | M |
| 2 | Raindrop.io | about 4.1-4.2 / about 787 ratings, 400-500k users [SIB-RELAYED, Chrome Web Store] | not gathered | Free; Pro about $28/yr [SIB-RELAYED] | Collections + tags + AI suggestions, "Unsorted" as inbox [SIB-RELAYED]; complaints: slow popup, "buggy" [SIB-RELAYED] | M |
| 3 | Readwise Highlighter / Reader extension | about 4.2 / about 60 reviews on Chrome; Firefox about 4.4 from 16 ratings [SIB-RELAYED, tracker numbers] | not gathered | with Readwise | Save + highlight on the live web; AMO reviews complained about login and data collection [SIB-RELAYED] | L |
| built-in | **Chrome "Send to your devices" + Reading List** | n/a | Source current as of Oct 2026 [OPENED] | Free (needs Chrome sign-in/sync) | Per-device targets, notifications, opened/activated timestamps back to sender, and now scroll position + form state [OPENED] | H (as baseline) |
| built-in | Firefox Send Tab | n/a | Source head [OPENED] | Free (Firefox Account) | E2E encrypted, per-device success/fail report, single debounced notification [OPENED] | H (as baseline) |
| built-in | Edge Collections / Drop / Immersive Reader | n/a | not gathered | Free | Immersive Reader Read Aloud and Line Focus [KNOWLEDGE-UNVERIFIED, H] | L (not opened) |

### 3.4 Mac app
| # | Product | Store rating / count | Last release | Price | Praised features | Rank confidence |
|---|---|---|---|---|---|---|
| 1 | GoodLinks | NOT GATHERED | not gathered | $9.99 one-time + optional annual upgrade [SIB-RELAYED] | Native Mac app + Share menu + Safari/Chrome extension, Cmd+Shift+S, iCloud sync [SIB-RELAYED] | M-L |
| 2 | NetNewsWire (Mac) | NOT GATHERED | Mac 7.2 on 14 Oct 2026; 7.2.1b1 18 Oct [OPENED] | Free, open source [OPENED] | Column timeline layout, sort options, Activity Log / Account Stats [OPENED]; open issue for a keyboard shortcut to Reader View and Share (#3489, 16) [OPENED] | M |
| 3 | Reeder (new) or Raindrop's Mac app | NOT GATHERED | not gathered | not gathered | Not verified [KNOWLEDGE-UNVERIFIED, L] | L |
| built-in | Safari Reading List + Reader, Apple Books | n/a | n/a | Free | See baseline table | H (as baseline) |

### 3.5 Cross-device handoff
| # | Product | Store rating | Last release | Price | Praised features | Rank confidence |
|---|---|---|---|---|---|---|
| 1 | Apple Continuity (AirDrop, Handoff, Universal Clipboard) | n/a | with iOS/macOS 26 | Free, Apple-only | Zero-setup, proximity-based [KNOWLEDGE-UNVERIFIED, H]. Cannot reach an Android tablet. | H |
| 2 | Chrome Send tab + Google Quick Share | n/a | Chrome source Oct 2026 [OPENED]; Quick Share not opened | Free | Send tab: see 3.3. Quick Share: Android/Chromebook/Windows, and Pixel 10 interop with AirDrop announced Nov 2025 [KNOWLEDGE-UNVERIFIED, M] | M |
| 3 | LocalSend (open source, LAN, no account) | n/a | not gathered | Free | Top-voted wants in sibling notes (e.g. 39 reactions on LocalSend #384) [SIB-RELAYED]; Firefox Send Tab is the best **E2E** precedent for our relay [OPENED] | M |

Net read for the build: no product is "seamless to an Android e-ink tablet". Apple's stack stops at Apple devices; Chrome sends a URL; Quick Share sends files. Lab's differentiator is: rendered page or PDF + E2E + receipts + Reader library, from any of the six senders.

---------------------------------------------------------------------------
## 4. NEW feature candidates (not in the ten feature lists)

Checked against: browser-clippers 1-23, community-voice 1-25, cross-device ideas, highlights-roundtrip 1-17, mobile-share-patterns 1-20, newsletters F-* list, readwise-reader 1-17, send-to-kindle 1-20. Effort scale: XS under a day, S 1-3 days, M 1-2 weeks, L over 2 weeks. "Value" is my guess.

| ID | Candidate | Source (URL) | Needs | Effort | Value |
|---|---|---|---|---|---|
| N1 | **Send from where I stopped**: capture the first visible text as a Text Fragment (text_start/end, prefix, suffix) at send time; Reader opens the article scrolled to it ("you were here"). Different from existing "reading-position sync", which is progress inside the Reader. | https://raw.githubusercontent.com/chromium/chromium/main/components/send_tab_to_self/page_context.h and .../components/sync/protocol/send_tab_to_self_specifics.proto | companion+inbox (+reader-change) | Sender S, Reader M | high |
| N2 | **Chrome Reading List bridge**: `chrome.readingList` `onEntryAdded` (and unread `query`) auto-queues into Daylight; on delivery or finish call `updateEntry({hasBeenRead:true})`. Items saved from Chrome on a phone (via Chrome's own Reading List sync) arrive on the DC-1 with no share step. | https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/extensions/api/reading_list.webidl ; .../_permission_features.json (MV3, stable) | companion-only (+inbox for the finished flip) | S-M | high |
| N3 | **Safari Reading List import (Mac, one-way, opt-in)**: one-time or watched import of unread Reading List URLs to the send queue. Dual-writing to Reading List from an iOS app is a poor idea: the system asks permission each time and can fail silently. Reading it on Mac relies on the Safari bookmarks file and Full Disk Access [KNOWLEDGE-UNVERIFIED, M]. | https://github.com/Ranchero-Software/NetNewsWire/issues/3634 ; /issues/4400 | companion-only (Mac) | M (risky) | medium |
| N4 | **Private-window guard + "private" flag**: ask before sending a page from a private/incognito window; mark the item `private` so the Inbox keeps it out of recents/history and expires it. | https://raw.githubusercontent.com/mozilla-firefox/firefox/main/services/fxaccounts/FxAccountsCommands.sys.mjs (payload entries carry `private`; unsafe schemes filtered) | companion+inbox | S | medium |
| N5 | **Keyless on-device summary at send time (Apple Foundation Models)**: iPhone/Mac with Apple Intelligence write a 2-3 line abstract that rides inside the encrypted envelope; Inbox row shows it. No Claude key, no server, E2E intact. Falls back to none. Complements the planned Claude path rather than replacing it. FoundationModels framework itself is [KNOWLEDGE-UNVERIFIED, M]. | https://github.com/Ranchero-Software/NetNewsWire/issues/4665 (demand: "no accounts, no API keys") | companion-only | M | medium |
| N6 | **Listen mode in the Reader**: system-TTS read-aloud with sentence/phrase highlight, queue that resumes the same article, voice picker. Chrome is shipping phrase highlighting; Feeder and Read You have TTS; Capy Reader users asked and were declined. | https://raw.githubusercontent.com/chromium/chromium/main/ui/accessibility/accessibility_features.h ; https://github.com/spacecowboy/Feeder/releases ; https://github.com/jocmp/capyreader/issues/1298 | reader-change | M | medium |
| N7 | **Audio edition** (Worker + a TTS provider key, not Claude): article becomes an MP3 delivered to the phone or DC-1; this is the Speechify / ElevenReader / NaturalReader pattern. | Omnivore README (TTS iOS-only, cloud closed Nov 2024): https://github.com/omnivore-app/omnivore ; product pages not opened | server (+TTS key) | L | low-medium |
| N8 | **Feed mute filters**: per-feed keyword and regex rules (title/body/link) applied before an item is delivered. Top NNW request cluster. | https://github.com/Ranchero-Software/NetNewsWire/issues?q=is%3Aissue+is%3Aopen+sort%3Areactions-%2B1-desc (regex filters #1864, 32 thumbs; content filtering #4406, 12) ; https://github.com/spacecowboy/Feeder/releases (2.24.0 per-feed filtering rules) | server or companion+inbox (where feeds are fetched) | S-M | medium |
| N9 | **Lead-image thumbnail and read-time range in the Inbox row** (and in the pre-send preview). Read time as "8-11 min" from slow/fast rates, per language. | https://github.com/Ranchero-Software/NetNewsWire/issues/1551 (50 thumbs, top open request) ; ReaderMode.sys.mjs (`readingTimeMinsSlow/Fast`) | companion+inbox (+reader-change) | S-M | medium |
| N10 | **Activity Log + Account Stats + "stale pairing" screen** in each companion: last 100 events (pair, send, retry, relay status, ack), counts, queue size, "Dinosaurs"-style list of paired devices not seen for N days, copy-redacted-diagnostics button. | https://github.com/Ranchero-Software/NetNewsWire/releases?page=4 (7.1: Activity Log, Current Activity, Account Stats, Dinosaurs) | companion-only (+inbox last-seen) | S | medium |
| N11 | **Honor publisher hints in extraction**: drop elements with `instapaper_ignore`, keep `sr-only`/captions per Firefox's class list; document the policy. | https://github.com/Ranchero-Software/NetNewsWire/releases (7.2: "instapaper_ignore") ; ReaderMode.sys.mjs `CLASSES_TO_PRESERVE` | companion-only | XS | low-medium |
| N12 | **Translate on send / local translate**: detect language (Firefox does it in Reader mode), offer "translate before delivery" via Claude on the Worker, or on-device translation in the Inbox. Feeder ships Bergamot local translation; FeedMe sells full-article translation; Chrome has a translate entry point in Reading Mode. | https://github.com/spacecowboy/Feeder/releases ; https://github.com/seazon/FeedMe/releases ; accessibility_features.h | server (Claude) or reader-change | M | medium |
| N13 | **Line Focus (reading ruler)** in the Reader: dim all but 1/3/5 lines; optionally driven by the pen. Chrome Reading Mode ships "line focus" ON by default; Edge Immersive Reader popularised it [KNOWLEDGE-UNVERIFIED, H]. | https://raw.githubusercontent.com/chromium/chromium/main/ui/accessibility/accessibility_features.cc | reader-change | M | low-medium |
| N14 | **Back-tap / double-tap trigger**: Android double-tap-back gesture (Chrome is building exactly this for send-tab) and iOS Back Tap to run the "Send current page" Shortcut. | https://raw.githubusercontent.com/chromium/chromium/main/components/send_tab_to_self/features.h (`kSendTabToSelfGesture`) | companion-only | S | low |
| N15 | **Omnibox keyword** in the Chrome extension (`dl <url or text>`), plus an "Send to Daylight" entry in the omnibox context. Chrome added "Send to your device" to the omnibox context menu (enabled by default). | features.h (`kSendTabToSelfExtraEntryPoints`) | companion-only | XS | low-medium |

Considered and not added because they are in the lists or are close variants of listed items (this file only validates or sharpens them): receipts with opened/activated stages (Chrome writes `received/opened/activated` times back to the sender); coalesced "N items arrived" notification (Firefox debounces); send-later reminders (Chrome iOS tab reminders, 24 h default); devices as individual share-sheet actions and Android dynamic shortcuts (Chrome flags); no-target-device empty state with QR (Chrome); multi-tab bundle (Chrome multi-tab share); E-ink paging, page keys, reduced motion (Capy Reader 2026.10.1213); Obsidian-style share "Locations" (partly the pre-send panel and per-site rules); Quick Capture widgets, Control Center, Lock Screen, Live Activity, Siri and Spotlight (Obsidian) — these validate the mobile-share list items 6-9, 13-14; export-everything with re-import (Feeder, FeedMe starred export); login-capable full-text capture (FeedMe Neo) validates "send rendered DOM"; read-later RSS pile-up (NNW #3023) validates the ledger/no-repeats feature.

Refinement worth keeping from Obsidian: let each share-sheet **preset** decide Full Text vs URL-only and a template, with one default so the common case is one tap.

---------------------------------------------------------------------------
## 5. Top frustrations seen in the opened trackers

1. Reading-list add fails silently or nags with a permission prompt every time: NNW #4400 (silent after iOS 18, fixed only by force-quit) and #3634 ("It isn't possible as far as I know" to approve permanently).
2. Commutes and flights: images and articles not cached offline. NNW #1873 (12 thumbs, open since Mar 2020): "We don't have wifi in the tunnels"; Feeder #438 "Load all images of a feed along with the article to improve offline experience".
3. Read-later via RSS piles up and cannot be cleared, and the feed is partial: NNW #3023 (@thefranke).
4. After Pocket, no integrations: Capy Reader #568 "now that Pocket is gone", closed not planned.
5. Accidental gestures: Read You maintainer on swipe-to-switch (#144) fears triggering while scrolling; users on large phones want it anyway.
6. Maintainers declining AI or TTS on principle while users keep asking: NNW #4665 ("stays very far away from algorithms and from AI"), Capy Reader #1298 (closed not planned; a fork added TTS).
7. Sync reliability complaints dominate FeedMe's and NNW's lists: NNW #4476 "Stars don't seem to sync with Inoreader or between devices" (closed Aug 2026); FeedMe #20 "4.4.x can't sync issue" has the longest thread in its tracker (trailing count 75, probably comments).
8. Chrome Send-tab sends only a URL (until position/form context ships): inferred from the proto history (page_context first appears in M147, 2026). [inference, not a user quote]
9. Wrong-tool extraction: Reader View needs hosted API keys even in NNW's own builds; Firefox's node-count limit and Chrome's switch to ReadabilityJS show extraction quality is still being changed in 2026 [OPENED, inference].

---------------------------------------------------------------------------
## 6. Baseline: what the built-in platform already does for free (do not clone badly)

"Free" = no install. Evidence tags per cell. The right-hand column is what Lab should do instead of re-implementing it.

| Platform feature | What it already does | Evidence | Gap Lab should fill / do not clone |
|---|---|---|---|
| Safari Reading List (iPhone, iPad, Mac) | Add from share sheet or Safari; iCloud sync across Apple devices; unread/all list; swipe to mark read/delete; optional automatic offline save; Reader View (with Apple Intelligence summary/outline on supported devices) | Share-sheet add and permission prompt [OPENED, NNW #3634]; the rest [KNOWLEDGE-UNVERIFIED, M-H] | No tags, folders, highlights, export, or non-Apple devices. Do not build a "Reading List sync" inside Daylight; offer Mac import only (N3). Never rely on dual-write: prompt and silent failure. |
| Safari Reader | Strips page chrome; font/theme; summary (Apple Intelligence) | [KNOWLEDGE-UNVERIFIED, M] | Send the Safari page content, not just the URL, so Reader View and paywalled pages match what the user saw |
| Apple Books | Syncs PDFs and EPUBs across Apple devices through iCloud; share-sheet "Books" action for PDFs; progress, notes, highlights sync | [KNOWLEDGE-UNVERIFIED, H] | Apple devices only; no web-page clips. Do not compete for book files; compete for articles and PDFs bound for the DC-1 |
| Apple News / News+ | Saved stories sync; News+ downloads for offline | [KNOWLEDGE-UNVERIFIED, M] | Apple News share links resolve poorly outside the app; intake normaliser (existing list) must unwrap them |
| Handoff / Universal Clipboard | Continue a Safari page or document on a nearby Apple device; paste what you copied on another device for a short window | `NSUserActivity` details were not rendered; [KNOWLEDGE-UNVERIFIED, H] | Apple-only, proximity-only, no Android. Do not pretend to be Handoff; an Android tablet is where Daylight wins |
| AirDrop (incl. iOS 26.2 "AirDrop codes", unverified) / macOS 26 Spotlight actions via App Intents | Fast file and link transfer between Apple devices; App Intents surface as Spotlight actions and in Control Center | [KNOWLEDGE-UNVERIFIED, M-L] | Expose Send to Daylight as an App Intent so it appears in Spotlight, Shortcuts, Siri and Control Center (matches Obsidian's integrations [OPENED]) |
| Chrome Reading List | Add/read later across Chrome desktop, Android, iOS with sync; mark read | API shape [OPENED]; UI details [KNOWLEDGE-UNVERIFIED, M] | Bridge it (N2); do not build a rival list inside the extension |
| Chrome Reading Mode | Side-panel reader using Readability, line focus, Read Aloud, omnibox chip | [OPENED] flags | Do not clone distillation UI in the extension; reuse the existing capture modes. Reader on the DC-1 owns reading chrome |
| Chrome "Send to your devices" | URL (+ title) to another signed-in Chrome; notification; opened/activated sync; soon scroll position and form state | [OPENED] | URL only, opens in a browser, no snapshot, no PDF, no E2E claim, needs Chrome on the target. Our edge: rendered page or file, E2E, receipts, library |
| Quick Share | Files and links between Android, Chromebook, Windows; Pixel 10 AirDrop interop | [KNOWLEDGE-UNVERIFIED, M] | **Check on the Rooted 2 tablet whether Quick Share already receives files**; if Google Play Services is present it might. If so, the Inbox should not fight it, just watch the Downloads folder as another intake |
| Google Play Books upload | Upload PDF/EPUB; syncs position across Android, iOS, web | [KNOWLEDGE-UNVERIFIED, M]; limits (recall: about 1,000 files, about 100 MB each) are L confidence | Do not duplicate book syncing |
| Edge Collections, Drop, Immersive Reader | Sidebar collections; files/notes across Edge devices; reading view with strong Read Aloud and Line Focus | [KNOWLEDGE-UNVERIFIED, M-H] | Edge users get Collections free; our Edge story is "Chrome extension works in Edge". Immersive Reader is the benchmark for N6 and N13 |
| Firefox Reader View + Narrate | Readability-based reader with read-aloud and voice selection; reading-time and language detection | [OPENED] files | Read-time ranges (N9) |
| Firefox Send Tab | E2E tab send between Firefox devices, per-device failure report, debounced notification | [OPENED] | I could not confirm any WebExtension API for Send Tab, and the repo's extension targets Chrome and Safari only, so Firefox users would need the web sender unless a Firefox build is added [inference] |
| Substack / Medium apps | Offline saved posts, listen, friend-link sharing | [KNOWLEDGE-UNVERIFIED, M] | Intake normaliser: unwrap `open.substack.com` and Medium friend links; keep the original canonical URL |
| Libby / OverDrive | Library loans; US "Read with Kindle" | [KNOWLEDGE-UNVERIFIED, M] | DRM; do not carry library books. Just run Libby on the DC-1 |
| Obsidian / Notion capture | Share sheet to a note; widgets; Shortcuts; Quick Capture | Obsidian [OPENED]; Notion [KNOWLEDGE-UNVERIFIED, M] | Offer "also save to Obsidian" as a destination (Obsidian URI / share) rather than reimplementing note capture |
| RSS apps (NNW etc.) | Feed reading; many have a Reading-List add and OPML | [OPENED] | Accept share from them; do not become an RSS reader. Feeds in Lab stay "delivered issues" |

---------------------------------------------------------------------------
## 7. Notes on product status (for the structured summary)
- Pocket closed 2025 and Omnivore's cloud deprecated Nov 2024 [OPENED for Omnivore README]; both skipped as instructed.
- NetNewsWire, Capy Reader, Feeder, FeedMe all shipped in the last 10 days of this run's date [OPENED], so these are live, maintained options.
- Chrome send-tab context fields (M147-M151) are in trunk; stable rollout unknown.
- Edge Drop status unknown (L).
- Voice Dream, Speechify, NaturalReader, ElevenReader, Reeder, Unread, Fiery Feeds, Lire, Feedly, Inoreader, Substack, Medium, Libby: status not verified this run.

---------------------------------------------------------------------------
## 8. Gaps (nothing below was checked)
- Every store rating and rating count; every "last release" for closed-source apps; every price for closed-source apps except those relayed.
- Reviewer sites (MacStories, 9to5Mac, Android Police, The Verge, Wirecutter) and YouTube roundups: 0 read.
- Reddit, Hacker News, MobileRead: 0 read.
- Apple support/release-note pages for iOS 26 / macOS 26 (Safari Reading List and Reader changes, Handoff, Universal Clipboard, AirDrop codes, Spotlight actions).
- Edge Collections / Drop / Immersive Reader docs; Firefox Reader View and Narrate docs; Google Quick Share and Play Books help pages.
- Notion mobile capture docs; Substack and Medium help pages; Libby help.
- Whether `chrome.readingList` works in Edge, and Safari Web Extension equivalents (not checked).
- Whether Quick Share receives files on the DC-1 (a device test, not a search).

---------------------------------------------------------------------------
## 9. Ready-to-run query pack (about 35 standard searches, once the budget resets)

Use `allowed_domains` on every query. Suggested sets: PRESS = macstories.net, 9to5mac.com, 9to5google.com, androidpolice.com, theverge.com, nytimes.com/wirecutter (wirecutter), appleinsider.com, macrumors.com, howtogeek.com, lifehacker.com; STORES = apps.apple.com, play.google.com, chromewebstore.google.com, addons.mozilla.org (only if hosts get allowed; otherwise rely on snippets); COMMUNITY = redlib mirrors seen in earlier results, news.ycombinator.com, forums.macrumors.com, mobileread.com; VIDEO = youtube.com.

Apple (6)
1. PRESS: "Safari Reading List iOS 26 offline sync Reader summary"
2. PRESS: "macOS Tahoe 26 Safari Reading List Reader changes"
3. PRESS: "Apple Books PDF iCloud sync share sheet iOS 26"
4. PRESS: "iOS 26 Handoff Universal Clipboard changes" and "AirDrop codes iOS 26.2"
5. PRESS: "macOS Tahoe Spotlight actions App Intents quick keys"
6. PRESS: "Apple News saved stories offline News+ iOS 26"

Google / Microsoft / Firefox (6)
7. PRESS: "Chrome Reading Mode Read Aloud Android desktop 2026"
8. PRESS: "Chrome send tab to your devices scroll position form fields"
9. PRESS: "Quick Share AirDrop Pixel 10 interoperability expansion 2026"
10. PRESS: "Google Play Books upload PDF EPUB limit"
11. PRESS: "Edge Drop Collections Immersive Reader 2026 retired OR removed"
12. PRESS: "Firefox Reader View Narrate read aloud 2026" and "Firefox Send Tab"

RSS and read-later (9)
13. PRESS: "best RSS reader iPhone 2026" (MacStories, 9to5Mac, Verge)
14. PRESS: "best RSS reader Mac 2026"
15. PRESS: "best RSS reader Android 2026" (Android Police, 9to5Google)
16. PRESS: "Reeder new review iOS Mac" and "Unread RSS reader review"
17. PRESS: "Fiery Feeds review" and "Lire RSS reader review"
18. PRESS: "Feedly vs Inoreader 2026 review"
19. COMMUNITY: "NetNewsWire vs Reeder" ; "Inoreader vs Feedly" threads
20. PRESS + VIDEO: "best read it later app 2026 after Pocket" (Verge, Wirecutter, YouTube roundups)
21. VIDEO: "best Chrome extensions for reading and saving articles 2026"

Capture, library, listen-first (8)
22. PRESS: "Substack app offline listen save for later 2026"
23. PRESS: "Medium app offline lists listen friend link"
24. PRESS: "Libby send to Kindle 2026 still works" 
25. PRESS: "Notion mobile capture share extension widget Action Button"
26. PRESS: "Obsidian mobile share sheet Quick Capture 2026"
27. PRESS + COMMUNITY: "Speechify review 2026" and "Speechify alternative"
28. PRESS + COMMUNITY: "Voice Dream Reader review 2026" ; "NaturalReader review"
29. PRESS: "ElevenReader review Omnivore ElevenLabs"

Ratings and reviews (6, only if STORES hosts open)
30-35. One query per scorecard platform for the top-3 products' store pages: iPhone (Readwise Reader, GoodLinks, NetNewsWire), Android (Instapaper, Capy Reader, Feeder), Chrome extension (Obsidian Web Clipper, Raindrop, Readwise), Mac (GoodLinks, NetNewsWire, Reeder), plus "Quick Share" and "Send to your devices" help pages.

Coding sheet for the review pass: product, platform, stars, count, date seen, last release, price, three praised features with source URL, tag (OPENED / SNIPPET-ONLY).

END
