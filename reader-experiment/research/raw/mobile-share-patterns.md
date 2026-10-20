# Mobile share-sheet and companion patterns: raw research notes

Angle: how the best mobile apps send things elsewhere. iOS share vs action extensions, Shortcuts and App Intents, widgets, Control Center controls, Back Tap, Live Activities, Android direct share, Quick Settings tiles, clipboard prompts, bubbles, awkward share sources, camera scanning, file pickers, and "it arrived" confirmation.

Written 2026-10-20 for "Send to Daylight" (Lab version research swarm).

---

## 0. READ THIS FIRST: what this run could and could not reach

**WebSearch was unavailable.** Every WebSearch call returned "this turn's web search budget is used up (limit: 200 WebSearch calls per turn, shared by every agent in it)". The swarm spent the budget before this agent ran. I did not work around it (no curl/wget to search engines, no readers, proxies or archives). Consequences:

- No Reddit, Hacker News, YouTube, MobileRead or review-site evidence. Nothing here is from those sources.
- No App Store or Google Play reviews. `apps.apple.com`, `play.google.com`, `chromewebstore.google.com`, `support.apple.com`, `developers.google.com`, `support.mozilla.org`, `docs.readwise.io`, `readwise.io`, `www.amazon.com`, `help.instapaper.com`, `en.wikipedia.org`, `developer.chrome.com`, `developer.mozilla.org` and `www.pushbullet.com` all failed DNS resolution in WebFetch (`getaddrinfo ENOTFOUND`).
- Reachable and used: `developer.android.com`; `developer.apple.com` (the normal pages are JS-rendered and return only a title, but the JSON endpoint form `https://developer.apple.com/tutorials/data/documentation/<path>.json` works, as do `/library/archive/` pages); `github.com` pages (READMEs and issues); the GitHub MCP issue-search tool (it works against any public repo given `owner`/`repo`; `issue_read` was refused for repos outside the session).

**Evidence tiers used below**

- **[DOC]**: first-party documentation fetched this session. URL given.
- **[ISSUE]**: a real user or maintainer comment on a public GitHub issue, fetched this session. URL given. This is the closest thing to "user voice" I could reach. These are mostly self-hosted or open-source apps, so the audience skews technical.
- **[TITLE-ONLY]**: seen in an issue-search listing (title and reaction counts) but the body was not fetched.
- **[MEMORY]**: my own background knowledge. NOT verified this session and no URL. Treat as hypotheses to check.

**Quote caveat:** the fetch tool limits verbatim quotes to about 125 characters per quote. Where a quote is cut off, it is marked as an excerpt. Paraphrases are marked "(paraphrase)".

**Dates:** today is 2026-10-20. Issue dates below are as shown on the pages.

---

## 1. Products and projects actually examined

| Product | Platforms | Status | What it taught us | Evidence |
|---|---|---|---|---|
| Karakeep (formerly Hoarder) | iOS, Android (React Native/Expo), web, browser extensions | Active (server v0.33.x, Sep 2026) | The best public record of share-sheet friction (app-opens-after-save, offline queue, odd share sources, Shortcuts, Quick Settings tile) | [ISSUE] section 4 |
| Omnivore | iOS, Android, web, Chrome/Safari/Firefox/Edge extensions | Cloud app deprecated Nov 2024; self-host only | Share extension, Shortcuts "Save URL" action, add-by-email, labels at save time | [DOC] https://github.com/omnivore-app/omnivore ; [ISSUE] |
| wallabag Android app | Android | Active, FOSS | Tag-at-share, share-intent behaviour, "don't launch the web app" | [ISSUE] |
| Zotero for iOS | iOS | Active | A mature share extension with live Saved/Failed states and collection/tag pickers | [ISSUE] |
| Tailscale Taildrop | iOS, macOS, Android, Windows, Linux | Active (Taildrop labelled alpha on Android) | "Send file to my other device" via share sheet; the most detailed public evidence on delivery notifications, progress and Shortcuts | [ISSUE] |
| LocalSend | iOS, Android, macOS, Windows, Linux | Active | AirDrop-style cross-platform sender; share-sheet and favourites requests | [DOC] https://github.com/localsend/localsend ; [ISSUE] |
| KDE Connect | Android + desktop | Active | Share files and URLs, notification sync, clipboard sync | [DOC] https://github.com/KDE/kdeconnect-android |
| PairDrop | Any browser (PWA) | Active | Persistent pairing by 6-digit code or QR, receiver-accepts, ZIP, keep-awake, warn on close | [DOC] https://github.com/schlagmichdoch/PairDrop |
| Send to KOReader (Tsukumi233) | Android app + KOReader patch; iOS via Shortcut | Created 2026-10-08, brand new | A "Send to Kindle, but for KOReader" via WebDAV; closest analogue to what we are building | [DOC] https://github.com/Tsukumi233/send-to-koreader |
| Immich mobile | iOS, Android | Active | Upload progress, false "success" notifications, foreground-only upload complaints | [ISSUE] |
| paperless-mobile | Android, iOS (Flutter) | Active | Document-scan quality, ML Kit vs F-Droid, "share from an external scanner" | [ISSUE] |

**Products I could not verify this session [MEMORY only, no URL]:** Instapaper, Readwise Reader, Pocket (the task brief says it closed in 2025; I could not confirm), Matter, Amazon Send to Kindle, Pushbullet, Join (joaomgcd), AirDrop, Android Quick Share, Chrome "Send to your devices", Firefox Send Tab, reMarkable "Read on reMarkable", PocketBook send-by-email, Kobo. See section 12 for what I believe about them, clearly flagged.

---

## 2. iOS: platform facts [DOC]

### 2.1 Share extension vs Action extension

- Apple's Share guide says the Share extension's job is posting: "The primary purpose of a Share extension is to help users post content." It also warns: "If you want to create an extension that lets users perform a different task with their content or that gives users updates on information they care about, the Share extension point is not the right choice." https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html
- Share extension lifecycle (paraphrase of the same page): the user taps Post, the system calls `didSelectPost`, you set up a **background-mode `NSURLSession`** containing the content, start the upload, then call `completeRequestReturningItems:...` to tell the host app the request is done, and "prepare to be terminated". The system animates feedback while this happens.
- The same page tells extensions to validate content before enabling Post (for example "don't enable Post until an asset finishes shrinking"), to offer previews, and to expose options (account, privacy) as configuration rows. UI width is fixed, height may grow, and "you don't want to force users to scroll too much". Use Auto Layout.
- A URL session created inside an app extension must set `sharedContainerIdentifier`, or it is invalidated: "If you try to create a URL session from your app extension but fail to set this property to a valid value, the URL session is invalidated upon creation." https://developer.apple.com/tutorials/data/documentation/foundation/urlsessionconfiguration/sharedcontaineridentifier.json
- **Action extension** is for "targeted, lightweight tasks that display or change content". Apple warns it is the wrong choice for sharing to a social site. It is "listed in the action area of the activity view controller", and only appears if it declares the content type it can handle (a text-only action does not appear while viewing images). On iOS it appears in an action sheet or full-screen modal. https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Action.html
- Implication for us: "Send to Daylight" is a *Share* extension (it ships content out), which puts it in the app row of the share sheet. An *Action* extension would appear in the lower action list and suits things like "Send as PDF" or "Read on Daylight" that transform the current page. Having both is legitimate: Share for send, Action for "send this page as clean article / as PDF".
- `UIActivityViewController` also lets an app define its own `UIActivity` (custom service), set `excludedActivityTypes`, and get `completionWithItemsHandler` after dismissal. This is how the *containing app* offers "Send to Daylight" inside its own share button. https://developer.apple.com/tutorials/data/documentation/uikit/uiactivityviewcontroller.json

### 2.2 App Intents, Shortcuts, Siri, Action button

- App Intents "make your app's actions and data available outside your app". The overview lists Siri, Spotlight, Shortcuts, "Apple Pencil or the Action button", widgets/controls/Live Activities and Focus as consumers of the same intents. https://developer.apple.com/tutorials/data/documentation/appintents.json
- One intent definition therefore feeds: a Shortcuts action, a Siri phrase (via App Shortcuts), an Action-button assignment, a Control Center control, a widget button and Back Tap (Back Tap triggers a Shortcut; see 2.5).
- `ProvidesDialog` result type: "The result of performing an action that delivers a dialog back to the initiator of the action." `IntentDialog` is "the text you want the system to display, or speak, when requesting a value, asking for disambiguation, or confirming an action." This is the hook for a spoken or shown "Sent to your Daylight" confirmation. https://developer.apple.com/tutorials/data/documentation/appintents/providesdialog.json
- Shortcut result values matter. Omnivore users asked for the Save-URL action to **return a deeplink/id** so later steps can use it, and that was added in a TestFlight build (see section 4.5).

### 2.3 Controls (iOS 18+): Control Center, Lock Screen, Action button

- Controls let people run an action, open a specific view, or launch a locked camera-capture extension from **Control Center, the Lock Screen and the Action button**. Two kinds: buttons ("perform an action") and toggles. https://developer.apple.com/tutorials/data/documentation/widgetkit/creating-controls-to-perform-actions-across-the-system.json
- Privacy guidance in the doc: "require device authentication before a control performs its action, as well as redact the text in a control when the device is locked." A "Send clipboard to Daylight" control on the Lock Screen needs a deliberate decision about this.
- Buttons use `AppIntent` or `OpenIntent`. Toggles use `SetValueIntent`. Work goes in `perform()`: "finish all actions and save all state data before it returns." Controls can be configurable (for example, which device to send to).
- Control values can refresh on interaction, on a reload request from the app, or on an APNs push. So a "Daylight online / offline" toggle-style control could be kept current by a push from the relay.
- `OpenIntent` requires the intent's Target Membership to include both the app and the widget extension.

### 2.4 Interactive widgets

- Widgets and Live Activities can hold buttons and toggles that run an App Intent without launching the app. "On a locked device, buttons and toggles are inactive and the system doesn't perform actions unless a person authenticates and unlocks their device." https://developer.apple.com/tutorials/data/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities.json
- "An interaction with a button or toggle should do more than open the app."
- Toggles update optimistically. The doc's recommended sequence: update shared storage, sync with the server, reload the timeline after the server acks, and on error/timeout flip the toggle back and show a sync error.
- iPhone widgets on Mac: interactions are forwarded to the iPhone and "may take extra time".
- Implication: a medium widget with "Paste & send" and the last 3 sends with status is feasible. Remember the widget cannot do networking itself in a Live Activity, but a widget's intent can run `perform()`.

### 2.5 Back Tap

- Could not fetch Apple's support page (`support.apple.com` unreachable). [MEMORY] Back Tap (Settings > Accessibility > Touch > Back Tap, iPhone 8 and later) can run a Shortcut on double or triple tap. So the realistic way to offer Back Tap is to ship a good Shortcut action; there is no separate API. Flagged unverified.

### 2.6 Live Activities for transfer progress

- Live Activities show on the Lock Screen, Dynamic Island, CarPlay, and a paired Mac or Apple Watch. https://developer.apple.com/tutorials/data/documentation/activitykit/displaying-live-data-with-live-activities.json
- Limits (verbatim from the doc): up to **eight hours** active; Lock Screen presence at most **12 hours**; static plus dynamic data "can't exceed a combined size of 4 KB"; "unlike a widget, a Live Activity can't access the network or receive location updates", so updates come from the app or ActivityKit push; "In general, your app needs to be in the foreground to start a Live Activity" (a `LiveActivityIntent` can start one from the background); height may be truncated above 160 points; you must support all presentations.
- **iOS 26 `BGContinuedProcessingTask`**: "A task that starts in the foreground and can continue running in the background as needed." "The system displays the progress of this task in a Live Activity and a person can cancel it through the interface if they wish." The task must report progress via `ProgressReporting`, and "the system prioritizes the termination of tasks that reflect minimal or no progress, when resources become constrained". https://developer.apple.com/tutorials/data/documentation/backgroundtasks/bgcontinuedprocessingtask.json
- Fit for us: only for *large* sends (a 200 MB scanned PDF over a slow link). For a 50 KB article a Live Activity is overkill and would be noise. A good rule: start a Live Activity or continued-processing task only if the send will take more than a few seconds.

### 2.7 Clipboard detection

- iOS 14+: "the system notifies the user when an app gets general pasteboard content that originates in a different app without user intent." https://developer.apple.com/tutorials/data/documentation/uikit/uipasteboard.json
- You can check *without* triggering the alert via `hasURLs`, `hasStrings`, `numberOfItems`, `types`, `NSItemProvider canLoadObject`, and the pattern-detection methods (`detectedPatterns(for:)`, `detectedValues(for:)`). Apple: use these "rather than attempting to read pasteboard data".
- `UIPasteControl` (iOS 16+): "In iOS 16 and later, programmatic pasting raises a user alert that prompts the user for approval before the app gains access to pasteboard contents. Use this class to paste without a user prompt." https://developer.apple.com/tutorials/data/documentation/uikit/uipastecontrol.json
- Pattern for us: on foreground, use `hasURLs` to decide whether to show a **"Send copied link?" banner**; only read the URL after the user taps a system `PasteButton`/`UIPasteControl`. No scary alert.

### 2.8 Scanning paper

- `VNDocumentCameraViewController`: "enables a person to scan a physical document, page by page"; results are images by page number; "your app can create a digital version of the physical document and export the scanned images to PDF." iOS 13+, check `isSupported`. https://developer.apple.com/tutorials/data/documentation/visionkit/vndocumentcameraviewcontroller.json

### 2.9 Picking from Files, iCloud, Dropbox, Drive

- `UIDocumentPickerViewController`: "A view controller that provides access to documents or destinations outside your app's sandbox." Open and export modes; security-scoped URLs (`startAccessingSecurityScopedResource()`); "Don't copy the document if you can avoid it"; `asCopy` option; use file coordinators. The page does not mention Dropbox/Drive/File Provider by name. https://developer.apple.com/tutorials/data/documentation/uikit/uidocumentpickerviewcontroller.json

---

## 3. Android: platform facts [DOC]

### 3.1 Receiving shares (our share target)

- Declare `ACTION_SEND`/`ACTION_SEND_MULTIPLE` intent filters per MIME type; avoid `*/*` "unless your app is fully capable of handling any type of incoming content". Read `EXTRA_TEXT`, and `EXTRA_STREAM` with the type-safe `IntentCompat` getters (Android 13 deprecated the untyped one). https://developer.android.com/training/sharing/receive
- Direct quote worth keeping: "When users tap a share target associated with a specific activity, let them confirm and edit the shared content before your app uses it. This is especially important for text data." (Tension with the user demand for silent one-tap share; the answer is a very fast confirm sheet with an auto-send default.)
- "Take extra care to check incoming data: the wrong MIME type might be set, or an image being sent might be extremely large." Do I/O off the main thread.
- "As of Android 10 (API level 29), the Android Sharesheet only uses icons set in the manifest on your `application` tag."

### 3.2 Direct Share (our device appearing in the Sharesheet's top row)

- Direct Share shows contacts directly in the Sharesheet "without users having to select the app then search for the contact". Android 10 added the Sharing Shortcuts API; `ChooserTargetService` was deprecated in Android 11. https://developer.android.com/training/sharing/direct-share-targets
- Setup: a `<share-target>` in `shortcuts.xml` with a MIME `<data>` and a `<category>`; publish dynamic shortcuts with `ShortcutManagerCompat.pushDynamicShortcut`, each with matching categories, `setLongLived(true)` and an icon. Categories are required.
- Ranking guidance: keep shortcut ids stable and unique; report usage; "a conversation with no user activity in the last 30 days is considered stale"; when the user taps a target "go directly to the relevant action. Don't present the user a disambiguation UI". Max count is capped by `getMaxShortcutCountPerActivity()`. Use adaptive icons; "Do not provide imagery masked to a specific shape".
- The docs frame this for messaging, but nothing stops a "device" target (for example "Daylight DC-1") being published as a sharing shortcut. Android 14 added more ranking signals. https://developer.android.com/about/versions/14/features

### 3.3 Sharesheet sender-side features (also useful inside our own app)

- Android 14 custom actions: "apps can add custom actions to the Android Sharesheet. The custom actions are shown as small action icons at the top." Built with `ChooserAction.Builder` plus `EXTRA_CHOOSER_CUSTOM_ACTIONS`. https://developer.android.com/training/sharing/send
- `EXTRA_INITIAL_INTENTS` lets a sender add up to two custom targets, but "Every custom Intent that you add reduces the number the system suggests. In general, avoid adding custom targets."
- `EXTRA_CHOOSER_RESULT` via an `IntentSender` tells the sender which target the user picked.
- Use `EXTRA_TITLE` and a thumbnail to improve text/URL previews (Android 10+).
- "Use the Android Sharesheet to create consistency for your users across apps. Don't display your app's own list of share targets."

### 3.4 Quick Settings tile

- Tiles are for "specific functionalities that you expect users to either access often or need fast access to". Avoid using a tile just to launch the app or for one-time actions. "We recommend a maximum of two per app." https://developer.android.com/develop/ui/views/quicksettings-tiles
- Icon: solid white vector on transparent, 24 x 24 dp. Manifest label max 18 characters. Needs `BIND_QUICK_SETTINGS_TILE`. "Creating a `TileService` for your app doesn't add it to the user's Quick Settings panel."
- Android 13+: `requestAddTileService()` prompts the user to add the tile. "We recommend calling `requestAddTileService()` only in context, such as when the user first interacts with a feature that your tile facilitates." The system may stop honoring requests after repeated denials.
- Active tiles (declared `ACTIVE_TILE`) are recommended; you may update once per listening session. Tap handling: `onClick()` only for active/inactive tiles; `showDialog()`, `startActivityAndCollapse()`, background work. On a secure lock screen use `isSecure()` and `unlockAndRun()`.
- States: active / inactive / unavailable. Use `STATE_UNAVAILABLE` for "temporarily unavailable". A "Send clipboard" tile could show unavailable when the tablet is unpaired.

### 3.5 Clipboard

- Android 12+: reading the clip shows a toast "APP pasted from your clipboard". The toast does **not** appear if you read only metadata with `getPrimaryClipDescription()`. https://developer.android.com/develop/ui/views/touch-and-input/copy-paste
- Android 13+: the system shows its own copy confirmation with a preview, so in-app "Copied" toasts should be removed on 13+.
- Best practice from the page: "Check metadata before reading the data" (`hasPrimaryClip()`, `hasMimeType(...)`), "At any time, there is only one clip on the clipboard", and "treat intents from the clipboard as untrusted input".
- Foreground-only clipboard access on Android 10+ and Android 13 auto-clear are NOT covered on that page. [MEMORY] only.

### 3.6 Bubbles

- Bubbles are floating conversation windows for ongoing human communication. Since Android 11 a notification only bubbles if it meets conversation requirements and references a published sharing shortcut. "Send a notification as a bubble only if it is important, such as when it is part of an ongoing communication or if the user explicitly requests a bubble for content." https://developer.android.com/develop/ui/views/notifications/bubbles
- The page says Android 17 makes bubbles "a proper windowing mode, like split screen. This allows users to add any app to the bubble UI along with notification bubbles."
- Verdict: poor fit for one-off sends. Only relevant if the Lab ever wants a chat-like thread with the tablet (for example a running "inbox" conversation). Low value.

### 3.7 Progress, background and notifications

- **User-initiated data transfer (UIDT) jobs, Android 14+**: "intended for longer-duration data transfers that are initiated by the device user." They "require a notification, start immediately, and may be able to run for an extended period". Must be scheduled while the app is visible; "Periodically update the notification to keep the user informed of the job's status and progress"; unaffected by App Standby quotas; users can stop them from Task Manager (process killed, `onStopJob()` not called), so "Make sure that your app can persist the data transfer state". https://developer.android.com/develop/background-work/background-tasks/uidt
- **Android 16 progress-centric notifications**: `Notification.ProgressStyle` "to help users seamlessly track user-initiated, start-to-end journeys" (rideshare, delivery, navigation). Shown on lock screen and shade. https://developer.android.com/about/versions/16/features/progress-centric-notifications
- **Notification permission (Android 13+)**: "your app's notifications are off by default" on new installs. Ask in context, after a user action, not at first launch. Foreground-service notices still appear in Task Manager even if denied. https://developer.android.com/develop/ui/views/notifications/notification-permission
- Implication: a "Delivered to Daylight" receipt notification will be silently dropped on many devices unless we prompt for POST_NOTIFICATIONS at the right moment (right after the first successful send is the natural moment).

### 3.8 Shortcuts, assistant, file picking

- App shortcuts (static, dynamic, pinned): most launchers show about four; "There is no limit to the number of pinned shortcuts users can create". https://developer.android.com/develop/ui/views/launch/shortcuts
- App Actions / built-in intents let Assistant launch in-app destinations by voice, declared as `<capability>` in `shortcuts.xml`. https://developer.android.com/develop/devices/assistant/overview
- Storage Access Framework: `ACTION_OPEN_DOCUMENT` gives long-lived access; `ACTION_GET_CONTENT` is "read or import data". Providers such as Google Drive plug in. https://developer.android.com/guide/topics/providers/document-provider
- Photo Picker: grants access to only selected media, no broad permission; falls back to `ACTION_OPEN_DOCUMENT` where unavailable. https://developer.android.com/training/data-storage/shared/photopicker
- ML Kit Document Scanner: **could not fetch** (`developers.google.com` unreachable). [MEMORY] It is a Google Play services API that returns a cropped, perspective-corrected scan as JPEG and/or PDF with a built-in UI (edge detection, filters, page management) and needs no camera permission from the app. Not verified this session. Corroboration from a user: see section 4.8.

---

## 4. User voice from public issue trackers [ISSUE]

### 4.1 "Don't throw me into your app after I share" (top recurring complaint)

- Karakeep #237 "Mobile app: don't open after hoarding" (Jun 2024, still being commented on Sep 2026). https://github.com/karakeep-app/karakeep/issues/237
  - DominikBritz: "When I hoard something via the Android share menu, I get the black "Hoarded!" screen and then the mobile app opens." And: "I mean my point of hoarding is to read it later - seeing the app is unnecessary."
  - lucius346346: "It should probably display a toast message or a toolbar, like Pocket has."
  - Maintainer MohamedBassem: "Unfortunately, it's currently a limitation in the library we're using for the share sheet."
  - zjw2018SS (Sep 9, 2026): "Still very relevant in 2026 — sharing from the Android share sheet still launches the full Karakeep app." Proposed ideal flow: "Share → Karakeep → save in place → brief confirmation → remain in the originating app." And suggested the fix may need "a Karakeep-specific native share target / share extension" rather than the cross-platform library.
- Karakeep #1984 "iOS: Keep user in current app when sharing via Share Sheet" (Sep 2025). Reporter: "Currently, when sharing content to Karakeep via the iOS share sheet, the app itself is opened every time." Closed as a duplicate of #237. https://github.com/karakeep-app/karakeep/issues/1984
- Karakeep #3018 iOS share extension saves but "leaves originating app frozen/unresponsive" (iOS 26, Safari and Facebook; confirmed by two others on iOS 26.6.1; maintainer blames the upstream `expo-share-intent` library; open, labelled pri/high). https://github.com/karakeep-app/karakeep/issues/3018
- **Lesson:** a cross-platform framework share shim (Expo/React Native) caused all three. Our companions should use true native iOS Share Extension and true native Android share-target Activity, both of which finish immediately with a confirmation and never launch the main app.

### 4.2 "Let me tag/choose at share time, without leaving the app"

- wallabag Android #675 "Tag right after share" (14 thumbs-up, opened 2018, closed 2020). Requests included tagging from the browser share flow; one comment: "+1 When I save a lot of articles, later retrieval is faster when they are tagged at once." Another: "+1 Pocket does have a pretty useful mechanism for such feature." https://github.com/wallabag/android-app/issues/675
- Omnivore #2230 "way to specify labels at page saving time on android" (closed "not planned" Nov 2024). dairefagan: "we should not have to leave the browser to add labels", and describes only "a small toast/banner at the bottom of the screen for a few seconds without a dismiss button." macdonaldster: "I suspect most people don't want to interrupt their reading to tag". https://github.com/omnivore-app/omnivore/issues/2230
- Zotero iOS share extension has a collection and tag picker; tracked defects show how hard it is to get the picker UI right (Cancel buttons clashing, search covering Save): https://github.com/zotero/zotero-ios/issues/687
- **Lesson:** a compact post-share panel (destination device, "send as" format, optional note/tag) with an auto-send countdown or one-tap default satisfies both camps.

### 4.3 "Put my devices directly in the share sheet" (the Pushbullet gap)

- LocalSend #2351 "Show target devices directly in the system share menu" (Mar 2025). The user "moved from PushBullet to LocalSend" and says the one feature missing is showing targets in the share menu: Pushbullet put target devices at the top of the share dialog next to phone contacts so sharing took one tap (paraphrase; excerpt-limited). https://github.com/localsend/localsend/issues/2351
- LocalSend #3014 (iOS, Apr 2026): "It'd be nice if I could have the favorites show up directly in the share sheet, and be able to one click share without needing to swap apps and confirm send etc." https://github.com/localsend/localsend/issues/3014
- Tailscale #9444 "Add connect button in Taildrop (iOS sharing pane)": the reporter is often not connected on mobile because the app "is power hungry", sees a "(!) Connect to Tailscale" warning in the share pane and has to leave, open the app, connect and come back. Desired: "share the file, tap on Tailscale, tap on 'Connect', tap on the device." https://github.com/tailscale/tailscale/issues/9444
- Tailscale #4896 "Taildrop to clipboard" (36 thumbs-up): "Sharing via Taildrop produces a file on the Desktop, which is a bit cumbersome if all you want is to copy it somewhere"; "share text on phone, open file, copy to clipboard has 200% more steps than share text". A maintainer reports that as of Tailscale v1.104.1 "the Android, iOS & macOS share sheets have been enhanced to support both text selections and URLs", with "text selections will transfer as .txt files and links will arrive as either .url or .inetloc files". https://github.com/tailscale/tailscale/issues/4896
- **Lesson:** Android direct-share top-row device target, iOS suggestion donation where possible, and a pane that never makes the user leave to fix a connection. Also: sending a *URL* as an opaque `.url`/`.inetloc` file is a poor result; the receiver should render it as a web page.

### 4.4 "Tell me it arrived" (confirmation, receipts, progress)

- Tailscale #8626 "Taildrop Android no notification when file is delivered" (22 thumbs-up, open since Jul 2023, 27+ comments, still affirmed Aug 2026). https://github.com/tailscale/tailscale/issues/8626
  - "The file shows up in downloads, but there is no notification." (jstebbins, Jan 2024)
  - "the fact that no notification shows up at all on Android devices is really confusing." (clari7744, May 2025)
  - "This was originally reported more than 2 years ago and it's still an issue on Android." (drm-nz, Sep 2025)
  - Xiaomi/MIUI report: the system "seems to prevent the Tailscale app from accepting incoming TCP connections", and the sender sees "peer is offline".
- Tailscale #18200 "View sending progress for Taildrop file transfer on Android" (Dec 2025): once you leave the send page "they can't get back to it to see progress"; they check by watching the file size grow on the server; they propose "have the progress/status show in a notification where we can see status" with pause, resume and retry. https://github.com/tailscale/tailscale/issues/18200
- Tailscale #17988: on iOS the "Receive Pending File" alert did not appear for a ~3 GB file even though logs showed the transfer completed. https://github.com/tailscale/tailscale/issues/17988
- Tailscale #18537: the iOS "send file" **Shortcut** "reports success but the file arrives empty" (0 bytes), while Share → Tailscale worked. Maintainer reply says fix PRs merged but the stable build ships later. https://github.com/tailscale/tailscale/issues/18537
- LocalSend #3197 (Jul 2026): after a share-sheet send finishes, the app stays on the "Finished" screen; the next share is ignored until you tap Done. Same on Android and desktop. https://github.com/localsend/localsend/issues/3197
- LocalSend #3574 (title only): "[Android] share-intent files arrive as 0 bytes at receiver". https://github.com/localsend/localsend/issues/3574
- Immich #2531: "Immich should not claim the upload succeeded when it actually didn't." (server returned 500 while the app notified success). https://github.com/immich-app/immich/issues/2531
- Immich #30391 (Jul 2026): uploads only worked with the app in the foreground; maintainer replied "working as expected" and closed it as not planned; the reporter noted Ente uploads in background on the same phone. https://github.com/immich-app/immich/issues/30391
- Karakeep #2401 "Offline mode for mobile app to store links until it's connected again" (23 reactions: 17 thumbs-up, 5 hearts; approved, open): sharing when the server is unreachable "just kind of... spins... and tries to connect"; one user "had to put links into a text file" during a 3-day outage; another could not queue articles before a flight; a June 2026 comment: "I was just on a flight and disappointed this wasn't already a thing." https://github.com/karakeep-app/karakeep/issues/2401
- Zotero iOS share extension states: a disabled/grayed Save button and an error mark on the PDF icon if download fails; a false failure state after a successful save was a bug (#399), and "Share extension: Show PDF icon with X on download failure" (#398). https://github.com/zotero/zotero-ios/issues/399
- **Lesson (the biggest one for us):** receipts are the most-asked-for and most-broken feature in the category. Distinguish four states and never conflate them: *queued on phone*, *accepted by relay*, *received by tablet*, *opened/readable on tablet*. Do not show "success" until the right state is true. On Android also ask for notification permission so the receipt can be shown.

### 4.5 Shortcuts, App Intents, Siri, quick actions

- Tailscale #2504 "iOS/MacOS Shortcut support" (34 thumbs-up, opened Jul 2021, shipped in 1.36 in Jan 2023). After it shipped, a user said it "made tailscale on iOS so much more powerful". But automations showed an alert that had to be tapped before running (apparently a privacy safeguard), and "a time-based automation does not give you a notification". https://github.com/tailscale/tailscale/issues/2504
- Omnivore #2264 "iOS Share Sheet Action" (8 thumbs-up): the author tried the Shortcuts action `SaveLinkToOmnivore`, "which didn't work when sharing from NetNewsWire". Closed "due to age, and the self-hosted nature of Omnivore" on Aug 25, 2026. https://github.com/omnivore-app/omnivore/issues/2264
- Omnivore #3898: "When adding a URL to Omnivore using Shortcuts; there is no return value." Asked for a deeplink/id to be returned; maintainer: "Updated this in the last TestFlight build." https://github.com/omnivore-app/omnivore/issues/3898
- Karakeep #2892 "iOS - Shortcuts Integration": "Add shortcuts for iOS so that one can chain automations"; a commenter's workaround is to call the HTTP API from Shortcuts. https://github.com/karakeep-app/karakeep/issues/2892
- Tailscale Android: #16415 "Add Android App Shortcuts" (long-press launcher shortcuts; Samsung Routines can fire them; "Preferably, the app wouldn't need to launch any UI"), #17738 "Android App Actions / Shortcuts to trigger Connect / Disconnect" (12 thumbs-up, closed), launcher-shortcut commits appeared Jun-Sep 2026. https://github.com/tailscale/tailscale/issues/16415
- **Lesson:** Shortcuts/App Intents are asked for by power users and then used heavily. Return values and honest failure (not "success" with an empty file) matter more than the number of actions. Provide long-press launcher shortcuts on Android too.

### 4.6 Quick Settings tile and one-tap clipboard capture

- Karakeep #3074 "Android Quick Settings tile for one-tap clipboard capture" (Sep 2026): proposes a tile that "saves the current clipboard content in a single tap", beating "+ → Clipboard" and the share sheet, both of which "require switching into Karakeep". Maintainer asked: "Is it a common thing that people use those quick action tiles for such functionality?" The requester cites precedent in note apps (a "Capture to Relic" tile, Notesnook, Obsidian) and concedes "save current clipboard directly" is "less common than simply opening a quick-capture screen". Status: open, pending clarification. https://github.com/karakeep-app/karakeep/issues/3074
- Tile reliability is a known pain point for other apps: Tailscale #2646 "Android quick settings tile does not work" (16 thumbs-up, 39 comments), #12082 "Android Quick Setting Tile Gone" (9 thumbs-up), #1225 state "inverted/out of sync" (all [TITLE-ONLY]). https://github.com/tailscale/tailscale/issues/2646
- **Lesson:** ship the tile, but keep tile state honest and offer both "send clipboard now" and "open quick-capture".

### 4.7 Awkward share sources

- **Text-plus-URL blobs (Apple News, Amazon app, Reddit, Brave, Firefox iOS, Le Monde):** Karakeep #956 "Apple News Links Saved as Text" (Feb 2025). benbrooks: "On iOS/iPadOS, sharing to Hoarder from Apple News, saves the headline and link to article as plain text." Maintainer: same result from the Amazon app. Other reporters: Firefox on iOS 18.3, Reddit, Brave. s256 (paraphrase): the title is glued to the URL, "which makes it impossible to crawl", and because links cannot be edited the bad entries are permanent. Fixed in a mobile app update Mar 2025. https://github.com/karakeep-app/karakeep/issues/956 ; same problem with Le Monde in #948: "the saved item is just a plain text note with text and a link" and "Hoarder never scraps it, considering it's just a note." https://github.com/karakeep-app/karakeep/issues/948
- **Substack iOS app:** Karakeep #3134 (Sep 30, 2026): iOS share links "capture referral overlay instead of article"; wanted "resolve the appropriate article URL **before the initial crawler fetch**". https://github.com/karakeep-app/karakeep/issues/3134
- **X/Twitter:** Karakeep #1468 "Save Twitter/x.com thread" (12 thumbs-up, open): "the value of the tweet is the threat [thread], not the first post"; workaround is a headless browser scrolling to the end. Karakeep #1331 x.com media not downloaded ([TITLE-ONLY]). https://github.com/karakeep-app/karakeep/issues/1468
- **Firefox mobile shares:** wallabag Android #902 "share sites to wallabag from firefox in android - no poster image" and Karakeep #801 "Sharing to App via Firefox no Screenshot/clickable Link" ([TITLE-ONLY]).
- **Newsletters / email:** Omnivore #1829 "Add URL via email" (Feb-Apr 2023): "send an URL to your omnivore email" with the URL as subject; implemented Apr 2023 and confirmed working. https://github.com/omnivore-app/omnivore/issues/1829 . Omnivore's README says newsletters can be added "by email, with Substack support". https://github.com/omnivore-app/omnivore
- **YouTube:** Omnivore #2652 "Edge extension: cannot take notes when saving YouTube links" ([TITLE-ONLY]); no strong user-voice evidence on YouTube share behaviour found in this run.
- **Share format bug in reverse:** Omnivore #3277 "Share to clipboard is missing a space between parsed article title and URL" ([TITLE-ONLY]).
- **Lesson:** build a "share-intake normaliser": prefer the typed URL attachment (`public.url`) over the text blob on iOS; on Android parse `EXTRA_TEXT` for the first URL and keep `EXTRA_SUBJECT`/`EXTRA_TITLE` as the title; unwrap known wrappers (Substack referral overlay, tracking params, AMP, apple.news); detect and handle thread/video types explicitly; let the user fix a bad send *after* the fact (Karakeep users could not edit links).

### 4.8 Scanning paper

- paperless-mobile #322 "Improved custom document scanner". https://github.com/astubenbord/paperless-mobile/issues/322
  - Drexel2k: "the PDFs are so compressed that Paperless had some problems recognizing them"; prefers Google's document scanner for "document border recognition and post editing possibilities".
  - goncalossilva: "Most scans lack contrast and look blurry in comparison with most 'scanner' apps."
  - cprpolo asked how to "tweak" the scan before upload (brightness, like CamScanner).
  - Maintainer: many scanner libraries use Google ML Kit, "which is prohibited by F-Droid"; a rewritten scanner reached alpha in Apr 2026 and a tester said "it's a huge improvement!"
- paperless-mobile #657: "FairScan -> Share with -> paperless already works": users are happy to scan with a dedicated scanner and share the result. https://github.com/astubenbord/paperless-mobile/issues/657
- **Lesson:** scan quality (contrast, de-blur, border detection, post-edit) is what users judge. For a grayscale LivePaper screen, a high-contrast/B&W/"clean up for e-paper" filter would be a differentiator. Also keep "share a PDF from any scanner app" working.

### 4.9 Safari/Mac

- Karakeep #1625 "Share from Safari on MacOS?": a contributor says "The MacOS Safari extension works pretty well in MacOS Safari, but it hasn't a MacOS Share-Sheet", suggesting one "like the one in Reeder Classic". https://github.com/karakeep-app/karakeep/issues/1625
- Karakeep #3082 (Sep 2026): the browser extension should "open the existing bookmark instead of showing the new-bookmark form" when the URL is already saved, to avoid "accidentally re-saving". https://github.com/karakeep-app/karakeep/issues/3082

### 4.10 Extra clicks

- Omnivore #3335 "Chrome extension requires extra click to save a link": "with the Chrome extension I need to do one extra click to save it, which is kind of annoying" (right-click context menu path). https://github.com/omnivore-app/omnivore/issues/3335

---

## 5. Documentation of comparable tools [DOC]

- **Send to KOReader** (2026-10-08): README (Chinese) describes "a Send to Kindle experience" for KOReader using your own WebDAV storage. Android share target uploads to a WebDAV folder; a KOReader patch scans every 2 minutes (and on Wi-Fi connect, wake, startup; minimum 60 s), then shows a "new book received" notice. Share menu in any Android app including "open with other app" from WeChat/QQ; multi-file; progress display and retry on failure; iOS via a Shortcut instead of an app. Limits: a 300 MB per-book auto-download cap. App is about 25 KB with no third-party dependencies. https://github.com/Tsukumi233/send-to-koreader
- **PairDrop** README: pairing by 6-digit code or QR is **persistent** ("You find your devices even after reopening PairDrop"); "Files are transferred after a request is accepted"; multiple files download as a ZIP with one overall progress indicator; "Devices are kept awake during transfers" and the user is warned before closing mid-transfer; paste text/files and "choose the recipient afterwards". https://github.com/schlagmichdoch/PairDrop
- **KDE Connect**: share files and URLs between devices, notification sync with reply, clipboard sync, TLS over the local network. https://github.com/KDE/kdeconnect-android
- **LocalSend**: no internet needed; devices listed by local discovery; troubleshooting notes list AP isolation, iOS/macOS Local Network permission and VPNs as reasons devices do not appear; favourites can be probed directly; manual IP entry fallback. https://github.com/localsend/localsend
- **Omnivore** (README): native iOS and Android apps, extensions for Chrome/Safari/Firefox/Edge, email newsletters (Substack supported), PDF support, offline reading, labels; "The Cloud application was deprecated in November of 2024." Now self-host only. https://github.com/omnivore-app/omnivore
- **wallabag Android** README: adjustable font and themes, text-to-speech, optional local image caching; says nothing about share-target behaviour. https://raw.githubusercontent.com/wallabag/android-app/master/README.md

---

## 6. Patterns that clearly work (synthesis from sections 2-5)

1. **Native, instant, in-place share.** Share extension / share-target Activity that shows a tiny sheet or nothing, finishes in under a second, and confirms with a toast/HUD. Never open the main app (Karakeep #237, #1984, #3018).
2. **Offline-first outbox.** The share is accepted instantly and queued; the extension never blocks on the network (Karakeep #2401).
3. **Four-state receipts** and a visible outbox with retry (Tailscale #8626, #18200, #17988; Immich #2531).
4. **Devices in the sharesheet.** Android direct-share; iOS suggestions where possible; favourites (LocalSend #2351, #3014).
5. **One intent, many entry points.** App Intents for Shortcuts, Siri, Action button, Control Center, widget, Back Tap (via Shortcut).
6. **Normalise what gets shared.** Typed URL first; strip wrappers; handle X threads, Substack, Apple News.
7. **Ask for permissions in context.** POST_NOTIFICATIONS after first send; tile-add prompt after first clipboard send; paste via system paste control.
8. **Scan with quality.** Use the platform scanner UI and add filters; convert to PDF; send.

---

## 7. Pitfalls and failure modes to avoid

- Cross-platform share libraries that force the main app to open or freeze the host app after dismissal (Karakeep #3018 on iOS 26).
- "Success" reported while the receiver has an empty file or nothing (Tailscale #18537, LocalSend #3574, Immich #2531).
- Silent delivery with no notification on Android (Tailscale #8626). Check POST_NOTIFICATIONS and OEM background killers (Xiaomi/MIUI reports).
- Stale "Finished" screens that swallow the next share (LocalSend #3197). Always start a fresh send flow on a new share intent.
- Sending a link as an opaque file (`.url`, `.inetloc`) so the user has to open it to read the URL (Tailscale #4896).
- Foreground-only transfers (Immich #30391). Use iOS background `URLSession` with a shared container, `BGContinuedProcessingTask` on iOS 26, and Android UIDT jobs or a foreground service.
- A control or widget that runs while the phone is locked without any auth consideration (Apple's own guidance on redaction and authentication).
- Too many Quick Settings tiles ("a maximum of two per app") or too many custom Sharesheet targets (each "reduces the number the system suggests").
- Bubbles for non-chat content; Apple/Google both frame these surfaces for communication.
- Quick Settings tile state drifting out of sync (Tailscale #1225, #2646).
- Share-extension UI defects: clipped dialogs with long titles, Cancel buttons clashing with search (Zotero #403, #687).
- Dependence on Google ML Kit for scanning excludes F-Droid; not an issue for a Daylight-store app but worth knowing.

---

## 8. Candidate Lab features for Send to Daylight (my read)

Format: feature | platforms | value | needs (companion-only / +inbox / reader / server)

1. Silent in-place share with confirmation HUD | iOS ext, Android target, Mac Share | HIGH | companion-only
2. Offline outbox and send-later (tablet asleep, no network) | all | HIGH | companion-only (+ relay store-and-forward)
3. Honest four-state receipts with push/notification and a "Sent" history | all | HIGH | companion+inbox (extends existing receipts)
4. Share-intake normaliser (typed URL, Apple News/Substack/X, strip tracking) | all senders | HIGH | companion-only (some fetch work on inbox)
5. Android direct-share "Daylight DC-1" top-row target | Android | HIGH | companion-only
6. Shortcuts / App Intents "Send to Daylight" with return value, Siri phrase, Action button | iOS, Mac | MEDIUM-HIGH | companion-only
7. Control Center / Lock Screen control "Send clipboard" with locked-device handling | iOS 18+ | MEDIUM | companion-only
8. Android Quick Settings tile "Send clipboard" with in-context add prompt | Android | MEDIUM | companion-only
9. Clipboard banner "Send copied link?" using non-prompting checks | iOS, Android | MEDIUM | companion-only
10. Scan to PDF with grayscale/e-paper clean-up filter, multipage | iOS (VisionKit), Android (ML Kit / own) | HIGH for DC-1 | companion-only
11. Files/Drive/Dropbox/Photos picker, multi-file | iOS, Android, Mac | MEDIUM | companion-only
12. Compact pre-send panel: send-as (article / full page / PDF), optional note/tag, auto-send countdown | all | MEDIUM-HIGH | companion-only (+ inbox for folder/tag handling)
13. Widgets: Paste & send, recent sends with status, tablet reachability | iOS, Android | MEDIUM | companion-only
14. Large-file progress via Live Activity (iOS 26 continued processing) and Android UIDT/progress notification | iOS, Android | MEDIUM (LOW for small articles) | companion-only
15. Email-in address / forward newsletters from Mail/Gmail | server | MEDIUM | server
16. Return path: "Send back to phone/Mac" (annotated PDF from the pen) | all | MEDIUM | companion+inbox / reader
17. Duplicate-send detection ("already sent 2 days ago") | all | LOW-MEDIUM | companion-only
18. Persistent pairing, favourite devices, in-sheet "Connect" action when unreachable | all | MEDIUM | companion-only
19. Text-selection send (Android PROCESS_TEXT, iOS Action ext) as a rendered note or article, not a `.txt` | all | MEDIUM | companion+inbox
20. Bubbles | Android | LOW | companion-only

---

## 9. Daylight-specific design notes

- The DC-1 is the receiver, so the phone's job is *capture and confidence*. Every pattern above reduces to: capture in the fewest taps, and prove arrival.
- E2E encryption means the relay cannot fetch pages; "resolve the URL before fetch" (Karakeep #3134) must happen on the sender (or the tablet), not the relay. A server-side email-in feature (item 15) conflicts with E2E unless the address hands the relay ciphertext only; flag as a design decision.
- Grayscale LivePaper: scanning filters and "send as PDF vs article" matter more than colour fidelity. Offer "optimise for e-paper" (contrast, threshold) as a Lab option.
- The Wacom pen suggests a return path (annotated PDF back to phone or Mac) that readers like Karakeep users ask for as "outbound sharing" (Karakeep #1188, closed Jul 2026 via PR #1785): https://github.com/karakeep-app/karakeep/issues/1188

---

## 10. Not found / gaps (so nobody assumes they were checked)

- Reddit, HN, MobileRead, YouTube, review sites: not reachable this run.
- Direct evidence for Instapaper, Readwise Reader, Matter, Pocket, Amazon Send to Kindle, Pushbullet, AirDrop, Quick Share, Chrome Send to your devices, reMarkable, Boox, PocketBook, Kobo share/send flows: not fetched.
- Apple Back Tap, Control Center customisation and share-sheet-editing support pages: unreachable.
- ML Kit Document Scanner docs: unreachable.
- Apple Intelligence / Siri changes in iOS 26/27 that affect App Intents: not checked.
- Android Quick Share ↔ AirDrop interoperability status: not checked.
- Whether iOS share-sheet suggestions can be seeded for a custom device (INSendMessageIntent donation): not verified.
- Whether Safari on iOS supports the Web Share Target API (for the web sender page as PWA): not verified. [MEMORY] Chrome on Android does; iOS Safari does not.

If another pass has WebSearch budget, the highest-value follow-ups are: (a) App Store / Play reviews for Instapaper, Readwise Reader, Matter, Send to Kindle, Pushbullet alternatives; (b) Reddit threads on "best way to send articles to e-reader from iPhone/Android"; (c) MobileRead threads on Send to Kindle, KOReader send workflows, Boox/Daylight share; (d) the Apple Back Tap and Control Center support pages; (e) ML Kit Document Scanner docs.

---

## 11. Source index (every URL touched this session that returned content)

First-party platform docs
- https://developer.android.com/training/sharing/direct-share-targets
- https://developer.android.com/training/sharing/send
- https://developer.android.com/training/sharing/receive
- https://developer.android.com/develop/ui/views/quicksettings-tiles
- https://developer.android.com/develop/ui/views/touch-and-input/copy-paste
- https://developer.android.com/develop/ui/views/notifications/bubbles
- https://developer.android.com/develop/ui/views/notifications/notification-permission
- https://developer.android.com/develop/background-work/background-tasks/uidt
- https://developer.android.com/about/versions/16/features/progress-centric-notifications
- https://developer.android.com/about/versions/14/features
- https://developer.android.com/develop/ui/views/launch/shortcuts
- https://developer.android.com/develop/devices/assistant/overview
- https://developer.android.com/guide/topics/providers/document-provider
- https://developer.android.com/training/data-storage/shared/photopicker
- https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html
- https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Action.html
- https://developer.apple.com/tutorials/data/documentation/appintents.json
- https://developer.apple.com/tutorials/data/documentation/appintents/providesdialog.json
- https://developer.apple.com/tutorials/data/documentation/widgetkit/creating-controls-to-perform-actions-across-the-system.json
- https://developer.apple.com/tutorials/data/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities.json
- https://developer.apple.com/tutorials/data/documentation/activitykit/displaying-live-data-with-live-activities.json
- https://developer.apple.com/tutorials/data/documentation/backgroundtasks/bgcontinuedprocessingtask.json
- https://developer.apple.com/tutorials/data/documentation/uikit/uiactivityviewcontroller.json
- https://developer.apple.com/tutorials/data/documentation/uikit/uipasteboard.json
- https://developer.apple.com/tutorials/data/documentation/uikit/uipastecontrol.json
- https://developer.apple.com/tutorials/data/documentation/uikit/uidocumentpickerviewcontroller.json
- https://developer.apple.com/tutorials/data/documentation/visionkit/vndocumentcameraviewcontroller.json
- https://developer.apple.com/tutorials/data/documentation/foundation/urlsessionconfiguration/sharedcontaineridentifier.json

Project READMEs
- https://github.com/omnivore-app/omnivore
- https://github.com/localsend/localsend
- https://github.com/KDE/kdeconnect-android
- https://github.com/schlagmichdoch/PairDrop
- https://github.com/Tsukumi233/send-to-koreader
- https://raw.githubusercontent.com/wallabag/android-app/master/README.md
- https://github.com/googlesamples/mlkit (no document-scanner sample visible)

Issues fetched and read
- Karakeep: /issues/237, /1984, /3018, /354, /956, /948, /1468, /1188, /1625, /2401, /2892, /3074, /3082, /3134 under https://github.com/karakeep-app/karakeep
- Omnivore: /issues/2264, /3898, /2230, /1829, /3335 under https://github.com/omnivore-app/omnivore
- wallabag Android: /issues/675, /541 under https://github.com/wallabag/android-app
- Tailscale: /issues/8626, /4896, /18200, /9444, /17988, /18537, /2504, /16415 under https://github.com/tailscale/tailscale
- LocalSend: /issues/3014, /3197, /2351 under https://github.com/localsend/localsend
- Immich: /issues/30391, /2531 under https://github.com/immich-app/immich
- Zotero iOS: /issues/687, /399, /882 under https://github.com/zotero/zotero-ios
- paperless-mobile: /issues/322, /657 under https://github.com/astubenbord/paperless-mobile

Issues seen as [TITLE-ONLY] in search listings
- Karakeep #1331, #801, #1727, #708, #177; Omnivore #2652, #3277; wallabag Android #902, #9, #332, #1009, #859; Tailscale #12082, #2646, #1225, #17738, #16325; LocalSend #3574; Immich #18625, #747, #462, #15419; Zotero iOS #398, #401, #403; paperless-mobile #164, #70.

---

## 12. [MEMORY] Background on products I could not verify (hypotheses only)

Do not cite these as findings. They are what I believe, to be confirmed by a swarm member with working search.

- **Pushbullet**: the original "push a link or file to my device" service. Share-sheet integration listed target devices at the top of the Android share dialog (LocalSend #2351 confirms users remember this), plus notification mirroring and universal copy/paste. Widely reported as stagnating. Standout: devices-in-share-sheet and notification mirroring.
- **Join (joaomgcd)**: Pushbullet alternative with deep Tasker integration, clipboard push, SMS from PC; share-sheet target devices.
- **AirDrop / Android Quick Share**: nearby sharing; AirDrop's receipt is a visible "Sent"/"Delivered" state on the sender; Quick Share has been adding Apple-device interoperability. Not verified.
- **Chrome "Send to your devices" / Firefox "Send Tab to Device"**: browser-account-based tab push with a notification on the receiving device. Not verified.
- **Instapaper**: share extension plus email to Kindle ("Send to Kindle" per-article and scheduled digests) and a bookmarklet; long-loved for the Kindle flow. Not verified.
- **Readwise Reader**: add by mobile share sheet, extensions, email-in to a private address, newsletters/RSS in a Feed; scanned PDF import. Not verified.
- **Amazon Send to Kindle**: web upload, desktop and mobile apps, email address; delivery shows up in the Kindle library, with a per-device "send" choice. Not verified.
- **reMarkable "Read on reMarkable"**: Chrome extension and mobile share target that sends a web article as a clean document to the tablet; closest commercial analogue to what we are building. Not verified.
- **PocketBook "Send-to-PocketBook" / Kobo**: email-based send and (for Kobo) the Pocket integration that ended with Pocket's shutdown. Not verified.
- **Reeder / NetNewsWire / Apple Reading List**: Mac/iOS share sheets and Handoff. Not verified.
- **Android PROCESS_TEXT**: lets an app appear in the text-selection toolbar for "send selected text". Not verified this session.
- **iOS share-sheet suggestions via donated INSendMessageIntent**: how some apps get "people" targets in the iOS share sheet. Not verified.
