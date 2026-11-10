#!/usr/bin/env bash
# Verify the SiriusX fork only touches the desktop shell and has no merge commits.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DSH_DIR="${DSH_DIR:-$ROOT/deepseek-harness}"
BASE="${BASE:-siriusx-s1-base}"
cd "$DSH_DIR"
FILES=$(git diff --name-only "$BASE"..HEAD)
COUNT=$(printf '%s\n' "$FILES" | sed '/^$/d' | wc -l | tr -d ' ')
MERGES=$(git rev-list --merges "$BASE"..HEAD)
OUTSIDE=$(printf '%s\n' "$FILES" | sed '/^$/d' | grep -v '^apps/desktop/' || true)
echo "base=$BASE head=$(git rev-parse --short HEAD) files=$COUNT"
printf '%s\n' "$FILES"
[ "$COUNT" -lt 10 ] || { echo "fork touches 10+ files" >&2; exit 1; }
[ -z "$OUTSIDE" ] || { echo "fork touches files outside apps/desktop:" >&2; printf '%s\n' "$OUTSIDE" >&2; exit 1; }
[ -z "$MERGES" ] || { echo "fork history contains merge commits" >&2; printf '%s\n' "$MERGES" >&2; exit 1; }
echo "fork discipline OK"
