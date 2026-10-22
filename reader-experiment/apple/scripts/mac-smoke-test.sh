#!/usr/bin/env bash
# CI (rx-apple.yml, mac lane): the Mac smoke test, on a zipped Send to Daylight.app. It gates the release.
#
#   scripts/mac-smoke-test.sh <Send-to-Daylight-mac.zip> private|shared [screenshot prefix, default: mac]
#
# The app must show its window and keep its main thread running within seconds (the 1.0 build hung at launch on
# macOS 15, its main thread waiting behind the App Group privacy prompt), never touch storage on its main thread, then
# pair, send, and show the item Delivered once the JS receiver acks it. It reports its state through -DLSStatusDump
# (AppModel.noteRendered): a JSON file in its sandbox container with its storage, its history rows (with the label the
# history shows), the storage accesses made on its main thread (StorageAudit), a once-a-second heartbeat from the
# main thread, and Lab's fields (LAB-PLAN 1.7): `lab`, the Daylight's `caps` and each item's state, `labStates`.
#
# Lab, on the build that is released (LAB-PLAN F00, F17; card A2):
# - Lab is on at the first start (F00.1), and the receiver is a Lab Daylight (e2e-receiver.mjs --lab): the app's ledger
#   hears its hello and the link's state, "reader" (F17), while the history still says "Delivered ✓" (W0).
# - F00.4: an item shared while the relay cannot be reached waits; Lab is turned off (-DLSLab 0, a relaunch); the relay
#   comes back: the item is sent and delivered, with Lab off. The pairing and the history are still there, and the
#   ledger keeps learning with Lab off (1.3): turned on again, Lab has the item's state at once.
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
# F00.4's relay: nothing listens there until the item has been queued and Lab turned off.
OFFLINE_PORT=${OFFLINE_PORT:-$((RELAY_PORT + 11))}
TEMP=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
mkdir -p build

# lab_wait <what> <seconds> <JavaScript condition on the status `s`>: waits until the status file meets it.
# shellcheck disable=SC2016  # JavaScript, with its own ${…}
lab_wait() {
  node -e '
    const fs = require("fs");
    const [file, what, seconds, condition] = process.argv.slice(1);
    const test = new Function("s", `return (${condition});`);
    const end = Date.now() + Number(seconds) * 1000;
    (function check() {
      let s = null;
      try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
      let ok = false;
      try { ok = !!(s && test(s)); } catch {}
      if (ok) {
        console.log(`${what}: yes (lab ${s.lab}, caps ${JSON.stringify(s.caps)}, states ${JSON.stringify(s.labStates)})`);
        process.exit(0);
      }
      if (Date.now() > end) {
        console.log(`::error::${what}: not within ${seconds} s`);
        console.log(`Last status:\n${s ? JSON.stringify(s, null, 2) : "(none written)"}`);
        process.exit(1);
      }
      setTimeout(check, 250);
    })();' "$STATUS" "$1" "$2" "$3"
}
# relaunch [arguments…]: quits the app and opens it again with -DLSStatusDump and these arguments; waits for its window.
relaunch() {
  pkill -f "smoke/Send to Daylight" || true
  for _ in $(seq 1 40); do pgrep -f "smoke/Send to Daylight" > /dev/null || break; sleep 0.25; done
  rm -f "$STATUS"
  local started
  started=$(node -e 'console.log(Date.now())')
  open -n "$APP" --args -DLSStatusDump "$@"
  node scripts/ci-app-status.mjs render "$STATUS" 10 "$started" || hung
}
# row_js <url>: the status's history row for that link, in JavaScript.
row_js() { echo "(s.rows || []).find((r) => r.url === \"$1\")"; }
shot() { screencapture -x "build/$1.png" && sips -Z 720 -s format jpeg -s formatOptions 55 "build/$1.png" --out "build/$1.jpg" >/dev/null && echo "=====BEGIN $1=====" && base64 -i "build/$1.jpg" && echo "=====END $1====="; }
hung() { shot "$NAME-hung" || true; sample "Send to Daylight" 2 -file "build/$NAME-sample.txt" >/dev/null 2>&1 && head -80 "build/$NAME-sample.txt"; exit 1; }

rm -rf "$TEMP/smoke" && mkdir -p "$TEMP/smoke"
ditto -x -k "$ZIP" "$TEMP/smoke"
APP="$TEMP/smoke/Send to Daylight.app"
BUNDLE_ID=$(plutil -extract CFBundleIdentifier raw "$APP/Contents/Info.plist")
DECLARED=$(plutil -extract DaylightAppGroup raw "$APP/Contents/Info.plist" 2>/dev/null || true)
STATUS="$HOME/Library/Containers/$BUNDLE_ID/Data/Library/Application Support/DaylightShare/debug-status.json"
rm -f "$STATUS"
codesign -dvv "$APP" 2>&1 | grep -E '^(Identifier|Authority|TeamIdentifier|Timestamp|Notarization Ticket)=' || true
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
# The receiver is a Lab Daylight (LabInboxSim): after its acks it says hello and sends the link's state, "reader".
node scripts/e2e-receiver.mjs "http://127.0.0.1:$RELAY_PORT" "$CODE" --lab | tee "build/$NAME-received.json"
grep -q "\"url\":\"$SENT_URL\"" "build/$NAME-received.json" \
  || { echo "::error::the link sent by the Mac app did not reach the JS receiver"; exit 1; }
# 4. The receiver acked it: the history shows "Delivered ✓" (the app checks again ~30 s after sending, and every minute
#    while something waits).
node scripts/ci-app-status.mjs row "$STATUS" "$SENT_URL" delivered 120
shot "$NAME-delivered" || true
# 5. Pairing, sending and reading the ack never touched storage on the main thread either.
node scripts/ci-app-status.mjs main-thread "$STATUS"
# 6. Lab (F00.1, F17, 1.7): on at the first start, with the status file's Lab fields; the ledger heard the Lab
#    Daylight's hello (its caps) and the link's state. The hello and the state came right after the ack, so the app read
#    them with it; if it read the ack alone, a relaunch reads the ack topic again.
lab_wait "the status file has Lab's fields, and Lab is on at the first start" 10 \
  's.lab === true && Array.isArray(s.caps) && s.labStates !== null && typeof s.labStates === "object"'
SENT_ROW=$(row_js "$SENT_URL")
HEARD="s.caps.includes(\"st\") && (() => { const r = $SENT_ROW; return !!r && (s.labStates[r.id] || {}).s === \"reader\"; })()"
if ! lab_wait "the ledger heard the Lab Daylight's hello and the link's state (reader)" 60 "$HEARD"; then
  echo "::warning::not heard with the ack: opening the app again, which reads the ack topic again"
  relaunch
  lab_wait "the ledger heard the Lab Daylight's hello and the link's state (reader), after a relaunch" 90 "$HEARD"
fi
node scripts/ci-app-status.mjs row "$STATUS" "$SENT_URL" delivered 5
# 7. F00.4: queued while the relay cannot be reached, Lab turned off, the relay back: the item is sent, with Lab off,
#    and the pairing, the history and the ledger are kept. A pairing on its own relay (port $OFFLINE_PORT), on which
#    nothing listens yet.
OFFLINE_LINK=$(node scripts/ci-pairing-link.mjs "http://127.0.0.1:$OFFLINE_PORT" "CI Mac Daylight offline")
OFFLINE_CODE=$(echo "$OFFLINE_LINK" | sed -E 's/.*[?&]c=([A-Z2-7]+).*/\1/')
QUEUED_URL="https://example.com/queued-while-offline"
relaunch -DLSPairLink "$OFFLINE_LINK" -DLSSendLink "$QUEUED_URL"
node scripts/ci-app-status.mjs row "$STATUS" "$QUEUED_URL" failed 60
QUEUED_ROW=$(row_js "$QUEUED_URL")
relaunch -DLSLab 0
lab_wait "Lab is off, still paired, and the queued item still waits" 10 \
  "s.lab === false && s.paired === true && (() => { const r = $QUEUED_ROW; return !!r && r.status === \"failed\"; })()"
node ../share/js/mock-relay.mjs --port "$OFFLINE_PORT" > "$TEMP/mock-relay-offline.log" 2>&1 &
OFFLINE_RELAY=$!
for _ in $(seq 1 20); do curl -fsS "http://127.0.0.1:$OFFLINE_PORT/v1/health" > /dev/null 2>&1 && break; sleep 0.5; done
# The app tries again by itself (2 minutes after a first failure; it checks every minute while something waits).
node scripts/ci-app-status.mjs row "$STATUS" "$QUEUED_URL" sent,delivered 240
node scripts/e2e-receiver.mjs "http://127.0.0.1:$OFFLINE_PORT" "$OFFLINE_CODE" --lab | tee "build/$NAME-received-offline.json"
grep -q "\"url\":\"$QUEUED_URL\"" "build/$NAME-received-offline.json" \
  || { echo "::error::the item queued while offline did not reach the JS receiver after Lab was turned off"; exit 1; }
node scripts/ci-app-status.mjs row "$STATUS" "$QUEUED_URL" delivered 120
lab_wait "with Lab off: delivered, still paired, and the ledger still learns (1.3)" 60 \
  "s.lab === false && s.paired === true && (() => { const r = $QUEUED_ROW; return !!r && (s.labStates[r.id] || {}).s === \"reader\"; })()"
shot "$NAME-lab-off" || true
relaunch -DLSLab 1
lab_wait "Lab on again: the pairing, the history and the item's state are there at once" 10 \
  "s.lab === true && s.paired === true && (() => { const r = $QUEUED_ROW; return !!r && r.status === \"delivered\" && (s.labStates[r.id] || {}).s === \"reader\"; })()"
node scripts/ci-app-status.mjs main-thread "$STATUS"
kill "$OFFLINE_RELAY" 2>/dev/null || true
if [ "$STORAGE" = private ] && [ -e "$HOME/Library/Group Containers/group.com.daylight.share" ]; then
  echo "::warning::~/Library/Group Containers/group.com.daylight.share exists (not created by this build, which has no App Group)"
fi
pkill -f "smoke/Send to Daylight" || true
