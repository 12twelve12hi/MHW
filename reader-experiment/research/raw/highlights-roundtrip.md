# Return path and library management across devices (highlights round-trip, progress sync, remote queue, read status, offline, conflicts)

Researcher angle: getting highlights/notes from e-readers and reader apps back to phone/desktop (Kindle notebook, Readwise, reMarkable, Boox, Kobo, KOReader, Obsidian/Notion/Logseq plugins), reading-progress sync, seeing and managing the device queue from a phone, read status and "you finished X" notifications, offline behaviour, conflict handling. Written for "Send to Daylight" (companions -> Daylight DC-1 Inbox -> Daylight Reader).

Date of run: 2026-10-20. Author: research subagent (angle "highlights-roundtrip").

---

## 0. READ THIS FIRST: how this run was constrained, and what the evidence tiers mean

What I could NOT do (stated honestly so nobody over-trusts this file):

1. **WebSearch was unusable.** Every WebSearch call returned "this turn's web search budget is used up (limit: 200 WebSearch calls per turn, shared by every agent in it)". I did NOT work around it (no curl to search engines, no mirrors/proxies/archives).
2. **WebFetch only resolved `github.com` and `raw.githubusercontent.com`.** `getaddrinfo ENOTFOUND` for: hn.algolia.com, docs.readwise.io, readwise.io, support.remarkable.com, apps.apple.com, help.kobo.com, www.mobileread.com, en.wikipedia.org, www.youtube.com, forum.obsidian.md, daylightcomputer.com, codeberg.org, lobste.rs. So: **no Reddit, no HN, no MobileRead, no YouTube, no vendor docs, no app-store/Chrome-store reviews were readable by me.** (Sibling notes had reached some of those earlier; I reuse their lines where relevant, clearly tagged `[SIB]`.)
3. A Bash attempt to read the proxy status page was denied by the auto-mode classifier; I did not retry or work around it.
4. The GitHub MCP tool was scoped to the single repo `12twelve12hi/mhw`; `search_repositories` worked (public metadata), file/issue reads did not. I did not call `add_repo` (user did not ask). All repo/issue/README reading below was done with **WebFetch on public github.com pages**, which returns a small-model summary of the page (so long "quotes" are as relayed by the fetch tool; short quotes are marked in quotation marks and are as returned).

Consequence: this file is **strong on primary-source engineering evidence** (READMEs, issue threads, source code of KOReader, Obsidian/Readwise/Kobo/reMarkable/Boox/Supernote tooling), and **weak on end-user voice** (Reddit/HN/forum/review sentiment). Where I give user sentiment it is from GitHub issue authors (real users, but a self-selected technical population) or relayed from sibling notes.

Evidence tags used below:

| Tag | Meaning |
|---|---|
| `[README]` | I fetched the repo page / README on github.com this session (URL given). |
| `[ISSUE]` | I fetched a GitHub issue or issue list this session (URL given). Issue titles/numbers/dates are as shown by the page. |
| `[SRC]` | I fetched source code from raw.githubusercontent.com this session. |
| `[SEARCH-META]` | Repo metadata (stars, archived flag, topics, last update) from GitHub repo search, queried 2026-10-20. |
| `[SIB]` | Relayed from a sibling notes file in this folder (file + line given); I did NOT open the original URL. Medium trust. |
| `[INFER]` | My own inference. Low-to-medium trust. |

Context on the Daylight side (from `/home/user/MHW/reader-experiment/share/PROTOCOL.md`, local file, read this session): today the relay has an **inbox topic** (sender -> DC-1) and an **ack topic** (DC-1 -> sender, "kind":"ack","ids":[...]); items are E2E encrypted; ntfy keeps messages 12 h and attachments 3 h; the sender runs an outbox with statuses `sent`, `delivered`, `expired`, re-sends unacked items, and stops after 7 days. There is no return channel for opened/finished/progress/highlights yet. `[SIB]` `eink-tablets.md` lines 76-77 say the Reader has no library sync across devices yet, and highlights/notes leave only through the share sheet.

---

## 1. Landscape of products/projects examined (status as of 2026-10-20)

Metadata from `[SEARCH-META]` unless otherwise tagged.

### Official/commercial
- **Readwise + Readwise Reader**: highlights hub. Official Obsidian plugin (`readwiseio/obsidian-readwise`, GPL-3.0, "beta", 54 open issues at fetch), Logseq plugin (`readwiseio/logseq-readwise-official-plugin`, 33 open issues), Apple Notes exporter (`readwiseio/apple-notes-readwise`), a Readwise CLI (`readwiseio/readwise-cli`), a hosted MCP (the older local `readwiseio/readwise-mcp` is "deprecated"), and `readwiseio/readwise-skills` (agent skills: triage, feed-catchup, quiz, book-review, reader-recap, highlight-graph, now-reading-page). `[README]`
- **Amazon Kindle (Notebook, Send to Kindle, My Clippings.txt, Whispersync)**: evidence only through third-party tooling READMEs (hadynz/obsidian-kindle-plugin, l3a0/claude-plugins) and `[SIB]`.
- **Kobo Nickel**: highlights live in `KoboReader.sqlite`; extracted by desktop tools (October, obsidian-kobo-highlights-import, Kobo Utilities). Official Kobo help pages not reachable; `[SIB]` for Instapaper/notebook details.
- **reMarkable cloud + apps**: evidence via `rmfakecloud` parity table, `remarks`, `rmapi` (archived 2024-07-02), Scrybble, `Remarkable-Sync---Obsidian-Plugin`, `remarkable-mcp`.
- **Boox NeoReader**: evidence via Booxidian (`webline/onyx-boox-sync`) and `akosbalasko/Onyx-Boox-Annotation-Highlight-Extractor`; `[SIB]` for Tietze quote.
- **Supernote Digest**: evidence via `philips/readwise-supernote-digest`.
- **Instapaper / Kobo "My Articles" integration, Pocket (shut down 2025), Omnivore (cloud deprecated Nov 2024)**: `[SIB]` plus Omnivore README `[README]`.

### Open-source / community (the richest evidence)
- **KOReader** (30,452 stars; 1,391 open issues): kosync progress sync plugin, exporter plugin, wallabag plugin, Send2Ebook, Calibre wireless, cloud storage. `[SEARCH-META]`
- **Cross-device annotation sync plugins for KOReader**: `dani84bs/AnnotationSync.koplugin` (185 stars), `gitalexcampos/highlightsync.koplugin` (236 stars, "beta"), `d0nizam/syncery.koplugin` (36 stars, created 2026-06).
- **KOReader read-later/queue plugins**: `Endle/readwisereader` (Reader <-> KOReader), `iceyear/readeck.koplugin` (full sync + highlight sync), `flip-rossi/readeck.koplugin` (early), `ebanDev/instapaper.koplugin` (list only), core `wallabag.koplugin`.
- **Trackers**: `Billiam/hardcoverapp.koplugin` (458 stars), `Lyfts/ShelfSync` (42 stars; StoryGraph/Hardcover/Goodreads/Fable/Pagebound), `goodreads.koplugin` variants.
- **Bridges for Kobo**: `voidberg/instakobo` (Instapaper <-> Kobo kepub, progress+highlights back), `fkaduk/kobodeck` (Readeck <-> Kobo with read-status write-back), `eleith/readeckobo` `[SIB]`, `OGKevin/kobo.koplugin` (190 stars: bidirectional reading-state sync KOReader <-> Kobo).
- **Library servers with device sync**: Calibre-Web (Kobo sync, shelves), Calibre-Web-Automated (6,450 stars; Kobo sync + built-in KOSync), Komga (6,768 stars; Kobo Sync + KOReader Sync), `Sudashiii/Sake` (106 stars), KoInsight (633 stars; **archived**), KoShelf (254 stars; dashboard with annotation writeback), Readest (25,431 stars; cross-platform reader with KOReader progress sync).
- **Highlight pipelines**: `marcus-crane/october` (242 stars; Kobo -> Readwise), `OGKevin/obsidian-kobo-highlights-import`, `hadynz/obsidian-kindle-plugin` (1,285 stars), `Edo78/obsidian-koreader-sync` (123 stars), `justin-m-meijer/koreader-obsidian-sync` (KOSync-compatible server inside Obsidian), `noembryo/KoHighlights` (266 stars), `Unearthed-App/unearthed-koreader`, `danihrndzld/KOBridge` (macOS app, created 2026-10-12), `lucasrla/remarks` (399 stars), `Scrybbling-together/scrybble-site` (31 stars), `TimDommett/Remarkable-Sync---Obsidian-Plugin` (100 stars), `SamMorrowDrums/remarkable-mcp` (250 stars), `zachwick/rextract`, `philips/readwise-supernote-digest`, `webline/onyx-boox-sync`.
- **Event/notification bridges**: `hudsonbrendon/ha-koreader` (Home Assistant), `agaragou/errol.koplugin` (highlights -> Telegram/Discord with offline queue), `tristinbaker/ntfy.koplugin` (ntfy -> e-reader, created 2026-10-11), `HighLibrarian/BookKeeper.koplugin` (stats via webhook).
- **Read-later -> e-reader servers**: `brendanlefebvre/later-ink` (OPDS from Reader/Wallabag/Instapaper), `BandarLabs/Cobalt` (Kobo app SDK incl. Wallabag, Zotero, Syncthing apps), `daniel-j/send2ereader`, `cdhigh/KindleEar` (2,873 stars).
- **Zotero loop**: `michaelmior/zotero-remarkable` (one-way), `jlegewie/zotfile` ("currently not actively developed and maintained").

---

## 2. Findings by ecosystem

### 2.1 Kindle

- **Cloud notebook scraping is the standard path, and it is fragile.** The Obsidian Kindle plugin "will screen scrape your highlights from Amazon's Kindle Reader"; the Amazon route "will not work for highlights from books, articles, PDFs, and personal documents not purchased from Amazon" (so articles sent via Send to Kindle are out); the alternative is uploading `My Clippings.txt` from the device (works for any source). `[README]` https://github.com/hadynz/obsidian-kindle-plugin
- **Amazon caps/truncates exported highlights.** Plugin README: "Kindle export caps can truncate highlights, and the README says there is 'currently no known alternative to work around this.'" `[README]`. A separate Claude Code plugin quantifies it: of 2,733 highlights across five books, "1,038 that the export blocked (537 truncated and 501 fully hidden)"; notice text: "Some highlights have been hidden or truncated due to export limits" / "capped by a budget Amazon doesn't document and you can't raise"; it recovers them via the Mac Kindle app's "synced annotation database" plus OCR of Cloud Reader canvases. `[README]` https://github.com/l3a0/claude-plugins
- **Login scraping breaks.** Open issues on the Kindle plugin: #339 "[BUG] Amazon login loop broken", #337 "[BUG] Amazon login", #300 "Stopped syncing new highlights after indeterminate period", #288 "Application only syncs a subset of books", #334 "Flooded with duplicate entries", #315 "Book title differs from MyClippings.txt and cloud sync, creating duplicate notes", #285 "Don't Trim Whitespace around Highlight". `[ISSUE]` https://github.com/hadynz/obsidian-kindle-plugin/issues
- **Security trade-off is explicit**: logging in through Obsidian "exposes your Amazon session to other plugins until it expires". `[README]`
- **Send to Kindle is one-way for highlights**: Readwise's own docs say highlights made on Kindle on documents sent from Reader do not sync back. `[SIB]` `readwise-reader.md` line 106 (cites https://docs.readwise.io/reader/docs/faqs/exporting).
- Kindle Scribe: notebooks export as PDF by email or via the Kindle app; later firmware added export to Google Drive / OneDrive / OneNote. `[SIB]` `eink-tablets.md` lines 180-182. Community tools exist because on-device export is clumsy: `Cosipa/ScribeSync-Linux` ("Bash script to export Kindle Scribe Notebooks, through USB, as PDF and EPUB"), `lancekrogers/kindle-notes-sync` ("Export Kindle Scribe notebooks to GitHub from the device"), `Jenyk/scribe-local-export`. `[SEARCH-META]`
- Whispersync last-read position for personal documents: believed to work for converted docs, not for fixed-layout PDFs. `[SIB]` `send-to-kindle-kobo-pocketbook.md` line 109 (flagged "BG, unverified" there). Treat as unverified.

### 2.2 Kobo

- **Highlights are trapped in a SQLite file.** October README: "Kobo eReaders are somewhat notorious for not being user friendly to extract highlights off of." `[README]` https://github.com/marcus-crane/october
- **Obsidian Kobo importer is a manual USB workflow**: connect by cable, enable hidden files, locate `.kobo/KoboReader.sqlite`, run extraction. Highlight colours are numeric (0 yellow, 1 red, 2 blue, 3 green). `[README]` https://github.com/OGKevin/obsidian-kobo-highlights-import
- **October (Kobo -> Readwise) issues**: #151 "Nothing showing up on Readwise" (cause per maintainer: only highlights from sideloaded books upload unless a setting is enabled; also "database disk image is malformed (11)" which maintainer attributes to the Kobo, adding "I have manually repaired affected databases for other users"); #82/#86/#134/#120/#125 Readwise 400/500 errors; #142 crash on token validation; #139 "Kobo Highlights completely out of order" (maintainer: known issue, "fixable with a fair amount of work"); #144 "No Devices were found"; #155 "October not recognizing my Clara BW". `[ISSUE]` https://github.com/marcus-crane/october/issues , /151 , /139
- **Why Kobo order is wrong**: Discussion #70: Kobo stores VolumeID/ContentID/ChapterProgress/StartContainerPath/StartOffset; October sorted "by book title and chapter percentage" which ignores the chapter; ideal sort "VolumeID, ContentID, ChapterProgress, StartContainerPath and StartOffset"; there is "no page concept: Ebook pages change with font size"; "The only way to 'know' where highlights take place in a book is basically to parse the actual book". `[ISSUE]` https://github.com/marcus-crane/october/discussions/70
- **Kobo Utilities (Calibre) cannot back up annotations for Instapaper / Google Drive synced books**: "the annotations exist on the device but are unreachable through the current backup feature." `[ISSUE]` https://github.com/janlarres/kobo-utilities/issues/41
- **Kobo-Instapaper native integration limits**: only the main list syncs; tags, highlights, notes, videos, PDFs do not; folders and emailed-in items do not appear; one commenter went back to "KOreader and Wallabag". `[SIB]` `read-later-apps.md` line 46 and 180 (cites https://help.kobo.com/hc/en-us/articles/33359968957463).
- **Round-trip bridges**: InstaKobo "sync reading progress and highlights back to Instapaper": reads progress/highlights from `KoboReader.sqlite` via a private copy ("the device database is never touched"), archive+delete of finished articles is opt-in (`--archive`, `--delete`), "Highlights sync as text and position only. Kobo notes attached to highlights are not synced", `--limit` caps at 500 because Instapaper's list endpoint returns at most the 500 most recent. `[README]` https://github.com/voidberg/instakobo . kobodeck: "marks completed articles as read on Readeck, optionally archives them", downloads "unread and in-progress Readeck articles matching the configured filters as KEPUBs", triggers a library rescan via a simulated USB event; "Already downloaded articles are never refreshed"; favourites collection "will serve as ground truth and will override changes made to your favorites". `[README]` https://github.com/fkaduk/kobodeck
- **Kobo notebooks + 2026-09 data-loss incident**: `[SIB]` `eink-tablets.md` lines 214-216 (help.kobo.com article 43753873356055; Reader team turned it into "back up before every schema upgrade"). Not independently verified.
- **Bidirectional Kobo <-> KOReader reading-state plugin exists** (`kobo.koplugin`: "Bidirectional synchronization of reading progress between KOReader and Kobo"), 36 open issues. `[README]`

### 2.3 reMarkable

- **The cloud is the spine, and every third-party path breaks on updates.** `rmapi` archived 2024-07-02: "rMAPI is effectiviely unmaintaied at this point"; the new sync protocol had only "experimental support". `[README]` https://github.com/juruen/rmapi . `remarks` "does NOT work with annotations created by reMarkable software >= 3.0 yet", "highly experimental ... very likely to break after you update the software of your tablet"; open #58 "Upgrade to reMarkable 3.0", #77 "Deprecation of the project". `[README/ISSUE]` https://github.com/lucasrla/remarks . `rmfakecloud` "supports file synchronization up to reMarkable software 3.27.1", and "After an official update, the proxy and hosts file changes will be removed". `[README]` https://github.com/ddvk/rmfakecloud
- **What the official cloud does (from rmfakecloud's parity table)**: email sending, handwriting recognition (handwriting *search* not reimplemented), screen sharing, storage integrations (WebDAV/FTP supported; Dropbox/Google Drive WIP; OneDrive not supported), messaging via webhook, calendar (ICS), PIN reset, "Archive document to cloud". `[README]`
- **What users build for the return path**: `remarks` extracts "annotations (text highlights and scribbles)" to Markdown/PDF/PNG/SVG but does not talk to the tablet - you must first copy raw files via rsync/scp/rmapi/desktop-app dir; EPUB highlights not supported from the desktop-app dir. `[README]`. Scrybble (self-hostable, uses rmapi) syncs into Obsidian but "the Scrybble server needs to be running", reachable only via Docker + OAuth setup. `[README]` https://github.com/Scrybbling-together/scrybble-site . `Remarkable-Sync---Obsidian-Plugin` (100 stars): connects to reMarkable Cloud API with a one-time code, renders pen strokes "merges your annotations with the original PDF background" (nine pen types, 14 colours), only downloads changed documents, auto-sync off by default with a 5-minute interval, desktop-only. `[README]` https://github.com/TimDommett/Remarkable-Sync---Obsidian-Plugin . `rextract`: "A simple toolchain for moving Remarkable highlights to Readwise" - requires editing the token into `upload.py`, run by hand. `[README]` https://github.com/zachwick/rextract
- **remarkable-mcp**: four access modes; cloud mode "Requires a reMarkable Connect subscription"; SSH mode "requires developer mode, which the README says factory-resets the tablet when enabled"; reads "typed text, PDF and EPUB text, highlights, and annotations"; handwriting via OCR (Google Vision "Good handwriting support", 1,000 free requests/month then ~US$1.50 per 1,000, but sends data to a cloud; Tesseract offline but "performs poorly on handwriting"). `[README]` https://github.com/SamMorrowDrums/remarkable-mcp
- **Email-in**: `remailable` exists because "in my opinion it's a huge shortcoming of the ReMarkable ecosystem" that you cannot email documents Kindle-style; "Email binaries are deleted after 24 hours"; "Under 30MB please!". `[README]` https://github.com/remailable/remailable
- **Zotero loop is mostly one-way**: `zotero-remarkable` "removes files from the Zotero collection after upload" and says nothing about annotated PDFs returning; ZotFile "extracts annotations and highlighted text from many PDFs, but not all" (needs copyable text), "currently not actively developed and maintained!". `[README]`

### 2.4 Boox

- **Annotation export is a manual text-file dance**: on device open book -> TOC -> Annotations -> select all -> export icon -> local storage; then rename `.txt` to `.md`, move into the vault, long-tap "Extract Onyx file". Plugin creates Reference / Literature / Permanent notes. Roadmap admits: files go in vault root, no templates, hardcoded tags. `[README]` https://github.com/akosbalasko/Onyx-Boox-Annotation-Highlight-Extractor
- **Booxidian** (`webline/onyx-boox-sync`, created 2026-08-05): watches a folder; "Everything is deduplicated by content hash, so re-scanning a folder never creates duplicates"; transport options named: Syncthing ("peer-to-peer, no cloud, two-way ... recommends it"), BooxDrop, Dropbox/iCloud folder, USB; formats: reading-note highlights (firmware V1 and V2 layouts), handwriting PDFs (must be exported as Vector PDF, becomes SVG, optional transcription), annotated PDFs (copied with a companion note of highlights linked by page); `.note` files "deliberately **not** supported"; desktop only. `[README]` https://github.com/webline/onyx-boox-sync
- **User-voice, relayed**: Boox NeoReader "annotation export format is unusable for getting back to the highlighted location in another app" (Christian Tietze, 2023-05, https://christiantietze.de/posts/2023/05/boox-neoreader-annotation-export-is-meh/) and "laggy page switching on heavily annotated PDFs". `[SIB]` `eink-tablets.md` lines 145-148. I could not open the original.
- **Mac -> Boox without cloud**: `Boox-Send` sends Finder selections over Bluetooth Classic ("without a cloud service, internet connection, or cable"), resumable queue with SHA-256 verification, "never mirrors deletions", only tested on Go 10.3; "On the tested firmware, sleep can turn Bluetooth off, and an incoming transfer cannot wake it". `[README]` https://github.com/Toricicim/Boox-Send

### 2.5 Supernote

- Digest <-> Readwise plugin: Readwise highlights appear in Digest under a `Readwise` category; "Anything *you* save to Digest (not synced in from Readwise) can be exported back"; "The plugin calls Supernote's content provider directly ... undocumented by Supernote, reverse-engineered by decompiling the on-device APK"; export controls locked by default ("read-only mode is on by default"); "Notes highlights aren't exported yet." `[README]` https://github.com/philips/readwise-supernote-digest
- **Security lesson**: Supernote Obsidian plugin advisory GHSA-3gx3-r874-5pp4 (CVSS 5.6): device-supplied `uri` field "never validated against `name`", `..` segments not stripped, so a device on the LAN could create files outside the vault. Remediation: reject `..`/`.` segments, confirm path agrees with filename, use platform-safe path helpers at every write site. `[README]` https://github.com/squeeze440/supernote-obsidian-plugin-PoC

### 2.6 KOReader (the de-facto lab for sync semantics)

**Progress sync (kosync), from the plugin source** `[SRC]` https://raw.githubusercontent.com/koreader/koreader/master/plugins/kosync.koplugin/main.lua and wiki https://github.com/koreader/koreader/wiki/Progress-sync :
- Auto sync is **off by default**; when on it pulls on open and pushes on close, after N page turns (push is scheduled 10 s after the last page turn "to make debouncing this on skim feasible"), on suspend/resume/network events. Non-interactive calls debounced 25 s.
- Defaults `sync_forward = PROMPT`, `sync_backward = DISABLE`; each can be Silently / Prompt / Never. Code comment: "With an up-to-date Sync server, 'forward' means *newer*, not necessarily ahead in the document." Newer = server timestamp > last page-turn timestamp, else compare percentages.
- Uploads `document` digest, `progress`, `percentage`, `device`, `device_id` (+ optional filename/title/authors metadata). Skip if remote device_id equals this device.
- Failed uploads (non-401) go to a retry queue (`KOSyncQueue`).
- Document identity: "Binary. Only identical files will be kept in sync." (partial-MD5, default) vs "Filename. Files with matching names will be kept in sync."; the wiki: "does not send file name, or any file content, to the KOReader sync server".
- Known problems: **#16011** (open) newer timestamp can move you *backwards* ("there seems to be no way to express" never auto-rewind; contributors are working on "compare positions by page, show them in the sync dialog"); **#16104** (closed 2026-10-17 via PR #16153) the offline queue "drops items when the retry fails" - the drain removed items even on failure and a 100% "finished" position was among those lost; **#14527** (17 comments) auto-sync blocks on Wi-Fi scans: "I spend 45 seconds of that looking at Wifi popups", users read "~3 min at a time", and "I really only want the auto push, so I can spontaneously start reading on my phone" (i.e. wants push-auto / pull-manual); **#15902** (66 comments) the official sync server was down from Aug 19 2026: "The server is down for _everyone_", maintainer said a server tier "was cancelled by mistake"; pinned status still down on Sep 19; **#16242** proxy+https failure; **#15915** crash on login. `[ISSUE]` https://github.com/koreader/koreader/issues/16011 , /16104 , /14527 , /15902

**Highlight/annotation sync is NOT built in and has been the top ask since 2019:** #4587 "Synchronize highlights across separate KOReader devices" (open, 18 comments): "I tend to highlight quite a few passages, and then export those to Evernote"; maintainer Jan 2025: "Since that hasn't happened yet I'd say chances aren't good that'll change in the near future"; KOHighlights maintainer: no online sync because "it would require a server". #8447 asks to store position/highlights/bookmarks as separate files so Syncthing/Dropbox can sync them without conflicts: "metadata files contains fields that are different across devices" (absolute paths, font size) "it triggers unnecessary sync which may results in conflicts". #15182 server-side stats sync. #7143 "FR: Sync article annotations to Wallabag" (open since 2021-01; 10 comments; Aug 2026 bump: "really want to dive into KOReader for my annotating workflow!"; maintainers say translating the two annotation location formats "might be quite challenging"). `[ISSUE]` https://github.com/koreader/koreader/issues/4587 , /8447 , /15182 , /7143

**Highlight export plugin (core)** `[SRC]` https://raw.githubusercontent.com/koreader/koreader/master/plugins/exporter.koplugin/main.lua + wiki https://github.com/koreader/koreader/wiki/Highlight-export : targets Joplin, Nextcloud, Readwise, XMNote (Memos/Flomo "unsupported, will be removed soon"; Evernote deprecated); local HTML/JSON/Markdown/text/My Clippings; scopes current book / all history / selected files; filter by style/colour; "Remote targets wait until the device is online before exporting"; **no record of what was previously exported** - each run re-parses (dedup within a run only). "Upon exporting this plugin will export notes to all enabled targets" (footgun).

**Community plugins that fill the gap** (all `[README]`):
- `AnnotationSync.koplugin`: "Smart merging: Resolves conflicts by comparing update timestamps"; deleted annotations go to a trash bin ("AnnotationSync tracks deleted annotations so you can recover them", "Restore All"); "Sync All only pushes documents marked as changed on the local device. It does not pull"; settings stored in cleartext; progress sync needs KOReader 2026.07+. Issues `[ISSUE]` https://github.com/dani84bs/AnnotationSync.koplugin/issues : **#87 "False-positive deletions propagate to cloud + other devices -> silent annotation data loss"** (root cause: deletions inferred by diffing a last-synced base against current; "one new highlight producing 31 new deletions"; scan compared "coarse page numbers instead of actual positions"; guard only triggered when local was "completely empty"; reporter's proposal: "Require positive evidence of deletion"; fixed 2026-07-25), **#85** merge "purely additive" so deleting a device's progress entry "doesn't stick" (tracked in #90), #97 "Two unexplained sync hangs", #107 "UI freezes ~2s around page turns", #68 "Restoring over 1000 annotations is way too slow", #96 Manual Sync greyed out on Boox Go 7 + Dropbox.
- `highlightsync.koplugin`: combines offline highlights from different devices "without overwriting each other", newest timestamp wins for same-start edits; "Book names (or hashes ...) must match exactly across devices"; can "freeze the UI for a few seconds, and a document reload follows"; beta. Open requests: #13 "Sync Reading Status" ("Highlights and Reading Status are the only basic synchronisation I need across devices (2 only)"), #5 bulk-sync from the file browser, #17 automatic sync; crashes #30, #21, #39 "A KoReader update breaks the plugin", #18 sync errors on Boox, #36 Chinese filenames collide over WebDAV. `[ISSUE]` https://github.com/gitalexcampos/highlightsync.koplugin/issues , /13 , /5
- `syncery.koplugin` (design-forward, created 2026-06): progress last-write-wins; annotations "merged with a 3-way comparison and tombstone tracking" (local vs remote vs per-device ancestor copy); conflicts on same field "produce a conflict record, so data is preserved rather than overwritten"; reading status is the only field that can truly conflict - "Finished" and "On hold" are "incomparable", "surfaced for you to resolve, never dropped silently"; per-book Trash Bin; tombstone TTL default 90 days; Syncthing transport "eventually consistent" with possible conflict copies vs cloud transport "immediately consistent". Also syncs reading status, rating, collections, and optionally font/layout ("a size that's comfortable on a phone is wrong on a large e-reader"). `[README]` https://github.com/d0nizam/syncery.koplugin
- `KoHighlights` desktop utility: "Merge highlights/Sync position from the same book that is read in different devices"; archive DB; exports txt/html/csv/md. `[README]` https://github.com/noembryo/KoHighlights

**Read-later queue plugins (queue management semantics)**
- Core `wallabag.koplugin` `[SRC]` https://raw.githubusercontent.com/koreader/koreader/master/plugins/wallabag.koplugin/main.lua : syncs up to `articles_per_sync` (default 30); "no explicit sort"; finished/abandoned/100% articles can be "marked as read" (PATCH archive=1) or deleted remotely - **local action happens only after the remote call succeeds**; "Delete remotely archived and deleted articles locally" (also removes ones that fall off the list because of ignore-tags or the article limit - a footgun); offline queue holds **only added URLs** ("Archive and delete actions are not queued"); starring only filters downloads (no push).
- `Endle/readwisereader`: downloads Inbox/Later/Shortlist as HTML with images; "Articles you mark as finished in KOReader are archived in Reader at the next sync and removed from the device. Articles archived in Reader are deleted from KOReader during sync."; highlights export to Readwise optional/off by default, **one-way only** "because the Reader API lacks the location data KOReader needs"; each exported once keyed by article+exact text, "Later note edits are not sent, and deleting a highlight locally does not delete it in Reader"; "If any highlight export fails, the sync still downloads new articles but does not remove or archive local ones" (good safety rule); image-heavy files can crash KOReader. `[README]` https://github.com/Endle/readwisereader
- `iceyear/readeck.koplugin`: "Optionally archive or delete finished/100%-read articles in Readeck", local files removed only after server confirms; Readeck annotations imported as KOReader highlights and local highlights with notes+colours sent back, "Conflict handling is configurable, with merge as the default"; "if offline, links are stored in a queue and retried next time you're online". `[README]` https://github.com/iceyear/readeck.koplugin
- `later-ink`: Reader/Wallabag/Instapaper queue as an **OPDS** catalogue with folders "Later, New, Shortlist, Archive, Feed", articles converted to EPUB on request, "optional cache can keep EPUBs byte-identical across devices for reading-progress sync", and "It never writes back to Readwise, so articles stay in your queue as you read them". `[README]` https://github.com/brendanlefebvre/later-ink
- Library servers: Calibre-Web's Kobo sync: optional per-shelf mode "will archive all books which are not part of a synced shelf" (turning it on late removes books from devices); deleting a book in the web UI "will not cause it to be removed from the device" - archive first, then sync; progress shown only as Read/Unread; "After moving to a new device with the same sync token, run a forced full sync, or only new books will sync". `[README]` https://github.com/janeczku/calibre-web/wiki/Kobo-Integration . CWA: "Syncs KOReader -> CWA reading status -> Kobo devices"; roadmap item "More robust, cross-device progress syncing (single source of truth)" (i.e. not mature). `[README]` https://github.com/crocodilestick/Calibre-Web-Automated

### 2.7 Trackers and "finished" status

- `hardcoverapp.koplugin`: progress "no more than once per minute"; status Want/Reading/Read/DNF; auto-set "Read" when marked finished or on reaching end ("if KOReader shows a popup instead of marking the document finished, the plugin checks the status ten seconds later"); "Hardcover quote" item in the highlight menu creates a journal entry (note/quote, privacy, tags, spoiler); README **does not describe an offline queue**. `[README]` https://github.com/Billiam/hardcoverapp.koplugin
- `ShelfSync`: if offline "the book's latest progress is kept for up to 4 weeks and sent once the network is back"; manual statuses not queued; "Progress isn't sent when the service already has the book further along" (forward-only guard); Goodreads "always pushes forward" because it cannot report current position; unofficial session-cookie APIs "can break if they change their websites". `[README]` https://github.com/Lyfts/ShelfSync
- `ha-koreader` defines the cleanest **event vocabulary** for a "you finished X" feed: `session_started`, `session_ended`, `book_finished` (progress hits 100%), `book_changed`, `highlight_added`; sensors for progress, pages left, time-to-finish estimate, reading speed, estimated finish date; and the reverse direction `notify.koreader_notify` pushes text to the device screen. Honest limit: "commands only reach the device on its next check-in with WiFi on". `[README]` https://github.com/hudsonbrendon/ha-koreader
- `errol.koplugin`: highlights go to Telegram/Discord instantly if online else into a queue, background autosend every 15 min, "a queue manager lets you view, delete, or flush pending items", spoiler marking. `[README]` https://github.com/agaragou/errol.koplugin
- `ntfy.koplugin` (receive on e-ink): polling not streaming, "every 1-10 min, only while Wi-Fi is already connected", "never turns Wi-Fi on by itself", "Nothing runs while the device sleeps", catches up on wake, up to 3 toasts then one summary, last 50 kept. `[README]` https://github.com/tristinbaker/ntfy.koplugin
- Finding: **no product I could find pushes a "you finished X" notification to the phone itself**; finished status goes to trackers (Hardcover, StoryGraph, Goodreads) or to the source (Readeck/Wallabag/Reader archive). The closest is Home Assistant's `book_finished` event. `[INFER]` from absence in all fetched READMEs.

### 2.8 Readwise (hub) and the Obsidian/Notion/Logseq plugin pattern

- Official pitch for the Logseq plugin: "Take a highlight while reading in bed and wake up to the highlight in your Logseq graph"; Jinja2 templates; "cover images, original URLs, author names, chapter headings, and tags". Requires a paid Readwise subscription. `[README]` https://github.com/readwiseio/logseq-readwise-official-plugin , https://github.com/readwiseio/obsidian-readwise
- Official Obsidian plugin open issues (3 pages; first page read): **#100** (2026-08-28) "Long non-ASCII titles duplicate on every sync"; **#84** "Each highlight gets exported multiple times"; **#68** "Books disappear from `booksIDsMap` in `data.json`" (12 comments); **#80** "Sync fails after around 30-35 documents"; **#53** "Obsidian Sync wipes Readwise Highlights from vault" ("whenever Obsidian syncs, highlights are indexed out and deleted"; "If Obsidian Sync is paused, there is no issue"); **#83** "Highlight order seems random"; **#60** "Immediate Sync" request; **#81** "Save text in Obsidian as Readwise highlight". `[ISSUE]` https://github.com/readwiseio/obsidian-readwise/issues , /53
- Sibling-relayed Readwise facts (not re-opened): Obsidian export is "append-only", Feb 2026 can export entire article content; Reader Send to Kindle added Oct 2024 (daily/weekly digest); Kobo: Reader "can't yet be installed on Kobo"; Readwise-Kobo integration found "quite buggy" (MobileRead 2024); Reader complaints "archived items reappearing", "Home view capped at 20 items". `[SIB]` `readwise-reader.md` lines 87, 106-107, 141.
- Agent-era: `readwise-cli` has `reader-move-documents --location new|later|shortlist|archive`, `reader-export-documents --since-updated`, highlight tag/notes edit; the README tagline: "Anything you can do in Readwise/Reader, your agent can now do for you." `readwise-skills` `triage`: "Goes through your inbox one article at a time and says whether each is worth your time." `[README]` https://github.com/readwiseio/readwise-cli , https://github.com/readwiseio/readwise-skills
- Hub-and-spoke ecosystem (importers *into* Readwise and exporters *out*): see awesome-readwise list `[README]` https://github.com/Scarvy/awesome-readwise - Kindle (kindle2readwise), Kobo (kobo-to-readwise, kobo_readwise, kobwise, october), reMarkable (rextract), Supernote, Calibre plugin, Zotero2Readwise, Moon+ Reader export, Wallabag, Raindrop...; out to Obsidian, Logseq, Roam, Anki, RemNote, Tana, Mem, Ulysses, Craft, Notion-less list, plain Markdown directory, Datasette, S3.

### 2.9 Other "return path" desktop/mobile companions

- `KOBridge` (macOS+Linux; created 2026-10-12): manage KOReader on a jailbroken Kindle over SSH "without plugging in a cable"; scheduled backups of settings/stats/patches/highlight folders; "exports each book's highlights to Obsidian as a Markdown note, adding only new highlights on re-export"; drag ebooks onto the window to send; "no account, no analytics and no tracking". Direct evidence that people want a Mac companion for e-ink. `[README]` https://github.com/danihrndzld/KOBridge
- `Edo78/obsidian-koreader-sync`: USB-mounted path scan, one note per highlight, but "Sync deletes and recreates notes, so Obsidian edits to synced notes are lost. ... Consider yourself warned"; `keep_in_sync` false by default; `Reset Sync List` re-imports deleted notes. `[README]` https://github.com/Edo78/obsidian-koreader-sync
- `koreader-obsidian-sync` (justin-m-meijer): Obsidian runs a **KOSync-compatible HTTP server**, KOReader plugin sends highlights over Wi-Fi, one Markdown note per book, "Re-syncing updates the existing note and keeps edits you made in Obsidian"; limits: computer must be on and same Wi-Fi, "computer's IP address can change ... which breaks the connection", annotations only from the open book. `[README]` https://github.com/justin-m-meijer/koreader-obsidian-sync
- `Unearthed-App/unearthed-koreader`: "Latest highlights may be missing until you close the book, because KOReader doesn't update metadata until then"; local mode needs same network and breaks on IP change. `[README]`
- `KoShelf`: reading dashboard with "page-numbered PDF annotations", statistics heatmaps, and opt-in **writeback** ("Edit annotations, review notes, ratings, reading status, custom metadata, and covers"). `KoInsight` (kosync server + stats dashboard) is **archived**: "we've struggled to find the time and energy needed to continue its development". `[README]`
- `Cobalt` (Kobo app SDK): "Read Later" (Wallabag unread queue with reading times), "Stacks" (Zotero), "Sync" (Syncthing: "vault, frame and books receive, out sends"). `[README]` https://github.com/BandarLabs/Cobalt
- `Readest` issue titles show what multi-device app users hit: #6881 Syncing issue, #6664 "Book progress stuck on a specific page", #6623 "Library card progress percentage doesn't sync", #6326 "Last read page synchronisation doesn't happen if app is minimized and reopened", #6169 "stale file_path in the library store deletes the wrong book and merges books on upload", #6409 request to bind "push/pull reading progress now" to gestures, #6921 "Support bidirectional reading-progress sync and on-demand OPDS downloads" (complaint: app "automatically downloads all ebooks to the local device" and progress is "not bidirectionally synced"). `[ISSUE]` https://github.com/readest/readest/issues?q=is%3Aissue+sync+progress , /6921
- `Sake`: "Seamless background reading progress sync across devices, including notes and sidecar metadata"; books downloaded on button press "or when setting the device to sleep". `[README]`

---

## 3. Cross-cutting design lessons (the "what breaks" ledger turned into rules)

Each rule has the evidence that motivates it.

1. **Never infer deletion; require positive evidence (tombstones), and keep a trash bin.** AnnotationSync #87 (31 false deletions from one highlight, propagated to every device); Syncery uses a per-device ancestor copy + tombstones + trash bin + 90-day TTL; highlightsync deleted-by-moving-folder gotcha; additive-only merges (#85) mean "deleting a device entry doesn't stick". Choose explicit delete messages with ids, not diffs.
2. **Timestamps decide "newer", never "ahead".** KOSync #16011 backwards-moves. Keep the choice visible ("Continue at 62% (from Kindle, 3 min ago)? / Stay at 60%"), separate auto-push from auto-pull (#14527: "I really only want the auto push").
3. **Stable item identity beats file hashing.** KOReader needs "Binary vs Filename" matching and fails on re-rendered/re-converted copies; highlightsync requires names or hashes "must match exactly"; Readest #6169 stale paths merge books. Daylight creates the item id at send time; carry it through the Reader so every progress/highlight/status event is keyed by `item id` + a content hash.
4. **Offline queue must be durable, ordered, idempotent, and survive failed retries.** KOSync #16104 lost a 100% "finished" mark because the drain deleted items on failure; ShelfSync keeps latest progress 4 weeks; Errol shows a queue manager (view/delete/flush); wallabag plugin only queues added URLs, not archive/delete ("Archive and delete actions are not queued"). Queue *every* state transition, one entry per (item, kind) keeping the latest, drain one-at-a-time, delete only on confirmed success.
5. **Do the local destructive step only after the remote confirm, and abort cleanup when anything failed.** wallabag: local removal only after remote PATCH/DELETE succeeds; Endle: "If any highlight export fails, ... does not remove or archive local ones"; Readeck plugin: local files removed only after server confirms.
6. **Exports must be idempotent and must not clobber user edits.** Obsidian Kindle plugin: "Later syncs add new highlights without overwriting your edits" (loved); Edo78's plugin: "deletes and recreates notes ... Consider yourself warned" (feared); Booxidian "deduplicated by content hash"; KOBridge "adding only new highlights on re-export"; Readwise Obsidian duplicates #84/#100 show what happens when the id map breaks (non-ASCII titles, truncated paths). Use stable highlight ids + append-only blocks with a managed region.
7. **Order highlights by document position, and ship the anchor.** October #139: ordering by "chapter percentage" scrambled results; Kobo has no page concept; Readwise Obsidian #83 "Highlight order seems random". Export (chapter index, in-chapter offset or CFI/PDF page+bbox, plus context sentence), not just text. Boox's export is "unusable for getting back to the highlighted location" `[SIB]`; give each exported highlight a deep link back to the Reader.
8. **Treat names/paths from a peer device as hostile.** Supernote plugin CVE (path traversal via device-supplied `uri`). Our Inbox return channel and Mac "write to vault" feature must sanitise names, reject `..`, and write via a single safe-path helper.
9. **Do not require a server you do not control, and plan for the community server dying.** KOReader's official kosync/OTA servers were down 2026-08-19 to at least 2026-09-19 (#15902, 66 comments); rmapi archived; rmfakecloud lags OS releases; KoInsight archived; Pocket/Omnivore closures `[SIB]`. A relay-based design (ntfy) is also a dependency - keep the return events small and local-first so a relay outage degrades to "stale" not "lost".
10. **Be polite with Wi-Fi and the e-ink UI thread.** KOSync #14527 (45 s of Wi-Fi popups), AnnotationSync #107 (2 s UI freeze per page turn), highlightsync (UI freeze + doc reload), ntfy.koplugin ("never turns Wi-Fi on by itself", poll 1-10 min, nothing while asleep). Background, debounced, no modal popups; flush on sleep/close.
11. **Partial sync should state what is synced and what is not.** Kobo-Instapaper (no highlights/tags/folders), InstaKobo ("Kobo notes attached to highlights are not synced"), Endle (highlights one-way; "deleting a highlight locally does not delete it in Reader"), Supernote ("Notes highlights aren't exported yet"). Users forgive limits that are shown in the UI.
12. **Show the status to the human, not only to the trackers.** Everything above syncs status to servers; none pushes a human-readable "finished" to the phone - an opening.
13. **Local-first transport options reduce fear.** Boox-Send ("no cloud relay"), Booxidian recommending Syncthing ("peer-to-peer, no cloud, two-way"), KOBridge "no account, no analytics", koreader-obsidian-sync LAN server. But LAN-only has its own fragility (IP changes break it; device asleep).

---

## 4. Feature catalogue (also returned in the structured summary)

"Needs" legend: `companion-only` = phone/Mac/extension changes only; `companion+inbox` = also the Inbox app on the DC-1 (relay events/commands); `reader-change` = the Daylight Reader must expose/emit something; `server` = needs a small server.

| # | Feature | Value | Needs |
|---|---|---|---|
| 1 | Item lifecycle on the phone: sent -> delivered -> opened -> % read -> finished (+ push "Finished: X") | high | companion+inbox (+reader-change for opened/progress/finished) |
| 2 | Remote queue ("On your Daylight") with Read next / reorder / archive / remove-from-device / pin | high | companion+inbox (+reader-change for ordering) |
| 3 | Finish -> auto-archive loop and archive-on-phone -> removed-from-device (with safety rules) | high | companion+inbox / reader-change |
| 4 | Highlights and notes come home (Markdown/JSON, with anchors and deep links) | high | reader-change + companion+inbox |
| 5 | Highlight destinations from the Mac/phone: Obsidian vault folder, Readwise, Notion, Logseq, Apple Notes, Drive | high | companion-only (after #4) |
| 6 | Send annotated document / pen page back (flattened PDF/PNG) | high | reader-change + companion+inbox |
| 7 | Handwriting -> text (local OCR on Mac/iPhone) for ink pages and margin notes | medium | companion-only (after #6) |
| 8 | Reading-progress sync and "continue on phone" | medium | reader-change + companion+inbox |
| 9 | Durable offline queue with visible Outbox manager, retry, resend (both directions) | high | companion-only (+inbox for return) |
| 10 | Conflict-safe annotation sync with tombstones and trash bin (library sync) | medium | reader-change + server |
| 11 | Quote capture: instant highlight-to-phone, quote cards, Hardcover-style journal | medium | reader-change + companion+inbox |
| 12 | Daily highlight resurfacing (widget/notification) | medium | companion+inbox |
| 13 | Watched folders on Mac both ways (Send folder, Returns folder) | medium | companion-only (+inbox) |
| 14 | Mirror an existing read-later queue (Reader/Instapaper/Readeck/Wallabag) with write-back | medium | server / reader-change |
| 15 | Reading stats dashboard (time, pace, ETA, streaks) | low | reader-change + companion |
| 16 | Phone -> device nudges ("show message on device", reminder note on an item) | low | companion+inbox |
| 17 | Backup/snapshot before schema changes and export-everything button | medium | reader-change |

Details per feature (what, evidence, pitfalls, Daylight idea) are in the structured summary; the key evidence lines are above in section 2.

---

## 5. Top frustrations (ranked by how often they showed up in the evidence)

1. Highlights are trapped on the device and need a cable or hidden files: Kobo `KoboReader.sqlite` over USB (obsidian-kobo-highlights-import; October "notorious"), Boox `.txt` -> rename `.md` (Booxidian/Extractor), reMarkable needs rsync/ssh/dev mode (remarks; remarkable-mcp "factory-resets the tablet").
2. Everything is one-way: Send to Kindle -> no highlights back (`[SIB]`), Endle highlights one-way, Kobo-Instapaper no highlights, later.ink "never writes back", zotero-remarkable one-way.
3. Third-party glue breaks on every vendor update: remarks (>= 3.0), rmapi archived, rmfakecloud (<= 3.27.1), Kindle login loop (#339/#337), hardcover/Goodreads unofficial APIs, Kobo re-syncs config and overwrites custom endpoint `[SIB]`.
4. Export caps and lossy exports: Kindle truncation/hidden (1,038 of 2,733), Boox export "unusable for getting back to the highlighted location" `[SIB]`, Kobo order scrambled (#139), Supernote notes-highlights not exported.
5. Duplicates and "my edits got wiped": Readwise Obsidian #84/#100, Kindle plugin #334/#315, Edo78 "deletes and recreates", Obsidian Sync wiping highlights (#53), books vanish from `booksIDsMap` (#68).
6. Deletion/consistency bugs: AnnotationSync #87 silent data loss; additive merges can't delete (#85); wallabag plugin deletes everything that falls off the 30-article list; Calibre-Web deletion does not remove from device.
7. Sync blocks reading: KOSync Wi-Fi popups (#14527), UI freezes (#107, highlightsync), session-start delays.
8. Offline queues that lose data: KOSync #16104 lost a "finished" mark; wallabag queue only add-URL; Hardcover plugin no queue; manual statuses unqueued in ShelfSync.
9. Single-point-of-failure servers: KOReader sync server down for weeks (#15902); Scrybble needs server up; koreader-obsidian-sync needs the computer on + same LAN + stable IP.
10. No built-in cross-device highlight sync in the most open reader after 7 years (#4587 open since 2019).
11. Can't see or manage what is on the device from the phone: Calibre-Web "deleting does not remove from device"; no phone view of device queue found anywhere (`[INFER]`); remote control needs next check-in with Wi-Fi on (ha-koreader).
12. Paid walls and privacy trade-offs: Readwise plugins "requires a subscription"; remarkable-mcp cloud mode needs Connect; cloud OCR sends handwriting off-device; Kindle login exposes session to other plugins.

---

## 6. Gaps in this file / what a networked follow-up should verify

Priority list (none of these could be fetched by me):
1. **Reddit** threads: r/readwise, r/kobo, r/kindle, r/kindlescribe, r/Boox, r/RemarkableTablet, r/koreader, r/ObsidianMD ("highlights" + "sync" + "export"), r/daylightcomputer. Need verbatim user love/hate and upvote counts.
2. **Hacker News** (via https://hn.algolia.com/api/v1/search?query=...): "Readwise", "kindle highlights", "Omnivore", "Pocket shutdown", "reMarkable", "Boox", "KOReader".
3. **Official docs**: docs.readwise.io (Kindle/Kobo/reMarkable/Obsidian exporting pages), Amazon help (Send to Kindle, Notebook export, Whispersync, Scribe), help.kobo.com (notebook export, Instapaper, data-loss incident 43753873356055), support.remarkable.com ("Read on reMarkable", integrations, handwriting conversion), help.boox.com (Push/BooxDrop/export), Supernote Digest docs.
4. **Reviews**: Chrome Web Store (Readwise Highlighter, Send to Kindle, Read on reMarkable), App Store reviews of Readwise Reader/Instapaper/Kindle/Kobo companion apps, to quantify "highlights don't sync" complaints.
5. **YouTube**: Obsidian + Readwise + e-reader workflows (e.g. "Kindle highlights to Obsidian", "KOReader sync"), to see which return-path features get demoed.
6. **MobileRead** threads on KOReader/Kobo highlight export and Instapaper-on-Kobo.
7. The unresolved facts flagged `[SIB]`/`[INFER]` above, especially: Kindle Whispersync for personal docs, Kobo 2026-09 incident, whether any product has a phone-side view of the device queue.
8. GitHub items I did not open: AnnotationSync #90, #97; KOReader #9815, #4670, PR #13372 (the nightly "highlight sync" helper hius07 mentioned in #4587); Readest `.../wiki` KOSync page; hardcoverapp.koplugin issues; `kobo.koplugin` docs at https://ogkevin.github.io/kobo.koplugin; Komga/CWA docs for exact sync semantics.

---

## 7. Source index (every URL actually fetched or relied on)

Fetched this session (github.com / raw.githubusercontent.com):
- https://github.com/readwiseio/obsidian-readwise , /issues , /issues/53
- https://github.com/readwiseio , https://github.com/readwiseio/readwise-cli , /readwise-skills , /readwise-mcp , /logseq-readwise-official-plugin
- https://github.com/Scarvy/awesome-readwise
- https://github.com/koreader/koreader/wiki , /wiki/Progress-sync , /wiki/Highlight-export , /wiki/Wallabag
- https://raw.githubusercontent.com/koreader/koreader/master/plugins/kosync.koplugin/main.lua
- https://raw.githubusercontent.com/koreader/koreader/master/plugins/exporter.koplugin/main.lua
- https://raw.githubusercontent.com/koreader/koreader/master/plugins/wallabag.koplugin/main.lua
- https://github.com/koreader/koreader/issues/4587 , /8447 , /7143 , /11147(list only) , /14527 , /15182 , /15902 , /16011 , /16104 ; issue-list pages `?q=is:issue sync highlights across devices`, `?q=is:issue kosync`, `sort:reactions-+1-desc sync`
- https://github.com/OGKevin/obsidian-kobo-highlights-import ; https://github.com/OGKevin/kobo.koplugin
- https://github.com/hadynz/obsidian-kindle-plugin , /issues
- https://github.com/marcus-crane/october , /issues , /issues/139 , /issues/151 , /discussions/70
- https://github.com/janlarres/kobo-utilities , /issues/41
- https://github.com/voidberg/instakobo ; https://github.com/fkaduk/kobodeck
- https://github.com/Endle/readwisereader ; https://github.com/iceyear/readeck.koplugin ; https://github.com/flip-rossi/readeck.koplugin ; https://github.com/ebanDev/instapaper.koplugin
- https://github.com/brendanlefebvre/later-ink
- https://github.com/dani84bs/AnnotationSync.koplugin , /issues?q=is:issue , /issues/87 , /issues/85
- https://github.com/gitalexcampos/highlightsync.koplugin , /issues , /issues/13 , /issues/5
- https://github.com/d0nizam/syncery.koplugin
- https://github.com/noembryo/KoHighlights ; https://github.com/paviro/KoShelf ; https://github.com/Ko-Insight/KoInsight
- https://github.com/Billiam/hardcoverapp.koplugin ; https://github.com/Lyfts/ShelfSync
- https://github.com/hudsonbrendon/ha-koreader ; https://github.com/agaragou/errol.koplugin ; https://github.com/tristinbaker/ntfy.koplugin
- https://github.com/justin-m-meijer/koreader-obsidian-sync ; https://github.com/Edo78/obsidian-koreader-sync ; https://github.com/Unearthed-App/unearthed-koreader ; https://github.com/danihrndzld/KOBridge
- https://github.com/lucasrla/remarks , /issues ; https://github.com/juruen/rmapi ; https://github.com/ddvk/rmfakecloud ; https://github.com/Scrybbling-together/scrybble-site ; https://github.com/TimDommett/Remarkable-Sync---Obsidian-Plugin ; https://github.com/SamMorrowDrums/remarkable-mcp ; https://github.com/zachwick/rextract ; https://github.com/remailable/remailable ; https://github.com/michaelmior/zotero-remarkable ; https://github.com/jlegewie/zotfile
- https://github.com/akosbalasko/Onyx-Boox-Annotation-Highlight-Extractor ; https://github.com/webline/onyx-boox-sync ; https://github.com/Toricicim/Boox-Send
- https://github.com/philips/readwise-supernote-digest ; https://github.com/squeeze440/supernote-obsidian-plugin-PoC
- https://github.com/janeczku/calibre-web/wiki/Kobo-Integration ; https://github.com/crocodilestick/Calibre-Web-Automated ; https://github.com/gotson/komga ; https://github.com/Sudashiii/Sake
- https://github.com/readest/readest , /issues?q=is:issue sync progress , /issues/6921
- https://github.com/BandarLabs/Cobalt ; https://github.com/daniel-j/send2ereader ; https://github.com/cdhigh/KindleEar
- https://github.com/omnivore-app/omnivore ; https://github.com/omnivore-app/obsidian-omnivore
- https://github.com/l3a0/claude-plugins

Repo search metadata (queried via GitHub search_repositories on 2026-10-20): topic:koreader, topic:remarkable-tablet, topic:kindle-highlights, topic:kobo, topic:readwise, topic:boox, `kosync server`, `zotero remarkable`, `send to kindle`, `hardcover koreader`, `kindle scribe notebook export`, `supernote obsidian sync`, `remarkable obsidian plugin`, `koreader highlights obsidian`, `topic:koreader-plugin sync`, `koreader ntfy|webhook|telegram`.

Relayed from sibling notes in `/home/user/MHW/reader-experiment/research/raw/` (originals NOT opened by me):
- `read-later-apps.md` lines 46, 126, 144, 180, 197 (Kobo-Instapaper limits https://help.kobo.com/hc/en-us/articles/33359968957463 ; Pocket timeline https://support.mozilla.org/en-US/kb/future-of-pocket ; readeckobo https://codeberg.org/eleith/readeckobo ; kobodeck https://pkg.go.dev/github.com/fkaduk/kobodeck ; wallabako)
- `readwise-reader.md` lines 87, 105-107, 141 (https://docs.readwise.io/reader/docs/faqs/exporting ; r/readwise Kobo thread https://redlib.hbubli.cc/r/readwise/comments/1jka4uh/kobo_reader_integration ; MobileRead https://mobileread.com/forums/showthread.php?p=4432915)
- `eink-tablets.md` lines 145-148 (Tietze https://christiantietze.de/posts/2023/05/boox-neoreader-annotation-export-is-meh/ ; Boox community https://help.boox.com/hc/en-us/community/posts/34857991656724-Page-switching-slow-on-large-heavily-annotated-pdfs), 180-182 (Scribe export), 214-216 (Kobo notebooks, 2026-09 incident https://help.kobo.com/hc/en-us/articles/43753873356055)
- `send-to-kindle-kobo-pocketbook.md` lines 109, 115-116, 120 (Whispersync [unverified]; bookorbit#1732 https://github.com/bookorbit/bookorbit/issues/1732 "It would be amazing if I could bypass the need for Instapaper or a dedicated server")
- Local: `/home/user/MHW/reader-experiment/share/PROTOCOL.md` (inbox/ack topics, outbox statuses).
