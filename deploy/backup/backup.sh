#!/usr/bin/env bash
# Back up SiriusX SQLite databases and the optional DSH home directory.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA_DIRS="${SIRIUSX_DATA_DIRS:-${SIRIUSX_DATA_DIR:-${1:-}}}"
OUT_DIR="${BACKUP_DIR:-${2:-}}"
if [[ -z "$DATA_DIRS" || -z "$OUT_DIR" ]]; then
  echo "usage: SIRIUSX_DATA_DIRS=<dir[:dir...]> BACKUP_DIR=<out> $0" >&2
  exit 2
fi
IFS=: read -r -a DATA_DIR_LIST <<< "$DATA_DIRS"
NODE_BIN="${NODE_BIN:-node}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/payload" "$OUT_DIR"
copy_sqlite() {
  local name="$1"
  for dir in "${DATA_DIR_LIST[@]}"; do
    if [[ -f "$dir/$name" ]]; then
      "$NODE_BIN" "$ROOT/deploy/backup/sqlite-backup.mjs" "$dir/$name" "$WORK/payload/$name"
      return
    fi
  done
}
copy_sqlite control.sqlite
copy_sqlite tool-gateway.sqlite
for dir in "${DATA_DIR_LIST[@]}"; do
  if [[ -d "$dir/dsh-home" && ! -d "$WORK/payload/dsh-home" ]]; then cp -a "$dir/dsh-home" "$WORK/payload/dsh-home"; fi
  if [[ -f "$dir/dsh-web-url" && ! -f "$WORK/payload/dsh-web-url" ]]; then cp "$dir/dsh-web-url" "$WORK/payload/dsh-web-url"; fi
done
(
  cd "$WORK/payload"
  find . -type f -print0 | sort -z | xargs -0 sha256sum > ../SHA256SUMS
)
ARCHIVE="$OUT_DIR/siriusx-backup-$STAMP.tar.gz"
tar -C "$WORK" -czf "$ARCHIVE" payload SHA256SUMS
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
KEEP="${KEEP:-7}"
if [[ "$KEEP" =~ ^[0-9]+$ ]] && (( KEEP > 0 )); then
  mapfile -t OLD < <(find "$OUT_DIR" -maxdepth 1 -type f -name 'siriusx-backup-*.tar.gz' -printf '%T@ %p\n' | sort -nr | tail -n +$((KEEP + 1)) | cut -d' ' -f2-)
  for file in "${OLD[@]}"; do [[ -f "$file" ]] && rm -f "$file" "$file.sha256"; done
fi
printf '%s\n' "$ARCHIVE"
