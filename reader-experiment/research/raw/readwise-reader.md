# Readwise Reader deep-dive (raw research notes)

Researcher angle: Readwise Reader (read-it-later + RSS + highlights + AI) as a model for the "Lab" feature set of Send to Daylight.
Date of research: 2026-10-20. Prefer-recency sources: 2024-2026.

## 0. Method and honesty notes (read first)

- Direct fetching was NOT possible in this environment. WebFetch failed with `getaddrinfo ENOTFOUND` for every host tried (docs.readwise.io, readwise.io, apps.apple.com, hn.algolia.com). A curl probe through the agent proxy returned `CONNECT tunnel failed, response 403` / no connection for docs.readwise.io, hn.algolia.com, readwise.io, apps.apple.com, play.google.com, chromewebstore.google.com, www.youtube.com, en.wikipedia.org, www.mobileread.com. I did not try to bypass the proxy.
- Therefore EVERYTHING below comes from WebSearch result summaries (the search tool returns a short synthesized answer plus URLs). Where I put text in quotation marks, it is wording the search tool presented as quoted from that source, not something I verified by opening the page. Treat quotes as "per search snippet".
- Reddit and HN: no thread bodies were fetchable. Search returned redlib mirror URLs (redlib.hbubli.cc, cal1.lr.ggtyler.dev) and HN item IDs/titles. Where I cite them I only use what the snippet said.
- "DOC" = Readwise official docs/changelog/App Store/Play listing (what the product does). "USER" = reviews, forums, blogs (what people say). "3P" = third-party comparison/affiliate pages (lowest trust, many are SEO/vendor pages).
- Some search-result dates looked odd (e.g. "Last updated 2026-07-06"); I report them as given.

## 1. Product snapshot

- Readwise Reader = read-it-later + RSS + newsletters + PDFs/EPUBs + YouTube/podcast transcripts + X/Twitter threads in one app, with web highlighting and an AI assistant ("Ghostreader"). Launched as Show HN Dec 2022 ("Show HN: Readwise Reader, an all-in-one reading app", https://news.ycombinator.com/item?id=34006202). Still labelled "Public Beta" in 2026; Update #13 (Dec 2025) said it is "getting ready to leave beta in the near future".
- Platforms (DOC, https://readwise.io/read, https://docs.readwise.io/reader/docs/faqs/eink): iOS (incl. iPad, visionOS listing), Android (package com.readermobile), web app, desktop apps for Mac and Windows, browser extensions for Chrome (and any Chromium: Brave, Edge, Arc), Firefox, Safari; plus an E-ink mode for Android e-ink devices "such as BOOX and Daylight Computer". One 3P review (nubiapage.com) disputed whether the "desktop apps" are native installers vs PWA; the Readwise FAQ (https://docs.readwise.io/reader/docs/faqs) says Mac/Windows desktop apps exist and the desktop app opens and works offline.
- Pricing (3P 2026 comparison pages, verify): Readwise Full (includes Reader) $9.99/mo billed annually (= $119.88/yr) or $12.99 monthly; Readwise Lite $5.59/mo annual does NOT include Reader; no free tier; 30-day trial; 50% student/academic discount ($4.99/mo), 50% discount for weaker-currency countries on request (founder comment on https://www.vendr.com/blog/do-you-use-readwise-app-how-much-are-you-paying-for-the-service). Sources: https://www.readless.app/blog/readwise-reader-pricing-2026, https://toolradar.com/tools/readwise/pricing, https://www.asianefficiency.com/productivity/readwise-reader-review/
- App Store rating cited by a 2026 review: 4.6 stars from 532 reviews (3P: https://www.asianefficiency.com/productivity/readwise-reader-review/). Justuseapp automated analysis of 546 reviews: 66.7% positive / 33.3% negative (low trust, https://justuseapp.com/en/app/1567599761/readwise-reader/reviews). Product Hunt (Readwise overall): 4.8 from 20 reviews (https://www.producthunt.com/products/readwise/reviews). Chrome "Readwise Highlighter" ~4.2/5 from ~60 reviews per tracker (https://chrome-stats.com/d/jjhefcfhmnkfeepcpnilbbkaadhngkbi); Firefox ~4.4 from 16 ratings (https://firefox-stats.com/d/readwise-highlighter/reviews).
- Market context: Pocket shut down (read-only July 8 2025; data deleted after the Nov 12 2025 export deadline) and Omnivore's hosted service shut down Nov 2024 (team joined ElevenLabs) - sources: https://www.mailist.app/blog/best-pocket-alternatives, https://docs.readwise.io/reader/docs/faqs/importing-content. This drove a wave of migration to Reader and also "lock-in/price sensitivity" worries.

## 2. Every way content gets IN (DOC unless noted)

2.1 Browser extension ("Readwise Highlighter" on Chrome/Firefox; "Save to Reader" on Mac App Store for Safari)
- DOC (https://docs.readwise.io/reader/docs/saving-content): click toolbar icon or press Alt+R (rebindable in extension options). Docs call the extension "the most robust way to save" because it captures the content rendered in your browser (logged-in/paywalled pages work), not just the URL.
- After saving, a bar appears with: tag menu, a document-note field ("why you saved it / who recommended it"), and a dropdown to move the doc to another section (e.g. straight to Archive if already read). Default destination = first section of the Library (Inbox or Later depending on config). Bar can be collapsed.
- Auto-highlighting ON by default: any text you select on the page becomes a highlight; can be turned off. Highlights sync to Readwise and optionally to Obsidian/Notion/Logseq (listing text, https://chromewebstore.google.com/detail/readwise-highlighter/jjhefcfhmnkfeepcpnilbbkaadhngkbi).
- Safari: "Save to Reader" Mac App Store app, free, Mac-only, macOS 10.14+, requires Readwise account, "developer does not collect any data" (https://apps.apple.com/app/save-to-reader/id1640236961). No ratings yet on listing.
- Firefox: addons.mozilla.org listing https://addons.mozilla.org/firefox/addon/readwise-highlighter/. Sept 2026 changelog: right-click saving restored in Firefox. Sept 25 2026 changelog: saving an already-saved page re-parses it and keeps the older version if the new parse is worse (https://docs.readwise.io/changelog).
- Warning in docs: a third-party Chrome extension that asks for an API token is not the official one.
- 3P unofficial helper: "Readwise Full Content" Firefox add-on by BYK polls the library, finds thin/stub saves, opens them in a background tab with your logged-in session and pushes full HTML back (https://addons.mozilla.org/de/android/addon/readwise-full-content/). Shows demand for "re-capture with my logged-in browser".

2.2 Mobile share sheet (iOS and Android)
- DOC (https://docs.readwise.io/reader/docs/faqs/adding-new-content): once the mobile app is installed, share to Reader from the OS share sheet. If Reader is missing from the share menu, "restart your device" (iOS hides newly installed targets).
- Share-sheet menu features (DOC, saving-content page): Read Now, Delete, add tags, add document note, move to Later.
- Capture quality caveat (DOC, https://docs.readwise.io/reader/docs/faqs/parsing): "Saving from Safari is the best way to save documents to Reader on mobile because iOS gives our app access to the underlying content in addition to the URL." Saving directly from other iOS apps (NYT, Medium apps) may give "only the naked URL" because those apps "aggressively block read-it-later apps" -> partial parsing. Paywalled full content on mobile only if saved from iOS Safari while logged in.
- Filtering syntax has distinct "saved using" values for iOS share sheet and Android share sheet (https://docs.readwise.io/reader/guides/filtering/syntax-guide) - i.e. every doc records HOW it was saved and you can filter on it.
- Android: share target also accepts files via Files app ("Save File to Reader"), podcast episodes, and OPML files (Oct 2 2026 changelog fixed OPML not appearing in the Android share sheet; Sept 11 2026 fixed crash after double-tapping Done in the share-sheet tag view).
- Tag hygiene fix: tags created via API or share extension can no longer end with trailing spaces (release note).
- Podcasts: App Store listing says share an episode from Apple Podcasts, Spotify or Overcast to Reader -> saved as a permanent, highlightable transcript. Spotify/Pocket Casts wrong-transcript bug fixed later. (https://apps.apple.com/app/readwise-reader/id1567599761)

2.3 Email-in (DOC https://docs.readwise.io/reader/docs/faqs/email-newsletters)
- Two unique addresses per account: `...@library.readwise.io` (one-off docs you want to read) and `...@feed.readwise.io` (newsletters/auto-forwarding rules; lands in Feed, skips your main inbox). Found under preferences / "More import options" on web (blue + button) / Settings on mobile.
- Can be personalized on the Add to Library page; only the latest personalized address works; non-random strings may attract spam.
- Newsletter workflow: subscribe directly with the feed address (double-opt-in confirmation mail shows up in Feed like any doc), or Gmail filter forwarding (3P guide https://dev.to/boseclaw/how-to-forward-your-newsletters-to-readwise-reader-and-stop-reading-them-in-gmail-27ap). 3P blog: Substack with a Readwise address "causes issues" so use a separate rule (tansybradshaw.com).
- Emailed PDF/EPUB attachments become docs; a past fix: emailing a PDF/EPUB used to discard the email body.
- Matter import: export in Matter emails you a link, forward that email to `read@readwise.io` (https://docs.readwise.io/reader/docs/faqs/importing-content).

2.4 Web app Add/Upload
- "Add to Library" page (read.readwise.io/add-to-library): paste URL (press `A`), upload files by drag-drop or `U`: PDF, EPUB, OPML, CSV, ZIP, XML; Markdown uploads added July 2026 (changelog). CSV imports (Instapaper, Matter, custom) ignore deleted docs so you can re-import (release note).
- A "link prefixed with the save address" can save an article to the inbox (docs, URL-prefix trick) - i.e. a bookmarklet/URL-scheme style save.

2.5 RSS / Feed (DOC https://docs.readwise.io/reader/docs/faqs/feed; USER MacStories)
- Library (things you curate) vs Feed (RSS, newsletters, X lists/digests you skim). Feed items get moved to Library later. "Manage Feeds" has a "Suggested" tab listing RSS feeds auto-detected on docs you've saved; subscribe in bulk. OPML import by drag/`U`. Subscribing fetches the latest ~5 items immediately (3P Japanese note).
- Folders from other readers are converted to "Filtered Views"; feeds can be grouped.
- Federico Viticci (MacStories) tried Reader as his primary RSS client and "decided to go all-in with Reader as my read-later app (at least for now)"; imported OPML from Inoreader and "Reader automatically converted my previous folders into views"; he stayed "skeptical and misses some features and design elements from Unread". https://club.macstories.net/posts/using-readwise-reader-as-my-rss-client , https://www.macstories.net/linked/unread-3-3/
- Unread 3.3 added an article action to send a headline straight to Reader (inter-app handoff).

2.6 Twitter/X
- DOC (https://docs.readwise.io/readwise/docs/importing-highlights/twitter, https://readwise.io/changelog/twitter-bookmarks): connect X account to sync bookmarks daily (experimental, depends on X API); single tweets become highlights, threads become Reader articles; threads aren't detectable from bookmarks, so reply "save thread" to the Readwise handle or DM it. Aug 2026 changelog: backfill old bookmarks keeping original dates. 2026 parsing fixes for X formatting, video embeds, private/subscription tweets.

2.7 YouTube
- Update #11 (Jan 30 2025) "YouTube v2": cleaner transcripts, resizable video player, pick caption language; transcript text highlights in sync with playback, click transcript to jump (3P/AI-summary sources, medium confidence: https://readwise.io/reader/update-jan2025, https://curtismchale.ca/2025/03/29/read-later-with-readwise). Feb 2026 fix: subtitles not displaying after a YouTube-side change. Oct 2026 Play listing: YouTube chapters in the Contents panel. YouTube channel URLs were once treated as single videos (fixed).
- r/readwise topic (GummySearch): users like Reader for YouTube but want a more efficient layout (https://gummysearch.com/r/readwise).

2.8 API / CLI / MCP / automation
- Reader API (DOC https://docs.readwise.io/reader/docs/api): POST to the v3 save endpoint with `Authorization: Token ...`; body JSON requires `url`; optional `html` (if omitted Reader scrapes the URL), `location` in {new, later, shortlist, archive, feed}, `category`; rate limits 20 req/min default, 50 req/min for Document CREATE/UPDATE. Third-party tools list also tags and bulk update (up to 50 docs).
- Readwise MCP server (hosted, OAuth, `https://mcp2.readwise.io/mcp`) gives Claude/ChatGPT/Cursor access to highlights AND full text of Reader docs; updated March 2026 (Update #14). Readwise CLI (https://docs.readwise.io/tools/cli) aimed at terminal agents; official open-source "triage" skill for Claude Code walks the inbox one doc at a time offering Read / Later / Archive / Something else (tag, shortlist) (https://claudeskills.info/skills/readwiseio/readwise-skills/triage/). Locations: new(inbox), later, shortlist, archive, feed.
- iOS: no official native Siri/App Intent "Save to Reader" found; community Shortcuts exist (e.g. batch-save links; https://github.com/Scarvy/awesome-readwise). Readwise's iOS widget is for highlights, not Reader saves (https://readwise.io/changelog/ios-widget).
- IFTTT/Zapier-style triggers exist for Readwise Daily Review (https://ifttt.com/connect/feed/readwise).

2.9 Migration/import
- Pocket: upload the pocket.zip on the Integrations page (do not unzip); Pocket API disabled since Nov 12 2025. Instapaper: connect account; archived -> Archive, 10 newest unarchived -> Inbox, rest -> Later; API capped at 500 items so use CSV. Matter: forward export email. (https://docs.readwise.io/reader/docs/faqs/importing-content, https://docs.readwise.io/reader/docs/migrating-content)
- MacStories: Federico moved GoodLinks articles to Readwise via its API.

## 3. What the apps DO with content

3.1 Triage and organization (DOC)
- Library sections: Inbox (API "new"), Later, Shortlist, Archive, plus Feed. Recommended habit (3P guide): clear the inbox by sending each item to Later, Archive or Deleted so nothing sits in Inbox. Keyboard-first like email.
- Shortcuts (USER/3P blog + DOC): `h` highlight paragraph, `n` highlight + note, `t` tag, `e` archive, `d` delete, `o` open original, `/` search, `?` or Ctrl/Cmd+K opens the command palette/shortcut list; `[` `]` hide sidebars; Shift+N opens Notebook. (https://curtismchale.ca/2025/03/29/read-later-with-readwise , https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes). Command Palette also used to send feedback.
- Tags (doc + highlight), doc-level notes, Filtered Views, extensive filter syntax (`tag:`, `location:`, `category:`, `saved using`, date) - https://docs.readwise.io/reader/guides/filtering/syntax-guide
- Trash Bin with recovery (Update #10, Oct 31 2024); "return to reading position" jump (Update #10); "more robust reading-position tracking across sessions and devices" (Update #12).
- Gaps called out by users: no feed filtering by keyword/tag, no automatic tagging rules by sender/author (AlternativeTo review; a 2025 Reddit ask "wanted a specific author (email/name/...) to get a specific tag when added to the library" with no solution found); third-party Greasy Fork "Reader Bulk Tagger" exists because bulk tagging is weak (r/readwise: "request to add tags to several articles at once").

3.2 Highlights (DOC https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes)
- Highlight on web, mobile, desktop, in PDFs/EPUBs/YouTube transcripts; double-tap a paragraph to highlight it (USER, Doug Belshaw); notes/tags appear in the margin when wide enough; Notebook tab for doc-level notes and export (markdown). Multiple colors exist (API lists yellow/blue/pink/orange/green/purple - 3P). Highlights flow to Readwise -> Daily Review (spaced repetition), Themed Reviews, Mastery Cards, audio reviews (https://readwise.io/changelog/audio-reviews: podcast-like spoken Daily Review).
- Export: Obsidian official plugin (append-only; Feb 2026: can export entire article content, not just highlights; "Export All Reader Documents" setting), Notion, Logseq, Roam, Evernote, Apple Notes export (Update #11), NotebookLM export.

3.3 Ghostreader AI (DOC https://docs.readwise.io/reader/guides/ghostreader/overview , .../custom-prompts , .../global , .../quick-lookup)
- Built-in prompts: summarize, define word/term/character/place, translate, draft newsletter blurb, etc.; editable/custom prompts with output to document or highlight scope; action tags (e.g. `.qa`) create Mastery cards on sync.
- Auto-run on arrival: only two automatic prompts - auto-summarize and auto-tag (library items; Feed items only with your own OpenAI key). Default model historically GPT-4o Mini; Aug 2026 changelog says chat uses updated models; Google Play Oct 2026 note mentions "model upgrade for Ghostreader summaries and tagging".
- Ghostreader v3 chat (web, Dec 2025): rebuilt interface, preset prompts, links to cited text. Mobile Chat shipped Sept 2026. Global Ghostreader (web/desktop only, Aug 2026): chat across the entire library with citations (hover previews cited line), can perform meta-tasks like moving documents and adding tags; indexes every word. Quick Lookup (mobile, Aug 2026): select/long-press 1-3 words -> bottom panel with Define / Lookup (author-contextual meaning) / Translate.
- Better Search (beta toggle, server-based index over whole library; falls back to on-device search offline).
- Credits: one 3P review says Ghostreader "uses credits" and heavy users can exhaust them (unverified; https://www.asianefficiency.com/productivity/readwise-reader-review/).

3.4 Text-to-speech
- DOC: App Store: "listen to any document narrated with the lifelike voice of a real human"; docs mention top-tier AI voices powered by Unreal Speech (search snippet; unverified detail). Oct 2026 Play notes: new TTS voices in beta, reading themes. TTS on EPUBs added May 2023 (Update #4). 2026 fixes: TTS server errors at peak hours; audio Daily Review stalls; TTS auto-scroll breaking word tracking (resolved Feb 6 2026); "Listen" starting from wrong spot (Oct 16 2026).
- USER: UMich tech tip (Apr 2023) "fantastic text-to-speech feature ... surprisingly natural-sounding" (https://michigan.it.umich.edu/news/2023/04/03/tech-tip-readwise-reader). HN 2023: TTS lacked "continuous playback across multiple articles" and "struggled to skip newsletter boilerplate" (https://news.ycombinator.com/item?id=38720882 thread area, per search summary). App Store reviewer wished for resume TTS where left off. 3P comparisons disagree whether Reader TTS is "basic" or "none" - Matter is widely seen as better for TTS.

3.5 Formats
- EPUBs v2 (June 2025): chapter-at-a-time loading (before, EPUB was "one giant article" -> slow). PDF Clean View v2 (June 2025): reflowable text for highlighting/listening to PDFs (fixes pinch-zoom on 2-column PDFs). Tablet support, two-column horizontal pagination (experimental, Nov 2025), sticky tablet sidebars.
- Offline: Offline v2 (Dec 2025) + Offline Documents screen; per-category offline controls on Account screen; desktop app works offline; web only if page already open. Full text cached on mobile.
- Parsing: report parsing issues from app feedback; Sept 2026 re-save re-parses; 2026 site-specific fixes (The Register, Substack, Medium, X).

3.6 Send OUT to e-readers (DOC https://docs.readwise.io/reader/docs/faqs/exporting , Update #10 https://readwise.io/reader/update-oct2024)
- Send to Kindle (Oct 2024): add your Kindle email in Integrations; approve Reader's sender address in Amazon Personal Document Settings; use a Kindle address with a random ID to avoid per-doc confirmation. Send single doc via "..." menu or turn on Automatic Delivery digest: daily (docs added in last 24h) or weekly (last 7 days, Fridays), sent at midnight Eastern; no digest if nothing new. Fully parsed articles with images, plus EPUB/PDF. Known limit (Readwise's own words): highlights made on Kindle do not sync back.
- Kobo: Reader cannot be installed on Kobo. Readwise rep (erinatreadwise), r/readwise Mar 26 2025: Reader "can't yet be installed on Kobo"; "something we'd love to support in the future, but we'd need the help of the Kobo team"; working on e-ink improvements for Android devices like Boox (https://redlib.hbubli.cc/r/readwise/comments/1jka4uh/kobo_reader_integration). HN (May 2025, item 44066353 per search summary): same answer, Kobo is proprietary; Android e-ink is the supported path. Readwise does import highlights from Kobo-store books (beta) and sideloaded via the "October" desktop app (https://docs.readwise.io/readwise/docs/importing-highlights/kobo). MobileRead 2024 post: Kobo user considering Boox just to run Reader; found Readwise-Kobo integration "quite buggy" (https://mobileread.com/forums/showthread.php?p=4432915).
- Boox/Daylight: see section 4.

## 4. Daylight / e-ink angle (important for our product)

- Readwise docs "Using Reader on e-ink devices" (https://docs.readwise.io/reader/docs/faqs/eink): Reader runs on any Android e-ink device with Google Play, naming "the Daylight Computer or any of the BOOX tablets". E-ink Mode turns on automatically when an e-ink device is detected; toggle in Account Settings. Options: Reduce motion (limit ghosting), Reduce page animations when swiping in paged scroll, High contrast, Use volume buttons to turn pages. "Defaults vary by device": the Daylight has a very high refresh rate so it does not auto-turn-off motion reduction.
- Update #12 (June 19 2025): E-Ink Mode preview "better black on white contrast and reduced animations" for Boox and Daylight. A later update (YouTube "Readwise Reader Just Got A Ton Better... (on e-Ink)", AI summary at https://lilys.ai/en/notes/lilysai-20260829/readwise-reader-eink-improved) added Kindle-like page-turning (tap right/left half, no animation) so no scrolling on e-ink; Balanced refresh may ghost, use forced-refresh gesture (Boox).
- Daylight itself says the DC-1 is not e-ink: proprietary "Live Paper" (reflective/transflective LCD), 60-120 fps (https://en.wikipedia.org/wiki/Daylight_Computer_Co. , https://www.techradar.com/tablets/the-daylight-dc-1-is-an-exciting-cross-between-a-kindle-and-an-ipad-with-an-lcd-screen-that-looks-like-e-ink).
- USER: Poke5 review (kadavy.net, Mar 2024): read an entire book in Reader on a Boox, main draw = non-Kindle EPUBs on e-ink with highlights syncing to Readwise (https://kadavy.net/blog/posts/boox-poke5-review/). Palma setup guide: Literata, size ~18, line spacing ~1.2 and warns some Reader settings sync across devices (https://overkill.wtf/palma-setup). lu.is bought a DC-1 after trying Boox, praises warm screen (https://lu.is/2025/01/reading-in-2024-tools/). r/daylightcomputer user: sliding pages "feels like doomscrolling rather than reading a book", wants a whole-page-turn gesture (https://redlib.hbubli.cc/r/daylightcomputer/new).
- Daylight's own support site has a Reader section (https://support.daylightcomputer.com/getting-started) - this is likely the Daylight-native Reader (our target), not Readwise Reader; I could not verify.
- Implication: Readwise Reader is already a viable (paid) way to read on DC-1. Our differentiators: no subscription, E2E encryption, native Daylight Reader, pen workflow. Our parity targets: capture quality (rendered DOM), post-save tag/note/destination, digest, import, rich formats.

## 5. USER sentiment: what people love

- "Does everything in one inbox": Readwise's own copy: "Reader is where you read: the full content of your articles, PDFs, EPUBs, email newsletters, RSS feeds, YouTube videos, X threads, and more, all in one place" (https://readwise.io/read). 3P: "best read-later app for power readers because it handles articles, newsletters, PDFs, RSS, and YouTube transcripts in one place" (https://www.mailist.app/blog/best-pocket-alternatives).
- Highlight-to-knowledge-base loop (Obsidian/Notion) and spaced repetition (Product Hunt reviewers; 3P reviews) is the main reason people pay.
- Capture fidelity: browser extension saves rendered page; paywalled content works when saved from logged-in browser/Safari.
- Typography/pagination and fast highlight gestures: Doug Belshaw (Thought Shrapnel) - double-tap highlights whole paragraph, good pagination, "parses almost always correctly" (https://archive.dougbelshaw.com/thought-shrapnel/no-breathless-whispering-of-mark/).
- Ghostreader summaries/definitions (AlternativeTo reviewers, https://alternativeto.net/software/readwise-reader/about) and Quick Lookup; chat with cited links.
- TTS "surprisingly natural" (UMich).
- YouTube transcript reading + highlights.
- Send to Kindle digest (WiseUp Vol. 6, Oct 2024 update).
- Cross-platform UI "works well across all my devices" (AlternativeTo).
- Viticci: all-in on Reader as read-later app (MacStories).
- HN launch thread 2022: users called it "my favorite app of the year" and said they subscribed within days (per search summary of https://news.ycombinator.com/item?id=34006202 and https://news.ycombinator.com/item?id=34156055 "Readwise Reader has completely changed the way I consume articles/PDFs/ebooks an...").
- Founder responsiveness: Vendr thread founder offered discounts; changelog is weekly and detailed.

## 6. USER sentiment: what people hate / pitfalls

- Price: no free tier; ~$120/yr. HN May 2025 (item 44068545): "The current pricing of Readwise seems like it will not be attractive to the 99% ..." (post-Pocket-shutdown thread; commenter suggested a free reader-only tier). 3P: "most expensive read-later app". AlternativeTo reviewer: "expensive for what it offers".
- Not available on Kindle/Kobo as an app; Kindle gets copies but highlights don't sync back; Kobo needs Kobo's cooperation.
- Capture from non-browser apps gives bare URL -> truncated articles; share extension hidden until device restart.
- Parsing bugs; no "regenerate parse" (AlternativeTo) - partly addressed Sept 2026 by re-save re-parse.
- No automatic tagging / feed rules / keyword filters (AlternativeTo, Reddit 2025).
- Performance: slows over time and needs reset (Readwise community thread via search); white-screen launch after reinstall (2025 thread); Home view capped at 20 items (Mar 2025 thread); archived items reappearing; chapter links in EPUB not navigating; "feels like none of them are really mature, PDF handling weak" (Reddit comment per search summary).
- TTS: no queue/continuous playback, boilerplate reading, resume position, server errors at peak (HN 2023, App Store reviewer, 2026 changelog).
- Firefox/Chrome extension: collects user data, requires login, Wikipedia highlighting issues after an update, still Manifest V2 on Firefox (AMO reviews, https://en-US.add-ons.mozilla.com/en-US/firefox/addon/readwise-highlighter/reviews/). Confusing: separate extension for Kindle highlights.
- Beta label and update cadence: Update #14 (Aug 2026) came "8 months since our last update email".
- Chinese/CJK: reading-time stats don't count Chinese characters; mobile voice reading in Chinese lacking (feature-feedback blog https://jimmylv.substack.com/p/vy90kid).
- Ghostreader credits may run out (3P, unverified); feed items not auto-summarized unless own OpenAI key.
- Habit risk: system only pays off if you review daily (3P reviews).
- Lock-in worry after Pocket/Omnivore shutdowns; people value open export (CSV, Obsidian append-only).
- Onboarding "forced-feeling" (Product Hunt summary).

## 7. Candidate features for Send to Daylight "Lab" (from this angle)

(see structured summary; summarized here)
1. Post-send metadata: tags, note, destination (Read now / Later / Archive) chosen in the share sheet/extension/popup. Needs protocol field + Inbox UI.
2. Capture-fidelity: always send the rendered DOM from the browser (logged-in, paywalled); iOS share ext should request the Safari page content, not just URL; "re-capture from my logged-in browser" button; re-send of same URL replaces/updates (keep older if new is worse).
3. Source tagging: record how/where an item was sent (iPhone share sheet, Mac extension, etc.) and make filterable in Inbox.
4. Scheduled digest/bundle: batch items and deliver at a fixed time (Send to Kindle digest analog).
5. Email-in address (library vs feed) -> needs server; maybe via relay mailbox (E2E trade-off).
6. YouTube transcript capture client-side in extension (grab caption track from page) and send as article; podcast transcript via share sheet needs server.
7. X/Twitter thread unroll in extension.
8. Import/migration: Pocket zip, Instapaper CSV, Matter, OPML, Markdown, bulk URL list -> queue.
9. Developer surface: documented HTTP/URL-scheme save endpoint, iOS/macOS App Intents (Shortcuts/Siri action), bookmarklet; MCP/CLI to send from AI agents.
10. Keyboard shortcuts + command palette in Mac/Chrome (Alt+R equivalent; global hotkey "Send current page").
11. E-ink/Live Paper reading mode in Inbox/Reader (reduce motion, high contrast, tap-to-turn pages, volume-button paging).
12. Offline-first Inbox (cache full text/images) with per-category offline control; trash bin with recovery.
13. Highlights/excerpts: send selected text as an excerpt with source link; (round-trip of pen highlights = reader change).
14. Android share target for files, OPML, podcasts, markdown.
15. Reading-position sync and "return to farthest position".
16. AI (summary/auto-tag on arrival, chat, quick lookup) -> requires LLM backend; conflicts with E2E unless on-device/BYO key.
17. Feed/RSS auto-detect from saved pages and "Suggested feeds" -> Inbox-side polling.

## 8. Source URL index (all via search results; none opened directly)

Official docs/changelog/updates:
- https://docs.readwise.io/reader/docs (What is Reader)
- https://docs.readwise.io/reader/docs/saving-content
- https://docs.readwise.io/reader/docs/faqs/adding-new-content
- https://docs.readwise.io/reader/docs/faqs/importing-content
- https://docs.readwise.io/reader/docs/migrating-content
- https://docs.readwise.io/reader/docs/faqs/parsing
- https://docs.readwise.io/reader/docs/faqs/email-newsletters
- https://docs.readwise.io/reader/docs/faqs/feed
- https://docs.readwise.io/reader/docs/faqs/exporting
- https://docs.readwise.io/reader/docs/faqs/eink
- https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes
- https://docs.readwise.io/reader/docs/faqs/miscellaneous
- https://docs.readwise.io/reader/docs/organizing-content
- https://docs.readwise.io/reader/docs/api
- https://docs.readwise.io/reader/guides/ghostreader/overview
- https://docs.readwise.io/reader/guides/ghostreader/custom-prompts
- https://docs.readwise.io/reader/guides/ghostreader/global
- https://docs.readwise.io/reader/guides/ghostreader/quick-lookup
- https://docs.readwise.io/reader/guides/filtering/syntax-guide
- https://docs.readwise.io/changelog and https://docs.readwise.io/changelog/rss
- https://docs.readwise.io/tools/mcp , https://docs.readwise.io/tools/cli , https://docs.readwise.io/tools
- https://docs.readwise.io/readwise/docs/importing-highlights/twitter , .../kobo
- https://docs.readwise.io/readwise/docs/exporting-highlights/obsidian
- https://readwise.io/read , https://readwise.io/reader_api , https://readwise.io/changelog/twitter-bookmarks , https://readwise.io/changelog/audio-reviews , https://readwise.io/changelog/kobo-import
- Reader Public Beta updates: https://readwise.io/reader/update-feb2023 (#2), /update-march2023 (#3), /update-may2023 (#4), /update-oct2024 (#10), /update-jan2025 (#11), /update-june2025 (#12), /update-dec2025 (#13), /update-aug2026 (#14)
- WiseUp newsletter: https://wiseup.readwise.io/wiseup-vol-6-curate-themed-reviews-send-articles-to-kindle-and-more/ , /wiseup-vol-20-skim-your-feed-discover-e-ink-mode-and-master-anything-with-themed-reviews-2/ , /wiseup-vol-79-clean-up-your-reader-explore-the-new-readwise-and-upload-your-md-files/ , /wiseup-vol-89-an-abundance-of-book-recs-reading-themes-and-more/
Stores:
- https://apps.apple.com/app/readwise-reader/id1567599761 ; https://apps.apple.com/app/save-to-reader/id1640236961
- https://play.google.com/store/apps/details?id=com.readermobile&hl=en_US
- https://chromewebstore.google.com/detail/readwise-highlighter/jjhefcfhmnkfeepcpnilbbkaadhngkbi ; https://addons.mozilla.org/firefox/addon/readwise-highlighter/ ; https://en-US.add-ons.mozilla.com/en-US/firefox/addon/readwise-highlighter/reviews/
Community/user:
- HN: https://news.ycombinator.com/item?id=34006202 (Show HN Reader), 34156055, 30316244, 38720882, 44066353, 44068545, 43098318 (Thoughts on Daylight Computer)
- Reddit mirrors: https://redlib.hbubli.cc/r/readwise/comments/1jka4uh/kobo_reader_integration ; https://redlib.hbubli.cc/r/readwise/comments/1j104pq/bug_reports_ask_here ; https://redlib.hbubli.cc/r/readwise/comments/1kg9g9x/may_bug_reports_ask_here ; https://redlib.hbubli.cc/r/readwise/comments/1cosesr/reader_roadmap/lujv622/ ; https://cal1.lr.ggtyler.dev/r/readwise/comments/1hxewoh/january_bug_reports_ask_here ; https://gummysearch.com/r/readwise ; https://redlib.hbubli.cc/r/daylightcomputer/new
- https://mobileread.com/forums/showthread.php?p=4432915
- https://alternativeto.net/software/readwise-reader/about
- https://www.producthunt.com/products/readwise/reviews
- https://club.macstories.net/posts/using-readwise-reader-as-my-rss-client ; https://www.macstories.net/linked/unread-3-3/
- https://thesweetsetup.com/readwise-reader-a-very-good-modern-rss-app/
- https://archive.dougbelshaw.com/thought-shrapnel/no-breathless-whispering-of-mark/
- https://curtismchale.ca/2025/03/29/read-later-with-readwise
- https://kadavy.net/blog/posts/boox-poke5-review/ ; https://overkill.wtf/palma-setup ; https://lu.is/2025/01/reading-in-2024-tools/ ; https://max.pm/posts/daylight_dc1/
- https://michigan.it.umich.edu/news/2023/04/03/tech-tip-readwise-reader
- https://dev.to/boseclaw/how-to-forward-your-newsletters-to-readwise-reader-and-stop-reading-them-in-gmail-27ap ; https://tansybradshaw.com/readwise-reader/
- https://jimmylv.substack.com/p/vy90kid ; https://talk.macpowerusers.com/t/in-need-of-help-with-a-workflow-email-read-later-annotate/33481
- https://www.vendr.com/blog/do-you-use-readwise-app-how-much-are-you-paying-for-the-service
- https://forum.beeminder.com/t/rip-pocket-long-live-readwise-reader-what-else-are-folks-switching-to/12378
- https://mymoneyblog.com/readwise-kindle-highlights-email.html
3P comparisons (lower trust): https://www.asianefficiency.com/productivity/readwise-reader-review/ ; https://www.readless.app/blog/readwise-reader-pricing-2026 ; https://toolradar.com/tools/readwise/pricing ; https://www.mailist.app/blog/best-pocket-alternatives ; https://usedigest.com/alternatives/readwise-reader/ ; https://getnook.net/compare/readwise-reader-vs-matter ; https://www.mirareader.com/blog/readwise-reader-alternatives-2026/ ; https://bookmend.app/blog/readwise-reader ; https://nubiapage.com/readwise-review-2026-app-pricing-alternatives-free-trial-download-user-experience-and-faqs/ ; https://lilys.ai/notes/en/lilysai-20260829/readwise-reader-process-everything (AI summary of a YouTube video "Readwise Reader - How I Process EVERYTHING I Read") ; https://lilys.ai/en/notes/lilysai-20260829/readwise-reader-eink-improved (AI summary of YouTube "Readwise Reader Just Got A Ton Better... (on e-Ink)")
Tooling/ecosystem: https://github.com/Scarvy/awesome-readwise ; https://pypi.org/project/readwise-reader-cli ; https://claudeskills.info/skills/readwiseio/readwise-skills/triage/ ; https://composio.dev/toolkits/readwise_reader/framework/claude-cowork ; https://greasyfork.org/ar/scripts/559865-readwise-reader-bulk-tagger/code ; https://addons.mozilla.org/de/android/addon/readwise-full-content/

## 9. Gaps I could not close (for the lead)

- No verbatim Reddit/HN comment bodies, no App Store review text, no YouTube transcripts (all fetch paths blocked). A follow-up agent with working fetch should open: HN items 34156055, 44068545, 44066353, 38720882; r/readwise Kobo thread; the App Store reviews page (https://apps.apple.com/us/app/readwise-reader/id1567599761?see-all=reviews); Reader update #11-#14 pages for full feature lists; docs "feed" and "organizing-content" pages.
- Unverified: exact TTS voice vendor/list, whether Reader has a TTS queue/lock-screen controls, Ghostreader credit limits, native Siri/App Intent for saving.
