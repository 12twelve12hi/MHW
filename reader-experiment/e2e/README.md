# End-to-end test: a phone, the Daylight Share Inbox and the Reader on an emulator

CI runs it in `.github/workflows/rx-e2e.yml` on an Android 14 emulator (x86_64). Screenshots, logcat, the relay's
state and the three phones' state files go to the `e2e-screens` artifact.

| File | What it is |
|---|---|
| `reader-smoke.sh` | Step 1: installs the Reader (built from its public snapshot) and checks that `SAVE_PAGE` adds a document |
| `inbox-e2e.sh` | Step 2: installs Daylight Share (debug), pairs it as the Inbox through the debug setup link, and runs every pass (its header lists them) |
| `sender.mjs` | The "phone": the JS reference sender (protocol 1.1 with Lab Wave 0) driven from the command line; with `E2E_PEER=v1.0` or `v1.1`, that Sender as it shipped |
| `sender-lab.test.mjs` | The phone's Lab commands against the JS reference Daylight (`LabInbox`) on the mock relay, and the Wave 1 commands (`send-excerpt`, `await-share`, `topics`, `lab-text`, `inbox-items`); no emulator (the `sender` job) |
| `reader-lib.sh`, `ui-find.mjs`, `make-pdf.mjs` | Helpers: the Reader's library count, where to tap (a node, its bounds, or the node nearest another: a notice's expand button), test PDFs |

## Lab (LAB-PLAN F17, task E0)

The phone is a Lab sender: every `Sender` it makes reads the ack topic through a `LabLedger` (`onAckHeader =
labHook(ledger)`), so no command loses a Lab frame. Its state file holds the outbox and the ledger.

```
node sender.mjs lab-states [<id>...]          # what's in the ledger now: the header line, each Inbox's hello, each id's state
node sender.mjs wait-lab <seconds> <want>...  # waits until every <want> holds; exits 1 with what is missing
    lab=<n>                    the Daylight Share Inbox's latest hello (publisher "android") has Lab level n
    caps=<token>[,<token>...]  ... and carries these caps
    <id>=<state>[|<state>...]  the item's state (waiting, held, inbox, handed, failed, queued, reader, or none)
node sender.mjs status                        # each row in the Lab timeline's words (LAB-PLAN 2.5) with its step line
E2E_PEER=v1.0 node sender.mjs ...            # an old phone instead (v1.0 or v1.1): see below
```

**Old phones (F17.1 on the emulator).** `E2E_PEER=v1.0` or `E2E_PEER=v1.1` makes `sender.mjs` import that Sender as
it shipped: `share/js/test/fixtures/daylight-share-v1.0.js` or `-v1.1.js`, the skew suite's peers (LAB-PROTOCOL
2.8), not today's `daylight-share.js`. So the shipped `checkAcks` reads the Inbox's Lab frames, exactly as apps in the
field do. An old phone has no ledger and no Lab commands (`lab-states` and `wait-lab` exit 2), is named "E2E v1.0
phone" or "E2E v1.1 phone", and `status` shows its own words: v1.1's `describeRow`, or for v1.0, which had no shared
words, the row's status alone. `check-too-large` needs v1.1 (v1.0 had no 9 MB limit).

The Lab passes of `inbox-e2e.sh`:

- **1b.** The v1.0 and v1.1 phones, on the same pairing, each send a page, a link and a 300 KB PDF (one attachment)
  with the Inbox in front. Each item reaches the Reader and is acked while the Inbox publishes Lab frames on the same
  ack topic. Each row keeps its own words: v1.1's "Delivered ✓. Saved on your Daylight.", or `delivered` for v1.0.
- **L1.** After the page, link and PDF, the phone has the Inbox's hello (`lab=1`, caps `st`, `tap`, `reader-link`) and
  the states `reader` (page), `reader` or `queued` (link) and `handed` (PDF).
- **10.** Documents = Ask: the phone sees a PDF `waiting`. A root tap through `HandoffActivity` hands it over, and
  the phone sees `handed`.
- **11.** Without "Display over other apps" and with the Reader in front, a link waits too: a notification alone, and
  `waiting` on the phone. A root tap hands it over (`SAVE_PAGE`), and the phone sees `reader`.
- **12.** Lab off on the Inbox (`lab=0`, Documents = Open): its `lab: 0` frame reaches the phone. A page, a link and
  a PDF (handed over through `send_file`) get no state: no `lab: state` line in the Inbox's log, and the phone shows
  v1.1's "Delivered ✓" for each. Lab on again: a hello, and still no state for them.
- **At the end:** every item's last state is on the phone, the old phones' items included (the Lab phone's ledger
  hears the states of every item on the pairing); each old phone sees all its items delivered in its own words; and
  the Inbox's Lab frames were at least 30 s apart (the check fails below 25 s, allowing for a slow publish).

What the emulator covers of F17.1's matrix: the Lab, v1.1 and v1.0 phones × the Lab Inbox for url, page and file, and
the Lab phone × the Inbox with Lab off for url, page and file. The old Receivers (v1.0, v1.1) are not apps on the
emulator; `share/js/test/lab-skew.test.mjs` and the Kotlin `LabSkewTest` cover them.

Lab frames go at most one every 30 s (LAB-PROTOCOL 2.2.4), so each Lab wait can take up to a minute.

**Test hooks used** (all in debug builds or on the emulator only):

- the setup link's `lab=0|1`, `docs=`, `to=` and `instant=1` (android/README, "Debug builds");
- `adb shell appops set com.daylight.share SYSTEM_ALERT_WINDOW deny|allow` for the overlay permission;
- the root tap: `adb root`, then `am start -n com.daylight.share/.inbox.HandoffActivity --es mode one --es item <id>`;
- the Inbox's `DaylightShare` log lines `lab: state <id> <s>`, `lab: hello caps=…`, `lab: states n=<k> published` and
  `lab: hello lab=0`.

Run the phone's Lab test locally with `node --test reader-experiment/e2e/sender-lab.test.mjs`.

## Lab Wave 1 (LAB-PLAN E1)

Passes 13 to 17 of `inbox-e2e.sh` run after the Wave 0 passes, on the same emulator, pairing and relay. Every word they
look for on screen or in a notice comes from `LAB_TEXT` (`sender.mjs lab-text`), as the apps show it.

| Pass | Covers | What it does and checks |
|---|---|---|
| 13 | F15.1, F15.4 | Documents = Ask, no "Display over other apps", the Reader in front, so links and documents wait for a tap. One item at a time, each with exactly one notice (`cmd notification list`): the only alerting notice, first in the shade, where SystemUI shows it expanded with its actions. **Add to Reader** on a link → `reader` (or `queued`), through SAVE_PAGE `by=tap`; on a PDF → `handed`, through send_file. **Keep for later** → `held`, and its notice goes; **swiping** a PDF's notice away → `held`. The phone reads each state and says "Kept for later on your Daylight" for both; opening the Inbox hands neither over; Add to Reader then gives `reader` (or `queued`) and `handed`. |
| 14 | F11, F11.2, F11.4 | An excerpt of the page pass 1 put in the Reader (`send-excerpt`: an explicit selection, `classifyShare` with source `selection`, then `excerptItem`: HTML with its source link and a `#:~:text=` fragment, `x-cap: "excerpt"`), and a note without a link (Markdown). Documents = Open: each goes through send_file and the library grows by one: a new document, not "already in your library". `handed`. |
| 15 | F15.1 | A link handed over by itself gets one "Saved to the Reader" notice (Quiet). The other ones are snoozed for the step (`cmd notification snooze`, never their summary: a snoozed summary takes every later child with it) and put back after. **Dismiss** takes it away, and no `lab: state` line follows for that item. |
| 16 | F26 | Setup check (MainActivity's Lab page extra `SETUP`) › **Test the Reader hand-off**: the test article goes through SAVE_PAGE (`by=front`), the library grows, Setup check says "✓ In your Reader", and no sender gets a state for it (lane `local`). |
| 17 | F11.5, F08, F04.6, F11, F03.3 | The same Daylight Share becomes a sender on the pairing (setup link `role=sender`; it calls itself "CI Daylight", the setup link's `n`). An NYT-style "headline + link" ("Opinion | The Real Reason … https://example.com/?story=…&utm_source=nytcore-android-share") shared to its share target goes as a link: `await-share` reads the inbox topic and checks the header against what the JS reference makes of the same share (kind `url`, the link without `utm_source`, the headline as its title, `x-orig`, no `x-cap`); the first link-only share shows the hint. The link is on example.com because the emulator's Reader must save it unattended: a link it cannot fetch (www.nytimes.com from CI) ends in its "problem" card, which waits for a tap, and the Inbox's hand-off waits with it (run 63). The NYT links themselves (nyti.ms, `smid`) are `normalise.json` vectors. After that send, `cmd shortcut get-shortcuts` lists the Direct Share shortcut `daylight` ("CI Daylig…"), and a share carrying `EXTRA_SHORTCUT_ID` goes too. The mock relay answers 413 to the next publish on the inbox topic (`/__mock/fail-publish`): the send worker posts "Couldn’t send ‘F04 forced 413’ to CI Daylight" / "Open to try again." (`dumpsys notification`). With Comfort the card opens with Options and Send; **Send as excerpt** goes as the JS reference's excerpt. Back as the Inbox (`role=inbox`, Comfort off): the shortcut is gone, the links reach the Reader through SAVE_PAGE (`reader` or `queued`) and the excerpt as a new document (`handed`). |

At the end, besides Wave 0's checks: every item from the Android phone was handed to the Reader too; the Inbox's Lab
frames stay within its daily cap (`LAB_FRAMES_PER_DAY`, 30: past it, states would wait for the digest); and every
message the run published stays within ntfy.sh's daily messages for one address (250), since the phones, the Android
phone and the Inbox publish from one machine, as a household does. Before Wave 1 a run used 15 Lab frames and 60
messages.

When the shade does not show what to tap, the step says so in the log ("note: … not found in the shade") and does the
same through the debug hook, so the state checks still run: Add to Reader is the root tap
(`am start … HandoffActivity --es mode one --es item <id>`), Keep for later and Dismiss are root broadcasts to
`ArrivalActionReceiver` (`com.daylight.share.action.KEEP_FOR_LATER`, `…ARRIVAL_DISMISS`, data
`daylightshare-item:<id>`), and the swipe is one to `NoticeDismissedReceiver` (`…NOTICE_DISMISSED`). The end of pass 13
lists which actions went through the shade.

```
node sender.mjs send-url <url> [title]                 # a link with its own title (to find its notice)
node sender.mjs send-excerpt <tag> [source url]        # an explicit selection: an HTML excerpt, or a Markdown note
node sender.mjs topics                                 # the pairing's inbox and ack topics
node sender.mjs lab-text <id> [name=value...]          # LAB_TEXT's words, slots filled
node sender.mjs inbox-items [since]                    # what is on the inbox topic, read only
node sender.mjs await-share <s> <from> <since> <link|excerpt> <text> [subject]
                                                       # another sender's share, checked against the JS reference's
```

**Test hooks added** (debug builds or the emulator only): the setup link's `role=sender` and `comfort=`; MainActivity's
extra `com.daylight.share.extra.LAB_PAGE` (`SETUP`); `cmd notification list` and `cmd notification snooze`; `cmd
shortcut get-shortcuts`; `dumpsys notification --noredact`; the mock relay's `/__mock/fail-publish`; the root
broadcasts above.

### Still to check on a device

For the W1 device round on Rooted 2 (with an Android 13 or 14 phone and the real ntfy.sh relay). The emulator runs one
Daylight Share in both roles, one after the other, with the mock relay, and taps the Android 14 emulator's shade:

- **F15.1 on the e-paper shade:** Add to Reader and Keep for later on a waiting item's notice, a swipe, and Dismiss on
  "Saved to the Reader", with the phone's row following each (`reader`/`handed`, "Kept for later on your Daylight",
  nothing new after Dismiss); TalkBack reads each notice's title and source; several arrivals are grouped.
- **F15.4:** Keep for later on a link's notice or card makes the iPhone show "Kept for later on your Daylight", and Add
  to Reader then "In your Reader ✓".
- **F11.5:** an NYT "headline + link" shared from the NYT app and from Chrome on the phone arrives as a link that the
  live Reader downloads (on the emulator the snapshot Reader may only queue it).
- **F11.4:** an excerpt of a page already in the live Reader, sent from the Chrome extension and from the phone's Send
  as excerpt, is a new document there, not "already in your library".
- **F08.1, F08.2:** after one send, the Daylight's name is in Chrome's Direct Share row (the emulator only lists the
  shortcut and sends with `EXTRA_SHORTCUT_ID`); tapping it sends with no other screen; Unpair removes it; the id
  survives an update.
- **F04.6:** a real ntfy.sh 413 (the phone's attachment allowance used up) after the card closed posts the "Send
  results" notice, and tapping it opens the row.
- **F26.1:** Test the Reader hand-off reaches the live Reader in each condition of F01.1 (the emulator runs it with the
  Inbox in front only).

