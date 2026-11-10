#!/usr/bin/env bash
# Run the real DSH AgentLoop + SiriusX LocalExecutor integration probe.
set -euo pipefail
REPO="${REPO:-/root/siriusx/deepseek-harness}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="$REPO/packages/test-support/agent-loop-testkit/tests/siriusx-s3-real.ts"
cp "$HERE/real-dsh.ts" "$TARGET"
trap 'rm -f "$TARGET"' EXIT
PATH=/opt/node24/bin:$PATH "$REPO/node_modules/.bin/tsx" "$TARGET"
