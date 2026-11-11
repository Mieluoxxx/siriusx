#!/usr/bin/env bash
# Restore a SiriusX backup into a data directory. Stop services first.
set -euo pipefail
ARCHIVE="${1:?usage: restore.sh <backup.tar.gz> <data-dir>}"
DATA_DIR="${2:?usage: restore.sh <backup.tar.gz> <data-dir>}"
if [[ ! -f "$ARCHIVE" ]]; then echo "backup not found: $ARCHIVE" >&2; exit 1; fi
SHA_FILE="$ARCHIVE.sha256"
if [[ -f "$SHA_FILE" ]]; then (cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$SHA_FILE")"); fi
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -C "$WORK" -xzf "$ARCHIVE"
if [[ ! -f "$WORK/SHA256SUMS" ]]; then echo "backup has no SHA256SUMS" >&2; exit 1; fi
(cd "$WORK/payload" && sha256sum -c ../SHA256SUMS)
mkdir -p "$DATA_DIR"
for file in control.sqlite tool-gateway.sqlite dsh-web-url; do
  if [[ -f "$WORK/payload/$file" ]]; then cp -a "$WORK/payload/$file" "$DATA_DIR/$file"; fi
done
if [[ -d "$WORK/payload/dsh-home" ]]; then
  rm -rf "$DATA_DIR/dsh-home"
  cp -a "$WORK/payload/dsh-home" "$DATA_DIR/dsh-home"
fi
# A restored SQLite snapshot must not be paired with a stale WAL/SHM file.
rm -f "$DATA_DIR"/control.sqlite-wal "$DATA_DIR"/control.sqlite-shm "$DATA_DIR"/tool-gateway.sqlite-wal "$DATA_DIR"/tool-gateway.sqlite-shm
printf 'restored %s into %s\n' "$ARCHIVE" "$DATA_DIR"
