#!/usr/bin/env bash
set -euo pipefail
ROOT="${ROOT:-/root/siriusx}"
REPO="${REPO:-$ROOT/deepseek-harness}"
SECRET=s9-gateway-secret
CP=/tmp/s9-gateway-cp
H=/tmp/siriusx-s9-gateway-home
WORK=/tmp/s9-gateway-repo
rm -rf "$CP" "$H" "$WORK"; mkdir -p "$CP"
cd "$ROOT"
pkill -f 'apps/control-plane/src/cli.ts serve' 2>/dev/null || true
pkill -f 'apps/web-gateway/src/cli.ts' 2>/dev/null || true
pkill -f 'apps/cli/lib/bin.js --profile s9web' 2>/dev/null || true
sleep 0.5
A=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts tenant create --db "$CP/control.sqlite" --data-dir "$CP/data" --name Acme --issuer https://idp.example --admin-email admin@acme.example --tenant-id tenant-acme)
B=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts tenant create --db "$CP/control.sqlite" --data-dir "$CP/data" --name Beta --issuer https://idp.example --admin-email admin@beta.example --tenant-id tenant-beta)
AID=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
BID=$(echo "$B" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
TOKEN_A=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts token issue --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-acme --user "$AID" --role admin)
TOKEN_B=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts token issue --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-beta --user "$BID" --role admin)
SIRIUSX_SESSION_SECRET=$SECRET setsid /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts serve --db "$CP/control.sqlite" --data-dir "$CP/data" --port 4320 >/tmp/s9-gateway-cp.log 2>/tmp/s9-gateway-cp.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4320/health >/dev/null && break; sleep 0.1; done
mkdir "$WORK" && cd "$WORK" && git init -q && git config user.email test@example.com && git config user.name Test && echo one > app.txt && git add . && git commit -qm base
curl -sS -H "Authorization: Bearer $TOKEN_A" -H 'content-type: application/json' -d "{\"path\":\"$WORK\",\"prompt\":\"gateway ticket\"}" http://127.0.0.1:4320/v1/tickets >/tmp/s9-gateway-ticket.json
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s9web --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s9web add \
  link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/brand-siriusx" link:"$ROOT/plugins/client-ui-team" >/tmp/s9-gateway-add.log 2>&1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" DSH_TELEMETRY_DISABLED=1 setsid node apps/cli/lib/bin.js --profile s9web --no-open --host 127.0.0.1 --port 0 >/tmp/s9-gateway-dsh.log 2>/tmp/s9-gateway-dsh.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s9-gateway-dsh.log && break; sleep 0.1; done
DSH_URL=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s9-gateway-dsh.log)
cd "$ROOT"
setsid /opt/node24/bin/node --import tsx apps/web-gateway/src/cli.ts --control-plane http://127.0.0.1:4320 --dsh-web "$DSH_URL" --port 8080 >/tmp/s9-gateway.log 2>/tmp/s9-gateway.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:8080/health >/dev/null && break; sleep 0.1; done
GATEWAY_URL=http://127.0.0.1:8080 TOKEN_A="$TOKEN_A" TOKEN_B="$TOKEN_B" SHOT="$ROOT/evidence/S9/02-gateway/gateway.png" \
  /opt/node24/bin/node "$ROOT/evidence/S9/02-gateway/ui-gateway.mjs"
