# Follow-up: underserved user groups and accessibility of the companions

Angle: academics and students, lawyers and long-PDF professionals, writers and journalists, ADHD / dyslexia / low-vision readers, and the accessibility of the Send to Daylight companions themselves (iPhone, Mac, Android, Chrome/Safari extensions, web sender, DC-1 Inbox).
Compiled 2026-10-20 by the follow-up agent. Project: "Send to Daylight" companions feeding the Daylight Reader on the DC-1.

## 0. READ FIRST: what this file is, and what it is not

### 0.1 Research conditions (exact)
- WebSearch: **zero results this run.** Four attempts (ADHD read-it-later graveyard; Zotero-reMarkable/ZotFile; OpenDyslexic/Bionic Reading on r/dyslexia; Voice Dream Reader) were each refused with: "Web search was not performed: this turn's web search budget is used up (limit: 200 WebSearch calls per turn, shared by every agent in it)". Per the refusal text I did not query search engines through curl, readers, proxies or archives. The brief said the shared budget was already spent; it still was.
- WebFetch reach, tested one URL per host:
  - WORKS: `github.com` (repo pages, README, issue lists with filters, issue threads with comments), `developer.android.com` (full pages, with "last updated" dates), `developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json` (the JSON behind Apple's HIG; the normal HTML URL returns only the page title because it is JavaScript-rendered), `raw.githubusercontent.com/w3c/wcag/main/understanding/...` (WCAG "Understanding" pages; normative SC text is not in them).
  - DOES NOT RESOLVE (`getaddrinfo ENOTFOUND`): hn.algolia.com, forum.zotero.org, www.zotero.org, www.w3.org, arxiv.org, developer.mozilla.org, webaim.org, pmc.ncbi.nlm.nih.gov, www.understood.org, www.additudemag.com, brailleinstitute.org.
  - Not attempted, because the brief and earlier notes say they are policy-denied: reddit.com and mirrors, youtube.com, news.ycombinator.com, app stores, vendor sites.
- GitHub MCP tools: `search_repositories` works (public metadata only: description, stars, topics, archived flag, dates). `get_file_contents` is restricted to one allowed repo, so I did NOT read other repos' files through it, and I did not add repos to the session. All README and issue text below came through WebFetch of public github.com pages.
- WebFetch caveat: it returns a small model's summary of the page and caps each quotation at about 125 characters. Quotes below are therefore short, near-verbatim fragments; long comments are paraphrased and marked "paraphrase". Verify any quote by opening the URL before using it in public copy.

### 0.2 What this means for the findings
1. All user voice here is GitHub issue and README text. That is real, dated and linkable, but it comes from people who file issues on open-source readers, Zotero plugins and PDF tools. It is NOT r/ADHD, r/dyslexia, r/accessibility, r/Zotero, r/LawFirm, r/Journalism, r/RemarkableTablet or MobileRead. **The "read-later graveyard" threads were not collected.** Everything about ADHD backlog behaviour beyond two wallabag issues is therefore [BG] or inference.
2. Lawyer voice is almost absent. The best I have is one law-firm PDF suite's own README and issues (RaioPDF) plus redaction bug threads in Stirling-PDF. No lawyer wrote a sentence about pen tablets that I could open.
3. Commercial products named in the brief were not researched at all because no reachable source describes them: LiquidText, GoodNotes, Notability, PDF Expert, MarginNote, Paperpile, Papers, Speechify, Voice Dream Reader, ElevenReader, Semantic Scholar Reader (only the open-source ScholarPhi repo README, which lists no features), Hypothesis (README is thin), Readwise-for-papers, Zotero 7/8 Reader release notes. Mentions of them below are [BG] (my background knowledge, unverified in this run).
4. "Top 8 wants / top 5 hates" are ranked by my editorial judgement of evidence strength and fit to Send to Daylight, not by counted frequency. Evidence strength per group: A academics MEDIUM (many concrete issue threads); B lawyers LOW; C writers/journalists LOW-MEDIUM; D reading aids MEDIUM (good e-ink-specific threads), ADHD backlog behaviour LOW; E accessibility of the companions HIGH (platform vendors' own docs).

### 0.3 Evidence tags
- [OPENED] = I fetched that page (README, issue, issue thread, docs page) this run.
- [SNIPPET-ONLY] = I saw only metadata or a list row (GitHub repo-search description and stars, or an issue-list title and count) and did not open the body.
- [PRIOR] = stated in a sibling notes file in this folder (path and line given); I did not re-open its source.
- [BG] = background knowledge of mine, not verified this run. Treat as hypothesis.
- [INFER] = my inference from tagged facts, stated as such.

## 1. Source log (what I actually opened)

| # | URL | What | Tag |
|---|---|---|---|
| 1 | https://github.com/bpiwowar/zotero-remarkable-sync | README of a tag-driven bidirectional Zotero 7 <-> reMarkable sync plugin (created 2026-06-08, pushed 2026-08-10, 8 stars, AGPL) | OPENED |
| 2 | https://github.com/bpiwowar/zotero-remarkable-sync/issues | 1 open issue (#11 "Bug When Syncing", Aug 28 2026), no body | OPENED (title only) |
| 3 | https://github.com/alfakini/zotero-reMarkable-plugin | README, two-way sync incl. handwriting as SVG child notes (created 2026-10-15) | OPENED |
| 4 | https://github.com/melvinwevers/rm-zotero-sync | README, Python launchd script (created 2026-10-11) | OPENED |
| 5 | https://github.com/dipta007/zotRm | README, CLI Zotero <-> reMarkable (created 2026-06-24) | OPENED |
| 6 | https://github.com/GjjvdBurg/paper2remarkable | README (385 stars) | OPENED |
| 7 | https://github.com/GjjvdBurg/paper2remarkable/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc | issue list (59 total) | OPENED (titles) |
| 8 | https://github.com/GjjvdBurg/paper2remarkable/issues/142 , /44 | USB upload; any web article | OPENED |
| 9 | https://github.com/jlegewie/zotfile (+ /issues sorted by reactions; /issues/226, /413, /454, /655) | ZotFile README and threads (4,379 stars, 300 open issues) | OPENED |
| 10 | https://github.com/stelzch/zotero.koplugin (+ /issues; /issues/6, /13, /20, /26) | KOReader plugin to browse and download a Zotero library (167 stars) | OPENED |
| 11 | https://github.com/zotero/zotero-ios/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc ; /issues/220 ; /issues/597 | Zotero iOS requests | OPENED |
| 12 | https://github.com/zotero/zotero-connectors/issues/376 | note field in the save popup | OPENED |
| 13 | https://github.com/zotero/reader | README, build instructions only | OPENED |
| 14 | https://github.com/zotero/zotero/releases | "There aren't any releases here" | OPENED |
| 15 | https://github.com/dginev/ar5iv ; /issues?q=...sort%3Areactions ; /issues/56 | ar5iv README, issues, "export to kindle" thread | OPENED |
| 16 | https://github.com/arXiv/html_feedback | feedback repo (3.3k issues), README thin | OPENED |
| 17 | https://github.com/allenai/scholarphi | ScholarPhi (augmented PDF reader) README, no feature list | OPENED |
| 18 | https://github.com/hypothesis/client | README thin | OPENED |
| 19 | https://github.com/Macrify-LLC/raiopdf ; /issues ; /issues/158 ; /issues/377 | law-firm local PDF suite | OPENED |
| 20 | https://github.com/Stirling-Tools/Stirling-PDF ; issue lists for redact/legal and for page-range/OCR/compress; /issues/7564 ; /issues/4641 | PDF toolkit | OPENED |
| 21 | https://github.com/freelawproject/x-ray ; https://github.com/freelawproject/recap-chrome ; https://github.com/JoshData/pdf-redactor ; https://github.com/freedomofpress/dangerzone ; https://github.com/freedomofpress/securedrop | redaction, court documents, untrusted documents, sources | OPENED |
| 22 | https://github.com/ocrmypdf/OCRmyPDF ; https://github.com/jgm/pandoc | OCR layer; format conversion | OPENED |
| 23 | https://github.com/lucasrla/remarks ; https://github.com/Scrybbling-together/scrybble-site | reMarkable annotations to Markdown / PDF | OPENED |
| 24 | https://github.com/koreader/koreader/issues/9109 ; /issues/13206 ; /issues/12556 ; issue lists for bionic, dyslexia, "lecture slides OR large PDF OR textbook" | Bionic Reading, RSVP, auto-export, large files | OPENED |
| 25 | https://github.com/readest/readest/issues/6048 , /3011 , /5174 , /6235 , /4264 , /6661 , /6412 ; issue lists for dyslexia/TTS/accessibility and for bionic/ruler | reading ruler, bionic, dyslexia fonts, TTS | OPENED |
| 26 | https://github.com/edrlab/thorium-reader ; /issues/3523 ; issue list for dyslexia/screen reader/TTS | accessible EPUB reader | OPENED |
| 27 | https://github.com/readium/speech | read-aloud library with highlighting | OPENED |
| 28 | https://github.com/windingwind/bionic-for-zotero ; /issues ; /issues/15 ; /issues/63 | Bionic Reading inside Zotero | OPENED |
| 29 | https://github.com/wallabag/wallabag/issues?q=...random... ; /issues/6322 ; /issues/8640 | random unread, partly read | OPENED |
| 30 | https://github.com/karakeep-app/karakeep/issues?q=...random+OR+backlog+OR+overwhelmed | nothing relevant on page 1 | OPENED |
| 31 | https://github.com/koodo-reader/koodo-reader/issues?q=...bionic... (issues 464, 1296) | bionic requests | OPENED (titles) |
| 32 | https://github.com/googlefonts/atkinson-hyperlegible ; https://github.com/antijingoist/opendyslexic | font READMEs | OPENED |
| 33 | https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json , typography.json , voiceover.json , motion.json | Apple HIG | OPENED |
| 34 | https://developer.android.com/guide/topics/ui/accessibility ; /principles ; /apps ; /testing ; /develop/ui/compose/accessibility | Android accessibility docs (last updated 2026-04-16 to 2026-09-22) | OPENED |
| 35 | https://raw.githubusercontent.com/w3c/wcag/main/understanding/22/target-size-minimum.html ; /21/text-spacing.html ; /21/animation-from-interactions.html ; /21/reflow.html | WCAG 2.2 / 2.1 Understanding pages | OPENED |
| 36 | https://github.com/dequelabs/axe-core | automated checking | OPENED |
| 37 | GitHub repo-search metadata for: zotero reMarkable; zotfile; bionic reading; arxiv remarkable; ar5iv; zotero koreader; atkinson hyperlegible; dyslexia reading-ruler extensions; bates numbering; ADHD reading apps | stars, dates, archived flags | SNIPPET-ONLY |

Prior notes used (all in /home/user/MHW/reader-experiment/research/raw/): `eink-tablets.md` (DC-1 and Reader facts, lines 44-66), `highlights-roundtrip.md` (round-trip feature table, lines 188-200; remarks/Scrybble/rmapi, lines 57-93), `read-later-apps.md` (Instapaper 10 fonts incl. Atkinson, line 29; Matter TTS, line 67), `community-voice.md` (Omnivore TTS with visible text, line 364), `readwise-reader.md` (TTS gaps, lines 96-98), `mobile-share-patterns.md` (Zotero iOS share extension defects, lines 192, 218), `browser-clippers.md` (Zotero Connector, lines 131-133).

## 2. Cross-group findings (the ones that change the Lab plan)

1. **Round trip, not one-way delivery, is the academic and writer want.** The Zotero-to-tablet scene is fragmented and fragile: ZotFile (4,379 stars) is unmaintained and has no Zotero 7 support; at least four new Zotero <-> reMarkable tools appeared in 2026 (bpiwowar, dipta007/zotRm, melvinwevers, alfakini). Every one of them is young (0 to 8 stars), experimental, and tied to reMarkable's cloud. The gap is "send a paper, mark it up with a pen, get a clean annotated copy and the highlights back, without destroying anything".
2. **Never destroy the tablet copy; keep a pristine original next to the annotated one.** ZotFile #226 (10 thumbs-up, open since 2016), ZotFile #413, zotRm ("re-running refreshes the annotated copy rather than creating duplicates"), bpiwowar ("Bugs can reorder, corrupt, or delete annotations and files").
3. **Color is not a signal on the DC-1.** The DC-1 is a 10.5" grayscale "LivePaper" reflective LCD (1184x1584, 120 Hz; about 188 ppi by my arithmetic) [PRIOR eink-tablets.md:46]. Readest's maintainer, fixing the reading ruler for e-ink: "on black-and-white e-ink, a red wash and a gray wash look identical" and a tint "lowered text contrast and added rendering cost" [OPENED https://github.com/readest/readest/issues/6048 , 2026-09-04]. Every status, highlight category and focus aid needs a non-color encoding (weight, underline, box, pattern, label).
4. **Bionic Reading is contested; the maintainers who looked at the evidence ship it as a font or not at all, and users still ask for it.** KOReader closed it "out of scope", then reopened it for a bionic-style font; Readest declined a core feature ("For users who simply prefer this typography, a dedicated font should be sufficient"). The same threads contain strong, opposite user reactions. The lesson for Lab: optional, off by default for the reading surface, per-user, with exclusions, and implemented so it can be switched off in one tap.
5. **Reading rulers are a top e-ink/dyslexia/ADHD aid and the hardest to get right.** Readest has had at least 14 ruler issues in 2026 (anchor lost on resize, jumps on Android, blurs header and footer, direction in RTL).
6. **Text-to-speech wants word/sentence highlighting, pacing control, skip-rules and a way to save what is being read.** Readium Speech and Thorium encode this as a library; Readest users file the gaps weekly.
7. **Lawyers' differentiator is "files never leave your computer" plus true redaction.** The only law-firm-specific tool found sells exactly that. This supports the end-to-end-encrypted, no-account relay as a positioning point, with the caveat that no lawyer was heard directly.
8. **Large files and timeouts hurt.** Stirling-PDF threads: OCR error after 390+ pages (#6925), 20-minute sync timeout kills large conversions (#7716-#7718), compression "silently ignored" (#7760). paper2remarkable users resize with Ghostscript by hand (#142).
9. **WebView on the DC-1 is Chromium 101** [PRIOR eink-tablets.md:49]. The arXiv HTML maintainer says "MathML support has just recently returned to Chrome 109" [OPENED https://github.com/dginev/ar5iv/issues/56 , 2023-01-24]. [INFER] arXiv/ar5iv math (LaTeXML emits MathML) will not render natively in the Reader's WebView; send-time conversion of math to SVG/PNG, or bundled MathJax in the Reader, is needed for the "read arXiv HTML on the DC-1" feature.
10. **Accessibility rules should not live behind the Lab toggle.** [INFER] Lab is on by default but can be turned off; VoiceOver labels, Dynamic Type and TalkBack support must be in the non-Lab build too. Lab can hold accessibility *extras* (comfort mode, spoken receipts).

## 3. Group A: academics and students

### 3.1 What the tools do today (docs)
- **ZotFile** [OPENED https://github.com/jlegewie/zotfile]: "Zotero plugin to manage your attachments: automatically rename, move, and attach PDFs ... sync PDFs from your Zotero library to your (mobile) PDF reader (e.g. an iPad, Android tablet, etc.), and extract PDF annotations." README: "Zotfile is currently not actively developed and maintained!" and "Updates are extremely rare and I will mostly not respond to issues and pull requests here on github." Extraction: "Zotfile can extracted annotations and highlighted text from many PDF files. But it will never be able to handle all files." (needs copyable text; pdf.js). Install section covers only Zotero 4/5. A recovery tool exists for Zotero 7: https://github.com/jlegewie/ZotFile-Recovery ("Recover tablet files from Zotfile in Zotero 7") [SNIPPET-ONLY].
- **bpiwowar/zotero-remarkable-sync** [OPENED]: "Tag-driven" (`@remarkable`), "Bidirectional", scheduled or on demand, Zotero 7 (up to 9), "reads and writes the undocumented `.rm` v6 format". Text highlights become Zotero highlights, freehand highlighter becomes translucent highlights, pen strokes become ink. Warnings: "This is an experimental add-on", "Bugs can reorder, corrupt, or delete annotations and files", "Back up your reMarkable data and your Zotero library before using it". "Safe mode" on by default: only pulls annotations and uploads PDFs; pushing Zotero annotations to the device "is the riskier path".
- **alfakini/zotero-reMarkable-plugin** [OPENED]: Zotero highlights, underlines, ink, area and text boxes are burned into the uploaded PDF, plus an appended "Zotero notes" page with each comment; tablet highlights come back as highlight annotations, pen strokes as ink, typed text as sticky notes; margin/notebook handwriting returns as an SVG drawing inside a child note (no OCR). Limits: "Syncing the same library from two computers duplicates documents and annotations", reverse-engineered protocol, "Large PDFs are rebuilt on Zotero's main thread, so Zotero can freeze for a while", EPUB unsupported, coordinates assume 226 dpi, rotated/landscape pages untested.
- **dipta007/zotRm** [OPENED]: `zotrm sync` sends PDFs from one named Zotero collection to a tablet folder; "Mirror sub-collections?" makes nested folders; returns annotations "as one annotated PDF" (original untouched, re-run refreshes rather than duplicating). Limits: "They do **not** come back as clickable Zotero highlights", annotated PDF is "a flattened image of your marks", needs reMarkable Connect, "File would exceed quota" with Zotero storage, no Windows.
- **melvinwevers/rm-zotero-sync** [OPENED]: macOS launchd script every 30 min; tag `to-remarkable` uploads to `/ToRead`; moving to `/Read` triggers a final pull and tag `annotated`; "Only annotations this script created are ever replaced".
- **paper2remarkable** [OPENED]: one command fetches from arXiv, ACL Web, ACM DL, CVF, DiVA, ECCC, IACR, JMLR, Nature, NBER, NeurIPS, OpenReview, PMLR, PubMed Central, SemanticScholar, SpringerLink, a generic PDF URL, local PDF/PS, or "any article on a website". Options: `-b` "Insert a blank page after each page ... (useful for note taking!)", `-c`/`-r` center or right-align, `-k` no crop, default crop removes "unnecessary whitespace", `--filename`, `-p` folder, `-n` no upload. Caveat: "Some tools for exporting a PDF with annotations do not handle different page sizes properly" (cropping changes page size). Web articles use readability-lxml and go over as PDF (maintainer, 2020-04-20, issue #44). USB web-API upload added (issue #142, closed 2025-01-04) for people who refuse the subscription/cloud.
- **zotero.koplugin** [OPENED]: browse collections and sub-collections on an e-reader, "Download & open attached PDF files", sync via Web API, WebDAV, search by title, first author or DOI. Attachments fetched on demand. Beta.
- **Zotero iOS / Connector** [OPENED lists]: Zotero iOS #220 "Option to download files at sync time" (open since 2021-03-13; maintainer: "redownloading gigabytes of files would be somewhat annoying", 2021-03-13; "We can do this now", 2022-05-05), #597 "Snapshot saving" (open; 2025-11-04 maintainer: "There will be more interest in this now that we support snapshot annotation."), Pencil eraser toggle #557 (closed). Connector #376 asks for a note text area in the save popup (dstillman 2022-02-15: "a three-line text area that gets turned into a child note might be nice"; the June-2025 shipment is from [PRIOR community-voice.md:182]). Zotero reader repo: "Zotero PDF/EPUB/HTML reader and annotator" [OPENED https://github.com/zotero/reader]; no release notes reachable (zotero.org does not resolve).
- **ar5iv / arXiv** [OPENED]: "A web service offering HTML5 articles from arXiv.org as converted with latexml", hosted by arXivLabs, 875 stars, 574 issues. arXiv's own HTML feedback repo has 3.3k issues [OPENED https://github.com/arXiv/html_feedback].
- **ScholarPhi / Semantic Scholar Reader** [OPENED https://github.com/allenai/scholarphi]: "an augmented PDF reader application"; its README lists API, data-processing scripts and UI only. Feature set (term definitions, citation cards) is [BG].
- **OCRmyPDF** [OPENED]: "adds an OCR text layer to scanned PDF files, allowing them to be searched or copy-pasted", PDF/A by default, deskew, "Optimizes PDF images, often producing files smaller than the input", "Scales properly to handle files with thousands of pages", needs Ghostscript and Tesseract.

### 3.2 Top 8 wants (ranked by editorial judgement)
1. **Two-way round trip with the library, annotations returning as real annotations.** "This would make annotations much more valuable as they are no longer isolated to one system." (ryanwwest, 2024-04-01, https://github.com/stelzch/zotero.koplugin/issues/13). Also "Sync annotations" #26 and "FR: File Uploads back to Zotero" #20 (mergen3107, 2024-10-03: wants to "Upload the file as per Zotero API - File Uploads" and keep "only upload and maintain one such file") [OPENED]. [OPENED]
2. **Pull the edited file back without deleting it from the tablet, and keep the original.** "One thing that would be nice to have is a new 'get file from tablet' that would update the local file with the file from the tablet ... but without removing it on the tablet. This is useful, to be able to modify several times a document and update it to zotero." (cdancette, 2019-06-25, https://github.com/jlegewie/zotfile/issues/413 , 4 thumbs-up; others +1 through 2023). "Keeping a pristine copy pdf alongside one annotated" (#226, 10 thumbs-up): "I would like instead, that Zotfile realizes that the '_annotated' is already there" (jmlorenzi, 2016-05-01). [OPENED]
3. **Batch / collection delivery.** "Ideal case is when I create a new collection, say `This evening`, put 10-12 articles ... and then go into KOReader and download them all to read." (mergen3107, 2023-12-27, https://github.com/stelzch/zotero.koplugin/issues/6; no comments, labelled enhancement). zotRm mirrors sub-collections as folders. [OPENED]
4. **Reading-friendly layout of papers on a small screen:** crop margins, optional blank page after each page, right-align so the margin is on the left for pen notes (paper2remarkable `-c/-r/-b`). [OPENED]
5. **Identifier-driven fetch with good filenames and metadata.** Paste an arXiv/abs link, PDF link, PMC or Semantic Scholar URL; also arXiv link variants such as "http://arxiv.org/abs/arXiv:1908.03213" were once "not recognised" (paper2remarkable #7). ZotFile's top feature requests are about renaming with citation keys (`%b` citation key, 11 thumbs-up, #661; "renaming to %b no longer works", 8, #386). zotero.koplugin searches "by the title of the publication, name of the first author or DOI". [OPENED]
6. **Papers as readable reflowable text, including math.** "My dream is to read scientific papers on my kindle, but most of the tools out there render papers very poorly." (Chechgm, 2022-02-11, https://github.com/dginev/ar5iv/issues/56). Workaround quoted there (2023-01-24, TheSeriousProgrammer): ar5iv page -> pandoc + GladTeX (math to PNG) -> EPUB; "Styling such as page borders was lost". [OPENED]
7. **Offline whole-library or large-file availability:** Zotero iOS #220 (above); big PDFs and textbooks are [BG] (the 100 MB+ case is not in any thread I opened; closest are Stirling and KOReader large-file reports in 3.4).
8. **Annotation export in a citation-ready shape:** "Format extracted annotations using markdown blockquotes" with page labels like "(p.2 highlight)" (joelostblom, 2020-01-31, https://github.com/jlegewie/zotfile/issues/454 , option 3 "my favorite"; "+1" 2020-02-29 and 2023-05-13). KOReader auto-export: "would there be a way to add a setting to automatically export your highlight files upon annotation?" (thegreekgeek, 2024-09-25), answered with an export profile that auto-runs on document close (https://github.com/koreader/koreader/issues/12556). Colored-highlight categories: "i hope colored highlights come soon. with the new eink color displays that would be awesome" (CobriMediaJulien, 2024-08-26, koplugin #13). [OPENED]

### 3.3 Top 5 hates
1. **Abandoned plumbing.** "I don' have any plans to make the necessary changes right now." (ZotFile maintainer, 2023-06-16, https://github.com/jlegewie/zotfile/issues/655 , 37 thumbs-up, "Zotero 7 support"). "Send to Tablet is another issue. No way of automating that like Zotfile did has been suggested as far as I know." (TW96, 2024-09-03, same thread) with cloud-synced linked files as a "clunky" workaround. A request for newer-Zotero support was still being filed on 2026-06-28 (#677) [SNIPPET-ONLY]. [OPENED]
2. **Destructive or fragile sync.** "Bugs can reorder, corrupt, or delete annotations and files." (bpiwowar README). "Syncing the same library from two computers duplicates documents and annotations." (alfakini README). "Documents moved to the tablet's trash are still synced until they are emptied". Each ZotFile round trip created another "_annotated" copy (#226). [OPENED]
3. **One-way or flattened annotations.** "They do **not** come back as clickable Zotero highlights" (zotRm). Koplugin: "Annotations are only synced one way and edits/deletes are not supported." (stelzch, 2024-10-12, #13); "I couldn't get my KOreader to sync any annotation to Zotero." (ulahcherubim, 2025-05-15, #26). Technical cause, quoted: "KOReader using XPointer to represent annotation positions" (Zotero uses CFI) and "A conversion is only possible with the document loaded and parsed in memory." (stelzch, 2024-11-04). [OPENED]
4. **Subscription and cloud dependence.** "since I do not want to use the subscription or the RM cloud ... I was so far uploading the PDFs to the RM using the USB web interface ... that involves a lot of manual steps (downloading of the paper, resizing using ghostscript, etc.)" (wittmeis, 2023-08-02, https://github.com/GjjvdBurg/paper2remarkable/issues/142). zotRm: "push and pull may not work" without reMarkable Connect. [OPENED]
5. **Setup friction and silent failures.** koplugin needs files copied into the KOReader plugins folder and an API key; "Cannot find Zotero on Ereader after installing" (#32), "Sync is successful but browse shows empty screen" (#5, 15 comments), "Groups not synchronizing" (#39), "Sync doesn't remove remotely deleted collections and articles" (#15) [SNIPPET-ONLY titles]. Zotero iOS share-extension defects (#398, #399, #403, #687) are in [PRIOR mobile-share-patterns.md:192, 218].

### 3.4 Best in class
- Round trip for Zotero users: no clear winner. Closest, by design: **bpiwowar/zotero-remarkable-sync** (native annotations, tag-driven, "safe mode" default) and **zotRm** (single refreshed annotated PDF, folder mirroring, tags for progress). Both are experimental.
- Paper acquisition and layout: **paper2remarkable** (385 stars): single command, many publishers, crop, blank page after each page, right-align, folder, filename.
- Capture on mobile: Zotero iOS share extension with collection/tag picker [PRIOR mobile-share-patterns.md:37].
- Annotation-heavy commercial tools (LiquidText, GoodNotes, Notability, PDF Expert, MarginNote) and paper managers (Paperpile, Papers): not researched [BG]. Do not cite as findings.

### 3.5 Lab feature candidates (academics and students)
| ID | Feature | Needs | Value | Notes |
|---|---|---|---|---|
| A1 | "Paper mode" send options: crop margins, blank note page after each page, right-align, keep original page size toggle (annotation tools break on changed sizes) | companion-only | high | PDF processing in the sender; Android needs a PDF lib; warn that cropping changes page geometry (paper2remarkable caveat) |
| A2 | Send by identifier: paste DOI, arXiv ID, PMID or paper URL; companion resolves the PDF and names it "Author Year Title" | companion-only | high | needs network fetch and per-publisher rules; arXiv/PMC/NeurIPS/OpenReview are the stable ones; paywalled sources fail gracefully |
| A3 | Send a folder / collection as one batch; keep folder structure in the Inbox; progress and per-item receipts | companion+inbox | high | zotero.koplugin #6, zotRm sub-collection mirroring |
| A4 | Return path: "Send back annotated" from Inbox: flattened PDF plus sidecar JSON of highlights (page, quote, note, color-as-label) | companion+inbox (+reader-change: Reader must export highlights and the pen layer) | high | see highlights-roundtrip.md rows 4 and 6; keeps pristine + annotated pair |
| A5 | Pristine + annotated pair as a first-class item ("v1 original", "v2 annotated"), never overwrite, never delete on tablet after pull | companion+inbox | high | ZotFile #226/#413 |
| A6 | Annotation export formats: Markdown blockquotes with page labels, BibTeX/DOI header, copy to Obsidian/Notes/Zotero note | companion-only (after A4) | medium-high | ZotFile #454; KOReader #12556 |
| A7 | Zotero 7 plugin "Send to Daylight": tag-driven (`@daylight`) like `@remarkable`, on-demand and scheduled, no reMarkable-style cloud in the middle | companion+inbox | high | the plugin ecosystem is wide open; pull-only "safe mode" default is the proven pattern |
| A8 | arXiv/HTML paper to EPUB or clean PDF with math handled (math as SVG/PNG at send time, because the WebView is Chromium 101) | companion-only; reader-change if MathML is expected natively | medium | ar5iv #56; owner wanted a "blessing from arXiv" before building an official export |
| A9 | Large-file send: chunked, resumable, optional compress (Ghostscript-style) and page-range send ("pp. 45-80 of 600") | companion-only (server relay limits are a separate check) | high | Stirling #6925/#7760; paper2remarkable #142; relay size limit not checked this run |
| A10 | OCR on send for scans (Apple Vision / Android ML Kit / OCRmyPDF on desktop) so Reader search and TTS work | companion-only | medium | OCRmyPDF is the reference; platform OCR is [BG] |
| A11 | Lecture slides handling: 2-up/4-up or crop-to-content for 16:9 slides on a portrait 10.5" panel | companion-only | medium | [BG]; KOReader has long-open PDF crop/zoom requests (#14779, #5524) |

## 4. Group B: lawyers and other long-PDF professionals

Evidence is thin. No lawyer discussing pen tablets was reachable. What follows is what law-oriented tools claim and what their users report.

### 4.1 What the tools do (docs)
- **RaioPDF** [OPENED https://github.com/Macrify-LLC/raiopdf]: "a free, fully-local desktop PDF suite for law firms" (repo description, created 2026-07-02, Tauri, 6 stars). Features: "Fully offline OCR for scanned documents"; redaction where "Content is actually removed and verified by re-extraction"; Bates numbering as one continuous sequence over a whole document set; "Pick your court's e-filing pack" with a preflight report with rule citations, page normalization and splitting oversized files into sequential parts; "Merge, split, reorder, extract, insert, insert a slip sheet anywhere, rotate, crop, repair"; PDF/A export; an Exhibit Stamp tool. Privacy: "Your files never leave your computer"; no telemetry, no document upload; "RaioPDF's only automatic internet access is a signed update check against GitHub Releases". README does not argue that confidentiality is the reason; it frames the case as avoiding cloud uploads and accounts.
- **Stirling-PDF** [OPENED]: "Edit, merge, split, sign, redact, convert, OCR, compress, and more", "50+ PDF tools"; "without sending documents to external services". README does not list Bates numbering, page-range split, watermark or flatten (may exist in docs; not confirmed).
- **X-Ray (Free Law Project)** [OPENED]: finds "bad redactions" (a black rectangle drawn over text that stays selectable). README: people "just draw a black rectangle or a black highlight on top of black text"; "you can select the text under the rectangle, and you can read it again". No accuracy numbers.
- **pdf-redactor** [OPENED]: redacts the text layer, plain text annotations, link URLs, the Document Information Dictionary and XMP metadata; "Graphical elements, images, and other embedded resources are not touched"; command line is a stub.
- **Marisol** (Bates numbering, stamping, redacting library) [SNIPPET-ONLY, 18 stars]; several small Bates tools [SNIPPET-ONLY].
- **RECAP extensions** (Chrome, Firefox, Safari) "used to liberate millions of documents from the PACER system" [OPENED https://github.com/freelawproject/recap-chrome]. Court-document capture is a browser-extension workflow; README has no privacy statement.

### 4.2 Top 8 wants
1. **Local-only handling.** "Your files never leave your computer."; "doesn't have to just accept whatever terms it's handed for a task this basic" (RaioPDF). Stirling: "without sending documents to external services". [INFER] E2EE with no server-side plaintext and no account is a selling point here; a confidentiality duty is the reason [BG: ABA Model Rule 1.6(c)]. No lawyer said this to me directly.
2. **True redaction**, not a black box. Stirling #4641 (kintaro1981, 2025-10-09): "Manual redact is only putting a layer over the text but if you copy and paste the text is still there ... Because is how people think the manual redact works." and "out putting a 'pdf image' is not an option as the pdf is no more accessible." Closed as resolved 2026-10-13. Stirling #7564 (2026-08-18): redacted text still copyable; "Fixed in v3.0.0" (2026-09-25). [OPENED]
3. **Bates numbering across a whole set in one pass**, plus exhibit stamps and slip sheets (RaioPDF).
4. **Offline OCR** of scanned records.
5. **E-filing prep:** split to size-limited parts, preflight, page normalization. RaioPDF's author: "Some features, like exporting a PDF into size-limited chunks, just don't seem to exist in Acrobat".
6. **Page organization:** merge, split, reorder, extract pages, insert slip sheets.
7. **Navigation in long documents:** bookmark list that scrolls on its own, printing with the real printer settings. Law-firm user PierceLegalGroup (2026-10-12): "when I am making bookmarks on a document, I can't scroll on just the bookmarks list" and "when I go to print, I can't edit my printer settings"; they used Adobe Acrobat as the workaround (https://github.com/Macrify-LLC/raiopdf/issues/377). The maintainer shipped "Contain bookmark scrolling and add printer paper size/source controls" the next day. [OPENED]
8. **Metadata hygiene and archival output:** pdf-redactor strips Title/Author and XMP; RaioPDF exports PDF/A and "warns about unapplied redaction marks". [OPENED]

### 4.3 Top 5 hates
1. **Acrobat cost and friction.** "Nobody at my firm likes dealing with Acrobat." "its licensing quirks can bring work to a standstill" "we're paying thousands for the privilege" (RaioPDF README).
2. **Fake redactions that leak.** X-Ray README (above); Stirling #4641/#7564.
3. **Redaction misplacement and bloat.** Stirling #8084 "Auto-Redact places redaction box at wrong position on PDFs with /Rotate 90", #7102 "automatic redactions are offset from word location", #4462 "Redacting a PDF increases file size multiple times" [SNIPPET-ONLY titles].
4. **Large-document failure.** Stirling #6925 "OCR error after 390+ pages", #7716-#7718 "20-minute hardcoded sync timeout kills large PDF to Word conversion", #7081 "Automate aborts operations after five minutes", #7760 "optimize level being silently ignored" [SNIPPET-ONLY titles].
5. **Alpha-quality markup tools.** RaioPDF's own known-issues list (2026-07-05): "Selections can be hard to grab or can land in the wrong spot", "The basic workflows work, but selection, placement, editing controls, and feedback are rougher than they should be." [OPENED https://github.com/Macrify-LLC/raiopdf/issues/158]

### 4.4 Best in class
- Prep before sending: **RaioPDF** (OCR, verified redaction, Bates, e-filing split, all local) among the open tools I could see; Acrobat is the incumbent [BG].
- Pen review on a tablet: not established. [BG] lawyers use iPad apps (GoodNotes, Notability, PDF Expert, Acrobat Reader) and reMarkable; unverified.
- Does E2EE / no cloud matter to them? Evidence says the tools that win mind-share with law firms lead with it; direct testimony missing.

### 4.5 Lab feature candidates
| ID | Feature | Needs | Value | Notes |
|---|---|---|---|---|
| B1 | "Send exactly as-is" mode: no recompress, no re-render; SHA-256 shown on sender and Inbox, included in the delivery receipt | companion+inbox | high | [INFER] integrity and chain of custody matter for legal documents; cheap on top of the existing receipts |
| B2 | Pre-send check: flag un-burned redaction rectangles (X-Ray heuristic) and offer metadata strip (Author, Title, XMP) | companion-only | medium | detection is heuristic; present as a warning, never a guarantee |
| B3 | Ephemeral delivery: relay deletes ciphertext on delivery (or after N days); Inbox auto-removes after N days or on "finished" | companion+inbox (+server for TTL) | high | supports the confidentiality story; relay retention policy not checked this run |
| B4 | Page-range and exhibit send (pp. 120-185 of a 2,000-page production) | companion-only | high | also helps students (A9) |
| B5 | Bates-aware Reader: show Bates labels, "go to Bates number", keep bookmarks/outline as a scrollable list | reader-change | medium | RaioPDF #377 shows bookmark navigation is a real pain point |
| B6 | Matter folders: a "matter" is a named batch; Inbox groups by it | companion+inbox | medium | reuses A3 |
| B7 | Inbox lock (biometric/PIN) for confidential items | companion+inbox / reader-change | medium | depends on what the DC-1 Android build offers; not verified |
| B8 | Return flattened annotated PDF plus a comments list (page, text) for redlining | companion+inbox (+reader-change) | medium | same machinery as A4 |

## 5. Group C: writers and journalists

### 5.1 What the tools do (docs)
- **remarks** [OPENED https://github.com/lucasrla/remarks]: extracts highlights and scribbles from annotated documents to Markdown, PDF, PNG, SVG; text highlights to Markdown for Obsidian/Roam; OCR via OCRmyPDF optional. Limits: "does NOT work with annotations created by reMarkable sofware >= 3.0 yet"; "experimental and likely to break after tablet software updates"; hobby project, no warranty.
- **Scrybble** [OPENED https://github.com/Scrybbling-together/scrybble-site]: reMarkable sync to an annotated PDF "or a bunch of markdown" (Obsidian); depends on RMapi; self-host emphasis: "Because Scrybble is entirely open-source, you are free to self-host"; auth file "grants access to your data ... never ever publish it".
- **pandoc** [OPENED]: "a Haskell library for converting from one markup format to another"; writes `markdown`, `epub`/`epub3`, `docx`, `jira`; PDF via LaTeX, Groff ms or HTML. Scrivener is not mentioned in the README (Scrivener's own Compile/Share path is [BG]).
- **Dangerzone** [OPENED]: for documents "that you don't know if you can trust ... (for example, an email attachment)". Converts the document to PDF, then to "raw pixel data" inside a sandbox, then back to a PDF outside. The README names no audience and says nothing of OCR.
- **SecureDrop** [OPENED]: "an open-source whistleblower submission system that media organizations can use to securely accept documents from, and communicate with anonymous sources"; separate guides for sources, journalists, administrators.
- **KOReader highlight auto-export** [OPENED https://github.com/koreader/koreader/issues/12556]: export profile that runs on document close; "markdown is a local format. That will work if the obsidian vault runs on the same computer as KO." (pazos, 2024-09-30).
- pocket2rm (Pocket URLs to EPUB for reMarkable) is named by its author in paper2remarkable #44 (GliderGeek, 2020-04-18) [OPENED]. [PRIOR highlights-roundtrip.md:57-93] covers rmapi, rmfakecloud, remarks, Scrybble and the "one-way everywhere" finding.

### 5.2 Top 8 wants
1. **Draft to tablet in a form that reads well:** Markdown, DOCX, or compiled PDF/EPUB. The Reader already converts "DOCX/PPTX/Markdown/HTML/TXT ... on device" [PRIOR eink-tablets.md:49-51]. [BG] writers send Scrivener-compiled PDF/EPUB.
2. **Pen markup comes home as something editable:** annotated PDF plus extracted text (remarks: "Markdown, PDF, PNG, SVG").
3. **Handwriting to text / Markdown** into Obsidian-like tools (Scrybble outputs Markdown; alfakini returns handwriting as SVG child notes, "Handwriting is not converted to text"). [PRIOR highlights-roundtrip.md:196 row 7: local OCR on Mac/iPhone, medium]
4. **Automatic highlight export to Markdown when you close the document** (KOReader #12556).
5. **Clean research clippings:** readability extraction before sending (paper2remarkable uses readability-lxml).
6. **Self-hostable, no vendor cloud** (Scrybble, paper2remarkable #142).
7. **Safe handling of untrusted or sensitive documents** (Dangerzone, SecureDrop); [INFER] journalists will value "no cloud, no account" for the same reason lawyers do.
8. **Court and public-record documents on the tablet** (RECAP workflow in a browser extension) [INFER from the README one-liner].

### 5.3 Top 5 hates
1. **Unofficial, breakable pipelines.** remarks: "does NOT work with annotations created by reMarkable sofware >= 3.0 yet"; bpiwowar: ".rm v6 ... undocumented format".
2. **Subscription dependence:** zotRm needs reMarkable Connect; remarkable-mcp cloud mode "Requires a reMarkable Connect subscription" [PRIOR highlights-roundtrip.md:91].
3. **Flattened-only returns** (zotRm: "a flattened image of your marks").
4. **Styling lost in conversion:** ar5iv #56: "Styling such as page borders was lost" after pandoc/GladTeX (paraphrase of TheSeriousProgrammer, 2023-01-24).
5. **Credential risk:** Scrybble warns the reMarkable auth file must never be published; local-only Markdown export only works when the vault is on the same machine (KOReader #12556).

### 5.4 Best in class
- Handwriting/annotation to Markdown: **Scrybble / remarks** (reMarkable).
- Highlights out on close: **KOReader export profiles**.
- Format conversion: **pandoc**.
- Untrusted-document hygiene: **Dangerzone**.

### 5.5 Lab feature candidates
| ID | Feature | Needs | Value | Notes |
|---|---|---|---|---|
| C1 | "Send as draft": Markdown/DOCX/TXT sent as-is with a typography preset (serif, large, wide margins); re-sending the same filename creates "v2" instead of a duplicate | companion+inbox | medium | ZotFile-style duplicate complaints (#226) |
| C2 | Quote clip: send a selection with source URL, formatted as a blockquote plus citation line | companion-only | medium | browser extension and share sheet; selection capture exists as a mode in other clippers [PRIOR browser-clippers.md:208] |
| C3 | Handwriting to text: Inbox exports ink pages; phone/Mac OCRs and drops Markdown into Notes/Obsidian/Drafts | companion+inbox (+reader-change) | high | [PRIOR highlights-roundtrip.md row 7] |
| C4 | Highlights-on-close export to Markdown with source link and page (outbox event) | reader-change + companion+inbox | high | KOReader #12556 |
| C5 | "Safe open" for untrusted files: flatten to pixels on the sender, Dangerzone-style, before delivery | companion-only (desktop only) | low-medium | heavy; Mac/Windows only |
| C6 | Mac Share-menu accepts Scrivener/Ulysses/iA Writer exports (.epub, .docx, .pdf, .md) with a "Send as Markdown" action | companion-only | medium | [BG] app behaviour |

## 6. Group D: ADHD, dyslexia and low-vision readers

### 6.1 What the products and projects do
- **Reading ruler (Readest)** [OPENED]: a configurable band that dims the rest of the page. Issue history 2026: #3011 request "Reading ruler / line highlight to guide reading (Kindle-style)" (neura-neura, 2026-01-21); bugs on Android (#3197, #3270 "glitches out and jumps around"), anchor lost (#5491), direction in RTL (#4865), header and footer blurred (#5174, 2026-07-22 and 2026-08-27); improvement requests for "repeat last line" on page turn, separate controls for ruler vs page turns, tap-to-move and selectable text (#3207, #5174). E-ink: #6048 and its fix (PR #6055, 2026-09-04): on black-and-white e-ink the tint is removed and the ruler becomes "a clear band"; "The outline is always drawn at full opacity".
- **Bionic Reading:** projects: bionic-for-zotero (399 stars; "implements a bionic reading experience in the Zotero reader", on by default, View-menu toggle; README: "The effectiveness of Bionic Reading is a subject of ongoing debate") [OPENED], Colorful-Bionic (139), text-vide (287), PrimusRead (537, "export bionic EPUB", claims up to 30% less reading time, unverified) [SNIPPET-ONLY]. KOReader thread below. Readest closed "Bionify" as a duplicate of "Bionic Reading Font" (#1819) [OPENED].
- **Dyslexia fonts:** OpenDyslexic GitHub repo archived by its owner 2025-08-11, sources moved; the repo page cites no studies, says it helps "offset some visual symptoms of Dyslexia" [OPENED]. Atkinson Hyperlegible: Braille Institute, "a new typeface, offering greater legibility and readability for low vision readers", "focuses on letterform distinction to increase character recognition", SIL OFL 1.1; the repo was archived 2026-04-19 and the README points to Google Fonts [OPENED]. Instapaper 10 added Atkinson Hyperlegible plus Literata, New York, Open Sans [PRIOR read-later-apps.md:29]. Readest answer to an OpenDyslexic request (2026-05-22): "you can import custom TTF/OTF font files through Settings -> Font -> Custom Fonts." [OPENED #4264]
- **TTS with highlighting:** Readium Speech: "Highlighting: content currently being spoken (e.g. the current word or sentence) can be highlighted as playback progresses", plus adjustable verbosity for roles such as chapters and footnotes [OPENED]. Thorium proposes verbosity levels "some, most, or all" (#3523, 2026-05-28) and states "verbosity should be selective, semantic, and user-centred, not exhaustive" [OPENED]. Thorium's README: "A great care is taken to ensure the accessibility of the application for visual impaired people using NVDA, JAWS or Narrator." [OPENED]. Commercial TTS: Matter HD TTS, Instapaper AI Voices, Readwise Reader TTS [PRIOR read-later-apps.md:55,67; readwise-reader.md:96-98]; Omnivore's TTS kept the text visible [PRIOR community-voice.md:364]. Speechify, Voice Dream, ElevenReader: [BG] only.
- **RSVP / word-at-a-time:** KOReader #13206 (zeedif, 2025-02-03) [OPENED].
- **Backlog helpers:** wallabag has a random button and partly-read tracking requests [OPENED].
- **Hobby extensions that bundle ruler + font + bionic + TTS** (dyslexia-tool, readapt, dyslexaid, cadence, focusread...) all have 0 to 1 stars [SNIPPET-ONLY]; they show what people try to assemble, not proven demand.

### 6.2 Top 8 wants
1. **Optional bionic-style emphasis that can be tuned and excluded.** For: "People with ADHD like this very much. People with Dyslexia also love this." and Reddit testimony relayed in the thread: "I've struggled with reading my whole life, and I finally feel like I can read!" (offset-torque, 2025-10-01, https://github.com/koreader/koreader/issues/9109); "I am one of those who struggles with focusing ... I also think this 'Fast Font' is worth being included by default with KOreader" (LinuxRenaissance, 2026-03-15). Users also ask for control: skip "in the on of", formulas, citations, add a glossary, gradient color, EPUB (bionic-for-zotero #15, #59, #61, #52, #66, #16). [OPENED / SNIPPET-ONLY titles]
2. **A reading ruler / current-line focus.** "it is easy to lose the current line after scrolling or moving the eyes away from the screen. This slows down reading and increases eye strain" and the aid "is widely appreciated for improving focus, reading comfort, and accessibility" (neura-neura, 2026-01-21, https://github.com/readest/readest/issues/3011). "the reading ruler is fantastic" (shahram7, 2026-07-17, #5174). [OPENED]
3. **Fonts and spacing for dyslexia and low vision:** OpenDyslexic ("It would be awesome if you could add a dyslexic friendly font which as open dyslexic", mdeloughry, 2026-05-22), Atkinson Hyperlegible, and user control of line, letter, word and paragraph spacing. WCAG 1.4.12 intent: "People with dyslexia may increase spacing between lines, words, and letters to read faster." [OPENED]
4. **TTS with synchronized highlight, human pacing, and skip rules.** "Right now every sentence gets read with the same flat pacing ... A human narrator naturally pauses a beat longer after a question" (cleveland-lewis, 2026-09-26, https://github.com/readest/readest/issues/6412 , shipped 2026-09-29). "FR: Skip typesetting HTML such as <sup>17</sup> when reading EPUBs aloud" (#6790). "FR: Make TTS warn when theres an IMAGE" (#6443) [SNIPPET-ONLY titles]. [OPENED #6412]
5. **Save what is being read aloud as a highlight, without a keyboard shortcut.** DailyKernel31 (2026-10-05): the Shift + M hotkey is "less convenient on mobile devices and less discoverable than a visible button" (https://github.com/readest/readest/issues/6661 , closed as duplicate of #6060 "TTS bookmark button and media notification action"). [OPENED]
6. **Know where I was; pick something to read.** "When I read a large article from random ones, and then it's difficult to find it to continue reading." (vistar, 2026-01-19, https://github.com/wallabag/wallabag/issues/8640). Random unread: "It opens a random bookmark FROM THE CURRENT LIST." (f0086, 2023-02-21, #6322: wanted the random button to pick unread articles; "This took me quite some time to realize"). [OPENED]
7. **Calm, distraction-light surface.** Dyslexia/ADHD hobby extensions all bundle a "calm mode" or "focus mode" [SNIPPET-ONLY]; RSVP is requested but contested (6.3). [INFER]
8. **Backlog that does not accumulate guilt** (the "read-later graveyard"): not evidenced by anything I could open. [BG] Common remedies in read-later apps: auto-archive after N days, caps, daily review, "read next". The only on-topic hit is Karakeep's search, which returned nothing relevant on page 1. **NOT COLLECTED.**

### 6.3 Top 5 hates
1. **Forced or overhyped Bionic Reading.** "That's horrific. It physically hurts my brain, I couldn't finish a paragraph." (Reddit quote relayed by offset-torque, 2025-10-01, koreader #9109). "we found no evidence that Bionic Reading has any positive effect on reading speed." (offset-torque, 2022-08-03, relaying a Readwise study of 2,074 testers; the Readwise page itself NOT opened). "Current scientific evidence does not support the claim that Bionic Reading reliably increases reading speed." (chrox, Readest maintainer, 2026-09-17, #6235). Same Readest comment: "Evidence for readers with dyslexia or other specific learning disabilities remains limited." Also reported: "a 10% slower reading speed in their own test" (offset-torque summary, 2025-10-01). [OPENED]
2. **Color-only cues on a grayscale panel** (3 above).
3. **TTS defects that break focus or flow:** "TTS stutters at chapter boundaries: preload only covers 180s of the next chapter" (#6914), "Read Aloud steals annotation editor focus and interrupts Chinese IME composition" (#6837), "Read Aloud resets the Annotations sidebar to Table of Contents on sentence updates" (#6836), "On Android, tapping the Readest TTS media pill opens YouTube (or nothing at all) instead of Readest" (#6353), "Edge Read Aloud stops mid-book and can skip sentences after resume on Android" (#6773, 14 comments); Thorium: "Screen reader focus is lost when read aloud stops" (#3828), "Read-aloud silently discards all <sub> and <sup> text content" (#3778). [SNIPPET-ONLY titles from the issue lists; #6661/#6412 OPENED]
4. **Ruler glitches** (6.1).
5. **Hidden or confusing settings.** "I can't find the settings to change the offset. please help me out" (Kaidep13, 2026-10-02, https://github.com/windingwind/bionic-for-zotero/issues/63); whole words bolded because PDF text extraction failed (windingwind, 2025-05-10, paraphrase from Chinese). [OPENED]
(Also in the KOReader RSVP thread: "KOReader is an e-ink focused reader ..." RSVP "practically impossible on e-ink due to refresh rate and ghosting" (offset-torque, 2025-02-04); later "if the WPM is low enough, this can work on e-ink too" after testing a plugin on a Libra (2025-06-24). The DC-1 is a 120 Hz reflective LCD, not E Ink [PRIOR], so the e-ink objection applies less. [INFER])

### 6.4 Best in class
- **Reading aids on e-ink:** Readest (ruler with explicit e-ink handling, custom fonts, TTS with highlight) among open readers I could see. [OPENED issues]
- **Accessible reader built for screen readers:** Thorium Reader (NVDA/JAWS/Narrator, verbose read-aloud mode design). [OPENED]
- **Low-vision typeface:** Atkinson Hyperlegible (also in Instapaper 10). [OPENED / PRIOR]
- **TTS:** Matter HD TTS and Instapaper AI Voices among read-later apps [PRIOR]; Voice Dream, Speechify, ElevenReader [BG, not researched].
- **ADHD-specific:** no product I could verify.

### 6.5 Lab feature candidates
| ID | Feature | Needs | Value | Notes |
|---|---|---|---|---|
| D1 | Reader "Reading aids" panel: line ruler (clear band + outline, no tint on grayscale), line/letter/word/paragraph spacing sliders, font picker with Atkinson Hyperlegible, OpenDyslexic, Lexend (import as custom fonts) | reader-change | high | Readest #6048/#3011/#4264; WCAG 1.4.12 |
| D2 | Bionic-style emphasis as an optional, per-document toggle, implemented as a font or CSS (not by rewriting text), default off, with exclusions for short words, numbers, formulas, citations | reader-change (companion can pre-style HTML at send time) | medium | contested evidence; maintainers prefer a font |
| D3 | "Send with reading preset": companion tags a send with a typography preset (Dyslexia, Low vision, Standard) that the Reader applies on open | companion+inbox + reader-change | medium | protocol field, not a Reader redesign |
| D4 | Listen: phone/Mac reads the queue aloud (system voices) and Reader TTS with sentence highlight, pace controls, skip footnotes/sup, "save this sentence as highlight" button | companion-only (phone) + reader-change (Reader) | medium-high | Readest #6412/#6661/#6790; Readium Speech design; Google TTS is installed on probe DC-1 units [PRIOR eink-tablets.md:49] |
| D5 | Calm queue: one-at-a-time view, "Read next" pick, random unread, snooze, optional auto-archive after N days, weekly digest instead of badges; no streak guilt by default | companion+inbox | medium-high | wallabag #6322/#8640 are the only hard evidence; the rest is [BG] |
| D6 | Progress back to the phone: opened, % read, finished, "continue on phone" | companion+inbox (+reader-change) | medium-high | [PRIOR highlights-roundtrip.md rows 1 and 8]; wallabag #8640 |
| D7 | RSVP / word-runner mode, opt-in, low WPM default | reader-change | low-medium | contested; DC-1 120 Hz makes it feasible; keep out of default UI |
| D8 | Grayscale-first, high-contrast, large-text UI palettes in every companion (no color-only status) | companion-only | high | see Group E |

## 7. Group E: accessibility of the companions themselves

### 7.1 Sources of rules
Apple HIG (Accessibility, Typography, VoiceOver, Motion) [OPENED JSON]; Android Developers (Build accessible apps; Principles; Test; Compose accessibility), last updated 2026-04-16 to 2026-09-22 [OPENED]; WCAG 2.2 Understanding pages [OPENED]; axe-core [OPENED]. The DC-1 Inbox is an Android app, so Android rules apply on the tablet as well as on phones. Whether TalkBack is present and usable on the DC-1 build is NOT verified.

### 7.2 Key rules (quoted)
**Apple (iPhone, Mac)**
- VoiceOver: "Provide alternative labels for all key interface elements." "Exclude purely decorative images from VoiceOver." "Inform VoiceOver when visible content or layout changes occur." "Specify how elements are grouped, ordered, or linked." "Support the VoiceOver rotor when possible." "Offer unique titles that succinctly describe each page's content and purpose." (voiceover.json)
- Dynamic Type: "Ideally, give people the option to enlarge text by at least 200 percent". "Make sure your app's layout adapts to all font sizes ... turn on Larger Accessibility Text Sizes ... and confirm that your app remains comfortably readable." Sizes run xSmall to xxxLarge, then AX1 to AX5. "Avoid truncating text in scrollable regions". "Reduce the number of columns when the font size increases". "macOS doesn't support Dynamic Type." Default/minimum text sizes: iOS 17/11 pt, macOS 13/10 pt. Avoid Ultralight, Thin, Light weights. (typography.json, accessibility.json)
- Controls: iOS default 44x44 pt (minimum 28x28), macOS 28x28 (minimum 20x20); padding about 12 pt around bezeled elements, about 24 pt around unbezeled ones. "Offer alternatives to gestures ... if you use a swipe gesture to dismiss a view, also make a button available".
- Switch Control: "Support Switch Control." Full Keyboard Access: "Let people use the keyboard alone to navigate and interact with your app ... Avoid overriding system-defined keyboard shortcuts".
- Cognitive: "Views and controls that auto-dismiss on a timer can be problematic ... Prefer dismissing views with an explicit action."
- Reduce Motion: "reduce automatic and repetitive animations, including zooming, scaling, and peripheral motion." "Make motion optional." "Let people cancel motion."
- Contrast: "Strive to meet color contrast minimum standards": 4.5:1 up to 17 pt, 3:1 at 18 pt or bold; "provide a higher contrast color scheme when ... Increase Contrast is turned on." "Prefer system-defined colors."

**Android (phone and DC-1 Inbox)**
- Labels: "Each label must explain the semantics of a particular element"; decorative images `contentDescription = null`; labels unique within a collection; "Avoid redundancies ... make the button's description 'Submit', not 'Submit button'". Group with `mergeDescendants`; headings via `heading` semantics; "Use unique pane titles". Complex gestures: use `customActions` (e.g. "Remove article from list").
- Touch targets: "at least of 48dpx48dp. Larger is even better." Text contrast "at least 4.5:1" for text under 18sp (14sp bold), otherwise 3:1.
- Cues: "use cues other than color to distinguish UI elements". Media: "Include controls that allow users to pause or stop the media, change the volume".
- Testing: TalkBack ("Can you reach every element by swiping?", "If alerts or other temporary messages appear, are they read aloud?"); Switch Access ("Is all functionality that's available through touch screen gestures also available as selectable controls or custom actions within Switch Access?", "Is each item highlighted only once?"); Accessibility Scanner; Compose UI Check mode; automated semantics-tree tests. "the Android Accessibility Test Framework in Android Studio can't detect issues that occur when the app is running on a device."
- Font scaling and 200% were not on the pages I could open (Compose "user-scalable content" page returned 404 at the URL I guessed). Android non-linear font scaling to 200% is [BG].

**Web (Chrome/Safari extensions, web sender page)**
- Target size minimum: "targets to be at least 24 by 24 CSS pixels" with spacing/equivalent/inline/user-agent/essential exceptions (WCAG 2.5.8).
- Text spacing: content must survive user overrides; intent names low vision and dyslexia (WCAG 1.4.12). Numeric values (1.5 line height, 2x paragraph, 0.12em letter, 0.16em word) are [BG] because the Understanding page I opened omitted them.
- Reflow: content reflows "when narrowed to a width equivalent to 320 CSS pixels" (about a 1280px window at 400% zoom) (WCAG 1.4.10).
- Animation: honor `prefers-reduced-motion`; "Some users experience distraction or nausea from animated content." (WCAG 2.3.3 Understanding).
- Automated checking: axe-core finds "on average 57% of WCAG issues automatically"; the rest needs a human. Run `axe.run()` at each point a new piece of UI is exposed.

### 7.3 Product-specific risks seen in the evidence
- Zotero iOS share-extension defects (Cancel clashing with search, clipped dialogs, false failure state) show that share-extension UI is easy to break [PRIOR mobile-share-patterns.md:192,218,304].
- Status that depends on an icon with a red X (Zotero #398) is a color/icon-only signal [PRIOR]; companions should add text.
- [INFER] QR pairing is not usable by blind or low-vision users; the six-character code path must be equally complete. Delivery receipts should be announced (VoiceOver `AccessibilityNotification`, Android live region), not only shown.
- [INFER] The DC-1 is grayscale: no color-only encoding in the Inbox either.

### 7.4 QA accessibility checklist (apply to every companion)
Mark each item PASS / FAIL / N-A per surface: iPhone app, iPhone share extension, Mac app, Mac Share menu, Safari extension, Chrome extension (popup and options), web sender page, Android phone app, Android share target, DC-1 Inbox.

1. **Screen reader, full task.** With VoiceOver (iOS, macOS), TalkBack (Android) and a desktop screen reader on web, complete: pair a device, send a link, send a page, send a PDF, see the delivery receipt, resend after failure. Swipe through every element; every interactive element has a unique, short label; no "button" in the label; decorative images hidden; headings and screen titles unique.
2. **Status is announced.** Progress, success, failure and delivery receipt are spoken (VoiceOver notification / Android live region / `aria-live`), not only shown.
3. **Not color-only.** Every state (sent, delivered, opened, failed) has text or shape, and still reads in 100% grayscale (screenshot the DC-1 build in grayscale to check).
4. **Text scaling.** iOS Dynamic Type through AX5 with Larger Accessibility Sizes on; Android font size and display size at the largest setting; web at 200% text and 400% zoom (reflow at 320 CSS px). No truncated action labels, no overlap, share sheet still usable, no horizontal scroll.
5. **Target size.** iOS controls at least 44x44 pt; Android at least 48x48 dp; web at least 24x24 CSS px (WCAG 2.5.8) with spacing; extension toolbar popup included.
6. **Contrast.** Text 4.5:1 (3:1 for large or bold); UI components 3:1; check light, dark and Increase Contrast / high-contrast / forced-colors modes; use system colors where possible.
7. **Keyboard and switch.** Full Keyboard Access (macOS/iOS with keyboard), Android Switch Access scanning (volume keys per Google's test steps), and web Tab/Shift-Tab/Enter/Esc: every function reachable; visible focus; no focus trap; focus returns to the trigger when a popup or sheet closes; no system shortcut overridden.
8. **Gesture alternatives.** Any swipe, long-press, drag or drag-and-drop (web sender) has a button or menu equivalent (`customActions` on Android; accessibility actions on iOS).
9. **Reduced motion.** With Reduce Motion (iOS/macOS), "Remove animations" (Android) and `prefers-reduced-motion`, no zooming, parallax or auto-playing transitions; motion is optional and cancelable. On the DC-1, default to no animation.
10. **No timeouts.** No auto-dismissing toast is the only place an error or receipt appears; pairing codes do not expire in under a few minutes or can be regenerated without losing place.
11. **Pairing without a camera.** The typed or spoken code path is complete and labelled; QR is never the only way.
12. **Errors.** Plain-language message, says what to do next, is focusable and announced; the Outbox shows failed items as text with a Retry control.
13. **Forms and settings.** Every field has a persistent visible label; Lab toggle has an on/off state exposed to assistive tech (switch role, state read aloud) and a plain-language description.
14. **Language and reading order.** Reading order follows visual order; right-to-left and language tags correct; long titles wrap rather than clip.
15. **Automated pass plus manual pass.** Web: axe-core in CI (finds about 57% on average, so it never replaces items 1-14). Android: Accessibility Scanner on a device and Compose UI Check; Apple: Accessibility Inspector (and an XCUITest accessibility audit, [BG]). Record screen-reader transcripts as evidence.
16. **Lab neutrality.** Run the whole checklist with Lab ON and OFF. Accessibility must not depend on the Lab toggle.

### 7.5 Lab feature candidates (accessibility)
| ID | Feature | Needs | Value | Notes |
|---|---|---|---|---|
| E1 | Spoken and haptic delivery receipts ("Delivered to your Daylight") | companion-only | medium | HIG: pair audio cues with haptics |
| E2 | "Comfort mode" in the Inbox and sender: larger text, higher contrast, fewer columns, reduced motion, grayscale-safe palette | companion-only | high | HIG: reduce columns at large sizes |
| E3 | Typed-code pairing with spoken confirmation (screen-reader friendly) | companion+inbox | high | [INFER] |
| E4 | Accessibility regression gate: axe-core in CI for web and extension, Compose UI Check and Accessibility Scanner for Android, screen-reader transcripts attached to each release | n/a (process) | high | not a user feature |

## 8. Consolidated Lab candidate list (priority order, mine)
High: A4/A5 round trip with pristine + annotated pair; A3 batch/collection send; A1 paper mode; A2 send by identifier; A9 large-file/page-range send (with B4); A7 Zotero 7 plugin; B1 integrity hash in receipts; B3 ephemeral delivery; D1 reading aids panel; D8/E2 comfort mode and grayscale-safe UI; E3 typed-code pairing; C3/C4 handwriting-to-text and highlights-on-close.
Medium: A6 annotation export formats; A8 arXiv HTML/EPUB with math; A10 OCR on send; B2 redaction-leak warning; B5 Bates-aware Reader; D2 bionic as optional font/CSS; D3 reading preset on send; D4 TTS features; D5 calm queue; D6 progress back to phone; C1/C2/C6.
Low: D7 RSVP; C5 safe-open; A11 slides layout; B7 inbox lock.

## 9. Consolidated frustrations (for the summary)
1. Tools get abandoned or break on new versions (ZotFile 37 thumbs-up for Zotero 7 support; remarks stops at reMarkable 3.0; `.rm` v6 undocumented).
2. Sync that can corrupt, duplicate or delete (bpiwowar, alfakini, ZotFile "_annotated" copies).
3. Annotations come back flattened or one-way.
4. Subscription and cloud lock-in (reMarkable Connect; people use USB web API to avoid it).
5. Manual resize, crop, rename work for every paper.
6. Fake redaction and metadata leaks; failure on big documents.
7. Bionic Reading forced or unproven; color-only cues; unstable rulers; TTS flat, stuttering, stealing focus.
8. Hidden settings and unexplained behaviour.

## 10. Gaps and how to close them
1. Reopen WebSearch with a fresh per-turn budget (raise `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`) and run the 30 queries this brief planned: r/ADHD and r/dyslexia read-later threads; r/Zotero and Zotero forum threads on tablets, ZotFile and Zotero 7 workflows; r/LawFirm and law-practice blogs on moving PDFs to pen tablets; r/Journalism and writer forums on Scrivener-to-tablet; Voice Dream, Speechify, ElevenReader and Instapaper AI Voices reviews.
2. Allow or paste text from: forum.zotero.org, reddit.com threads, news.ycombinator.com / hn.algolia.com, apps.apple.com and play.google.com reviews, chromewebstore.google.com reviews, zotero.org changelog, readwise.io (the 2,074-tester Bionic Reading study), webaim.org survey pages (screen-reader user surveys), developer.chrome.com (extension accessibility), support.apple.com.
3. Ask the Daylight side: does the DC-1 build include TalkBack and Select to Speak? Which fonts ship? What is the relay's maximum file size and retention? Those decide A9, B3 and E-checks.
4. Verify the Readest, KOReader and Thorium quotes by opening the cited issue URLs; summaries here are capped at about 125 characters per quote.

## 11. URL index (all pages touched)
GitHub, projects: https://github.com/jlegewie/zotfile , https://github.com/jlegewie/ZotFile-Recovery , https://github.com/daidaishengweinan/zotero-file , https://github.com/bpiwowar/zotero-remarkable-sync , https://github.com/alfakini/zotero-reMarkable-plugin , https://github.com/melvinwevers/rm-zotero-sync , https://github.com/dipta007/zotRm , https://github.com/GjjvdBurg/paper2remarkable , https://github.com/N-McA/remarkable-arxiv , https://github.com/stelzch/zotero.koplugin , https://github.com/zotero/reader , https://github.com/zotero/zotero-ios , https://github.com/zotero/zotero-connectors , https://github.com/dginev/ar5iv , https://github.com/arXiv/html_feedback , https://github.com/allenai/scholarphi , https://github.com/hypothesis/client , https://github.com/ocrmypdf/OCRmyPDF , https://github.com/jgm/pandoc , https://github.com/lucasrla/remarks , https://github.com/Scrybbling-together/scrybble-site , https://github.com/Macrify-LLC/raiopdf , https://github.com/Stirling-Tools/Stirling-PDF , https://github.com/freelawproject/x-ray , https://github.com/freelawproject/recap-chrome , https://github.com/JoshData/pdf-redactor , https://github.com/wikkiewikkie/Marisol , https://github.com/freedomofpress/dangerzone , https://github.com/freedomofpress/securedrop , https://github.com/koreader/koreader , https://github.com/readest/readest , https://github.com/koodo-reader/koodo-reader , https://github.com/edrlab/thorium-reader , https://github.com/readium/speech , https://github.com/windingwind/bionic-for-zotero , https://github.com/DrUsagi/Colorful-Bionic , https://github.com/Gumball12/text-vide , https://github.com/crisanlucid/primusread , https://github.com/wallabag/wallabag , https://github.com/karakeep-app/karakeep , https://github.com/googlefonts/atkinson-hyperlegible , https://github.com/antijingoist/opendyslexic , https://github.com/dequelabs/axe-core
GitHub, issue threads quoted: https://github.com/jlegewie/zotfile/issues/226 , /413 , /454 , /655 ; https://github.com/stelzch/zotero.koplugin/issues/6 , /13 , /20 , /26 ; https://github.com/zotero/zotero-ios/issues/220 , /597 ; https://github.com/zotero/zotero-connectors/issues/376 ; https://github.com/dginev/ar5iv/issues/56 ; https://github.com/GjjvdBurg/paper2remarkable/issues/44 , /142 ; https://github.com/koreader/koreader/issues/9109 , /13206 , /12556 ; https://github.com/readest/readest/issues/3011 , /4264 , /5174 , /6048 , /6235 , /6412 , /6661 ; https://github.com/edrlab/thorium-reader/issues/3523 ; https://github.com/windingwind/bionic-for-zotero/issues/15 , /63 ; https://github.com/wallabag/wallabag/issues/6322 , /8640 ; https://github.com/Macrify-LLC/raiopdf/issues/158 , /377 ; https://github.com/Stirling-Tools/Stirling-PDF/issues/4641 , /7564
Platform docs: https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json , .../typography.json , .../voiceover.json , .../motion.json (human-facing pages: https://developer.apple.com/design/human-interface-guidelines/accessibility etc.) ; https://developer.android.com/guide/topics/ui/accessibility , .../accessibility/principles , .../accessibility/apps , .../accessibility/testing , https://developer.android.com/develop/ui/compose/accessibility ; https://raw.githubusercontent.com/w3c/wcag/main/understanding/22/target-size-minimum.html , .../21/text-spacing.html , .../21/animation-from-interactions.html , .../21/reflow.html
Attempted, did not resolve: https://hn.algolia.com , https://forum.zotero.org , https://www.zotero.org , https://www.w3.org , https://arxiv.org , https://developer.mozilla.org , https://webaim.org , https://pmc.ncbi.nlm.nih.gov , https://www.understood.org , https://www.additudemag.com , https://brailleinstitute.org
Not fetched at all (policy-denied per brief): reddit.com, youtube.com, news.ycombinator.com, app stores, vendor sites.
