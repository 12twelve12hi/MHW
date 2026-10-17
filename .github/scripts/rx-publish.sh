#!/usr/bin/env bash
# Uploads build outputs to the "reader-experiment-latest" prerelease, creating it on first use.
# Usage: rx-publish.sh <file> [<file>...]   (needs GH_TOKEN and GH_REPO in the environment)
# Several workflows call this at once, so creation tolerates a race and uploads replace same-named assets.
set -euo pipefail
TAG="${RX_RELEASE_TAG:-reader-experiment-latest}"
TITLE="Reader experiment: Send to Daylight (latest builds)"
NOTES="Latest builds of the Send to Daylight apps from branch ${GITHUB_REF_NAME:-?}. See reader-experiment/README.md for what each file is and how to install it."

for attempt in 1 2 3 4 5; do
  if gh release view "$TAG" >/dev/null 2>&1; then break; fi
  gh release create "$TAG" --prerelease --target "${GITHUB_SHA:-HEAD}" --title "$TITLE" --notes "$NOTES" >/dev/null 2>&1 || true
  sleep $((attempt * 2))
done
gh release view "$TAG" >/dev/null

for f in "$@"; do
  for attempt in 1 2 3 4; do
    if gh release upload "$TAG" "$f" --clobber; then break; fi
    echo "upload of $f failed (attempt $attempt), retrying" >&2
    sleep $((attempt * 5))
  done
done
echo "Published to https://github.com/${GH_REPO}/releases/tag/${TAG}: $*"
