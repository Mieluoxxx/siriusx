#!/usr/bin/env bash
# Real DSH ACP server + local mock model, driven by @siriusx/kernel-acp.
set -euo pipefail
ROOT="${ROOT:-/root/siriusx}"
REPO="${REPO:-$ROOT/deepseek-harness}"
H="${H:-/tmp/siriusx-s7-acp-home}"
cd "$ROOT"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node "$REPO/apps/cli/lib/bin.js" \
  --from-default-profile acp --profile dshacp --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node "$REPO/apps/cli/lib/bin.js" plugin --profile dshacp add \
  link:"$ROOT/plugins/telemetry-off" >/tmp/s7-acp-add.log 2>&1
cp "$ROOT/evidence/S7/03-real-dsh-acp/profile-patch.yml" "$H/profiles/dshacp/cordis.patch.yml"
pkill -f 'mock-llm-server.mjs' 2>/dev/null || true
MOCK_LOG=/tmp/s7-acp-mock.jsonl PORT=18081 setsid /opt/node24/bin/node \
  "$ROOT/evidence/S1/02-conversation/mock-llm-server.mjs" >/tmp/s7-acp-mock.log 2>&1 &
MOCK_PID=$!
trap 'kill "$MOCK_PID" 2>/dev/null || true' EXIT
sleep 1
/opt/node24/bin/node --import tsx "$ROOT/evidence/S7/03-real-dsh-acp/real-dsh-acp.ts"
