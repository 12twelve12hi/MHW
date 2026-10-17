#!/bin/sh
# Xcode build phase of the Safari Web Extension targets: copies the shared WebExtension (built by
# reader-experiment/extension, `npm run build` -> dist/safari) into the extension bundle being built. Without that
# build, a small placeholder goes in so the project still builds.
set -eu
APPLE_DIR="${SRCROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SRC="$APPLE_DIR/../extension/dist/safari"
if [ ! -f "$SRC/manifest.json" ]; then
  echo "warning: no Safari build of the web extension at $SRC (run: cd reader-experiment/extension && npm run build); using the placeholder."
  SRC="$APPLE_DIR/WebExtensionPlaceholder"
fi
DEST="${TARGET_BUILD_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}"
mkdir -p "$DEST"
rsync -a --exclude '.DS_Store' "$SRC/" "$DEST/"
echo "Copied the web extension from $SRC to $DEST"
