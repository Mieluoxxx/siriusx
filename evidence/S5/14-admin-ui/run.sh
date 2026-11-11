#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/siriusx
REPO=$ROOT/deepseek-harness
SECRET=s5-admin-ui-secret
CP=/tmp/s5-admin-ui-cp
H=/tmp/s5-admin-ui-home
rm -rf "$CP" "$H"; mkdir -p "$CP"
pkill -9 -f 's5adminui' 2>/dev/null || true
pkill -9 -f 'apps/control-plane/src/cli.ts serve.*4325' 2>/dev/null || true
cd "$ROOT"
A=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts tenant create --db "$CP/control.sqlite" --data-dir "$CP/data" --name AdminUI --issuer https://idp.example --admin-email admin@admin.example --tenant-id tenant-admin-ui)
AID=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts user add --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-admin-ui --email member@admin.example --role member >/dev/null
TOKEN=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts token issue --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-admin-ui --user "$AID" --role admin)
SIRIUSX_SESSION_SECRET=$SECRET SIRIUSX_PLATFORM_ADMIN_TOKEN=platform-secret setsid /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts serve --db "$CP/control.sqlite" --data-dir "$CP/data" --port 4325 >/tmp/s5-admin-ui-cp.log 2>/tmp/s5-admin-ui-cp.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4325/health >/dev/null && break; sleep 0.1; done
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s5adminui --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s5adminui add link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/brand-siriusx" link:"$ROOT/plugins/client-ui-team" >/tmp/s5-admin-ui-add.log 2>&1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" DSH_TELEMETRY_DISABLED=1 setsid node apps/cli/lib/bin.js --profile s5adminui --no-open --host 127.0.0.1 --port 0 >/tmp/s5-admin-ui-dsh.log 2>/tmp/s5-admin-ui-dsh.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s5-admin-ui-dsh.log && break; sleep 0.1; done
DSH_URL=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s5-admin-ui-dsh.log)
DSH_URL="$DSH_URL" TOKEN="$TOKEN" /opt/node24/bin/node "$ROOT/evidence/S5/14-admin-ui/ui-admin.mjs"
