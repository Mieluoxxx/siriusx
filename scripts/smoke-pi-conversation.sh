#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PATH="${PATH:-/usr/local/bin:/usr/bin:/bin}" node --import tsx scripts/smoke-pi-conversation.mts
