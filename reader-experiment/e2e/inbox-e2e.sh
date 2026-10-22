#!/usr/bin/env bash
# Step 2 of the end-to-end test, on the emulator where reader-smoke.sh has installed the Reader. A "phone" (sender.mjs,
# the JS reference: protocol 1.1 with Lab Wave 0) sends through the mock relay, which runs with ntfy.sh's limits (2,097,152-byte
# attachments, 20 MB per uploader at a time); the Daylight Share Inbox receives each item, acks it and hands it to the
# Reader, and the Reader's library grows:
#  0.  a PDF over 9 MB is refused by the phone before anything is queued or sent;
#  1-4 a page, a link and a PDF with the Inbox in front, then a page while the Reader is in front (Instant delivery,
#      "Display over other apps", Documents = Open as they arrive);
#  5.  a 5 MB PDF: it travels as 3 attachments of at most 2 MiB and lands in the library;
#  6.  two PDFs about 20 s apart while the Reader is in front. Today's Reader drops a share that arrives while its
#      previous import is pending (DEVICE-CHECKS.md round 2); the Inbox spaces its import hand-offs. Both must land;
#  7.  Documents = Ask (setup link docs=ask, to=<the Reader>): a PDF that arrives while the Reader is in front waits,
#      announced by the card over the Reader and a notification; the card's "Add to Reader" hands it over;
#  8.  another one: the card's "Later", then a tap on its notification in the shade hands it over;
#  9.  Documents = Add to the library as a batch (docs=quiet, to= Automatic): a PDF goes as SEND_MULTIPLE;
#  and the phone sees every item delivered.
# Lab (LAB-PLAN F17, task E0): the phone is a Lab sender. Its ledger reads the Inbox's Lab frames on the ack topic
# (sender.mjs lab-states / wait-lab). Two old phones share the pairing: the v1.0 and v1.1 Senders as they shipped
# (E2E_PEER, the skew suite's fixtures in share/js/test/fixtures), so the F17.1 matrix runs against the real Inbox:
#  1b. each old phone sends a page, a link and a 300 KB PDF (one attachment): all reach the Reader and are acked among
#      the Inbox's Lab frames, and each row keeps its own words (a Lab Inbox changes nothing for apps in the field);
#  L1. after 1-3, the phone has the Inbox's hello (lab 1, caps st, tap, reader-link) and the states of the page
#      (reader), the link (reader, or queued without internet) and the PDF (handed);
#  10. Documents = Ask: the phone sees a PDF `waiting`; a root tap through HandoffActivity hands it over: `handed`;
#  11. no "Display over other apps" and the Reader in front: a link waits too (`waiting`, a notification alone); a
#      root tap hands it over: `reader`;
#  12. Lab off on the Inbox (setup link lab=0, Documents = Open): its one lab: 0 frame reaches the phone; a page, a link
#      and a PDF (send_file) get no state and show v1.1's rows; Lab on again: a hello, and still no state for them;
#  and at the end every item's last state is on the phone (the old phones' too: the Lab phone hears the states of
#  every item on the pairing), and the Inbox's Lab frames were at least 30 s apart.
# Usage: inbox-e2e.sh <daylight-share debug apk> <out dir>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/reader-lib.sh"
SHARE_APK="$1"; OUT="$2"; mkdir -p "$OUT"
export E2E_STATE="$OUT/sender-state.json"
SHARE_PKG=com.daylight.share
RELAY_LOCAL=http://127.0.0.1:8787
NTFY_ATTACHMENT_MAX=2097152
SENDER="$here/sender.mjs"
OLD_PHONES=(v1.0 v1.1)

fails=()
failed() { echo "FAIL: $*"; fails+=("$*"); }
sent=()
# The old phones' items: id -> v1.0 or v1.1.
declare -A old_of=()
# The Lab state the phone must end with, per item: reader (pages; links, or queued without internet), handed (PDFs),
# none (sent while the Inbox's Lab was off).
declare -A expect=()

node "$here/../share/js/mock-relay.mjs" --host 0.0.0.0 --port 8787 --attachment-max "$NTFY_ATTACHMENT_MAX" \
  --visitor-total 20000000 --control > "$OUT/relay.log" 2>&1 &
relay_pid=$!
finish() {
  curl -s "$RELAY_LOCAL/__mock/state" > "$OUT/relay-state.json" 2>/dev/null || true
  kill $relay_pid 2>/dev/null || true
  adb logcat -d -v threadtime -s DaylightShare:* ReaderImport:* ReaderReadLater:* ReaderShell:* > "$OUT/inbox-logcat.txt" 2>/dev/null || true
  adb logcat -d -v threadtime > "$OUT/logcat-all.txt" 2>/dev/null || true
}
trap finish EXIT
sleep 1

adb install -r -g "$SHARE_APK"
adb shell pm grant "$SHARE_PKG" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
adb shell appops set "$SHARE_PKG" SYSTEM_ALERT_WINDOW allow
adb logcat -G 16M 2>/dev/null || true
adb logcat -c

# ------------------------------------------------------------------------------------------------------------ helpers
count() { local n; n="$(reader_library_count || true)"; echo "${n:-0}"; }
inbox_log() { adb logcat -d -s DaylightShare:* 2>/dev/null | tr -d '\r'; }
front() { adb shell dumpsys activity activities 2>/dev/null | tr -d '\r' | grep -m1 -E 'topResumedActivity|mResumedActivity' | tr -s ' ' || true; }

# Waits until the Inbox log has a line matching $1 (grep basic regex; timeout $2 s); prints the first such line.
wait_log() {
  local re="$1" timeout="${2:-120}" waited=0 line
  while [ "$waited" -lt "$timeout" ]; do
    line="$(inbox_log | grep -m1 -e "$re" || true)"
    if [ -n "$line" ]; then echo "$line"; return 0; fi
    sleep 3; waited=$((waited + 3))
  done
  echo "nothing matching '$re' in the Inbox log after ${timeout}s; its last lines:" >&2; inbox_log | tail -25 >&2
  return 1
}

# The Inbox's hand-off of item $1 to the Reader (or its giving up), within $2 s.
wait_handoff() { wait_log "received $1 .*\(handed to\|kept in inbox\)" "${2:-120}"; }

# Puts the Reader in front (it usually is, after it opened a document).
reader_front() {
  if ! front | grep -q "$READER_PKG/"; then
    adb shell monkey -p "$READER_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
    sleep 5
  fi
  echo "in front: $(front)"
}

# The debug setup link again, with the same pairing, Instant delivery, and the extra parameters $1 (the Inbox comes
# to the front).
setup_inbox() {
  adb shell "am start -n $SHARE_PKG/.ui.MainActivity -a android.intent.action.VIEW -d 'daylightshare://setup?role=inbox&c=$code&r=http%3A%2F%2F10.0.2.2%3A8787&n=CI%20Daylight&instant=1$1'" >/dev/null
  sleep 5
  inbox_log | grep 'setup: role=' | tail -1 || true
}

send() { node "$SENDER" "$@"; }
# An old phone ($1 = v1.0 or v1.1): that Sender as it shipped, on the same pairing (no Lab ledger), with its own outbox.
old() { local v="$1"; shift; E2E_STATE="$OUT/phone-$v-state.json" E2E_PEER="$v" node "$SENDER" "$@"; }

# The old phone $1's rows: each of its items delivered, in its own words: v1.1's "Delivered ✓. Saved on your
# Daylight."; a v1.0 row, which had no shared words, its status alone.
check_old_rows() {
  local v="$1" rows id want words
  rows="$(old "$v" status || true)"; echo "$rows"
  if [ "$v" = v1.0 ]; then
    want=' delivered$'; words='"delivered" (v1.0 had no shared words)'
  else
    want=' delivered: Delivered ✓\. Saved on your Daylight\.$'; words="v1.1's \"Delivered ✓. Saved on your Daylight.\""
  fi
  for id in "${!old_of[@]}"; do
    if [ "${old_of[$id]}" = "$v" ] && ! echo "$rows" | grep -q "^$id [a-z]* [0-9]*$want"; then
      failed "the $v phone's row for $id is not $words"
    fi
  done
}

# Prints "x y" of the first node of package $2 whose text or content-desc matches $1 (a JS regex): from a uiautomator
# dump of every window (--windows: the card over the Reader takes no focus), else of the active window.
ui_find() {
  local opt
  for opt in --windows ""; do
    adb shell rm -f /sdcard/e2e-ui.xml >/dev/null 2>&1 || true
    timeout 45 adb shell uiautomator dump $opt /sdcard/e2e-ui.xml >/dev/null 2>&1 || continue
    adb exec-out cat /sdcard/e2e-ui.xml > "$OUT/ui-last.xml" 2>/dev/null || continue
    node "$here/ui-find.mjs" node "$OUT/ui-last.xml" "$1" "$2" && return 0
  done
  return 1
}

# Taps the first node of package $2 matching $1; returns 1 when there is none.
tap_text() {
  local xy
  xy="$(ui_find "$1" "$2")" || return 1
  echo "tap '$1' at $xy"
  adb shell input tap $xy
}

# Taps the card's "Add to Reader": found by uiautomator, else placed from the card's window frame.
tap_card_add() {
  if tap_text '^Add (all )?to Reader$' "$SHARE_PKG"; then return 0; fi
  adb shell dumpsys window windows 2>/dev/null | tr -d '\r' > "$OUT/windows.txt" || true
  local dpi xy
  dpi="$(adb shell wm density | tr -d '\r' | sed -n 's/.*: *\([0-9][0-9]*\).*/\1/p' | tail -1 || true)"
  xy="$(node "$here/ui-find.mjs" card-add "$OUT/windows.txt" "${dpi:-160}")" || return 1
  echo "tap the card's Add to Reader at $xy (placed from its window frame; uiautomator did not show it)"
  adb shell input tap $xy
}

# Restarts adbd as root ($1 = root) or as the shell user ($1 = unroot), and waits until a shell answers again.
adbd_as() {
  adb "$1" >/dev/null 2>&1 || true
  sleep 3
  local i
  for i in 1 2 3 4 5 6; do
    adb wait-for-device
    if adb shell true >/dev/null 2>&1; then break; fi
    sleep 2
  done
  echo "adbd: $1 (uid $(adb shell id -u 2>/dev/null | tr -d '\r'))"
}

# The README's debug hook for a notification's tap: on an emulator after adb root, start the (unexported) hand-off.
# adbd goes back to the shell user afterwards, so every later step runs as before (the Reader's adb hook included).
root_tap() {
  echo "tap through the debug hook (adb root; am start HandoffActivity --es mode one --es item $1)"
  adbd_as root
  local i ok=0
  for i in 1 2 3; do
    if adb shell am start -n "$SHARE_PKG/.inbox.HandoffActivity" --es mode one --es item "$1"; then ok=1; break; fi
    sleep 2
  done
  [ "$ok" = 1 ] || echo "the debug hook did not start"
  adbd_as unroot
}

# Seconds of the day of a threadtime log line ("10-20 18:06:40.177 ...").
logtime() { echo "$1" | awk '{ split($2, t, ":"); printf "%.1f\n", t[1] * 3600 + t[2] * 60 + t[3] }'; }

# ------------------------------------------------------------------------------------------------------------ pairing
before="$(count)"
echo "library before: $(reader_count_line)"

code="$(send pair "$RELAY_LOCAL")"
# The pairing only, so far: each old phone starts with the same secret and no rows.
for v in "${OLD_PHONES[@]}"; do cp "$E2E_STATE" "$OUT/phone-$v-state.json"; done
echo "pairing code: $code"
adb shell "am start -n $SHARE_PKG/.ui.MainActivity -a android.intent.action.VIEW -d 'daylightshare://setup?role=inbox&c=$code&r=http%3A%2F%2F10.0.2.2%3A8787&n=CI%20Daylight&instant=1&auto=1'"
sleep 6
shot "$OUT/10-inbox-paired.png"

# 0. Over 9 MB: refused on the phone with the shared sentence, nothing queued, nothing published.
echo "== 0. a 9.5 MB PDF is refused before sending"
send check-too-large 9500000 || failed "a PDF over 9 MB was not refused as too-large before sending"

# 1. An article page (the HTML travels with it): one more document.
echo "== 1. page, Inbox in front"
page1="$(send send-page one)"; sent+=("$page1"); expect[$page1]=reader; echo "sent page $page1"
wait_handoff "$page1" 120 || failed "no hand-off for the page $page1"
wait_library_at_least $((before + 1)) 90 || failed "the page $page1 did not reach the library"
sleep 3; shot "$OUT/11-after-page.png"

# 1b. The old phones on the same pairing (F17.1): the v1.0 and v1.1 Senders as they shipped, not today's module. Each
#     sends a page, a link and a 300 KB PDF (one attachment) with the Inbox in front. Every item reaches the Reader and
#     is acknowledged while the Inbox publishes Lab frames on the same ack topic, and each row keeps its own words.
for v in "${OLD_PHONES[@]}"; do
  echo "== 1b. the $v phone (as shipped) on the same pairing: a page, a link and a PDF, Inbox in front"
  adb shell "am start -n $SHARE_PKG/.ui.MainActivity" >/dev/null; sleep 2
  n="$(count)"
  id="$(old "$v" send-page "$v")"; old_of[$id]=$v; expect[$id]=reader; echo "sent page $id ($v phone)"
  wait_handoff "$id" 120 || failed "no hand-off for the $v phone's page $id"
  wait_library_at_least $((n + 1)) 90 || failed "the $v phone's page $id did not reach the library"
  n="$(count)"
  id="$(old "$v" send-url "https://example.org/?from=$v")"; old_of[$id]=$v; expect[$id]='reader|queued'; echo "sent link $id ($v phone)"
  wait_handoff "$id" 120 || failed "no hand-off for the $v phone's link $id"
  if wait_library_at_least $((n + 1)) 60; then echo "link saved"; else echo "link handed over but not saved (no internet on the emulator?)"; fi
  adb shell "am start -n $SHARE_PKG/.ui.MainActivity" >/dev/null; sleep 2
  n="$(count)"
  id="$(old "$v" send-pdf "$v" 300000 2> "$OUT/phone-$v-pdf.txt")" || { cat "$OUT/phone-$v-pdf.txt"; exit 1; }
  cat "$OUT/phone-$v-pdf.txt"
  [ "$(grep -c '^publish PUT ' "$OUT/phone-$v-pdf.txt" || true)" = 1 ] || failed "the $v phone's PDF $id did not go as one attachment"
  old_of[$id]=$v; expect[$id]=handed; echo "sent pdf $id ($v phone)"
  wait_handoff "$id" 120 || failed "no hand-off for the $v phone's PDF $id"
  wait_library_at_least $((n + 1)) 120 || failed "the $v phone's PDF $id did not reach the library"
  old "$v" wait-acks 3 120 || failed "the $v phone did not see its page, link and PDF delivered"
  check_old_rows "$v"
done
adb shell "am start -n $SHARE_PKG/.ui.MainActivity" >/dev/null; sleep 2 # 2 starts with the Inbox in front again

# 2. A plain link: the Reader fetches it itself (needs the emulator's internet; reported, not required).
echo "== 2. link, Inbox in front"
n="$(count)"
url1="$(send send-url https://example.org/)"; sent+=("$url1"); expect[$url1]='reader|queued'; echo "sent link $url1"
wait_handoff "$url1" 120 || failed "no hand-off for the link $url1"
if wait_library_at_least $((n + 1)) 60; then echo "link saved"; else echo "link handed over but not saved (no internet on the emulator?)"; fi

# 3. A PDF: the Reader imports it (and opens it, which puts the Inbox in the background).
echo "== 3. PDF, Inbox in front"
adb shell "am start -n $SHARE_PKG/.ui.MainActivity" >/dev/null; sleep 2
n="$(count)"
pdf1="$(send send-pdf one)"; sent+=("$pdf1"); expect[$pdf1]=handed; echo "sent pdf $pdf1"
wait_handoff "$pdf1" 120 || failed "no hand-off for the PDF $pdf1"
wait_library_at_least $((n + 1)) 120 || failed "the PDF $pdf1 did not reach the library"
sleep 5; shot "$OUT/12-after-pdf.png"
echo "in front: $(front)"

# L1. Lab (F17): the Inbox's hello and the states of the page, the link and the PDF reach the phone's ledger. Lab
# frames go at most one every 30 s, so this can take a minute.
echo "== L1. Lab: the Inbox's hello, and the states of the page, the link and the PDF on the phone"
send wait-lab 150 lab=1 caps=st,tap,reader-link "$page1=reader" "$url1=reader|queued" "$pdf1=handed" \
  || failed "the phone did not get the Inbox's Lab hello (lab 1, caps st,tap,reader-link) and the states reader (page $page1), reader or queued (link $url1) and handed (PDF $pdf1)"
inbox_log | grep -E 'lab: (hello|states|state )' || true

# 4. The Inbox is behind the Reader now: a second page must still arrive and be handed over without a tap.
echo "== 4. page, Reader in front"
n="$(count)"
page2="$(send send-page two)"; sent+=("$page2"); expect[$page2]=reader; echo "sent page $page2 (Inbox in the background)"
wait_handoff "$page2" 150 || failed "no background hand-off for the page $page2"
wait_library_at_least $((n + 1)) 120 || failed "the background page $page2 did not reach the library"
sleep 4; shot "$OUT/13-after-background-page.png"

# 5. A 5 MB PDF through a relay with ntfy.sh's 2,097,152-byte attachment limit: 3 parts, each under it.
echo "== 5. a 5 MB PDF in parts, Inbox in front"
adb shell "am start -n $SHARE_PKG/.ui.MainActivity" >/dev/null; sleep 2
n="$(count)"
big="$(send send-pdf big 5000000 2> "$OUT/big-publishes.txt")" || { cat "$OUT/big-publishes.txt"; exit 1; }
sent+=("$big"); expect[$big]=handed
cat "$OUT/big-publishes.txt"
big_size="$(sed -n 's/^pdf .*: \([0-9]*\) bytes$/\1/p' "$OUT/big-publishes.txt")"
parts="$(grep -c '^publish PUT ' "$OUT/big-publishes.txt" || true)"
over="$(awk -v max="$NTFY_ATTACHMENT_MAX" '/^publish / && ($3 > max || $5 != 200)' "$OUT/big-publishes.txt")"
echo "sent pdf $big: $big_size bytes as $parts attachments"
[ "$parts" = 3 ] && [ -z "$over" ] || failed "the 5 MB PDF did not go as 3 accepted attachments of at most $NTFY_ATTACHMENT_MAX bytes"
wait_log "received $big kind=file from=E2E phone size=$big_size stored" 120 || failed "the Inbox did not store the 5 MB PDF $big whole"
wait_handoff "$big" 120 || failed "no hand-off for the 5 MB PDF $big"
wait_library_at_least $((n + 1)) 120 || failed "the 5 MB PDF $big did not reach the library"
sleep 5; shot "$OUT/14-after-5mb-pdf.png"
sleep 20 # the Reader's import of the 5 MB PDF is done, and the first PDF below need not wait out the Inbox's gap

# 6. Two PDFs about 20 s apart while the Reader is in front: both must land (the Reader race the Inbox works around).
echo "== 6. two PDFs 20 s apart, Reader in front"
reader_front
n="$(count)"
( for i in $(seq -w 1 18); do shot "$OUT/20-race-$i.png"; sleep 4; done ) &
shots=$!
t0=$(date +%s)
pdfA="$(send send-pdf race-a)"; sent+=("$pdfA"); expect[$pdfA]=handed; echo "sent pdf $pdfA (Reader in front)"
lineA="$(wait_handoff "$pdfA" 120)" || { lineA=""; failed "race: no hand-off for the first PDF $pdfA"; }
echo "$lineA"
wait_s=$((20 - ($(date +%s) - t0))); [ "$wait_s" -gt 0 ] && sleep "$wait_s"
pdfB="$(send send-pdf race-b)"; sent+=("$pdfB"); expect[$pdfB]=handed; echo "sent pdf $pdfB $(($(date +%s) - t0)) s after the first"
lineB="$(wait_handoff "$pdfB" 150)" || { lineB=""; failed "race: no hand-off for the second PDF $pdfB"; }
echo "$lineB"
if wait_library_at_least $((n + 2)) 120; then
  race_ok=1
else
  race_ok=0
  failed "race: the library did not grow by 2 for $pdfA and $pdfB (it has $(count), wanted $((n + 2)))"
fi
kill $shots 2>/dev/null || true; wait $shots 2>/dev/null || true
shot "$OUT/21-after-race.png"
adb logcat -d -v threadtime -s DaylightShare:* ReaderImport:* ActivityTaskManager:I 2>/dev/null | tr -d '\r' > "$OUT/race-logcat.txt" || true
echo "--- race: the Inbox's hand-offs ---"
inbox_log | grep -E "$pdfA|$pdfB|documents:|hand-off:|links:" | tail -20 || true
if [ -n "$lineA" ] && [ -n "$lineB" ]; then
  echo "race: the second hand-off started $(awk -v a="$(logtime "$lineA")" -v b="$(logtime "$lineB")" 'BEGIN { printf "%.1f", b - a }') s after the first"
fi
if [ "$race_ok" = 0 ]; then
  echo "--- race: the Reader's import and activity starts ---"
  grep -E 'ReaderImport|START .*daylightcomputer\.reader|daylightcomputer\.reader.*(onNewIntent|finish)' "$OUT/race-logcat.txt" | tail -40 || true
  echo "library: $(reader_count_line)"; echo "in front: $(front)"
  echo "(screenshots 20-race-*.png and race-logcat.txt are in the e2e-screens artifact)"
fi

# 7. Documents = Ask: the PDF waits while the Reader is in front; the card over the Reader and a notification say so.
echo "== 7. Documents = Ask: the card's Add to Reader"
setup_inbox "&docs=ask&to=$READER_PKG"
reader_front
n="$(count)"
pdfC="$(send send-pdf ask-card)"; sent+=("$pdfC"); expect[$pdfC]=handed; echo "sent pdf $pdfC (Reader in front, Documents = Ask)"
if lineC="$(wait_log "received $pdfC kind=file -> waiting for a tap" 90)"; then
  echo "$lineC"
  echo "$lineC" | grep -q 'waiting for a tap (card + notification) docs=ask' || failed "$pdfC was not announced by both the card and a notification"
else
  failed "$pdfC was not announced as waiting for a tap"
fi
if inbox_log | grep "received $pdfC .*handed to" >/dev/null; then failed "$pdfC was handed over without a tap (Documents = Ask)"; fi
sleep 2
card="$(adb shell dumpsys window windows 2>/dev/null | tr -d '\r' | grep -E 'Window\{[0-9a-f]+ u0 Daylight Share\}' || true)"
echo "card window: $(echo "${card:-none}" | head -1 | tr -s ' ')"
shot "$OUT/30-card-over-reader.png"
tap_card_add || { echo "the card's Add to Reader was not found"; root_tap "$pdfC"; }
cp "$OUT/ui-last.xml" "$OUT/30-card-ui.xml" 2>/dev/null || true
if lineC="$(wait_handoff "$pdfC" 120)"; then
  echo "$lineC"
  echo "$lineC" | grep -q 'docs=ask by=card' || echo "note: $pdfC was handed over, but not through the card"
else
  failed "no hand-off for $pdfC after the tap"
fi
wait_library_at_least $((n + 1)) 120 || failed "$pdfC did not reach the library after the tap"
sleep 4; shot "$OUT/31-after-card-tap.png"

# 8. Another one: "Later" takes the card down; the notification stays in the shade, and its tap hands the PDF over.
echo "== 8. Documents = Ask: Later, then the notification"
reader_front
n="$(count)"
pdfD="$(send send-pdf ask-notification)"; sent+=("$pdfD"); expect[$pdfD]=handed; echo "sent pdf $pdfD (Reader in front, Documents = Ask)"
if lineD="$(wait_log "received $pdfD kind=file -> waiting for a tap" 90)"; then
  echo "$lineD"
  echo "$lineD" | grep -q 'waiting for a tap (card + notification) docs=ask' || failed "$pdfD was not announced by both the card and a notification"
else
  failed "$pdfD was not announced as waiting for a tap"
fi
sleep 2; shot "$OUT/32-card-again.png"
if tap_text '^Later$' "$SHARE_PKG"; then
  wait_log "card: later for .*$pdfD" 15 || failed "the card's Later did not log for $pdfD"
else
  echo "note: the card's Later was not found"
fi
adb shell cmd statusbar expand-notifications >/dev/null 2>&1 || true
sleep 3; shot "$OUT/33-shade.png"
# The notification's title, or its text when the shade shows it expanded (never the card's own words: SystemUI's nodes).
if ! tap_text 'Test PDF \(ask-notification\)' com.android.systemui; then
  echo "the notification was not found in the shade"
  adb shell cmd statusbar collapse >/dev/null 2>&1 || true
  root_tap "$pdfD"
fi
if lineD="$(wait_handoff "$pdfD" 120)"; then
  echo "$lineD"
  echo "$lineD" | grep -q 'docs=ask by=tap' || failed "$pdfD was handed over, but not by a tap"
else
  failed "no hand-off for $pdfD after the tap"
fi
adb shell cmd statusbar collapse >/dev/null 2>&1 || true
wait_library_at_least $((n + 1)) 120 || failed "$pdfD did not reach the library after the tap"
sleep 4; shot "$OUT/34-after-notification-tap.png"

# 9. Documents = Add to the library as a batch: handed over without a tap, as SEND_MULTIPLE even for one document.
echo "== 9. Documents = Add to the library as a batch"
setup_inbox "&docs=quiet&to="
reader_front
n="$(count)"
pdfE="$(send send-pdf quiet)"; sent+=("$pdfE"); expect[$pdfE]=handed; echo "sent pdf $pdfE (Reader in front, Documents = batch)"
if lineE="$(wait_handoff "$pdfE" 120)"; then
  echo "$lineE"
  echo "$lineE" | grep -q 'via send_multiple status=sent docs=quiet by=auto' || failed "$pdfE was not handed over as a batch without a tap"
else
  failed "no hand-off for $pdfE"
fi
wait_library_at_least $((n + 1)) 120 || failed "$pdfE did not reach the library"
sleep 4; shot "$OUT/35-after-batch.png"

# 10. Lab, Documents = Ask: the phone sees the PDF waiting for a tap, then a root tap through HandoffActivity (the
#     README's debug hook for a notification's tap) hands it over, and the phone sees it handed.
echo "== 10. Lab, Documents = Ask: waiting on the phone, a root tap, then handed"
setup_inbox "&docs=ask&to=$READER_PKG"
reader_front
n="$(count)"
pdfF="$(send send-pdf ask-root)"; sent+=("$pdfF"); expect[$pdfF]=handed; echo "sent pdf $pdfF (Reader in front, Documents = Ask)"
if lineF="$(wait_log "received $pdfF kind=file -> waiting for a tap" 90)"; then echo "$lineF"; else failed "$pdfF was not announced as waiting for a tap"; fi
send wait-lab 120 "$pdfF=waiting" || failed "the phone did not see $pdfF waiting for a tap"
if inbox_log | grep "received $pdfF .*handed to" >/dev/null; then failed "$pdfF was handed over without a tap (Documents = Ask)"; fi
shot "$OUT/36-ask-waiting.png"
root_tap "$pdfF"
if lineF="$(wait_handoff "$pdfF" 120)"; then
  echo "$lineF"
  echo "$lineF" | grep -q 'docs=ask by=tap' || failed "$pdfF was handed over, but not by the tap"
else
  failed "no hand-off for $pdfF after the root tap"
fi
wait_library_at_least $((n + 1)) 120 || failed "$pdfF did not reach the library after the tap"
send wait-lab 120 "$pdfF=handed" || failed "the phone did not see $pdfF handed to the Reader"
sleep 4; shot "$OUT/37-after-root-tap.png"

# 11. Lab, no "Display over other apps", the Reader in front: the Inbox cannot start the Reader from the background,
#     so a link waits for a tap too (a notification alone, no card). The phone sees it waiting; a root tap hands it
#     over (SAVE_PAGE), and the phone sees it in the Reader.
echo "== 11. Lab, overlay permission off, Reader in front: a link waits, a root tap, then reader"
adb shell appops set "$SHARE_PKG" SYSTEM_ALERT_WINDOW deny
reader_front
url2="$(send send-url https://example.net/)"; sent+=("$url2"); expect[$url2]='reader|queued'; echo "sent link $url2 (Reader in front, no overlay permission)"
if lineL="$(wait_log "received $url2 kind=url -> waiting for a tap" 90)"; then
  echo "$lineL"
  echo "$lineL" | grep -q 'waiting for a tap (notification)$' || failed "$url2 was not announced by a notification alone"
else
  failed "the link $url2 was not announced as waiting for a tap"
fi
send wait-lab 120 "$url2=waiting" || failed "the phone did not see the link $url2 waiting for a tap"
if inbox_log | grep "received $url2 .*handed to" >/dev/null; then failed "$url2 was handed over without a tap or the overlay permission"; fi
shot "$OUT/38-link-waiting.png"
root_tap "$url2"
if lineL="$(wait_handoff "$url2" 120)"; then
  echo "$lineL"
  echo "$lineL" | grep -q 'via save_page .* by=tap' || failed "$url2 was handed over, but not through SAVE_PAGE by the tap"
else
  failed "no hand-off for the link $url2 after the root tap"
fi
send wait-lab 120 "$url2=reader|queued" || failed "the phone did not see the link $url2 in the Reader"
adb shell appops set "$SHARE_PKG" SYSTEM_ALERT_WINDOW allow
sleep 3; shot "$OUT/39-after-link-tap.png"

# 12. Lab off on the Inbox: one lab: 0 frame, which the phone reads as "Lab off"; a page, a link and a PDF then get no
#     state (their rows on the phone are v1.1's). Documents = Open as they arrive, so the PDF goes through
#     HandoffActivity's send_file path. Lab on again: a hello, and still no state for those items.
echo "== 12. Lab off on the Inbox (a page, a link and a PDF), then on again"
setup_inbox "&docs=open&to=&lab=0"
wait_log "lab: hello lab=0" 90 || failed "the Inbox did not send its lab: 0 frame when Lab was turned off"
send wait-lab 120 lab=0 || failed "the phone did not see the Inbox's Lab turned off"
n="$(count)"
pageOff="$(send send-page lab-off)"; sent+=("$pageOff"); expect[$pageOff]=none; echo "sent page $pageOff (the Inbox's Lab off)"
wait_handoff "$pageOff" 120 || failed "no hand-off for the page $pageOff with the Inbox's Lab off"
wait_library_at_least $((n + 1)) 90 || failed "the page $pageOff did not reach the library with the Inbox's Lab off"
n="$(count)"
urlOff="$(send send-url 'https://example.com/?lab=off')"; sent+=("$urlOff"); expect[$urlOff]=none; echo "sent link $urlOff (the Inbox's Lab off)"
wait_handoff "$urlOff" 120 || failed "no hand-off for the link $urlOff with the Inbox's Lab off"
if wait_library_at_least $((n + 1)) 60; then echo "link saved"; else echo "link handed over but not saved (no internet on the emulator?)"; fi
adb shell "am start -n $SHARE_PKG/.ui.MainActivity" >/dev/null; sleep 2
n="$(count)"
pdfOff="$(send send-pdf lab-off)"; sent+=("$pdfOff"); expect[$pdfOff]=none; echo "sent pdf $pdfOff (the Inbox's Lab off, Documents = Open)"
if lineO="$(wait_handoff "$pdfOff" 120)"; then
  echo "$lineO"
  echo "$lineO" | grep -q 'via send_file .*docs=open' || failed "the PDF $pdfOff was not handed over through send_file with the Inbox's Lab off"
else
  failed "no hand-off for the PDF $pdfOff with the Inbox's Lab off"
fi
wait_library_at_least $((n + 1)) 120 || failed "the PDF $pdfOff did not reach the library with the Inbox's Lab off"
for id in "$pageOff" "$urlOff" "$pdfOff"; do
  if inbox_log | grep "lab: state $id" >/dev/null; then failed "the Inbox recorded a Lab state for $id with Lab off"; fi
done
# Delivered, with the Inbox's Lab off: the phone shows v1.1's rows (LAB-PLAN 2.5 rule 4).
if send wait-acks "${#sent[@]}" 120 >/dev/null; then
  offRows="$(send lab-states "$pageOff" "$urlOff" "$pdfOff" || true)"; echo "$offRows"
  for row in "$pageOff page" "$urlOff url" "$pdfOff file"; do
    echo "$offRows" | grep -q "^$row none: Delivered ✓. Saved on your Daylight.$" \
      || failed "with the Inbox's Lab off, the phone's row for ${row% *} is not v1.1's \"Delivered ✓. Saved on your Daylight.\""
  done
else
  failed "the page, link and PDF sent with the Inbox's Lab off were not all acknowledged"
fi
setup_inbox "&lab=1"
send wait-lab 120 lab=1 caps=st,tap,reader-link "$pageOff=none" "$urlOff=none" "$pdfOff=none" \
  || failed "the phone did not get the Inbox's hello after Lab was turned on again, or an item sent with Lab off got a state"

# ------------------------------------------------------------------------------------------------------------ results
echo "== the phone's view"
send wait-acks "${#sent[@]}" 150 || failed "the phone did not see all ${#sent[@]} items delivered"
send status || true

# Lab (F17): every item's last state is on the phone, the old phones' items included; the items sent while the Inbox's
# Lab was off have none.
echo "== Lab: every item's last state on the phone"
wants=()
for id in "${!expect[@]}"; do wants+=("$id=${expect[$id]}"); done
send wait-lab 180 lab=1 "${wants[@]}" || failed "the phone did not end with every item's Lab state"

for v in "${OLD_PHONES[@]}"; do
  echo "== the $v phone's view"
  k=0
  for id in "${!old_of[@]}"; do if [ "${old_of[$id]}" = "$v" ]; then k=$((k + 1)); fi; done
  old "$v" wait-acks "$k" 120 || failed "the $v phone did not see its $k items delivered"
  check_old_rows "$v"
done

inbox_log > "$OUT/inbox-log.txt" || true
echo "--- hand-offs ---"; grep -E "handed to|kept in inbox|waiting for a tap|card: later" "$OUT/inbox-log.txt" || true
for id in "${sent[@]}" "${!old_of[@]}"; do
  if grep -q "received $id .*handed to $READER_PKG" "$OUT/inbox-log.txt"; then echo "ok   $id"; else failed "no hand-off to the Reader for $id"; fi
done

# The Inbox's Lab frames (2.2.4): what went, and at least 30 s apart. Each line is logged after its publish, which
# may take longer than the one before (a relay retry waits 1-4 s), so this fails below 25 s; a frame that skipped
# the spacing would follow the one before within a few seconds.
echo "--- the Inbox's Lab frames ---"
grep -E 'lab: (hello|states n=)' "$OUT/inbox-log.txt" || true
echo "Lab frames: $(grep -c 'lab: hello caps=' "$OUT/inbox-log.txt" || true) hellos, $(grep -c 'lab: states n=' "$OUT/inbox-log.txt" || true) state frames, $(grep -c 'lab: hello lab=0' "$OUT/inbox-log.txt" || true) lab: 0"
prev=""
while IFS= read -r line; do
  t="$(logtime "$line")"
  if [ -n "$prev" ]; then
    gap="$(awk -v a="$prev" -v b="$t" 'BEGIN { d = b - a; if (d < 0) d += 86400; printf "%.1f", d }')"
    if awk -v g="$gap" 'BEGIN { exit !(g < 25) }'; then failed "two Lab frames only $gap s apart (at least 30 s): $line"; fi
  fi
  prev="$t"
done < <(grep -E 'lab: (hello|states n=)' "$OUT/inbox-log.txt" || true)
grep -q "handed to com.daylightcomputer.readerexperiment" "$OUT/inbox-log.txt" && failed "something went to the side-by-side copy"
echo "relay: $(curl -s "$RELAY_LOCAL/__mock/state" || true)"

# The Inbox's list (reported): "In your Reader ✓" where the Reader confirmed the save (pages, links), "Handed to the
# Reader" where it cannot (documents). The list starts below the pairing code, so scroll until it shows.
adb shell "am start -n $SHARE_PKG/.ui.MainActivity" >/dev/null 2>&1 || true; sleep 4
labels=""
for scroll in 0 1 2 3 4 5; do
  [ "$scroll" = 0 ] || { adb shell input swipe 160 560 160 140 400 >/dev/null 2>&1 || true; sleep 2; }
  timeout 45 adb shell uiautomator dump /sdcard/e2e-ui.xml >/dev/null 2>&1 || continue
  adb exec-out cat /sdcard/e2e-ui.xml > "$OUT/41-inbox-items.xml" 2>/dev/null || continue
  confirmed="$(grep -o 'In your Reader ✓' "$OUT/41-inbox-items.xml" | wc -l || true)"
  handed="$(grep -o 'Handed to the Reader' "$OUT/41-inbox-items.xml" | wc -l || true)"
  if [ $((confirmed + handed)) -gt 0 ]; then
    labels="on screen after $scroll scrolls: $confirmed x In your Reader ✓, $handed x Handed to the Reader"
    break
  fi
done
echo "the Inbox's item labels: ${labels:-not found on screen (41-inbox-items.png)}"
shot "$OUT/41-inbox-items.png"
adb shell monkey -p "$READER_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true; sleep 5
shot "$OUT/40-reader-library.png"
echo "library after: $(reader_count_line) (before: $before)"

if [ "${#fails[@]}" -gt 0 ]; then
  echo "FAILED (${#fails[@]}):"; printf '  - %s\n' "${fails[@]}"
  exit 1
fi
echo "OK: page, link, PDF, background page, a 5 MB PDF in 3 parts, two PDFs 20 s apart, Ask (card and notification) and batch reached the Reader and were acknowledged; the v1.0 and v1.1 phones as shipped delivered a page, a link and a PDF each, unchanged; Lab: the hello, every item's state on the phone (waiting, then handed or reader after a tap; none for a page, a link and a PDF with the Inbox's Lab off)"
