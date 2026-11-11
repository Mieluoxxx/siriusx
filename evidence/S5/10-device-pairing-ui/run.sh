#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/siriusx
REPO=$ROOT/deepseek-harness
SECRET=s5-pairing-ui-secret
CP=/tmp/s5-pairing-ui-cp
H=/tmp/s5-pairing-ui-home
rm -rf "$CP" "$H"; mkdir -p "$CP"
pkill -9 -f 's5pairui' 2>/dev/null || true
pkill -9 -f 'apps/control-plane/src/cli.ts serve.*4324' 2>/dev/null || true
cd "$ROOT"
A=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts tenant create --db "$CP/control.sqlite" --data-dir "$CP/data" --name PairUI --issuer https://idp.example --admin-email admin@pairui.example --tenant-id tenant-pair-ui)
AID=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
TOKEN=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts token issue --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-pair-ui --user "$AID" --role admin)
SIRIUSX_SESSION_SECRET=$SECRET setsid /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts serve --db "$CP/control.sqlite" --data-dir "$CP/data" --port 4324 >/tmp/s5-pairing-ui-cp.log 2>/tmp/s5-pairing-ui-cp.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4324/health >/dev/null && break; sleep 0.1; done
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s5pairui --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s5pairui add link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/brand-siriusx" link:"$ROOT/plugins/client-ui-team" >/tmp/s5-pairing-ui-add.log 2>&1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" DSH_TELEMETRY_DISABLED=1 setsid node apps/cli/lib/bin.js --profile s5pairui --no-open --host 127.0.0.1 --port 0 >/tmp/s5-pairing-ui-dsh.log 2>/tmp/s5-pairing-ui-dsh.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s5-pairing-ui-dsh.log && break; sleep 0.1; done
DSH_URL=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s5-pairing-ui-dsh.log)
DSH_URL="$DSH_URL" TOKEN="$TOKEN" /opt/node24/bin/node "$ROOT/evidence/S5/10-device-pairing-ui/ui-pairing.mjs"
