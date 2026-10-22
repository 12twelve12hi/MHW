# Daylight Share for Android

One APK, two jobs:

- **On a phone: "Send to Daylight".** It appears in Android's share menu. Share a link, a web page's address, a PDF,
  an EPUB, a Word document, Markdown, HTML, plain text or any other file, and it goes to your Daylight.
- **On the Daylight DC-1: the Daylight Inbox.** It shows the pairing code, receives what your phones and computers
  send, and hands each item to the Daylight Reader.

Items travel through an [ntfy](https://ntfy.sh) relay (free, no account), end-to-end encrypted with a key only your
devices have. The format is the Daylight Share protocol, revision 1.1
([`../share/PROTOCOL.md`](../share/PROTOCOL.md); what changed and why: [`../share/CHANGES-v1.1.md`](../share/CHANGES-v1.1.md)),
the same one the iPhone app, the Mac app and the browser extensions speak.

## Install

Download **`daylight-share.apk`** from the
[reader-experiment-latest release](https://github.com/12twelve12hi/MHW/releases/tag/reader-experiment-latest).

- **On the Daylight:** open the release page in the Daylight's browser, tap `daylight-share.apk`, open the download,
  and allow installs from the browser when Android asks (Settings › Install unknown apps). Open **Daylight Share**
  and choose **This is my Daylight**.
- **On an Android phone:** the same, then choose **Send from this phone**.

Every build is signed with the same key and has a higher version number, so a newer APK installs over the old one
and keeps your pairing and history.

## Pair

1. On the Daylight, the Inbox shows a QR code and a code like `E4AY-56TM-ADQP-5QSN-MY7B-CGPZ-UFRA`.
2. On the phone, open Daylight Share and tap **Scan the QR code** (or point the camera app at it: the
   `daylightshare://pair?...` link opens the app), or type the code.

A code scanned with the camera app or a tapped link is applied only after you confirm: the app shows the Daylight's
name, "Code starts E4AY. Check it matches the code on your Daylight.", the relay when it is not ntfy.sh, and, when the
phone already sends to a Daylight with another code, "This replaces …. Items not yet delivered to it will not be sent."
(button **Switch**). A link with the code you already use (a new relay or name) applies at once with "Pairing
updated". The same code keeps the history and sends what is pending through the new relay; another code deletes it.

Pair as many phones and computers as you like with the same code. **Reset pairing** on the Daylight makes a new
code; everything paired before has to pair again. Whoever has the code can send to your Daylight and read what is
sent to it, so the code is only shown on the Daylight.

## Send

- From any app: **Share › Send to Daylight**. A small card says "Sending to Daylight…" and then the item's status
  ("Sent · waiting for your Daylight"); the upload carries on in the background if you leave.
- In the app: paste a link and tap **Send link**, or tap **Send a file**.
- The history uses the words every Daylight Share app uses (CHANGES-v1.1 2.5): **Sending…**, **Sent · waiting for
  your Daylight**, **Delivered ✓** (the Daylight has it), **Waiting to send** (with why, and **Retry now** only when
  it failed for lack of a connection) and **Not delivered** (with why, and **Try again** when that can help).

Links go as links (the Reader downloads the article). **Files can be up to 9 MB** (before compression; text files are
compressed); a bigger file is refused before it is copied, with "Too big to send. Files can be up to 9 MB; this one
is 14.2 MB."

What the relay does, honestly: ntfy.sh takes files of up to 2 MB, so a file travels in parts of at most 1.9 MB, and
keeps them for 3 hours (links and small items for 12). Until the Daylight confirms an item, the phone sends it again:
links every 11 hours; files 3 hours 5 minutes after sending, again 3 hours 5 minutes later, then every 12 hours; for
up to 7 days. ntfy.sh also limits each network (a phone and a Daylight on the same Wi-Fi share it) to about 250
messages and 200 MB a day and 20 MB of files at a time; when that is used up, items wait ("A lot has been sent from
this network in the last few hours. It will send by itself in about 3 hours.") and stop after three tries.

## How items reach the Reader

The Inbox receives items when you open it, every 15 minutes in the background, and within seconds while the Inbox
is on screen or **Instant delivery** is on (a small permanent notification keeps a connection open; the Inbox then
offers **Allow running in the background**, because with the screen off Android otherwise pauses that connection). It stores
each item, acknowledges it (that is the sender's "Delivered ✓"), and hands it to the Daylight Reader:

| Item | Hand-off | What you see |
|---|---|---|
| Link | `SAVE_PAGE` with the URL and title (the Reader's read-later) | the Reader's small "Saved" card |
| Web page | `SAVE_PAGE` with the URL, the title and the page's HTML | the same; paywalled and logged-in pages work |
| Document | `ACTION_SEND` with the file, or `ACTION_SEND_MULTIPLE` (several at once, or **Add to the library as a batch**) | one document: the Reader imports it and opens it; several at once: the Reader's library ("N added"), which closes the document that was open |

Each item in the Inbox says **In your Reader ✓** only when the Reader confirmed it (`SAVE_PAGE` answered `saved` or
`duplicate`); documents and shared links get no answer from the Reader, so they say **Handed to the Reader**, with
**Add to Reader again** in case the Reader dropped it.

Today's Reader drops a share that arrives while its previous import is still pending (DEVICE-CHECKS.md, round 2). So
every hand-off to the Reader's import (documents, and links shared as text or as `daylightreader://save`) starts in a
fresh task (`FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK`) and never within 25 seconds of the previous one: it
waits with its card up, then hands over together whatever is waiting by then (logged as `documents: … waiting; next
hand-off in N s`, or `links: next hand-off in N s`). After such a hand-off the Reader is in front, so the hand-off ends
there; what it still had to take is offered again when the 25 seconds are over (`hand-off: N still waiting; offered
again in 25 s`). Pressing Home while the card waits ends that hand-off (the items get their notification). The 25
seconds are not measured yet: DEVICE-CHECKS.md has no import times, so a 9 MB PDF followed by a second one belongs on
the next device check.

If the Reader refuses `SAVE_PAGE` (read-later from the browser switched off in the Reader's settings), the Inbox
shares the link with the Reader instead. Builds that only have some entry points get what they support
(`SAVE_PAGE`, then a shared link, then `daylightreader://save`; for documents `ACTION_SEND_MULTIPLE` where it applies,
then `ACTION_SEND`, then `ACTION_VIEW`). Each item in the Inbox says which app got it and how. Without a Reader, items
stay in the Inbox with **Open with…**.

**Settings › Deliver to**: **Automatic** is the Daylight Reader (`com.daylightcomputer.reader`, then its suffixed
builds). The list also shows every other installed app that takes `SAVE_PAGE` or shared PDFs/EPUBs, with its package
name and what it takes, so a side-by-side copy such as `com.daylightcomputer.readerexperiment` is only ever chosen on
purpose. What the chosen app does not take goes to Automatic: a copy that answers `SAVE_PAGE` but takes no documents
gets the links and pages, and documents still go to the Daylight Reader (a non-Reader app counts as taking links only
through `SAVE_PAGE` or `daylightreader://save`). If the chosen app is uninstalled, Automatic applies.

### Why "Display over other apps"?

Android only lets an app open another app while you are looking at it. So:

- **Inbox on screen:** items go to the Reader as they arrive.
- **Inbox in the background, "Display over other apps" allowed** (the Inbox has a button for it): links and pages
  go to the Reader as they arrive; documents follow **Documents** (below).
- **Otherwise:** every item waits for a tap on its notification.

Every item that waits for a tap is announced at once, and once:

- **A notification** per item ("New PDF from iPhone: <title>" / "Tap to add to the Reader"), grouped under "3 new from
  iPhone" when there are several. Tapping one hands that item over; tapping the group hands over the ones it lists. They
  use the **New items** channel at high importance, so they can pop up over the full-screen Reader; if notifications
  are off or the channel was turned down, the Inbox says so and links to the setting.
- **A card over the Reader**, with "Display over other apps" (the Daylight's setup): "New PDF from iPhone", the title,
  **Add to Reader** and **Later**. A heads-up notification shows for a few seconds and an e-paper reader can miss it (or
  the system may not show it over a full-screen app); the card stays until answered. It takes no keyboard focus and
  touches outside it go to the Reader. While the card is up, the notifications are posted without popping up. **Later**
  takes it down for those items (they wait in the Inbox and in the notification shade).

Only an item never announced before alerts. A notification swiped away does not come back, one that is up is not posted
again, and an item whose hand-off is running is not announced meanwhile.

**Documents** (on the Inbox screen), for documents that arrive while another app is in front:

| Choice | What happens | Hand-off (`via`) |
|---|---|---|
| **Ask with a notification** (default) | the notification and the card above; a tap hands the document over and the Reader opens it | `send_file` (`send_multiple` for several) |
| **Add to the library as a batch** | handed over at once as a batch, even a single document | `send_multiple` |
| **Open as they arrive** | handed over at once; the Reader imports and opens it | `send_file` |

What the Reader does with a batch is its own decision, and today's Daylight Reader (public source: `ImportActivity`,
`ImportViewModel`, `ReaderLauncher.libraryIntent`) treats `ACTION_SEND` and `ACTION_SEND_MULTIPLE` alike and decides by
how many documents arrive together. One document is followed into the reader and opened. Two or more go to the library
("N added"), which it brings forward in its main task with `CLEAR_TOP`, and that closes the document being read. So
**Add to the library as a batch** is not quiet with today's Reader in either case; it is there for a Reader build that
adds a batch without opening anything, and asking is the default. The earlier switch
"Open documents as they arrive", when it was on, carries over as **Open as they arrive**.

### When nothing arrives

The Inbox says why, in one sentence: "Offline. New items will arrive when this Daylight is back online.", "Too much has
gone through this network for now. New items will arrive later.", "The relay isn’t working right now (error 502). It
will keep trying.", or "Your Daylight is out of space, so new items can’t be saved. Free some space." (an item that
could not be stored, or whose parts could not be written, is not acknowledged and not downloaded again; it comes back
with the sender's next re-send). A limit reported while connected shows as "Connected · Too much has gone through…".

**Settings › Relay** on the Inbox checks a relay other than ntfy.sh before saving it: it sends a 2 MB test file through
it and downloads it again, and keeps the old relay with a sentence when that fails (too small a file limit, files
turned off, a login needed, or files the Daylight can't download). A relay saved before this check existed is checked
once in the background, and only a warning shows if it fails.

## Accessibility and Comfort

Every build has the accessibility baseline (LAB-PLAN F27; it is not a Lab feature, and turning Lab off leaves it as it
is):

- **Settings › Comfort** (off by default): "Larger text and buttons, more contrast, no motion." Text is 1.3 times the
  system's size (the font scale times 1.3; where Android scales large text less than small text, as on Android 14,
  which the tests run as, a large size grows a little less: 18 sp becomes 21.6 dp rather than 23.4), buttons and rows
  are at least 56 dp tall, secondary text and outlines are black, and nothing ripples.
  The app's three questions (the pairing question a camera-scanned code opens, "Make this the Daylight Inbox?" / "Send
  from this device?", "Reset pairing?") follow it too: a dialog is a window of its own, so `DaylightDialog` provides
  the screen's text size again inside it, its buttons are 56 dp, and its text scrolls when it is taller than the
  screen. The share card and the Inbox's card over the Reader follow it (the card's text is larger, nothing is cut
  short, its buttons are stacked).
- Every control has a label; a switch or a choice is one control with its words (TalkBack reads "Instant delivery,
  off, switch"). States are words and glyphs ("Delivered ✓", "In your Reader ✓"), never colour alone.
- Status lines are announced when they change: a sent item's label ("Delivered ✓"), an Inbox item's ("In your Reader
  ✓"), a share's result, the relay check's sentence. They wrap instead of being cut short, at any text size.
- The Inbox (the DC-1's e-paper) does not animate: no ripples, no stretch when a list is pulled past its end, the
  app's own switches, choices and text fields are drawn still (a field's label sits above it instead of sliding into
  its border), the text cursor shows steadily instead of blinking, and dialogs appear and go at once (the app theme's
  `android:dialogTheme` has no window animation, in both roles). A field below the fold, or one the keyboard would
  cover, comes into view in one step: Compose 1.8 scrolls it there with an animation whose speed an app cannot change
  (`BringIntoViewSpec`'s animation spec is deprecated and no longer read), so on these screens the theme turns that
  scroll off and the app's sections and fields scroll their list the needed distance at once (`ui/Still.kt`). Comfort
  does all of this on a phone too; without Comfort the phone keeps Android's usual feedback (ripples, stretch, the
  blinking cursor, the animated scroll). What still moves is Android's, not the app's: the keyboard sliding in, a
  scroll that TalkBack asks for (its own scroll actions, which Compose animates), and a list flung with a finger.
- Pairing by typing the code always works: the phone has a "Pairing code" field, the Inbox shows the code in words
  under its QR code.
- The share card stays up, with **Close**, while Comfort, TalkBack or Switch Access is on, instead of closing after a
  second or two.
- Sizes are in the units of the status sentences (decimal, rounded up, `Text.formatMB`): a row says "PDF · 14.2 MB"
  above "Too big to send. Files can be up to 9 MB; this one is 14.2 MB."

### Still to check on a device

Robolectric cannot show these; they belong to the W0 device round on the DC-1 (Rooted 2), with an Android phone:

- **F27.3**: a recorded TalkBack run of pair → send → delivered on the phone, and of an item arriving on the Inbox,
  that announces each state change ("Sent · waiting for your Daylight", "Delivered ✓", "In your Reader ✓").
- The device re-check of cb57057 (waiting documents announced at once on the "New items" channel, the three-way
  **Documents** choice) and of the document hand-off workaround (a fresh task and 25 seconds between imports, above),
  with the import times DEVICE-CHECKS.md does not have yet.
- Stillness with the real keyboard: on the DC-1, Settings › Relay URL and the Daylight name come into view in one step
  when tapped and when the keyboard opens (no scroll animation), the cursor does not blink, and "Reset pairing?" and
  the role question appear without animating; the same on a phone with Comfort.
- A camera-scanned pairing link with Comfort on: the pairing question is as large as the rest of the app.

## Lab

Every build has **Lab** (LAB-PLAN, card K1 for Wave 0): one switch, first in Settings in both roles, **on by default**,
for the features we are trying out. Its footer: "New features we’re trying out. Turn Lab off for the plain app; nothing
you sent is lost." The switch belongs to the device: pairing, unpairing, re-pairing and updates leave it as it is, and
it is never in a pairing link. With Lab off, every screen is the plain app's (the tests compare each main screen with
the last non-Lab build's) and the Inbox publishes no Lab frame but the one that says Lab went off. Comfort is not under
Lab.

With Lab on, the Lab card has two more rows:

- **What’s in Lab ›**: one row per Lab feature this build has, each with its name, one sentence and a short state
  ("Ready", "Pair first", …), then the four features that need your own Daylight server, always listed, under "With your
  Daylight server (optional)": Files over 9 MB, Summaries with Claude, Email-in address, Feeds and daily digest, with
  the server's state under the heading ("Not set up"). On the phone its first line is what your Daylight said about Lab
  ("Your Daylight: Lab on · checked in 4 min ago", or "Needs Lab on your Daylight"). Nothing is greyed out: tapping a
  feature that is not set up shows one sentence under it that says what is missing and where to add it ("Needs your
  Daylight server. Add the Cloudflare secrets to turn this on (Lab › Daylight server shows how).", with **Copy Server
  code**), announced to TalkBack, until OK, another tap or leaving the screen. A server that does not answer within 5 s
  is "Couldn’t reach the Daylight server." Wave 0 has no Lab feature of its own on Android yet (the delivery timeline
  and the rest come with Wave 1), and no one-time note (it comes with the first Wave 1 build).
- **Daylight server ›** ("Optional · Not set up"): where the server is set up, so it has the long texts, every word
  from `LAB_TEXT.serverSection` or the server module (LAB-PLAN 2.6, "The rest of the server section's copy"): its
  state (with the exact secret names); while it is not set up, **Turn it on** with the five steps, numbered (LAB_TEXT's
  own list, never its joined form split on ",") and where every step is explained; **Your server** with its address
  and fingerprint (`hostLineText`); **Delivery** ("Through Lab on your Daylight, end-to-end encrypted", or "Through your
  pairing (v1 delivery)" and then the v1 notice); the **Server code** with **Copy** (the deploy's
  `DAYLIGHT_SERVER_CODE`; the `daylightserver://` form when the relay is not ntfy.sh); when the server last heard from
  the Lab Inbox; today's AI use; an optional **Server address** (placeholder "https://", **Save**, and its footer "Only
  needed when your Daylight server has an address of its own. Leave it empty and your apps find it."); and how to
  re-run the deploy. A server that moved asks "Your Daylight server moved to {host}. Use it?". Step 4 says to paste the
  setup link in **Set up with a link**: that row comes to Android in Wave S (Kotlin's `parseSetupLink` comes with S0),
  so until then paste it in the iPhone or Mac app, as the server's README says. On the Inbox the server lane comes in
  Wave S: its section shows the same steps and the Server code.

The phone finds its Daylight server only with Lab on, and keeps what it knows in `files/server.json` (outside the
outbox, so a server that still has your old pairing shows "pairing-mismatch"). Pairing with another Daylight first locks
a server that knew the old pairing (Lab on or off), and the home screen then shows the new Server code and the re-run
help until OK. Unpair and a new pairing forget a typed Server address.

**What the phone hears.** Every ack-topic frame that decrypts goes into a small ledger next to the outbox
(`files/outbox/<inboxTopic>/lab.json`), Lab on or off, so turning Lab on shows the right states at once. It holds what
each Inbox said in its last hello and the latest state of this phone's items.

**What the Inbox says (F17).** In the Inbox role, `inbox/LabReporter.kt` publishes Lab frames on the ack topic, last on
the network's relay budget (LAB-PROTOCOL 2.2.4): a **hello** (`lab`, `android/<versionName>`, its caps `st` and `tap`,
plus `reader-link` when the app links go to takes SAVE_PAGE; when it last polled; whether Instant delivery is
connected) and the **state** of each item from a paired device: `waiting` when it is first announced (once), `held` when
its card is answered Later or its notification swiped away, `reader` / `queued` / `handed` from the Reader's answer
(`saved` and `duplicate` are `reader`; documents, shared links and anything unknown are `handed`) and `inbox` when it
stays in the Inbox. It sends them after each poll or live batch once the acks are out, at the end of each hand-off and
2 s after a state, at most one frame every 30 s and 30 a day; nothing while the last acks failed or for an hour after
the relay answered 429 or 413; hellos when Lab goes on, when the caps or the version change, and every 11 hours
(at most 3 a day while idle); with the 11-hourly ack digest it repeats the states of the last 48 hours. Turning Lab
off sends one frame with `lab: 0`, repeated after each digest for 48 hours; then nothing. With no network it waits for
the `lab-flush` job. Reset pairing clears its store (`files/inbox/lab-<inboxTopic>.json`). Items that come from the
Daylight server (Wave S) get no states.

## Build

Requirements: JDK 17 or 21. The protocol module needs nothing else; the APK needs the Android SDK (platform 35).

```sh
cd reader-experiment/android
./gradlew :share-core:test          # protocol tests: vectors, mock relay (needs node), JS interop
./gradlew :app:assembleRelease      # needs ANDROID_HOME or sdk.dir in local.properties
./gradlew :app:testDebugUnitTest    # Robolectric: share parsing, Reader routing, hand-off and notification decisions, screens, accessibility, Lab-off parity, Lab
```

Without an Android SDK, Gradle builds only `:share-core`. `DLS_LIVE_RELAY=https://ntfy.sh ./gradlew :share-core:test
--tests '*LiveRelayTest*'` runs a round trip through a real relay.

CI (`.github/workflows/rx-android.yml`) has a job per lane (LAB-PLAN 6.1): `core` runs the protocol tests and tries a
live round trip through ntfy.sh; `app` builds both APKs, runs the app's tests and uploads the APKs as workflow
artifacts (`daylight-share-apk` and `daylight-share-debug-apk`, the latter containing `daylight-share-debug.apk`), with
the F27 screenshots (`daylight-share-f27-screenshots`) and any re-recorded Lab-off trees;
`publish` puts `daylight-share.apk` on the release once both passed. Android is not held by the Lab release gate.

### Screen tests (accessibility and Lab-off parity)

`MainScreen` (`app/src/test/.../ScreenKit.kt`) shows each main screen of the real app in a fixed state: the role
choice; the phone unpaired, paired with a row in every state, and its Settings; the Inbox new (with its code), with
items, and its Settings.

- `DialogsAndScrollingTest` (F27) covers what the screen tests do not reach. It opens each of the three questions
  with Comfort on and checks that every text in the dialog is laid out at 1.3 times the system's font scale, as on the
  screen behind it (`TextLayoutResult.layoutInput.density`), then at the largest text size on a 360 dp phone that nothing in
  it is cut short and its buttons are labelled and 56 dp (`dialog-*-comfort-200.png` among the screenshots), and that
  dialog windows have no animation in either role. In windows short enough that a field is below the fold (360 and
  480 dp tall, where the screen tests' tall window never scrolls), focusing Settings › Relay URL on the Inbox, or the
  phone's "Pairing code" with Comfort (a list), brings it into view in one step, and a focused field stays in view, in
  one step, when the screen shrinks as the keyboard opens (places measured unclipped there, so the shrinking itself
  is not a move); a self-test shows the same check catching Compose's animated scroll on the phone without Comfort.
- `AccessibilityTest` (F27) checks each screen against the Accessibility Test Framework's error rules (F27.2): every
  control has words for a screen reader, a touch target of at least 48 dp and its own place, and text fields are named
  by their labels; the text colours are at least 4.5:1. Compose's `enableAccessibilityChecks()` runs as well, but under
  Robolectric the framework sees only the Android views, not Compose's nodes (it passes an unlabelled 20 dp button), so
  the test applies the same rules to the semantics tree and shows they catch that button. With Comfort at 200 % text
  on a 360 dp phone (native graphics, so text is measured as on a device), no text exceeds its lines or its box and no
  control is under 56 dp (F27.4; measured against each text's own box, because the layout the semantics action hands
  out is redone at the column's full width). Each screen is saved as a PNG for review, not compared (F27.4, LAB-PLAN
  1.7): `<screen>-lab-off.png` (Comfort off, the usual text size) and `<screen>-comfort-200.png`, in
  `app/build/f27-screenshots/` (CI uploads them as `daylight-share-f27-screenshots`). Motion: the source may use no
  animation API and none of Material's components that move by themselves (a self-test shows what the check catches),
  Comfort and the Inbox provide no ripple, no overscroll effect, no cursor blink and no animated scroll into view, and
  tapping a field or "Show pairing code" changes the screen once and then nothing moves for 1.5 s, frame by frame. It
  also checks the Comfort switch and its words
  against `LAB_TEXT`, the announcements, the typed code, and the Inbox's relay-check and out-of-space sentences on
  screen.
- Comfort outside Compose: `HandoffDecisionsTest` checks the Inbox's card over the Reader with Comfort (text x1.3,
  nothing cut short, stacked 56 dp buttons, the heading announced) and without, and the setup link's `comfort=1|0`;
  `ShareCardTest` checks that the share card stays with a 56 dp **Close** under Comfort and closes by itself without.
- `LabOffParityTest` (LAB-PLAN 1.7, F00.2) compares what a screen reader gets from each screen (the merged Compose
  semantics tree: type, label and value of each node, in order) with `app/src/test/lab-off-baseline/<screen>.json`,
  recorded from the P0 close-out (protocol 1.1 and the F27 baseline). Relative times, the version and the Inbox's
  connection line are replaced by placeholders. A baseline changes only together with a non-Lab change of its screen:
  the test then writes the new tree to `app/build/lab-off-baseline/` (CI prints it and uploads it as
  `daylight-share-lab-off-trees`) to review and copy over. Lab tasks set Lab off in `ScreenKit.labOff()` (used by the
  parity test and the screenshots), and tag the Lab switch's card `Modifier.testTag("lab-switch")`: the comparison
  leaves the card out, as the one thing Lab off adds, and checks that with Lab off it holds only the switch, off
  ("Lab" with `LAB_TEXT.switchFooter`, and at most a "Lab" title): "What's in Lab ›", "Daylight server ›" or anything
  else in the card fails (LAB-PLAN 1.1).

### Lab tests (K1)

The Lab tests send every relay and Daylight server request to a relay in memory (`FakeRelay`), with no server deployed
unless a test says so.

| Test | Covers |
|---|---|
| `PrefsLabTest` | 1.2: a missing key means on and the first start writes it (fresh install and upgrade), a stored off stays off; the one-time note only with `LAB_NOTE_ENABLED`, once; the switch is never part of a pairing; Comfort stays as it is (F27.6); F00.4: an item queued offline goes once online with Lab turned off meanwhile, and the history, the pairing, the ledger and the server pin stay; the ledger hears hellos with Lab off |
| `LabFirstRunTest` | F00.1 (Lab on, no note in a W0 build, an upgrade keeps pairing and history) and F00.7: no screen reachable without tapping a Lab feature or opening the Daylight server section names a secret or says how to set something up, in both roles |
| `LabNoteTest` | F00.3 (short states, the server group, a tap shows exactly the sentence under the row, announced, enabled, with Copy Server code and OK; one note at a time, gone when leaving), F00.5 (the vector pairing's Server code shown and copied), F00.6 (OFFLINE offline, and at 5 s from a relay that never answers, "Checking…" first), F17.2 ("Needs Lab on your Daylight" and "Delivered ✓" until a hello, then "Your Daylight: Lab on"), the Inbox's list and section, turning Lab off in the card, the one-time note, the re-pairing card |
| `LabReporterTest` | F17 on the Inbox: 2.2.3's mapping through the real hand-off (every SAVE_PAGE answer, a refused SAVE_PAGE shared as a link, documents, no Reader, content gone, an unknown status as handed, nothing for "started"), `waiting` once and a held item that is announced again stays held, server-lane items record nothing; the hello and its caps, the log lines, giving way after a failed ack publish and a 429/413 from polls and the live path, F17.3's hello cadence with a fake clock (3 a day while idle, one more per toggle, 30 s apart), `lab: 0` and its repeats, a new store with Lab off publishes nothing, Reset pairing, and the setup link's `lab=` |
| `LabScreensAccessibilityTest` | F27 on Lab's screens: What's in Lab with a note open and the Daylight server section, phone and Inbox, as shipped and with Comfort at 200 % text (`lab-*.png` among the screenshots) |
| `LabOffParityTest` | F00.2: with Lab off each main screen equals its baseline, and the Settings of both roles have the Lab card holding only the switch, off |

### Layout

- `share-core/`: the protocol in plain Kotlin/JVM, no Android classes, no dependencies, so the Reader can embed it:
  `Pairing`, `Keys`, `FrameCodec`, `ItemHeader`, `ItemBuilder`/`PreparedItem`, `Reassembler`, `RelayClient`,
  `Outbox` (sender) and `Receiver` (Inbox), plus `RowText` (the shared status words), `PairingConfirmation` and
  `RelayProbe` (the Inbox's relay check).
- `app/`: Compose UI (`ui/`), the share target and outbox (`sender/`), the Inbox (`inbox/`: receiving, live
  connection, Instant delivery service, hand-off to the Reader), WorkManager jobs (`Work.kt`). Lab: `LabRepo.kt` (the
  gates, What's in Lab, the Daylight server; `LAB_NOTE_ENABLED`), `ui/LabScreen.kt` (the Lab card, What's in Lab, the
  note, the server section) and `inbox/LabReporter.kt` (the Inbox's Lab frames and the `lab-flush` job); `Prefs.lab`
  with `App.labOn` is the one reading of the switch.

### Debug builds: setup without the UI

For automated tests, debug builds accept

```
adb shell am start -a android.intent.action.VIEW \
  -n com.daylight.share/.ui.MainActivity -d "daylightshare://setup?role=inbox&c=<28-character code>&r=http%3A%2F%2F10.0.2.2%3A8787&n=CI&instant=1&auto=1"
```

which makes the device the Inbox with that pairing secret and relay (`role=sender` pairs a sender instead;
`instant=1` turns on Instant delivery; `docs=ask|quiet|open` sets **Documents**, and `auto=1` / `auto=0` mean
`docs=open` / `docs=ask`; `to=<package>` sets **Deliver to**, `to=` puts it back to Automatic; `comfort=1` / `comfort=0`
sets **Comfort**; `lab=1` / `lab=0` sets the **Lab** switch before the role, so the Inbox's first Lab frame follows it). Debug builds also allow
plain HTTP to `10.0.2.2`, `127.0.0.1` and `localhost`. The setup link also skips the
notification-permission prompt. Everything is logged under the tag `DaylightShare` (`adb logcat -s DaylightShare`):

```
received <id> kind=<url|page|file> from=<sender> size=<bytes> stored
received <id> kind=<url|page|file> -> handed to <package> via <save_page|send_link|view_link|send_file|send_file_octet|view_file|send_multiple> status=<saved|duplicate|queued|refused|sent|ok|no_answer>[ docs=<ask|quiet|open>] by=<front|auto|tap|card>
received <id> kind=<...> -> waiting for a tap (<card + notification|notification|card|notifications off>)[ docs=<ask|quiet|open>]
received <id> -> notification dismissed: waits in the Inbox
received <id> kind=<...> -> kept in inbox (no reader installed) status=no_reader
```

With Lab on, the Inbox also logs its Lab frames (LAB-PLAN F17):

```
lab: state <id> <waiting|held|inbox|handed|failed|queued|reader>
lab: hello caps=<st,tap[,reader-link]>
lab: states n=<k> published
lab: hello lab=0
```

`docs=` (documents only) is the **Documents** choice at the time; `by=` says whether the Inbox was in front, handed
over in the background on its own, a notification was tapped, or the card's **Add to Reader**. "waiting for a tap" is
logged once per item, when it is first announced, and says where.

A refused `SAVE_PAGE` logs `status=refused` and then the `send_link` retry. Items reach the Reader at once while the
Inbox is in front; for background hand-offs in a test, `adb shell appops set com.daylight.share SYSTEM_ALERT_WINDOW
allow` and use `instant=1&auto=1` (or `docs=quiet`). With `docs=ask` and that permission, the card comes up over the
app in front (a window titled "Daylight Share" in `adb shell dumpsys window windows`). Without the permission, open the shade with
`adb shell cmd statusbar expand-notifications` and tap the item's notification; on an emulator after `adb root`, the
same tap is `adb shell am start -n com.daylight.share/.inbox.HandoffActivity --es mode one --es item <id>` (the activity
is not exported, so only root may start it). Release builds ignore setup links and only speak HTTPS.
