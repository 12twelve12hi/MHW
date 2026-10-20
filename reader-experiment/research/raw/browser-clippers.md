# Browser extensions and clippers: raw research notes

Angle: browser extensions / web clippers as a model for the "Lab" feature set of Send to Daylight (Chrome + Safari extensions, Mac app, iPhone/Android share flows, Inbox on the DC-1).
Products in scope: Readwise Reader extension, Instapaper, Raindrop, Notion Web Clipper, Evernote Web Clipper, Obsidian Web Clipper, MarkDownload, SingleFile, Save to Pocket (legacy), Send to Kindle for Chrome, Read on reMarkable, Kindle/Kobo third-party pushers, Zotero Connector (+ Omnivore, Karakeep, Linkwarden, linkding, Wallabagger, Hypothesis, Memex, Matter, GoodLinks, Joplin as comparison points).
Compiled: 2026-10-20 (session date).

---------------------------------------------------------------------------
## 0. READ FIRST: research conditions and how far to trust this file
---------------------------------------------------------------------------

What worked and what did not (so the lead can judge coverage):

- WebSearch: the shared per-turn web-search budget (200 calls across all agents) was already exhausted when I started. All 5 of my first searches returned "web search budget is used up". I did NOT work around it (no curl to search engines, no third-party readers/proxies/archives). I also chose NOT to use the Hacker News Algolia API (hn.algolia.com) even though the task text suggested it, because it is a search engine and the harness rule says not to query search engines to get around the limit. If the lead wants HN/Reddit/YouTube voice, that needs a follow-up run with budget (see section 8).
- WebFetch: only a few hosts resolve here. WORKING: github.com (repo pages, READMEs, releases, issue threads incl. comments, issue list pages), raw.githubusercontent.com (docs repos), gitlab.com (landing only). NOT WORKING (`getaddrinfo ENOTFOUND`): help.obsidian.md, obsidian.md, docs.readwise.io, readwise.io, chromewebstore.google.com, addons.mozilla.org, apps.apple.com, play.google.com, en.wikipedia.org, www.zotero.org, help.raindrop.io, support.remarkable.com, www.mobileread.com, www.youtube.com, developer.chrome.com. npmjs.com answered 403.
- GitHub MCP: `search_issues` and `search_repositories` work on ANY public repo (semantic matching, with reaction counts); `get_file_contents` and `issue_read` are locked to the session repo only. So I read issue threads with WebFetch on github.com instead.
- Bash: an attempt to read the proxy README was denied by the permission classifier; I did not retry.
- Consequence: store reviews (Chrome Web Store, AMO, App Store, Play), Reddit, HN, YouTube, MobileRead were NOT readable by me. The "what users say" evidence in this file is therefore mostly GitHub issue threads (feature requests with reaction counts, bug reports, maintainer replies), which is real user voice but skewed toward power users of open-source tools. For the closed-source products (Readwise, Instapaper, Raindrop, Matter, Notion, Evernote, Amazon Send to Kindle, Read on reMarkable, legacy Pocket) I rely on:
  - [SIB] sibling notes already in this folder, which were themselves built from search snippets (their own provenance caveats apply; I did not independently verify): `/home/user/MHW/reader-experiment/research/raw/read-later-apps.md`, `readwise-reader.md`, `send-to-kindle-kobo-pocketbook.md`, `eink-tablets.md`.
  - [BG] my own background knowledge, explicitly labelled with a confidence (LOW/MED). Treat BG as hypotheses to re-verify, not facts.

Provenance tags used below:
- [DOC-GH] product documentation or README that I read myself on github.com / raw.githubusercontent.com (what the product claims to do).
- [REL-GH] GitHub release notes I read myself.
- [ISSUE] GitHub issue/PR thread I read myself (user voice and maintainer replies); issue numbers are given so they can be opened.
- [SIB] relayed from a sibling notes file (not verified by me).
- [BG-LOW] / [BG-MED] background knowledge, unverified this session.
- WebFetch returns a small-model summary of each page, so quotes inside quotation marks are short strings the summary reproduced; treat exact wording as "as relayed by WebFetch" unless I say I saw it in full.

Dates: Obsidian Web Clipper release pages show day+month only (no year); given the issue timestamps (e.g. v1.7.1 reports from iOS 27 era) I treat them as 2026.

---------------------------------------------------------------------------
## 1. Product inventory (status as of 2026-10-20)
---------------------------------------------------------------------------

| Product | Platforms (as far as verified) | Status | Best known for |
|---|---|---|---|
| Obsidian Web Clipper | Chrome/Chromium (Brave, Arc, Orion...), Firefox desktop + Android, Safari macOS/iOS/iPadOS, Edge. Free, open source (MIT-style, github.com/obsidianmd/obsidian-clipper). v1.7.1 (Jul 2026) | Very active (10 releases Apr-Jul 2026) | Templates + triggers per site, in-page Highlighter that persists, Reader mode, YouTube transcript UI, AI "Interpreter", no telemetry |
| Defuddle / Mozilla Readability / percollate | libraries/CLI | Defuddle 0.19.5 (10 Oct 2026), very active | The extraction engines behind clippers; site extractors (X, YouTube, Reddit, HN, GitHub, Substack...) |
| SingleFile | Chrome, Firefox desktop+mobile, Edge, Safari macOS+iOS, Vivaldi, Brave, Opera... | Active (issues dated Sep 2026) | Faithful single-HTML snapshot of the whole rendered page; save tabs in bulk; auto-save |
| MarkDownload | Firefox, Chrome, Edge, Safari | Maintained slowly (issues 2020-2024 mostly) | Page/selection/tabs to Markdown with preview + templates, Obsidian handoff |
| Zotero Connector | Chrome, Firefox, Edge, Safari | Active (2025 popup features shipped) | Site "translators" for structured metadata; save popup with collection/tags/note |
| Omnivore (extension) | Chrome, Firefox, Edge, Safari | DEAD: hosted service shut 15 Nov 2024 (ElevenLabs acqui-hire); code open source | Label-at-save, highlight-from-web, keyboard-first save [SIB] |
| Karakeep (ex-Hoarder) extension | Chrome, Firefox, Safari | Active | Self-hosted; duplicate-aware popup; "already saved" badge shipped Nov 2025; SingleFile mode |
| Linkwarden / linkding / Wallabagger | browser extensions | Active | Archive formats (screenshot+PDF+single HTML), tags, paywalled page content send (Wallabagger) |
| Hypothesis / Memex | Chrome (Hypothesis), Memex Chrome/Firefox + Memex Go mobile | Active | Annotating the live web / PDFs; Memex E2E-encrypted sync |
| Readwise Reader extension ("Readwise Highlighter"; "Save to Reader" for Safari) | Chrome/Chromium, Firefox, Safari (Mac) | Active [SIB] | Save bar (tags, note, move), auto-highlight, rendered-DOM capture (logged-in/paywalled) |
| Instapaper extension | Chrome/Arc/Edge, Firefox, Safari | Active; new web app + Instapaper 10 iOS (Jul 2026); Kindle sends Premium-only since Feb 2026 [SIB] | Banner after save with tags/folder/archive, highlights on the web, Send to Kindle |
| Raindrop.io extension | Chrome, Firefox, Safari, Edge, Opera | Active [SIB] | One-click mode, collection + tag suggestions, "Unsorted" inbox, already-saved checkmark |
| Matter | iOS/iPad/web + Chrome/Safari/Firefox extensions (no Android) | Active [SIB] | Save behind paywalls via signed-in page, QR pairing, bulk send to Kindle as one ebook |
| GoodLinks | iOS/iPadOS/macOS/Vision + Safari/Chrome/Arc/Edge/Brave ext | Active (4.1 on 12 Oct 2026) [SIB] | Quick Save, URL scheme, Shortcuts |
| Save to Pocket (legacy) | Chrome/Firefox/Safari extensions | DEAD: announced 22 May 2025, service ended 8 Jul 2025, data deleted 8 Oct 2025 [SIB] | Frictionless one-click + huge ecosystem (Kobo, IFTTT) |
| Notion Web Clipper | Chrome, Firefox, Safari | Active [BG-MED] | Destination (page/database) + properties picker in popup |
| Evernote Web Clipper | Chrome, Firefox, Safari, Edge | Active (Bending Spoons-era) [BG-MED] | The 5-mode picker: Article / Simplified article / Full page / Bookmark / Screenshot; notebook + tags + remark |
| Joplin Web Clipper | Chrome, Firefox | Active | Open-source clone of Evernote's modes; talks to desktop app over a local service [DOC-GH partial] |
| Send to Kindle for Chrome (Amazon) | Chrome | Active but reported flaky [BG-MED + kindle-send-chrome README] | Official one-click article to Kindle; pain: auth endpoints, MV3 CORB/CORS issues |
| Read on reMarkable (official) | Chrome/Chromium | Active (since ~2021) | Two paths: toolbar = article as reflowable text/EPUB; print dialog destination = fixed PDF |
| Third-party Kindle/Kobo pushers | See section 2.11 | Many new in 2026 | kindle-send-chrome, Web to Kindle, web2kindle, KindBeamer, TabTome, content-collector, send2ereader |
| Third-party reMarkable pushers | See section 2.12 | New in Sep-Oct 2026 | send-to-remarkable (pencil block selection), read-on-rmfakecloud |

---------------------------------------------------------------------------
## 2. Per-product evidence
---------------------------------------------------------------------------

### 2.1 Obsidian Web Clipper (the most complete modern clipper; best evidence base)

DOC (raw docs from https://github.com/obsidianmd/obsidian-help , folder `en/Obsidian Web Clipper/`: Introduction, Clip web pages, Highlighter, Reader, Interpreter, Templates, Variables, Filters, Logic, Troubleshoot). Files read via https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Obsidian%20Web%20Clipper/<name>.md :

- Intro: "a free browser extension that lets you highlight pages and save web content to your vault." Privacy: "Your data is not collected, and we do not gather any usage metrics." Open source. Platforms: Chromium browsers, Firefox desktop and mobile, Safari on macOS/iOS/iPadOS, Edge.
- Clip web pages: three entry points: toolbar icon, context menu, keyboard shortcuts. Defaults: Open clipper = Cmd/Ctrl+Shift+O; Quick clip = Opt/Alt+Shift+O; remappable in Web Clipper Settings > General, except Safari: "Safari does not support editing hotkeys." Content precedence: selected text wins; else highlights; else the active custom template; else "tries to extract only the main article content". Ctrl/Cmd+A to select whole page. Destination footer: Vault dropdown + Folder field. Images stay linked to web URLs (not downloaded) unless you run a command afterwards.
- Highlighter: works on live pages and in Reader; activated by toolbar icon, a customizable shortcut (Alt+Shift+H per issue #609), or right-click. "Once Highlighter turned is on, any selected text, images, and elements will be added to your highlights." "Highlights are saved so you can see them when you return to a page." Three output behaviours for `{{content}}`: highlight in place with ==markup==, replace content with only the highlights list, or ignore. Highlights page (Settings > Highlighter) is searchable; export as .json.
- Reader: strips clutter; shows title/author/date/domain; sidebar outline for multi-heading articles; footnotes as popovers; font, size, line height, line width, theme, light/dark, custom CSS; can be the one-click default open behaviour (General > Behavior > Open behavior).
- Interpreter (AI): `{{"natural language prompt"}}` variables; ~dozen preset providers + custom + Ollama; "Interpreter requests are sent directly to the provider you choose" and Obsidian "does not gather or store any data about your requests"; default context is whole page HTML (narrow with a selector variable for cost/speed); "Ollama's context window defaults to 2048 tokens"; docs recommend small models because "they are faster".
- Templates: triggers by URL prefix, regex, or schema.org value; first matching template wins so put the fallback at the top; behaviours: create note, append/prepend to a note, daily note top/bottom; import/export as .json.
- Variables: `title, author, content, contentHtml, fullHtml, selection, selectionHtml, highlights, date, published, time, description, domain, url, site, favicon, image, language, words`, plus meta:, selector:, selectorHtml:, schema: groups. (The YouTube `{{transcript}}` variable exists but is not in this doc; see issue #785.)
- Troubleshoot: extraction is by Defuddle which "can be overly conservative and remove content that you want to keep"; workaround = select text / select all / highlight / write a custom template. Linux: if clipboard access is missing use Legacy mode which "will bypass the clipboard and save content directly via URI" but caps clip length.
- README: https://github.com/obsidianmd/obsidian-clipper - "Anything you save is stored as durable Markdown files that you can read offline." Roadmap items named: annotate highlights, template directory, template validation, template logic, save images locally, sync settings across browsers.

RELEASES [REL-GH] https://github.com/obsidianmd/obsidian-clipper/releases (day+month only):
- 1.3.0 (02 Apr): Reader customization (typography, themes, custom CSS); threaded comment UI for Reddit and Hacker News in Reader; Defuddle 0.15; Safari clipboard-copy fix.
- 1.4.0 (09 Apr): "YouTube transcript UI" with interactive transcript, scrubbing, auto-scroll; "Open in Reader" as a default open behaviour.
- 1.5.0 (15 Apr): new Highlights viewer; fade-in transition to Reader; YouTube play/pause improvement; CJK line-ending fix.
- 1.6.0 (21 Apr): "Highlighter improves UX and adds better support for mobile"; new extractors LinkedIn, Threads, Bluesky, Discourse, Medium. 1.6.1: better highlight search. 1.6.2: Safari embedded-mode clipboard fix.
- 1.7.0 (16 Jun): "Highlights now persist across live pages and Reader"; fixed missing ==markers== in `{{content}}`.
- 1.7.1 (22 Jul): "Import highlights" (this is the thing #111 asked for, 11 thumbs-up + 4 rockets); `{{model}}`, `{{modelId}}`, `{{modelProvider}}`.

USER VOICE [ISSUE] (open-source tracker, so heavy-user skew; all https://github.com/obsidianmd/obsidian-clipper/issues/N):
- #174 "Sync settings across browsers (for highlights, etc)" - top open issue by reactions (17 thumbs-up, 10 comments). polarhive: use native browser sync like uBlock Origin; "annoying to import `.json` files on FF Mobile". kepano (maintainer): "Unfortunately I don't think there is enough space to account for both highlights and templates in browser sync storage." Real fix would be Obsidian-account-based. ooloth: "Safari templates don't sync across their Mac, iPhone, and iPad, so they must update each device manually." Vault-based storage rejected: needs major file permission, impossible on iOS; "No, browser extensions cannot receive data that way."
- #181 "Annotate highlights" (opened by kepano; 14 thumbs-up; labels enhancement/help wanted). Format proposal: `> Highlight content` then the annotation. Comment themes: annotate in-page at selection time; treat annotation as the parent concept (clehene, Feb 2026, has a `notes[]` prototype); per-highlight comments on live pages + clean Markdown export (abhushansahu, Jul 2026). #865 is a detailed implementation proposal: inline annotation card at selection (fixed centered overlay, not cursor-anchored, "works identically across desktop and mobile"), popup becomes a staging area that holds pending highlights until commit, avoid APIs unavailable on Firefox Android (menus, sidebarAction, storage.sync).
- #268 "Options for Colour Highlights": "Green Highlights - Conclusive Facts / Yellow - Examples / Blue - Questions / Pink - The Premium post-it note worthy quote. Underlines - Titles / Subtitles" and "Currently, I'm using glasp.co and exporting out per webpage .md files weekly for this purpose."
- #180 Quick-clip after more highlights duplicates earlier highlights ("it adds all highlights (including the ones that are previously saved)"); user wants to comment while highlighting.
- #696 Highlighter shortcut looks saved but disappears on refresh while right-click "Add to highlights" persists. #707 overlays fail on pages with namespaced XPath (nLab). #943 on some doc sites only headings are highlightable, not paragraphs. #285 "Clip Highlights" button dead in Vivaldi. #609 "Clip highlights" fails in browser full-screen ("Browser window has no toolbar"). Lesson: live-web highlights anchored by XPath are brittle.
- #112 "Indicate if the current URL is referenced in Obsidian": crmfyi wants a badge/link to the existing note. kepano: "Data will be pushed into Obsidian, but the extension cannot access data in Obsidian." writtenfool: "I would not want, at anytime, for a web app to have access to my local app." Lighter idea (CarcajadaArtificial): local list of clipped URLs to warn on duplicates; kepano: the clipper log stores URLs but cannot reliably link to a note that may be renamed/moved/deleted. Still open.
- #264 "Save full Twitter/X threads": clipper saves only tweets currently loaded; reporter got first 4 of a 7-tweet thread, or the last 3 after scrolling. kepano: it can "only capture content loaded in the DOM"; suggested auto-scrolling or API (X may not allow). Still open.
- #188 "Clip screenshots" (blocked-upstream). Use cases: journalists archiving a headline as evidence; hawkeye2nd: browser screenshot to clipboard held "in a pending state" and written on save.
- #646 "Support clipping PDFs": "I'd like to clip a lot of PDFs from arxiv"; MaelImhof: just save the PDF in the vault and create a note with metadata + link (about 10 thumbs-up); aussetg: the extension passes data via clipboard so whole PDFs would mean "sending huge base64 encoded PDFs"; a dedicated save path might work on desktop but not mobile.
- #472 "Quick Clip shortcut should respect save behavior" (6 thumbs-up); ras0q wants one shortcut to save and another to copy to clipboard (per-shortcut behaviour). #945 'Copy to Clipboard' as a per-template action.
- #83 "Support saving articles opened in several tabs": "It would be great if one can also click the icon to select and save several articles in several tabs into Obsidian." (2 thumbs-up, open).
- #984 double-trigger creates two notes: clicking the button and pressing the quick-clip shortcut within ~500 ms writes duplicates (no in-flight guard).
- #744 After 'Save file...' in Zen/Safari "there's no visual indication/change that it has worked" - user wants the dialog dismissed on success.
- #184 want a shortcut to open the side panel (right-click "Open Side Panel" exists). #575 option to open embedded (in-page iframe) mode by default (closed). #572 Safari: blank popup also opens when embedded mode is on.
- Extraction failures: #484 "Note ... is empty at all of our local newspaper articles" (Firefox); #949 Safari "Unable to initialize page content: null is not an object (evaluating 'item[\"@type\"]')" (JSON-LD parse crash); #546 highlights not saved when the template uses `{{selectorHtml}}` instead of `{{content}}`; #550 code-block language lost in HTML-to-Markdown.
- YouTube transcript pains: #957 (5 comments) "YouTube transcripts are always saved in English when the video has an auto-dubbed English caption track" - reporter's data: English transcripts rose from ~2% of clips before 4 Sep to 54% after; mice3nyc: browser-language fallback would break for foreign-video watchers; want "the transcript in the video's original spoken language". Also #991, #942, #826 (Simplified vs Traditional Chinese). #785: `{{transcript}}` timestamps are plain bold text; want clickable `[0:00](https://youtube...&t=)` links. #774/#775: Reader mode YouTube showed a frozen frame / black screen in Chrome/Brave. Defuddle 0.19.4 (17 Sep) changed to "prefer the default caption language over translations".
- Mobile/Safari pains (relevant to our Safari extension): #306 Safari asks "Do you want to allow this website to open 'Obsidian.app'?" on every click of Add to Obsidian; user wants "Always Allow" (approval is per site, so each new domain re-prompts; some users left Safari). #345 "This page cannot be clipped" appears when another pinned tab (Gmail) lacks extension permission; unpinning fixes. #850 no right-click "add to highlights" in Safari (present in Arc). #634 iOS 27: the top blue checkmark merely dismisses without saving; with the keyboard open the real save button is hidden; user "dismiss[es], rather than save[s]" often. #815/#213/#997 blank/empty popup on iOS/iPadOS Safari. #703 "Save file" on a pinned Safari tab opens a data: URL tab instead of saving. #509 "Add to Obsidian" button pushed out of view by a long description.

### 2.2 Defuddle, Readability, percollate (extraction engines)

- Defuddle [DOC-GH] https://github.com/kepano/defuddle : "takes a URL or HTML, finds the main content, and returns cleaned HTML or Markdown"; built for the Obsidian clipper; vs Readability: "more forgiving and 'removes fewer uncertain elements'", consistent output for footnotes/math/code, uses a page's mobile styles to spot clutter, extracts more metadata incl. schema.org. Options: markdown, removeImages, includeReplies, contentSelector (override auto-detect), language, useAsync (async extractors may call third-party APIs such as FxTwitter for X Articles when HTML lacks content), debug (returns removals). README warns "Beware! Defuddle is very much a work in progress!". Site extractors in `src/extractors` (https://github.com/kepano/defuddle/tree/main/src/extractors): bilibili, bluesky, c2-wiki, chatgpt, claude, discourse, gemini, github, gmail, grok, hackernews, leetcode, linkedin, lwn, mastodon, medium, nytimes, reddit, substack, threads, twitter, wikipedia, x-article, x-oembed, youtube.
- Defuddle releases [REL-GH] https://github.com/kepano/defuddle/releases : 0.19.5 (10 Oct 2026) lazy-loaded image URL fix, async extractors can run before body fallback; 0.19.4 YouTube default caption language; 0.19.0 Bilibili transcripts, ChatGPT citations, X articles async; 0.18.0 LinkedIn/Threads/Bluesky/Discourse/Medium; 0.17.0 YouTube transcript break points + CJK, HN home page; 0.16.0 X inline images, Substack. Paywall handling: not mentioned.
- Mozilla Readability [DOC-GH] https://github.com/mozilla/readability : parse() mutates the DOM so pass a clone; `isProbablyReaderable(document)` is a cheap pre-check (false positives/negatives); `charThreshold` default 500; output title, byline, dir, lang, siteName, publishedTime, excerpt, content, textContent, length; does NOT sanitize (use DOMPurify). Used by SingleFile's reader features, send-to-remarkable, kindle-send-chrome, Web to Kindle, KindBeamer, percollate.
- percollate [DOC-GH] https://github.com/danburzo/percollate : web pages to PDF/EPUB/HTML/Markdown via Readability; "To bundle several web pages into a single PDF, specify them as separate arguments"; `--individual`, `--toc`, `--cover`, `--title/--author`, `--css/--style/--template`, `--inline` (base64 images), RSS/Atom input, `--wait`. Limits per README: "Readability will not be perfect in each case"; print CSS only partially implemented; JS-rendered content/paywalls not addressed (pages fetched with node-fetch).

### 2.3 SingleFile (faithful full-page snapshot)

[DOC-GH] https://github.com/gildas-lormeau/SingleFile (README), https://github.com/gildas-lormeau/SingleFile/blob/main/faq.md , https://github.com/gildas-lormeau/SingleFile/blob/main/known-issues.md
- "Web Extension for saving a faithful copy of a complete web page in a single HTML file." Chrome, Firefox (desktop+mobile), Edge, Safari (macOS+iOS), Vivaldi, Brave, Waterfox, Yandex, Opera.
- Modes: save current tab; selected content; a selected frame (context menu); several tabs at once: selected, unpinned, or all tabs; click again to cancel. Auto-save for current tab / unpinned / all tabs "every time after being loaded". "Annotate and save the page" (highlight text, notes, remove content). Default shortcut Ctrl+Shift+Y (customizable). Destinations: Google Drive, GitHub (README), plus WebDAV/REST/S3 requested or present per issues. Output: single HTML (minified, unused styles removed) or self-extracting ZIP; user scripts before/after save; CLI exists.
- FAQ: scripts removed by default ("can alter the rendering"); "Images > save deferred images" option handles lazy images but costs time; default configuration "optimized to produce small pages"; slow devices can disable "remove hidden elements", "remove unused styles", "remove frames".
- Known issues: cannot save chrome.google.com / addons.mozilla.org; sandboxed iframes in Firefox; canvas/video snapshots limited by CORS; Safari/iOS options live in Settings > Safari > Extensions > SingleFile (answer in #1764).
- Infinite scroll: #1931 (Instagram) closed "not planned" Aug 2026 with maintainer: "SingleFile can only save what is present in the page" (sites that unload off-screen content; suggestion: the zoom-out option "can help"). #1987: full-page capture of a long scrolled page left scrolled-through content blank. #1402: "Range Error: invalid string length" crashes on very large pages.
- Feature requests (https://github.com/gildas-lormeau/SingleFile/issues/N): #1389 save to multiple destinations at once (7 reactions; maintainer: "possible from a technical point of view" but needs refactoring; users want a per-save override, profiles hide the menu item if only one profile exists, macOS users bind one shortcut per profile with Keysmith); #1567 "save print version"; #1215 shortcut/icon action for Save selection (maintainer: "I agree that's a desirable feature"); #1308 more remote destinations (20 comments); #1404 copy/open the resulting URL after saving to GitHub; #1788 auto-saving bookmarked pages replays on other devices via Firefox Sync and creates "duplicate saved pages ... useless as the other device may not even be signed in" (cross-device auto-capture pitfall).

### 2.4 MarkDownload

[DOC-GH] https://github.com/deathau/markdownload and https://raw.githubusercontent.com/deathau/markdownload/master/user-guide.md
- Popup shows rendered Markdown that you can edit, copy, or download; page is first run through Readability; select text before opening popup to clip only the selection ("Download Selected").
- Front/back templates with variables `{title} {pageTitle} {length} {excerpt} {byline} {dir} {baseURI} {date:FORMAT} {keywords} {og:image}`; title template sets filename; "Download All Tabs" (needs all-sites permission).
- Default shortcut Alt+Shift+M ("Download Tab as Markdown"). Context menu: download tab / selection / all tabs; copy tab or selection as Markdown; copy tab URL or selected tabs as Markdown link(s); copy link as Markdown (on links); copy image as Markdown (on images); toggle front/back template.
- Images: Downloads API only (not Safari) - folder per article, image-style options (original, strip, pure Markdown, Obsidian embeds). Obsidian handoff: right-click "Send Tab to Obsidian" (needs Advanced Obsidian URI plugin).
- Quick-save lesson [ISSUE] https://github.com/deathau/markdownload/issues/21 : a user wanted "Quick save button - save file in default location"; maintainer: browsers only allow Save As or default downloads and an extension cannot list the file system ("a potential security issue"); solved by a title template with slashes (subfolder of Downloads) and Alt+Shift+M then Enter. Other requests: #72 "Copy Tab URL as Markdown Link as a Keyboard Shortcut" (3 thumbs-up), #82 append to a single file, #206 send to previous Obsidian note, #297 trigger on every page visited, #219 include tags, #18 multi-coloured highlights.

### 2.5 Zotero Connector

[DOC-GH] https://github.com/zotero/zotero-connectors : "Chrome, Firefox, Edge, and Safari extensions for Zotero." Injected scripts run "translators" to detect structured items on a page; items go to the desktop app over its local connector server (port 23119); "If Zotero isn't available, saving falls back to the zotero.org web API"; SingleFile is bundled for snapshots.
[ISSUE] save-popup features shipped in 2025: #310 tag autocomplete in the save popup (users had asked for a "drop-down list of existing tags in web clipper a la Evernote"; PR #529 merged 16 Jun 2025); #376 note field in the save progress window (dstillman: "a three-line text area that gets turned into a child note might be nice"; PR #533 merged 11 Jun 2025). #206 (open since 2017) "Connector save options (snapshot, PDF, automatic tags)" - comment of 4 Sep 2024: toggling these before each save is worse than choosing them in the save popup. #481 use a hidden browser to take snapshots for multi-item saves.
Lesson: the same three save-time controls keep winning over years (destination, tags with autocomplete, short note) and users want them in the confirmation popup, not buried in settings.

### 2.6 Omnivore extension (dead product, instructive tracker)

Product status [SIB read-later-apps.md section 10]: team joined ElevenLabs 29 Oct 2024; hosted service shut 15 Nov 2024; code stays open source.
[ISSUE] https://github.com/omnivore-app/omnivore/issues/N
- #2747 "Browser Extension: Hint for already added pages" (13 thumbs-up, highest on extension): cites Raindrop's checkmark and wants clicking to open the existing item for notes/tags rather than re-adding (which reset the added date). Privacy debate: kquinsland01 wants the plugin to pull known URLs rather than send each tab's URL to a server, proposes hashing URLs (k-anonymity) and a 10-240 minute refresh; maintainer jacksonh liked the hashing idea and did not want a persistent connection per extension. Closed "not planned" 25 Aug 2026 in a batch cleanup.
- #2366 labels: "While saving a new page/pdf, there is no option to create a new tag which isnt already created." Shipped Firefox first (Sep 2023), then Chrome/Edge/Safari after store review (closed Dec 2023). #3228 label managing; #3870 sort labels by frequency.
- #2817 highlight directly from a website: "select text on a website and right-click 'Save highlight to Omnivore'" without saving the page first. Shipped as a "kind of a hidden feature" (Oct 2023). mdbraber: "Would love to help testing as this is my exact workflow." HealsCodes (Apr 2024): sharing just a highlight on iOS is "the last missing piece of their mobile read-it-later workflow".
- #3143 [feature request]: "It is not supported to save via context menu just like Pocket or readerwise extension." Maintainer's answer: "the simplest way to save with the extension is the keyboard shortcut" (Chrome: Manage Extensions > Keyboard Shortcuts); asks that the confirmation popup auto-dismiss after ~5 s. #903: right-click on a link "Save to Omnivore" (contexts: link) shipped Sep 2022. #3335 "Chrome extension requires extra click to save a link". #2984 option to sync browser bookmarks. #2664 "chrome support read now instantly".

### 2.7 Karakeep (ex-Hoarder), Linkwarden, linkding, Wallabagger, Hypothesis, Memex

- Karakeep [DOC-GH] https://github.com/karakeep-app/karakeep : save links, notes, images, PDFs; full-page archival with Monolith; video archiving via yt-dlp; OCR; RSS auto-import; Chrome/Firefox/Safari extensions + iOS/Android apps with offline reading; LLM auto-tagging (Ollama supported); rules engine; highlights; REST API + CLI; importers (Chrome, Pocket, Linkwarden, Omnivore, Tab Session Manager).
  [ISSUE] https://github.com/karakeep-app/karakeep/issues/N : #486 "Show 'hoarded' status on addon icon" (7 thumbs-up): "cannot quickly determine if the page you are currently on is already hoarded"; maintainer first refused ("querying Hoarder for every page visited") then approved (May 2025) only as "optional in the extension settings"; proposal "create a local cache, which could be checked instead of querying hoarder directly"; closed as completed 3 Nov 2025 (PR #1745 "tab bookmark badge indicator"; also a count-badge setting). #49 avoid duplicate bookmarks (shipped v0.14, May 2024): web app warns and offers to open; extension "shows the existing bookmark with its tags and lists"; mobile shows a message; maintainer: "deduping exact URLs is a good start". #1167 "Allow chrome extension to share cookies for the current tab with the backend" (6 thumbs-up, open, untriaged): wants per-tab opt-in upload of cookies so the server's Puppeteer can scrape logged-in/paywalled pages; the SingleFile workaround exists; maintainer doubted extensions can read cookies. #2831 per-URL rule to choose SingleFile capture vs standard server crawl (SingleFile gives no PDF/screenshot; standard retrieval gives accurate screenshots and PDFs). #2795 and #1710 bookmark all tabs in the window ("Raindrop-style Tab-Bankruptcy ... put them in a specific folder / a new folder with the date or just dump in home"). #3082 show the existing bookmark when current URL is already saved. #2421 create new list from the extension. #1174 context-menu "Add to Hoarder" on an image saves the image, not the parent page ("the larger context such as the parent page ... is lost").
- Linkwarden [DOC-GH] https://github.com/linkwarden/linkwarden : auto-captures "a screenshot, PDF, and single html file of each webpage" (+ optional Wayback), reader view "with the ability to highlight and annotate text", collections/sub-collections/tags, local AI tagging, RSS, upload from SingleFile, native iOS/Android apps.
- linkding [DOC-GH] https://github.com/sissbruecker/linkding : auto-fills title/description/icon, tags, bulk edit, "read it later", archive as local HTML or Internet Archive, sharing, Firefox+Chrome extensions + bookmarklet.
- Wallabagger [DOC-GH] https://github.com/wallabag/wallabagger : saves current page and "can send content from a paywalled page to wallabag" (i.e. client-sends-rendered-content), edit title, tags with autocomplete, star/archive/delete from the popup. Requests: #334 show proposed tag after three letters instead of auto-adding (to allow new tag creation), #499 show keyboard shortcuts on the settings page, #445 bulk re-fetch.
- Hypothesis [DOC-GH] https://github.com/hypothesis/browser-extension : extension is mostly a wrapper around the Hypothesis client that annotates web documents and PDFs (README lists no feature detail).
- Memex [DOC-GH excerpt] https://github.com/WorldBrain/Memex : notes on whole sites and components (text/images), bookmarks/tags/lists "on the fly", tab manager to "add all open tabs to a collection or tag", full-text search of annotated pages and PDFs, mobile "Memex Go", "Sync is end2end encrypted with TweetNaCl".

### 2.8 Readwise Reader extension [SIB; none of this verified by me]

From `/home/user/MHW/reader-experiment/research/raw/readwise-reader.md` section 2.1 (docs relayed by search snippets; DOC URL https://docs.readwise.io/reader/docs/saving-content):
- Toolbar click or Alt+R (rebindable). Docs call it "the most robust way to save" because it captures what the browser rendered, so logged-in/paywalled pages work.
- After saving, a bar offers tags, a document note ("why you saved it / who recommended it"), and a dropdown to move the doc (e.g. straight to Archive); bar can be collapsed. Default destination is the first Library section.
- Auto-highlighting is ON by default: any text selected on the page becomes a highlight (can be turned off); highlights sync out to Obsidian/Notion/Logseq.
- Safari uses a separate free Mac App Store app "Save to Reader". Chrome "Readwise Highlighter" ~4.2/5 from ~60 reviews; Firefox ~4.4 from 16 ratings (tracker numbers); AMO reviews complained about data collection, mandatory login, Wikipedia highlighting issues after an update, Manifest V2 still on Firefox.
- Mobile caveat: "Saving from Safari is the best way to save documents to Reader on mobile because iOS gives our app access to the underlying content in addition to the URL"; other apps may hand over a bare URL and get a truncated parse.
- Filter syntax records how each doc was saved (iOS share sheet, Android share sheet, extension...).
- Demand signals for rendered-DOM capture: BYK's "Readwise Full Content" Firefox add-on re-opens thin saves in a background tab with your logged-in session and pushes full HTML back. NEW (my own find) https://github.com/FelixHuoEZ/readwise-save-translated : a Chrome extension (Apr 2026) that saves the browser-TRANSLATED DOM to Reader because letting Readwise re-fetch the URL loses the translation; left-click saves immediately, right-click opens secondary actions, per-tab badge shows success/error, detects an existing document; admits it "cannot save the translated content reliably" if the translation tool only changes pixels, not the DOM.
- Sept 25 2026 changelog: saving an already-saved page re-parses it and keeps the older version if the new parse is worse.

### 2.9 Instapaper, Raindrop, Matter, GoodLinks, Pocket [SIB, not verified by me]

From `/home/user/MHW/reader-experiment/research/raw/read-later-apps.md`:
- Instapaper (sec. 1): extension click shows a banner confirming the save and lets you add tags, move to a folder, or archive "without leaving the page"; extensions updated (Chrome incl. Arc/Edge, Firefox, Safari) to add highlighting on any web page, archive-after-save and Send to Kindle (https://blog.instapaper.com/post/752995536017178624/bringing-highlights-to-the-open-web); bookmarklet sends the page HTML from the user's browser so login-gated pages work (Marco Arment design, via waldo.jaquith.org). Kindle: single-article send and scheduled digests became Premium-only on 19 Feb 2026. Third-party Chrome extensions exist because the official one is thin; the official Firefox add-on was removed Jan 2024 and its reviews complained "Ctrl+I conflicts with italics in editors". Free-tier digest complaint (MobileRead): "it includes the same articles in the daily packages lots of times".
- Raindrop (sec. 4): click extension > pick collection > optional tags > save; "one-click mode" sends to Unsorted or last-used collection; extension suggests collections and AI tags; "Unsorted" is the built-in inbox. Chrome store ~4.1-4.2 stars, ~787 ratings, 400-500k users; praise: ease of use, tag-based finding, link-status check; complaints: "popup slow to open, save button missing, 'buggy'", AI organisation "were not useful and setup took more time than expected". HN: "a great and very polished bookmarking app, but it does not feel like a real Pocket replacement"; macOS save flow "clunky".
- Matter (sec. 2): QR-code pairing for the Chrome extension; "Save behind paywalls" (extensions send the page you are signed in to; Chrome review: "It handles paywalled articles better than any other extension I've tried."); Send to Kindle from extension; bulk send "merges the articles into an ebook, with each article as its own chapter"; "some users see occasional delays before new saves appear when syncing across devices"; Mac share extension "broken on and off again".
- GoodLinks (sec. 3): Safari extension default Cmd+Shift+S; Chrome/Arc/Edge/Opera/Brave extension with remappable shortcut; share extension "Quick Save" skips the editor; URL scheme `goodlinks://x-callback-url/save?...&quick=1`.
- Pocket (sec. 9): dead 8 Jul 2025; "Save to Pocket" was built into other apps; users angriest about deletion deadlines, dying integrations (Kobo), long-tolerated unreliability. BG-LOW: the Pocket extension saved instantly on click, then showed a popup with tag suggestions and an add-tag field, plus right-click "Save to Pocket" on pages/links.

### 2.10 Notion Web Clipper and Evernote Web Clipper [BG only, could not reach docs/reviews]

- Evernote [BG-MED]: clip-type picker in the popup: Article, Simplified article, Full page, Bookmark, Screenshot (PDF when viewing a PDF; Selection when text is selected; email clipping in webmail). Popup lets you pick notebook, add tags, add a "remark" (comment). Screenshot mode has markup tools (arrows, text, highlight, pixelate). Zotero users literally asked for "a drop-down list of existing tags in web clipper a la Evernote" (see 2.5, [ISSUE] #310), which corroborates Evernote's tag dropdown. Joplin's clipper copies the same menu.
- Notion [BG-MED/LOW]: popup to choose destination (page or database), edit title and database properties, then Save; historically saves a bookmark (title, URL, preview image/description) rather than the article body, which is a common complaint. Verify before relying on it.
- Joplin Web Clipper [DOC-GH partial] https://raw.githubusercontent.com/laurent22/joplin/dev/readme/apps/clipper.md : "allows you to save web pages and screenshots"; talks to the desktop app via a local service the app starts (firewall/proxy troubleshooting) - same pattern as Zotero. Mode names (simplified page, complete page, selection, screenshot, URL) are BG-MED. Joplin issue #135 "Request: Web Clipper Extension + Integration" had 20 thumbs-up; #1576 "Web Clipping from Mobile" 5.

### 2.11 Send to Kindle for Chrome (Amazon) and Kindle/Kobo pushers

Official extension [BG-LOW + README claims]: sign in with Amazon account, send article/selection/link/PDF to chosen Kindle devices or library, article preview. Hard facts I do have: https://github.com/AALAM98mod100/send-to-kindle-firefox (unofficial Firefox port README) says the official extension needs the user to be logged in to amazon.com in the same browser (cookie-based), uses hardcoded chrome-extension:// URLs, 29 locales, `incognito: split`. https://github.com/manabubannai/kindle-send-chrome (created 29 Jun 2026) calls the official one "buggy" and says it "breaks because it depends on Amazon's authenticated web endpoints" and has "CORB/CORS issues under Manifest V3, and frequent backend changes". The sibling file notes Amazon moved delivery to a new Kindle Docs API on 12 Oct 2026 breaking community clients (send-to-kindle-kobo-pocketbook.md 2.6).

Third-party browser-extension pushers (all [DOC-GH], read by me):
- kindle-send-chrome https://github.com/manabubannai/kindle-send-chrome : Mozilla Readability; emails EPUB to @kindle.com via the author's relay (Vercel + Gmail SMTP; no OAuth/DNS needed); "opening the popup queues the current tab as a background job"; 3-minute guard against accidental resends and a review step for unreviewed failures; OS notifications on failure, toolbar badge counts, activity list; watchdog for jobs orphaned when Chrome kills the service worker; X/Twitter thread extractor that "collects the author's consecutive posts into one EPUB"; resolves lazy-load image attrs (data-src, srcset, <picture>); fetches images in the service worker to dodge CORS; WebP/AVIF to JPEG ("Kindle's converter can't render WebP"); images capped at 1600 px, JPEG q0.75; relay limit 4.5 MB so largest images are dropped if needed; 50 MB Kindle email limit; local EPUB download as last-resort fallback; planned: multi-tab bundling.
- chrome-kindle-sender "Web to Kindle" https://github.com/sirbrasscat/chrome-kindle-sender : MV3; Readability reader-mode capture to EPUB 3 "with typography suited to e-ink screens"; crawls online books/docs ("Recursively discovers Table of Contents / chapter links" on GitBook, Sphinx, Docusaurus, mdBook) into one EPUB; delivery via Resend/SendGrid/Brevo/Mailgun or a self-hosted relay; right-click "Send Page to Kindle" or Ctrl+Shift+K (Cmd+Shift+K); popup shows word count, reading time, reader preview, dark/light.
- web2kindle https://github.com/megaconfidence/web2kindle : one click, Readability, server builds EPUB (or PDF to keep layout), emailed from web2kindle@confidence.sh (sender must be on the Kindle approved list); Kindle email stored locally in the browser; "No account, ads, or tracking"; docs cached up to 7 days (Cloudflare Workflows + Resend).
- KindBeamer https://github.com/jooray/kindbeamer : app + extension that talks to Amazon's own Send to Kindle HTTP service (OAuth PKCE; each install registers as a device) instead of email; extension sends only article text + images, or a PDF open in the browser as-is; images re-encoded and scaled to <=1600 px; can save EPUB to disk instead; needs "all sites" permission to fetch cross-site images ("images are left out if you decline"); "Amazon may change or block the undocumented API at any time".
- TabTome https://github.com/akakybzdynia-boop/tabtome (Aug-Sep 2026): Firefox/Chrome extension + local Windows app; "one or up to 25 tabs in one EPUB book" with per-tab results; pasted text mode (up to 1,000,000 chars); content comes from the already-open page so "logins and JavaScript-rendered content work"; choose Kindle or PocketBook; save locally without SMTP; context menu "Send to e-reader" for page or selection; up to 30 images / 15 MB per send, EPUB > 18 MB rejected before SMTP; "no images" mode; WebP/AVIF/SVG converted; results kept 8 days and de-duplicated by `jobId`; video/forms/original styles not carried over.
- content-collector https://github.com/JoanClaverol/content-collector (Jul 2026): collect several pages into ONE draft (side panel or Alt+Shift+A, toolbar badge shows count), per-section cards with word count/reading time/image count, drag to reorder, rename, delete, full-panel text editor "remove leftover blocks with one click each", image width 25/50/75/100%, generated cover + TOC + per-page chapters, builds EPUB in browser with JSZip, no server/telemetry/accounts, drafts persist locally. Limits: hotlink-protected images skipped; cannot run on browser-internal/store/PDF-viewer pages. User then uploads via Send to Kindle app.
- Sibling coverage of send2ereader, kindle-send CLI, KindleEar, Calibre, KOReader plugins: send-to-kindle-kobo-pocketbook.md sections 6.x.

### 2.12 Read on reMarkable (official) and clones

- Official [ISSUE, reverse-engineered by users] https://github.com/ddvk/rmfakecloud/issues/67 ("Feature Request: 'Read on Remarkable' functionality", 31 comments, closed 27 Sep 2024): the extension offers two send paths: (1) a "Read on reMarkable" printer destination in the browser print dialog that sends the page as PDF; (2) clicking the toolbar icon sends the page "as text" which the cloud renders as EPUB; an Extension options page has a "Send as text" setting. Pairing = one-time code from the cloud. Uploads POST to `/doc/v1/files`, later `/doc/v2/files`. murchu27: PDFs "show up on my tablet almost instantly". Complaints from people patching it: errors "don't produce any logs in the console", minified background.js, CORS on the pairing request, "Printing failed. Please check the printer." Official support article (not fetched): https://support.remarkable.com/hc/en-us/articles/360006830977-Read-on-reMarkable-Google-Chrome-Extension
- eskogh/read-on-rmfakecloud https://github.com/eskogh/read-on-rmfakecloud (Sep 2026): popup button, right-click menu or keyboard shortcut; sends online PDFs directly including from Chrome's PDF viewer "even when the URL lacks a .pdf extension"; "Read on rmfakecloud (PDF)" print destination; selected text as EPUB from right-click; destination folder per server/account (default root); popup lists the last five successful sends and offers retry for failed uploads and print jobs; document names shortened to 60 chars and editable before sending; images >10 MB or >15 s timeout are left out; files reach the tablet on its next sync; Chrome may reserve the default shortcut so reassign at chrome://extensions/shortcuts.
- hjanuschka/send-to-remarkable https://github.com/hjanuschka/send-to-remarkable (Sep-Oct 2026): MV3 Chrome extension using Readability; the "Pencil selection": "draw over the page like a marker" and every content block the stroke touches is included, touched blocks get an orange outline, scroll while drawing, Done applies / Esc cancels / Clear resets; modal preview with editable title; uploads typeset EPUB (9 pt base font, left-aligned, marker-style inline code, no TOC) to root folder (no folder choice); device-code registration once (8-char code), token in chrome.storage.local, revocable at my.remarkable.com. Also a CLI (Markdown/PDF/EPUB; rsync-like folder sync) and an agent tool `send_to_remarkable`.
- Sibling reMarkable background (BG, mostly unverified): eink-tablets.md section 2.

---------------------------------------------------------------------------
## 3. Cross-cutting findings by topic (what to copy / what to avoid)
---------------------------------------------------------------------------

### 3.1 Capture modes (the menu of "what gets sent")
Observed modes across products: (a) clean article via Readability/Defuddle (everyone); (b) full-page faithful snapshot (SingleFile; Linkwarden stores single HTML + PDF + screenshot; Evernote "Full page" [BG]); (c) selection only (Obsidian precedence: selection > highlights > template > article; MarkDownload "Download Selected"; read-on-rmfakecloud selected text as EPUB; TabTome context menu); (d) highlights-only (Obsidian "replace page content with highlights"); (e) PDF as the file itself (read-on-rmfakecloud, KindBeamer; Obsidian still can't: #646); (f) PDF via print dialog destination (official Read on reMarkable, rmfakecloud clone); (g) screenshot (Evernote/Joplin [BG]; Obsidian #188 blocked); (h) link/bookmark only (Notion/Evernote bookmark [BG], Raindrop, linkding); (i) structured-metadata capture via site translators (Zotero) and per-site templates (Obsidian triggers, Karakeep #2831 per-URL rule).
Pattern: the winning UIs choose a sensible default automatically and let the user override in the same popup (Obsidian's precedence rule is the cleanest example).

### 3.2 Preview and edit before sending
Strong examples: MarkDownload live-rendered Markdown editor; Obsidian Reader + popup with editable properties; content-collector reorder/rename/edit/remove blocks, resize images; send-to-remarkable pencil block selection + editable title; read-on-rmfakecloud editable (60-char) title; Web to Kindle reader preview with word count and reading time; Zotero popup. Users repeatedly ask for review UI only when extraction is unreliable (thin/empty notes: Obsidian #484, #949).

### 3.3 Title / tag / note / destination at save time
- Readwise: bar with tags + document note + move-to-section [SIB]. Instapaper: banner with tags/folder/archive [SIB]. Raindrop: collection + tags + AI suggestions + Unsorted inbox [SIB]. Zotero: collection/tags (autocomplete shipped Jun 2025) + note (shipped Jun 2025). Omnivore: labels, create-new-label added after request (#2366). Obsidian: vault/folder/properties/template. Wallabagger: tags with autocomplete, but #334 complains autocomplete auto-adds before users can create a new tag.
- Rule of thumb from threads: show it AFTER save (non-blocking bar/banner) so one-click remains one-click; allow creating new tags inline; remember last used destination; confirmation popup should auto-dismiss (~5 s, Omnivore #3143) but must make success visible (Obsidian #744).

### 3.4 Keyboard shortcuts
Defaults seen: Alt+R (Readwise, [SIB]), Ctrl+Shift+Y (SingleFile), Alt+Shift+M (MarkDownload; "then Enter" for quick save), Cmd/Ctrl+Shift+O open + Alt/Shift+O quick clip + Alt+Shift+H highlighter (Obsidian), Cmd+Shift+S (GoodLinks Safari [SIB]), Ctrl+Shift+K (Web to Kindle), Alt+Shift+A add page to collection (content-collector), Ctrl+I (Instapaper Firefox - conflicts with italics [SIB]). Requests: per-mode shortcuts (SingleFile #1215 save selection; Obsidian #472 one shortcut saves, another copies; MarkDownload #72 copy link as Markdown), show shortcuts on the settings page (Wallabagger #499), Chrome may reserve defaults (read-on-rmfakecloud). Safari cannot rebind extension hotkeys (Obsidian doc) - so Safari needs in-app alternatives (menu, toolbar, context menu).

### 3.5 Context menus and link-in-page actions
Seen: save page; save selection; save LINK without opening it (Omnivore #903 shipped 2022; MarkDownload "Copy link as Markdown"); copy tab URL(s) as Markdown links; save image (pitfall: Karakeep #1174 saves the image, not the parent page, users expect the page link with image as banner); send all/selected tabs (SingleFile, MarkDownload); "Open side panel"; toggle highlighter (Obsidian). Users also ask to hide/disable the context-menu entry (Obsidian #271, SingleFile #1648/#1444). Safari lacks equivalents (Obsidian #850).

### 3.6 Batch: "send all open tabs"
SingleFile (selected / unpinned / all tabs, one click); MarkDownload "Download All Tabs"; TabTome (up to 25 tabs into ONE EPUB with per-tab success/failure); content-collector (curated multi-page bundle with order + TOC); Matter bulk send (merge into one ebook, each article a chapter [SIB]); kindle-send CLI (links file -> multi-chapter ebook [SIB]); percollate (URLs -> one document with TOC); Memex tab manager (add all open tabs to a collection). Demand-side: Karakeep #2795/#1710 (Tab-Bankruptcy to a dated folder), Obsidian #83, kindle-send-chrome roadmap "multi-tab bundling". Design details worth copying: per-tab result list, partial failure does not abort the batch, dedupe by job id, cross-domain warning but not a block, show estimated size.

### 3.7 Highlighting on the live web
Obsidian Highlighter (persist + reappear, ==markup==, viewer, search, import/export, mobile support in 1.6) is the current benchmark; Readwise auto-highlight; Instapaper highlights on any page; Omnivore highlight-from-website; Hypothesis/Memex annotate; SingleFile annotate-and-save; Linkwarden reader highlights. Unsolved asks: annotation at selection time (Obsidian #181, 14 thumbs-up), colour categories (#268), sync across devices (#174, #111 -> shipped import in 1.7.1). Pitfalls: XPath anchoring breaks on unusual DOMs (#707, #943); popup-first activation is friction (#865); highlight data stored in extension storage is device-bound and size-limited (kepano on #174).

### 3.8 Paywalls, logins, and "send what the browser rendered"
- Works because the extension sends the rendered DOM from the logged-in browser: Readwise ("most robust way to save"), Matter ("Save behind paywalls"), Instapaper bookmarklet, Wallabagger ("send content from a paywalled page"), SingleFile, TabTome ("logins and JavaScript-rendered content work"), Obsidian.
- Server-side fetch cannot log in: Karakeep #1167 users ask to upload cookies for the server crawler (6 thumbs-up, unresolved; SingleFile workaround); BYK's Readwise Full Content add-on exists for the same reason.
- Even rendered-DOM capture breaks on: lazy/unloaded content (SingleFile #1931), obfuscated or dynamically injected articles (Obsidian #484), and apps that hand over only a URL (Readwise mobile caveat [SIB]).

### 3.9 Infinite scroll, X/Twitter threads, YouTube
- Infinite scroll: all tools capture only what is in the DOM now. SingleFile: "can only save what is present in the page" (#1931). Obsidian #264 same for X threads (kepano suggests auto-scroll or API). Workaround in practice: kindle-send-chrome has a dedicated X thread extractor (author's consecutive posts as one EPUB); Defuddle uses FxTwitter API for X Articles via async extractor.
- YouTube: Obsidian 1.4.0 interactive transcript in Reader + `{{transcript}}` variable; Defuddle YouTube extractor; recurring defect = wrong caption language (#957, #991, #942, #826) and plain-text timestamps (#785). Readwise YouTube v2 (Jan 2025: transcript highlights, click to seek) [SIB].
- Reddit/HN: Obsidian 1.3.0 threaded comment UI in Reader; Defuddle `includeReplies` option.

### 3.10 PDFs and screenshots
PDF: send the PDF itself even from Chrome's viewer / URLs without .pdf (read-on-rmfakecloud, KindBeamer); save-file-and-link is the pragmatic ask (Obsidian #646); print-destination trick (official Read on reMarkable). Screenshot: Obsidian #188 (blocked), Evernote/Joplin have it [BG]; "pending clipboard image then save" idea.

### 3.11 Reliability, receipts, duplicates
- Always show visible success (Obsidian #744) and keep an activity list with retry (read-on-rmfakecloud last five; kindle-send-chrome activity list + OS notifications + badge counts + watchdog for killed MV3 service workers).
- Idempotency: Obsidian #984 (double trigger = two notes); TabTome jobId de-dup; kindle-send-chrome 3-minute resend guard.
- Already-saved indicator: Omnivore #2747 (13), Karakeep #486 (7, shipped as opt-in badge), #49 (shipped dup-aware popup), Obsidian #112, Raindrop checkmark [SIB], readwise-save-translated "existing-document detection" (details page). Privacy-preserving implementations proposed: hashed URL set pulled to the client (k-anonymity), local cache, opt-in only.
- Cross-device replay danger: SingleFile #1788 (auto-save on bookmark replays on every synced device).

### 3.12 Images and size
Resolve lazy images (data-src, srcset, picture), fetch in the background worker (host permissions) to avoid CORS, convert WebP/AVIF/SVG, cap at 1600 px, recompress ~q0.75, skip hotlink-protected images instead of failing, "no images" mode, per-send budgets (TabTome 30 images/15 MB/18 MB EPUB; kindle-send-chrome relay 4.5 MB). Requires "all sites" permission, which stores warn about (KindBeamer; TabTome). Obsidian leaves images as remote URLs by default.

### 3.13 Platform pitfalls for Safari / iOS / mobile extensions
Per-site "allow" prompts (#306), pinned-tab permission quirk (#345), no hotkey rebinding, missing context-menu items (#850), popup layout bugs on iOS 27 and iPadOS (#634, #815, #997, #691), settings not syncing across Mac/iPhone/iPad (#174), downloads API missing in Safari (MarkDownload), SingleFile iOS options buried in Settings > Safari > Extensions. Firefox Android supports extensions (Obsidian, SingleFile); Chrome on Android does not (SingleFile #1599 asks for Kiwi/Lemur support) - implication: on the DC-1 itself the capture path must be a share target/app, not a browser extension.

### 3.14 Privacy posture people reward
No telemetry (Obsidian), no accounts/server (content-collector, TabTome), "Kindle email saved locally in the browser" (web2kindle), E2E-encrypted sync (Memex), extension cannot read the vault (kepano on #112), opt-in features that need server lookups (Karakeep #486 maintainers), complaints about data collection and mandatory login (Readwise AMO reviews [SIB]).

---------------------------------------------------------------------------
## 4. What users love (distilled; strongest evidence first)
---------------------------------------------------------------------------
1. One action, no ceremony: popup-open-is-send (kindle-send-chrome), Quick Clip (Obsidian), Quick Save (GoodLinks), one-click mode (Raindrop), Alt+Shift+M then Enter (MarkDownload). Evidence: https://github.com/manabubannai/kindle-send-chrome ; https://github.com/deathau/markdownload/issues/21 ; [SIB] read-later-apps.md sec 3-4.
2. Logged-in/paywalled pages "just work" because the browser sends what it rendered: Readwise docs, Matter review "It handles paywalled articles better than any other extension I've tried." ([SIB]), TabTome, Wallabagger.
3. Highlights that persist on the live page and flow out as clean Markdown: Obsidian 1.7.0 ("Highlights now persist across live pages and Reader"); #111 (11 thumbs-up + 4 rockets) and #181 (14) show demand.
4. Reader mode inside the clipper to check what will be sent (Obsidian Reader 1.3-1.5; Web to Kindle preview).
5. Templates/rules per site (Obsidian triggers; Karakeep #2831 asks for the same) so weird sites are fixed once.
6. Clear confirmation + undo/retry + activity history (read-on-rmfakecloud, kindle-send-chrome).
7. Bundling many pages into one document with chapters and TOC (TabTome, content-collector, percollate, Matter [SIB]).
8. Privacy and local-first (Obsidian, content-collector, web2kindle, Memex).

---------------------------------------------------------------------------
## 5. Top frustrations (ranked by evidence weight; all with sources)
---------------------------------------------------------------------------
1. Empty / thin / wrong extraction with no warning: https://github.com/obsidianmd/obsidian-clipper/issues/484 (empty note), /949 (Safari JSON-LD crash), /546 (highlights lost with selector variable); Obsidian docs: Defuddle "can be overly conservative"; content-collector: "Extraction can misjudge unusual layouts".
2. Capture limited to what is currently in the DOM (infinite scroll, X threads): https://github.com/obsidianmd/obsidian-clipper/issues/264 ; https://github.com/gildas-lormeau/SingleFile/issues/1931 ("SingleFile can only save what is present in the page.").
3. Settings/highlights/templates do not sync across browsers and Apple devices: https://github.com/obsidianmd/obsidian-clipper/issues/174 (17 thumbs-up, top open request).
4. No "already saved" signal, so duplicates pile up; privacy objections to naive server lookups: https://github.com/omnivore-app/omnivore/issues/2747 (13) ; https://github.com/karakeep-app/karakeep/issues/486 (7) ; https://github.com/obsidianmd/obsidian-clipper/issues/112.
5. Safari/iOS extension friction: per-site permission prompt each clip (#306), pinned-tab failure (#345), missing context menu (#850), save button hidden by keyboard / confusing checkmark (#634), blank popups (#815/#997). https://github.com/obsidianmd/obsidian-clipper/issues/306
6. Server-side fetchers cannot see logged-in/paywalled content: https://github.com/karakeep-app/karakeep/issues/1167 ; Readwise Full Content add-on [SIB].
7. Official integrations fragile: Amazon's Send to Kindle extension "depends on Amazon's authenticated web endpoints" and breaks on MV3 CORB/CORS (https://github.com/manabubannai/kindle-send-chrome); Read on reMarkable failures with no console logs (https://github.com/ddvk/rmfakecloud/issues/67); undocumented-API risk (https://github.com/jooray/kindbeamer).
8. Silent failure / no visible confirmation: https://github.com/obsidianmd/obsidian-clipper/issues/744 ; double-trigger duplicates https://github.com/obsidianmd/obsidian-clipper/issues/984 .
9. PDFs: clippers cannot capture them (https://github.com/obsidianmd/obsidian-clipper/issues/646), or need extra steps.
10. Highlight fragility and missing annotation/colour: https://github.com/obsidianmd/obsidian-clipper/issues/181 , /268 , /696 , /707 , /943.
11. YouTube transcript language errors and unusable timestamps: https://github.com/obsidianmd/obsidian-clipper/issues/957 , /785.
12. Image problems: WebP/AVIF not rendered by target (kindle-send-chrome README), hotlink-protected images fail (content-collector), size cliffs (TabTome 18 MB, relay 4.5 MB), "all sites" permission scare.
13. Thin official extensions / paywalled convenience: Instapaper extension replaced by third-party ones; Kindle send moved to Premium on 19 Feb 2026 [SIB read-later-apps.md]; Raindrop popup slow/missing save button [SIB].
14. Auto-capture on one device replaying on others: https://github.com/gildas-lormeau/SingleFile/issues/1788 .

---------------------------------------------------------------------------
## 6. Candidate "Lab" features for Send to Daylight (borrow list)
---------------------------------------------------------------------------
Context assumed: E2E relay with delivery receipts already exists; companions: Chrome + Safari extension, Mac app/Share menu, iPhone share extension, Android phone share target, web sender page, Inbox on DC-1 (Android 13, grayscale, pen). "Needs" legend: companion-only / companion+inbox (needs a protocol field and Inbox UI) / reader-change (Daylight Reader app) / server (relay-side).

1. Capture-mode picker with smart default (Article / Page snapshot / Selection / Highlights / PDF file / Screenshot / Link). companion-only (+reader-change for snapshot HTML). HIGH.
2. Send rendered DOM from the logged-in browser (paywall/login proof); never ask the server to fetch. companion-only. HIGH (already natural for E2E; make it explicit and default).
3. One-click "popup is send" quick mode plus a review mode; per-shortcut behaviour (send vs copy link vs open review). companion-only. HIGH.
4. Background send queue with badge, notifications, activity list, retry, resend guard, idempotent job ids. companion-only (+ receipts already exist). HIGH.
5. Save-time metadata bar after send: destination (Read now / Later / Archive / folder), tags with autocomplete + create-new, short note; mirrored in iPhone/Android share sheets. companion+inbox. HIGH.
6. Preview/edit before send: reader preview, editable title/author, remove blocks, "include more" region picker, thin-content warning with "send full page instead" fallback. companion-only. HIGH.
7. Context menu set: page, selection, link (without opening), image-with-parent-page, tab(s). companion-only. HIGH.
8. Send all/selected tabs or collect-then-send bundle as one multi-chapter document with TOC and per-tab results. companion-only (+reader-change for TOC nav). HIGH.
9. Already-sent indicator and dedupe using a local hashed history (opt-in), with "send again" confirmation. companion-only. MEDIUM-HIGH.
10. Selection/excerpt send with source link and optional note; highlight layer that the Reader pre-renders. companion+inbox (+reader-change). MEDIUM-HIGH.
11. Live-web highlighter in the extension (persist, colours, annotate-at-selection) that can ride along as a highlight layer. companion+inbox+reader-change. MEDIUM.
12. Image diet for grayscale e-ink: lazy-image resolve, WebP/AVIF to JPEG/PNG, <=1600 px, grayscale option, no-images mode, size preview. companion-only. HIGH.
13. PDF handling: send PDF as-is from viewer, "Print to Daylight" destination on Mac, save-and-link. companion-only (Mac print dialog). HIGH.
14. X/Twitter thread unroll + YouTube transcript with timestamps and original-language caption selection. companion-only. MEDIUM.
15. Preferences/history sync across the user's paired companions (default device, tag vocabulary, shortcuts mode, send history) through the E2E relay as an encrypted blob. companion+inbox(+server relay storage). MEDIUM-HIGH.
16. Per-site rules/templates (URL prefix/regex triggers choosing capture mode, destination, tags). companion-only. MEDIUM.
17. Multi-destination send (all paired devices / a second tablet / a "also keep a copy" target) with per-save override. companion-only. LOW-MEDIUM.
18. In-page overlay or side-panel mode instead of popup (works around popup dismissal, keyboard-hides-button bugs). companion-only. MEDIUM.
19. Safari-specific hardening: in-app menu, toolbar action, explicit permissions walkthrough, pinned-tab handling. companion-only. MEDIUM-HIGH.
20. "Read now" push: open directly on DC-1 rather than land in Inbox. companion+inbox. MEDIUM.
21. Screenshot / region capture (pending clipboard image then send). companion-only. LOW-MEDIUM.
22. Pencil/stroke block selection (send-to-remarkable style) for trackpad, iPad Pencil, or touch. companion-only. LOW-MEDIUM (delight feature that matches a pen product).
23. Bulk paste of URLs / bookmarks import to queue. companion-only. LOW-MEDIUM.

---------------------------------------------------------------------------
## 7. Open questions / design notes for the lead
---------------------------------------------------------------------------
- E2E relay vs "already saved" badge: the relay cannot know what was sent, so dedupe must be client-side (local or synced hashed list). Omnivore's k-anonymity idea shows users accept this tradeoff.
- Everything that depends on page DOM (highlighter, paywall capture) must live in the extension; mobile share sheets mostly provide a URL, so iOS should request the Safari page content (Readwise's documented advice) and Android should offer "open in browser with the extension" for paywalled pages (Firefox Android supports extensions, Chrome Android does not).
- MV3 constraints seen in the wild: service workers killed mid-job (kindle-send-chrome watchdog), CORS on image fetch (use host permissions in the worker), "Browser window has no toolbar" in fullscreen popup open (#609).
- Chrome extension store scrutiny for "all sites" host permission: TabTome/KindBeamer both explain why they need it; plan a clear permission explainer.

---------------------------------------------------------------------------
## 8. Gaps I could not close (need a run with working network + search budget)
---------------------------------------------------------------------------
- Chrome Web Store / AMO / App Store / Play review text and ratings for: Readwise Highlighter, Instapaper, Raindrop, Notion Web Clipper, Evernote Web Clipper, Obsidian Web Clipper, MarkDownload, SingleFile, Zotero Connector, Send to Kindle for Chrome, Read on reMarkable. (Store pages unreachable.)
- Official docs for Evernote and Notion clippers, Amazon Send to Kindle for Chrome, Read on reMarkable support article, Instapaper/Raindrop/Readwise help pages (hosts unreachable; Readwise/Instapaper/Raindrop only via [SIB]).
- Reddit (r/ObsidianMD, r/readwise, r/Instapaper, r/kindle, r/Remarkable), Hacker News threads, MobileRead, YouTube reviews/transcripts.
- Whether Chrome's official Send to Kindle extension is currently "really broken" (only second-hand claims).
- Notion clipper capture depth in 2026; Evernote clipper mode list in 2026 (BG only).
- Raindrop/Readwise/Instapaper extension keyboard shortcut defaults beyond what [SIB] reports.

---------------------------------------------------------------------------
## 9. Source URL index (everything I fetched or searched successfully)
---------------------------------------------------------------------------
Obsidian Web Clipper
- https://github.com/obsidianmd/obsidian-clipper (README, tree), /releases
- https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Obsidian%20Web%20Clipper/{Introduction%20to%20Obsidian%20Web%20Clipper,Clip%20web%20pages,Highlighter,Reader,Interpreter,Templates,Variables,Troubleshoot%20Web%20Clipper}.md
- https://github.com/obsidianmd/obsidian-help/tree/master/en/Obsidian%20Web%20Clipper (file list: Clip web pages, Filters, Highlighter, Interpreter, Introduction, Logic, Reader, Templates, Troubleshoot, Variables)
- Issues read in full: https://github.com/obsidianmd/obsidian-clipper/issues/174 , /181 , /112 , /306 , /264 , /188 , /646 , /472 , /774 , /957 ; bodies via search: /111 , /134 , /180 , /268 , /285 , /345 , /484 , /509 , /546 , /550 , /575 , /572 , /609 , /634 , /691 , /696 , /703 , /707 , /785 , /815 , /826 , /850 , /858 , /865 , /892 , /914 , /942 , /943 , /945 , /949 , /984 , /991 , /997 , /83 , /184 , /213 , /242 , /744 ; list page https://github.com/obsidianmd/obsidian-clipper/issues?q=is%3Aissue+is%3Aopen+sort%3Areactions-%2B1-desc
Defuddle / extraction
- https://github.com/kepano/defuddle , /tree/main/src/extractors , /releases
- https://github.com/mozilla/readability
- https://github.com/danburzo/percollate
SingleFile
- https://github.com/gildas-lormeau/SingleFile , https://github.com/gildas-lormeau/SingleFile/blob/main/faq.md , /blob/main/known-issues.md
- Issues: /issues/1931 , /1389 , /1215 , /1764 ; via search: /1567 , /1308 , /1404 , /1788 , /1987 , /1402 , /1599 , /1904 , /1895 , /1088 , /1648 , /1444
MarkDownload
- https://github.com/deathau/markdownload , https://raw.githubusercontent.com/deathau/markdownload/master/user-guide.md , issues /21 , /72 , /82 , /206 , /219 , /18 , /297
Zotero Connector
- https://github.com/zotero/zotero-connectors ; issues /310 , /376 , /206 , /481
Omnivore
- https://github.com/omnivore-app/omnivore/issues/2747 , /2366 , /2817 , /3143 , /903 ; via search /3335 , /2984 , /2664 , /3228 , /3870
Karakeep / Linkwarden / linkding / Wallabagger / Hypothesis / Memex / Joplin
- https://github.com/karakeep-app/karakeep (+ issues /486 , /49 , /1167 , /2795 , /2831 , /1174 , /1710 , /3082 , /2421)
- https://github.com/linkwarden/linkwarden ; https://github.com/sissbruecker/linkding ; https://github.com/wallabag/wallabagger (+ issues /334 , /499 , /445) ; https://github.com/hypothesis/browser-extension ; https://github.com/WorldBrain/Memex
- https://raw.githubusercontent.com/laurent22/joplin/dev/readme/apps/clipper.md ; https://github.com/laurent22/joplin/issues/135 , /1576
Readwise (primary-ish)
- https://github.com/readwiseio (org list: readwise-skills, readwise-mcp, readwise-cli, reader-desktop-releases, obsidian-readwise...)
- https://github.com/FelixHuoEZ/readwise-save-translated
Kindle / reMarkable pushers
- https://github.com/manabubannai/kindle-send-chrome ; https://github.com/sirbrasscat/chrome-kindle-sender ; https://github.com/megaconfidence/web2kindle ; https://github.com/jooray/kindbeamer ; https://github.com/akakybzdynia-boop/tabtome ; https://github.com/JoanClaverol/content-collector ; https://github.com/AALAM98mod100/send-to-kindle-firefox ; https://github.com/daniel-j/send2ereader (README excerpt only)
- https://github.com/ddvk/rmfakecloud/issues/67 ; https://github.com/eskogh/read-on-rmfakecloud ; https://github.com/hjanuschka/send-to-remarkable (+ chrome-extension/README.md)
Sibling notes relied on for closed-source products (not verified by me)
- /home/user/MHW/reader-experiment/research/raw/read-later-apps.md ; /readwise-reader.md ; /send-to-kindle-kobo-pocketbook.md ; /eink-tablets.md
Attempted but unreachable (ENOTFOUND): help.obsidian.md, obsidian.md, docs.readwise.io, readwise.io, chromewebstore.google.com, addons.mozilla.org, apps.apple.com, play.google.com, en.wikipedia.org, www.zotero.org, help.raindrop.io, support.remarkable.com, www.mobileread.com, www.youtube.com, developer.chrome.com
