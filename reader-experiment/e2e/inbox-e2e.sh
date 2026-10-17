#!/usr/bin/env bash
# Step 2 of the end-to-end test, on the emulator where reader-smoke.sh has installed the Reader:
# a "phone" (sender.mjs) sends a page, a link and a PDF through the mock relay; the Daylight Share Inbox receives them,
# acks them and hands each to the Reader; the Reader's library grows and the phone sees every item delivered.
# Then the Inbox is in the background (the Reader opened the PDF) and a second page must still arrive on its own.
# Usage: inbox-e2e.sh <daylight-share debug apk> <out dir>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/reader-lib.sh"
SHARE_APK="$1"; OUT="$2"; mkdir -p "$OUT"
export E2E_STATE="$OUT/sender-state.json"
SHARE_PKG=com.daylight.share

node "$here/../share/js/mock-relay.mjs" --host 0.0.0.0 --port 8787 > "$OUT/relay.log" 2>&1 &
relay_pid=$!
trap 'kill $relay_pid 2>/dev/null || true; adb logcat -d -s DaylightShare:* ReaderReadLater:* > "$OUT/inbox-logcat.txt" 2>/dev/null || true' EXIT
sleep 1

adb install -r -g "$SHARE_APK"
adb shell pm grant "$SHARE_PKG" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
adb shell appops set "$SHARE_PKG" SYSTEM_ALERT_WINDOW allow
adb logcat -c

before="$(reader_library_count)"; before="${before:-0}"
echo "library before: $(reader_count_line)"

code="$(node "$here/sender.mjs" pair http://127.0.0.1:8787)"
echo "pairing code: $code"
adb shell "am start -n $SHARE_PKG/.ui.MainActivity -a android.intent.action.VIEW -d 'daylightshare://setup?role=inbox&c=$code&r=http%3A%2F%2F10.0.2.2%3A8787&n=CI%20Daylight&instant=1&auto=1'"
sleep 6
shot "$OUT/10-inbox-paired.png"

# Waits until the Inbox logs the hand-off of item $1 to the Reader (timeout $2 s); prints the log line.
wait_handoff() {
  local id="$1" timeout="${2:-120}" waited=0 line
  while [ "$waited" -lt "$timeout" ]; do
    line="$(adb logcat -d -s DaylightShare:* 2>/dev/null | tr -d '\r' | grep -m1 "received $id .*\(handed to\|kept in inbox\)" || true)"
    if [ -n "$line" ]; then echo "$line"; return 0; fi
    sleep 3; waited=$((waited + 3))
  done
  echo "no hand-off for $id after ${timeout}s" >&2; adb logcat -d -s DaylightShare:* | tail -20 >&2; return 1
}

# 1. An article page (the HTML travels with it): one more document.
page1="$(node "$here/sender.mjs" send-page one)"; echo "sent page $page1"
wait_handoff "$page1" 120
wait_library_at_least $((before + 1)) 90
sleep 3; shot "$OUT/11-after-page.png"

# 2. A plain link: the Reader fetches it itself (needs the emulator's internet; reported, not required).
n="$(reader_library_count)"
url1="$(node "$here/sender.mjs" send-url https://example.org/)"; echo "sent link $url1"
wait_handoff "$url1" 120
if wait_library_at_least $((n + 1)) 60; then echo "link saved"; else echo "link handed over but not saved (no internet on the emulator?)"; fi

# 3. A PDF: the Reader imports it (and opens it, which puts the Inbox in the background).
adb shell "am start -n $SHARE_PKG/.ui.MainActivity" >/dev/null; sleep 2
n="$(reader_library_count)"
pdf1="$(node "$here/sender.mjs" send-pdf one)"; echo "sent pdf $pdf1"
wait_handoff "$pdf1" 120
wait_library_at_least $((n + 1)) 120
sleep 5; shot "$OUT/12-after-pdf.png"
echo "foreground now: $(adb shell dumpsys activity activities | tr -d '\r' | grep -m1 -E 'topResumedActivity|mResumedActivity' | tr -s ' ')"

# 4. The Inbox is behind the Reader now: a second page must still arrive and be handed over without a tap.
n="$(reader_library_count)"
page2="$(node "$here/sender.mjs" send-page two)"; echo "sent page $page2 (Inbox in the background)"
wait_handoff "$page2" 150
wait_library_at_least $((n + 1)) 120
sleep 4; shot "$OUT/13-after-background-page.png"

node "$here/sender.mjs" wait-acks 4 120

adb logcat -d -s DaylightShare:* > "$OUT/inbox-logcat.txt" || true
echo "--- hand-offs ---"; grep -E "handed to|kept in inbox" "$OUT/inbox-logcat.txt" || true
fail=0
for id in "$page1" "$url1" "$pdf1" "$page2"; do
  if grep -q "received $id .*handed to com.daylightcomputer.reader" "$OUT/inbox-logcat.txt"; then echo "ok   $id"; else echo "MISSING hand-off for $id"; fail=1; fi
done
adb shell monkey -p "$READER_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null; sleep 5
shot "$OUT/14-reader-library.png"
echo "library after: $(reader_count_line)"
[ "$fail" = 0 ] && echo "OK: page, link, PDF and a background page reached the Reader and were acknowledged"
exit "$fail"
