#!/usr/bin/env bash
# 10-minute offline soak: repeatedly complete local-mock conversations while
# tracing every connect(2). A passing run has no non-loopback AF_INET connect.
set -euo pipefail
REPO="${REPO:-/root/siriusx/deepseek-harness}"
HOME_DIR="${HOME_DIR:-/tmp/siriusx-s1-home}"
DURATION="${DURATION:-600}"
TRACE="${TRACE:-/tmp/siriusx-s1-soak.trace}"
OUT="${OUT:-/tmp/siriusx-s1-soak.out}"
MOCK_LOG="${MOCK_LOG:-/tmp/siriusx-s1-soak-mock.jsonl}"

pkill -f 'mock-llm-server.mjs' 2>/dev/null || true
rm -f "$TRACE" "$OUT" "$MOCK_LOG"
MOCK_LOG="$MOCK_LOG" PORT=18081 node /root/siriusx/evidence/S1/02-conversation/mock-llm-server.mjs >/tmp/siriusx-s1-soak-mock.log 2>&1 &
MOCK_PID=$!
trap 'kill "$MOCK_PID" 2>/dev/null || true' EXIT
sleep 1

start=$(date +%s)
while (( $(date +%s) - start < DURATION )); do
  PATH=/opt/node24/bin:$PATH DSH_HOME="$HOME_DIR" SIRIUSX_MOCK_KEY=local-test DSH_TELEMETRY_DISABLED=1 \
    strace -f -e trace=connect -o "$TRACE" \
    node "$REPO/apps/cli/lib/bin.js" --profile offline "Offline soak $(date +%s): reply with S1 soak OK" >>"$OUT" 2>&1 || exit 1
  sleep 20
done

nonloopback=$(grep -E 'connect\(.*AF_INET' "$TRACE" | grep -v '127\.0\.0\.1' | grep -vc '::1' || true)
printf 'duration_seconds=%s\nnonloopback_inet_connects=%s\n' "$DURATION" "$nonloopback"
test "$nonloopback" -eq 0
