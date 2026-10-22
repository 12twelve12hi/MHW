#!/usr/bin/env bash
# Signs Send to Daylight for Mac with a Developer ID (README › Signing): imports the certificate into a temporary
# keychain, signs the Share and Safari extensions and then the app, each with its own entitlements (the team's App
# Group), the hardened runtime and a secure timestamp, checks every bundle, notarizes, staples, asks Gatekeeper and
# zips the app.
#
#   scripts/sign-mac.sh [--dry-run] <Send to Daylight.app> <team id> <out.zip>
#
# The app must be a Release build made for the team but not signed, as CI's mac-developer-id job makes it:
#
#   xcodebuild -project SendToDaylight.xcodeproj -scheme SendToDaylight-macOS -configuration Release \
#     DEVELOPMENT_TEAM=<team id> CODE_SIGN_STYLE=Manual CODE_SIGNING_ALLOWED=NO build
#
# With a team, Config/Base.xcconfig gives the Mac targets the App Group <TEAMID>.com.daylight.share: each bundle's
# Info.plist names it (DaylightAppGroup, which SharedStore reads) and each target's entitlements file is the -AppGroup
# one. This script fills that group into the entitlements and checks that all of them agree.
#
# Environment:
#   MAC_DEVELOPER_ID_P12           the "Developer ID Application" certificate with its private key: a .p12, base64
#   MAC_DEVELOPER_ID_P12_PASSWORD  the .p12's password
#   ASC_KEY_ID, ASC_ISSUER_ID      an App Store Connect API key, for notarization
#   ASC_KEY_P8                     the contents of that key's AuthKey_<ASC_KEY_ID>.p8 file
#   SIGN_MAC_PROJECT               the Xcode project the app was built from (default: SendToDaylight.xcodeproj)
#   SIGN_MAC_APP_GROUP             the App Group to expect (default: <team id>.com.daylight.share); set it only when
#                                  Signing.local.xcconfig sets DAYLIGHT_MAC_APP_GROUP_TEAM
#
# --dry-run (CI, until the signing secrets exist): the .p12 may hold any code-signing identity (CI makes a throwaway
# self-signed one), whose signature carries no Team ID, and the ASC_* variables are not read. Notarization, stapling
# and the Gatekeeper check are skipped; everything else is what the release does.
#
# macOS only (security, codesign, notarytool, stapler, spctl, ditto). Works with macOS's own bash 3.2.
set -euo pipefail

fail() { echo "::error::sign-mac: $*" >&2; exit 1; }
note() { echo "sign-mac: $*"; }

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=true; shift; fi
if [ $# -ne 3 ]; then
  echo "usage: $0 [--dry-run] <Send to Daylight.app> <team id> <out.zip>" >&2
  exit 2
fi
[ -d "$1/Contents" ] || fail "$1 is not an app bundle"
APP="$(cd "$1" && pwd)"
TEAM=$2
OUT="$(cd "$(dirname "$3")" && pwd)/$(basename "$3")"
cd "$(dirname "$0")/.."
PROJECT=${SIGN_MAC_PROJECT:-SendToDaylight.xcodeproj}
GROUP=${SIGN_MAC_APP_GROUP:-$TEAM.com.daylight.share}
SHARE="$APP/Contents/PlugIns/ShareExtension.appex"
SAFARI="$APP/Contents/PlugIns/SafariExtension.appex"

[[ $TEAM =~ ^[A-Z0-9]{10}$ ]] || fail "'$TEAM' is not a Team ID (10 letters and digits: developer.apple.com › Account › Membership details)"
case "$GROUP" in "$TEAM".*) ;; *) fail "the App Group $GROUP must start with the Team ID $TEAM. (SharedStore, Config/Base.xcconfig)" ;; esac
[ -d "$PROJECT" ] || fail "no $PROJECT here (run xcodegen in reader-experiment/apple first)"
for bundle in "$SHARE" "$SAFARI"; do [ -d "$bundle" ] || fail "the app has no $(basename "$bundle")"; done
for name in MAC_DEVELOPER_ID_P12 MAC_DEVELOPER_ID_P12_PASSWORD; do [ -n "${!name:-}" ] || fail "$name is not set"; done
if ! $DRY_RUN; then
  for name in ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_P8; do [ -n "${!name:-}" ] || fail "$name is not set"; done
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/sign-mac.XXXXXX")
KEYCHAIN="$WORK/sign-mac.keychain-db"
KEYCHAIN_LISTED=false
cleanup() {
  if $KEYCHAIN_LISTED; then
    # The keychain search list as it was.
    local saved=()
    local line
    while IFS= read -r line; do saved+=("$line"); done < "$WORK/search-list"
    security list-keychains -d user -s ${saved[@]+"${saved[@]}"} || true
  fi
  security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# ---- 1. The certificate, in a temporary keychain of its own ----------------------------------------------------------
KEYCHAIN_PASSWORD=$(uuidgen)
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 7200 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
printf '%s' "$MAC_DEVELOPER_ID_P12" | tr -d ' \t\r\n' > "$WORK/certificate.b64"
base64 --decode < "$WORK/certificate.b64" > "$WORK/certificate.p12" 2>/dev/null \
  || fail "MAC_DEVELOPER_ID_P12 is not base64 (make it with: base64 -i DeveloperID.p12)"
[ -s "$WORK/certificate.p12" ] || fail "MAC_DEVELOPER_ID_P12 is empty"
security import "$WORK/certificate.p12" -k "$KEYCHAIN" -f pkcs12 -P "$MAC_DEVELOPER_ID_P12_PASSWORD" \
    -T /usr/bin/codesign -T /usr/bin/security >/dev/null \
  || fail "could not import MAC_DEVELOPER_ID_P12 (is MAC_DEVELOPER_ID_P12_PASSWORD the password it was exported with?)"
# codesign may use the key without a prompt.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
# Apple's Developer ID intermediates, so the signature carries the whole chain even when the .p12 has only the
# certificate (the system may have them too).
for ca in DeveloperIDG2CA DeveloperIDCA; do
  if curl -fsSL --retry 3 -o "$WORK/$ca.cer" "https://www.apple.com/certificateauthority/$ca.cer"; then
    security import "$WORK/$ca.cer" -k "$KEYCHAIN" >/dev/null 2>&1 || true
  else
    echo "::warning::could not download Apple's $ca certificate; relying on the system's copy"
  fi
done
# On the search list, where codesign looks for the rest of the chain.
security list-keychains -d user | sed -E 's/^[[:space:]]*"(.*)"[[:space:]]*$/\1/' > "$WORK/search-list"
KEYCHAIN_LISTED=true
keychains=("$KEYCHAIN")
while IFS= read -r line; do keychains+=("$line"); done < "$WORK/search-list"
security list-keychains -d user -s "${keychains[@]}"

# The one code-signing identity the .p12 brought (listed with its trust status: a dry run's is self-signed).
security find-identity -p codesigning "$KEYCHAIN" > "$WORK/identities.txt" || true
sed -nE 's/^[[:space:]]*[0-9]+\) ([0-9A-F]{40}) "(.*)".*$/\1 \2/p' "$WORK/identities.txt" | sort -u > "$WORK/all.txt"
if $DRY_RUN; then
  cp "$WORK/all.txt" "$WORK/chosen.txt"
else
  grep -E '^[0-9A-F]{40} Developer ID Application: ' "$WORK/all.txt" > "$WORK/chosen.txt" || true
fi
if [ "$(wc -l < "$WORK/chosen.txt" | tr -d ' ')" != 1 ]; then
  cat "$WORK/identities.txt"
  fail "MAC_DEVELOPER_ID_P12 must hold exactly one \"Developer ID Application\" certificate with its private key"
fi
IDENTITY=$(cut -d' ' -f1 "$WORK/chosen.txt")
IDENTITY_NAME=$(cut -d' ' -f2- "$WORK/chosen.txt")
if ! $DRY_RUN; then
  case "$IDENTITY_NAME" in
    *"($TEAM)") ;;
    *) fail "the certificate \"$IDENTITY_NAME\" is not for the team in APPLE_TEAM_ID" ;;
  esac
fi
note "imported into a temporary keychain: \"$IDENTITY_NAME\" ($IDENTITY)"

# ---- 2. Each target's entitlements for this team, with the App Group filled in ---------------------------------------
entitlements() {  # <target> <out.plist>
  local settings file group
  settings=$(xcodebuild -project "$PROJECT" -target "$1" -configuration Release -showBuildSettings \
               DEVELOPMENT_TEAM="$TEAM" 2>"$WORK/xcodebuild.log") \
    || { cat "$WORK/xcodebuild.log" >&2; fail "$1: could not read its build settings"; }
  file=$(printf '%s\n' "$settings" | sed -n 's/^ *CODE_SIGN_ENTITLEMENTS = //p')
  group=$(printf '%s\n' "$settings" | sed -n 's/^ *DAYLIGHT_MAC_APP_GROUP = //p')
  if [ -z "$file" ] || [ ! -f "$file" ]; then fail "$1: no entitlements file ('$file')"; fi
  [ "$group" = "$GROUP" ] || fail "$1: the build settings give the App Group '$group' for team $TEAM, not $GROUP"
  sed "s/\$(DAYLIGHT_MAC_APP_GROUP)/$group/g" "$file" > "$2"
  # shellcheck disable=SC2016  # a literal "$(", the start of a build setting left unexpanded
  if grep -qF '$(' "$2"; then fail "$1: $file uses a build setting this script does not fill in"; fi
  plutil -lint "$2" >/dev/null
  note "$1: $file with the App Group $group"
}
entitlements SendToDaylight-macOS "$WORK/app.entitlements"
entitlements ShareExtension-macOS "$WORK/share.entitlements"
entitlements SafariExtension-macOS "$WORK/safari.entitlements"
# The group each bundle's code will open (Info.plist DaylightAppGroup) is the one its entitlements grant.
for bundle in "$APP" "$SHARE" "$SAFARI"; do
  declared=$(plutil -extract DaylightAppGroup raw "$bundle/Contents/Info.plist" 2>/dev/null || true)
  [ "$declared" = "$GROUP" ] \
    || fail "$(basename "$bundle") declares the App Group '$declared', not $GROUP: build it with DEVELOPMENT_TEAM=$TEAM"
done

# ---- 3. Sign, inside out: nested code, the extensions, then the app --------------------------------------------------
sign() {  # <code> [entitlements]
  local args=(--force --sign "$IDENTITY" --keychain "$KEYCHAIN" --options runtime --timestamp)
  local attempt
  if [ -n "${2:-}" ]; then args+=(--entitlements "$2"); fi
  for attempt in 1 2 3; do
    if codesign "${args[@]}" "$1"; then return 0; fi
    echo "codesign failed on $1 (attempt $attempt; the timestamp service may be busy)" >&2
    sleep $((attempt * 10))
  done
  fail "could not sign $1"
}
while IFS= read -r -d '' code; do
  case "$code" in
    "$SHARE") sign "$code" "$WORK/share.entitlements" ;;
    "$SAFARI") sign "$code" "$WORK/safari.entitlements" ;;
    *.appex|*.app|*.xpc) fail "${code#"$APP"/}: an extension or helper this script has no entitlements for" ;;
    *) sign "$code" ;;
  esac
done < <(find "$APP/Contents" -depth \( -type d \( -name '*.appex' -o -name '*.app' -o -name '*.xpc' -o -name '*.framework' \) \
                                         -o -type f -name '*.dylib' \) -print0)
sign "$APP" "$WORK/app.entitlements"
note "signed every bundle with \"$IDENTITY_NAME\", the hardened runtime and a secure timestamp"

# ---- 4. Check every bundle -------------------------------------------------------------------------------------------
same_plist() {  # <a> <b>: the same property list, whatever its format
  python3 - "$1" "$2" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as a, open(sys.argv[2], 'rb') as b:
    sys.exit(0 if plistlib.load(a) == plistlib.load(b) else 1)
PY
}
check() {  # <bundle> <the entitlements it was signed with> <name>
  local info
  local embedded="$WORK/$3.embedded.plist"
  codesign --verify --strict --verbose=2 "$1"
  info=$(codesign -dvvv "$1" 2>&1)
  grep -E '^(Identifier|CodeDirectory|Authority|Timestamp|Signed Time|TeamIdentifier)' <<<"$info" | sed "s/^/  $3: /"
  grep -qE '^CodeDirectory .*flags=0x[0-9a-f]+\([^)]*runtime' <<<"$info" || fail "$3 has no hardened runtime"
  grep -q '^Timestamp=' <<<"$info" || fail "$3 has no secure timestamp"
  if ! $DRY_RUN; then
    grep -qx "TeamIdentifier=$TEAM" <<<"$info" || fail "$3 is not signed by the team in APPLE_TEAM_ID"
    grep -q '^Authority=Developer ID Application: ' <<<"$info" || fail "$3 is not signed with a Developer ID"
  fi
  # The entitlements actually embedded in the signature.
  codesign -d --entitlements - --xml "$1" > "$embedded" 2>/dev/null || fail "$3: could not read its entitlements"
  echo "  $3: entitlements $(plutil -convert json -o - "$embedded")"
  same_plist "$2" "$embedded" || fail "$3: the embedded entitlements are not the ones it was signed with"
  [ "$(plutil -extract com.apple.security.app-sandbox raw "$embedded" 2>/dev/null)" = true ] || fail "$3 is not sandboxed"
  [ "$(plutil -extract com.apple.security.application-groups.0 raw "$embedded" 2>/dev/null)" = "$GROUP" ] \
    || fail "$3 is not entitled to the App Group $GROUP"
  if plutil -extract com.apple.security.application-groups.1 raw "$embedded" >/dev/null 2>&1; then
    fail "$3 is entitled to more than one App Group"
  fi
  if [ "$(plutil -extract com.apple.security.get-task-allow raw "$embedded" 2>/dev/null || true)" = true ]; then
    fail "$3 allows debugging (get-task-allow), which notarization refuses"
  fi
}
codesign --verify --deep --strict --verbose=2 "$APP"
check "$SHARE" "$WORK/share.entitlements" ShareExtension
check "$SAFARI" "$WORK/safari.entitlements" SafariExtension
check "$APP" "$WORK/app.entitlements" App
note "the app, its Share menu item and its Safari extension share the App Group $GROUP"

# ---- 5. Notarize, staple, Gatekeeper ---------------------------------------------------------------------------------
SUBMISSION=""
if $DRY_RUN; then
  note "dry run: no notarization or stapling. Gatekeeper's view of a self-signed app, for the record:"
  spctl -a -vv -t exec "$APP" 2>&1 | sed 's/^/  /' || true
else
  KEY="$WORK/AuthKey_$ASC_KEY_ID.p8"
  (umask 077 && printf '%s\n' "$ASC_KEY_P8" > "$KEY")
  auth=(--key "$KEY" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID")
  ditto -c -k --keepParent "$APP" "$WORK/notarize.zip"
  note "submitting to Apple's notary service and waiting for its answer"
  status=0
  xcrun notarytool submit "$WORK/notarize.zip" "${auth[@]}" --wait --timeout 45m --output-format json \
    > "$WORK/notary.json" 2> "$WORK/notary.err" || status=$?
  SUBMISSION=$(plutil -extract id raw "$WORK/notary.json" 2>/dev/null || true)
  verdict=$(plutil -extract status raw "$WORK/notary.json" 2>/dev/null || true)
  if [ "$verdict" != Accepted ]; then
    cat "$WORK/notary.json" "$WORK/notary.err" >&2 || true
    if [ -n "$SUBMISSION" ]; then
      echo "Notary log for $SUBMISSION:" >&2
      xcrun notarytool log "$SUBMISSION" "${auth[@]}" >&2 || true
    fi
    fail "notarization did not succeed (status '${verdict:-none}', notarytool exit $status)"
  fi
  note "notarized: submission $SUBMISSION, Accepted"
  # The ticket can take a moment to be served after the notary accepts the app.
  for attempt in 1 2 3 4 5; do
    if xcrun stapler staple "$APP"; then break; fi
    [ "$attempt" = 5 ] && fail "could not staple the notarization ticket"
    sleep $((attempt * 15))
  done
  xcrun stapler validate "$APP"
  codesign --verify --deep --strict --verbose=2 "$APP"
  gatekeeper=$(spctl -a -vv -t exec "$APP" 2>&1) || { echo "$gatekeeper" >&2; fail "Gatekeeper rejects the app"; }
  echo "$gatekeeper"
  case "$gatekeeper" in
    *"source=Notarized Developer ID"*) ;;
    *) echo "::warning::Gatekeeper accepted the app without naming it a notarized Developer ID app (is assessment off on this Mac?)" ;;
  esac
fi

# ---- 6. Zip ----------------------------------------------------------------------------------------------------------
rm -f "$OUT"
ditto -c -k --keepParent "$APP" "$OUT"
note "$(ls -l "$OUT")"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  if $DRY_RUN; then
    {
      echo "### Mac Developer ID path: dry run"
      echo "No signing secrets yet, so the release stays ad-hoc signed. A throwaway self-signed certificate went through"
      echo "the release's steps: imported into a temporary keychain; the Share extension, the Safari extension and the app"
      echo "signed with the hardened runtime and a secure timestamp; each bundle's embedded entitlements checked, with the"
      echo "App Group \`$GROUP\` (the dry run's stand-in team). Notarization and stapling skipped."
    } >> "$GITHUB_STEP_SUMMARY"
  else
    {
      echo "### Mac release: Developer ID"
      echo "Signed with \"$IDENTITY_NAME\" (hardened runtime, secure timestamp), notarized (submission \`$SUBMISSION\`),"
      echo "stapled and accepted by Gatekeeper. The app, its Share menu item and its Safari extension share the App Group"
      echo "\`$GROUP\`. Zipped as \`$(basename "$OUT")\`."
    } >> "$GITHUB_STEP_SUMMARY"
  fi
fi
