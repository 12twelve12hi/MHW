#!/usr/bin/env bash
# CI: selects the newest stable Xcode on the runner whose iOS simulator platform is installed (Xcode 15 -> iOS 17,
# 16 -> 18, 26 -> 26), so iOS builds do not stop at "iOS xx is not installed". Falls back to the image's default.
set -euo pipefail
ls -d /Applications/Xcode*.app
RUNTIMES=$(xcrun simctl list runtimes 2>/dev/null | sed -nE 's/^iOS ([0-9]+)\..*/\1/p' | sort -u || true)
echo "iOS simulator runtimes: $(echo $RUNTIMES)"
CHOSEN=""
for X in $(ls -d /Applications/Xcode_*.app | grep -viE 'beta|_rc|release.candidate' \
           | sed -nE 's|^/Applications/Xcode_([0-9]+(\.[0-9]+)*)\.app$|\1|p' | sort -t. -k1,1nr -k2,2nr -k3,3nr); do
  MAJOR=${X%%.*}
  case "$MAJOR" in 15) IOS=17 ;; 16) IOS=18 ;; *) IOS=$MAJOR ;; esac
  if echo "$RUNTIMES" | grep -qx "$IOS"; then CHOSEN=$X; break; fi
done
if [ -n "$CHOSEN" ]; then
  sudo xcode-select -s "/Applications/Xcode_${CHOSEN}.app"
else
  echo "::warning::no Xcode with a matching iOS runtime; keeping the default $(xcode-select -p)"
fi
xcodebuild -version
swift --version
