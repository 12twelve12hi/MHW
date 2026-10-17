#!/usr/bin/env bash
# Step 1 of the end-to-end test: the Daylight Reader (public snapshot build) on an emulator accepts a link through
# the same SAVE_PAGE entry point the Daylight Inbox uses, and the library grows. Usage: reader-smoke.sh <apk dir> <out dir>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/reader-lib.sh"
APKS="$1"; OUT="$2"; mkdir -p "$OUT"

adb install -r -g "$(ls "$APKS"/*.apk | head -1)"
adb shell monkey -p "$READER_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 12
shot "$OUT/01-reader-first-launch.png"
before="$(reader_library_count)"; before="${before:-0}"
echo "library before: $(reader_count_line)"

adb shell am start -W -a com.daylightcomputer.reader.action.SAVE_PAGE -p "$READER_PKG" \
  --es android.intent.extra.TEXT "https://example.com/" --es com.daylightcomputer.reader.extra.TITLE "Example%sDomain"
sleep 3
shot "$OUT/02-save-page-card.png"
wait_library_at_least $((before + 1)) 120
shot "$OUT/03-after-save.png"
adb logcat -d -s ReaderReadLater:* ReaderShell:* > "$OUT/reader-logcat.txt" || true
echo "OK: SAVE_PAGE added a document"
