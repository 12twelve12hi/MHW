#!/usr/bin/env bash
# Checks a signed Send-to-Daylight-mac.zip before the release takes it (README › Signing): the app and both extensions
# are signed by the team's Developer ID with the hardened runtime and a secure timestamp, carry the entitlements of the
# team's App Group, and the app has its notarization ticket stapled.
#
#   scripts/check-mac-release.sh <Send-to-Daylight-mac.zip> <team id>
#   scripts/check-mac-release.sh --dry-run <certificate name> <Send-to-Daylight-mac.zip> <team id>
#   scripts/check-mac-release.sh --self-test
#
# CI runs it in the `mac` job on the zip mac-developer-id made, before handing that zip to `publish`, and in
# mac-developer-id itself. Without the signing secrets mac-developer-id runs it with --dry-run on the dry run's zip:
# the same checks, except that the signer must be the throwaway self-signed certificate named here (so the signature
# has no Team ID, "TeamIdentifier=not set") and there is no ticket to look for. --self-test (Linux too; the mac-scripts
# job) runs the signature and entitlement rules on sample codesign output.
#
# Environment: SIGN_MAC_APP_GROUP, the App Group to expect (default: <team id>.com.daylight.share), as for sign-mac.sh.
#
# macOS (ditto, codesign, plutil, stapler) and python3. Works with macOS's own bash 3.2.
set -euo pipefail

fail() { echo "::error::check-mac-release: $*" >&2; exit 1; }
note() { echo "check-mac-release: $*"; }

# What is wrong with one bundle's signature, from `codesign -dvv` (which prints the Authority lines; plain -dv does
# not), or nothing.
#   signature_problem <codesign -dvv output> <team id> [the dry run's certificate name]
signature_problem() {
  local info=$1 team=$2 dry_run_name=${3:-} authority team_identifier
  authority=$(awk '/^Authority=/ { print substr($0, 11); exit }' <<<"$info")
  team_identifier=$(awk '/^TeamIdentifier=/ { print substr($0, 16); exit }' <<<"$info")
  if [ -z "$authority" ]; then
    echo "has no signing authority (ad hoc, or not read with codesign -dvv)"
  elif [ -n "$dry_run_name" ] && [ "$authority" != "$dry_run_name" ]; then
    echo "is signed by \"$authority\", not by the dry run's \"$dry_run_name\""
  elif [ -n "$dry_run_name" ] && [ "$team_identifier" != "not set" ]; then
    echo "has the Team ID '$team_identifier'; a self-signed certificate has none"
  elif [ -z "$dry_run_name" ] && [[ $authority != "Developer ID Application: "*" ($team)" ]]; then
    echo "is signed by \"$authority\", not by the team's \"Developer ID Application: … ($team)\""
  elif [ -z "$dry_run_name" ] && [ "$team_identifier" != "$team" ]; then
    echo "has the Team ID '$team_identifier', not $team"
  elif ! grep -qE '^CodeDirectory .*flags=0x[0-9a-f]+\([^)]*runtime' <<<"$info"; then
    echo "has no hardened runtime"
  elif ! grep -q '^Timestamp=' <<<"$info"; then
    echo "has no secure timestamp"
  fi
  return 0
}

# What is wrong with the entitlements embedded in a signature (`codesign -d --entitlements - --xml`), or nothing.
#   entitlements_problem <entitlements.plist> <App Group>
entitlements_problem() {
  python3 - "$1" "$2" <<'PY'
import plistlib, sys
try:
    with open(sys.argv[1], 'rb') as f:
        e = plistlib.load(f)
except Exception as error:
    print('has no entitlements that can be read (%s)' % error)
    sys.exit(0)
groups = e.get('com.apple.security.application-groups')
if e.get('com.apple.security.app-sandbox') is not True:
    print('is not sandboxed')
elif groups != [sys.argv[2]]:
    print('is entitled to the App Groups %r, not to %s alone' % (groups, sys.argv[2]))
elif e.get('com.apple.security.get-task-allow') is True:
    print('allows debugging (get-task-allow), which notarization refuses')
PY
}

self_test() {
  local failures=0 dir
  dir=$(mktemp -d "${TMPDIR:-/tmp}/check-mac-release-test.XXXXXX")
  SELF_TEST_DIR=$dir
  trap 'rm -rf "$SELF_TEST_DIR"' EXIT
  expect() {  # <description> <want: ok|problem> <problem printed, possibly empty>
    if { [ "$2" = ok ] && [ -z "$3" ]; } || { [ "$2" = problem ] && [ -n "$3" ]; }; then
      echo "ok    $1${3:+ ($3)}"
    else
      echo "FAIL  $1: wanted $2, got '${3:-no problem}'"
      failures=$((failures + 1))
    fi
  }
  # codesign -dvv on a Developer ID signed, notarized and stapled app.
  local release='Executable=/tmp/x/Send to Daylight.app/Contents/MacOS/Send to Daylight
Identifier=com.daylight.share.mac
Format=app bundle with Mach-O universal (x86_64 arm64)
CodeDirectory v=20500 size=1234 flags=0x10000(runtime) hashes=27+7 location=embedded
Signature size=9050
Authority=Developer ID Application: Jane Appleseed (Home) (ABCDE12345)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=Oct 22, 2026 at 5:44:07 PM
Notarization Ticket=stapled
Info.plist entries=24
TeamIdentifier=ABCDE12345
Runtime Version=15.0.0
Sealed Resources version=2 rules=13 files=40
Internal requirements count=1 size=220'
  # The same signature read with codesign -dv: no Authority lines.
  local release_dv
  release_dv=$(grep -v '^Authority=' <<<"$release")
  # codesign -dvv on the dry run's signature (rx-apple run 39824609439).
  local dry='Executable=/tmp/x/Send to Daylight.app/Contents/MacOS/Send to Daylight
Identifier=com.daylight.share.mac
Format=app bundle with Mach-O universal (x86_64 arm64)
CodeDirectory v=20500 size=1234 flags=0x10000(runtime) hashes=27+7 location=embedded
Signature size=1712
Authority=Send to Daylight CI dry run (self-signed)
Timestamp=Oct 22, 2026 at 5:44:07 PM
Info.plist entries=24
TeamIdentifier=not set
Runtime Version=15.0.0'
  # codesign -dvv on the ad-hoc build.
  local adhoc='Executable=/tmp/x/Send to Daylight.app/Contents/MacOS/Send to Daylight
Identifier=com.daylight.share.mac
CodeDirectory v=20400 size=1234 flags=0x2(adhoc) hashes=27+7 location=embedded
Signature=adhoc
Info.plist entries=24
TeamIdentifier=not set'
  local name='Send to Daylight CI dry run (self-signed)'
  expect "Developer ID, team ABCDE12345" ok "$(signature_problem "$release" ABCDE12345)"
  expect "Developer ID read with codesign -dv" problem "$(signature_problem "$release_dv" ABCDE12345)"
  expect "Developer ID of another team" problem "$(signature_problem "$release" ZYXWV98765)"
  expect "Developer ID, Team ID line of another team" problem \
    "$(signature_problem "${release/TeamIdentifier=ABCDE12345/TeamIdentifier=ZYXWV98765}" ABCDE12345)"
  expect "Apple Development certificate" problem \
    "$(signature_problem "${release/Authority=Developer ID Application:/Authority=Apple Development:}" ABCDE12345)"
  expect "no hardened runtime" problem \
    "$(signature_problem "${release/"flags=0x10000(runtime)"/flags=0x0(none)}" ABCDE12345)"
  expect "no secure timestamp" problem \
    "$(signature_problem "${release/Timestamp=/Signed Time=}" ABCDE12345)"
  expect "the dry run's certificate, dry run" ok "$(signature_problem "$dry" DRYRUN0000 "$name")"
  expect "the dry run's certificate, release" problem "$(signature_problem "$dry" DRYRUN0000)"
  expect "another certificate, dry run" problem "$(signature_problem "$release" DRYRUN0000 "$name")"
  expect "ad hoc, release" problem "$(signature_problem "$adhoc" ABCDE12345)"
  expect "ad hoc, dry run" problem "$(signature_problem "$adhoc" DRYRUN0000 "$name")"

  entitlements() {  # <file> <python dict literal>
    python3 -c 'import ast, plistlib, sys; plistlib.dump(ast.literal_eval(sys.argv[2]), open(sys.argv[1], "wb"))' "$1" "$2"
  }
  entitlements "$dir/good.plist" "{'com.apple.security.app-sandbox': True, 'com.apple.security.application-groups': ['ABCDE12345.com.daylight.share'], 'com.apple.security.network.client': True}"
  entitlements "$dir/other-group.plist" "{'com.apple.security.app-sandbox': True, 'com.apple.security.application-groups': ['group.com.daylight.share']}"
  entitlements "$dir/no-group.plist" "{'com.apple.security.app-sandbox': True}"
  entitlements "$dir/no-sandbox.plist" "{'com.apple.security.application-groups': ['ABCDE12345.com.daylight.share']}"
  entitlements "$dir/debug.plist" "{'com.apple.security.app-sandbox': True, 'com.apple.security.application-groups': ['ABCDE12345.com.daylight.share'], 'com.apple.security.get-task-allow': True}"
  : > "$dir/empty.plist"
  expect "entitlements: the team's App Group" ok "$(entitlements_problem "$dir/good.plist" ABCDE12345.com.daylight.share)"
  expect "entitlements: another App Group" problem "$(entitlements_problem "$dir/other-group.plist" ABCDE12345.com.daylight.share)"
  expect "entitlements: no App Group" problem "$(entitlements_problem "$dir/no-group.plist" ABCDE12345.com.daylight.share)"
  expect "entitlements: not sandboxed" problem "$(entitlements_problem "$dir/no-sandbox.plist" ABCDE12345.com.daylight.share)"
  expect "entitlements: get-task-allow" problem "$(entitlements_problem "$dir/debug.plist" ABCDE12345.com.daylight.share)"
  expect "entitlements: none" problem "$(entitlements_problem "$dir/empty.plist" ABCDE12345.com.daylight.share)"
  if [ "$failures" != 0 ]; then fail "$failures self-test case(s) failed"; fi
  note "self-test passed"
}

if [ "${1:-}" = --self-test ]; then
  self_test
  exit 0
fi
DRY_RUN_NAME=""
if [ "${1:-}" = --dry-run ]; then
  DRY_RUN_NAME=${2:-}
  [ -n "$DRY_RUN_NAME" ] || fail "--dry-run needs the name of the dry run's certificate"
  shift 2
fi
if [ $# -ne 2 ]; then
  echo "usage: $0 [--dry-run <certificate name>] <Send-to-Daylight-mac.zip> <team id> | --self-test" >&2
  exit 2
fi
[ -f "$1" ] || fail "no $1"
ZIP=$1
TEAM=$2
GROUP=${SIGN_MAC_APP_GROUP:-$TEAM.com.daylight.share}
[[ $TEAM =~ ^[A-Z0-9]{10}$ ]] || fail "'$TEAM' is not a Team ID (10 letters and digits)"
case "$GROUP" in "$TEAM".*) ;; *) fail "the App Group $GROUP must start with the Team ID $TEAM." ;; esac

WORK=$(mktemp -d "${TMPDIR:-/tmp}/check-mac-release.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
ditto -x -k "$ZIP" "$WORK/unzipped"
APP="$WORK/unzipped/Send to Daylight.app"
[ -d "$APP/Contents" ] || fail "$ZIP has no Send to Daylight.app at its top"
codesign --verify --deep --strict --verbose=2 "$APP" || fail "codesign --verify --deep --strict rejects the app"

for name in App ShareExtension SafariExtension; do
  case "$name" in
    App) bundle=$APP ;;
    *) bundle="$APP/Contents/PlugIns/$name.appex" ;;
  esac
  [ -d "$bundle/Contents" ] || fail "the app has no $name.appex"
  info=$(codesign -dvv "$bundle" 2>&1) || { echo "$info" >&2; fail "$name: could not read its signature"; }
  grep -E '^(Identifier|CodeDirectory|Authority|Timestamp|Notarization Ticket|TeamIdentifier)[ =]' <<<"$info" \
    | sed "s/^/  $name: /" || true
  problem=$(signature_problem "$info" "$TEAM" "$DRY_RUN_NAME")
  [ -z "$problem" ] || fail "$name $problem"
  declared=$(plutil -extract DaylightAppGroup raw "$bundle/Contents/Info.plist" 2>/dev/null || true)
  [ "$declared" = "$GROUP" ] || fail "$name declares the App Group '$declared' (Info.plist DaylightAppGroup), not $GROUP"
  codesign -d --entitlements - --xml "$bundle" > "$WORK/$name.entitlements.plist" 2>/dev/null \
    || fail "$name: could not read its entitlements"
  problem=$(entitlements_problem "$WORK/$name.entitlements.plist" "$GROUP")
  [ -z "$problem" ] || fail "$name $problem"
  echo "  $name: entitlements $(plutil -convert json -o - "$WORK/$name.entitlements.plist")"
done

if [ -n "$DRY_RUN_NAME" ]; then
  note "dry run: signed by \"$DRY_RUN_NAME\" with the App Group $GROUP; not notarized, so no ticket to validate"
else
  xcrun stapler validate "$APP" || fail "the app has no valid notarization ticket stapled"
  note "signed by the team's Developer ID ($TEAM), App Group $GROUP, notarization ticket stapled"
fi
