#!/usr/bin/env bash
set -euo pipefail
ROOT="${ROOT:-/root/siriusx}"
REPO="${REPO:-$ROOT/deepseek-harness}"
SECRET=s9-gateway-approval-secret
CP=/tmp/s9-gateway-approval-cp
H=/tmp/siriusx-s9-gateway-approval-home
rm -rf "$CP" "$H"; mkdir -p "$CP"
cd "$ROOT"
pkill -f 'apps/control-plane/src/cli.ts serve' 2>/dev/null || true
pkill -f 'apps/tool-gateway/src/cli.ts' 2>/dev/null || true
pkill -f 'apps/web-gateway/src/cli.ts' 2>/dev/null || true
pkill -f 'apps/cli/lib/bin.js --profile s9web' 2>/dev/null || true
sleep 0.5
A=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts tenant create --db "$CP/control.sqlite" --data-dir "$CP/data" --name Acme --issuer https://idp.example --admin-email admin@acme.example --tenant-id tenant-acme)
AID=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
TOKEN=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts token issue --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-acme --user "$AID" --role admin)
GITHUB_TOKEN=demo-token SIRIUSX_TOOL_GATEWAY_PORT=4330 SIRIUSX_TOOL_GATEWAY_DB=/tmp/s9-gateway-approval-tool.sqlite setsid /opt/node24/bin/node --import tsx apps/tool-gateway/src/cli.ts >/tmp/s9-gateway-approval-tool.log 2>/tmp/s9-gateway-approval-tool.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4330/health >/dev/null && break; sleep 0.1; done
PENDING=$(curl -sS -H 'content-type: application/json' -H 'x-tenant-id: tenant-acme' -H 'x-user-id: user-1' -H 'x-role: admin' -d '{"tenantId":"tenant-acme","botId":"bot-1","ticketId":"gateway-approval","operatorId":"app:user-1","system":"github","actionClass":"send_email","target":"acme/repo","content":"approve through web gateway","mandate":{"actions":[]}}' http://127.0.0.1:4330/v1/actions)
echo "$PENDING" >/tmp/s9-gateway-approval-pending.json
SIRIUSX_SESSION_SECRET=$SECRET SIRIUSX_TOOL_GATEWAY_URL=http://127.0.0.1:4330 setsid /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts serve --db "$CP/control.sqlite" --data-dir "$CP/data" --port 4320 >/tmp/s9-gateway-approval-cp.log 2>/tmp/s9-gateway-approval-cp.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4320/health >/dev/null && break; sleep 0.1; done
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s9web --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s9web add \
  link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/brand-siriusx" link:"$ROOT/plugins/client-ui-team" >/tmp/s9-gateway-approval-add.log 2>&1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" DSH_TELEMETRY_DISABLED=1 setsid node apps/cli/lib/bin.js --profile s9web --no-open --host 127.0.0.1 --port 0 >/tmp/s9-gateway-approval-dsh.log 2>/tmp/s9-gateway-approval-dsh.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s9-gateway-approval-dsh.log && break; sleep 0.1; done
DSH_URL=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s9-gateway-approval-dsh.log)
cd "$ROOT"
setsid /opt/node24/bin/node --import tsx apps/web-gateway/src/cli.ts --control-plane http://127.0.0.1:4320 --dsh-web "$DSH_URL" --port 8080 >/tmp/s9-gateway-approval-gateway.log 2>/tmp/s9-gateway-approval-gateway.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:8080/health >/dev/null && break; sleep 0.1; done
TOKEN="$TOKEN" /opt/node24/bin/node "$ROOT/evidence/S9/03-gateway-approval/ui-approval.mjs"
