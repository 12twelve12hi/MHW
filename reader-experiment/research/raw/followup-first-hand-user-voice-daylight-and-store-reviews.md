# Follow-up: first-hand user voice (DC-1 owners, store reviews, forums) - NOT COLLECTED THIS RUN

Angle: non-developer user voice about getting reading material onto a reading device, and about the mobile apps and extensions Send to Daylight copies.
Compiled: 2026-10-20 by the follow-up agent. Project: "Send to Daylight" companions feeding the Daylight Reader on the DC-1.

## 0. READ FIRST: outcome

**I collected zero new evidence. I have no verbatim quotes, no star ratings, no app versions and no theme counts from this run. Nothing below is invented to fill the gap.**

Every route to the sources was closed before I could read a single page. I stopped when each route failed and did not try to get around any of them.

| # | What I tried | Result (exact) |
|---|---|---|
| 1 | WebSearch, mode standard, allowed_domains reddit.com + redlib mirrors, query about how DC-1 owners get articles/PDFs/EPUBs onto the tablet | "Web search was not performed: this turn's web search budget is used up (limit: 200 WebSearch calls per turn, shared by every agent in it)" |
| 2 | WebSearch, mode extended, no domain filter, query "Instapaper Premium Kindle digest 2026 paywall" | Same refusal. The budget is a shared per-turn count that the earlier swarm had already spent. |
| 3 | WebFetch https://itunes.apple.com/us/rss/customerreviews/page=1/id=1567599761/sortby=mostrecent/json (Readwise Reader iOS reviews, would give rating + version + date) | `getaddrinfo ENOTFOUND itunes.apple.com` |
| 4 | WebFetch https://apps.apple.com/us/app/readwise-reader/id1567599761?see-all=reviews | `getaddrinfo ENOTFOUND apps.apple.com` |
| 5 | WebFetch https://play.google.com/store/apps/details?id=com.readermobile | `getaddrinfo ENOTFOUND play.google.com` |
| 6 | WebFetch https://news.ycombinator.com/item?id=43098318 ("Thoughts on Daylight Computer") | `getaddrinfo ENOTFOUND news.ycombinator.com` |
| 7 | WebFetch https://max.pm/posts/daylight_dc1/ (DC-1 blog review) | `getaddrinfo ENOTFOUND max.pm` |
| 8 | Read the proxy README and status endpoint (the documented diagnostic: `curl http://127.0.0.1:43407/__agentproxy/status`) | Worked. It shows the egress gateway answering "403 to CONNECT (policy denial)" for www.reddit.com, old.reddit.com, www.youtube.com, www.instapaper.com, help.instapaper.com, matter.app, goodlinks.app, raindrop.io, docs.karakeep.app, www.amazon.com, en.wikipedia.org, getpocket.com and others, recorded earlier in the day by sibling agents. |
| 9 | One `curl` each to itunes.apple.com and apps.apple.com through the sanctioned proxy, to see whether the App Store hosts are policy-blocked or only unresolvable for WebFetch | Both: `CONNECT tunnel failed, response 403`. The status endpoint now lists both as connect_rejected. Per the proxy README I did not retry, and I probed no other host after that. |

Conclusion: with the search budget spent and every host that holds first-hand user voice either unresolvable (WebFetch) or policy-denied (proxy), this angle cannot be done from inside this environment right now. This is a blocker to report, not something I worked around. I did not search through curl, third-party readers, Reddit mirrors, web archives or any other proxy service, because the budget notice forbids that.

What would unblock it (the user's decision, not mine):
1. Raise `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` (the refusal names this setting) or let a fresh turn start with its own 200-search budget, then re-run section 7 below.
2. Ask the environment owner to allow apps.apple.com, itunes.apple.com, play.google.com, chromewebstore.google.com, news.ycombinator.com / hn.algolia.com, www.mobileread.com, and a Reddit route. Today these are policy-denied or do not resolve.
3. Or have the user paste or attach the raw text (a human can read these sites): the r/daylightcomputer threads on getting content onto the tablet, the HN item 43098318 comments, 20-30 recent App Store / Play / Chrome Web Store reviews per product, and the four MobileRead threads. I can then do the quote extraction and theme counting offline.

## 1. Deliverable status against the assigned task

| Assigned item | Status |
|---|---|
| (a) DC-1 owners: r/daylightcomputer, HN 43098318, Daylight support site, Discord recaps, YouTube, max.pm, lu.is. How do they get articles, PDFs, EPUBs on; which Play Store reader; what do they hate; re-check "doomscrolling" claim | NOT DONE. No page read. The "doomscrolling" claim remains a relayed redlib snippet that nobody has opened (section 3a). |
| (b) 1-3 star and 5-star themes with star, date, version, for Readwise Reader (iOS, Android, Chrome), Instapaper (Instapaper 10, Feb 2026 paywall), Matter, GoodLinks, Karakeep, Amazon Send to Kindle (apps + Chrome extension), Read on reMarkable, Send2Boox / BooxDrop, Raindrop | NOT DONE. 0 quotes, 0 ratings read. |
| (c) Verify "Amazon's Chrome extension is buggy" and "Instapaper digests, not only single sends, became Premium-only on 2026-02-19" | NOT VERIFIED. Both stay exactly as thinly sourced as before; sibling evidence is summarised in section 3c with the specific document that would settle each. |
| (d) MobileRead ?p=4545848, ?t=372113, ?p=4432915, ?p=4523064 | NOT DONE. Host policy-denied for every earlier agent; I did not retry. |
| Per-product up-to-10 quotes with URL, date, rating, [OPENED]/[SNIPPET-ONLY] tag | EMPTY. Not a single quote qualifies for either tag, because I opened nothing and saw no search snippet. |
| Ranked theme counts by iPhone, Android, Chrome extension, Mac | EMPTY (section 4). |
| Which top-25 wants are confirmed / contradicted / newly added | 0 / 0 / 0 (section 5). |
| Lab features with Needs tag | None added by this evidence (section 6). |

## 2. Why this matters for the build (so the gap is not forgotten)

`community-voice.md` section 0 already says its "user voice" is mostly GitHub issue comments plus search snippets no one opened. This follow-up does not change that. Any ranking in `community-voice.md` sections 1-3 still rests on developer / self-hoster voice. The decisions most at risk of being wrong because of that skew are the ones where an ordinary phone user and a self-hoster would disagree: offline behaviour (want 3), share-in-place speed (want 2), digest dedupe (want 8), and pricing/paywall anger (want 22 / frustration F5). Treat the top-25 ordering as provisional until store-review text is read.

## 3. Material already in sibling notes that bears on this angle (RELAYED, not opened or verified by me)

Tag for everything in this section: **[SIB-RELAYED]**. I read the sibling file text only. I did not open the cited URL, and in most cases the sibling did not either (search-snippet or third-party aggregate). It is listed so a follow-up run knows exactly what to open and check. It must not be quoted as store-review evidence.

### 3a. DC-1 owners
- "Doomscrolling" claim: r/daylightcomputer user said page sliding "feels like doomscrolling rather than reading a book" and wants a whole-page-turn gesture. Source: https://redlib.hbubli.cc/r/daylightcomputer/new, relayed in `readwise-reader.md` line 115 and `community-voice.md` section 4. Unverified; the post, author, date and vote count are unknown. [SIB-RELAYED, snippet]
- Readwise's own doc names the Daylight Computer as an e-ink target for Reader and says "the Daylight has a very high refresh rate so it does not auto-turn-off motion reduction" (https://docs.readwise.io/reader/docs/faqs/eink). A June 2025 Reader update added a preview of "better black on white contrast and reduced animations" for Boox and Daylight, and a later YouTube video ("Readwise Reader Just Got A Ton Better... (on e-Ink)", summary at https://lilys.ai/en/notes/lilysai-20260829/readwise-reader-eink-improved) is said to have added Kindle-like tap-to-turn pages. This is vendor documentation, not owner voice. [SIB-RELAYED, DOC]
- lu.is (https://lu.is/2025/01/reading-in-2024-tools/): bought a DC-1 after trying Boox, praises the warm screen. max.pm (https://max.pm/posts/daylight_dc1/) and HN 43098318 are named but nobody has read them. [SIB-RELAYED, pointers]
- `eink-tablets.md` 1.4 states the honest position: no first-hand evidence of how DC-1 owners get articles and PDFs on. The device has Google Play and adb install works, so Readwise Reader, Kindle, Libby, Instapaper, KOReader, Drive and Dropbox all install ([LOCAL] probe in that file). Which of them owners actually use, and what they hate about it, is still unknown.

### 3b. Store ratings and themes (aggregates seen by siblings; no review text read)
- Readwise Reader iOS (id1567599761): "4.6 stars from 532 reviews" quoted by a 2026 third-party review (https://www.asianefficiency.com/productivity/readwise-reader-review/); Justuseapp automated analysis of 546 reviews, "66.7% positive / 33.3% negative", low trust (https://justuseapp.com/en/app/1567599761/readwise-reader/reviews). One App Store reviewer wished Reader would resume TTS where it left off (`readwise-reader.md` line 98). Chrome "Readwise Highlighter" about 4.2/5 from about 60 reviews per a tracker (https://chrome-stats.com/d/jjhefcfhmnkfeepcpnilbbkaadhngkbi); Firefox about 4.4 from 16 ratings; Firefox reviews complained about data collection, mandatory login and Manifest V2. [SIB-RELAYED, aggregate]
- Instapaper Android: aggregate 4.6 stars from about 12.8k ratings; complaints "slow syncing, gaps in PDF sync, reliability glitches, data-loss worries" (`read-later-apps.md` line 53, from chrome-stats / APKMirror changelog pages, https://www.apkmirror.com/apk/instant-paper-inc/instapaper). The official Instapaper Chrome extension is described as thin, and third-party extensions fill the gap (Open in Instapaper Text 4.7 stars / 510 ratings). [SIB-RELAYED, aggregate]
- Raindrop Chrome extension: about 4.1-4.2 stars, about 787 ratings, 400-500k users; complaints: "popup slow to open, save button missing, 'buggy'"; a paying subscriber said AI organisation suggestions "were not useful and setup took more time than expected". Source: https://chromewebstore.google.com/detail/raindropio/ldgfbffkinooeloadekpmfoklnobpien/reviews, relayed in `read-later-apps.md` line 92. Whether the sibling opened it or saw a search summary is not stated. [SIB-RELAYED, snippet/aggregate]
- Omnivore iOS (shut down 2024): about 4.4 stars / 266 ratings (https://apps.apple.com/app/id1564031042). Historical only. [SIB-RELAYED]
- Matter, GoodLinks, Karakeep, Amazon Send to Kindle apps, Read on reMarkable, Send2Boox / BooxDrop: nothing relayed beyond feature documentation. No ratings, no review text anywhere in the sibling notes.
- Instapaper 10 (July 2026 redesign): `community-voice.md` section 5 mentions it as a product fact only. No user reaction is recorded anywhere.

### 3c. The two claims to verify

**Claim 1: Amazon's official Send to Kindle Chrome extension (cgdjpilhipecahhcilnafpblkieebhea) is "buggy".**
- Current source: the README of a competitor, https://github.com/manabubannai/kindle-send-chrome (created 29 Jun 2026), which calls the official one "buggy", says it "breaks because it depends on Amazon's authenticated web endpoints", and mentions "CORB/CORS issues under Manifest V3, and frequent backend changes" (`browser-clippers.md` line 185). A second unofficial port README (https://github.com/AALAM98mod100/send-to-kindle-firefox) only says the official extension needs you to be logged in to amazon.com in the same browser. That is a design fact, not a bug report.
- `send-to-kindle-kobo-pocketbook.md` 2.6 reportedly notes that Amazon moved delivery to a new Kindle Docs API on 12 Oct 2026, breaking community clients. I did not check that note's source. If true, it is a reason an official extension could also have broken recently.
- Verdict from available evidence: **UNVERIFIED, single interested source (a competitor).** Settling it needs the Chrome Web Store reviews page https://chromewebstore.google.com/detail/send-to-kindle-for-google/cgdjpilhipecahhcilnafpblkieebhea (rating, user count, last-updated date, the 1-3 star reviews from the last 6 months) and ideally r/kindle or MobileRead posts about failed sends. Do not repeat the word "buggy" in any user-facing or decision document until then.

**Claim 2: Instapaper scheduled digests, not only single sends, became Premium-only on 2026-02-19.**
- Points to "both are Premium": Pocket-lint (https://www.pocket-lint.com/instapaper-send-to-kindle-going-behind-paywall/) and eReaders Forum (https://www.ereadersforum.com/blog/instapapers-send-to-kindle-feature-moves-to-premium/) reportedly say all Kindle delivery incl. scheduled digests; Instapaper's Premium overview (https://www.instapaper.com/docs/premium/overview) lists "Kindle Digests: send your articles to your Kindle on a daily or weekly schedule" under Premium (that page may predate the change); and an Instapaper rep on Reddit is relayed as explaining that "digest generation is resource-intensive" ("parsing articles, downloading images, creating an ePub file, and emailing it"), which reads as a reason for gating the digest specifically. [SIB-RELAYED]
- Points to "digests stay free": a "GTM Directory" page (low-trust) says digests stay free. [SIB-RELAYED]
- A MobileRead user (https://www.mobileread.com/forums/showthread.php?p=4545848) complained the free digest "includes the same articles in the daily packages lots of times". "Free" there suggests the post predates the paywall; its date is unknown. [SIB-RELAYED]
- Verdict: **UNRESOLVED; more likely both are Premium, but no primary source has been read.** Settling it needs Instapaper's own announcement (the blog post or help-center article from Feb 2026) and the Reddit reply by the Instapaper rep, which is the closest thing to a first-hand statement. Design implication that holds either way: Send to Daylight should not promise to replace Instapaper digests until this is known; the "morning stack" want (8) stands on the dedupe complaint regardless.

### 3d. MobileRead threads (none opened; all hosts policy-denied for earlier agents)
- ?p=4545848: Instapaper digest repeats the same articles (relayed above).
- ?t=372113: KOReader Instapaper plugin. ?p=4432915: Readwise-Kobo integration "quite buggy". ?p=4523064: eReaditLater. Nothing beyond the title-level relays in `community-voice.md` section 7 and `highlights-roundtrip.md` line 147.

## 4. Ranked theme counts (wants / loves vs hates), by platform

Not produced. A count needs read reviews and I read none. For the record, the cells are empty rather than estimated:

| Platform | Wants / loves (ranked, count) | Hates (ranked, count) |
|---|---|---|
| iPhone | none | none |
| Android | none | none |
| Chrome extension | none | none |
| Mac | none | none |

Proposed coding sheet for the follow-up so counts are comparable across products: one row per review with columns product, platform, stars, date, app version, source URL, tag (OPENED / SNIPPET-ONLY), verbatim quote, and one or two theme codes from this fixed list (so counts do not drift): offline, share-sheet speed, extraction quality, paywalled pages, sync reliability, delivery failure / silent fail, notifications, digest / newsletters, PDF handling, highlights round trip, tags / folders, search, TTS, price / paywall, account / login friction, privacy, performance / battery, e-ink / reading comfort, UI redesign backlash, support responsiveness.

## 5. The existing top-25 wants in `community-voice.md`: effect of this evidence

- Confirmed by this run: **none (0 of 25).**
- Contradicted by this run: **none (0 of 25).**
- Newly added by this run: **none (0).**
- All 25 stay at the evidence level `community-voice.md` gave them (mostly GitHub issue threads).

Hypotheses that store-review text is best placed to confirm or reject (these are my guesses, not findings), so the follow-up can go straight at them:
1. Want 3 (offline / send-later outbox) and want 14 (background receive with a notification): expect to be among the loudest in iPhone and Android review complaints about sync and notifications.
2. Want 2 (share in place) and want 19 (one-keystroke send): test against Instapaper / Raindrop / Readwise share-extension reviews ("slow", "opens the app", "save button missing").
3. Want 5 and 6 (clean extraction, paywalled pages): test against Reader, Instapaper and Matter reviews about missing or garbled articles.
4. Want 8 (digest, no repeats) and want 22 (no surprise paywall): test against Instapaper's Feb 2026 reviews and the Reddit thread on the Kindle paywall.
5. Want 23 (Live-Paper ergonomics): test the "doomscrolling" claim against r/daylightcomputer and any DC-1 YouTube reviews.
6. Possible new wants to look for that no sibling file covers well: share-sheet "Send to" for people who have two or more devices (a pickable target), widget or Lock Screen button, duplicate warning after a retry, and what DC-1 owners do about EPUB and DRM-free book transfer. None is evidenced; they are leads only.

## 6. Features the Lab build should add (Needs tags)

This run adds none. Nothing here is evidence-backed, and I will not mark features "high value" on no evidence. The candidate list with Needs tags already exists in `community-voice.md` sections 1-2 (all 25 wants carry a Needs tag) and in the other sibling notes. Re-rank that list after the store-review pass in section 7.

## 7. Ready-to-run follow-up plan (about 35 standard searches, once budget and hosts are available)

Use `allowed_domains` on every query. Suggested sets: REDDIT = reddit.com plus any redlib mirror that earlier results returned (redlib.hbubli.cc, cal1.lr.ggtyler.dev); STORES = apps.apple.com, play.google.com, chromewebstore.google.com, addons.mozilla.org; FORUMS = news.ycombinator.com, mobileread.com, forums.macrumors.com, discourse hosts; VIDEO = youtube.com; REVIEW = trustpilot.com, justuseapp.com, chrome-stats.com, producthunt.com, g2.com.

(a) DC-1 owners (8 searches)
1. REDDIT: "daylightcomputer how do you get articles PDFs on your DC-1"
2. REDDIT: "daylightcomputer Readwise Reader OR Kindle OR Libby OR Instapaper app"
3. REDDIT: "daylightcomputer reader app page turn doomscrolling"
4. REDDIT: "daylightcomputer send to device from iPhone" and "daylightcomputer EPUB sideload"
5. FORUMS: "Thoughts on Daylight Computer" (HN 43098318) comments about reading and apps
6. VIDEO: "Daylight DC-1 review reading workflow" and "Daylight Computer Readwise" (descriptions and transcripts if reachable)
7. support.daylightcomputer.com: "Reader import PDF EPUB"
8. max.pm and lu.is: fetch the two reviews directly if their hosts open.

(b) Store reviews (about 20 searches, 2 per product-platform where text appears in results)
9-10. STORES: "Readwise Reader" iOS reviews; "Readwise Reader" Android com.readermobile reviews
11. STORES: "Readwise Highlighter" Chrome Web Store reviews
12-13. STORES + REDDIT: "Instapaper 10" redesign reviews (July 2026); "Instapaper Send to Kindle Premium February 2026" reaction
14. STORES: "Matter app" iOS and Android reviews
15. STORES: "GoodLinks" App Store reviews
16. STORES: "Karakeep" iOS and Android reviews
17-18. STORES + REDDIT: "Send to Kindle" Chrome extension reviews; Amazon "Send to Kindle" iOS / Android app reviews
19. STORES: "Read on reMarkable" Chrome extension reviews
20. STORES + REDDIT: "Send2Boox" and "BooxDrop" reviews
21. STORES: "Raindrop.io" iOS, Android and Chrome extension reviews
22-28. One REDDIT query per product: "<product> share extension slow OR broken", "<product> offline sync problems", "<product> alternative after paywall"
For each review record stars, date, app version (App Store RSS JSON https://itunes.apple.com/us/rss/customerreviews/page=1/id=<id>/sortby=mostrecent/json gives all three in one call if the host is allowed; Play shows the version in "What's new" and review dates).

(c) Claim checks (3 searches)
29. "Instapaper Send to Kindle premium announcement digest" on instapaper.com and blog.instapaper.com
30. REDDIT: "Instapaper Kindle digest premium" for the rep's reply and user reactions
31. STORES: Amazon "Send to Kindle for Google Chrome" newest 1-3 star reviews, plus REDDIT "Send to Kindle chrome extension not working"

(d) MobileRead (4 fetches, not searches)
32-35. Open the four threads and quote the posts with date and username: ?p=4545848, ?t=372113, ?p=4432915, ?p=4523064.

Then produce the per-product quote tables (up to 10 each, tagged OPENED or SNIPPET-ONLY), the platform theme table in section 4, and the confirm / contradict / new list for the 25 wants.
