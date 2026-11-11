#!/usr/bin/env bash
# Syntax-check tracked shell and ESM scripts without executing them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
checked_sh=0
checked_mjs=0
while IFS= read -r file; do
  bash -n "$file"
  if grep -q $'\r' "$file"; then
    echo "CRLF line endings: $file" >&2
    exit 1
  fi
  checked_sh=$((checked_sh + 1))
done < <(git ls-files '*.sh')
while IFS= read -r file; do
  node --check "$file"
  checked_mjs=$((checked_mjs + 1))
done < <(git ls-files '*.mjs')
echo "script portability OK: $checked_sh shell, $checked_mjs ESM"
