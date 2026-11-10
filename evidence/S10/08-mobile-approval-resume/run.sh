#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/siriusx
REPO="$ROOT/deepseek-harness"
SECRET=s10-mobile-resume-secret
SERVICE=s10-mobile-service
CP=/tmp/s10-mobile-resume-cp
H=/tmp/siriusx-s10-mobile-resume-home
WORK=/tmp/s10-mobile-resume-repo
rm -rf "$CP" "$H" "$WORK"; mkdir -p "$CP"
cd "$ROOT"
for pattern in 'apps/control-plane/src/cli.ts serve' 'apps/tool-gateway/src/cli.ts' 'apps/web-gateway/src/cli.ts' 'apps/cli/lib/bin.js --profile s10approval'; do pkill -9 -f "$pattern" 2>/dev/null || true; done
sleep 0.5
A=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts tenant create --db "$CP/control.sqlite" --data-dir "$CP/data" --name Acme --issuer https://idp.example --admin-email admin@acme.example --tenant-id tenant-acme)
AID=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["adminUserId"])')
TOKEN=$(PATH=/opt/node24/bin:$PATH SIRIUSX_SESSION_SECRET=$SECRET node --import tsx apps/control-plane/src/cli.ts token issue --db "$CP/control.sqlite" --data-dir "$CP/data" --tenant tenant-acme --user "$AID" --role admin)
SIRIUSX_SESSION_SECRET=$SECRET SIRIUSX_SSO_SERVICE_TOKEN=$SERVICE SIRIUSX_BOT_SCENARIO=waiting SIRIUSX_TOOL_GATEWAY_URL=http://127.0.0.1:4330 setsid /opt/node24/bin/node --import tsx apps/control-plane/src/cli.ts serve --db "$CP/control.sqlite" --data-dir "$CP/data" --port 4320 >/tmp/s10-mobile-resume-cp.log 2>/tmp/s10-mobile-resume-cp.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4320/health >/dev/null && break; sleep 0.1; done
mkdir "$WORK" && cd "$WORK" && git init -q && git config user.email test@example.com && git config user.name Test && echo one > app.txt && git add . && git commit -qm base
TICKET=$(curl -sS -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"path\":\"$WORK\",\"prompt\":\"approval waiting ticket\"}" http://127.0.0.1:4320/v1/tickets | python3 -c 'import json,sys;print(json.load(sys.stdin)["ticketId"])')
sleep 1
cd "$ROOT"
SIRIUSX_TOOL_GATEWAY_PORT=4330 SIRIUSX_TOOL_GATEWAY_DB=/tmp/s10-mobile-resume-tool.sqlite GITHUB_TOKEN=demo-token \
SIRIUSX_APPROVAL_CALLBACK_URL=http://127.0.0.1:4320/v1/approvals/callback SIRIUSX_INTERNAL_SERVICE_TOKEN=$SERVICE \
setsid /opt/node24/bin/node --import tsx apps/tool-gateway/src/cli.ts >/tmp/s10-mobile-resume-tool.log 2>/tmp/s10-mobile-resume-tool.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:4330/health >/dev/null && break; sleep 0.1; done
curl -sS -H 'content-type: application/json' -H 'x-tenant-id: tenant-acme' -H 'x-user-id: user-1' -H 'x-role: admin' -d "{\"tenantId\":\"tenant-acme\",\"botId\":\"bot-1\",\"ticketId\":\"$TICKET\",\"operatorId\":\"app:user-1\",\"system\":\"github\",\"actionClass\":\"send_email\",\"target\":\"acme/repo\",\"content\":\"approve from mobile\",\"mandate\":{\"actions\":[]}}" http://127.0.0.1:4330/v1/actions >/tmp/s10-mobile-resume-pending.json
cd "$REPO"
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js --from-default-profile web --profile s10approval --dump-config >/dev/null
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" node apps/cli/lib/bin.js plugin --profile s10approval add link:"$ROOT/plugins/telemetry-off" link:"$ROOT/plugins/brand-siriusx" link:"$ROOT/plugins/client-ui-team" >/tmp/s10-mobile-resume-add.log 2>&1
PATH=/opt/node24/bin:$PATH DSH_HOME="$H" DSH_TELEMETRY_DISABLED=1 setsid node apps/cli/lib/bin.js --profile s10approval --no-open --host 127.0.0.1 --port 0 >/tmp/s10-mobile-resume-dsh.log 2>/tmp/s10-mobile-resume-dsh.err < /dev/null &
for _ in $(seq 1 100); do grep -q '^dsh web: ' /tmp/s10-mobile-resume-dsh.log && break; sleep 0.1; done
DSH_URL=$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' /tmp/s10-mobile-resume-dsh.log)
cd "$ROOT"
setsid /opt/node24/bin/node --import tsx apps/web-gateway/src/cli.ts --control-plane http://127.0.0.1:4320 --dsh-web "$DSH_URL" --port 8080 >/tmp/s10-mobile-resume-gateway.log 2>/tmp/s10-mobile-resume-gateway.err < /dev/null &
for _ in $(seq 1 100); do curl -sf http://127.0.0.1:8080/health >/dev/null && break; sleep 0.1; done
TOKEN="$TOKEN" /opt/node24/bin/node "$ROOT/evidence/S10/08-mobile-approval-resume/ui-approval.mjs"
/opt/node24/bin/node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync('$CP/data/tenants/tenant-acme/bot.sqlite'); console.log(JSON.stringify({assignments:db.prepare('SELECT kind,state FROM assignments WHERE ticket_id=? ORDER BY created_at,rowid').all('$TICKET')},null,2)); db.close()"
