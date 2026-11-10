#!/usr/bin/env bash
set -euo pipefail
ROOT="${ROOT:-/root/siriusx}"
REPO="${REPO:-$ROOT/deepseek-harness}"
SECRET=s9-cloud-project-secret
CP=/tmp/s9-cloud-project-cp
H=/tmp/siriusx-s9-cloud-project-home
rm -rf "$CP" "$H"; mkdir -p "$CP"
cd "$ROOT"
pkill -f 'apps/control-plane/src/cli.ts serve' 2>/dev/null || true
pkill -f 'apps/web-gateway/src/cli.ts' 2>/dev/null || true
pkill -f 'apps/cli/lib/bin.js --profile s9cloudweb' 2>/dev/null || true
sleep 0.5
A=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts tenant create --db "$CP/control.sqlite" --data-dir "$CP/data" --name Cloud --issuer https://idp.example --admin-email admin@cloud.example --tenant-id tenant-cloud)
AID=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
TOKEN=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts token issue --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-cloud --user "$AID" --role admin)
SIRIUSX_SESSION_SECRET=$SECRET SIRIUSX_SANDBOX_IMAGE=teams-bridge:0.2.0 setsid /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts serve --db "$CP/control.sqlite" --data-dir "$CP/data" --port 4320 >/tmp/s9-cloud-project-cp.log 2>/tmp/s9-cloud-project-cp.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4320/health >/dev/null && break; sleep 0.1; done
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s9cloudweb --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s9cloudweb add \
  link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/brand-siriusx" link:"$ROOT/plugins/client-ui-team" >/tmp/s9-cloud-project-add.log 2>&1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" DSH_TELEMETRY_DISABLED=1 setsid node apps/cli/lib/bin.js --profile s9cloudweb --no-open --host 127.0.0.1 --port 0 >/tmp/s9-cloud-project-dsh.log 2>/tmp/s9-cloud-project-dsh.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s9-cloud-project-dsh.log && break; sleep 0.1; done
DSH_URL=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s9-cloud-project-dsh.log)
cd "$ROOT"
setsid /opt/node24/bin/node --import tsx apps/web-gateway/src/cli.ts --control-plane http://127.0.0.1:4320 --dsh-web "$DSH_URL" --port 8080 >/tmp/s9-cloud-project-gateway.log 2>/tmp/s9-cloud-project-gateway.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:8080/health >/dev/null && break; sleep 0.1; done
TOKEN="$TOKEN" /opt/node24/bin/node "$ROOT/evidence/S9/04-cloud-project/ui-cloud.mjs"
