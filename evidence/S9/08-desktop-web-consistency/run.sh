#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/siriusx
REPO="$ROOT/deepseek-harness"
SECRET=s9-consistency-secret
CP=/tmp/s9-consistency-cp
H=/tmp/siriusx-s9-consistency-home
WORK=/tmp/s9-consistency-repo
rm -rf "$CP" "$H" "$WORK"; mkdir -p "$CP"
cd "$ROOT"
for pattern in 'apps/control-plane/src/cli.ts serve' 'apps/web-gateway/src/cli.ts' 'apps/cli/lib/bin.js --profile s9consistency'; do pkill -9 -f "$pattern" 2>/dev/null || true; done
sleep 0.5
A=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts tenant create --db "$CP/control.sqlite" --data-dir "$CP/data" --name Acme --issuer https://idp.example --admin-email admin@acme.example --tenant-id tenant-acme)
AID=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
TOKEN=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts token issue --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-acme --user "$AID" --role admin)
SIRIUSX_SESSION_SECRET=$SECRET setsid /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts serve --db "$CP/control.sqlite" --data-dir "$CP/data" --port 4320 >/tmp/s9-consistency-cp.log 2>/tmp/s9-consistency-cp.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4320/health >/dev/null && break; sleep 0.1; done
mkdir "$WORK" && cd "$WORK" && git init -q && git config user.email test@example.com && git config user.name Test && echo one > app.txt && git add . && git commit -qm base
TICKET=$(curl -sS -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"path\":\"$WORK\",\"prompt\":\"consistency ticket\"}" http://127.0.0.1:4320/v1/tickets | python3 -c 'import json,sys;print(json.load(sys.stdin)["ticketId"])')
sleep 1
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s9consistency --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s9consistency add link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/brand-siriusx" link:"$ROOT/plugins/client-ui-team" >/tmp/s9-consistency-add.log 2>&1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" DSH_TELEMETRY_DISABLED=1 setsid node apps/cli/lib/bin.js --profile s9consistency --no-open --host 127.0.0.1 --port 0 >/tmp/s9-consistency-dsh.log 2>/tmp/s9-consistency-dsh.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s9-consistency-dsh.log && break; sleep 0.1; done
DSH_URL=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s9-consistency-dsh.log)
cd "$ROOT"
setsid /opt/node24/bin/node --import tsx apps/web-gateway/src/cli.ts --control-plane http://127.0.0.1:4320 --dsh-web "$DSH_URL" --port 8080 >/tmp/s9-consistency-gateway.log 2>/tmp/s9-consistency-gateway.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:8080/health >/dev/null && break; sleep 0.1; done
TOKEN="$TOKEN" TICKET_ID="$TICKET" DSH_URL="$DSH_URL" /opt/node24/bin/node "$ROOT/evidence/S9/08-desktop-web-consistency/ui-consistency.mjs"
