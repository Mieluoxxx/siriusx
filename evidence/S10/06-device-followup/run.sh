#!/usr/bin/env bash
set -euo pipefail
ROOT="${ROOT:-/root/siriusx}"
REPO="${REPO:-$ROOT/deepseek-harness}"
SECRET=s10-device-followup-secret
CP=/tmp/s10-device-followup-cp
WORK=/tmp/s10-device-followup-repo
mkdir -p "$CP"; rm -rf "$CP" "$WORK"
cd "$ROOT"
pkill -f 'apps/control-plane/src/cli.ts serve' 2>/dev/null || true
pkill -f 'apps/device-agent/src/cli.ts' 2>/dev/null || true
pkill -f 'apps/cli/lib/bin.js --profile s4web' 2>/dev/null || true
sleep 0.5
A=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts tenant create --db "$CP/control.sqlite" --data-dir "$CP/data" --name Acme --issuer https://idp.example --admin-email admin@acme.example --tenant-id tenant-acme)
AID=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
TOKEN=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts token issue --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-acme --user "$AID" --role admin)
SIRIUSX_SESSION_SECRET=$SECRET setsid /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts serve --db "$CP/control.sqlite" --data-dir "$CP/data" --port 4320 --device-port 4322 >/tmp/s10-device-followup-cp.log 2>/tmp/s10-device-followup-cp.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4320/health >/dev/null && break; sleep 0.1; done
PAIR=$(curl -sS -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"Followup Mac"}' http://127.0.0.1:4320/v1/devices/pair/start)
CODE=$(echo "$PAIR" | python3 -c 'import json,sys;print(json.load(sys.stdin)["code"])')
PAIRED=$(curl -sS -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}" http://127.0.0.1:4320/v1/devices/pair/confirm)
DEVICE_TOKEN=$(echo "$PAIRED" | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
setsid /opt/node24/bin/node --import tsx apps/device-agent/src/cli.ts --url ws://127.0.0.1:4322 --token "$DEVICE_TOKEN" >/tmp/s10-device-followup-agent.log 2>/tmp/s10-device-followup-agent.err < /dev/null &
sleep 0.5
mkdir "$WORK" && cd "$WORK" && git init -q && git config user.email test@example.com && git config user.name Test && echo one > app.txt && git add . && git commit -qm base
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME=/tmp/siriusx-s4-home DSH_TELEMETRY_DISABLED=1 setsid node apps/cli/lib/bin.js --profile s4web --no-open --host 127.0.0.1 --port 0 >/tmp/s10-device-followup-web.log 2>/tmp/s10-device-followup-web.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s10-device-followup-web.log && break; sleep 0.1; done
BASE=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s10-device-followup-web.log)
DSH_URL="$BASE" TOKEN="$TOKEN" DEVICE_NAME="Followup Mac" REPO="$WORK" \
  /opt/node24/bin/node "$ROOT/evidence/S10/06-device-followup/ui-followup.mjs"
