#!/usr/bin/env bash
# Create electron-updater channel metadata for a directory of signed artifacts.
set -euo pipefail
ARTIFACT_DIR="${ARTIFACT_DIR:?set ARTIFACT_DIR}"
VERSION="${VERSION:?set VERSION}"
CHANNEL="${CHANNEL:-stable}"
FILE="${FILE:?set FILE (artifact filename relative to ARTIFACT_DIR)}"
PATH_ARTIFACT="$ARTIFACT_DIR/$FILE"
[ -f "$PATH_ARTIFACT" ] || { echo "missing artifact $PATH_ARTIFACT" >&2; exit 1; }
SHA=$(openssl dgst -sha512 -binary "$PATH_ARTIFACT" | base64 -w0)
SIZE=$(stat -c %s "$PATH_ARTIFACT")
DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
for name in "${CHANNEL}.yml" "${CHANNEL}-mac.yml"; do
  cat > "$ARTIFACT_DIR/$name" <<YML
version: $VERSION
files:
  - url: $FILE
    sha512: $SHA
    size: $SIZE
path: $FILE
sha512: $SHA
releaseDate: $DATE
YML
done
sha256sum "$ARTIFACT_DIR"/*.yml > "$ARTIFACT_DIR/feed-sha256.txt"
echo "wrote $ARTIFACT_DIR/${CHANNEL}.yml and ${CHANNEL}-mac.yml"
