# End-to-end test: a phone, the Daylight Share Inbox and the Reader on an emulator

CI runs it in `.github/workflows/rx-e2e.yml` on an Android 14 emulator (x86_64). Screenshots, logcat, the relay's
state and the three phones' state files go to the `e2e-screens` artifact.

| File | What it is |
|---|---|
| `reader-smoke.sh` | Step 1: installs the Reader (built from its public snapshot) and checks that `SAVE_PAGE` adds a document |
| `inbox-e2e.sh` | Step 2: installs Daylight Share (debug), pairs it as the Inbox through the debug setup link, and runs every pass (its header lists them) |
| `sender.mjs` | The "phone": the JS reference sender (protocol 1.1 with Lab Wave 0) driven from the command line; with `E2E_PEER=v1.0` or `v1.1`, that Sender as it shipped |
| `sender-lab.test.mjs` | The phone's Lab commands against the JS reference Daylight (`LabInbox`) on the mock relay; no emulator (the `sender` job) |
| `reader-lib.sh`, `ui-find.mjs`, `make-pdf.mjs` | Helpers: the Reader's library count, where to tap, test PDFs |

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
