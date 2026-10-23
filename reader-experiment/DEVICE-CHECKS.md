# Real-device checks

Run by a Claude session on the Mac mini, with the lab DC-1 ("Rooted 2", JP4R01422) as the Daylight, its main
Daylight Reader (`com.daylightcomputer.reader`), and the real ntfy.sh relay. Test items were removed afterwards and
the tablet's library was back at its recorded baseline both times.

## Round 1 (Oct 20)

| Sender | Item | Send to hand-off | Result |
|---|---|---|---|
| Command-line sender | page | ~7.6 s | In the Reader |
| Command-line sender | link | ~6 s | In the Reader |
| Command-line sender | PDF | ~1 s | In the Reader |
| Command-line sender | page, sent while the Reader was in front (nobody touched the tablet) | ~6 s | In the Reader |
| Mac app | PDF | late (see below) | In the Reader |
| Mac app | link | ~6.5 s | In the Reader |

Every hand-off went to `com.daylightcomputer.reader`, never to the side-by-side `com.daylightcomputer.readerexperiment`.

Found:
- **Mac app hangs at launch on macOS 15.** The app checks its App Group container on the main thread. Its ad-hoc
  signature and un-prefixed group trigger the "would like to access data from other apps" prompt, so the app waits
  until someone clicks Allow. Fixed: the container is never touched on the main thread, and ad-hoc builds use no
  App Group (commit 0e90108, under review).
- **A PDF that arrives while the Reader is in front waits** until the Inbox is opened. Fixed: the Inbox now notifies
  at once, and "Add quietly to the library" hands documents over as SEND_MULTIPLE, which shows the library instead of
  opening the PDF (commit cb57057, under review).
- Not verified: the Mac app's "Delivered" history, because of the hang. Added to its CI smoke test.

## Round 2 (Oct 20)

| Sender | Item | Send to hand-off | Sender shows |
|---|---|---|---|
| Android phone app (Android 14 emulator, typed code, system share sheet) | link | ~8 s | Delivered ✓ |
| Android phone app | PDF | ~3 s | Delivered ✓ |
| Chrome extension 1.0.4 (release zip in Chromium, optional `<all_urls>` granted) | page | ~7 s | Delivered ✓ |
| Chrome extension | PDF | ~3 s | Delivered ✓ |
| Chrome extension | link | ~6 s | Delivered ✓ |
| Web sender | link | ~7 s | Delivered ✓ |
| Web sender | PDF | ~4 s | Delivered ✓ |

Found:
- **A PDF was handed off but never imported (once in three tries).**
  - **What happened:** the Inbox logged `send_file status=sent` and the sender showed Delivered ✓, but the Reader
    reopened the previous document instead.
  - **Cause, in the Reader:** its ImportActivity (singleTask) collects navigation only while resumed. The earlier
    import's "open the document" event was still pending when the new share arrived through `onNewIntent`. That
    stale event reopened document 1 and finished the activity, which dropped the new file. Reported to the Reader
    session on the Mac mini, with a suggested fix and test.
  - **Workaround in the Inbox (protocol port):** start document hand-offs with `FLAG_ACTIVITY_NEW_TASK |
    FLAG_ACTIVITY_CLEAR_TASK`, space them out, and batch them.
  - **Lab:** report "In your Reader ✓" separately from "On your Daylight ✓" where the Reader confirms the save. It
    does for links and pages; for documents, only the Reader-side Lab inbox can.
- **The web sender says "up to 64 MB",** but ntfy.sh takes about 2 MB until protocol v1.1. v1.1 sets one 9 MB
  limit and shared wording for every app (protocol port).

## Round 3 (Oct 21): Mac app build 12, the upgrade path

First pass, with the Mac at its lock screen.

- Installed over build 7, leaving `~/Library/Containers/com.daylight.share.mac` and the `group.com.daylight.share`
  container in place. CFBundleVersion 12; the app and its extensions carry no application-groups entitlement
  (ad-hoc signed).
- **Launch: no hang.** The process was up in 0.08 s, and a main-thread sample shows the normal idle event loop. Build 7
  was stuck in `SharedStore.isWritable`.
- Pairing through `open daylightshare://pair?c=…` worked (Inbox: "inbox: new pairing dls-30ecf2be…").

| Sender | Item | Send to hand-off | Result |
|---|---|---|---|
| Mac app (`open -a`) | PDF, 18 KB | ~4 s | handed to `com.daylightcomputer.reader`, imported (sha = file) |
| Mac app (`open -a`) | link | ~7 s | `save_page` saved, imported |

Still to check once the Mac is unlocked:
- how long until the window is usable;
- any "differs from previous versions / data from other apps" prompt;
- "Delivered ✓" in the history;
- Finder › Share › Daylight.

Rooted 2 is back at its baseline (`library=41 deleted=4 total=45 ids=92fc8f4b85f39eea`), Daylight Share is
uninstalled, and the lock is released.

## Round 4 (Lab W0 and W1): checklist

The next round: every device item of Lab Wave 0 and Wave 1 (LAB-PLAN 6.2, 6.4), and round 3's four open Mac items.
This is the plan, not the record. Write what happens in a new section after this one, "Round 4 (date): results",
as rounds 1–3 did, and leave this list as it is.

Sources: LAB-PLAN 3.1–3.3 (the acceptance lists), 1.3, 1.6, 2.6 and 6.4, LOOSE-ENDS, and the "Still to check on a
device" lists in `apple/README.md` (the iPhone's and iPad's, the Mac's, and its two "Once …" groups),
`android/README.md` (four lists), `android/share-core/README.md`, `extension/README.md`, `web/README.md`,
`windows/README.md` and `e2e/README.md`. If a README's list has changed since, the README wins.

What the user decided that this round leans on (LAB-DECISIONS):
- Text becomes an excerpt only from an explicit selection; "headline + link" shares stay links (Q1).
- Each behaviour-changing feature has a **Use** switch in What's in Lab, on by default (Q5). Leave them on. If a
  Wave 1 behaviour is missing, look there first, and note it.
- The Mac stays ad-hoc signed (Q6), so the Mac's team-signed items (part of F04.3, F04.6) are skipped.
- A handover to the Lab Reader outlives Lab off (Oct 23, LAB-PLAN 1.3).

### Who, where, what

- **Run by** the Claude session on the Mac mini.
- **Devices:**
  - the lab DC-1 "Rooted 2" (JP4R01422): Daylight Share as the Lab Inbox, and the main Daylight Reader
    (`com.daylightcomputer.reader`);
  - the real ntfy.sh relay;
  - the Mac mini: the Mac app, Chromium, the command line;
  - an iPhone, only when the user brings one, and an iPad if they have one (its split widths);
  - an Android 13 or 14 phone, or the Android 14 emulator where the item allows it;
  - a Windows 10 or 11 PC, only if the user has one at hand.
- **Never JP4R03005.** No install and no adb command on it, whatever the item says.
- **Never touch the Lab Reader** (`com.daylightcomputer.readerexperiment`): it is the Reader session's. Every hand-off
  in this round goes to `com.daylightcomputer.reader` (the Inbox log's `handed to <package>`), as in round 1.

**Marks** on the items:

| Mark | Means |
|---|---|
| (now) | the build exists today |
| (A4), (A5) | waits for the iPhone's (A4) or the Mac's (A5) Wave 1 build |
| (gate) | waits for the Safari extension's Lab: it ships inside the Apple apps once the W1 gate opens |
| (R1) | waits for the Lab Reader's built-in inbox (the Reader session's R1) |
| [unlocked] | needs the Mac's screen unlocked: clicks, windows, screenshots, VoiceOver. Ask the user to unlock it. |
| [user] | needs the user there: their iPhone or PC, a login, ears for a screen reader, the usability pass |
| [phone] | needs a real Android phone; the emulator cannot show it |

An item without [unlocked] or [user] runs with the Mac at its lock screen (commands, status files, adb), as round
3's first pass did.

**Builds.** CI artifacts come from the latest green run on `claude/sweet-goldberg-ej1nb0`:
`gh run list -R 12twelve12hi/MHW -w <workflow> -b claude/sweet-goldberg-ej1nb0 -s success -L 1`, then
`gh run download <run id> -R 12twelve12hi/MHW -n <artifact>`.

- **Mac app** (W0 now, W1 after A5): `Send-to-Daylight-mac.zip` from the release `reader-experiment-latest`
  (`gh release download reader-experiment-latest -R 12twelve12hi/MHW -p Send-to-Daylight-mac.zip`). Downloaded by `gh`,
  it carries no quarantine flag, so it opens without the right-click step.
- **iPhone** (W0 now, W1 after A4): `Send-to-Daylight-unsigned.ipa` from the same release, sideloaded by the user
  (AltStore or Sideloadly), or the user's own Xcode build. [user] For the upgrade check (F00.1), first the last
  non-Lab build, the P0 close-out's: artifact `send-to-daylight-ios` of the last green rx-apple run before A1
  (fb7c2ed). Sideload both with the same tool and Apple ID, so the W0 build updates it in place.
- **Daylight Share** (the Inbox and the Android phone; W0 and W1 now): `daylight-share-debug.apk`, artifact
  `daylight-share-debug-apk` of rx-android. Only debug builds take the setup link (`android/README.md`, "Debug
  builds").
- **Chrome extension** (W1 now): artifact `send-to-daylight-chrome` of rx-extension. The release gets it only once the
  gate opens.
- **Web sender** (W1 now): `node reader-experiment/web/build.mjs --serve 8080` serves http://127.0.0.1:8080. The
  iPhone needs the artifact `send-to-daylight-web-site` on an HTTPS host [user]. Android Chrome reaches the local one
  through `adb -s <phone> reverse tcp:8080 tcp:8080`.
- **Windows** (W1 now): artifact `Send-to-Daylight-windows-setup` of rx-windows. [user]
- **Command line** (now): from this repository, `node reader-experiment/share/js/bin/daylight-send.mjs` (links and
  files) and `node reader-experiment/e2e/sender.mjs` (the e2e "phone": pages, PDFs, excerpts, Lab states).

### The rules of rounds 1–3

1. **Take the device lock first.** Rooted 2 is shared with the Reader session on the Mac mini. Use the lock file
   rounds 1–3 used; if this session does not know its path, ask the Reader session, because both must use the same
   file.

   ```sh
   LOCK=<the Rooted 2 lock file>
   ( set -C; echo "round 4 $(date -u +%FT%TZ)" > "$LOCK" ) || { echo "Rooted 2 is busy:"; cat "$LOCK"; }
   ```

   `set -C` makes the write fail when the file exists, so two sessions never both hold it. If it is busy, wait.
   Never remove someone else's lock. Each tool call is a new shell, so no `trap`: remove the lock by hand at the end,
   and only while it still says "round 4".
2. **Name the device in every adb command:** `adb -s JP4R01422 …`, and `adb -s <serial>` for the phone. Run
   `adb devices -l` first. Never a bare `adb`. Below, `D="adb -s JP4R01422"`.
3. **Record the baseline before anything changes:**
   - the Reader's count line:

     ```sh
     $D shell am broadcast -f 32 -n com.daylightcomputer.reader/com.daylightcomputer.reader.shell.ShellReceiver \
       -a com.daylightcomputer.reader.SHELL --es cmd count
     ```

     Round 3 left `library=41 deleted=4 total=45 ids=92fc8f4b85f39eea`. If today's line differs, today's is the
     baseline; say so in the results.
   - what is installed: `$D shell pm list packages | grep -i daylight` (round 3 left Daylight Share uninstalled);
   - each setting this round changes: `$D shell settings get global window_animation_scale` (and
     `transition_animation_scale`, `animator_duration_scale`), `settings get system accelerometer_rotation` and
     `user_rotation`, `settings get secure enabled_accessibility_services`, Wi-Fi, and the Reader's read-later
     setting.
4. **Mark every test item**, so it can be found and removed. The mark is "R4-" and a name:
   - titles contain "(R4-<name>)", as `sender.mjs` makes them from its tag: `send-page R4-x` is "Walden, sent from a
     phone (R4-x)"; `send-pdf R4-a` is "Test PDF (R4-a)", file `daylight-share-R4-a.pdf`; an excerpt's title starts
     with its quote in quote marks, “I went to the woods … deliberately (R4-x), …”, then " · Walden, sent from a
     phone (R4-x)" when it has a link. A title typed by hand does the same: "Link (R4-cli-C2)";
   - links are `https://example.com/?r4=<name>`;
   - PDFs come from `node reader-experiment/e2e/make-pdf.mjs r4-<name>.pdf "PDF (R4-<name>)"` (about 2 KB; add a
     size in bytes as the third argument for a bigger one);
   - what the round cannot name goes into `~/round4/sent.txt` as it is sent (the time, the sender, the title or
     address): a link the Reader titles from the page it fetched, a real site's page, a test article ("Test article
     from {device}"), a share from another app. Excerpts' file names carry no mark either: "Excerpt - I went to the
     woods because.html" and "Note - I went to the woods because.md".
5. **Restore the baseline at the end**, and also when the round stops half-way:
   - delete every test item from the Reader, as rounds 1–3 did: each title or file name with "R4-" in it, in any case
     ("(R4-x)", `daylight-share-R4-a.pdf`, `r4-ask.pdf`), each `?r4=` link, the two excerpt file names of rule 4, and
     each line of `~/round4/sent.txt`. Then the count line must equal the baseline exactly: library, deleted, total
     and ids. If it does not, something is still there: look again;
   - uninstall Daylight Share if it was not there at the start: `$D uninstall com.daylight.share`;
   - put back every setting from step 3, and delete what the round left on the tablet (`/data/local/tmp/r4*`);
   - on the Mac: VoiceOver off, Comfort and Lab as they were, the mock relay and the test pages' server stopped,
     `~/round4/chrome-profile` and `~/round4/cli` deleted;
   - end the results with the line round 3 ended with: "Rooted 2 is back at its baseline (`…`), Daylight Share is
     uninstalled, and the lock is released." Then remove the lock.
6. **Never write a pairing code, a topic, a Server code or a setup link** (Daylight Share's or the Daylight server's)
   into DEVICE-CHECKS.md or a commit. Shorten them as round 3 did ("dls-30ecf2be…").

### The relay's limits

- ntfy.sh allows about 250 messages a day per IP address, and 20 MB of attachments at a time (kept 3 h). The Mac
  mini, Chromium, the command line, the DC-1 and phones on the same Wi-Fi share one address. Keep PDFs small unless
  size is the point. Count what was published (the Inbox log, and `sender.mjs`'s `publish …` lines).
- Polls count against the request rate: a burst of 60, then one every 5 s. A loop that checks a sender's status polls
  every 10 s at most.
- **The Inbox sends at most 30 Lab frames a UTC day** (hellos and states, at least 30 s apart). Past that, states wait
  for the 11-hourly digest, and every F01 check after it fails for the wrong reason. Count the `lab: hello` and
  `lab: states n=… published` lines in the Inbox log. Stop the timed checks at 25, and go on after 00:00 UTC.
- **Batch.** In each condition, send one link from every sender at hand within a few seconds. The Inbox's 30 s
  spacing then carries all their states in one or two frames.
- A plan that fits:
  - day 1: set-up, round 3's items, the Mac's and the Inbox's W0 items, then W1 on the Inbox, the Android phone, the
    command line, Chromium and the web sender, condition by condition;
  - day 2: what is left, Windows, and the usability pass while the user is there;
  - later: the iPhone's and the Mac's W1 items, once A4 and A5 land; the K6 items once R1 exists; the two "Once …"
    groups of section 1, once the Daylight server is deployed and the Developer ID secrets exist.

### Set-up

```sh
mkdir -p ~/round4/shots ~/round4/logs
R=<this repository>/reader-experiment
D="adb -s JP4R01422"
```

1. **A fresh pairing** on the real relay. The e2e phone makes the secret and prints the 28-character code:
   `E2E_STATE=~/round4/phone.json node $R/e2e/sender.mjs pair https://ntfy.sh` → `$CODE`.
2. **Daylight Share as the Inbox**, Instant delivery on, Documents = Ask. The link has no `lab=`: on a fresh install
   Lab must be on by itself (the Inbox's F00.1, section 3). Screenshot the Inbox at once, before anything taps OK.

   ```sh
   $D install -r daylight-share-debug.apk
   $D shell am start -a android.intent.action.VIEW -n com.daylight.share/.ui.MainActivity \
     -d "daylightshare://setup?role=inbox&c=$CODE&r=https%3A%2F%2Fntfy.sh&n=Rooted%202&instant=1&docs=ask"
   ```

   If Daylight Share was installed at the baseline, this is not a fresh install: add `&lab=1` and mark the Inbox's
   F00.1 skipped. Never uninstall it to make it fresh. The same link with the same code changes one setting and keeps
   the pairing: `docs=ask|quiet|open` (quiet is "Add to the library as a batch"), `lab=0|1`, `instant=0|1`.
3. **Watch the Inbox** for the whole round, in the background:
   `$D logcat -v time -s DaylightShare | tee -a ~/round4/logs/inbox.log`. Expect
   `lab: hello caps=st,tap,reader-link,cap-kind`.
4. **Pair the senders** with `daylightshare://pair?c=$CODE&r=https%3A%2F%2Fntfy.sh&n=Rooted%202`:
   - command line: `daylight-send pair "<that link>"` (short names: step 6);
   - Mac app: `-DLSPairLink "<that link>"` (below), only after the Mac's F00.1;
   - Android phone: the setup link of step 2 with `role=sender&lab=1` (`adb -s <phone>`), or scan the Inbox's QR
     code;
   - Chromium, the web sender, Windows: paste the code; iPhone: the user scans the QR code.
5. **Clocks.** Note `date -u +%s` next to `$D shell date +%s`, so log times and sender times can be compared.
6. **Short names** used below:
   - `daylight-send` is `DAYLIGHT_SEND_DIR=~/round4/cli node $R/share/js/bin/daylight-send.mjs`;
   - `sender.mjs` is `E2E_STATE=~/round4/phone.json node $R/e2e/sender.mjs` (the e2e phone of step 1).

**The Mac app from the command line.** The released app takes these launch arguments. Quit it first, or they are
ignored.

```sh
osascript -e 'quit app "Send to Daylight"'
open -a "Send to Daylight" --args -DLSStatusDump [-DLSPairLink "<link>"] [-DLSSendLink "<url>"] [-DLSLab 0|1]
S="$HOME/Library/Containers/com.daylight.share.mac/Data/Library/Application Support/DaylightShare/debug-status.json"
```

- `$S` holds `firstRenderAt`, `heartbeatAt`, `paired`, `lab`, `caps`, `labStates` and each row's `label`. The app
  rewrites it every second, so it can be read while the Mac is locked.
- `open -a "Send to Daylight" <file>` sends a file (round 3). `-DLSComfort 0|1` sets Comfort.
- `-DLSPairLink` pairs without asking; `open 'daylightshare://pair?…'` asks first [unlocked].
- The debug-only arguments (`-DLSSampleHistory`, `-DLSShowAnnouncements`, `-DLSShareCard`) are not in the released app.
- On the iPhone nothing can be passed without Xcode: everything there goes through the screen [user].

**The four conditions of F01.1.** Every F01.1 and F26.1 item runs in each of them.

- **C1** Daylight Share in front: `$D shell am start -n com.daylight.share/.ui.MainActivity`.
- **C2** Daylight Share in the background, the Reader in front, "Display over other apps" on:
  `$D shell appops set com.daylight.share SYSTEM_ALERT_WINDOW allow`, then
  `$D shell monkey -p com.daylightcomputer.reader -c android.intent.category.LAUNCHER 1`.
- **C3** As C2 with "Display over other apps" off (`… SYSTEM_ALERT_WINDOW deny`). A link waits: the sender reads
  "Waiting for a tap on your Daylight" until its notice is tapped, then "In your Reader ✓".
- **C4** The screen off, Instant delivery on: `$D shell input keyevent KEYCODE_SLEEP` (wake: `KEYCODE_WAKEUP`).

Before each send, check the condition: `$D shell dumpsys activity activities | grep -m1 ResumedActivity` and
`$D shell dumpsys power | grep -m1 mWakefulness`.

**Tapping on the DC-1** as a person would (a notice's action, a row's button):

```sh
$D shell cmd statusbar expand-notifications
$D shell uiautomator dump /data/local/tmp/r4-ui.xml && $D pull /data/local/tmp/r4-ui.xml ~/round4/ui.xml
$D shell input tap $(node $R/e2e/ui-find.mjs node ~/round4/ui.xml 'Add to Reader')
```

**Timing a sender.**
- Command line: `daylight-send status <id> --json` every 10 s, with `date -u +%T` before each line.
- e2e phone: `sender.mjs wait-lab 180 <id>=reader`, then `sender.mjs status`.
- Mac: read `$S` every second (local, no relay requests).
- Android phone: a `uiautomator dump` every 2 s, noting when the row's label changes (local too).
- Chromium, iPhone, Windows: the screen, with a screen recording where the times matter.
- The DC-1's side: the Inbox log's `received <id>`, `handed to …` and `lab: state <id> <s>` lines.

**Forcing a 413** (F04.6, F04.3, usability task 3): the mock relay on the Mac mini.

```sh
node $R/share/js/mock-relay.mjs --control --host 0.0.0.0 --port 8787
curl -X POST 'http://127.0.0.1:8787/__mock/fail-publish?count=1&status=413'
```

- Its address: `http://127.0.0.1:8787` on the Mac mini (the Mac app, Chromium, the command line); the same on an
  Android phone after `adb -s <phone> reverse tcp:8787 tcp:8787` (debug builds allow plain HTTP only to localhost);
  `http://<Mac mini's name>.local:8787` on the iPhone.
- Move one sender onto it by pairing again with the same code and `r=` set to that address, percent-encoded. The same
  code keeps the items still on their way. Move it back the same way with `r=https%3A%2F%2Fntfy.sh`.
- Rooted 2 stays on ntfy.sh, so an item recovered after the move back reaches it.
- A real 413 from ntfy.sh would fill the whole household's attachment allowance for 3 hours: only from a phone on
  mobile data, and last.

**Test pages** (Safari's PDF and Review items), served from the Mac mini in the background:

```sh
mkdir -p ~/round4/www && cd ~/round4/www && node $R/e2e/make-pdf.mjs r4-ask.pdf "PDF (R4-ask)"
node -e 'const p = Array.from({ length: 2800 }, (_, i) => `<p>Line ${i}: ${"word ".repeat(70)}</p>`).join("\n");
  require("fs").writeFileSync("r4-mega.html", `<!doctype html><title>Mega page (R4-mega)</title><h1>Mega</h1>${p}`)'
python3 -m http.server 8000 -d ~/round4/www
```

`r4-mega.html` is about 1 MB. The Mac opens `http://127.0.0.1:8000/…`, the iPhone
`http://<Mac mini's name>.local:8000/…`.

**What to record for every item:**
- the start time (UTC), and the result: pass, fail (with what was seen), or skipped (with why);
- the times the item asks for, in seconds from the send. For F01.1: "Sent", "On your Daylight ✓", "In your
  Reader ✓";
- the Inbox log lines for the item;
- a screenshot of what was checked, named `~/round4/shots/r4-<id>-<device>[-C<n>].png`:
  - Mac: `screencapture -x <file>` [unlocked];
  - DC-1 and phone: `adb -s <serial> exec-out screencap -p > <file>`;
  - iPhone and Windows: the user's screenshot.

Screenshots stay on the Mac mini; the results name the files. A results row:

| Id | Device · condition | Start (UTC) | Result | Times | Screenshot |
|---|---|---|---|---|---|
| F01.1 | command line · C2 | hh:mm:ss | pass | sent 0 s · on Daylight n s · in Reader n s | r4-F01.1-cli-C2.png |

### 1. Mac app (the Mac mini)

**Round 3's open items** [unlocked]. Check them on the new build, at its first launch in F00.1 below, so unlock the
Mac before that launch:
- [ ] **Round 3** How long until the window is usable: `firstRenderAt` in `$S` minus the launch time, and by eye.
- [ ] **Round 3** No "differs from previous versions" or "access data from other apps" prompt, at launch or at the
  first send.
- [ ] **Round 3** "Delivered ✓" in the history, for an item the Daylight acked.
- [ ] **Round 3** Finder › Share › Daylight sends a PDF (the first time, paste the code: the ad-hoc card keeps its
  own pairing). The card's own settings show its own Lab switch, on (LAB-PLAN 1.1).

**Wave 0** (now):
- [ ] **F00.1** Install the new zip over build 12, keeping the containers: quit the app, `ditto -xk` the zip, replace
  `/Applications/Send to Daylight.app`. Before pairing again, `$S` says `lab: true`, still `paired`, and the same rows.
  [unlocked] No one-time note (a W0 build), and Settings starts with Lab, What's in Lab and Daylight server.
- [ ] **F00.7** [unlocked] Before any click on a Lab feature or on Daylight server, no screen names a secret
  (`CLOUDFLARE_…`, `ANTHROPIC_API_KEY`) or shows a needs-setup sentence. Walk the main window, Settings, What's in
  Lab and the Share menu card. What's in Lab ends with the ad-hoc line ("This copy of the Mac app isn’t signed with a
  team, …").
- [ ] **Share menu card's Lab switch** [unlocked] (LAB-PLAN 1.1) In Finder › Share › Daylight's settings, turn the
  card's own Lab switch off: the card is v1.1's but for the switch itself, and the app's Lab stays on (`lab: true`
  in `$S`). Screenshot the card, then turn the switch back on.
- [ ] **F17.4** Pair the Mac (`-DLSPairLink`), open What's in Lab [unlocked], then turn the Inbox's Lab off and on
  (the setup link with `lab=0`, then `lab=1`). The first line goes from "Needs Lab on your Daylight" to "Your
  Daylight: Lab on · checked in …" within one ack check. Record the seconds from the Inbox's `lab: hello caps=…`
  line. With the Mac locked, `caps` in `$S` marks the same moment.
- [ ] **VoiceOver on a Lab page** [unlocked] On What's in Lab and Daylight server, VoiceOver never reaches Settings'
  hidden controls under the page. Screenshot VoiceOver's caption panel.
- [ ] **F27.3** [unlocked] A VoiceOver run of pair → send → delivered announces each state change.

**Wave 1** (A5), [unlocked] unless said:
- [ ] **F00.1 (W1)** The one-time note ("Lab is on. New features to try are in Settings › Lab, where you can turn it
  off.") shows once in the first W1 build; OK dismisses it for good.
- [ ] **F01.1** A link from the app (`-DLSSendLink`; the Mac may be locked) in C1–C4: "In your Reader ✓" within 45 s
  of "On your Daylight ✓".
- [ ] **F01.2** Documents = Ask: a PDF (`open -a "Send to Daylight" ~/round4/www/r4-ask.pdf`) reads "Waiting for a
  tap on your Daylight". After the tap: "Handed to the Reader" and "The Reader doesn’t confirm documents yet." at the
  next check.
- [ ] **F01.3** The header reads "Your Daylight checked in N min ago". With the DC-1's Wi-Fi off
  (`$D shell cmd wifi set-wifi-enabled disabled`, only with adb over USB), a send still goes out. Wi-Fi back on.
- [ ] **F01.6** VoiceOver reads each row as "{label}. {sentence}", with no step count. The step line shows only on
  the newest row and on rows that are not final.
- [ ] **F04.3** Share › Daylight from Safari, Finder and Preview closes as soon as the item is "Sent" (a link within
  2.5 s), shows a failure on its card (the mock relay's 413), and follows its own Lab switch.
- [ ] **F04.5** With VoiceOver on, and with Comfort on, the card shows the choices and Send, and sends nothing before
  Send.
- [ ] **F07.1** [user] With the network off, a share reads "Waiting for connection", not "Not delivered"; back
  online, it goes within a minute. The user turns the network off: it cuts this session too.
- [ ] **F09.1** In Shortcuts, "Send link to Daylight" returns an id and status "sent". "Get delivery status" returns
  "delivered", and its label once in the Reader.
- [ ] **F09.3**
  `open 'daylightshare://send?url=https%3A%2F%2Fexample.com%2F%3Fr4%3Dscheme&title=Scheme%20%28R4-scheme%29'` shows
  "Send to Rooted 2?". With `&quick=1` and the quick-sends setting off, the sheet still shows. A test web page that
  opens the link cannot send silently.
- [ ] **F11.2** Selected text with no link (TextEdit) › Services › Send to Daylight arrives as a Markdown note that
  the Reader opens.
- [ ] **F23.1** Setup check › Add to the Print menu, then TextEdit › Print › PDF › Send to Daylight: a PDF with the
  same page count reaches the Reader.
- [ ] **F29.1** A PDF dragged from Finder and a link dragged from Safari onto the menu-bar icon are both sent.
- [ ] **F33.3** With Lab on, the clipboard command reads "Send copied link". The window's button shows the host and
  Send first; ⇧⌘L and the menu entry send at once and name the host. With Lab off (`-DLSLab 0`): "Send Clipboard
  Link", as v1.1.
- [ ] **F26.1** Setup check's test article reaches the Reader and ticks Delivered and In your Reader, in C1–C4
  ("Waiting for a tap on your Daylight" meanwhile where the Inbox asks).
- [ ] **F26.3** Each unmet check's button opens the right place: the Share menu extension, the Safari extension,
  start at login, Add to the Print menu, notifications.
- [ ] **F27.3** A VoiceOver run of pair → send → delivered → in the Reader announces each state change.
- **F04.6** on the Mac needs a team-signed build: skipped while the Mac stays ad-hoc (Q6). The ad-hoc card shows its
  failure itself (F04.3).

**Once the Daylight server is deployed** (LOOSE-ENDS › Deploy the Daylight server; LAB-PLAN 2.6 "Setup link"), on the
Mac [unlocked] and the iPhone [user]. Skip the group until then. The user reads the deploy's one-time setup link in
Cloudflare (D1 › daylight-server › Console); never write it down (rule 6).
- [ ] **Setup link** Paste it in the Mac app's Lab settings › Daylight server › Set up with a link. "Use this
  Daylight server?" names the link's own address: record only that it matches. Use it: "Setting up…", then the done
  line, and the section reads Ready with the server's host and fingerprint. A screenshot of each step.
- [ ] **The other Apple device** The iPhone, Lab on and paired with the same code, finds the server on its own:
  Daylight server reads Ready with the same host and fingerprint, nothing pasted there.
- [ ] **Re-pairing locks the old server** Last, and only with the user's yes: the server stays locked for this pairing
  until the deploy is re-run and its new setup link pasted. Pair the Mac with another code (`-DLSPairLink`, a code
  from `E2E_STATE=~/round4/phone2.json node $R/e2e/sender.mjs pair https://ntfy.sh`): the old server is locked first,
  and the follow-up shows the new Server code and the re-run help (2.6 "Re-pairing"). Then pair back with `$CODE`.

**Once the Developer ID secrets exist** (LOOSE-ENDS › Sign and notarize; `apple/README.md` › Signing) [unlocked]. Skip
the group until then: the Mac stays ad-hoc (Q6) unless the user adds them.
- [ ] **The signed app replaces the ad-hoc one** Download the zip again once the release is signed:
  `codesign -dv --verbose=2 "/Applications/Send to Daylight.app" 2>&1 | grep Authority` names "Developer ID
  Application", and `spctl -a -vv` says "Notarized Developer ID". Replace the app as in F00.1, and open it with a
  double-click. `$S` keeps the pairing, the history rows, Comfort, `lab`, `caps` and `labStates`, and its storage is
  now the App Group; Daylight server keeps its pin, if one was set up. Record `$S` before and after.
- [ ] **The ad-hoc line goes** What's in Lab no longer ends with "This copy of the Mac app isn’t signed with a team, …".
- [ ] **One pairing** Share › Daylight sends without asking for the code, follows the app's Lab switch (it has none of
  its own), and its item shows in the app's history. The Safari extension uses the app's pairing (nothing to paste
  in its popup), with no "Allow unsigned extensions".
- Then the Mac's F04.6 and F04.3's team-signed part (as F04.1) run too.

**Safari on the Mac** (gate) [unlocked]:
- [ ] **F01.1** A link from the popup, left open, in C1–C4.
- [ ] **F01.2** Documents = Ask, site access allowed: a PDF tab (`http://127.0.0.1:8000/r4-ask.pdf`, "Test pages")
  reads "Waiting for a tap on your Daylight" (badge ⌛), then "Handed to the Reader" and "The Reader doesn’t confirm
  documents yet." at the next check.
- [ ] **F01.3** The header reads "Your Daylight checked in N min ago"; with the DC-1 offline (as in the app's F01.3),
  a send still goes out.
- [ ] **F03.1** [user] A page that needs the user's login arrives whole, and the Reader shows the logged-in text.
- [ ] **F04** With "Send when I click the toolbar button" on: the page still goes when the popup closes at once;
  Options stops it; with VoiceOver on, and with Comfort on, nothing goes before Send.
- [ ] **F04 (PDF)** A PDF in Safari's PDF view, where the extension cannot read it: the popup asks, or offers "Allow
  and send" and "Send the link". Closing it at once sends the link with "Without access to the site the PDF can’t be
  downloaded, so its link was sent."; nothing more goes 3 s later. The toolbar popup's address is exactly `popup.html`.
- [ ] **F11.1, F11.4** Right-click › Send selection to Daylight: the Reader shows the quote, the source link and the
  date. From a page already in the Reader, it is a new document.
- [ ] **F26 (Site access)** A fresh install reads "! Site access". Allow shows Safari's own prompt, and the line then
  follows what Safari › Settings › Extensions says.
- [ ] **F26.3 (pairing)** Before pairing the extension, Setup check reads "! Pairing", and its button opens the
  extension's pairing (the code field). After pairing, the line reads "✓ Pairing".
- [ ] **F26.1** Setup check's test article in C1–C4 ticks "✓ Delivered" and "✓ In your Reader" ("Waiting for a tap
  on your Daylight" meanwhile where the Inbox asks).
- [ ] **F33** Safari shows its Paste button; the host shows before anything is sent.
- [ ] **F34.2** The right-click entries are there; unticking one removes it.
- [ ] **F27.3** A VoiceOver run of pair → send → delivered → in the Reader announces each change, with no step count.

**The command line** (now):
- [ ] **F09.4** `daylight-send https://example.com/?r4=cli --json` prints `"status":"sent"` and exits 0. With `--wait`
  it exits 0 once delivered. With `--wait=1` on a new item it exits 2, and the item stays in the outbox.
- [ ] **F09.5** An empty file (`: > ~/round4/empty.pdf`) fails with a sentence on stderr; nothing is published and
  no item reaches the Inbox.
- [ ] **F01.1** In each condition,
  `daylight-send https://example.com/?r4=cli-C<n> --title "Link (R4-cli-C<n>)" --json`, then `status` every 10 s:
  "In your Reader ✓" within 45 s of "On your Daylight ✓". (`--wait-for reader --wait=180` also exits 0.)
- [ ] **F11.1, F11.2, F11.4** `sender.mjs send-page R4-x`, then `sender.mjs send-excerpt R4-x
  https://example.com/walden-R4-x`: one new document with the quote, the source link and the date, not "already in
  your library". `sender.mjs send-excerpt R4-n` (no link): a Markdown note the Reader opens.

### 2. iPhone and iPad [user]

All with the user and their iPhone on the Mac mini's Wi-Fi, paired by scanning the Inbox's QR code.

**Wave 0** (now):
- [ ] **F00.1** The upgrade from the last non-Lab build. Install the P0 close-out's .ipa ("Builds"; if the phone has
  a Lab build, delete it first, with the user's yes), pair it, and send `https://example.com/?r4=iphone-p0` from
  Safari › Share › Daylight. Then install the W0 .ipa over it: Lab is on, no one-time note, and the pairing and the
  history (that link's row) are kept. Record both builds' versions, and screenshot Home.
- [ ] **F00.1 (share sheet)** The share sheet follows the app's switch; it has none of its own. With Lab off in the
  app, Safari › Share › Daylight is v1.1's, as the P0 build showed it. Lab back on. Screenshot the sheet both ways.
- [ ] **F00.7** Before tapping a Lab feature or opening Daylight server, no screen names a secret or says how to set
  something up.
- [ ] **F17.4** With the app open on What's in Lab, turn the Inbox's Lab off and on: "Your Daylight: Lab on ·
  checked in …" within one ack check. Time it from the Inbox's `lab: hello caps=…` line.
- [ ] **F00.3** With VoiceOver on, tap Summaries with Claude in What's in Lab: its one sentence shows under it
  ("Needs your Daylight server. …", with Copy Server code), and VoiceOver reads it out. Record what VoiceOver says
  (Settings › Accessibility › VoiceOver › Caption Panel on, and a screen recording).
- [ ] **F27.3 (W0)** A VoiceOver run of pair (again, with the same code) → send → delivered announces each state
  change ("Sent · waiting for your Daylight", "Delivered ✓"). Record it the same way.
- [ ] **iPad** (if the user has one; the same .ipa) Settings › Lab, What's in Lab and Daylight server at one-third,
  half and two-thirds of a Split View beside Safari: every word shows, and nothing is cut off or overlaps. A
  screenshot of each page at each width.
- [ ] The usability pass (section 7).

**Wave 1** (A4):
- [ ] **F00.1 (W1)** The one-time note shows once, as on the Mac.
- [ ] **F01.1, F01.2, F01.3** As on the Mac: a link in C1–C4, a PDF with Documents = Ask, the header, and a send
  with the DC-1 offline.
- [ ] **F01.6** VoiceOver reads each row as "{label}. {sentence}", with no step count.
- [ ] **F03.3** The first bare link shared from Notes shows, once: "Only the link came through. If this needs your
  login, open it in Safari and share from there." Later shares don't; Setup check lists it; a Safari share never
  shows it.
- [ ] **F04.2** With Instruments on the Mac mini: a 9 MB PDF from Files and an 8 MiB page from Safari each keep the
  share extension under 60 MB peak. The PDF reaches "Sent" after the extension has closed, with the app not running.
- [ ] **F04.5** With VoiceOver on, Comfort on, or "Always show Options before sending" on, the card shows the choices
  and Send, and nothing goes before Send.
- [ ] **F04.6** The mock relay answers 413 after the sheet has closed: "Couldn’t send ‘{title}’ to Rooted 2" with
  "Open to try again." appears within one background wake, and tapping it opens the row. With "Tell me when a send
  fails" off, nothing appears.
- [ ] **F07.1** In flight mode a share reads "Waiting for connection". Back online, it goes within a minute with the
  app open, and with it closed within iOS's background window.
- [ ] **F09.1** As on the Mac, in Shortcuts.
- [ ] **F09.2** (iOS 18 or later; record the model) With `https://example.com/story` copied, "Send copied link with
  Send to Daylight" (allow Paste the first time): Siri answers "Sent to Rooted 2.", and within 10 s the history has
  a row for example.com reading "Sent · waiting for your Daylight". "Check my Daylight with Send to Daylight" answers
  with that row's title and current label.
- [ ] **F09.3** The URL scheme shows the sheet unless `quick=1` and the setting are both on. A test page cannot send
  silently.
- [ ] **F10.4** Review renders a 1 MB page within 1 s, and the edited title is the title sent. Record the iPhone's
  model.
- [ ] **F11.1, F11.2, F11.4** A Safari share with a selection arrives as an excerpt (quote, source link, date), a new
  document even for a page already in the Reader. Text from Notes with no link arrives as a Markdown note.
- [ ] **F16.2** A share from Apple News sends the article's URL, not a text note.
- [ ] **F26.1, F26.3** The test article in C1–C4, and each unmet check's button opens the right place.
- [ ] **F33.1** Copy a link in Safari and open the app: the chip shows with no paste alert; tapping it shows the
  host; Send sends the link.
- [ ] **F27.3** A VoiceOver run of pair → send → delivered → in the Reader announces each change.

**Safari on the iPhone** (gate). Same words as on the Mac.
- [ ] **F01.1** A link from the popup in C1–C4.
- [ ] **F03.1** A page behind the user's login arrives whole.
- [ ] **F04** The popup closes at once and the page still goes.
- [ ] **F04 (PDF)** As on the Mac, with `http://<Mac mini's name>.local:8000/r4-ask.pdf`: "Allow and send" or "Send
  the link"; closing the popup at once sends the link with its sentence, and nothing more goes 3 s later. The toolbar
  popup's address is exactly `popup.html`: with Web Inspector [unlocked] (the iPhone on a cable to the Mac mini,
  Settings › Apps › Safari › Advanced › Web Inspector on; Mac Safari › Develop › the iPhone › the popup), its console
  gives `true` for `location.href.split('#')[0] === browser.runtime.getURL('popup.html')`. Record the line.
- [ ] **F07.1** Flight mode: it goes when iOS next lets the extension run.
- [ ] **F10.4** With Review on (What's in Lab › Send as › Review before sending), send `r4-mega.html` from
  `http://<Mac mini's name>.local:8000/`: Review renders the 1 MB page within 1 s. Review's `<body data-rendered>`
  holds the milliseconds (Web Inspector), else time a screen recording. Change the title to "Edited (R4-mega)"
  before Send: the Reader shows that title. Record the milliseconds and the iPhone's model.
- [ ] **F11.1, F11.4** From Selection mode.
- [ ] **F26** Site access (Settings › Apps › Safari › Extensions).
- [ ] **F33** Safari's Paste callout.
- [ ] **F27.3** The VoiceOver run.

**The web sender in Safari** (now, HTTPS host):
- [ ] **F01.1** A link in C1–C4 with the page open; **F01.6** VoiceOver reads *{label}. {sentence}*, never the step
  line, and announces a label that changes.
- [ ] **F07.1** Flight mode: "Waiting for connection" under "Waiting to send (1)"; with the page open it goes within
  a minute of the network coming back; Safari has no Background Sync, so a closed page sends on its next open.
- [ ] **F09** A bookmark whose address is edited to the bookmarklet's `javascript:` text: on a news page it opens the
  web sender, which sends that page with its title; a reload does not send it again.
- [ ] **F16** Through an iPhone Shortcut, "See (https://en.wikipedia.org/wiki/Foo_(bar))." sends the whole address,
  with its closing parenthesis.
- [ ] **F26.3** "Installed as an app" stays "!" until the page is added to the Home Screen and opened from there.
- [ ] **F33** Paste and send: Safari's Paste callout first, then "Send {host}?" before anything goes.

### 3. Daylight Share on Rooted 2 (the Lab Inbox), with the Reader

**Wave 0** (now):
- [ ] **F00.1 (Inbox)** After set-up step 2 (a fresh install, and no `lab=` in the link): Settings' Lab card shows Lab
  on, and the log has `lab: hello caps=…` though nothing turned Lab on. Screenshot Settings. Skipped if Daylight
  Share was there at the baseline.
- [ ] **F00.1 (the Inbox's note)** This build has the Inbox's Wave 1 (K5), so `LAB_NOTE_ENABLED` is on: set-up step
  2's screenshot shows "Lab is on. New features to try are in Settings › Lab, where you can turn it off." with OK, on
  the Inbox. Tap OK ("Tapping on the DC-1"). It does not come back: not after leaving the app
  (`$D shell input keyevent KEYCODE_HOME`) and C1's start, nor after `lab=0` then `lab=1`. Screenshot after OK.
- [ ] **F17 (hello)** After set-up the log shows `lab: hello caps=st,tap,reader-link,cap-kind`. The setup link with
  `lab=0` gives `lab: hello lab=0`; `lab=1` a new hello. (F17.4 on each sender times this.)
- [ ] **cb57057** With the Reader in front and Documents = Ask, a PDF is announced at once on the "New items"
  channel (`$D shell dumpsys notification --noredact`), and Documents offers its three choices: Ask with a
  notification, Add to the library as a batch, Open as they arrive.
- [ ] **Hand-off workaround** With `docs=open`, three PDFs sent together (`sender.mjs send-pdf R4-a`, `R4-b`, `R4-c`)
  all import: the count line grows by 3, each hand-off starts a fresh task, about 25 s apart. Record each import
  time: round 2 lost one PDF in three.
- [ ] **Stillness** With the DC-1's own keyboard: Settings › Relay URL and the Daylight name come into view in one
  step when tapped and when the keyboard opens; the cursor does not blink; "Reset pairing?" (answer Cancel) and the
  role question appear without animating. Record with `$D shell screenrecord --time-limit 10 /data/local/tmp/r4.mp4`.
- [ ] **F27.3** If TalkBack is on the DC-1: an item arriving on the Inbox is announced at each state change.

**Wave 1** (now):
- [ ] **F03.4** Each row's kind line, then " · from {from}": "Page as you saw it" (`sender.mjs send-page`), "Link
  (the Reader downloads it)" (the command line), "Document · {MB} MB" (a PDF), "Excerpt" (Chromium's Send selection),
  "Test article" (a phone's Setup check). TalkBack reads it with the title.
- [ ] **F01 (Sender sees)** For a link and a PDF, the item's details line "Sender sees: …" matches the sender's row
  at each step: waiting, kept for later, handed, in the Reader. The Android phone now; the iPhone after A4.
- [ ] **F15.1** In C3 with Documents = Ask, on the e-paper shade: Add to Reader gives `reader` for a link and
  `handed` for a PDF; Keep for later gives `held`; swiping the notice away gives `held`. In C2, Dismiss on a "Saved
  to the Reader" notice gives no new state. Several arrivals share one notice. TalkBack reads each notice's title
  and source. Check each state: `sender.mjs wait-lab 90 <id>=held`.
- [ ] **F15.2** Stop Daylight Share from the shade's "Active apps": the warning card shows on the next open (unless
  opening it restarted the service), "Instant delivery stopped" arrives within 15 minutes, and its Turn on starts it
  again.
- [ ] **F15.3** With the three animation scales at 0 (`$D shell settings put global window_animation_scale 0`, and
  the other two), the Inbox, What's in Lab and Setup check look as with them on, and no state is shown by colour
  alone. Put the old values back.
- [ ] **F15.4** Keep for later on a link's card: the sender shows "Kept for later on your Daylight". Add to Reader
  then gives "In your Reader ✓".
- [ ] **Quiet hours** On, between 22:00 and 07:00 by the DC-1's clock: nothing pops up or sounds, and items still
  arrive. Run it at night; never change the tablet's clock.
- [ ] **F26.1** Setup check › Test the Reader hand-off, with the Inbox in front, reaches the Reader and shows "✓ In
  your Reader". Setup check opens with
  `$D shell am start -n com.daylight.share/.ui.MainActivity --es com.daylight.share.extra.LAB_PAGE SETUP`.
- [ ] **F26.3** Each unmet check's button opens the right screen: the channel's settings, "Display over other apps",
  the battery list.
- [ ] **Read-later check** (F26.3, LAB-PLAN 1.6) Write down the Reader's own name for the setting that "Open the
  Reader’s settings, allow pages from other apps, …" points to. A mismatch goes to the share lane. Test the Reader
  hand-off then ticks the line again. Put the Reader's setting back.
- [ ] **F11.4** An excerpt of a page already in the Reader, from Chromium's Send selection and from the phone's Send
  as excerpt, is a new document, not "already in your library".
- [ ] **Open setting in landscape** (1.5) With `settings put system accelerometer_rotation 0` and `user_rotation 1`:
  Setup check's Open setting for Instant delivery and for the Reader opens the Inbox screen or Settings with that
  setting and its footer in view, and TalkBack starts there. The same for Arrival notices' row. Rotation back.

**After R1** (R1). The Reader session installs and drives the Lab Reader; this round checks Daylight Share's side
(card K6). Ask the Reader session for each step on the Lab Reader.
- [ ] **R1.4** After Take over, Daylight Share shows "Daylight Reader (lab) receives for this Daylight now." in
  Settings › Lab and on the Inbox, and polls nothing for 20 minutes: the log shows only "poll skipped", no live
  connection, and Instant delivery's notice is gone. The Reader's switch off: Daylight Share receives again at its
  next poll (within 15 minutes, or at once when opened).
- [ ] **Handover outlives Lab off** (1.3) While the Lab Reader receives, turning Daylight Share's Lab off keeps the
  handover line, and no item arrives in both libraries.
- [ ] **The calling package** Take over gets the pairing while armed, and `not-armed` after 2 minutes.
  `$D shell content call --uri content://com.daylight.share.handover --method pairing` gets nothing.
- [ ] **Package visibility** With the Lab Reader installed, the Lab card's row shows. Disabled by the Reader session:
  "Can’t reach Daylight Reader (lab) right now." and no resume. Uninstalled: resume at the next poll.
- [ ] **TalkBack** reads the row, the step after it and the "Can’t reach" sentence, at Comfort's largest text too.
- R1.1–R1.6 themselves are the Reader session's (LAB-PLAN 5.3). R1.3 needs the iPhone and the Mac: "In your
  Reader ✓" for a link, a page and a PDF.

### 4. Android phone (or the emulator)

`P="adb -s <phone serial>"`. Pair it as a sender with the setup link and `role=sender`.

**Wave 0** (now):
- [ ] **F27.3** [phone] A TalkBack run of pair → send → delivered → "In your Reader ✓" announces each state change.
- [ ] **Comfort pairing** A pairing link scanned with the camera, with Comfort on: the pairing question is as large
  as the rest of the app.
- [ ] **Stillness** The DC-1's keyboard checks above, on the phone with Comfort on.

**Wave 1** (now):
- [ ] **F01.1, F01.2, F01.3** A link in C1–C4, a PDF with Documents = Ask, the header, and a send with the DC-1
  offline, as on the Mac.
- [ ] **F01.6** [phone] TalkBack reads each row as "{label}. {sentence}", with no step count; the step line shows
  only on the newest row and on rows that are not final.
- [ ] **F03.3** The first bare link shared from Chrome shows, once: "Only the link came through. For pages behind a
  login, send from your computer’s browser with the Send to Daylight extension." Setup check lists it afterwards.
- [ ] **F04.4** From Chrome, the card closes within 1 s of the countdown, and the upload completes with the app
  swiped away from Recents.
- [ ] **F04.5** [phone] With TalkBack on, the card opens with Options and Send and reads "Sending to Rooted 2". The
  same with Switch Access on.
- [ ] **F04.6** [phone] A real ntfy.sh 413 after the card closed (the phone on mobile data, its attachment allowance
  used up by a large file): the "Send results" notice comes, and tapping it opens the row, also from a cold start.
  The permission question comes after the first share in place.
- [ ] **F04 (Back while a file copies)** [phone] Share a 9 MB PDF from Google Drive and press Back (button and
  gesture) right after the countdown: the card stays until the item is in the outbox, then closes, and the row is on
  the home screen. The same after swiping the sharing app away while the card says "Sending to Rooted 2".
- [ ] **F27.4** [phone] With Comfort and the largest text on a small phone, the share card with Options and the
  automation sheet scroll, Send and Close (Cancel) can be reached, and on Android 15 the title field stays above the
  keyboard. With TalkBack, swiping through the card never lands outside it.
- [ ] **F07.1** In flight mode a share reads "Waiting for connection"; back online it goes within a minute, with the
  app open and with it closed.
- [ ] **F08.1, F08.2** [phone] (Android 13 and 14) After one send, the Daylight's name is in Chrome's Direct Share
  row; tapping it sends with no other screen. Unpair removes it. `$P shell cmd shortcut get-shortcuts --user 0
  com.daylight.share` keeps the id `daylight` across an update (`$P install -r` a newer build).
- [ ] **F09** `$P shell am start -a com.daylight.share.action.SEND_URL --es android.intent.extra.TEXT
  https://example.com/?r4=intent` shows the sheet. A `daylightshare://send` link on a web page asks too. The sheet's
  note › Open setting opens What's in Lab at "Allow quick sends from other apps" with its footer, and TalkBack starts
  there.
- [ ] **F33.1** (Android 10 and later) Copy a link in Chrome and switch back: the chip shows. The same from a cold
  start, and after pulling the shade down and closing it.
- [ ] **F33.2** (Android 13) No "pasted from" toast before the chip is tapped.
- [ ] **F11.5** [phone] An NYT "headline + link" shared from the NYT app and from Chrome arrives as a link the Reader
  downloads. Chrome's Share of a selection (`#:~:text=`) arrives as a link unless sent with Send as excerpt.
- [ ] **F11.1, F11.2, F11.4** Options › Send as excerpt: one document with the quote, the source link and the date,
  new even for a page already in the Reader. Text with no link from a notes app: a Markdown note the Reader opens.
- [ ] **F16** [phone] Shares from Chrome and the Guardian, Substack, X and NYT apps arrive as links with the headline
  as the title and the tracking parameters gone. The Inbox's details read "Cleaned from {host}".
- [ ] **Diagnostics** Setup check › Copy diagnostics: no URL, title, pairing code, topic or Server code; `dls-…`,
  `www.…` and Server codes are redacted in any ASCII case.
- [ ] **F26.1, F26.3** The test article in C1–C4. Each unmet check's button opens the right screen.

**The web sender in Android Chrome** (now; `$P reverse tcp:8080 tcp:8080`):
- [ ] **F01.1** A link in C1–C4 with the page open; **F01.6** [phone] TalkBack reads *{label}. {sentence}*, never the
  step line.
- [ ] **F07.1** Flight mode: "Waiting for connection"; close the page while it waits, turn the network back on:
  Chrome's Background Sync sends it, and the next open shows it sent.
- [ ] **F16** The share sheet into the installed page, with Chrome's "Title\nURL" and a newsletter link with `utm_*`:
  a link with the headline as its title and the tracking gone. "See (https://en.wikipedia.org/wiki/Foo_(bar))." from
  a notes app sends the whole address.
- [ ] **F26.3** Open setting for "Installed as an app" opens Chrome's install prompt; Allow for "Storage kept by the
  browser" gets a ✓ where Chrome grants it.
- [ ] **F26 (install banner)** With Lab on and the page not installed, Chrome's own "Add to Home screen" still
  appears, and Setup check's Open setting opens the same prompt, also after the banner was dismissed.
- [ ] **F33** Paste and send asks "Send {host}?" before anything goes; text with no link says "No link on the
  clipboard."

### 5. Chrome: the extension and the web sender (Chromium on the Mac mini) [unlocked]

Unzip the artifact into `~/round4/chrome`, then
`open -na Chromium --args --user-data-dir="$HOME/round4/chrome-profile" --load-extension="$HOME/round4/chrome"`.
Grant the optional site access when asked, as round 2 did.

**The extension** (now):
- [ ] **F01.1** A link from the popup, left open, in C1–C4: "In your Reader ✓" within 45 s of "On your Daylight ✓".
- [ ] **F01.2** Documents = Ask: a PDF reads "Waiting for a tap on your Daylight" (badge ⌛), then "Handed to the
  Reader" and "The Reader doesn’t confirm documents yet." at the next check.
- [ ] **F01.3** The header reads "Your Daylight checked in N min ago"; with the DC-1 offline, sends still go out.
- [ ] **F03.1** [user] A page that needs the user's login (a subscribed news site) arrives whole, and the Reader
  shows the logged-in text.
- [ ] **F04 (PDF)** With "Send when I click the toolbar button" on, a PDF the page cannot fetch: Chrome's own prompt
  in the card, or "Allow and send" and "Send the link". Closing the popup at once sends the link with its sentence,
  also with the pairing page (`popup.html?standalone=1`) open in a tab; nothing more goes 3 s later.
- [ ] **F07.1** [user] Wi-Fi off: "Waiting for connection"; back on, it goes within a minute while Chromium runs.
  Best on a laptop: the Mac mini's network carries this session.
- [ ] **F10.1** Clean article on five real news sites keeps the body and drops navigation and footers.
- [ ] **F11.1, F11.4** Right-click › Send selection to Daylight: the quote, the source link and the date in the
  Reader; from a page already there, a new document.
- [ ] **F26.1** The test article in C1–C4, ticking "✓ Delivered" and "✓ In your Reader".
- [ ] **F26.3** Each unmet check's button opens the right place: the shortcuts page, pairing. With the button
  unpinned, "! Toolbar button" has Show steps; following its words pins the button, and the line reads "✓ Toolbar
  button" when Setup check opens again.
- [ ] **F33** Chromium asks for the clipboard permission on the first Paste and send; the host shows before anything
  is sent.
- [ ] **F34.2** The four shortcuts are at `chrome://extensions/shortcuts`. "dl example.com/story" in the address bar
  sends the link, and "dl see (https://en.wikipedia.org/wiki/Foo_(bar))." sends that address whole. The right-click
  entries are there; unticking one removes it.
- [ ] **F27.3** A VoiceOver run in Chromium of pair → send → delivered → in the Reader announces each change, with no
  step count.

**The web sender** (now; http://127.0.0.1:8080):
- [ ] **F01.1, F01.2, F01.3** As for the extension, with the page open.
- [ ] **F07.1** [user] As for the extension: with the page open it goes within a minute of the network coming back.
- [ ] **F09** The bookmarklet dragged to the bookmarks bar in Chromium, Firefox and Safari: on a news page it opens
  the web sender, which sends that page with its title; a reload does not send it again.
- [ ] **F26.1** The test article in C1–C4.
- [ ] **F26.3** "Installed as an app" opens Chromium's install prompt; "Storage kept by the browser" gets a ✓ where
  the browser grants it.
- [ ] **F33** Paste and send in Safari on the Mac and in Firefox: "Send {host}?" before anything goes; text with no
  link says "No link on the clipboard."

### 6. Windows [user]

On a Windows 10 or 11 PC with the setup artifact, paired with the code (W1, now):
- [ ] **F01.1** A link from Send To, the hotkey and a drop, in C1–C4, with the window open.
- [ ] **F01.2, F01.3** A PDF with Documents = Ask; the header, and a send with the DC-1 offline.
- [ ] **F01 (toast)** With the window closed to the notification area (and minimized), a link that reaches the Reader
  shows "In your Reader: {title}"; with the window open, none.
- [ ] **F01.6** Narrator and NVDA read each row as "{label}. {sentence}", with no step count, and say "In your
  Reader ✓: {title}" when a row gets there.
- [ ] **F02e.1** Dropping a 14 MB PDF (`make-pdf.mjs … 14000000`) shows the too-big sentence and "Send files over
  9 MB ›", whose note says the Daylight server is needed, with Copy Server code.
- [ ] **F07.1** Wi-Fi off: a link from the window, Send To and the hotkey reads "Waiting for connection" under
  "Waiting to send (n)"; back on, it goes within a minute.
- [ ] **F08** The notifications read "Sent to Rooted 2" with the item's name (and the site, for the hotkey).
- [ ] **F09** `daylightshare://send?url=…` clicked in Edge and in Chrome opens "Send to Rooted 2?"; Send sends it. A
  test page opening `…&quick=1` by itself still asks, with "Quick sends from other apps are off. …" and Open setting,
  which Narrator reads with the question. Open setting shows "Allow quick sends from other apps" with its footer,
  focused, also at 225% text with Comfort. With the switch on, it sends without asking, and the 11th in a minute asks
  again.
- [ ] **F16** Dragging "See (https://en.wikipedia.org/wiki/Foo_(bar))." from Edge, Word and Notepad onto the window
  sends the whole address, titled "See"; a link dragged from Edge's address bar is taken as given.
- [ ] **F26.1** The test article in C1–C4.
- [ ] **F26.3** With the app's notifications off, Setup check says "! Notifications" and Open Settings opens that
  page. Open setting on "Open at login", "Hotkey" and "Send to shortcut" opens the app's Settings at that setting.
- [ ] **F33.3** The tray menu reads "Send copied link" with Lab on and "Send clipboard link" with Lab off (or F33's
  Use switch off). Ctrl+Alt+D sends at once, and its notification names the site.

### 7. Usability pass [user]

On the iPhone and the Mac (LAB-PLAN 6.4). Run it on the builds at hand (W0 today), and again once A4 and A5 land.
The user does five short tasks unaided. Give each task in these words and nothing more; note the time taken and every
wrong turn.

1. Find Lab, turn it off, and turn it on again.
2. Tell whether a PDF just sent has reached the Reader.
3. Recover a failed send. Beforehand, move that device onto the mock relay and arm a 413 ("Forcing a 413"); move it
   back to ntfy.sh as the user recovers.
4. Find out what the Daylight server is for, and whether it is needed.
5. Send a copied link.

| Task | Device | Time | Wrong turns | Words the user stumbled on |
|---|---|---|---|---|
| 1 | Mac | m:ss | each wrong turn | the words |

The words the user stumbled on go to the copy review that follows the W0 pass (LAB-PLAN 0.1).

### 8. Finish

1. Restore the baseline (rule 5) and check the count line.
2. Write "Round 4 (date): results" after this section: a table per device, what was found (as rounds 1 and 2 did),
   what is still open, and the end line about the baseline and the lock.
3. Release the lock.
