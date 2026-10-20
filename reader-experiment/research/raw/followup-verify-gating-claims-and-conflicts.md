# Follow-up: verify the gating claims and the conflicting facts

Date of run: 2026-10-20. Scope: the "gap" follow-up. Claims that decide what can ship behind the Lab toggle, checked
against primary docs, release notes, source and package registries. Nothing in this file is from memory unless it is
tagged [BG], and every [BG] is called out as unverified.

## 0. Method, tags and what the network allowed

Evidence tags used below:

- [DOC] a vendor or platform document, read in full or in the relevant section. The URL is the page I read.
- [SRC] source code or a package artifact I read (ntfy `server/*.go`, the stkclient wheels from PyPI).
- [BCD] MDN browser-compat-data JSON (the data behind MDN and caniuse tables), read from GitHub raw.
- [MEAS] my own measurement on this box (Node v22.22.0, Linux 6.18). Node is V8 like workerd, but it is NOT workerd.
  Treat [MEAS] numbers as an order-of-magnitude proxy for Cloudflare CPU time, not as a Cloudflare reading.
- [ISSUE] a GitHub issue or comment, read through WebFetch. Secondary: users quoting an announcement.
- [BG] background memory. Unverified.
- [SIB] already in a sibling research file. Not re-verified here.

Network, as it actually behaved (so the next agent does not repeat dead ends):

| Route | Result |
|---|---|
| `curl` to `raw.githubusercontent.com` | Works. This is how I read `cloudflare/cloudflare-docs` (branch `production`), `binwiederhier/ntfy` (branch `main`), `GoogleChrome/developer.chrome.com`, `mdn/browser-compat-data`, `anthropics/anthropic-sdk-typescript`. |
| `curl` to `developer.apple.com/tutorials/data/documentation/<framework>/<page>.json` and `developer.apple.com/help/...` | Works. The `.json` form is the readable one. |
| `curl` to `developer.android.com` (use `-L`; many pages moved) | Works. |
| `curl` to `pypi.org/pypi/<pkg>/json`, `files.pythonhosted.org`, `registry.npmjs.org` | Works. |
| `WebFetch` to `github.com` pages (issues, search results, releases) | Works, although `curl`, `gh api` and the GitHub MCP tools to the same host are refused ("sessions are bound to their configured repositories"). The fetcher is a small model: it paraphrases, and refuses to reproduce long quotes. |
| `WebFetch` and `curl` to `readwise.io`, `docs.readwise.io`, `instapaper.com`, `blog.instapaper.com`, `support.mozilla.org`, `blog.mozilla.org`, `hn.algolia.com`, `news.ycombinator.com`, `tailscale.com`, `techcrunch.com`, `pocket-lint.com`, `ereadersforum.com`, `help.kobo.com`, `mobileread.com`, `stackoverflow.com`, `developer.chrome.com`, `developer.mozilla.org`, `caniuse.com`, `web.archive.org` | `ENOTFOUND` or proxy `403`. Not routed around. |
| `WebSearch` | 1 call attempted; refused: "this turn's web search budget is used up (limit: 200 WebSearch calls per turn, shared by every agent in it)". So 0 searches succeeded. Everything below that needed a search is marked UNVERIFIABLE. |

Important doc-site change found on the way: Cloudflare moved Email Routing under **Email Service**. The old paths
`docs/email-routing/...` return 404 on the `production` branch; the current pages are `docs/email-service/...`. Notes that
cite `developers.cloudflare.com/email-routing/...` are citing the old layout.

## 1. What blocks a top-priority feature (read this first)

| # | Blocker | Verdict | Plain consequence |
|---|---|---|---|
| 1 | Server-side article extraction (Readability) or EPUB building in the Worker on the free plan | **REFUTED** (does not fit) | Free CPU is 10 ms per request AND per Cron run. Readability on linkedom measured 40-214 ms warm and 135-526 ms cold on 55 KB-1.1 MB pages; EPUB zip alone 1.5-6 ms warm but 17-86 ms cold. Do extraction on the device (extension, share extension, web sender already hold a live DOM). The Worker only carries bytes. A "fetch this URL and clean it up for me" server feature needs Workers Paid. |
| 2 | Email-in on the free plan | **CONFIRMED fragile** | Email Routing to a Worker is unlimited and free, but the handler runs under the free 10 ms CPU. Cloudflare's own limits page says complex handlers "may exceed these limits and fail" with `EXCEEDED_CPU`. Needs a domain whose DNS is on Cloudflare. Ship as "needs the Daylight server (and Workers Paid for reliable mail)". |
| 3 | Files over 2 MiB through ntfy.sh | **CONFIRMED** | ntfy.sh docs table: attachment limit 2 MB, 20 MB per visitor, 200 MB/day, 250 messages/day. This matches NTFY-FACTS (2,097,152 accepted). `share/PROTOCOL.md` body text (64 MiB files, 12 MiB chunks, "100 MB per sender") is stale; `CHANGES-v1.1.md` and `daylight-share.js` (CHUNK 1,900,544; 9 MB max item) already match the docs. Anything bigger than 9 MB needs a host: the Worker + R2. |
| 4 | Web sender page as an iPhone share target | **CONFIRMED not possible** | `share_target` is `safari: false, safari_ios: mirror` in browser-compat-data (WebKit bug 194593). On iPhone the share path must be the native Share extension (already built) or a Shortcut. Android Chrome (76+) and desktop Chrome (89+) support it. |
| 5 | Chrome extension uploading a big body | **CONFIRMED hazard** | Chrome kills an extension service worker when "a fetch() response takes more than 30 seconds to arrive". A multi-MB PUT on a slow uplink can exceed that. Keep each upload request short (chunks), or run the upload in an extension page, not the service worker. |
| 6 | iOS Share extension memory | **Qualitatively CONFIRMED, number UNVERIFIABLE** | Apple: "Memory limits for running app extensions are significantly lower than the memory limits imposed on a foreground app." No number is published. The commonly cited ~120 MB appears only in GitHub issues. So: never load a big PDF into memory in the extension; encrypt file to file and hand the upload to a background URLSession. |
| 7 | App Store export compliance for the end-to-end crypto | **Open decision for the owner** | The apps' Info.plists have no `ITSAppUsesNonExemptEncryption` key (grep of `apple/`), so App Store Connect will ask on every upload. Apple's text says the app's own use of "standard encryption algorithms" is an export-compliance determination, and names France's controls on "Secure Communications". Not a code blocker for sideloading; a submission-time task for the owner. |

Not blockers (confirmed feasible): Cron every minute (1 of 5 free triggers); 25 MiB inbound mail; Claude API calls from a
Worker (fetch wait time is not CPU time; the official SDK lists Cloudflare Workers as supported); R2 free tier;
`requestAddTileService` on Android 13; Sharing Shortcuts for a paired device; `PROCESS_TEXT`; an always-on foreground
service on Android 13; Control Center controls on iOS 18+; share-extension paywalled capture on iOS.

## 2. Master verdict table

Verdict values: CONFIRMED / REFUTED / CHANGED / UNVERIFIABLE. "Consequence" says: feasible as-is, needs the Worker, needs
Reader change, or drop.

### 2A. Architecture-gating claims

| ID | Claim | Verdict | Exact quote or code reference | URL | Consequence for the Lab plan |
|---|---|---|---|---|---|
| A1.1 | Workers free plan CPU per invocation is about 10 ms | **CONFIRMED** | "CPU time per HTTP request \| 10 ms \| 5 min (default: 30 seconds)" and "CPU time per Cron Trigger \| 10 ms \| 30 seconds (< 1 hour interval) / 15 min (>= 1 hour interval)". Pricing page: "10 milliseconds of CPU time per invocation". Also: "Waiting on network requests (such as `fetch()` calls, KV reads, or database queries) does **not** count toward CPU time." | https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers/platform/limits.mdx ; .../workers/platform/pricing.mdx | Feasible as-is for stream-through work. Anything that parses (HTML, MIME) is the risk. |
| A1.2 | Readability plus EPUB zip-building fits in the free CPU budget | **REFUTED** [MEAS] | Warm median total CPU 39.5 ms (55 KB page) to 213.7 ms (238 KB Wikipedia page); cold 135-526 ms. EPUB zip alone (fflate, level 6) 1.5-6.2 ms warm, 17-86 ms cold. Cloudflare's own page: "Heavier workloads that handle authentication, server-side rendering, or parse large payloads typically use 10-20 ms." Raw table in section 5. | (measurement) ; limits.mdx above | **Drop** server-side extraction on Free. Extract on device; send `page` HTML or the cleaned text. Needs Workers Paid for any server-side "clean this URL" feature. |
| A1.3 | Cron Trigger limits | **CONFIRMED** | "Number of Cron Triggers per account \| 5 \| 250"; duration limit for a Cron Trigger "15 min"; CPU as in A1.1. "Changes such as adding a new Cron Trigger, updating an old Cron Trigger, or deleting a Cron Trigger may take several minutes (up to 15 minutes) to propagate". | limits.mdx ; https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers/configuration/cron-triggers.mdx | Feasible as-is: the design uses one `* * * * *` trigger. Keep each tick light (10 ms). |
| A1.4 | Email Workers inbound message size cap is about 25 MiB | **CONFIRMED** | "Inbound message size \| 25 MiB \| Messages larger than this are rejected". Also "Routing rules per domain 200", "Destination addresses per account 200". `ForwardableEmailMessage` has `raw: ReadableStream` and `rawSize: number`. | https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/email-service/platform/limits.mdx ; .../email-service/api/route-emails/email-handler.mdx | Feasible: stream `message.raw` to R2 without buffering. |
| A1.5 | Email Routing needs a domain with DNS on Cloudflare | **CONFIRMED** | "You must be using Cloudflare DNS to use Email Service." Onboarding adds MX, SPF and DKIM records to the root domain. | https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/email-service/get-started/route-emails.mdx ; .../partials/email-service/domain-setup-routing.mdx | Needs the Worker and a user-owned domain on Cloudflare. No domain, no email-in (as LAB-DECISIONS already says). |
| A1.6 | Email handler under the free plan CPU limit | **CONFIRMED (risk stated by Cloudflare)** | "Workers that handle incoming emails count toward the standard Workers CPU and memory limits. On the Workers Free plan, complex handlers may exceed these limits and fail to process a message. Failed invocations appear in Workers logs with the `EXCEEDED_CPU` error." | email-service/platform/limits.mdx | Needs Workers Paid for reliable newsletters. Matches DESIGN.md (postal-mime 36 ms cold). |
| A1.7 | R2 free tier | **CONFIRMED** | "Storage 10 GB-month / month; Class A 1 million requests / month; Class B 10 million requests / month; Egress Free". "The free tier only applies to Standard storage." Object limits: "Maximum upload size 5 GiB (single-part) / 4.995 TiB (multi-part)". | https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/r2/pricing.mdx ; .../r2/platform/limits.mdx | Feasible. 200 MB files are about 20 GB-month-days of churn at most, fine. |
| A1.8 | R2 needs a payment method on file even for the free tier (in DESIGN.md) | **UNVERIFIABLE** | The R2 docs say only: "R2 is free to get started with included free monthly usage. You are billed for your usage on a monthly basis." Nothing on a card requirement in the docs repo. It is dashboard behaviour. | https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/r2/get-started/index.mdx | Keep R2 optional with the `needs-r2` message. The deploy's `cf-check` should test R2 availability, not assume. |
| A1.9 | Workers AI vs fetch to the Claude API from a Worker | **CONFIRMED (fetch is fine)** | Fetch wait time is not CPU (A1.1); "Subrequests per invocation 50" on Free; "There is no hard limit on duration for HTTP-triggered Workers" while the client stays connected; `waitUntil()` extends at most 30 s. SDK README: "The following runtimes are supported: ... Cloudflare Workers." Workers AI: "10,000 Neurons per day at no charge"; text generation "300 requests per minute". | limits.mdx ; https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/README.md ; .../workers-ai/platform/pricing.mdx ; .../workers-ai/platform/limits.mdx | Feasible with the user's key. Parsing a big streamed answer costs CPU; keep answers short or non-streamed. Workers AI is a free fallback only; LAB-DECISIONS says Claude. |
| A1.10 | D1 and KV limits | **CONFIRMED** | D1 Free: "Queries per Worker invocation 50", "Maximum database size 500 MB", "Maximum string, BLOB or table row size 2,000,000 bytes", "Databases per account 10"; rows read 5 M/day, written 100 k/day. KV Free: "Reads 100,000 per day", "Writes to different keys 1,000 writes per day", "Value size 25 MiB", "Storage/account 1 GB". | .../d1/platform/limits.mdx ; .../partials/workers/d1-pricing.mdx ; .../kv/platform/limits.mdx | Feasible. Matches DESIGN.md sections 2.1 and 11. |
| A1.11 | Free Worker size limit is 3 MB compressed (DESIGN.md 2.1) | **CHANGED** | Current doc: "Worker size (uncompressed) \| 64 MiB \| 64 MiB" and "There is no compressed size limit. Only the uncompressed bundle size counts." "Worker startup time 1 second". | limits.mdx | Not a blocker any more. Keep the 3 MB gzipped CI check as a conservative guardrail, or relax it; the doc no longer imposes 3 MB. Startup (1 s) is the real bundle limit. |
| A1.12 | Request body limit through a Worker is 100 MB | **CONFIRMED** | "Request body size limits depend on your Cloudflare account plan, not your Workers plan." Free: 100 MB. | limits.mdx | Hosted frames up to 12.7 MB per PUT are far inside it. |
| A1.13 | Rate Limiting binding is available (DESIGN.md 3.3) | **CONFIRMED (no plan restriction stated)** | `ratelimits` binding, "Period ... must be either 10 or 60", needs Wrangler 4.36.0 or later, counters are "local to the Cloudflare location". | https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers/runtime-apis/bindings/rate-limit.mdx | Feasible. Per-location counting means it is a soft limit. |
| A2.1 | ntfy.sh attachment cap is 2 MiB (NTFY-FACTS) vs 64 MiB files / 12 MiB chunks (PROTOCOL.md) | **CONFIRMED 2 MiB; PROTOCOL.md text REFUTED** | ntfy limits table: "On ntfy.sh, the attachment size limit is 2 MB, and the per-visitor total is 20 MB." "On ntfy.sh, the daily bandwidth limit is 200 MB." "On ntfy.sh, the daily message limit is 250." Defaults for a self-host: 15 MB per file, 100 MB per visitor, 5 GB total, 3 h expiry, 500 MB/day. NOTE the same page says elsewhere (publish.md line 990) "how ntfy.sh is configured, the **max attachment size is 15 MB** (with 100 MB total per visitor)": that sentence is stale; your probe of 2,097,152 accepted / 2,097,153 refused settles it. | https://raw.githubusercontent.com/binwiederhier/ntfy/main/docs/publish.md (section "Limitations") ; .../docs/config.md | Feasible as-is with v1.1 (1,900,544-byte chunks, 9 MB item). Update PROTOCOL.md section 2.3, 3.1 and 4 text to v1.1 numbers. Stop quoting "15 MB on ntfy.sh". |
| A2.2 | Message body limit | **CONFIRMED** | "Each message can be up to 4,096 bytes long. Longer messages are treated as attachments." Source default `DefaultMessageSizeLimit = 4096`. Raising it on a self-host breaks Firebase/APNs push: "FCM and APNS will NOT work for large messages". | publish.md ; https://raw.githubusercontent.com/binwiederhier/ntfy/main/server/config.go | Keep the 3,800-char base64 rule. Do not raise the limit on a self-host. |
| A2.3 | Error 41301 covers both "too big" and "quota or bandwidth full" | **CONFIRMED** | `errHTTPEntityTooLargeAttachment = &errHTTP{41301, http.StatusRequestEntityTooLarge, "attachment too large, or bandwidth limit reached", ...}` | https://raw.githubusercontent.com/binwiederhier/ntfy/main/server/errors.go | Matches NTFY-FACTS: a known-small frame that gets 413 means quota. |
| A2.4 | What self-hosting changes | **CONFIRMED** | Limits are config: `attachment-file-size-limit` (default 15M), `attachment-total-size-limit` (5G), `attachment-expiry-duration` (3h, "Capped at `cache-duration`" which defaults to 12h), `visitor-attachment-total-size-limit` (100M), `visitor-attachment-daily-bandwidth-limit` (500M), `message-size-limit` (4K). Since v2.20.0 (26 March 2026) attachments can live in S3-compatible storage: `attachment-cache-dir: "s3://ACCESS_KEY:SECRET_KEY@BUCKET/PREFIX?region=...&endpoint=..."`. Replay limit: a poll replay "returns only the newest messages that fit in 10 MB per topic" and replayed bytes count against the daily bandwidth budget. | config.md ; https://raw.githubusercontent.com/binwiederhier/ntfy/main/docs/releases.md ; docs/subscribe/api.md | A user who self-hosts ntfy (even on a $5 box, or Cloudflare R2 as the S3 store) removes the 2 MiB wall with no protocol change; 100 MB files then need `attachment-file-size-limit: 100M` and the 12 MiB v1.0 chunks work again. That is a power-user option, not the default. |
| A2.5 | ntfy fetches or validates an external `Attach:` URL | **REFUTED (it only pattern-checks)** | `urlRegex = regexp.MustCompile("^https?://")`; for an `Attach` header the body is handled as a plain text message ("Body must be a message, because we attached an external URL"). Docs: "Since the files are externally hosted, the expiration or size limits from above do not apply here." | https://raw.githubusercontent.com/binwiederhier/ntfy/main/server/server.go (lines ~1270-1290, 1400-1430) ; publish.md "Attach file from a URL" | An `Attach:` message pointing at a Worker or R2 URL is carried verbatim, so DESIGN.md's hosted-frame announcement works with today's Inbox. The URL is visible to the relay when sent in the header; inside an encrypted control frame it is not. |
| A2.6 | Minimal protocol change for 100+ MB PDFs via R2 presigned URLs with sealed blobs | **Design (not a claim)** | See section 6. | R2 presigned-URL doc: "Expiry: Timeout from 1 second to 7 days (604,800 seconds)"; "`POST` (multipart form uploads via HTML forms) is not currently supported." | Needs the Worker (to presign) and R2. Needs Reader/Inbox change only for the new `ref` header; hosted v1 frames (DESIGN.md rev 2) already reach 192 MiB with no protocol change. |
| A3.1 | iOS share-extension memory limit (~120 MB) and time limit | **Qualitatively CONFIRMED; number UNVERIFIABLE from Apple** | Apple (archived App Extension Programming Guide): "Memory limits for running app extensions are significantly lower than the memory limits imposed on a foreground app. On both platforms, the system may aggressively terminate extensions". "Design your app extension to launch quickly, aiming for well under one second. An extension that launches too slowly is terminated by the system." No number. The ~120 MB figure: two GitHub issues say the extension "runs under a ~120 MB memory limit" (markleit/oldmansbookclub_ios#183, jiegui2025/larimar#14), secondary and recent. | https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionCreation.html ; https://github.com/markleit/oldmansbookclub_ios/issues/183 ; https://github.com/jiegui2025/larimar/issues/14 | Feasible if streaming. Big files: encrypt file-to-file in segments, upload with a background URLSession from the file. Do not hold 100 MB in memory. |
| A3.2 | Background upload from a share extension | **CONFIRMED** | "Although you can set up a background URL upload or download task, other types of background tasks ... are not available to extensions." "Because a background transfer uses a separate process, the transfer can continue, as a low priority task, after your extension completes the host app's request and gets terminated." Session config: `sharedContainerIdentifier` is required for extensions: "If you try to create a URL session from your app extension but fail to set this property to a valid value, the URL session is invalidated upon creation." Upload tasks accept "the contents of a file, a stream, or data". Background-started tasks are rate limited: "the task doesn't begin until the delay expires. The delay increases each time the system resumes or relaunches your app." | Apple archived guide above ; https://developer.apple.com/tutorials/data/documentation/foundation/urlsessionconfiguration/sharedcontaineridentifier.json ; .../foundation/downloading-files-in-the-background.json | Feasible. Needs an App Group shared with the share extension (the project already has an extension; add the group and the `sharedContainerIdentifier`). |
| A3.3 | Control Center controls and App Intents return values | **CONFIRMED (controls); return-value display UNVERIFIED** | `ControlWidgetButton` is iOS 18.0 / iPadOS 18.0 / Mac Catalyst 18.0 / macOS 26.0 / watchOS 26.0. "A control allows your app to execute an action, launch your app to a specific view ... from Control Center, the Lock Screen, or by using the Action button." "Use `AppIntent` or `OpenIntent` for control buttons and `SetValueIntent` for control toggles. ... The system queries for the state of a control when `perform()` returns; finish all actions and save all state data before it returns." `ReturnsValue` (iOS 16) is "the result of performing an action that delivers a value back to the initiator", which is how Shortcuts consumes a result. I did not find a statement that a control shows the returned value; treat it as not shown. | https://developer.apple.com/tutorials/data/documentation/widgetkit/creating-controls-to-perform-actions-across-the-system.json ; .../widgetkit/controlwidgetbutton.json ; .../appintents/returnsvalue.json | Feasible on iOS 18+ only. A "Send clipboard" control must show success some other way (state toggle, notification, or `OpenIntent` into the app). A Shortcuts action can return the delivery status to the next step. |
| A3.4 | Safari Web Extension on iOS can read the rendered DOM for paywalled pages | **CONFIRMED (with a per-site permission step); share extension is the better path** | Apple: "Safari web extensions need permission from the user to access and update web pages". "In iOS, the user selects the extension's entry in the More menu, and selects a permission option", and can later set a site to "Ask, Allow, or Deny" in Settings > Safari > Extensions. "In iOS, you must make your background page nonpersistent." Our share extension already does this without any permission prompt: `NSExtensionJavaScriptPreprocessingFile` runs `GetPage.js` in the page and returns `document.documentElement.outerHTML` (apple/Shared/ShareExtension/GetPage.js). | https://developer.apple.com/tutorials/data/documentation/safariservices/managing-safari-web-extension-permissions.json ; .../safariservices/optimizing-your-web-extension-for-safari.json | Feasible as-is. Paywalled pages: share extension first; Safari extension only for the toolbar/shortcut path, and it asks permission per site. |
| A3.5 | iOS background delivery limits | **CONFIRMED** | Silent push: "The system treats background notifications as low priority ... the system doesn't guarantee their delivery ... don't try to send more than two or three per hour." "Your app has 30 seconds to perform any tasks". "If something force quits or kills the app, the system discards the held notification." Background-started URL tasks are discretionary and rate limited (A3.2). | https://developer.apple.com/tutorials/data/documentation/usernotifications/pushing-background-updates-to-your-app.json | iPhone is a sender; it cannot be an always-on receiver. Poll acks on launch, on share, and via best-effort background refresh; never promise instant "delivered" on iPhone. |
| A3.6 | App Review or export compliance for end-to-end crypto | **CONFIRMED as a to-do, no code blocker** | Apple: "If your app uses, accesses, contains, implements, or incorporates encryption, this is considered an export of encryption software". Examples needing a determination include "Standard encryption algorithms" and "Crypto functionality within Apple's operating system". "Typically, the use of encryption that's built into the operating system ... is exempt from export documentation upload requirements, whereas the use of proprietary encryption is not." "If your app uses exempt forms of encryption, you might alternatively be required to submit a year-end self-classification report to the U.S. government." "The main items of control for France are Secure Storage, Secure Communications, and Security Anti-Virus applications." Our Info.plists set no `ITSAppUsesNonExemptEncryption`. | https://developer.apple.com/tutorials/data/documentation/security/complying-with-encryption-export-regulations.json ; https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance | The owner decides before any TestFlight or App Store submission. Sideloaded or personal builds are unaffected. The protocol uses only AES-256-GCM, SHA-256, DEFLATE (standard), but Apple says the user is "responsible for all liabilities associated with misinterpretation". Not legal advice. |
| A4.1 | Sharing Shortcuts (Direct Share) for a paired device | **CONFIRMED feasible** | "Starting in Android 11 (API level 30), you may provide Direct Share targets only through the Sharing Shortcuts API". "The Sharesheet Direct Share row only surfaces dynamic shortcuts provided by the Sharing Shortcuts API." Needs a `<share-target>` in shortcuts.xml with a `<data android:mimeType>` and a category, `setCategories()` ("required for shortcuts meant to be used as share targets"), `setLongLived(true)` (can improve ranking), `ShortcutManagerCompat.pushDynamicShortcut`. "Don't publish stale shortcuts; a conversation with no user activity in the last 30 days is considered stale." Tapping must go straight to the action: "Don't present the user a disambiguation UI". | https://developer.android.com/develop/ui/compose/sharing/direct-share-targets | Feasible: publish one long-lived shortcut per paired Daylight ("Anjan's Daylight") that sends immediately. Re-push the shortcut when the user sends so it is never stale. Ranking is up to the system. |
| A4.2 | TileService `addTile` prompt on Android 13 | **CONFIRMED (name: `requestAddTileService`)** | "Starting on Android 13, you can use the `requestAddTileService()` method to make it much easier for users to add your tile ... The prompt includes the application name, the provided label, and icon." "The system can choose to stop processing requests for a given ComponentName if it has been denied by the user enough times before." Recommended "only in context". | https://developer.android.com/develop/ui/views/quicksettings-tiles | Feasible on Android 13+ phones. On older phones the user adds the tile by hand. Ask once, after the first successful send. The DC-1 (Android 13) is a receiver; a tile is not needed there. |
| A4.3 | PROCESS_TEXT | **CONFIRMED** | "ACTION_PROCESS_TEXT. Added in API level 23 ... Activity Action: Process a piece of text. Input: EXTRA_PROCESS_TEXT contains the text to be processed." Constant "android.intent.action.PROCESS_TEXT". | https://developer.android.com/reference/android/content/Intent | Feasible, minSdk 26 already. An activity with a `PROCESS_TEXT` intent filter for `text/plain` appears in the text-selection menu: "Send selection to Daylight". |
| A4.4 | Foreground-service rules on Android 13 for an always-on Inbox | **CONFIRMED (benign on 13)** | Android 13: "Starting in Android 13 (API level 33), users can complete a workflow from the notification drawer to stop apps that have ongoing foreground services ... This affordance is known as the Task Manager. Apps must be able to handle this user-initiated stopping." "If the user denies the notification permission, they don't see notices related to foreground services in the notification drawer. However, users still see notices ... in the Task Manager". A "restricted" battery state means "Can't launch foreground services; Existing foreground services are removed from the foreground". The `dataSync` 6-hour timeout is Android 15 behaviour. "If your app targets Android 14 or higher, you'll need to declare your app's foreground service types in the Play Console". Our app: `targetSdk = 35`, `FOREGROUND_SERVICE_SPECIAL_USE` permission, type applied only when `SDK_INT >= 34` (Live.kt line 124). | https://developer.android.com/about/versions/13/behavior-changes-all ; .../about/versions/13/behavior-changes-13 ; https://developer.android.com/develop/background-work/services/fgs/changes ; .../fgs/timeout ; .../fgs/service-types | Feasible as built. On the DC-1: ask for POST_NOTIFICATIONS, keep WorkManager polling as the fallback when the user stops the service, and tell the user to exempt the Inbox from battery restriction. Cannot verify the DC-1's OEM battery manager. |
| A4.5 | Web Share Target on iOS Safari is not supported | **CONFIRMED** | BCD `manifests/webapp/share_target`: `"chrome": {"version_added": "89"}, "chrome_android": {"version_added": "76"}, "firefox": {"version_added": false}, "safari": {"version_added": false, "impl_url": "https://webkit.org/b/194593"}, "safari_ios": "mirror"`. | https://raw.githubusercontent.com/mdn/browser-compat-data/main/manifests/webapp/share_target.json | iPhone: no PWA share target. Use the Share extension, a Shortcut, or the paste box. |
| A5.1 | Chrome MV3 service-worker lifetime during large uploads | **CONFIRMED hazard** | "Normally, Chrome terminates a service worker when one of the following conditions is met: After 30 seconds of inactivity. Receiving an event or calling an extension API resets this timer. When a single request, such as an event or API call, takes longer than 5 minutes to process. When a fetch() response takes more than 30 seconds to arrive." "Active WebSocket connections now extend extension service worker lifetimes." | https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/docs/extensions/mv3/service_workers/service-worker-lifecycle/index.md | The extension currently publishes v1.1 frames of at most 1,966,116 bytes (`CHUNK` 1,900,544 in `share/js/daylight-share.js`), each its own request, which finish quickly on a normal uplink. (`PDF_CHUNK` = 4 MiB in `extension/src/logic.js` is how a PDF is read out of the page, not an upload size.) For hosted frames of up to 12.7 MB or presigned PUTs of 100+ MB, upload from an extension page (popup or offscreen document [BG: `chrome.offscreen`, Chrome 109, not verified here]) or in <=2-4 MB requests that each return quickly. |
| A5.2 | `chrome.sidePanel` availability | **CONFIRMED** | BCD: `sidePanel` Chrome 114, `open()` Chrome 116, `PanelLayout/Side/getLayout` Chrome 140, `onOpened` 141; Edge mirrors Chrome; Firefox false; Safari and Safari iOS false. | https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/sidePanel.json | A queue/status side panel is a Chrome and Edge only Lab feature; the extension's `minimum_chrome_version` is already 116. No Safari equivalent. |
| A5.3 | "All sites" host-permission review burden | **CONFIRMED burden; optional-permission treatment UNVERIFIABLE** | "Reviews may take longer for extensions that request broad host permissions or sensitive execution permissions". "Host permissions patterns like `*://*/*`, `https://*/*`, and `<all_urls>` give extensions extensive access to the user's web activity". The permission warning is "Read and change all your data on all websites". Docs also say to prefer `activeTab`. Our manifest already has `permissions: [activeTab, scripting, contextMenus, storage, unlimitedStorage, alarms]`, `host_permissions: ["https://ntfy.sh/*"]`, `optional_host_permissions: ["<all_urls>"]`. The doc does not say whether an *optional* `<all_urls>` is treated like a required one. | https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/docs/webstore/review-process.md ; .../site/en/docs/extensions/mv3/permission_warnings/index.md | Keep `activeTab` + optional hosts. A new Lab feature that needs every site up front (auto-detect article, highlight overlay) is the thing that would slow review. Add a required host entry only for the Worker's origin and (for presigned uploads) `https://*.r2.cloudflarestorage.com/*`. |

### 2B. Conflicting or single-source facts

| ID | Claim | Verdict | Exact quote or code reference | URL | Consequence |
|---|---|---|---|---|---|
| B1 | Instapaper scheduled digests became Premium-only on 2026-02-19 | **UNVERIFIABLE** | Every source host is denied (instapaper.com, blog.instapaper.com, pocket-lint.com, ereadersforum.com) and WebSearch is out of budget. Sibling files hold the only evidence (Pocket-lint and eReaders Forum say all Kindle delivery incl. digests; a low-trust page says digests stay free). | (none reachable) | No ship impact: the Worker's digest is our own feature. Do not market it as an Instapaper replacement. To settle: Instapaper's own help article or blog from Feb 2026 and the Premium comparison table. |
| B2 | Pocket user-data deletion date: 8 Oct vs 12 Nov 2025 | **UNVERIFIABLE; 8 Oct leans right** | Comment by `plowshares`, 7 Oct 2025, on pabuisson/in-my-pocket#4: "all data is getting deleted tomorrow" (so 8 Oct 2025). Later users say they "missed the deadline for downloading my data" (13 Jan 2026) and "the Pocket export does not exist anymore" (6 Jan 2026). No comment states 12 Nov. send2ereader#52 (opened 8 Jun 2025): "Mozilla will shut down Pocket's services on July 8, 2025." The 12 Nov date in siblings is the API shutdown, which is a different event. | https://github.com/pabuisson/in-my-pocket/issues/4 ; https://github.com/daniel-j/send2ereader/issues/52 | None. Pocket is dead; drop any Pocket import promise. |
| B3 | Omnivore export deadline: 15 vs 16 Nov 2024 | **CONFIRMED 15 Nov (second-hand); 16 Nov UNVERIFIABLE** | omnivore-app/omnivore#4416, comment by `raynergit`, 30 Oct 2024, quoting the announcement: "all Omnivore users will be able to export their information from the service through November 15 2024", "after which all information will be deleted." Repo README: "The Cloud application was deprecated in November of 2024." The TechCrunch 16 Nov wording could not be fetched. | https://github.com/omnivore-app/omnivore/issues/4416 ; https://raw.githubusercontent.com/omnivore-app/omnivore/main/README.md | None. A one-day difference is almost certainly time zones. Use "15 Nov 2024". |
| B4 | Tailscale #8626 reaction count (22 vs 27) | **UNVERIFIABLE** | Page title "Taildrop Android no notification when file is delivered", state Open. The page the fetcher saw said "Reactions are currently unavailable" for the issue; it showed 10 thumbs-up across 7 comments and "8 remaining items" collapsed. | https://github.com/tailscale/tailscale/issues/8626 | None for shipping; the count does not matter. The title does: no "delivered" notification on the receiving Android device is a known pain point, which supports our delivery receipts and a receive notification. Use the title, drop the count. |
| B5 | Kobo's Instapaper-replaces-Pocket timeline | **Sequence supported, dates UNVERIFIABLE** | voidberg/instakobo README: "This started back when Pocket was the only official way to read saved articles on a Kobo. After Pocket shut down, Rakuten added built-in Instapaper support." send2ereader#52 (8 Jun 2025) shows Kobo users losing the easy path when Pocket closed on 8 Jul 2025. No source gives the Kobo announcement or rollout date; help.kobo.com is denied. | https://raw.githubusercontent.com/voidberg/instakobo/main/README.md ; https://github.com/daniel-j/send2ereader/issues/52 | None. Say "Kobo now has a built-in Instapaper link" without dates. |
| B6 | Readwise Reader price ($9.99 annual?) and "Public Beta" label | **UNVERIFIABLE** | readwise.io and docs.readwise.io are `ENOTFOUND`. `readwiseio/readwise-cli` README (read) calls it "Reader" with no beta label, but a README is weak evidence. | https://raw.githubusercontent.com/readwiseio/readwise-cli/master/README.md | None for building. Do not print a price or "beta" in any Lab copy until someone with network reads https://readwise.io/pricing. |
| B7 | stkclient 0.2.0 released 2026-10-12 and broke Send-to-Kindle clients | **REFUTED as stated (date right, version wrong)** | PyPI: 0.2.0 uploaded `2026-10-12T19:40:27Z`, 0.3.0 uploaded `2026-10-13T16:39:32Z`. GitHub release notes via WebFetch: "v0.2.0 (12 Oct): Marked as having breaking changes, but the only listed item is 'Fix CI and use current toolchains.'" plus "PDF layout is preserved by default, and a `force_convert` option was added". "v0.3.0 (13 Oct): Device discovery, uploads, and document delivery move to Amazon's Kindle Docs API." Wheel diff 0.2.0 to 0.3.0 [SRC]: base URL `https://stkservice.amazon.com` becomes `https://kd.amazon.com`; paths `/GetListOfOwnedDevices`, `/GetUploadUrl`, `/SendToKindle` become `/import/kindle-doc/get-device-list`, `/import/upload-url`, `/import/kindle-doc/send-to-kindle`; the send body gains `fileSize`, `forceConvert`, `sendTimeMillis`, `shouldExtractWebContent`. 0.3.0 "breaks" two low-level APIs: `stkclient.api.send_to_kindle` now needs `file_size`, and `Signer.device_private_key` returns a cryptography `RSAPrivateKey`. | https://pypi.org/pypi/stkclient/json ; https://github.com/maxdjohnson/stkclient/releases ; https://files.pythonhosted.org/packages/f7/06/d49b8e0ec3fccf9aa0ca77d7002590ad7ada41a7e3a25babf339a932954e/stkclient-0.3.0-py3-none-any.whl | The Amazon backend migration is real (it is in 0.3.0), but it is a library break, and whether Amazon turned the old endpoint off is not shown. Either way: **drop** any Lab feature that depends on Amazon's undocumented Send-to-Kindle web API. Email-to-Kindle remains the only supported route, and sending arbitrary mail from a Worker needs Workers Paid. |
| B8 | Boox NeoReader 2023 export complaint still true | **UNVERIFIABLE** | No reachable source (onyxboox.com, docs.boox.com, Reddit, MobileRead all denied). | (none) | None. Do not repeat the 2023 complaint as current. |

## 3. Detail: Cloudflare (quotes and the numbers behind the table)

All paths are under `https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/` (branch
`production`, fetched 2026-10-20).

### 3.1 Workers limits (`workers/platform/limits.mdx`)

```
| Feature                                  | Workers Free | Workers Paid   |
| Requests                                 | 100,000/day  | No limit       |
| CPU time                                 | 10 ms        | 5 min          |
| Memory                                   | 128 MB       | 128 MB         |
| Subrequests                              | 50/request   | 10,000/request |
| Simultaneous outgoing connections/request| 6            | 6              |
| Worker size                              | 64 MiB       | 64 MiB         |
| Worker startup time                      | 1 second     | 1 second       |
| Number of Cron Triggers per account      | 5            | 250            |
```

- "CPU time measures how long the CPU spends executing your Worker code. Waiting on network requests ... does not count."
- "Each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured
  limit. If your Worker starts hitting the limit consistently, its execution will be terminated" (partial
  `isolate-cpu-flexibility.mdx`). So a 36 ms postal-mime parse might pass once and die on the third try. Do not plan on
  the flexibility.
- Duration: HTTP "No limit"; Cron Trigger "15 min"; Durable Object Alarm 15 min; Queue consumer 15 min.
  `waitUntil()` "can extend execution for up to 30 seconds after the response is sent or the client disconnects."
- Subrequests: "Subrequests per invocation 50 (Free)", "Subrequests to internal services 1,000 (Free)". Each redirect counts.
- "Using global `fetch()` to call another Worker on the same zone without service bindings fails."
- Request body: Free 100 MB, Pro 100 MB, Business 200 MB.
- Cache API: "Maximum object size 512 MB".

### 3.2 Email (`email-service/platform/limits.mdx`, `.../pricing.mdx`)

- Inbound: "Inbound message size 25 MiB. Messages larger than this are rejected."
- "Email Routing is available on both the Workers Free and Workers Paid plans. Sending to arbitrary recipients requires
  the Workers Paid plan." Inbound is "Unlimited" on both.
- "Sends to verified destination addresses are always free ... You can only send from your routing domains."
- "Emails sent from a Worker using the `send_email` binding appear in the Email Routing summary as dropped, even when
  they were delivered successfully."
- Outbound message size: "5 MiB including attachments; 25 MiB for verified destination addresses only".
- Handler API (`email-service/api/route-emails/email-handler.mdx`): `async email(message, env, ctx)`;
  `message.raw` is a `ReadableStream`; `message.rawSize` is bytes; the docs recommend `postal-mime` to parse.

### 3.3 R2 and presigned URLs

- `r2/platform/limits.mdx`: "Maximum upload size 5 GiB (single-part) / 4.995 TiB (multi-part)", "Maximum upload parts 10,000",
  "Maximum concurrent writes to the same object name (key): 1 per second".
- `r2/objects/upload-objects.mdx`: single PUT "Best for small to medium files (under ~100 MB)", multipart part size "5 MiB - 5 GiB".
- `r2/api/s3/presigned-urls.mdx`: "Expiry: Timeout from 1 second to 7 days (604,800 seconds)". Operations: GET, HEAD, PUT,
  DELETE. "`POST` (multipart form uploads via HTML forms) is not currently supported." "Presigned URLs are generated
  server-side with no communication with R2, requiring only your R2 API credentials and an implementation of the AWS
  Signature Version 4 signing algorithm." CORS: "If your presigned URLs will be used from a browser, set up CORS rules on your
  bucket". "Restricting Content-Type ... uploads will fail with a 403/SignatureDoesNotMatch error if the client sends a
  different Content-Type".
- `r2/api/tokens.mdx`: "Access Key ID: The `id` of the API token. Secret Access Key: The SHA-256 hash of the API token
  `value`." Permissions "Object Read & Write" can be scoped to buckets.
- R2 pricing: egress free; Class A $4.50/M, Class B $0.36/M beyond the free tier.

### 3.4 Other

- Workers AI: free 10,000 Neurons/day; llama-3.2-1b-instruct "2457 neurons per M input tokens, 18252 per M output".
  A 1B model for summaries is possible for free but poor; LAB-DECISIONS chose Claude.
- `anthropics/anthropic-sdk-typescript` README: "The following runtimes are supported: ... Cloudflare Workers."
- DESIGN.md names a model id and a beta header; I did not verify those here (out of this follow-up's scope).

## 4. Detail: ntfy (`binwiederhier/ntfy`, branch `main`)

Limits table in `docs/publish.md` ("Limitations"), verbatim rows:

- "Message length: Each message can be up to 4,096 bytes long. Longer messages are treated as attachments."
- "Requests: ... 60 requests per visitor at once, and then refills ... at a rate of one request per 5 seconds."
- "Daily messages: ... On ntfy.sh, the daily message limit is 250."
- "Attachment size limit: By default, the server allows attachments up to 15 MB in size, up to 100 MB in total per visitor
  and up to 5 GB across all visitors. On ntfy.sh, the attachment size limit is 2 MB, and the per-visitor total is 20 MB."
- "Attachment expiry: By default, the server deletes attachments after 3 hours"
- "Daily bandwidth: ... 500 MB ... On ntfy.sh, the daily bandwidth limit is 200 MB."
- "Title and tag size: The message title is limited to 1 KB, and all tags combined to 512 bytes."

Contradiction inside the docs: `publish.md` line 990 still says "By default, and how ntfy.sh is configured, the **max
attachment size is 15 MB** (with 100 MB total per visitor)." Trust the table and the probe.

`docs/subscribe/api.md` "Replay limits": "A replay returns only the newest messages that fit in 10 MB per topic ... a capped
response carries an `X-Messages-Truncated: 1` header." and "Replayed bytes count against your daily bandwidth budget ...
Exceeding it returns HTTP 429 with ntfy error code 42905". Advice: "pass `since=<last message ID>` rather than re-fetching
everything." (PROTOCOL.md 3.2 says never to use a message id as the cursor because an expired id may return nothing;
NTFY-FACTS measured that an unknown id returns everything. Both can be true; the v1.1 time-cursor-with-overlap is the safe
choice. Not re-tested here.)

Source references (all `server/` on `main`): `config.go` `DefaultMessageSizeLimit = 4096`,
`DefaultAttachmentFileSizeLimit = 15 MB`, `DefaultAttachmentTotalSizeLimit = 5 GB`, `DefaultAttachmentExpiryDuration = 3h`,
`DefaultVisitorAttachmentTotalSizeLimit = 100 MB`, `DefaultVisitorAttachmentDailyBandwidthLimit = 500 MB`,
`DefaultCacheDuration = 12h`; `errors.go` 41301/41302/41303; `server.go` `urlRegex = ^https?://`.

Self-host, S3 (`docs/config.md`, "S3 storage"): `attachment-cache-dir: "s3://ACCESS_KEY:SECRET_KEY@my-bucket/attachments?region=us-east-1&endpoint=https://s3.example.com"`; warning:
"ntfy takes full control over the attachment directory or S3 bucket ... **Do not use a directory or S3 bucket as
`attachment-cache-dir` that is also used for something else.**" Since 2.20.0 (26 Mar 2026).

## 5. Raw measurements [MEAS] (Node v22.22.0; not workerd)

Script: `bench.mjs` in the session scratchpad (not in the repo). Packages: `@mozilla/readability@0.6.0`, `linkedom@0.18.12`,
`fflate@0.8.2` installed from the npm registry with `--ignore-scripts` into an isolated dir; the script loads them with
`createRequire`. Pages: Mozilla Readability's own test fixtures
(`https://raw.githubusercontent.com/mozilla/readability/main/test/test-pages/<name>/source.html`). "cold" = first run in a
fresh process (includes JIT warm-up and module init); "warm" = median of 15 runs in the same process. CPU =
`process.cpuUsage()` user+system. Steps: `parseHTML` (linkedom), `Readability.parse()`, `zipSync` of a 5-file EPUB skeleton
with the article as one chapter (fflate level 6, `mimetype` stored).

| Page | In (KB) | Cold: parse / Readability / EPUB / total (ms) | Warm median total (ms) | Warm median parse / Readability / EPUB (ms) | EPUB (KB) |
|---|---|---|---|---|---|
| ars-1 | 55 | 49.2 / 68.2 / 17.4 / **134.8** | 39.5 | 14.9 / 18.2 / 1.6 | 3 |
| medium-1 | 116 | 51.8 / 87.6 / 38.7 / **178.0** | 53.2 | 17.2 / 32.3 / 5.9 | 10 |
| theverge | 207 | 75.4 / 77.8 / 19.5 / **172.8** | 69.0 | 25.1 / 36.2 / 2.0 | 4 |
| wikipedia | 238 | 155.2 / 284.4 / 86.3 / **525.9** | 213.7 | 37.6 / 163.5 / 6.2 | 25 |
| bbc-1 | 258 | 126.9 / 126.8 / 23.9 / **277.6** | 92.7 | 30.0 / 43.3 / 1.5 | 4 |
| nytimes-1 | 302 | 145.2 / 156.5 / 24.2 / **325.9** | 115.1 | 64.0 / 46.8 / 1.9 | 4 |
| guardian-1 | 1,133 | 116.3 / 153.9 / 60.5 / **330.8** | 87.4 | 41.2 / 48.6 / 4.4 | 12 |

Reading: Readability + DOM parse is 4x to 50x over the 10 ms free budget even warm. EPUB zip alone is mostly under 10 ms
warm but 17-86 ms cold (JIT), and Cron isolates are often cold, so do not count on it either. The first-call overhead in
Node is not the same as a workerd cold start; only a deploy-time canary on workerd can say. DESIGN.md's own canary
(parse a 150 KiB newsletter fixture three times) is the right shape.

SigV4 presign of an R2 URL with WebCrypto only (`presign.mjs`, scratchpad): cold 26.2 ms (Node lazy crypto init), **warm
1.07 ms per presign**. Two presigns (PUT + GET) per upload request is about 2 ms warm. The signature was NOT tested
against R2 (no credentials); this measures cost only.

## 6. Proposal: 100+ MB PDFs through R2 with sealed blobs (the minimal protocol change)

This is a design, built from the verified limits above. It has not been implemented or tested against R2.

### 6.1 Is any protocol change needed at all?

No, for files up to 192 MiB. DESIGN.md rev 2 already hosts ordinary v1 frames on the Worker (up to 16 parts of 12.7 MB)
and announces each with an `Attach: https://<worker>/f/<id>/<i>` message. That works with today's Inbox because
PROTOCOL.md 3.2 says the attachment URL "may be on another path or host" and v1.1 receivers take frames up to
`MAX_ATTACHMENT = 12,713,984`. It costs one ntfy message and one Worker request per 12 MiB, so a 100 MB PDF is 9 parts,
9 PUTs through the Worker (each far under the 100 MB body limit; streamed, so ~0 CPU) and 9 ntfy messages (ntfy.sh allows
250 a day). The ceiling is `MAX_PARTS = 16`, so 192 MiB; the receiver's `MAX_DECODED` is 256 MiB.

### 6.2 If the user wants R2 presigned URLs (one request per file, no Worker in the data path, up to 5 GiB)

Smallest change that works: add ONE optional field to the existing `file` item header, plus one cipher spec, plus one
capability flag. Topics, pairing, key derivation, acks, small frames and chunked v1.1 frames stay as they are.

1. **Header field `ref`** (new, optional, only on `kind: "file"`):

   ```json
   "ref": { "u": "https://<acct>.r2.cloudflarestorage.com/<bucket>/b/<id>?X-Amz-...(GET, expires 7 days)",
            "n": 104857616, "k": "<base64 32-byte item key>", "p": "<base64 7-byte nonce prefix>", "s": 1048576 }
   ```

   The body is empty and `parts` is 1. `size` and `sha256` keep their meaning: length and hash of the decrypted file.
   The whole header travels in an ordinary AES-GCM frame under the pairing key, so the relay never sees the URL, the item
   key or the size. This frame is about 600 bytes and goes as a small message.

2. **Sealed blob format** (what is in R2): a sequence of AES-256-GCM segments under the random per-item key `k`. Segment
   `i` holds up to `s` = 1 MiB of plaintext; nonce = `p` (7 bytes) || u32be(`i`) || 1 byte (0x01 on the final
   segment, else 0x00); AAD = the item id. Reasons: (a) the share extension can encrypt file-to-file with bounded memory
   and upload with a background URLSession from the file (A3.1, A3.2); (b) a single AES-GCM call over 100 MB would need
   the whole file in memory; (c) the final-segment flag stops truncation; (d) the receiver streams the GET and decrypts
   segment by segment, then checks `sha256`. A fresh `k` per item means the Worker's S3 credentials, the bucket and the
   presigned URL together still yield only ciphertext.

3. **Presign endpoint** on the Worker: `POST /v1/files/presign {id, n}` (bearer token, as DESIGN.md 3.3) returns
   `{put: {url, headers}, get: {url}}` for object key `b/<id>`, PUT expiry 1 h, GET expiry 7 days (the maximum the doc
   allows; equals the sender's 7-day outbox window). The sender PUTs the blob straight to R2 (single PUT is fine to 5 GiB;
   "Best for ... under ~100 MB" and multipart is worth it only for resumability), then publishes the `ref` frame.
   R2 lifecycle deletes `b/` after 14 days; the Inbox deletes on ack (a presigned DELETE can be returned too).

4. **Capability flag**: the Lab Inbox's hello/ack frame (DESIGN.md already has a hello) advertises `caps: ["ref1"]`. A sender
   uses `ref` only when the paired Inbox has advertised it; otherwise it falls back to 6.1 (hosted v1 frames, up to
   192 MiB) or to the "Files can be up to 9 MB" message. A v1 or v1.1 Inbox that does see a `ref` item ignores the unknown
   field, finds an empty body that does not match `size`/`sha256`, drops it and never acks, so the sender shows
   "not delivered" instead of a corrupt file.

What it needs: the Worker (presign + R2 credentials), R2 (card requirement unverified, A1.8), and an Inbox/Reader-side change
(the `ref` download and segment decrypt), so it is "needs the Worker" plus "needs Inbox change". Credentials: R2 S3 keys
are the API token's `id` and the SHA-256 of its `value` (tokens.mdx). Prefer a separate narrowly scoped token
("Object Read & Write" on the one bucket) over reusing `CLOUDFLARE_API_TOKEN`, which can redeploy the Worker.
Browser and extension senders need either CORS rules on the bucket (web sender) or a host permission for
`https://*.r2.cloudflarestorage.com/*` (extension). The presign CPU is about 1 ms per URL warm [MEAS].

### 6.3 Which to build

Build 6.1 first (already specified, no protocol change, works with every shipped Inbox, reaches 192 MiB). Add 6.2 only if
files above 192 MiB, resumable uploads or fewer ntfy messages matter. For a personal reader, 192 MiB covers almost every
PDF and EPUB.

## 7. Detail: Apple, Android, Chrome, Safari quotes

### 7.1 Apple (developer.apple.com, JSON form)

- Export compliance (`documentation/security/complying-with-encryption-export-regulations`): "Add the
  `ITSAppUsesNonExemptEncryption` key to your app's information property list ... Set the value to `NO` if your app
  ... doesn't use encryption, or if it only uses forms of encryption that are exempt from export compliance documentation
  requirements. Otherwise, set it to `YES`." And "If you provide complete information, Apple expects to review and clear
  apps in approximately two business days." (help page `determine-and-upload-app-encryption-documentation`)
- Controls (`documentation/widgetkit/creating-controls-to-perform-actions-across-the-system`): see A3.3. Controls reload
  "when someone interacts with it, when the app asks to reload it using the shared ControlCenter, or when the system
  receives a remote push notification from APNs".
- Safari (`documentation/safariservices/managing-safari-web-extension-permissions`): "Prioritize using `activeTab`, host
  permissions, and `optional_permissions`; only use `<all_urls>` if there is no other option." "In Safari 17 and later,
  when you grant access to an extension for a specific web site, that grants the extension access to the site across all
  profiles, private browsing, and browsing without a profile."
- Silent push: see A3.5.

### 7.2 Android (developer.android.com)

- Direct Share (`develop/ui/compose/sharing/direct-share-targets`, redirected from `training/sharing/direct-share-targets`): A4.1.
- Tiles (`develop/ui/views/quicksettings-tiles`): A4.2, "Last updated 2026-10-16 UTC".
- FGS (`develop/background-work/services/fgs/*`): `timeout` page: dataSync/mediaProcessing "6 hours in the last 24"
  limit applies when "targeting Android 15"; `service-types`: "The Service.onTimeout() callback doesn't exist on Android 13
  and lower."
- Android 13 behaviour (`about/versions/13/behavior-changes-all`): Task Manager, restricted bucket, prefetch jobs.

### 7.3 Chrome

- Review process (`webstore/review-process.md`): "Reviews may take longer for extensions that request broad host permissions
  or sensitive execution permissions, or which include a lot of code or hard-to-review code." Also "Obfuscation is
  disallowed ... Minification is allowed".
- Service worker lifecycle: A5.1. Note the page is at the legacy `mv3/service_workers` path in the repo and is current text.

## 8. What stays unresolved, and the exact document that would settle it

| Item | What would settle it | Why it is unreachable here |
|---|---|---|
| B1 Instapaper digests | Instapaper help centre or blog post, Feb 2026, and the Premium comparison page | instapaper.com hosts denied; no search budget |
| B2 Pocket deletion vs export | Mozilla support article "future-of-pocket" (and its "exporting your pocket list" companion) | support.mozilla.org denied |
| B3 TechCrunch 16 Nov wording | The TechCrunch Omnivore article of Oct 2024 | techcrunch.com denied |
| B4 Tailscale reaction count | Logged-in view of the issue (the public render hides reactions) | the page reports "Reactions are currently unavailable" |
| B5 Kobo dates | Rakuten Kobo help article about Instapaper | help.kobo.com denied |
| B6 Readwise price, "Public Beta" | readwise.io/pricing and the Reader docs home | host does not resolve here |
| B8 Boox NeoReader | Boox NeoReader release notes and the r/Onyx_Boox thread | hosts denied |
| A1.8 R2 card requirement | A fresh Cloudflare account walk-through, or the R2 enable-flow screenshot in the dashboard | dashboard behaviour, not in the docs repo |
| A3.1 exact iOS extension memory number | An Apple engineer post (Apple Developer Forums) or an on-device measurement with Instruments/jetsam logs | Apple publishes no number; forums not searchable |
| A5.3 optional `<all_urls>` review treatment | Chrome Web Store support statement or a past submission's review time | not documented |
| Workerd CPU for Readability/EPUB | A deploy-time canary (DESIGN.md 2.2 rule 7) running on the free plan | my numbers are Node, not workerd |

## 9. Source URL list

Cloudflare docs (raw, branch `production`):
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers/platform/limits.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers/platform/pricing.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers/configuration/cron-triggers.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers/runtime-apis/bindings/rate-limit.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/email-service/platform/limits.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/email-service/platform/pricing.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/email-service/get-started/route-emails.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/email-service/api/route-emails/email-handler.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/partials/email-service/domain-setup-routing.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/r2/pricing.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/r2/platform/limits.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/r2/api/s3/presigned-urls.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/r2/api/tokens.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/r2/objects/upload-objects.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/d1/platform/limits.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/partials/workers/d1-pricing.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/kv/platform/limits.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers-ai/platform/pricing.mdx
- https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers-ai/platform/limits.mdx

ntfy: https://raw.githubusercontent.com/binwiederhier/ntfy/main/docs/publish.md ; .../docs/config.md ; .../docs/releases.md ;
.../docs/subscribe/api.md ; .../server/config.go ; .../server/errors.go ; .../server/server.go

Apple: https://developer.apple.com/tutorials/data/documentation/security/complying-with-encryption-export-regulations.json ;
https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance ;
https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation ;
.../documentation/widgetkit/creating-controls-to-perform-actions-across-the-system.json ; .../widgetkit/controlwidgetbutton.json ;
.../appintents/returnsvalue.json ; .../safariservices/managing-safari-web-extension-permissions.json ;
.../safariservices/optimizing-your-web-extension-for-safari.json ;
.../usernotifications/pushing-background-updates-to-your-app.json ;
.../foundation/downloading-files-in-the-background.json ; .../foundation/urlsessionconfiguration/sharedcontaineridentifier.json ;
https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionCreation.html

Android: https://developer.android.com/develop/ui/compose/sharing/direct-share-targets ;
https://developer.android.com/develop/ui/views/quicksettings-tiles ;
https://developer.android.com/reference/android/content/Intent ;
https://developer.android.com/about/versions/13/behavior-changes-all ; https://developer.android.com/about/versions/13/behavior-changes-13 ;
https://developer.android.com/develop/background-work/services/fgs/changes ; .../fgs/timeout ; .../fgs/service-types

Chrome / MDN BCD / SDK: https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/docs/extensions/mv3/service_workers/service-worker-lifecycle/index.md ;
.../site/en/docs/webstore/review-process.md ; .../site/en/docs/extensions/mv3/permission_warnings/index.md ;
https://raw.githubusercontent.com/mdn/browser-compat-data/main/manifests/webapp/share_target.json ;
https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/sidePanel.json ;
https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/README.md

Conflict checks: https://pypi.org/pypi/stkclient/json ; https://github.com/maxdjohnson/stkclient/releases ;
https://github.com/omnivore-app/omnivore/issues/4416 ; https://raw.githubusercontent.com/omnivore-app/omnivore/main/README.md ;
https://github.com/pabuisson/in-my-pocket/issues/4 ; https://github.com/daniel-j/send2ereader/issues/52 ;
https://raw.githubusercontent.com/voidberg/instakobo/main/README.md ; https://github.com/tailscale/tailscale/issues/8626 ;
https://github.com/markleit/oldmansbookclub_ios/issues/183 ; https://github.com/jiegui2025/larimar/issues/14

Local files read: `reader-experiment/share/PROTOCOL.md`, `share/NTFY-FACTS.md`, `share/CHANGES-v1.1.md`, `share/js/daylight-share.js`,
`server/DESIGN.md` (rev 2), `LAB-DECISIONS.md`, `extension/src/manifest.json`, `apple/Shared/ShareExtension/GetPage.js`,
`android/app/build.gradle.kts`, `android/app/src/main/AndroidManifest.xml`.
