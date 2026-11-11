#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/siriusx
REPO=$ROOT/deepseek-harness
SECRET=s5-device-ui-secret
CP=/tmp/s5-device-ui-cp
H=/tmp/s5-device-ui-home
rm -rf "$CP" "$H"; mkdir -p "$CP"
pkill -9 -f 's5devices' 2>/dev/null || true
pkill -9 -f 'apps/control-plane/src/cli.ts serve.*4321' 2>/dev/null || true
cd "$ROOT"
A=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts tenant create --db "$CP/control.sqlite" --data-dir "$CP/data" --name DeviceUI --issuer https://idp.example --admin-email admin@device.example --tenant-id tenant-device-ui)
AID=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
TOKEN=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts token issue --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-device-ui --user "$AID" --role admin)
SIRIUSX_SESSION_SECRET=$SECRET setsid /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts serve --db "$CP/control.sqlite" --data-dir "$CP/data" --port 4321 >/tmp/s5-device-ui-cp.log 2>/tmp/s5-device-ui-cp.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4321/health >/dev/null && break; sleep 0.1; done
# pair a device through the public API
CODE=$(curl -sf -X POST http://127.0.0.1:4321/v1/devices/pair/start -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"iPhone"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["code"])')
curl -sf -X POST http://127.0.0.1:4321/v1/devices/pair/confirm -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}" >/dev/null
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s5devices --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s5devices add link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/brand-siriusx" link:"$ROOT/plugins/client-ui-team" >/tmp/s5-device-ui-add.log 2>&1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" DSH_TELEMETRY_DISABLED=1 setsid node apps/cli/lib/bin.js --profile s5devices --no-open --host 127.0.0.1 --port 0 >/tmp/s5-device-ui-dsh.log 2>/tmp/s5-device-ui-dsh.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s5-device-ui-dsh.log && break; sleep 0.1; done
DSH_URL=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s5-device-ui-dsh.log)
DSH_URL="$DSH_URL" TOKEN="$TOKEN" /opt/node24/bin/node "$ROOT/evidence/S5/09-device-ui/ui-device.mjs"
