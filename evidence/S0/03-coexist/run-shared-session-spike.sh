#!/usr/bin/env bash
# Reproduce the same-Session UI/Executor concurrency probe.
set -euo pipefail
REPO="${REPO:-/root/siriusx/deepseek-harness}"
HERE="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$HERE/node_modules"
ln -sfn "$REPO/packages/test-support/agent-loop-testkit/node_modules" "$HERE/node_modules"
cd "$HERE"
"$REPO/node_modules/.bin/tsx" shared-session-spike.ts
