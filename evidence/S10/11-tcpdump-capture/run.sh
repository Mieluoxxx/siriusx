#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/siriusx
OUT="$ROOT/evidence/S10/11-tcpdump-capture"
PORT=14445
rm -f /tmp/s10-tcpdump.cap /tmp/s10-tcpdump.err
(timeout 30s tcpdump -i any -A -nn -l "tcp port $PORT" > /tmp/s10-tcpdump.cap 2>/tmp/s10-tcpdump.err) &
TPID=$!
sleep 0.8
set +e
DEVICE_GATEWAY_PORT=$PORT /opt/node24/bin/node --import tsx "$OUT/run.ts" > "$OUT/run.txt" 2> "$OUT/run.err.txt"
RC=$?
set -e
sleep 0.5
kill $TPID 2>/dev/null || true
wait $TPID 2>/dev/null || true
echo "WIRE_BYTES=$(wc -c < /tmp/s10-tcpdump.cap)" > "$OUT/capture.txt"
if grep -F -q 'LOCAL_SECRET_CODE_42' /tmp/s10-tcpdump.cap; then echo 'LEAK_DETECTED=true' >> "$OUT/capture.txt"; RC=1; else echo 'LEAK_DETECTED=false' >> "$OUT/capture.txt"; fi
grep -E 'packets captured|packets received' /tmp/s10-tcpdump.err >> "$OUT/capture.txt" || true
cat "$OUT/capture.txt"
exit $RC
