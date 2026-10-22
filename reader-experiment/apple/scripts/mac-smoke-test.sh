#!/usr/bin/env bash
# CI (rx-apple.yml, mac lane): the Mac smoke test, on a zipped Send to Daylight.app. It gates the release.
#
#   scripts/mac-smoke-test.sh <Send-to-Daylight-mac.zip> private|shared [screenshot prefix, default: mac]
#
# The app must show its window and keep its main thread running within seconds (the 1.0 build hung at launch on
# macOS 15, its main thread waiting behind the App Group privacy prompt), never touch storage on its main thread, then
# pair, send, and show the item Delivered once the JS receiver acks it. It reports its state through -DLSStatusDump
# (AppModel.noteRendered): a JSON file in its sandbox container with its storage, its history rows (with the label the
# history shows), the storage accesses made on its main thread (StorageAudit) and a once-a-second heartbeat from the
# main thread.
#
# private: the ad-hoc build (and the signing dry run, whose self-signed certificate carries no Team ID): the app keeps
#          its own storage, with no App Group, so nothing can bring up the privacy prompt.
# shared:  the Developer ID build: the app uses the App Group its Info.plist declares (DaylightAppGroup,
#          <TEAMID>.com.daylight.share), which its team signature authorises without a prompt.
#
# Needs node, the mock relay (started here on $RELAY_PORT, default 8787, unless one answers) and macOS's screencapture.
set -euo pipefail

if [ $# -lt 2 ] || { [ "$2" != private ] && [ "$2" != shared ]; }; then
  echo "usage: $0 <Send-to-Daylight-mac.zip> private|shared [screenshot prefix]" >&2
  exit 2
fi
ZIP="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
STORAGE=$2
NAME=${3:-mac}
cd "$(dirname "$0")/.."
RELAY_PORT=${RELAY_PORT:-8787}
TEMP=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
mkdir -p build

shot() { screencapture -x "build/$1.png" && sips -Z 720 -s format jpeg -s formatOptions 55 "build/$1.png" --out "build/$1.jpg" >/dev/null && echo "=====BEGIN $1=====" && base64 -i "build/$1.jpg" && echo "=====END $1====="; }
hung() { shot "$NAME-hung" || true; sample "Send to Daylight" 2 -file "build/$NAME-sample.txt" >/dev/null 2>&1 && head -80 "build/$NAME-sample.txt"; exit 1; }

rm -rf "$TEMP/smoke" && mkdir -p "$TEMP/smoke"
ditto -x -k "$ZIP" "$TEMP/smoke"
APP="$TEMP/smoke/Send to Daylight.app"
BUNDLE_ID=$(plutil -extract CFBundleIdentifier raw "$APP/Contents/Info.plist")
DECLARED=$(plutil -extract DaylightAppGroup raw "$APP/Contents/Info.plist" 2>/dev/null || true)
STATUS="$HOME/Library/Containers/$BUNDLE_ID/Data/Library/Application Support/DaylightShare/debug-status.json"
rm -f "$STATUS"
codesign -dv "$APP" 2>&1 | grep -E '^(Identifier|Authority|TeamIdentifier|Timestamp|Notarization Ticket)=' || true
curl -fsS "http://127.0.0.1:$RELAY_PORT/v1/health" >/dev/null 2>&1 || { node ../share/js/mock-relay.mjs --port "$RELAY_PORT" > "$TEMP/mock-relay-2.log" 2>&1 & sleep 2; }
LINK=$(node scripts/ci-pairing-link.mjs "http://127.0.0.1:$RELAY_PORT" "CI Mac Daylight")
CODE=$(echo "$LINK" | sed -E 's/.*[?&]c=([A-Z2-7]+).*/\1/')
SENT_URL="https://example.com/from-the-mac-app"
LAUNCHED=$(node -e 'console.log(Date.now())')
open -n "$APP" --args -DLSStatusDump -DLSPairLink "$LINK" -DLSSendLink "$SENT_URL"
# 1. Window within 10 s of launch, then a main thread that keeps running.
node scripts/ci-app-status.mjs render "$STATUS" 10 "$LAUNCHED" || hung
# 2. Where it keeps the pairing and history (no privacy prompt either way: an ad-hoc build has no App Group, a
#    Developer ID build's group is authorised by its signature); and no storage read on the main thread at startup (the
#    app model reads UserDefaults and the outbox on a background queue).
node scripts/ci-app-status.mjs storage "$STATUS" "$STORAGE"
if [ "$STORAGE" = shared ]; then
  # shellcheck disable=SC2016  # JavaScript, with its own ${…}
  node -e '
    const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (s.appGroup !== process.argv[2]) {
      console.log(`::error::the app uses the App Group ${s.appGroup}; its Info.plist declares ${process.argv[2]}`);
      process.exit(1);
    }' "$STATUS" "$DECLARED"
  [ -d "$HOME/Library/Group Containers/$DECLARED" ] \
    || { echo "::error::no ~/Library/Group Containers/$DECLARED after the app chose it"; exit 1; }
  echo "The app and its Share menu item share ~/Library/Group Containers/$DECLARED; the Safari extension reads its pairing there."
fi
node scripts/ci-app-status.mjs main-thread "$STATUS"
pgrep -fl "smoke/Send to Daylight" || { echo "::error::the Mac app is not running"; exit 1; }
pluginkit -m -A -D -v 2>/dev/null | grep -i daylight || echo "::warning::pluginkit does not list the extensions"
# 3. Paired and sent (the relay has it).
node scripts/ci-app-status.mjs row "$STATUS" "$SENT_URL" sent,delivered 30
shot "$NAME-sent" || true
node scripts/e2e-receiver.mjs "http://127.0.0.1:$RELAY_PORT" "$CODE" | tee "build/$NAME-received.json"
grep -q "\"url\":\"$SENT_URL\"" "build/$NAME-received.json" \
  || { echo "::error::the link sent by the Mac app did not reach the JS receiver"; exit 1; }
# 4. The receiver acked it: the history shows "Delivered ✓" (the app checks again ~30 s after sending, and every minute
#    while something waits).
node scripts/ci-app-status.mjs row "$STATUS" "$SENT_URL" delivered 120
shot "$NAME-delivered" || true
# 5. Pairing, sending and reading the ack never touched storage on the main thread either.
node scripts/ci-app-status.mjs main-thread "$STATUS"
if [ "$STORAGE" = private ] && [ -e "$HOME/Library/Group Containers/group.com.daylight.share" ]; then
  echo "::warning::~/Library/Group Containers/group.com.daylight.share exists (not created by this build, which has no App Group)"
fi
pkill -f "smoke/Send to Daylight" || true
