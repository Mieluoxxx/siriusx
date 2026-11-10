#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/siriusx
REPO="$ROOT/deepseek-harness"
H=/tmp/siriusx-s4-four-home
rm -rf "$H"
cd "$ROOT"
pkill -9 -f 'apps/cli/lib/bin.js --profile s4four' 2>/dev/null || true
pkill -9 -f 'evidence/S4/03-four-panels/bot-api.mjs' 2>/dev/null || true
/opt/node24/bin/node "$ROOT/evidence/S4/03-four-panels/bot-api.mjs" >/tmp/s4-four-bot.log 2>&1 & sleep 0.3
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s4four --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s4four add \
  link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/brand-siriusx" \
  link:"$ROOT/plugins/client-ui-bots" link:"$ROOT/plugins/client-ui-tickets" \
  link:"$ROOT/plugins/client-ui-sessions" link:"$ROOT/plugins/client-ui-approvals" >/tmp/s4-four-add.log 2>&1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" DSH_TELEMETRY_DISABLED=1 setsid node apps/cli/lib/bin.js --profile s4four --no-open --host 127.0.0.1 --port 0 >/tmp/s4-four-dsh.log 2>/tmp/s4-four-dsh.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s4-four-dsh.log && break; sleep 0.1; done
DSH_URL=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s4-four-dsh.log)
DSH_URL="$DSH_URL" /opt/node24/bin/node $ROOT/evidence/S4/03-four-panels/ui-four.mjs
