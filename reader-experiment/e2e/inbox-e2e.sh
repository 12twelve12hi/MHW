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
# Lab Wave 1 (LAB-PLAN E1; the Inbox's K5 and the phone's K4):
#  13. F15, arrival notices: with Documents = Ask, no "Display over other apps" and the Reader in front, a link and a
#      PDF each wait with one notice (Add to Reader, Keep for later). Add to Reader in the shade gives `reader` for the
#      link and `handed` for the PDF; Keep for later and a swipe give `held`, the phone reads "Kept for later on your
#      Daylight", opening the Inbox hands neither over, and Add to Reader then does (F15.4);
#  14. F11: an excerpt of a page already in the Reader (an explicit selection, x-cap "excerpt") and a note without a
#      link arrive as new documents (send_file; the library grows by one each), `handed`;
#  15. F15: a link saved by itself gets one "Saved to the Reader" notice; its Dismiss records no state;
#  16. F26: Setup check's "Test the Reader hand-off" on the Inbox reaches the Reader ("✓ In your Reader"), no state;
#  17. this emulator's Daylight Share as the phone on the same pairing (setup link role=sender): an NYT headline +
#      link from the share sheet goes as a link (F11.5, Q1: classifyShare), exactly as the JS reference sends it; the
#      share sheet's Direct Share shortcut is listed (F08) and a share through it goes; the relay answering 413 posts
#      "Couldn’t send ‘…’ to {name}" from the send worker after the card closed (F04.6); Options › Send as excerpt
#      goes as an excerpt (F11); back as the Inbox, the shortcut is gone and those items reach the Reader: the link
#      through SAVE_PAGE (`reader` or `queued`), the excerpt as a new document (`handed`).
#  And the Lab frames stay within the Inbox's daily cap, and everything published within ntfy.sh's daily messages.
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
# Items another sender on the pairing sent (this emulator's Daylight Share as the phone, pass 17): each must reach the
# Reader too.
others=()

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

# ---------------------------------------------------------------------------------------------- Lab Wave 1 helpers
# LAB_TEXT's words for id $1, {slots} filled from name=value arguments: the apps show them exactly so.
labtext() { node "$SENDER" lab-text "$@"; }
# A regex that matches exactly the text $1 (for ui-find.mjs, which takes JS regexes).
exactly() { printf '^%s$' "$(printf '%s' "$1" | sed 's#[][\.*^$?+(){}|/]#\\&#g')"; }

# Waits until the Inbox log has at least $2 lines matching $1 (grep basic regex; timeout $3 s); prints the last.
wait_count() {
  local re="$1" want="$2" timeout="${3:-60}" waited=0 n
  while [ "$waited" -lt "$timeout" ]; do
    n="$(inbox_log | grep -c -e "$re" || true)"
    if [ "${n:-0}" -ge "$want" ]; then inbox_log | grep -e "$re" | tail -1; return 0; fi
    sleep 2; waited=$((waited + 2))
  done
  echo "fewer than $want lines matching '$re' in the Inbox log after ${timeout}s" >&2
  return 1
}

# A uiautomator dump of every window (--windows: the shade, cards that take no focus), else of the active one, in
# $OUT/ui-last.xml.
ui_dump() {
  local opt
  for opt in --windows ""; do
    adb shell rm -f /sdcard/e2e-ui.xml >/dev/null 2>&1 || true
    timeout 45 adb shell uiautomator dump $opt /sdcard/e2e-ui.xml >/dev/null 2>&1 || continue
    adb exec-out cat /sdcard/e2e-ui.xml > "$OUT/ui-last.xml" 2>/dev/null && [ -s "$OUT/ui-last.xml" ] && return 0
  done
  return 1
}

screen_size() { adb shell wm size 2>/dev/null | tr -d '\r' | sed -n 's/.*: *\([0-9]*x[0-9]*\).*/\1/p' | tail -1; }

# Taps the first node of package $2 matching $1, scrolling the screen up to $3 times to find it; returns 1 when it is
# not there.
scroll_tap() {
  local re="$1" pkg="$2" tries="${3:-5}" i xy size w h
  size="$(screen_size)"; w="${size%x*}"; h="${size#*x}"; w="${w:-320}"; h="${h:-640}"
  for i in $(seq 0 "$tries"); do
    if ui_dump && xy="$(node "$here/ui-find.mjs" node "$OUT/ui-last.xml" "$re" "$pkg")"; then
      echo "tap '$re' at $xy"
      adb shell input tap $xy
      return 0
    fi
    [ "$i" -lt "$tries" ] || break
    adb shell input swipe $((w / 2)) $((h * 7 / 10)) $((w / 2)) $((h * 3 / 10)) 400 >/dev/null 2>&1 || true
    sleep 2
  done
  return 1
}

# Whether a node of package $2 matching $1 is on screen, scrolling up to $3 times to find it.
scroll_find() {
  local re="$1" pkg="$2" tries="${3:-5}" i size w h
  size="$(screen_size)"; w="${size%x*}"; h="${size#*x}"; w="${w:-320}"; h="${h:-640}"
  for i in $(seq 0 "$tries"); do
    if ui_dump && node "$here/ui-find.mjs" node "$OUT/ui-last.xml" "$re" "$pkg" >/dev/null; then return 0; fi
    [ "$i" -lt "$tries" ] || break
    adb shell input swipe $((w / 2)) $((h * 7 / 10)) $((w / 2)) $((h * 3 / 10)) 400 >/dev/null 2>&1 || true
    sleep 2
  done
  return 1
}

# Daylight Share's notices that are up, one key "0|<package>|<number>|<tag>|<uid>" a line (cmd notification list).
# Numbers: 9 an item waiting for a tap (tag: its id), 10 their summary; 11 "Saved to the Reader" (tag: its id), 12
# their summary.
share_notices() { adb shell cmd notification list 2>/dev/null | tr -d '\r' | grep -F "|$SHARE_PKG|" || true; }
# notice_up <id> <number>: item <id>'s notice of that number is up.
notice_up() { share_notices | grep -qF "|$SHARE_PKG|$2|$1|"; }
# How many notices of number $2 item $1 has up (F15.1: one).
notices_of() { share_notices | grep -cF "|$SHARE_PKG|$2|$1|" || true; }

# Snoozes, for an hour, every summary and "Saved to the Reader" notice of Daylight Share but item $1's, so its own
# notice comes first in the shade, where SystemUI shows the first one expanded with its actions. A waiting item's
# notice is never snoozed or swiped here: a swiped one is kept for later.
alone_in_shade() {
  local k
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    case "$k" in *"|$1|"*) continue ;; esac
    case "$k" in *"|$SHARE_PKG|10|"*|*"|$SHARE_PKG|11|"*|*"|$SHARE_PKG|12|"*) ;; *) continue ;; esac
    adb shell "cmd notification snooze --for 3600000 '$k'" >/dev/null 2>&1 || true
  done < <(share_notices)
}

# Opens the shade and taps the action matching $2 (a JS regex) on the notice whose text matches $1, from SystemUI's
# nodes. A notice shown collapsed is first expanded with its expand button, next to its title. Returns 1 when the
# action is not on screen (the shade is then closed).
shade_action() {
  local title="$1" action="$2" xy
  adb shell cmd statusbar expand-notifications >/dev/null 2>&1 || true
  sleep 3
  for _ in 1 2 3; do
    if ui_dump; then
      if xy="$(node "$here/ui-find.mjs" node "$OUT/ui-last.xml" "$action" com.android.systemui)"; then
        shot "$OUT/shade-$(date +%s).png"
        echo "tap '$action' on the notice '$title' in the shade at $xy"
        adb shell input tap $xy
        sleep 2
        adb shell cmd statusbar collapse >/dev/null 2>&1 || true
        return 0
      fi
      if xy="$(node "$here/ui-find.mjs" near "$OUT/ui-last.xml" "$title" 'expand_button$|^Expand' com.android.systemui)"; then
        echo "expand the notice '$title' at $xy"
        adb shell input tap $xy
      fi
    fi
    sleep 2
  done
  cp "$OUT/ui-last.xml" "$OUT/shade-missed-$(date +%s).xml" 2>/dev/null || true
  adb shell cmd statusbar collapse >/dev/null 2>&1 || true
  return 1
}

# Swipes the notice whose text matches $1 (a JS regex) away in the shade, across its title; returns 1 when it is not
# on screen.
shade_swipe() {
  local b t bt y size w
  adb shell cmd statusbar expand-notifications >/dev/null 2>&1 || true
  sleep 3
  if ! ui_dump || ! b="$(node "$here/ui-find.mjs" bounds "$OUT/ui-last.xml" "$1" com.android.systemui)"; then
    adb shell cmd statusbar collapse >/dev/null 2>&1 || true
    return 1
  fi
  read -r _ t _ bt <<< "$b"
  y=$(((t + bt) / 2))
  size="$(screen_size)"; w="${size%x*}"; w="${w:-320}"
  echo "swipe the notice '$1' away in the shade at y=$y"
  adb shell input swipe $((w * 15 / 100)) $y $((w * 95 / 100)) $y 250
  sleep 3
  adb shell cmd statusbar collapse >/dev/null 2>&1 || true
}

# Sends broadcast $2 for item $3 to Daylight Share's unexported receiver $1 as root (what a notice's action or swipe
# sends), when the shade did not show what to tap.
root_broadcast() {
  echo "broadcast $2 for $3 through the debug hook (adb root)"
  adbd_as root
  adb shell am broadcast -n "$SHARE_PKG/$1" -a "$2" -d "daylightshare-item:$3" || echo "the broadcast did not go"
  adbd_as unroot
}

# Daylight Share's shortcuts as Android lists them (F08), saved in $OUT/$1: `cmd shortcut get-shortcuts`, else its
# section of `dumpsys shortcut`.
list_shortcuts() {
  local f="$OUT/$1"
  adb shell cmd shortcut get-shortcuts --user 0 "$SHARE_PKG" 2>&1 | tr -d '\r' > "$f" || true
  if ! grep -q 'ShortcutInfo\|id=' "$f"; then
    { echo "--- dumpsys shortcut ---"; adb shell dumpsys shortcut 2>&1 | tr -d '\r' | sed -n "/Package: $SHARE_PKG/,/Package: /p"; } >> "$f" || true
  fi
  cat "$f"
}

# Shares $1 as text (with subject $2 when given) to Daylight Share's share target, as the share sheet does; extra
# `am start` arguments follow.
share_text() {
  local text="$1" subject="${2:-}"; shift 2 || shift $#
  adb shell "am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT '$text'${subject:+ --es android.intent.extra.SUBJECT '$subject'} $* -n $SHARE_PKG/.sender.ShareActivity" >/dev/null
}

# Opens the Inbox's Setup check (LAB-PLAN F26) through MainActivity's Lab page extra.
open_setup_check() {
  adb shell "am start -n $SHARE_PKG/.ui.MainActivity --es com.daylight.share.extra.LAB_PAGE SETUP" >/dev/null 2>&1 || true
  sleep 4
}

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
#    With Lab on the card's button says "Keep for later" (F15): the item is kept for later until its notice is tapped.
echo "== 8. Documents = Ask: Later (Keep for later with Lab on), then the notification"
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
if tap_text "^(Later|$(labtext arrivals.keepForLater))\$" "$SHARE_PKG"; then
  wait_log "card: later for .*$pdfD" 15 || failed "the card's Later (Keep for later) did not log for $pdfD"
else
  echo "note: the card's Later (Keep for later) was not found"
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

# ------------------------------------------------------------------------------------------ Lab Wave 1 (task E1)
# Every word looked for on screen and in notices is LAB_TEXT's, as the apps show it.
ADD_RE="$(exactly "$(labtext arrivals.addToReader)")"
KEEP_RE="$(exactly "$(labtext arrivals.keepForLater)")"
DISMISS_RE="$(exactly "$(labtext arrivals.dismiss)")"
OK_RE="$(exactly "$(labtext noteButton)")"
# The shade's actions that went through the shade, and those that needed the debug hook (reported at the end).
shade_ok=(); shade_hook=()
# `cmd notification list` answers here (Instant delivery's notice is up): the one-notice checks need it.
if share_notices | grep -q .; then notices_listed=1; else notices_listed=0; echo "note: cmd notification list shows no Daylight Share notice; the one-notice checks are reported only"; fi

# f15_wait <id> <url|file>: the Inbox announces the item as waiting for a tap, by a notification alone, with one
# notice (F15.1), and does not hand it over.
f15_wait() {
  local line k
  if line="$(wait_log "received $1 kind=$2 -> waiting for a tap (notification)" 90)"; then echo "$line"; else
    failed "$1 was not announced as waiting for a tap by a notification"; return 0
  fi
  sleep 2
  if [ "$notices_listed" = 1 ]; then
    k="$(notices_of "$1" 9)"
    [ "$k" = 1 ] || failed "$1 has $k notices waiting for a tap, not one (F15.1)"
  fi
  if inbox_log | grep "received $1 .*handed to" >/dev/null; then failed "$1 was handed over without a tap"; fi
}

# 13. F15 (K5): each action on a waiting item's notice publishes its state on the ack topic, and the phone reads it.
#     Documents = Ask, no "Display over other apps" and the Reader in front: links and documents both wait. One item
#     at a time, so its notice is the only one waiting and comes first in the shade, shown with its two actions.
echo "== 13. Lab, arrival notices (F15): Add to Reader, Keep for later and a swipe, each to its state"
setup_inbox "&docs=ask&to=$READER_PKG"
adb shell appops set "$SHARE_PKG" SYSTEM_ALERT_WINDOW deny

# a. A link: Add to Reader on its notice hands it over (SAVE_PAGE): `reader` (or `queued` without internet).
reader_front
f15add="$(send send-url 'https://example.com/?f15=add' 'F15 link to add')"; sent+=("$f15add"); expect[$f15add]='reader|queued'
echo "sent link $f15add (Reader in front, Documents = Ask, no overlay)"
f15_wait "$f15add" url
alone_in_shade "$f15add"
if shade_action 'F15 link to add' "$ADD_RE"; then shade_ok+=("Add to Reader (link)"); else
  echo "note: the notice's Add to Reader was not found in the shade"; shade_hook+=("Add to Reader (link)"); root_tap "$f15add"
fi
if line="$(wait_handoff "$f15add" 120)"; then
  echo "$line"; echo "$line" | grep -q 'via save_page .* by=tap' || failed "$f15add was handed over, but not through SAVE_PAGE by Add to Reader"
else
  failed "no hand-off for the link $f15add after Add to Reader"
fi

# b. A PDF: Add to Reader hands it over (send_file): `handed`; the library grows.
reader_front
n="$(count)"
f15doc="$(send send-pdf f15-add)"; sent+=("$f15doc"); expect[$f15doc]=handed; echo "sent pdf $f15doc"
f15_wait "$f15doc" file
alone_in_shade "$f15doc"
if shade_action 'Test PDF \(f15-add\)' "$ADD_RE"; then shade_ok+=("Add to Reader (PDF)"); else
  echo "note: the notice's Add to Reader was not found in the shade"; shade_hook+=("Add to Reader (PDF)"); root_tap "$f15doc"
fi
if line="$(wait_handoff "$f15doc" 120)"; then
  echo "$line"; echo "$line" | grep -q 'via send_file .*docs=ask by=tap' || failed "$f15doc was handed over, but not by Add to Reader"
else
  failed "no hand-off for the PDF $f15doc after Add to Reader"
fi
wait_library_at_least $((n + 1)) 120 || failed "the PDF $f15doc did not reach the library after Add to Reader"

# c. A link: Keep for later on its notice keeps it in the Inbox (`held`); the notice goes.
reader_front
f15keep="$(send send-url 'https://example.com/?f15=keep' 'F15 link to keep')"; sent+=("$f15keep"); expect[$f15keep]='reader|queued'
echo "sent link $f15keep"
f15_wait "$f15keep" url
alone_in_shade "$f15keep"
if shade_action 'F15 link to keep' "$KEEP_RE"; then shade_ok+=("Keep for later"); else
  echo "note: the notice's Keep for later was not found in the shade"; shade_hook+=("Keep for later")
  root_broadcast .inbox.ArrivalActionReceiver com.daylight.share.action.KEEP_FOR_LATER "$f15keep"
fi
wait_log "received $f15keep -> kept for later: waits in the Inbox" 30 || failed "Keep for later did not keep $f15keep for later"
sleep 2
if [ "$notices_listed" = 1 ] && notice_up "$f15keep" 9; then failed "the notice of $f15keep stayed after Keep for later"; fi

# d. A PDF: swiping its notice away keeps it for later too (`held`).
reader_front
f15swipe="$(send send-pdf f15-swipe)"; sent+=("$f15swipe"); expect[$f15swipe]=handed; echo "sent pdf $f15swipe"
f15_wait "$f15swipe" file
alone_in_shade "$f15swipe"
if shade_swipe 'Test PDF \(f15-swipe\)' && wait_log "received $f15swipe -> notification dismissed" 20; then shade_ok+=("swipe"); else
  echo "note: the notice could not be swiped away in the shade"; shade_hook+=("swipe")
  root_broadcast .inbox.NoticeDismissedReceiver com.daylight.share.action.NOTICE_DISMISSED "$f15swipe"
  wait_log "received $f15swipe -> notification dismissed" 30 || failed "swiping the notice of $f15swipe away did not keep it for later"
fi
shot "$OUT/50-after-f15-actions.png"

# The phone reads each action's state: reader (or queued), handed, held, held; and says "Kept for later on your
# Daylight" for the kept ones.
send wait-lab 150 "$f15add=reader|queued" "$f15doc=handed" "$f15keep=held" "$f15swipe=held" \
  || failed "the phone did not read Add to Reader (link, PDF), Keep for later and the swipe as reader or queued, handed, held and held"
heldWords="$(labtext rows.held.label). $(labtext rows.held.sentence)"
rows="$(send lab-states "$f15keep" "$f15swipe" || true)"; echo "$rows"
echo "$rows" | grep -qF "$f15keep url held: $heldWords" || failed "the phone does not say \"$heldWords\" for $f15keep"
echo "$rows" | grep -qF "$f15swipe file held: $heldWords" || failed "the phone does not say \"$heldWords\" for $f15swipe"

# Kept items wait for Add to Reader: opening the Inbox hands neither over (F15). Then Add to Reader does (F15.4; the
# notices are gone, so the tap is the debug hook's): the link reaches the Reader, the PDF is handed over.
adb shell "am start -n $SHARE_PKG/.ui.MainActivity" >/dev/null; sleep 10
for id in "$f15keep" "$f15swipe"; do
  if inbox_log | grep "received $id .*handed to" >/dev/null; then failed "$id, kept for later, was handed over when the Inbox opened"; fi
done
if scroll_find "$(exactly "$(labtext arrivals.keptForLater)")" "$SHARE_PKG" 3; then echo "the Inbox lists them as \"$(labtext arrivals.keptForLater)\""; else echo "note: \"$(labtext arrivals.keptForLater)\" was not found on the Inbox screen"; fi
shot "$OUT/51-inbox-kept.png"
root_tap "$f15keep"
if line="$(wait_handoff "$f15keep" 120)"; then echo "$line"; echo "$line" | grep -q 'via save_page .* by=tap' || failed "$f15keep was handed over, but not through SAVE_PAGE by the tap"; else failed "no hand-off for the kept link $f15keep after Add to Reader"; fi
root_tap "$f15swipe"
if line="$(wait_handoff "$f15swipe" 120)"; then echo "$line"; else failed "no hand-off for the kept PDF $f15swipe after Add to Reader"; fi
send wait-lab 150 "$f15keep=reader|queued" "$f15swipe=handed" \
  || failed "after Keep for later, Add to Reader did not give reader (or queued) for $f15keep and handed for $f15swipe (F15.4)"
rows="$(send lab-states "$f15keep" || true)"; echo "$rows"
if echo "$rows" | grep -q "^$f15keep url reader:"; then
  echo "$rows" | grep -qF "$f15keep url reader: $(labtext rows.reader.label). " || failed "the phone does not say \"$(labtext rows.reader.label)\" for $f15keep"
fi
adb shell appops set "$SHARE_PKG" SYSTEM_ALERT_WINDOW allow
echo "F15 actions through the shade: ${shade_ok[*]:-none}; through the debug hook: ${shade_hook[*]:-none}"

# 14. F11: an excerpt (an explicit selection: x-cap "excerpt", HTML with its source link and a #:~:text= fragment) of
#     a page already in the Reader, and a note without a link, each arrive as a new document (Documents = Open).
echo "== 14. Lab, excerpts (F11): an excerpt of a page already in the Reader, and a note, arrive as new documents"
setup_inbox "&docs=open&to="
for what in excerpt note; do
  adb shell "am start -n $SHARE_PKG/.ui.MainActivity" >/dev/null; sleep 2
  n="$(count)"
  if [ "$what" = excerpt ]; then
    id="$(send send-excerpt f11 "https://example.com/walden-one")" # an excerpt of pass 1's page
  else
    id="$(send send-excerpt f11-note)"
  fi
  sent+=("$id"); expect[$id]=handed; echo "sent $what $id"
  if line="$(wait_handoff "$id" 150)"; then
    echo "$line"; echo "$line" | grep -q 'kind=file -> handed to com.daylightcomputer.reader via send_file status=sent docs=open' \
      || failed "the $what $id was not handed over as a document (send_file)"
  else
    failed "no hand-off for the $what $id"
  fi
  wait_library_at_least $((n + 1)) 120 || failed "the $what $id did not import into the Reader as a new document (F11.4)"
done

# 15. F15: a link handed over by itself gets one "Saved to the Reader" notice; its Dismiss records no state.
echo "== 15. Lab, Saved to the Reader (F15): one notice for a link saved by itself; Dismiss records nothing"
adb shell "am start -n $SHARE_PKG/.ui.MainActivity" >/dev/null; sleep 2
f15saved="$(send send-url 'https://example.com/?f15=saved' 'F15 link saved by itself')"; sent+=("$f15saved"); expect[$f15saved]='reader|queued'
echo "sent link $f15saved (Inbox in front)"
if line="$(wait_handoff "$f15saved" 120)"; then echo "$line"; else failed "no hand-off for the link $f15saved"; fi
wait_log "received $f15saved -> arrival notice: saved to the Reader (quiet)" 30 || failed "no \"Saved to the Reader\" notice (Quiet) for $f15saved"
if [ "$notices_listed" = 1 ]; then
  k="$(notices_of "$f15saved" 11)"; [ "$k" = 1 ] || failed "$f15saved has $k \"Saved to the Reader\" notices, not one"
fi
send wait-lab 120 "$f15saved=reader|queued" || failed "the phone did not read $f15saved in the Reader"
alone_in_shade "$f15saved"
if shade_action 'F15 link saved by itself' "$DISMISS_RE"; then shade_ok+=("Dismiss"); else
  echo "note: the notice's Dismiss was not found in the shade"; shade_hook+=("Dismiss")
  root_broadcast .inbox.ArrivalActionReceiver com.daylight.share.action.ARRIVAL_DISMISS "$f15saved"
fi
wait_log "received $f15saved -> arrival notice dismissed" 30 || failed "Dismiss on the notice of $f15saved did nothing"
sleep 2
if [ "$notices_listed" = 1 ] && notice_up "$f15saved" 11; then failed "the notice of $f15saved stayed after Dismiss"; fi
adb shell cmd statusbar collapse >/dev/null 2>&1 || true

# 16. F26: Setup check's "Test the Reader hand-off" (on the Inbox): the bundled test article goes through the usual
#     hand-off to the Reader, Setup check then shows "✓ In your Reader", and no sender gets a state for it.
echo "== 16. Lab, Setup check (F26): Test the Reader hand-off"
open_setup_check
shot "$OUT/52-setup-check.png"
n="$(count)"
tests0="$(inbox_log | grep -c 'lab: reader hand-off test' || true)"
testid=""
if scroll_tap "$(exactly "$(labtext setup.readerTest)")" "$SHARE_PKG" 6; then
  if line="$(wait_count 'lab: reader hand-off test [0-9a-f]* stored' $((tests0 + 1)) 30)"; then
    testid="$(echo "$line" | sed -n 's/.*lab: reader hand-off test \([0-9a-f]*\) stored.*/\1/p')"
    echo "$line"
  else
    failed "Test the Reader hand-off stored no test article"
  fi
else
  failed "Setup check's \"$(labtext setup.readerTest)\" was not found (What's in Lab › Setup check on the Inbox)"
fi
if [ -n "$testid" ]; then
  if line="$(wait_handoff "$testid" 120)"; then
    echo "$line"
    echo "$line" | grep -q 'kind=page -> handed to com.daylightcomputer.reader via save_page status=\(saved\|duplicate\)' \
      || failed "the Reader hand-off test $testid did not reach the Reader through SAVE_PAGE"
  else
    failed "no hand-off for the Reader hand-off test $testid"
  fi
  wait_library_at_least $((n + 1)) 120 || failed "the Reader hand-off test's article did not reach the library"
  sleep 3
  open_setup_check
  inReader="$(labtext setup.ok "check=$(labtext setup.inReader)")"
  if scroll_find "$(exactly "$inReader")" "$SHARE_PKG" 6; then echo "Setup check says \"$inReader\""; else failed "Setup check does not say \"$inReader\" after the Reader hand-off test"; fi
  shot "$OUT/53-setup-check-done.png"
  if inbox_log | grep "lab: state $testid" >/dev/null; then failed "the Reader hand-off test recorded a Lab state for senders"; fi
fi
adb shell input keyevent KEYCODE_BACK; sleep 1; adb shell input keyevent KEYCODE_BACK; sleep 1 # back to the Inbox

# 17. The phone (K4): this emulator's Daylight Share becomes a sender on the same pairing (setup link role=sender),
#     shares as from the share sheet, and becomes the Inbox again, which then receives what it sent.
echo "== 17. Lab, the phone (F11, F08, F04): this emulator's Daylight Share as a sender on the same pairing"
INBOX_TOPIC="$(send topics | sed -n 's/^inbox //p')"
PHONE_FROM='CI Daylight' # the setup link's n: the Daylight's name, and this device's own
t_phone=$(( $(date +%s) - 5 )) # the mock relay's clock is this machine's
roles0="$(inbox_log | grep -c 'setup: role=SENDER' || true)"
adb shell "am start -n $SHARE_PKG/.ui.MainActivity -a android.intent.action.VIEW -d 'daylightshare://setup?role=sender&c=$code&r=http%3A%2F%2F10.0.2.2%3A8787&n=CI%20Daylight&comfort=0'" >/dev/null
sleep 5
wait_count 'setup: role=SENDER' $((roles0 + 1)) 30 || failed "the setup link did not make this device a sender"
list_shortcuts 70-shortcuts-before-send.txt > /dev/null
shot "$OUT/54-phone.png"

# F11.5 and Q1: an NYT headline + link from the share sheet goes as a link (the headline its title, the link cleaned,
# the URL as shared in x-orig), exactly as the JS reference makes it; share in place sends it after its countdown.
NYT_TEXT='Opinion | The Real Reason Inflation Is Still Too High, According to Economists https://www.nytimes.com/2026/10/22/opinion/inflation-economists.html?smid=nytcore-android-share'
inplace0="$(inbox_log | grep -c 'lab: share in place' || true)"
share_text "$NYT_TEXT" ""
wait_count 'lab: share in place, 1 item' $((inplace0 + 1)) 30 || failed "the share sheet's share did not open share in place (F04)"
sleep 4
# F03.3: the first share that brings only a link shows the hint once, on the card, until OK.
if scroll_find "$(exactly "$(labtext linkOnly.android)")" "$SHARE_PKG" 0; then
  echo "the card shows the link-only hint (F03)"; shot "$OUT/55-link-only-hint.png"
  tap_text "$OK_RE" "$SHARE_PKG" || adb shell input keyevent KEYCODE_BACK
else
  echo "note: the link-only hint was not on the card"
fi
nyt=""
if nyt="$(send await-share 90 "$PHONE_FROM" "$t_phone" link "$NYT_TEXT")"; then
  echo "the NYT headline + link went as a link: $nyt"; others+=("$nyt"); expect[$nyt]='reader|queued'
else
  nyt=""; failed "the NYT headline + link from the share sheet did not go as the JS reference's link (F11.5, Q1)"
fi

# F08: after a send, the Direct Share shortcut is listed, named after the Daylight (cut to 10 characters).
sc="$(list_shortcuts 71-shortcuts-after-send.txt)"
if echo "$sc" | grep -q 'id=daylight'; then
  echo "$sc" | grep 'id=daylight' | head -3
  echo "$sc" | grep -qF 'CI Daylig…' && echo "its short label is \"CI Daylig…\"" || echo "note: the short label \"CI Daylig…\" was not in the listing"
else
  failed "the Direct Share shortcut (id daylight) is not listed after a send (F08)"
fi
# ... and a share through it (EXTRA_SHORTCUT_ID) sends like any other share.
DIRECT_URL='https://example.com/?via=direct-share'
direct0="$(inbox_log | grep -c 'lab: a share through the Direct Share shortcut' || true)"
share_text "$DIRECT_URL" "" --es android.intent.extra.shortcut.ID daylight
wait_count 'lab: a share through the Direct Share shortcut' $((direct0 + 1)) 30 || failed "the share through the Direct Share shortcut was not seen as one (F08)"
direct=""
if direct="$(send await-share 90 "$PHONE_FROM" "$t_phone" link "$DIRECT_URL")"; then
  echo "the share through the shortcut went: $direct"; others+=("$direct"); expect[$direct]='reader|queued'
else
  direct=""; failed "the share through the Direct Share shortcut did not go (F08)"
fi

# F04.6: the relay answers 413 to a share in place after its card closed: the send worker posts "Couldn’t send
# ‘{title}’ to {name}" / "Open to try again." in the channel "Send results".
curl -s -X POST "$RELAY_LOCAL/__mock/fail-publish?count=1&status=413&topic=$INBOX_TOPIC" >/dev/null || failed "the mock relay did not take the 413"
F04_TITLE="$(labtext shareInPlace.failedTitle 'title=F04 forced 413' "name=$PHONE_FROM")"
F04_TEXT="$(labtext shareInPlace.failedText)"
results0="$(inbox_log | grep -c 'lab: send result notice for' || true)"
share_text 'https://example.com/?f04=413' 'F04 forced 413'
if line="$(wait_count 'lab: send result notice for [0-9a-f]* (failed' $((results0 + 1)) 90)"; then
  echo "$line"
  sleep 2
  adb shell dumpsys notification --noredact 2>/dev/null | tr -d '\r' > "$OUT/56-f04-notifications.txt" || true
  grep -qF "$F04_TITLE" "$OUT/56-f04-notifications.txt" || failed "no notice titled \"$F04_TITLE\" (F04.6)"
  grep -qF "$F04_TEXT" "$OUT/56-f04-notifications.txt" || failed "the 413 notice does not say \"$F04_TEXT\""
  grep -q 'send-results' "$OUT/56-f04-notifications.txt" || echo "note: the channel send-results was not in the notification dump"
  if adb shell dumpsys activity activities 2>/dev/null | grep -q 'sender.ShareActivity'; then echo "note: a share card was still open"; else echo "the share card had closed"; fi
else
  failed "the send worker posted no \"Send results\" notice after the relay answered 413 (F04.6)"
fi
shot "$OUT/57-after-413.png"

# F11 on the phone: with Comfort the card opens with Options and Send (no countdown, F04.5); Options › Send as
# excerpt sends the text and its link as an excerpt (an explicit selection, Q1), as the JS reference would.
roles0="$(inbox_log | grep -c 'setup: role=SENDER' || true)"
adb shell "am start -n $SHARE_PKG/.ui.MainActivity -a android.intent.action.VIEW -d 'daylightshare://setup?role=sender&c=$code&r=http%3A%2F%2F10.0.2.2%3A8787&n=CI%20Daylight&comfort=1'" >/dev/null
sleep 4
wait_count 'setup: role=SENDER' $((roles0 + 1)) 30 || failed "the setup link did not turn Comfort on"
EX_TEXT='I went to the woods because I wished to live deliberately (android), to front only the essential facts of life. https://example.com/walden-one'
EX_SUBJECT='Walden, sent from a phone (one)'
share_text "$EX_TEXT" "$EX_SUBJECT"
sleep 4
shot "$OUT/58-options.png"
phoneex=""
if scroll_tap "$(exactly "$(labtext shareInPlace.sendAsExcerpt)")" "$SHARE_PKG" 2 && sleep 1 \
  && scroll_tap "$(exactly "$(labtext shareInPlace.send)")" "$SHARE_PKG" 3; then
  sleep 3
  # the first excerpt says once that excerpts wait for a tap (6.5 Q1)
  if scroll_find "$(exactly "$(labtext excerpt.waitsOnce)")" "$SHARE_PKG" 0; then tap_text "$OK_RE" "$SHARE_PKG" || adb shell input keyevent KEYCODE_BACK; fi
  if phoneex="$(send await-share 90 "$PHONE_FROM" "$t_phone" excerpt "$EX_TEXT" "$EX_SUBJECT")"; then
    echo "Send as excerpt went as an excerpt: $phoneex"; others+=("$phoneex"); expect[$phoneex]=handed
  else
    phoneex=""; failed "Options › Send as excerpt did not go as the JS reference's excerpt (F11)"
  fi
else
  failed "the share card's Options › Send as excerpt and Send were not found (Comfort: no countdown)"
  adb shell input keyevent KEYCODE_BACK
fi

# The Inbox again: the shortcut goes (F08: not in the Inbox role), and what the phone sent reaches the Reader.
n="$(count)"
setup_inbox "&comfort=0"
sleep 3
sc="$(list_shortcuts 72-shortcuts-inbox.txt)"
if echo "$sc" | grep -q 'id=daylight'; then failed "the Direct Share shortcut is still listed in the Inbox role (F08)"; fi
grow=0 # the documents these add to the library: the excerpt, and each link the Reader saved
for id in $nyt $direct $phoneex; do
  if line="$(wait_handoff "$id" 150)"; then
    echo "$line"
    if [ "$id" = "$phoneex" ]; then
      echo "$line" | grep -q 'kind=file -> handed to com.daylightcomputer.reader via send_file' || failed "the phone's excerpt $id was not handed over as a document"
      grow=$((grow + 1))
    else
      echo "$line" | grep -q 'kind=url -> handed to com.daylightcomputer.reader via save_page' || failed "the phone's link $id was not handed to the Reader to download (SAVE_PAGE)"
      if echo "$line" | grep -q 'status=saved'; then grow=$((grow + 1)); fi
    fi
  else
    failed "no hand-off for $id, sent from this emulator as the phone"
  fi
done
if [ "$grow" -gt 0 ]; then
  wait_library_at_least $((n + grow)) 120 || failed "the library did not grow by $grow with what the phone sent (the excerpt a new document)"
fi
wants=()
for id in $nyt $direct $phoneex; do wants+=("$id=${expect[$id]}"); done
if [ "${#wants[@]}" -gt 0 ]; then
  send wait-lab 150 "${wants[@]}" || failed "the phone (sender.mjs) did not read the states of what the Android phone sent"
fi

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
for id in "${sent[@]}" "${!old_of[@]}" "${others[@]}"; do
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

# F15: Dismiss on "Saved to the Reader" recorded no state: no "lab: state" line for that item after its dismissal.
last="$(grep -E "lab: state $f15saved|$f15saved -> arrival notice dismissed" "$OUT/inbox-log.txt" | tail -1 || true)"
echo "$last" | grep -q 'arrival notice dismissed' || failed "a Lab state was recorded for $f15saved after its notice's Dismiss: $last"

# The relay budget (LAB-PROTOCOL 2.2.4, 2.2.7): the Inbox's Lab frames within its daily cap (past it, states wait for
# the digest), and every message the run published within ntfy.sh's daily messages for one address (the phones, the
# Android phone and the Inbox all publish from this machine's address, as a household does).
labCap="$(node -e "import('$here/../share/js/daylight-lab.js').then((l) => console.log(l.LAB_FRAMES_PER_DAY))")"
relayCap="$(node -e "import('$here/../share/js/mock-relay.mjs').then((m) => console.log(m.NTFY_SH_LIMITS.visitorMessagesPerDay))")"
labFrames="$(grep -cE 'lab: (hello caps=|states n=|hello lab=0)' "$OUT/inbox-log.txt" || true)"
published="$(curl -s "$RELAY_LOCAL/__mock/state" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).published)}catch{console.log(-1)}})')"
echo "budget: $labFrames Lab frames (the Inbox's cap: $labCap a day); $published messages published (ntfy.sh: $relayCap a day per address)"
[ "${labFrames:-0}" -le "$labCap" ] || failed "the Inbox published $labFrames Lab frames, over its daily cap of $labCap"
[ "${published:--1}" -ge 0 ] && [ "$published" -le "$relayCap" ] || failed "the run published $published messages, over ntfy.sh's $relayCap a day"

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
# Lab (F03, F11): each row's kind line (reported; InboxRowLineTest checks every one).
if [ -s "$OUT/41-inbox-items.xml" ]; then
  for k in kindLine.excerpt kindLine.link kindLine.test kindLine.seen; do
    w="$(labtext "$k")"; echo "kind line \"$w\": $(grep -oF "$w" "$OUT/41-inbox-items.xml" | wc -l) on screen"
  done
fi
shot "$OUT/41-inbox-items.png"
adb shell monkey -p "$READER_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true; sleep 5
shot "$OUT/40-reader-library.png"
echo "library after: $(reader_count_line) (before: $before)"

if [ "${#fails[@]}" -gt 0 ]; then
  echo "FAILED (${#fails[@]}):"; printf '  - %s\n' "${fails[@]}"
  exit 1
fi
echo "OK: page, link, PDF, background page, a 5 MB PDF in 3 parts, two PDFs 20 s apart, Ask (card and notification) and batch reached the Reader and were acknowledged; the v1.0 and v1.1 phones as shipped delivered a page, a link and a PDF each, unchanged; Lab: the hello, every item's state on the phone (waiting, then handed or reader after a tap; none for a page, a link and a PDF with the Inbox's Lab off); Wave 1: Add to Reader, Keep for later, a swipe and Dismiss to their states (F15), excerpts and a note as new documents (F11), the Reader hand-off test (F26), and the Android phone's NYT link, Direct Share shortcut, 413 notice and excerpt (F11.5, F08, F04.6); $labFrames Lab frames, $published messages"
