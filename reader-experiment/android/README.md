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
  is "Couldn’t reach the Daylight server." On the phone the list has Wave 1's features (below), the features that
  change how sharing behaves each with a **Use** switch, and F04's and F09's settings on their rows; on the Inbox it
  has Arrival notices and Setup check (card K5, below).
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
plus `reader-link` when the app links go to takes SAVE_PAGE, and `cap-kind` from Wave 1, as its rows show each item's
kind; when it last polled; whether Instant delivery is connected) and the **state** of each item from a paired device:
`waiting` when it is first announced (once), `held` when it is kept for later (Keep for later on its notice or card,
Later with Lab off, or its notification swiped away), `reader` / `queued` / `handed` from the Reader's answer
(`saved` and `duplicate` are `reader`; documents, shared links and anything unknown are `handed`) and `inbox` when it
stays in the Inbox. It sends them after each poll or live batch once the acks are out, at the end of each hand-off and
2 s after a state, at most one frame every 30 s and 30 a day; nothing while the last acks failed or for an hour after
the relay answered 429 or 413; hellos when Lab goes on, when the caps or the version change, and every 11 hours
(at most 3 a day while idle); with the 11-hourly ack digest it repeats the states of the last 48 hours. Turning Lab
off sends one frame with `lab: 0`, repeated after each digest for 48 hours; then nothing. With no network it waits for
the `lab-flush` job. Reset pairing clears its store (`files/inbox/lab-<inboxTopic>.json`). Items that come from the
Daylight server (Wave S) get no states.

### Wave 1 on the phone (card K4)

With Lab on, the phone has these (LAB-PLAN 3.3; every word is `LAB_TEXT`'s). The one-time note ("Lab is on. New
features to try are in Settings › Lab, where you can turn it off.") shows once on the home screen from this build (the
Inbox's waits for its own Wave 1 build).

- **Delivery timeline (F01).** History rows read as `LabRowText` says ("On your Daylight ✓", "Waiting for a tap on your
  Daylight", "Handed to the Reader", "In your Reader ✓", …), from what the Daylight's Lab frames told the ledger. The
  sentence and the step line ("Sent ✓ · On your Daylight ✓ · In the Reader …") show on the newest row and on rows that are
  not final; elsewhere a tap on the title shows them. TalkBack reads "{label}. {sentence}" and never the step line. Above
  the history: "Your Daylight checked in 4 min ago." While a row delivered in the last 10 minutes has no settled state
  and the app is in front, the ack topic is read every 30 s. No row says Delivered or In your Reader without an ack.
- **Share in place (F04).** Share › Send to Daylight shows "Sending to {name}" with **Options** for 1.5 s, then the item
  goes into the outbox, an expedited job `send-<id>` (`sender/SendWorker.kt`) publishes it, and the card closes. Options:
  an editable title and, for text with a link, **Send link** / **Send as excerpt**. With Comfort, TalkBack, Switch Access
  or "Always show Options before sending", the card opens with the choices and **Send**, and nothing goes until Send. A
  share-in-place item that ends failed or expired posts "Couldn’t send ‘{title}’ to {name}" / "Open to try again." in the
  channel **Send results** ("Tell me when a send fails", on); "Tell me when it’s in my Reader" (off) posts a quiet "In your
  Reader ✓: {title}", only once the row is delivered (an ack listed it) and a Lab Inbox is fresh (2.2.6: a state counts
  only then). Tapping a notice opens the app at its row (the home screen, scrolled to it, its details shown).
  Each item is remembered for its notice before its job is asked for, so a job that fails at once still posts it.
  Without notification permission nothing is posted and F04's row says "Needs notifications"; the app asks once, after
  a share in place (Android 13 and later). A shared file is copied into `files/outbox-incoming` while the card is up; a
  card that goes before it sends (a tap outside, Back, Close in Options) deletes that copy, a copy cut short deletes
  what it wrote, and copies a dead process left behind go at the next start. Once it is sending, Back and a tap
  outside wait: the card stays until the items are in the outbox (a big file from a slow provider may still be
  copying), then closes by itself, and a card that goes anyway (its task swiped away) still stores what it was
  copying. The card scrolls when it is taller than the screen (the largest text on a small phone), and the tap outside
  it is a gesture, not a control a screen reader would land on. When only some items of a share could be stored (one
  file too big), the card says it in v1.1's words, "{n} items. {line}" (the line alone for one), then the error
  (LAB-PLAN 1.6: no new string). F04's Use switch off: the v1.1 card.
- **The link-only hint (F03).** The first share that brings only a link shows once, on whichever card the share used
  (share in place's, or the v1.1 card with F04's Use switch off), and the card stays until OK: "Only the link came
  through. For pages behind a login, send from your computer’s browser with the Send to Daylight extension." After that
  it is listed in Setup check. F03 has no row in What's in Lab on the phone: LAB-PLAN 1.4 lists "Pages as you see them"
  for the iPhone, Chrome and Safari only, and its sentence and Use footer speak of pages sent as you see them, which
  the phone never does (it sends links). Should the hint get a row and a Use switch here, LAB_TEXT needs an Android
  sentence and footer for it first (the share lane's).
- **Works offline (F07).** A share while offline is stored as waiting for a connection (`defer`) and listed under "Waiting
  to send ({n})" with **Cancel**; the job `flush` (`sender/FlushWorker.kt`, `CONNECTED`) sends it when the network is
  back (`flushNetwork`: oldest first, at most 30 frames and 18 MB a pass, passes 3 minutes apart). With Lab off, v1.1's
  back-off sends it.
- **Your Daylight in the share sheet (F08).** `sender/Shortcuts.kt` pushes one long-lived Direct Share shortcut, id
  `daylight`, on every send (short label: the name cut to 10 characters with "…"); `res/xml/shortcuts.xml` makes it a
  share target of the share activity. Unpair, Lab off, F08's Use switch off and the Inbox role remove it.
- **Automation (F09).** `sender/AutomationActivity.kt`: the action `com.daylight.share.action.SEND_URL` (`EXTRA_TEXT`,
  `EXTRA_TITLE`, boolean `com.daylight.share.extra.QUICK`; it answers `RESULT_OK` with `id` and `status`) and
  `daylightshare://send?url=…&title=…[&text=…][&quick=1]` (through MainActivity; never a file path). A sheet asks "Send to
  {name}?" with the title and host, unless "Allow quick sends from other apps" (off; under Shortcuts and automation in
  What's in Lab) is on, at most 10 a minute. Asked for a quick send while that is off, the sheet says so with **Open
  setting**, which opens What's in Lab at that setting, brought into view with its footer and focused, never turned on
  by itself. Lab off: "Turn on Lab in Daylight Share to use this."
- **Send a selection (F11, 6.5 Q1 = b).** Text becomes an excerpt only when the share card's Options say **Send as
  excerpt** (an HTML document with the source link and a `#:~:text=` fragment, `x-cap: "excerpt"`); the first one shows
  once "Excerpts wait for a tap on your Daylight for now." Every "headline + link" share stays a link with the headline
  as its title; text without a link goes as a Markdown note. Options are share in place's, so with F04's Use switch off
  F11's row in What's in Lab says "Use Share in place" (LAB_TEXT's `use.a11y`, the switch's own name) and a tap opens
  that switch with its footer; it never turns it on by itself.
- **Clean links (F16).** Every link and text share goes through `Normalise.normaliseShare`: the first link, unwrapped
  (AMP, Google, Facebook, LinkedIn, Substack) and without tracking parameters, the URL as shared in `x-orig`. F16's Use
  switch off: links go exactly as shared.
- **Setup check (F26).** From its row in What's in Lab: Pairing, Notifications and Battery optimisation, each unmet one
  with the button that opens the right screen; the hints shown once; **Send a test article** (`x-cap: "test"`, followed
  to "✓ Delivered" and "✓ In your Reader"); the activity log (type, id8, kind, status and the relay's HTTP status,
  nothing else: an outbox row's event reads "failed/full 413" or "failed/network 429", from `OutboxRow.http`, Oct 22);
  **Copy diagnostics**, redacted (`SetupCheck.diagnosticsReport`).
- **Send copied link (F33).** On resume only the clipboard's description is read (a `text/uri-list` clip, or on Android
  12+ a text Android's classifier is at least 0.5 sure is a URL), so no "pasted from" notice shows; **Send copied link**
  reads it on tap and asks "Send {host} to {name}?" with **Send** and **Cancel**. Android 10 and later answer only a
  window that has focus, and focus comes after onResume, so the description is read again each time the window gains
  focus; a resume before focus leaves the chip as it is until then.
- **Files over 9 MB (the F02 entry point).** Under the too-big sentence, on the share card and on the home screen: **Send
  files over 9 MB ›**, which shows the needs-server sentence (with Copy Server code) until a Daylight server exists, and
  "In a later update" once one is ready (F02 comes to Android in Wave S).

The **Use** switches (6.5 Q5) are on the rows of F04, F08, F16 and F33, on by default, each with its footer ("When
it’s off, …"); TalkBack reads "Use {feature}". The one Lab switch still turns all of Lab off. A tapped row's
needs-setup note shows directly under the row, before its switches (1.5). What's in Lab reads the ack topic and asks
the server as it opens, both within one shared 5 s (`LabRepo.overviewFresh`).

**Still to check on a device** (W1 device round on Rooted 2, with an Android 13 or 14 phone and the real ntfy.sh relay):

- **F04.4:** from Chrome, the card closes within 1 s of the countdown, and the upload completes with the app swiped away.
- **F04.6:** the relay answering 413 after the card closed posts the "Send results" notice (here the mock relay drives
  it); the permission question after the first share in place.
- **F04.5 / F27.3 (TalkBack, Switch Access):** with TalkBack on, the card opens with Options and Send and reads "Sending
  to {name}"; the same with Switch Access on (Robolectric stubs both flags; this checks the real services' ids).
- **F04 (notices):** tapping a "Send results" notice opens the app at its row, also from a cold start.
- **F07.1:** in flight mode a share reads "Waiting for connection", and goes within a minute once the network is back,
  with the app open and with it closed (WorkManager's `CONNECTED` job).
- **F08.1, F08.2 (Android 13 and 14):** after one send the Daylight's name is in Chrome's Direct Share row, a tap there
  sends with no other screen, Unpair removes it, and `adb shell cmd shortcut get-shortcuts --user 0 com.daylight.share`
  keeps the id `daylight` across an update.
- **F09:** an automation app (Tasker, or `adb shell am start -a com.daylight.share.action.SEND_URL --es
  android.intent.extra.TEXT https://example.com`) gets the sheet; a `daylightshare://send` link from a web page asks.
- **F33.1 (Android 10 and later):** copy a link in Chrome, switch back to Daylight Share: the chip appears (the clipboard
  is read again when the window gains focus); the same from a cold start, and after the notification shade is pulled
  down and closed.
- **F33.2 (Android 13):** no "pasted from" toast before the chip is tapped.
- **1.5 "Open setting" (F09):** from the automation sheet's note, What's in Lab opens at "Allow quick sends from other
  apps" with its footer, and TalkBack starts there.
- **F11.5:** an NYT "headline + link" shared from Chrome arrives as a link the Reader downloads; Chrome's "Share" of a
  selection (`#:~:text=`) arrives as a link unless sent as an excerpt.
- **F01.1, F01.2, F26.1:** a link reaching "In your Reader ✓", a PDF reading "Waiting for a tap on your Daylight" then
  "Handed to the Reader", and the test article ticking Delivered and In your Reader, in each condition of F01.1.
- **F04 (Back while a file copies):** share a 9 MB PDF from Google Drive and press Back (the button and the gesture)
  right after the countdown: the card stays until the item is in the outbox, then closes, and the row is on the home
  screen; the same after swiping the sharing app away from Recents while the card says "Sending to {name}".
- **F27.4 (the cards on a small phone):** with Comfort and the largest text, the share card with Options and the
  automation sheet scroll, Send and Close (Cancel) can be reached, and the title field stays above the keyboard on
  Android 15 (edge to edge); with TalkBack, swiping through the card never lands on the area outside it.

### Wave 1 on the Inbox (card K5)

With Lab on, the DC-1 Inbox has these (LAB-PLAN 3.3; every word is `LAB_TEXT`'s). The one-time note shows once on the
Inbox from this build. With Lab off every screen, notice and hand-off is v1.1's.

- **What each row is (F03, F11).** The line under a row's title says what the item is, from its header's extras (`x-cap`,
  LAB-PROTOCOL 2.3, stored in `InboxItem.extras` with Lab on or off): "Page as you saw it", "Clean article", "Excerpt",
  "Test article", "Link (the Reader downloads it)" or "Document · 1.3 MB", then " · from iPhone". An `x-cap` this build
  does not know reads as none. The hello carries `cap-kind`.
- **What the sender sees (F01).** A tap on a row's title opens its details: when it arrived and its size, "Cleaned from
  {host}" when its sender cleaned the link (`x-orig`), and "Sender sees: {label}", the label the sender's row shows
  ("On your Daylight ✓", "Waiting for a tap on your Daylight", "Kept for later on your Daylight", "Handed to the
  Reader", "In your Reader ✓", …), from the last state the Inbox recorded for it (`InboxItem.labState`). Items from the
  Daylight server and the Reader hand-off test have no sender, so no such line.
- **Add to Reader and Keep for later (F15).** A waiting item's notice has two actions, **Add to Reader** (as its tap)
  and **Keep for later**; the card over the Reader says **Keep for later** where v1.1 says Later. Keep for later, and
  swiping the notice away, keep the item for later: it waits in the Inbox, its row says "Kept for later", nothing hands
  it over by itself (opening the Inbox does not; v1.1 hands over everything waiting then), and its senders see "Kept for
  later on your Daylight" (`held`). **Add to Reader** (the notice, the card, or the row) hands it over: `reader` for a
  link the Reader saved, `handed` for a document. The card's Keep for later leaves the item's notice in the shade, as
  v1.1's Later does; the notice's own Keep for later takes it away. Waiting excerpts from one sender share one notice:
  "3 excerpts from iPhone"; one waiting excerpt reads "New excerpt from iPhone" (`arrivals.excerptOne`).
- **Saved to the Reader (F15).** An item handed over without a tap (links and pages, and documents with "Open as they
  arrive" or "Add to the library as a batch") gets one notice, "Saved to the Reader: {title}" / "From {from}", with only
  **Dismiss** (no state), grouped under "{n} saved from {from}" ("from your devices" for several senders). An item that
  had a notice before (it waited for a tap) never gets another. **Arrival notices** on the Inbox screen, under "Getting
  items to the Reader": Off, **Quiet** (the default; the channel "Arrivals", low importance) or Alert ("Arrivals
  (alert)", high). **Quiet hours** (off; its footer: "From 22:00 to 07:00, arrivals don’t make a sound."): from 22:00 to
  07:00 arrival notices, and waiting items' notices, go silently. Arrival notices' row in What's in Lab, when ready, opens
  the Inbox screen at these settings, in view with that footer (1.4, 1.5).
- **Inbox health (F15).** At the top of the Inbox: "Last checked 4 min ago · Instant delivery on" ("just now" while the
  live connection is open) and one warning at a time: "Instant delivery stopped. Turn it back on to get items within
  seconds." with **Turn on** (Instant delivery is on, its service is not running and wrote no heartbeat for 2 minutes;
  the service writes one every minute); "Needs notifications" with **Open Settings**; or the last poll's sentence. The
  15-minute job posts "Instant delivery stopped …" with **Turn on** in the channel "Inbox health" at most once every 12
  hours. Arrival notices' row in What's in Lab says "Needs notifications" while they are off.
- **Setup check (F26).** From its row in What's in Lab: Notifications, “New items” notices (high importance),
  Display over other apps, Battery optimisation, Instant delivery (on and running), A Reader that saves pages, and The
  Reader’s read-later (no SAVE_PAGE refused in the last week since the last one it took), each "✓ {check}" or
  "! {check}". An unmet one has **Open Settings** (Android's notification, channel, overlay or battery settings) or
  **Open setting** (Instant delivery: the Inbox screen, scrolled to its switch with its footer; the Reader: Settings,
  scrolled to Deliver to with its words; 1.5, never changed by itself). The Reader's read-later is the Reader's own
  setting: its line says where ("The Reader turned down the last pages it was handed. Open the Reader’s settings, allow
  pages from other apps, then tap Test the Reader hand-off.") with **Test the Reader hand-off** as its button.
  **Test the Reader hand-off** puts the bundled test
  article (`SetupCheck.testArticle`, `x-cap: "test"`, `https://daylight.invalid/test/<id>`) in the Inbox and hands it
  over the usual way (the Inbox is in front), then shows "✓ In your Reader" once the Reader saved it, and the item's own
  words until then. **Activity log** (type, id8, kind, status, nothing else: received, waiting, held, handoff, notice,
  test, health) and **Copy diagnostics** (`SetupCheck.diagnosticsReport`, platform "inbox", redacted).

**Still to check on a device** (W1 device round on Rooted 2, with a phone and the real ntfy.sh relay):

- **F03.4:** every row's kind line shows ("Page as you saw it" from the Mac or Safari, "Excerpt" from the Chrome
  extension's Send selection, "Test article" from a phone's Setup check, "Link (the Reader downloads it)"), and TalkBack
  reads it with the title.
- **F01:** for a link and a PDF sent from the iPhone, the Inbox's "Sender sees: …" matches what the iPhone's row says,
  at each step (waiting, kept for later, handed, in the Reader).
- **F15.1:** an arrival over the Reader posts one notice (grouped when several), and TalkBack reads its title and
  source; on the e-paper shade, **Add to Reader** gives `reader` for a link and `handed` for a PDF, **Keep for later**
  and a swipe give `held`, and **Dismiss** on "Saved to the Reader" gives nothing (the emulator steps of E1 read the
  states from the ack topic).
- **F15.2:** stop the service from Android's Task Manager (Android 13+, the notification shade's "Active apps"): the
  warning card shows on the next open (unless opening the app restarted it, which then says nothing), and the "Instant
  delivery stopped" notice comes within 15 minutes; **Turn on** from the notice starts it again.
- **F15.3:** the Inbox, What's in Lab and Setup check render with animations off (Developer options) exactly as with
  them on, and no state is shown by colour alone.
- **F15.4:** Keep for later on a link's card makes the iPhone show "Kept for later on your Daylight", and Add to Reader
  then "In your Reader ✓".
- **Quiet hours** at 22:00–07:00 on the DC-1's clock: nothing pops up or sounds, and items still arrive.
- **F26.1 / F26.3:** Test the Reader hand-off with the Inbox in front reaches the Reader and ticks "✓ In your
  Reader"; each unmet check's button opens the right screen on Android 13 and 14 (the channel's settings, "Display over
  other apps" for Daylight Share, the battery list).
- **F11.4:** an excerpt of a page already in the Reader arrives as a new document, not "already in your library".
- **1.5 "Open setting" on the DC-1 in landscape:** Setup check's Open setting for Instant delivery and for the Reader
  open the Inbox screen and Settings with that setting in view with its footer, and TalkBack starts there; Arrival
  notices' row does the same for its settings.
- **The read-later check (F26.3):** the Reader's own name for the setting in "Open the Reader’s settings, allow pages
  from other apps" (LAB-PLAN 1.6 says the device round checks it), and its Test the Reader hand-off ticks it again.

### The handover to the Lab Reader (card K6)

On the lab tablet (Rooted 2) the Lab Reader, the side-by-side Reader copy `com.daylightcomputer.readerexperiment`
(LAB-PLAN 5.1), can take over receiving for the Inbox's pairing with its built-in inbox (R1), so items go into its
library quietly. One app receives per pairing: two would both take every item. `inbox/handover/` (LAB-PLAN 5.3.4):

1. **Let Daylight Reader (lab) receive**, in the Lab card on the Inbox (Lab on, and only where the Lab Reader is
   installed: on every other DC-1 the card has no such row), arms a 2-minute grant and shows "Open Daylight Reader (lab)
   › Settings › Labs › Send to Daylight and choose Take over."
2. `HandoverProvider` (authority `com.daylight.share.handover`, exported) answers `call("pairing")` with `{code, relay,
   name, since}` (`since`: where the Inbox's receive cursor is, for the Lab Reader to start from; it may ignore it)
   only while armed, with Lab on, in the Inbox role, and only when Android names the calling package
   `com.daylightcomputer.readerexperiment` (`getCallingPackage()`, and that uid owns it). The Lab Reader, while not
   armed, gets `{error: "not-armed"}`; any other app, nothing. The grant is used up.
3. Then `Prefs.receivingElsewhere` is the Lab Reader's package: the Inbox stops polling (the 15-minute job, the app's
   start, Check now: `Handover.beforePoll` in `InboxRepo.pollOnce`), the live connection and Instant delivery (its
   service stops itself if started), sends one `lab: 0` hello (`LabReporter` reads its Lab as off while another app
   receives; the Lab Reader says its own hellos), and Inbox health does not call Instant delivery stopped. The Lab card
   and the top of the Inbox say "Daylight Reader (lab) receives for this Daylight now."
4. **Resume rule.** Before each would-be poll the Inbox asks the Lab Reader's `ShareInboxProvider`
   (`com.daylightcomputer.readerexperiment.shareinbox`, `call("receiving")`, visible through the manifest's
   `<queries>`). It receives here again by itself only when the answer is `{receiving: false}` or PackageManager says
   the package is gone. A provider it cannot reach while the package is installed (none, not visible, throwing, an
   answer without a Boolean `receiving`) never makes it resume: it keeps waiting and shows "Can’t reach Daylight Reader
   (lab) right now." **Receive here again** shows only once the Reader said false, and asks once more first.

On receiving here again, the receive cursor moves up to the last time the Lab Reader may have been receiving (the
handover, then each answer but "not receiving"), turned into relay time with the relay's own clock as the Inbox last
heard it (a publish's `time` or an answer's Date header, `RelayClient.relayClock`, kept in `Prefs.inboxRelayOffsetMs`:
a DC-1 whose clock runs fast must not skip what reached the relay after the Reader stopped), less the protocol's
30-minute overlap, so the Inbox does not take again
what the Lab Reader took (a few items from just before it stopped may arrive in both); anything nobody took is still on
the relay or comes with its sender's re-send. Instant delivery starts again when it is on (from the background Android
may refuse; then the health card offers Turn on), and a hello goes. A new pairing on the Inbox (Reset pairing) ends a
handover at once. **A handover outlives Lab off** (LAB-PLAN 1.3, decided Oct 22: ending it silently would make both
apps receive), so the Inbox screen keeps its handover line with Lab off, with **Receive here again** once the Reader
says it stopped, and the resume rule still runs. No poll runs during a handover, so no ack digest either: the skipped
polls repeat the `lab: 0` frame every 11 hours for 48 hours instead (`LabReporter.whileElsewhere`, 2.2.4). The server
lane (S0, Wave S) is not part of it: it stays with Daylight Share until the Lab Reader's hello carries the cap `server`.

The five sentences are LAB_TEXT's `handover.*` (`LabText`, LAB-PLAN 5.3.4 word for word; `HandoverScreenTest` pins
them). Log lines (`adb logcat -s DaylightShare`):
`lab: handover: armed for 120 s`, `… <package> receives for this Daylight now; the Inbox stops polling`, `… <package>
receives; poll skipped`, `… can't reach <package>; poll skipped …`, `… the Inbox receives here again (<why>)`,
`… receiving from relay time <s> on …`, `… refused the pairing to <package>`.

**For R1 (the Lab Reader side).** Its `ShareInboxProvider.call("receiving")` should answer `true` only while it
receives with the pairing it took over (after its own Reset pairing, or with its switch off, `false`), and answer
`com.daylight.share` only. Its manifest needs `<queries><package android:name="com.daylight.share"/></queries>`.

**Still to check on a device** (W1 device round on Rooted 2, once R1 exists):

- **R1.4:** after Take over, Daylight Share shows "Daylight Reader (lab) receives for this Daylight now." in Settings ›
  Lab and on the Inbox, and polls nothing for 20 minutes (`adb logcat -s DaylightShare` shows only "poll skipped" lines,
  no "inbox: poll" and no live connection, and Instant delivery's notification is gone); turning off the Reader's switch
  makes Daylight Share receive again at its next poll (within 15 minutes, or at once on opening it).
- The real `getCallingPackage()` path: the Lab Reader's Take over gets the pairing while armed and `not-armed` after 2
  minutes; `adb shell content call --uri content://com.daylight.share.handover --method pairing` (the shell's package)
  gets nothing.
- Package visibility on Android 14: with the Lab Reader installed, Daylight Share sees it (the Lab card's row shows) and
  reaches `ShareInboxProvider`; `pm disable` on the Lab Reader shows "Can’t reach Daylight Reader (lab) right now." and
  no resume; `pm uninstall` makes it resume at the next poll.
- TalkBack reads the row, the step after it and the "Can’t reach" sentence (announced), at Comfort's largest text too.

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

- `LabCardsAccessibilityTest` (F27, K4) runs the screen tests' accessibility checks (the rules as shipped; Comfort at
  the largest text on a 360 dp phone) on the share-in-place card with Options open and on the automation sheet with
  its needs-quick-sends note, which are other activities' windows, with a 58-character Daylight name and a long title;
  and on a 360 x 640 dp phone at the largest text, it checks that every control on them can be scrolled to.
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

### Lab tests (K4, the phone's Wave 1)

| Test | Covers |
|---|---|
| `SenderTimelineTest` | F01.3 (the check-in header), F01.4 (no Delivered or In your Reader without an ack; failed rows keep v1.1's sentence and button), F01.5 (a v1.1 Inbox's rows), F01.6 (three rows: the step line only on the newest and the unfinished, "{label}. {sentence}" for TalkBack, the step line hidden from it, details on tap), F07.1/F07.2 ("Waiting for connection" in "Waiting to send (n)", Cancel), the one-time note |
| `ShareInPlaceTest` | F04.4 and F04.5 on Robolectric's clock (nothing in the 1.5 s countdown, then the outbox and `send-<id>`, the card gone; Options stops it; Comfort, TalkBack and Switch Access (flags stubbed) and "Always show Options before sending" wait for Send; a card that goes, or comes back from saved state, sends nothing), F04.6's order (each item remembered for its notice before its job is asked for), no copy left behind (Close, Back, destroyed, a stopped copy, the sweep at start), F03.3 (the hint once, on share in place's card and on the v1.1 card), F11 (a headline + link stays a link; "Send as excerpt"), F02e.1 (a 14.2 MB file: "Send files over 9 MB ›" with its needs-server sentence, and with a ready server (stubbed) `later`), F04's Use switch off; a batch where only some items were stored says v1.1's "{n} items. {line}" and the error |
| `PhoneJobsTest` | F04.6 (413 after the card closed: the "Send results" notice, once; off, or without permission: none; a network failure waits instead; "In your Reader ✓" only when asked, and only for a delivered row while a Lab Inbox is fresh: not before the ack, not after the Inbox's `lab: 0`; nothing with Lab off; the job through `TestListenableWorkerBuilder`), F07 (`defer`, the flush when the network is back, passes 3 minutes apart, nothing with Lab off), F26's log with the relay's answer ("failed/network 429", "failed/full 413") |
| `ShortcutsTest` | F08: pushed on a send with the name (short label cut at 10), updated with the name, removed on Unpair, Lab off, F08's Use switch off and the Inbox role; the share target in `shortcuts.xml` |
| `AutomationActivityTest` | F09.3: the sheet before anything goes, `RESULT_OK` with id and status, Cancel, quick sends only with the setting (and the note that says how; its **Open setting** opens What's in Lab at that setting, in view with its footer, unchanged), 10 a minute, Lab off, unpaired, not a link; `daylightshare://send` routed from MainActivity, and a web page cannot send silently |
| `CopiedLinkTest` | F33.1-F33.3: the chip from the clipboard's description only, read again when the window gains focus (a resume before focus keeps it), the host before Send, Cancel, no chip for text that is not a URL, the classifier's confidence (API 31+), the Use switch and Lab off |
| `SendResultsNoticeTest` | F04: tapping a "Send results" notice opens the app at its row, below a dozen newer ones; Lab off ignores it |
| `WhatsInLabPhoneTest` | 1.4 and 6.5 Q5 on the phone: its features (no F03 row), the Use switches (on by default, "Use {feature}", one feature off at a time), F04's and F09's settings; F11's row with F04's Use switch off ("Use Share in place", a tap opens that switch); F04's needs-notifications note with Open Settings, directly under the row and before its switches (1.5); F26 (the checks, the test article followed to ✓ Delivered and ✓ In your Reader, the activity log, Copy diagnostics with no URL, title, code or topic; a hint shown once stays listed) |
| `SharePathVectorsTest` | F16.1 and F11.5 on the phone's own share path: every share-sheet case of `normalise.json` through `parseLab` and the intake; Lab off is v1.1's path |
| `LabScreensAccessibilityTest` | also the phone's home with the timeline and the queue, and Setup check (as shipped and with Comfort at 200 %) |

### Lab tests (K5, the Inbox's Wave 1)

| Test | Covers |
|---|---|
| `InboxExtrasTest` | 2.3: the header's extras reach `InboxItem` through a real poll and stay with Lab off, v1.1's `items.json` unchanged for items without them; F03/F11 every kind line (an unknown `x-cap` as none); F01 "Sender sees" in the sender's words for every state, none for server-lane or local items; the recorded state remembered; Keep for later marks only waiting items; Quiet hours; a refused read-later remembered for a week until the Reader takes one |
| `InboxRowLineTest` | F03.4 (every row's kind line, read by a screen reader; v1.1's meta line gone with Lab on), F01 (details on a tap: "Sender sees", "Cleaned from"; never on the row), F15 ("Kept for later" on the row, Add to Reader clears it), Lab off: v1.1's rows |
| `ArrivalNoticesTest` | F15.1: the notice's Add to Reader and Keep for later (Lab off: Open Inbox); Keep for later → `held`, a hand-off with the Inbox in front leaves the item, Add to Reader → `handed` (a document) or `reader` (a link); a swipe → `held`; the card's Keep for later; excerpts grouped; "Saved to the Reader" for items handed over by themselves (title, source, Dismiss only, grouped, Dismiss records nothing, never twice, never after a notice), the three channels, Alert, Off, Quiet hours on both kinds of notice; nothing with Lab off |
| `HealthTest` | F15.2 with a fake heartbeat and clock: stopped, the warnings' order, the line, the heartbeat with Lab on only, the 15-minute job's notice at most once every 12 hours with Turn on (and `SyncWorker` running the check), the card's Turn on, notifications off, the poll's error, no card with Lab off |
| `InboxSetupCheckTest` | 1.4 and F26 on the Inbox: What's in Lab's two features (Arrival notices "Needs notifications", its sentence and Open Settings), the arrival settings on the Inbox screen, every check and its button (F26.3; the read-later check's steps and its Test the Reader hand-off), no Reader → Deliver to, Test the Reader hand-off through `HandoffActivity` to "✓ In your Reader" with no state for senders, the activity log and Copy diagnostics with no URL, title, code or topic (F26.2) |
| `LabScreensAccessibilityTest` | also the Inbox's home with Lab's rows, health card, a kept item and an item's details, and the Inbox's Setup check (as shipped and with Comfort at 200 %) |
| `OpenSettingInViewTest` | 1.5 "Open setting" and 1.4 in a 480 dp tall window: Setup check's Open setting for Instant delivery opens the Inbox screen with the switch wholly in view with its footer, the one for the Reader opens Settings at Deliver to, Arrival notices' row (ready) opens the Inbox at its settings with Quiet hours' footer; none changes a setting |

`HandoffDecisionsTest` runs v1.1's hand-off decisions with Lab off (LAB-PLAN 1.3); `LabReporterTest` expects the
hello's `cap-kind`.

### Lab tests (K6, the handover)

| Test | Covers |
|---|---|
| `HandoverTest` | LAB-PLAN 5.3.4 with a fake provider on each side (the Lab Reader's `ShareInboxProvider`, and Daylight Share's provider as a named calling package reaches it): the authorities and the manifest's `<queries>`; the pairing only while armed (2 minutes; a clock set back), with Lab on, on the Inbox, only to the Lab Reader, used up, nothing to an unnamed caller; then no poll, no 15-minute job's poll, no live connection, Instant delivery stopped and stopping itself, health not "stopped", one `lab: 0` frame and no hello through Lab off and on; the resume rule: a "not receiving" answer or an uninstall resumes, and an **invisible provider while the package is installed** (none, throwing SecurityException, IllegalArgumentException or another, no Boolean answer) never does; Receive here again asks first; the cursor skips what the Lab Reader took, in relay time (a DC-1 clock 2 hours fast skips nothing that came after); the `lab: 0` repeat every 11 hours for 48 hours while polls are skipped; the cursor in the answer; a new pairing ends it; Lab off keeps it; a new process reads it back |
| `HandoverScreenTest` | the five sentences are LAB_TEXT's (5.3.4's words); the Lab card without the Lab Reader (no row); Let Daylight Reader (lab) receive and its step; the handed-over line in Settings and on the Inbox; "Can’t reach …" with no button; Receive here again once the Reader said false, which resumes; with Lab off the Inbox keeps the line and Receive here again (1.3); F27 checks for each (as shipped, and Comfort at 200 % on a 360 dp phone) with `lab-handover-*.png` |

### Layout

- `share-core/`: the protocol in plain Kotlin/JVM, no Android classes, no dependencies, so the Reader can embed it:
  `Pairing`, `Keys`, `FrameCodec`, `ItemHeader`, `ItemBuilder`/`PreparedItem`, `Reassembler`, `RelayClient`,
  `Outbox` (sender) and `Receiver` (Inbox), plus `RowText` (the shared status words), `PairingConfirmation` and
  `RelayProbe` (the Inbox's relay check).
- `app/`: Compose UI (`ui/`), the share target and outbox (`sender/`), the Inbox (`inbox/`: receiving, live
  connection, Instant delivery service, hand-off to the Reader), WorkManager jobs (`Work.kt`). Lab: `LabRepo.kt` (the
  gates, What's in Lab, the Daylight server; `LAB_NOTE_ENABLED`), `ui/LabScreen.kt` (the Lab card, What's in Lab, the
  note, the server section) and `inbox/LabReporter.kt` (the Inbox's Lab frames and the `lab-flush` job); `Prefs.lab`
  with `App.labOn` is the one reading of the switch. The phone's Wave 1 (K4) is in `sender/`: `PhoneLab.kt` (its
  features, the Use switches, online, the activity log), `ShareInPlace.kt` (the card), `SendWorker.kt` and
  `FlushWorker.kt` (the `send-<id>` and `flush` jobs; `Work.kt` is the Inbox's, K5), `Notices.kt` ("Send results"),
  `Shortcuts.kt` (Direct Share) and `AutomationActivity.kt`; its screens are `ui/SenderScreen.kt` (the timeline, the
  queue, the copied link) and `ui/LabPhone.kt` (What's in Lab's switches, the F02 entry point, Setup check). The
  Inbox's Wave 1 (K5) is `inbox/InboxLab.kt` (its features and checks, `Arrivals`, `InboxHealth`, `ArrivalNotices` and
  `ArrivalActionReceiver`), with Keep for later in `Handoff.kt`, `HandoffActivity.kt` and `WaitingCard.kt`, the
  heartbeat in `Live.kt`, the health check in `Work.kt`, and its screens in `ui/InboxScreen.kt` (the rows, the health
  card, Arrival notices, Setup check).

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

With Lab on, the Inbox also logs its Lab frames (LAB-PLAN F17) and its Wave 1 (K5):

```
lab: state <id> <waiting|held|inbox|handed|failed|queued|reader>
lab: hello caps=<st,tap[,reader-link],cap-kind>
lab: states n=<k> published
lab: hello lab=0
received <id> -> kept for later: waits in the Inbox
received <id> -> arrival notice: saved to the Reader (<quiet|alert>)
received <id> -> arrival notice dismissed
lab: reader hand-off test <id> stored
lab: instant delivery stopped (no heartbeat for 2 minutes)
```

The card's Keep for later still logs `card: later for <ids>: waits in the Inbox`. On an emulator, a waiting item's
notice actions are in the shade (`adb shell cmd statusbar expand-notifications`, then the action's words: **Add to
Reader**, **Keep for later**); its broadcast (`com.daylight.share.action.KEEP_FOR_LATER`, data
`daylightshare-item:<id>`) goes to an unexported receiver, so only root can send it.

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
